import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_LINK_REQUESTS_PER_SCAN,
  MAX_PAGES_PER_SCAN,
  crawlIntegrityWebsite,
} from "../utils/monitor/integrity-crawler.js";
import { persistIntegrityFindings } from "../utils/monitor/integrity-persistence.js";
import { validatePublicUrl } from "../utils/monitor/validate-url.js";

const baseUrl = "https://example.test/";

function html(body = "") {
  return new Response(`<html><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

function makeHarness(routes = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    requests.push({ url: parsed.href, method: init.method });
    const handler = routes[`${init.method} ${parsed.origin}${parsed.pathname}`] ||
      routes[`${init.method} ${parsed.origin}${parsed.pathname}${parsed.search}`] ||
      routes[parsed.href] ||
      routes[parsed.pathname];
    return handler
      ? handler(parsed, init)
      : notFound();
  };
  const validateUrl = async (value) => {
    const parsed = new URL(value);
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".localhost") ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname.startsWith("10.")
    ) {
      throw new Error("Adresse privée interdite");
    }
    return parsed.href;
  };

  return {
    requests,
    scan: (config = {}) =>
      crawlIntegrityWebsite(
        { id: "website-1", url: baseUrl },
        {
          important_paths: [],
          max_pages: 5,
          max_links_per_page: 50,
          locale_prefixes: [],
          default_locale: "",
          ...config,
        },
        { fetchImpl, validateUrl },
      ),
  };
}

test("un site inaccessible termine avec une raison et un code HTTP nul", async () => {
  const harness = makeHarness({
    "/": () => {
      throw new Error("ECONNREFUSED");
    },
  });

  const result = await harness.scan();
  const pageError = result.findings.find(
    (item) => item.category === "page_error",
  );

  assert.equal(result.pagesChecked, 1);
  assert.equal(result.resultReason, "site_unreachable");
  assert.equal(pageError.status_code, null);
  assert.match(pageError.message, /ECONNREFUSED/);
});

test("une page HTML sans liens reste un scan valide et explicite", async () => {
  const { scan } = makeHarness({ "/": () => html() });

  const result = await scan();

  assert.equal(result.pagesChecked, 1);
  assert.equal(result.linksDiscovered, 0);
  assert.equal(result.linksChecked, 0);
  assert.equal(result.resultReason, "no_internal_links_found");
});

test("un lien interne fonctionnel est découvert et vérifié par HTTP", async () => {
  const harness = makeHarness({
    "/": () => html('<a href="/ok">ok</a>'),
    "/ok": () => html(),
  });

  const result = await harness.scan();

  assert.equal(result.linksDiscovered, 1);
  assert.equal(result.linksChecked, 1);
  assert.equal(
    harness.requests.filter((item) => new URL(item.url).pathname === "/ok")
      .length,
    1,
  );
});

test("les liens externes sont comptés séparément sans être suivis", async () => {
  const harness = makeHarness({
    "/": () =>
      html('<a href="https://external.test/health">external</a>'),
  });

  const result = await harness.scan();

  assert.equal(result.linksDiscovered, 0);
  assert.equal(result.externalLinksDiscovered, 1);
  assert.equal(result.linksChecked, 0);
  assert.equal(
    harness.requests.some((item) => item.url.includes("external.test")),
    false,
  );
});

test("un lien interne HTTP 404 est enregistré comme lien cassé", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/missing">missing</a>'),
  });

  const result = await scan();
  const finding = result.findings.find(
    (item) => item.category === "broken_link",
  );

  assert.equal(finding.status_code, 404);
  assert.match(finding.message, /HTTP 404/);
});

test("une erreur réseau sur un lien ne devient pas un faux code HTTP", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/offline">offline</a>'),
    "/offline": () => {
      throw new Error("Connexion réinitialisée");
    },
  });

  const result = await scan();
  const finding = result.findings.find(
    (item) => item.category === "broken_link",
  );

  assert.equal(finding.status_code, null);
  assert.match(finding.message, /Connexion réinitialisée/);
});

test("une redirection canonique www valide n’est pas signalée", async () => {
  const { scan } = makeHarness({
    "/": () =>
      new Response(null, {
        status: 301,
        headers: { location: "https://www.example.test/" },
      }),
    "https://www.example.test/": () => html(),
  });

  const result = await scan();

  assert.equal(result.pagesChecked, 1);
  assert.equal(
    result.findings.some((item) => item.category === "redirect"),
    false,
  );
});

test("une redirection interne non canonique est signalée", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/old">old</a>'),
    "/old": () =>
      new Response(null, {
        status: 302,
        headers: { location: "/new" },
      }),
    "/new": () => html(),
  });

  const result = await scan();

  assert.equal(
    result.findings.some(
      (item) => item.category === "redirect" && item.url.endsWith("/old"),
    ),
    true,
  );
});

test("une boucle de redirection est arrêtée", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/loop-a">loop</a>'),
    "/loop-a": () =>
      new Response(null, {
        status: 302,
        headers: { location: "/loop-b" },
      }),
    "/loop-b": () =>
      new Response(null, {
        status: 302,
        headers: { location: "/loop-a" },
      }),
  });

  const result = await scan();
  const finding = result.findings.find(
    (item) =>
      item.category === "redirect" && item.message.includes("Boucle"),
  );

  assert.ok(finding);
  assert.equal(finding.status_code, 302);
});

test("une réponse 3xx sans Location est signalée comme redirection", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/no-location">link</a>'),
    "/no-location": () => new Response(null, { status: 301 }),
  });

  const result = await scan();
  const finding = result.findings.find(
    (item) => item.category === "redirect",
  );

  assert.equal(finding.status_code, 301);
  assert.match(finding.message, /sans destination/);
});

test("les doublons et fragments sont normalisés", async () => {
  const harness = makeHarness({
    "/": () =>
      html(
        '<a href="/same#one">one</a><a href="/same#two">two</a><a href="/same">same</a>',
      ),
    "/same": () => html(),
  });

  const result = await harness.scan();

  assert.equal(result.linksDiscovered, 1);
  assert.equal(result.linksChecked, 1);
});

test("une redirection vers une langue configurée est acceptée", async () => {
  const { scan } = makeHarness({
    "/": () =>
      new Response(null, {
        status: 302,
        headers: { location: "/fr" },
      }),
    "/fr": () => html(),
  });

  const result = await scan({
    locale_prefixes: ["fr", "en"],
    default_locale: "fr",
  });

  assert.equal(
    result.findings.some((item) => item.category === "redirect"),
    false,
  );
});

test("un sitemap volumineux est borné et signalé", async () => {
  const entries = Array.from(
    { length: 1001 },
    (_, index) => `<url><loc>https://example.test/page-${index}</loc></url>`,
  ).join("");
  const { scan } = makeHarness({
    "/": () => html(),
    "/sitemap.xml": () =>
      new Response(`<urlset>${entries}</urlset>`, {
        headers: { "content-type": "application/xml" },
      }),
  });

  const result = await scan({ max_pages: 1 });

  assert.equal(result.pagesChecked, 1);
  assert.equal(result.resultReason, "sitemap_limit_reached");
  assert.equal(result.requestsUsed <= 400, true);
});

