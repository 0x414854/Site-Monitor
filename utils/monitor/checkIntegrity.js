import * as cheerio from "cheerio";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { validatePublicUrl } from "@/utils/monitor/validate-url";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_TOTAL_LINK_CHECKS = 200;

const SENSITIVE_PATHS = [
  "/.env",
  "/.env.local",
  "/.git/config",
  "/.git/HEAD",
  "/backup.zip",
  "/backup.sql",
  "/database.sql",
  "/dump.sql",
  "/config.php.bak",
  "/wp-config.php.bak",
  "/.DS_Store",
];

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.href;
}

function normalizePathname(pathname) {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function stripLocalePrefix(pathname, localePrefixes) {
  const segments = pathname.split("/");
  const firstSegment = (segments[1] || "").toLowerCase();

  if (!localePrefixes.has(firstSegment)) {
    return {
      pathname: normalizePathname(pathname),
      hadLocale: false,
    };
  }

  const remainingPath = `/${segments.slice(2).join("/")}`;

  return {
    pathname: normalizePathname(remainingPath),
    hadLocale: true,
  };
}

/**
 * Reconnaît les redirections de langue attendues.
 *
 * Règles :
 * - "/" doit rediriger vers "/{defaultLocale}".
 * - "/page" vers "/fr/page", "/en/page" ou "/pt/page"
 *   est considéré comme une redirection de langue si le chemin
 *   reste identique après retrait du préfixe.
 * - Une redirection vers un autre domaine n'est jamais ignorée.
 * - Une langue non configurée n'est pas considérée comme valide.
 */
function isExpectedLocaleRedirect(
  redirect,
  rootOrigin,
  localePrefixes,
  defaultLocale,
) {
  if (localePrefixes.size === 0) return false;

  try {
    const from = new URL(redirect.from);
    const to = new URL(redirect.to);

    if (from.origin !== rootOrigin || to.origin !== rootOrigin) {
      return false;
    }

    const sourcePath = normalizePathname(from.pathname);
    const destinationPath = normalizePathname(to.pathname);

    const normalizedDefaultLocale =
      typeof defaultLocale === "string"
        ? defaultLocale.trim().toLowerCase()
        : "";

    // La racine doit aller vers la langue par défaut configurée.
    // Exemple : "/" -> "/fr" est normal si default_locale = "fr".
    // Exemple : "/" -> "/en" est une anomalie dans cette configuration.
    if (sourcePath === "/") {
      return (
        normalizedDefaultLocale !== "" &&
        localePrefixes.has(normalizedDefaultLocale) &&
        destinationPath === `/${normalizedDefaultLocale}`
      );
    }

    const source = stripLocalePrefix(from.pathname, localePrefixes);

    const destination = stripLocalePrefix(to.pathname, localePrefixes);

    // Il faut qu'au moins une des URL ait un préfixe de langue connu.
    if (!source.hadLocale && !destination.hadLocale) {
      return false;
    }

    // Le chemin de la page doit rester identique.
    // Exemple : "/reviews" -> "/fr/reviews" : normal.
    // Exemple : "/services" -> "/fr/contact" : anomalie.
    return source.pathname === destination.pathname;
  } catch {
    return false;
  }
}

function isHtml(response) {
  return (response.headers.get("content-type") || "")
    .toLowerCase()
    .includes("text/html");
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore les erreurs d'annulation.
  }
}

async function readLimitedText(response) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();

      if (done) break;

      const remaining = MAX_HTML_BYTES - total;
      const chunk = value.subarray(0, remaining);

      chunks.push(chunk);
      total += chunk.byteLength;

      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore les erreurs d'annulation.
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

/**
 * Valide chaque URL avant de la requêter.
 * Les redirections sont suivies manuellement.
 */
async function safeRequest(input, method = "GET") {
  let current = new URL(await validatePublicUrl(input));
  const original = current.href;
  const redirects = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    current = new URL(await validatePublicUrl(current.href));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;

    try {
      response = await fetch(current, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SiteIntegrityMonitor/1.0",
          accept:
            method === "HEAD"
              ? "*/*"
              : "text/html,application/xhtml+xml,*/*;q=0.5",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (
      response.status < 300 ||
      response.status > 399 ||
      response.status === 304
    ) {
      return {
        response,
        original,
        finalUrl: current.href,
        redirects,
      };
    }

    const location = response.headers.get("location");
    await cancelBody(response);

    if (!location) {
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        error: `Redirection HTTP ${response.status} sans destination`,
      };
    }

    if (hop === MAX_REDIRECTS) {
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        error: "Trop de redirections",
      };
    }

    const next = new URL(location, current);

    // Chaque destination de redirection doit être validée.
    await validatePublicUrl(next.href);

    redirects.push({
      from: current.href,
      to: next.href,
      status: response.status,
    });

    current = next;
  }

  return {
    response: null,
    original,
    finalUrl: current.href,
    redirects,
    error: "Redirection non résolue",
  };
}

