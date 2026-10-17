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

  // Ignore common tracking parameters.
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.href;
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
    // Ignore cancellation errors.
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
      // Ignore cancellation errors.
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
 * Validate every URL before requesting it.
 * Redirects are handled manually, never automatically.
 */
async function safeRequest(input, method = "GET") {
  let current = new URL(await validatePublicUrl(input));
  const original = current.href;
  const redirects = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Revalidate the current URL before each request.
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
      return { response, original, finalUrl: current.href, redirects };
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

async function checkPage(url, rootOrigin) {
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

  for (const redirect of result.redirects) {
    findings.push(
      finding(
        "redirect",
        redirect.to.startsWith(rootOrigin) ? "info" : "medium",
        redirect.from,
        `Redirection HTTP ${redirect.status} vers ${redirect.to}`,
        redirect.status,
        { destination: redirect.to },
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
      ),
    );

    await cancelBody(response);

    return { url, links: [], findings };
  }

  if (!isHtml(response)) {
    await cancelBody(response);
    return { url, links: [], findings };
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
      // Ignore malformed links.
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

      // Some servers do not implement HEAD.
      if (result.response?.status === 405) {
        await cancelBody(result.response);
        result = await safeRequest(url, "GET");
      }

      if (!result.response) continue;

      const { status } = result.response;
      await cancelBody(result.response);

      // Do not download or store file contents.
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
      // A failed probe is not proof of an exposed file.
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
        isHtml(result.response) === false &&
        (result.response.headers.get("content-type") || "")
          .toLowerCase()
          .includes("xml")
      ) {
        const text = await readLimitedText(result.response);
        const $ = cheerio.load(text, { xmlMode: true });
        const urls = [];

        $("url > loc, sitemap > loc").each((_, el) => {
          const value = $(el).text().trim();

          try {
            const parsed = new URL(value);
            if (parsed.origin === new URL(baseUrl).origin) {
              urls.push(normalizeUrl(parsed.href));
            }
          } catch {
            // Ignore invalid sitemap entries.
          }
        });

        return urls;
      }

      if (result.response) await cancelBody(result.response);
    } catch {
      // A sitemap is optional.
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
        // Ignore malformed URLs.
      }
    };

    for (const path of config.important_paths || ["/"]) {
      try {
        enqueue(new URL(path, baseUrl).href);
      } catch {
        // Ignore invalid configured paths.
      }
    }

    enqueue(baseUrl);

    // Sitemap discovery is optional; it does not replace internal crawling.
    const sitemapUrls = await discoverSitemap(baseUrl);
    for (const url of sitemapUrls) enqueue(url);

    while (queue.length > 0 && pagesChecked < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;

      visited.add(url);

      let page;

      try {
        page = await checkPage(url, rootOrigin);
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

        if (!visited.has(link)) enqueue(link);
      }
    }

    // Test common sensitive-file paths without saving response bodies.
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
