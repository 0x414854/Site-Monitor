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
    Boolean(isHttps) && Boolean(hstsMaxAge) && Number(hstsMaxAge[1]) > 0;

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
      recommendation:
        "Définir une CSP adaptée aux ressources réellement utilisées par le site.",
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
        "Configurer frame-ancestors dans la CSP ou X-Frame-Options selon les besoins du site.",
    },
  ];

  const cookieFindings = getSetCookieHeaders(headers).map((cookie, index) => {
    const parts = cookie.split(";");
    const name = parts[0]?.split("=")[0]?.trim() || `Cookie ${index + 1}`;
    const attributes = parts.slice(1).map((part) => part.trim());

    const secure = attributes.some((a) => /^secure$/i.test(a));
    const httpOnly = attributes.some((a) => /^httponly$/i.test(a));

    const sameSiteAttribute = attributes.find((a) => /^samesite\s*=/i.test(a));

    const sameSiteValue = sameSiteAttribute
      ?.split("=")
      .slice(1)
      .join("=")
      .trim();

    const sameSite = ["strict", "lax", "none"].includes(
      (sameSiteValue || "").toLowerCase(),
    )
      ? sameSiteValue
      : null;

    const issues = [
      ...(!secure ? ["Attribut Secure absent"] : []),
      ...(!httpOnly ? ["Attribut HttpOnly absent"] : []),
      ...(!sameSite ? ["Attribut SameSite absent ou invalide"] : []),
      ...(sameSite?.toLowerCase() === "none" && !secure
        ? ["SameSite=None nécessite Secure"]
        : []),
    ];

    return {
      name,
      secure,
      httpOnly,
      sameSite,
      issues,
    };
  });

  const passedHeaders = checks.filter((check) => check.present).length;
  const headerScore = (passedHeaders / checks.length) * 100;

  // Les cookies ne pénalisent pas les sites qui n'en définissent pas.
  // Lorsqu'il y a des cookies, le score combine headers et attributs des cookies.
  const cookieCount = cookieFindings.length;
  const cookieAttributesChecked = cookieCount * 3;
  const cookieAttributesPassed = cookieFindings.reduce(
    (total, cookie) =>
      total +
      Number(cookie.secure) +
      Number(cookie.httpOnly) +
      Number(Boolean(cookie.sameSite)),
    0,
  );

  const cookieScore =
    cookieAttributesChecked > 0
      ? (cookieAttributesPassed / cookieAttributesChecked) * 100
      : null;

  const securityScore =
    cookieScore === null ? headerScore : headerScore * 0.7 + cookieScore * 0.3;

  return {
    https_used: Boolean(isHttps),
    hsts_present: checks[0].present,
    csp_present: checks[1].present,
    nosniff_present: checks[2].present,
    iframe_protection_present: checks[3].present,

    cookies_checked: true,
    cookies_found: cookieCount,
    cookie_findings: cookieFindings,
    cookie_score: cookieScore === null ? null : Math.round(cookieScore),

    security_score: Math.round(securityScore),

    findings: checks.map((check) => ({
      key: check.key,
      label: check.label,
      status: check.present ? "ok" : "missing",
      value: check.value,
      recommendation: check.present ? null : check.recommendation,
    })),
  };
}
