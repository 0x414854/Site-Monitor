import * as cheerio from "cheerio";

export const MAX_PAGES_PER_SCAN = 50;
export const MAX_LINK_REQUESTS_PER_SCAN = 200;
export const MAX_TOTAL_REQUESTS_PER_SCAN = 400;
export const MAX_LINKS_PER_PAGE = 50;

const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SITEMAP_URLS = 1000;
const MAX_SITEMAP_DOCUMENTS = 5;
const MAX_CONCURRENT_LINK_REQUESTS = 4;
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
    if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }

  return url.href;
}

function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

function stripLocalePrefix(pathname, localePrefixes) {
  const segments = pathname.split("/");
  const firstSegment = (segments[1] || "").toLowerCase();

  if (!localePrefixes.has(firstSegment)) {
    return { pathname: normalizePathname(pathname), hadLocale: false };
  }

  return {
    pathname: normalizePathname(`/${segments.slice(2).join("/")}`),
    hadLocale: true,
  };
}

function isCanonicalHostRedirect(from, to) {
  try {
    const source = new URL(from);
    const destination = new URL(to);

    if (
      source.protocol !== destination.protocol ||
      source.port !== destination.port
    ) {
      return false;
    }

    const sourceHost = source.hostname.toLowerCase();
    const destinationHost = destination.hostname.toLowerCase();
    return (
      destinationHost === `www.${sourceHost}` ||
      sourceHost === `www.${destinationHost}`
    );
  } catch {
    return false;
  }
}

function isSameSiteOrigin(origin, rootOrigin) {
  try {
    const candidate = new URL(origin);
    const root = new URL(rootOrigin);
    return (
      candidate.protocol === root.protocol &&
      candidate.port === root.port &&
      (candidate.hostname.toLowerCase() === root.hostname.toLowerCase() ||
        isCanonicalHostRedirect(candidate.href, root.href))
    );
  } catch {
    return false;
  }
}

function isExpectedLocaleRedirect(
  redirect,
  rootOrigin,
  localePrefixes,
  defaultLocale,
) {
  if (!localePrefixes.size) return false;

  try {
    const from = new URL(redirect.from);
    const to = new URL(redirect.to);
    if (
      !isSameSiteOrigin(from.origin, rootOrigin) ||
      !isSameSiteOrigin(to.origin, rootOrigin)
    ) {
      return false;
    }

    const sourcePath = normalizePathname(from.pathname);
    const destinationPath = normalizePathname(to.pathname);

    if (sourcePath === "/") {
      return (
        Boolean(defaultLocale) &&
        localePrefixes.has(defaultLocale) &&
        destinationPath === `/${defaultLocale}`
      );
    }

    const source = stripLocalePrefix(from.pathname, localePrefixes);
    const destination = stripLocalePrefix(to.pathname, localePrefixes);
    return (
      (source.hadLocale || destination.hadLocale) &&
      source.pathname === destination.pathname
    );
  } catch {
    return false;
  }
}

function finding(category, severity, url, message, statusCode = null, details = {}) {
  return {
    category,
    severity,
    url,
    message,
    status_code: statusCode,
    details,
  };
}

function isHtml(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  );
}

async function cancelBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // A response body can already be consumed or closed.
  }
}

async function cancelRequest(result) {
  await cancelBody(result?.response);
  result?.cleanup?.();
}