test("les limites de pages et de vérifications sont réellement appliquées", async () => {
  const links = Array.from(
    { length: 50 },
    (_, index) => `<a href="/page-${index}">page</a>`,
  ).join("");
  const routes = {
    "/": () => html(links),
  };
  for (let index = 0; index < 50; index += 1) {
    const childLinks = Array.from(
      { length: 5 },
      (_, child) =>
        `<a href="/child-${index}-${child}">child</a>`,
    ).join("");
    routes[`/page-${index}`] = () => html(childLinks);
  }
  const harness = makeHarness(routes);

  const result = await harness.scan({ max_pages: MAX_PAGES_PER_SCAN });
  const requestedLinkDestinations = harness.requests.filter(
    ({ url }) =>
      new URL(url).pathname.startsWith("/page-") ||
      new URL(url).pathname.startsWith("/child-"),
  );

  assert.equal(result.pagesChecked <= MAX_PAGES_PER_SCAN, true);
  assert.equal(result.linksChecked <= MAX_LINK_REQUESTS_PER_SCAN, true);
  assert.equal(result.requestsUsed <= 400, true);
  assert.equal(
    requestedLinkDestinations.length <= MAX_LINK_REQUESTS_PER_SCAN,
    true,
  );
  assert.equal(result.resultReason, "link_check_budget_reached");
});

test("un site multilingue garde les pages découvertes dans son périmètre", async () => {
  const { scan } = makeHarness({
    "/": () => html('<a href="/fr/contact">contact</a>'),
    "/fr/contact": () => html('<a href="/fr/about">about</a>'),
    "/fr/about": () => html(),
  });

  const result = await scan({
    locale_prefixes: ["fr", "en"],
    default_locale: "fr",
  });

  assert.equal(result.linksDiscovered, 2);
  assert.equal(result.linksChecked, 2);
});

test("une redirection vers une destination privée est bloquée avant le fetch", async () => {
  const harness = makeHarness({
    "/": () => html('<a href="/redirect">redirect</a>'),
    "/redirect": () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
  });

  const result = await harness.scan();
  const finding = result.findings.find(
    (item) => item.category === "redirect",
  );

  assert.equal(finding.status_code, 302);
  assert.equal(
    harness.requests.some((item) => item.url.startsWith("http://127.0.0.1")),
    false,
  );
});

test("la validation SSRF réelle rejette les IP locales et les métadonnées", async () => {
  await assert.rejects(
    validatePublicUrl("http://127.0.0.1/private"),
    /privée ou réservée/i,
  );
  await assert.rejects(
    validatePublicUrl("http://169.254.169.254/latest/meta-data"),
    /privée ou réservée/i,
  );
});

test("le timeout reste actif pendant la lecture du corps", async () => {
  const { scan } = makeHarness({
    "/": (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => {
              controller.error(
                new DOMException("The operation was aborted", "AbortError"),
              );
            });
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
  });

  const result = await scan();
  const timeoutFinding = result.findings.find(
    (item) => item.category === "page_error",
  );

  assert.equal(timeoutFinding.status_code, null);
  assert.match(timeoutFinding.message, /Impossible de lire la réponse HTTP/);
  assert.equal(result.resultReason, "html_unavailable");
});

test("les résultats sensibles sont conservés", async () => {
  const { scan } = makeHarness({
    "/": () => html(),
    "HEAD https://example.test/.env": () =>
      new Response(null, { status: 200 }),
  });

  const result = await scan();

  assert.equal(
    result.findings.some((item) => item.category === "sensitive_file"),
    true,
  );
});

test("une erreur Supabase de persistance est propagée avec le scan_id", async () => {
  let insertedRows;
  const supabase = {
    from(table) {
      assert.equal(table, "website_integrity_findings");
      return {
        insert(rows) {
          insertedRows = rows;
          return {
            select: async () => ({
              data: null,
              error: { message: "write rejected" },
            }),
          };
        },
      };
    },
  };

  await assert.rejects(
    persistIntegrityFindings(
      supabase,
      "scan-123",
      [{ category: "page_error", url: baseUrl }],
    ),
    /write rejected/,
  );
  assert.equal(insertedRows[0].scan_id, "scan-123");
});