function finding(
  category,
  severity,
  url,
  message,
  statusCode = null,
  details = {},
) {
  return {
    category,
    severity,
    url,
    message,
    status_code: statusCode,
    details,
  };
}

async function checkPage(url, rootOrigin, localePrefixes, defaultLocale) {
  const result = await safeRequest(url);

  if (!result.response) {
    return {
      url,
      error: result.error || "Impossible de récupérer la page",
      redirects: result.redirects,
      findings: [
        finding(
          "page_error",
          "high",
          url,
          result.error || "Échec de la requête HTTP",
          null,
          { redirects: result.redirects },
        ),
      ],
      links: [],
    };
  }

  const { response } = result;
  const findings = [];

  // Enregistrer les redirections anormales seulement.
  for (const redirect of result.redirects) {
    const expected = isExpectedLocaleRedirect(
      redirect,
      rootOrigin,
      localePrefixes,
      defaultLocale,
    );

    if (expected) continue;

    findings.push(
      finding(
        "redirect",
        redirect.to.startsWith(rootOrigin) ? "medium" : "high",
        redirect.from,
        `Redirection HTTP ${redirect.status} vers ${redirect.to}`,
        redirect.status,
        {
          destination: redirect.to,
          expected_locale_redirect: false,
        },
      ),
    );
  }

  if (response.status >= 400) {
    findings.push(
      finding(
        "page_error",
        response.status >= 500 ? "high" : "medium",
        url,
        `La page retourne HTTP ${response.status}`,
        response.status,
        {
          finalUrl: result.finalUrl,
        },
      ),
    );

    await cancelBody(response);

    return {
      url,
      finalUrl: result.finalUrl,
      links: [],
      findings,
    };
  }

  if (!isHtml(response)) {
    await cancelBody(response);

    return {
      url,
      finalUrl: result.finalUrl,
      links: [],
      findings,
    };
  }

  const html = await readLimitedText(response);
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href")?.trim();

    if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) {
      return;
    }

    try {
      const link = new URL(href, result.finalUrl);

      if (!["http:", "https:"].includes(link.protocol)) return;
      if (link.origin !== rootOrigin) return;

      links.push(normalizeUrl(link.href));
    } catch {
      // Ignore les liens mal formés.
    }
  });

  return {
    url,
    finalUrl: result.finalUrl,
    links: [...new Set(links)],
    findings,
  };
}

async function probeSensitiveFiles(baseUrl) {
  const findings = [];

  for (const path of SENSITIVE_PATHS) {
    const url = new URL(path, baseUrl).href;

    try {
      let result = await safeRequest(url, "HEAD");

      if (result.response?.status === 405) {
        await cancelBody(result.response);
        result = await safeRequest(url, "GET");
      }

      if (!result.response) continue;

      const { status } = result.response;
      await cancelBody(result.response);

      if (status === 200) {
        findings.push(
          finding(
            "sensitive_file",
            "critical",
            url,
            "Un chemin de fichier potentiellement sensible est accessible publiquement",
            status,
          ),
        );
      }
    } catch {
      // Un échec de vérification ne prouve pas qu'un fichier est exposé.
    }
  }

  return findings;
}

async function discoverSitemap(baseUrl) {
  const candidates = [
    new URL("/sitemap.xml", baseUrl).href,
    new URL("/sitemap_index.xml", baseUrl).href,
  ];

  for (const candidate of candidates) {
    try {
      const result = await safeRequest(candidate);

      if (
        result.response?.status === 200 &&
        !isHtml(result.response) &&
        (result.response.headers.get("content-type") || "")
          .toLowerCase()
          .includes("xml")
      ) {
        const text = await readLimitedText(result.response);
        const $ = cheerio.load(text, { xmlMode: true });
        const urls = [];

        $("url > loc, sitemap > loc").each((_, element) => {
          const value = $(element).text().trim();

          try {
            const parsed = new URL(value);

            if (parsed.origin === new URL(baseUrl).origin) {
              urls.push(normalizeUrl(parsed.href));
            }
          } catch {
            // Ignore les entrées invalides du sitemap.
          }
        });

        return [...new Set(urls)];
      }

      if (result.response) {
        await cancelBody(result.response);
      }
    } catch {
      // Le sitemap est facultatif.
    }
  }

  return [];
}

