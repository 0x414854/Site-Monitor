export function checkSecurityHeaders(headers, isHttps) {
  const get = (name) => headers.get(name);

  const hsts = get("strict-transport-security");
  const csp = get("content-security-policy");
  const contentTypeOptions = get("x-content-type-options");
  const xFrameOptions = get("x-frame-options");

  const cspHasFrameAncestors =
    typeof csp === "string" && /(?:^|;)\s*frame-ancestors(?:\s|;|$)/i.test(csp);

  const xFrameOptionsValid =
    typeof xFrameOptions === "string" &&
    /^\s*(DENY|SAMEORIGIN)\s*$/i.test(xFrameOptions);

  const checks = [
    {
      key: "hsts",
      label: "HSTS",
      present: Boolean(isHttps && hsts),
      recommendation: isHttps
        ? "Configurer Strict-Transport-Security avec une durée max-age adaptée."
        : "Activer HTTPS avant de configurer HSTS.",
    },
    {
      key: "csp",
      label: "Content-Security-Policy",
      present: Boolean(csp),
      recommendation:
        "Définir une CSP adaptée aux ressources réellement utilisées par le site.",
    },
    {
      key: "nosniff",
      label: "X-Content-Type-Options",
      present: /^\s*nosniff\s*$/i.test(contentTypeOptions || ""),
      recommendation: "Ajouter X-Content-Type-Options: nosniff.",
    },
    {
      key: "iframe",
      label: "Protection contre l'intégration en iframe",
      present: Boolean(cspHasFrameAncestors || xFrameOptionsValid),
      recommendation:
        "Configurer frame-ancestors dans la CSP ou X-Frame-Options selon les besoins du site.",
    },
  ];

  const passed = checks.filter((check) => check.present).length;

  return {
    https_used: Boolean(isHttps),
    hsts_present: checks[0].present,
    csp_present: checks[1].present,
    nosniff_present: checks[2].present,
    iframe_protection_present: checks[3].present,
    security_score: Math.round((passed / checks.length) * 100),
    findings: checks.map((check) => ({
      key: check.key,
      label: check.label,
      status: check.present ? "ok" : "missing",
      recommendation: check.present ? null : check.recommendation,
    })),
  };
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

export function checkSecurityHeaders(headers, isHttps) {
  const get = (name) => headers.get(name);

  const hsts = get("strict-transport-security");
  const csp = get("content-security-policy");
  const contentTypeOptions = get("x-content-type-options");
  const xFrameOptions = get("x-frame-options");

  const hstsMaxAge = hsts?.match(/(?:^|;)\s*max-age\s*=\s*(\d+)/i);
  const hstsValid =
    Boolean(isHttps) && Boolean(hstsMaxAge) && Number(hstsMaxAge?.[1]) > 0;

  const cspHasFrameAncestors =
    typeof csp === "string" && /(?:^|;)\s*frame-ancestors(?:\s|;|$)/i.test(csp);

  const xFrameOptionsValid =
    typeof xFrameOptions === "string" &&
    /^\s*(DENY|SAMEORIGIN)\s*$/i.test(xFrameOptions);

  const checks = [
    {
      key: "hsts",
      label: "HSTS",
      present: hstsValid,
      value: hsts || null,
      recommendation: isHttps
        ? "Configurer Strict-Transport-Security avec un max-age adapté."
        : "Activer HTTPS avant de configurer HSTS.",
    },
    {
      key: "csp",
      label: "Content-Security-Policy",
      present: Boolean(csp?.trim()),
      value: csp || null,
      recommendation: "Définir une CSP adaptée aux ressources du site.",
    },
    {
      key: "nosniff",
      label: "X-Content-Type-Options",
      present: /^\s*nosniff\s*$/i.test(contentTypeOptions || ""),
      value: contentTypeOptions || null,
      recommendation: "Ajouter X-Content-Type-Options: nosniff.",
    },
    {
      key: "iframe",
      label: "Protection contre les iframes",
      present: Boolean(cspHasFrameAncestors || xFrameOptionsValid),
      value:
        [
          cspHasFrameAncestors ? "CSP frame-ancestors" : null,
          xFrameOptionsValid ? `X-Frame-Options: ${xFrameOptions}` : null,
        ]
          .filter(Boolean)
          .join(" ; ") || null,
      recommendation:
        "Configurer frame-ancestors dans la CSP ou X-Frame-Options selon les besoins.",
    },
  ];

  const cookieFindings = getSetCookieHeaders(headers).map((cookie, index) => {
    const parts = cookie.split(";");
    const name = parts[0]?.split("=")[0]?.trim() || `Cookie ${index + 1}`;
    const attributes = parts.slice(1).map((part) => part.trim());

    const secure = attributes.some((a) => /^secure$/i.test(a));
    const httpOnly = attributes.some((a) => /^httponly$/i.test(a));
    const sameSiteAttribute = attributes.find((a) => /^samesite=/i.test(a));

    return {
      name,
      secure,
      httpOnly,
      sameSite: sameSiteAttribute?.split("=")[1]?.trim() || null,
      issues: [
        ...(!secure ? ["Attribut Secure absent"] : []),
        ...(!httpOnly ? ["Attribut HttpOnly absent"] : []),
        ...(!sameSiteAttribute ? ["Attribut SameSite absent"] : []),
      ],
    };
  });

  const passed = checks.filter((check) => check.present).length;

  return {
    https_used: Boolean(isHttps),
    hsts_present: checks[0].present,
    csp_present: checks[1].present,
    nosniff_present: checks[2].present,
    iframe_protection_present: checks[3].present,
    cookies_checked: true,
    cookie_findings: cookieFindings,
    security_score: Math.round((passed / checks.length) * 100),
    findings: checks.map((check) => ({
      key: check.key,
      label: check.label,
      status: check.present ? "ok" : "missing",
      value: check.value,
      recommendation: check.present ? null : check.recommendation,
    })),
  };
}