async function readLimitedText(response) {
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;

  try {
    while (total < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = MAX_RESPONSE_BYTES - total;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;

      if (chunk.byteLength < value.byteLength) {
        truncated = true;
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // A response body can already be consumed or closed.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(bytes), truncated };
}

function createRequestBudget() {
  return {
    requests: 0,
    linkRequests: 0,
    reserve(requestClass) {
      if (this.requests >= MAX_TOTAL_REQUESTS_PER_SCAN) return false;
      if (
        requestClass === "link" &&
        this.linkRequests >= MAX_LINK_REQUESTS_PER_SCAN
      ) {
        return false;
      }

      this.requests += 1;
      if (requestClass === "link") this.linkRequests += 1;
      return true;
    },
  };
}

async function safeRequest(
  input,
  {
    requestClass,
    rootOrigin,
    budget,
    fetchImpl,
    validateUrl,
    method = "GET",
  },
) {
  let current;
  const redirects = [];
  let requestsMade = 0;

  try {
    current = new URL(await validateUrl(input));
  } catch (error) {
    return {
      response: null,
      original: input,
      finalUrl: input,
      redirects,
      requestsMade,
      error: error instanceof Error ? error.message : "URL non autorisée",
    };
  }

  const original = current.href;
  const seen = new Set([normalizeUrl(current.href)]);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!budget.reserve(requestClass)) {
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        budgetReached: true,
        error: "Budget de requêtes du scan atteint",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;

    try {
      requestsMade += 1;
      response = await fetchImpl(current, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SiteIntegrityMonitor/1.0",
          accept:
            method === "HEAD"
              ? "*/*"
              : "text/html,application/xhtml+xml,application/xml,*/*;q=0.5",
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        error:
          error?.name === "AbortError"
            ? "Délai de réponse dépassé"
            : error instanceof Error
              ? error.message
              : "Erreur réseau",
      };
    }

    const status = response.status;
    const location = response.headers.get("location");
    if (status < 300 || status > 399 || status === 304 || !location) {
      return {
        response,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        cleanup: () => clearTimeout(timeout),
        statusCode:
          status >= 300 && status <= 399 && status !== 304 && !location
            ? status
            : undefined,
        error:
          status >= 300 && status <= 399 && status !== 304 && !location
            ? `Redirection HTTP ${status} sans destination`
            : undefined,
      };
    }

    let next;
    try {
      next = new URL(location, current);
    } catch {
      await cancelBody(response);
      clearTimeout(timeout);
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        error: "Destination de redirection invalide",
        statusCode: status,
      };
    }

    let blockedReason = null;
    try {
      next = new URL(await validateUrl(next.href));
      if (!isSameSiteOrigin(next.origin, rootOrigin)) {
        blockedReason = "La redirection quitte le site surveillé";
      }
    } catch (error) {
      blockedReason =
        error instanceof Error ? error.message : "Destination interdite";
    }

    redirects.push({
      from: current.href,
      to: next.href,
      status,
      blocked: Boolean(blockedReason),
      error: blockedReason,
    });
    await cancelBody(response);
    clearTimeout(timeout);

    if (blockedReason) {
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        error: blockedReason,
        statusCode: status,
      };
    }

    const nextKey = normalizeUrl(next.href);
    if (seen.has(nextKey)) {
      redirects[redirects.length - 1].error =
        "Boucle de redirection détectée";
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        error: "Boucle de redirection détectée",
        statusCode: status,
      };
    }

    if (hop === MAX_REDIRECTS) {
      redirects[redirects.length - 1].error =
        "Limite de redirections atteinte";
      return {
        response: null,
        original,
        finalUrl: current.href,
        redirects,
        requestsMade,
        error: "Limite de redirections atteinte",
        statusCode: status,
      };
    }

    seen.add(nextKey);
    current = next;
  }

  return {
    response: null,
    original,
    finalUrl: current.href,
    redirects,
    requestsMade,
    error: "Redirection non résolue",
  };
}

function collectLinks(html, pageUrl, rootOrigin, maxLinks) {
  const $ = cheerio.load(html);
  const internal = new Set();
  const external = new Set();
  let extracted = 0;
  let extractionLimitReached = false;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return;

    try {
      const link = new URL(href, pageUrl);
      if (!["http:", "https:"].includes(link.protocol)) return;
      if (extracted >= maxLinks) {
        extractionLimitReached = true;
        return false;
      }
      const normalized = normalizeUrl(link.href);
      extracted += 1;

      if (isSameSiteOrigin(link.origin, rootOrigin)) {
        internal.add(normalized);
      } else {
        external.add(normalized);
      }
    } catch {
      // Invalid links do not count toward the extraction limit.
    }
  });

  return {
    internal: [...internal],
    external: [...external],
    extractionLimitReached,
  };
}