export async function scanWebsiteIntegrity(website, config) {
  const { data: scan, error: createError } = await supabaseAdmin
    .from("website_integrity_scans")
    .insert({
      website_id: website.id,
      status: "running",
    })
    .select("id")
    .single();

  if (createError) throw createError;

  let pagesChecked = 0;
  let linksChecked = 0;
  let allFindings = [];

  try {
    const base = await validatePublicUrl(website.url);
    const baseUrl = base.href;
    const rootOrigin = base.origin;

    // Les langues sont configurées par site, sans valeur par défaut
    // implicite dans le code.
    const localePrefixes = new Set(
      (Array.isArray(config.locale_prefixes) ? config.locale_prefixes : [])
        .filter((locale) => typeof locale === "string")
        .map((locale) => locale.trim().toLowerCase())
        .filter(Boolean),
    );

    const defaultLocale =
      typeof config.default_locale === "string"
        ? config.default_locale.trim().toLowerCase()
        : "";

    // Évite d'appliquer une langue par défaut non autorisée.
    const validDefaultLocale = localePrefixes.has(defaultLocale)
      ? defaultLocale
      : "";

    const maxPages = Math.min(Math.max(config.max_pages || 50, 1), 50);

    const maxLinks = Math.max(config.max_links_per_page || 50, 1);

    const queue = [];
    const queued = new Set();
    const visited = new Set();

    const enqueue = (value) => {
      if (queue.length + visited.size >= maxPages) return;

      try {
        const normalized = normalizeUrl(value);
        const parsed = new URL(normalized);

        if (parsed.origin !== rootOrigin) return;
        if (queued.has(normalized) || visited.has(normalized)) return;

        queued.add(normalized);
        queue.push(normalized);
      } catch {
        // Ignore les URL mal formées.
      }
    };

    for (const path of config.important_paths || ["/"]) {
      try {
        enqueue(new URL(path, baseUrl).href);
      } catch {
        // Ignore les chemins configurés invalides.
      }
    }

    enqueue(baseUrl);

    const sitemapUrls = await discoverSitemap(baseUrl);

    for (const url of sitemapUrls) {
      enqueue(url);
    }

    while (queue.length > 0 && pagesChecked < maxPages) {
      const url = queue.shift();

      if (!url || visited.has(url)) continue;

      visited.add(url);

      let page;

      try {
        page = await checkPage(
          url,
          rootOrigin,
          localePrefixes,
          validDefaultLocale,
        );
      } catch (error) {
        page = {
          url,
          links: [],
          findings: [
            finding(
              "page_error",
              "high",
              url,
              error instanceof Error ? error.message : "Erreur de requête",
            ),
          ],
        };
      }

      pagesChecked++;
      allFindings.push(...page.findings);

      for (const link of (page.links || []).slice(0, maxLinks)) {
        if (linksChecked >= MAX_TOTAL_LINK_CHECKS) break;

        linksChecked++;

        if (!visited.has(link)) {
          enqueue(link);
        }
      }
    }

    allFindings.push(...(await probeSensitiveFiles(baseUrl)));

    if (allFindings.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("website_integrity_findings")
        .insert(
          allFindings.map((item) => ({
            ...item,
            scan_id: scan.id,
          })),
        );

      if (insertError) throw insertError;
    }

    const { error: updateError } = await supabaseAdmin
      .from("website_integrity_scans")
      .update({
        finished_at: new Date().toISOString(),
        status: "completed",
        pages_checked: pagesChecked,
        links_checked: linksChecked,
        findings_count: allFindings.length,
      })
      .eq("id", scan.id);

    if (updateError) throw updateError;

    return {
      websiteId: website.id,
      scanId: scan.id,
      pagesChecked,
      linksChecked,
      findingsCount: allFindings.length,
    };
  } catch (error) {
    await supabaseAdmin
      .from("website_integrity_scans")
      .update({
        finished_at: new Date().toISOString(),
        status: "failed",
        pages_checked: pagesChecked,
        links_checked: linksChecked,
        findings_count: allFindings.length,
        error_message: String(error).slice(0, 1000),
      })
      .eq("id", scan.id);

    throw error;
  }
}