function collectResponseFindings(
  result,
  { rootOrigin, localePrefixes, defaultLocale, category, targetUrl },
) {
  const findings = [];

  for (const redirect of result.redirects) {
    if (
      !redirect.blocked &&
      (isExpectedLocaleRedirect(
        redirect,
        rootOrigin,
        localePrefixes,
        defaultLocale,
      ) ||
        isCanonicalHostRedirect(redirect.from, redirect.to))
    ) {
      continue;
    }

    findings.push(
      finding(
        "redirect",
        redirect.blocked || !isSameSiteOrigin(new URL(redirect.to).origin, rootOrigin)
          ? "high"
          : "medium",
        redirect.from,
        redirect.error
          ? `Redirection HTTP ${redirect.status} ${
              redirect.blocked ? "bloquée" : "interrompue"
            } : ${redirect.error}`
          : `Redirection HTTP ${redirect.status} vers ${redirect.to}`,
        redirect.status,
        { destination: redirect.to, blocked: redirect.blocked },
      ),
    );
  }

  if (result.error && (result.requestsMade > 0 || !result.budgetReached)) {
    const hasRedirectFinding = findings.some(
      (item) =>
        item.category === "redirect" &&
        item.status_code === result.statusCode,
    );
    if (!hasRedirectFinding) {
      const errorCategory =
        result.statusCode >= 300 && result.statusCode <= 399
          ? "redirect"
          : category;
      findings.push(
        finding(
          errorCategory,
          "high",
          targetUrl,
          result.error,
          result.statusCode ?? null,
          { redirects: result.redirects },
        ),
      );
    }
    return findings;
  }

  const status = result.response?.status;
  if (status == null) return findings;

  if (status >= 400) {
    findings.push(
      finding(
        category,
        status >= 500 ? "high" : "medium",
        targetUrl,
        `${category === "broken_link" ? "Le lien cible" : "La page"} retourne HTTP ${status}`,
        status,
        { finalUrl: result.finalUrl },
      ),
    );
  } else if (status >= 300 && status <= 399 && status !== 304) {
    findings.push(
      finding(
        "redirect",
        "medium",
        targetUrl,
        result.error || `Redirection HTTP ${status} non résolue`,
        status,
        { finalUrl: result.finalUrl },
      ),
    );
  }

  return findings;
}

function uniqueFindings(findings) {
  const unique = new Map();
  for (const item of findings) {
    const key = `${item.category}:${normalizeUrl(item.url)}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function limitFromConfig(value, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return maximum;
  return Math.min(Math.floor(parsed), maximum);
}

async function parsePageResponse(result, { url, rootOrigin, maxLinks }) {
  const response = result.response;
  if (!response || response.status >= 400 || !isHtml(response)) {
    await cancelRequest(result);
    return {
      links: { internal: [], external: [], extractionLimitReached: false },
      htmlAvailable: false,
    };
  }

  let text;
  let truncated;
  try {
    ({ text, truncated } = await readLimitedText(response));
  } catch (error) {
    await cancelRequest(result);
    return {
      links: { internal: [], external: [], extractionLimitReached: false },
      htmlAvailable: false,
      readError:
        error instanceof Error
          ? error.message
          : "Impossible de lire le contenu de la page",
    };
  } finally {
    result.cleanup?.();
  }
  return {
    links: collectLinks(text, result.finalUrl || url, rootOrigin, maxLinks),
    htmlAvailable: true,
    htmlTruncated: truncated,
  };
}

async function discoverSitemap(
  baseUrl,
  { rootOrigin, budget, fetchImpl, validateUrl },
) {
  const urls = [];
  const sitemapQueue = [
    new URL("/sitemap.xml", baseUrl).href,
    new URL("/sitemap_index.xml", baseUrl).href,
  ];
  const seenSitemaps = new Set();
  let foundXml = false;
  let requestBudgetReached = false;
  let sitemapReadError = false;

  while (
    sitemapQueue.length &&
    seenSitemaps.size < MAX_SITEMAP_DOCUMENTS &&
    urls.length < MAX_SITEMAP_URLS
  ) {
    const candidate = sitemapQueue.shift();
    if (seenSitemaps.has(candidate)) continue;
    seenSitemaps.add(candidate);
    const result = await safeRequest(candidate, {
      requestClass: "sitemap",
      rootOrigin,
      budget,
      fetchImpl,
      validateUrl,
    });

    if (
      result.response?.status === 200 &&
      (result.response.headers.get("content-type") || "")
        .toLowerCase()
        .includes("xml")
    ) {
      foundXml = true;
      let text;
      try {
        ({ text } = await readLimitedText(result.response));
      } catch {
        sitemapReadError = true;
        await cancelRequest(result);
        continue;
      } finally {
        result.cleanup?.();
      }
      const $ = cheerio.load(text, { xmlMode: true });

      $("url > loc").each((_, element) => {
        if (urls.length >= MAX_SITEMAP_URLS) return false;
        try {
          const parsed = new URL($(element).text().trim());
          if (isSameSiteOrigin(parsed.origin, rootOrigin)) {
            urls.push(normalizeUrl(parsed.href));
          }
        } catch {
          // Invalid sitemap entries are ignored.
        }
      });
      $("sitemap > loc").each((_, element) => {
        if (sitemapQueue.length + seenSitemaps.size >= MAX_SITEMAP_DOCUMENTS) {
          return false;
        }
        try {
          const parsed = new URL($(element).text().trim());
          if (
            isSameSiteOrigin(parsed.origin, rootOrigin) &&
            !seenSitemaps.has(normalizeUrl(parsed.href))
          ) {
            sitemapQueue.push(normalizeUrl(parsed.href));
          }
        } catch {
          // Invalid sitemap-index entries are ignored.
        }
      });
      if (urls.length >= MAX_SITEMAP_URLS) break;
      continue;
    }

    await cancelRequest(result);
    sitemapReadError ||= Boolean(result.error && !result.budgetReached);
    if (result.budgetReached) {
      requestBudgetReached = true;
      break;
    }
  }

  return {
    urls: [...new Set(urls)],
    foundXml,
    sitemapReadError,
    sitemapLimitReached:
      urls.length >= MAX_SITEMAP_URLS ||
      sitemapQueue.length > 0 ||
      seenSitemaps.size >= MAX_SITEMAP_DOCUMENTS,
    requestBudgetReached:
      requestBudgetReached ||
      budget.requests >= MAX_TOTAL_REQUESTS_PER_SCAN,
  };
}

async function probeSensitiveFiles(
  baseUrl,
  { rootOrigin, budget, fetchImpl, validateUrl },
) {
  const findings = [];
  let complete = true;

  for (const path of SENSITIVE_PATHS) {
    const url = new URL(path, baseUrl).href;
    let result = await safeRequest(url, {
      requestClass: "sensitive",
      rootOrigin,
      budget,
      fetchImpl,
      validateUrl,
      method: "HEAD",
    });

    if (!result.requestsMade && result.budgetReached) {
      complete = false;
      break;
    }

    if (result.response?.status === 405) {
      await cancelRequest(result);
      result = await safeRequest(url, {
        requestClass: "sensitive",
        rootOrigin,
        budget,
        fetchImpl,
        validateUrl,
      });
    }

    if (!result.response) {
      if (result.budgetReached) complete = false;
      continue;
    }

    const status = result.response.status;
    await cancelRequest(result);
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
  }

  return { findings, complete };
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

export async function crawlIntegrityWebsite(
  website,
  config,
  {
    fetchImpl = fetch,
    validateUrl,
  } = {},
) {
  if (typeof validateUrl !== "function") {
    throw new Error("La validation SSRF des URL doit être fournie au crawler.");
  }

  const base = await validateUrl(website.url);
  const baseUrl = new URL(base).href;
  const rootOrigin = new URL(baseUrl).origin;
  const localePrefixes = new Set(
    (Array.isArray(config.locale_prefixes) ? config.locale_prefixes : [])
      .filter((locale) => typeof locale === "string")
      .map((locale) => locale.trim().toLowerCase())
      .filter(Boolean),
  );
  const configuredDefault =
    typeof config.default_locale === "string"
      ? config.default_locale.trim().toLowerCase()
      : "";
  const defaultLocale = localePrefixes.has(configuredDefault)
    ? configuredDefault
    : "";
  const maxPages = limitFromConfig(config.max_pages, MAX_PAGES_PER_SCAN);
  const maxLinks = limitFromConfig(config.max_links_per_page, MAX_LINKS_PER_PAGE);
  const budget = createRequestBudget();
  const findings = [];
  const requestedUrls = new Set();
  const visitedPages = new Set();
  const discoveredInternal = new Set();
  const discoveredExternal = new Set();
  const internalQueue = [];
  const sitemapQueue = [];
  let pagesChecked = 0;
  let pagesScheduled = 0;
  let linksChecked = 0;
  let htmlPages = 0;
  let failedPageRequests = 0;
  let pageLimitReached = false;
  let linkBudgetReached = false;
  let requestBudgetReached = false;
  let extractionLimitReached = false;
  let sitemapLimitReached = false;

  const enqueuePage = (value, queue) => {
    try {
      const normalized = normalizeUrl(value);
      const parsed = new URL(normalized);
      if (
        !isSameSiteOrigin(parsed.origin, rootOrigin) ||
        visitedPages.has(normalized) ||
        internalQueue.includes(normalized) ||
        sitemapQueue.includes(normalized)
      ) {
        return;
      }
      queue.push(normalized);
    } catch {
      // Invalid or off-site paths are not queued.
    }
  };

  const addDiscoveredLinks = (links) => {
    extractionLimitReached ||= links.extractionLimitReached;
    for (const link of links.internal) {
      if (!discoveredInternal.has(link)) {
        discoveredInternal.add(link);
        internalQueue.push(link);
      }
    }
    for (const link of links.external) discoveredExternal.add(link);
  };

  const inspectPage = async (
    url,
    { linked = false, explorePage = true } = {},
  ) => {
    const result = await safeRequest(url, {
      requestClass: linked ? "link" : "page",
      rootOrigin,
      budget,
      fetchImpl,
      validateUrl,
    });

    for (const item of collectResponseFindings(result, {
      rootOrigin,
      localePrefixes,
      defaultLocale,
      category: linked ? "broken_link" : "page_error",
      targetUrl: url,
    })) {
      findings.push(item);
    }

    if (linked && result.requestsMade > 0) linksChecked += 1;
    if (result.requestsMade > 0) requestedUrls.add(normalizeUrl(url));
    if (result.error || !result.response || result.response.status >= 400) {
      if (!linked && result.requestsMade > 0) failedPageRequests += 1;
      await cancelRequest(result);
      return {
        links: null,
        requestsMade: result.requestsMade,
        budgetReached: result.budgetReached,
      };
    }

    if (!explorePage) {
      await cancelRequest(result);
      return {
        links: null,
        requestsMade: result.requestsMade,
        budgetReached: result.budgetReached,
      };
    }

    const parsed = await parsePageResponse(result, {
      url,
      rootOrigin,
      maxLinks,
    });
    if (parsed.readError) {
      findings.push(
        finding(
          linked ? "broken_link" : "page_error",
          "high",
          url,
          `Impossible de lire la réponse HTTP : ${parsed.readError}`,
          null,
        ),
      );
    }
    if (!parsed.htmlAvailable) {
      await cancelBody(result.response);
      return {
        links: null,
        requestsMade: result.requestsMade,
        budgetReached: result.budgetReached,
      };
    }

    htmlPages += 1;
    addDiscoveredLinks(parsed.links);
    return {
      links: parsed.links,
      requestsMade: result.requestsMade,
      budgetReached: result.budgetReached,
    };
  };

  const initialPaths = Array.isArray(config.important_paths)
    ? config.important_paths
    : [];
  for (const path of initialPaths.slice(0, maxPages)) {
    try {
      enqueuePage(new URL(path, baseUrl).href, sitemapQueue);
    } catch {
      // Invalid configured paths do not prevent scanning other pages.
    }
  }
  enqueuePage(baseUrl, sitemapQueue);
  if (initialPaths.length > maxPages) pageLimitReached = true;

  const priorityPages = [...sitemapQueue];
  sitemapQueue.length = 0;
  for (const url of priorityPages) {
    if (pagesScheduled >= maxPages) {
      pageLimitReached = true;
      break;
    }
    if (visitedPages.has(url)) continue;
    visitedPages.add(url);
    pagesScheduled += 1;
    const result = await inspectPage(url);
    if (result.requestsMade > 0) {
      pagesChecked += 1;
    } else {
      pagesScheduled -= 1;
      visitedPages.delete(url);
    }
    if (result.budgetReached) requestBudgetReached = true;
  }

  const sitemap = await discoverSitemap(baseUrl, {
    rootOrigin,
    budget,
    fetchImpl,
    validateUrl,
  });
  for (const url of sitemap.urls) {
    if (sitemapQueue.length >= MAX_SITEMAP_URLS) {
      sitemapLimitReached = true;
      break;
    }
    enqueuePage(url, sitemapQueue);
  }
  sitemapLimitReached ||= sitemap.sitemapLimitReached;
  requestBudgetReached ||= sitemap.requestBudgetReached;

  while (internalQueue.length || sitemapQueue.length) {
    const linked = internalQueue.length > 0;
    if (!linked && pagesScheduled >= maxPages) {
      pageLimitReached = true;
      break;
    }
    const queue = linked ? internalQueue : sitemapQueue;
    const batch = [];
    while (
      queue.length &&
      batch.length < MAX_CONCURRENT_LINK_REQUESTS
    ) {
      const candidate = queue.shift();
      if (!candidate) continue;
      if (visitedPages.has(candidate)) {
        if (linked && requestedUrls.has(candidate)) linksChecked += 1;
        continue;
      }
      batch.push(candidate);
    }
    if (!batch.length) break;

    const results = await mapConcurrent(batch, MAX_CONCURRENT_LINK_REQUESTS, async (url) => {
      const shouldCrawlPage = pagesScheduled < maxPages;
      if (shouldCrawlPage) {
        visitedPages.add(url);
        pagesScheduled += 1;
      } else {
        pageLimitReached = true;
      }
      const wasAlreadyRequested = requestedUrls.has(url);
      if (wasAlreadyRequested) {
        if (linked) linksChecked += 1;
        return {
          url,
          links: null,
          alreadyRequested: true,
          requestStarted: true,
        };
      }

      const result = await inspectPage(url, {
        linked,
        explorePage: shouldCrawlPage,
      });
      if (shouldCrawlPage && result.requestsMade > 0) {
        pagesChecked += 1;
      } else if (shouldCrawlPage) {
        pagesScheduled -= 1;
        visitedPages.delete(url);
      }
      return {
        url,
        ...result,
        alreadyRequested: false,
        requestStarted: result.requestsMade > 0,
      };
    });

    if (results.some((result) => result.budgetReached)) {
      requestBudgetReached = true;
    }

    if (
      linked &&
      budget.linkRequests >= MAX_LINK_REQUESTS_PER_SCAN &&
      internalQueue.length
    ) {
      linkBudgetReached = true;
      requestBudgetReached ||= budget.requests >= MAX_TOTAL_REQUESTS_PER_SCAN;
      break;
    }

    if (budget.requests >= MAX_TOTAL_REQUESTS_PER_SCAN) {
      requestBudgetReached = true;
      break;
    }
  }

  if (
    pagesScheduled >= maxPages &&
    (internalQueue.length || sitemapQueue.length)
  ) {
    pageLimitReached = true;
  }

  const sensitive = await probeSensitiveFiles(baseUrl, {
    rootOrigin,
    budget,
    fetchImpl,
    validateUrl,
  });
  findings.push(...sensitive.findings);
  requestBudgetReached ||= !sensitive.complete;

  if (internalQueue.length && budget.linkRequests >= MAX_LINK_REQUESTS_PER_SCAN) {
    linkBudgetReached = true;
  }

  let resultReason = null;
  if (linkBudgetReached) {
    resultReason = "link_check_budget_reached";
  } else if (requestBudgetReached) {
    resultReason = "request_budget_reached";
  } else if (sitemapLimitReached) {
    resultReason = "sitemap_limit_reached";
  } else if (pageLimitReached) {
    resultReason = "page_limit_reached";
  } else if (pagesChecked > 0 && failedPageRequests === pagesChecked) {
    resultReason = "site_unreachable";
  } else if (htmlPages === 0) {
    resultReason = "html_unavailable";
  } else if (sitemap.sitemapReadError) {
    resultReason = "sitemap_unavailable";
  } else if (discoveredInternal.size === 0) {
    resultReason = "no_internal_links_found";
  } else if (extractionLimitReached) {
    resultReason = "per_page_link_limit_reached";
  }

  return {
    pagesChecked,
    linksDiscovered: discoveredInternal.size,
    externalLinksDiscovered: discoveredExternal.size,
    linksChecked,
    findings: uniqueFindings(findings),
    findingsCount: uniqueFindings(findings).length,
    resultReason,
    requestsUsed: budget.requests,
    linkRequestsUsed: budget.linkRequests,
  };
}
