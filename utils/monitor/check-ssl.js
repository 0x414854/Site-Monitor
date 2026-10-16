import tls from "node:tls";
import { validatePublicUrl } from "@/utils/monitor/validate-url";

const TLS_TIMEOUT_MS = 8000;

function inspectCertificate(hostname, port = 443) {
  return new Promise((resolve) => {
    let finished = false;

    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: false,
      timeout: TLS_TIMEOUT_MS,
    });

    function finish(result) {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(TLS_TIMEOUT_MS, () => {
      finish({
        https_reachable: false,
        certificate_valid: false,
        hostname_match: null,
        certificate_expires_at: null,
        error_message: "Délai de connexion TLS dépassé",
      });
    });

    socket.once("error", (error) => {
      finish({
        https_reachable: false,
        certificate_valid: false,
        hostname_match: null,
        certificate_expires_at: null,
        error_message: error.message || "Échec de la connexion TLS",
      });
    });

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const now = Date.now();
      const expiresAt = cert?.valid_to ? new Date(cert.valid_to) : null;
      const validFrom = cert?.valid_from
        ? new Date(cert.valid_from).getTime()
        : NaN;
      const expiry = expiresAt?.getTime();

      const dateValid =
        Number.isFinite(validFrom) &&
        Number.isFinite(expiry) &&
        now >= validFrom &&
        now <= expiry;

      const hostnameError =
        cert && Object.keys(cert).length
          ? tls.checkServerIdentity(hostname, cert)
          : new Error("Certificat non disponible");

      const hostnameMatch = !hostnameError;
      const trusted = socket.authorized;
      const certificateValid = Boolean(trusted && dateValid && hostnameMatch);

      const errors = [];

      if (!trusted) {
        errors.push(
          `Chaîne de confiance invalide : ${
            socket.authorizationError || "inconnue"
          }`,
        );
      }

      if (!dateValid) {
        errors.push("Certificat expiré ou pas encore valide");
      }

      if (!hostnameMatch) {
        errors.push("Le certificat ne correspond pas au domaine");
      }

      finish({
        https_reachable: true,
        certificate_valid: certificateValid,
        hostname_match: hostnameMatch,
        certificate_expires_at: Number.isFinite(expiry)
          ? expiresAt.toISOString()
          : null,
        error_message: errors.length ? errors.join(" ; ") : null,
      });
    });
  });
}

// async function checkHttpRedirect(siteUrl) {
//   try {
//     const parsed = new URL(siteUrl);

//     if (parsed.protocol !== "http:") {
//       return {
//         http_redirects_to_https: null,
//         error: null,
//       };
//     }

//     const httpUrl = await validatePublicUrl(parsed.toString());

//     const response = await fetch(httpUrl.toString(), {
//       method: "GET",
//       redirect: "manual",
//       signal: AbortSignal.timeout(TLS_TIMEOUT_MS),
//       headers: { "User-Agent": "SiteMonitor/1.0" },
//     });

//     const location = response.headers.get("location");
//     await response.body?.cancel().catch(() => {});

//     if (![301, 302, 303, 307, 308].includes(response.status)) {
//       return {
//         http_redirects_to_https: false,
//         error: null,
//       };
//     }

//     if (!location) {
//       return {
//         http_redirects_to_https: false,
//         error: "Redirection sans destination",
//       };
//     }

//     const destination = await validatePublicUrl(
//       new URL(location, httpUrl).toString(),
//     );

//     return {
//       http_redirects_to_https: destination.protocol === "https:",
//       error: null,
//     };
//   } catch (error) {
//     return {
//       http_redirects_to_https: false,
//       error:
//         error instanceof Error
//           ? error.message
//           : "Échec de la vérification HTTP",
//     };
//   }
// }

async function checkHttpRedirect(siteUrl) {
  try {
    const parsed = new URL(siteUrl);

    // Tester la version HTTP du même domaine.
    parsed.protocol = "http:";

    if (parsed.port === "443") {
      parsed.port = "";
    }

    const httpUrl = await validatePublicUrl(parsed.toString());

    const response = await fetch(httpUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TLS_TIMEOUT_MS),
      headers: { "User-Agent": "SiteMonitor/1.0" },
    });

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return {
        http_redirects_to_https: false,
        error: null,
      };
    }

    if (!location) {
      return {
        http_redirects_to_https: false,
        error: "Redirection sans destination",
      };
    }

    const destination = await validatePublicUrl(
      new URL(location, httpUrl).toString(),
    );

    return {
      http_redirects_to_https: destination.protocol === "https:",
      error: null,
    };
  } catch (error) {
    return {
      http_redirects_to_https: false,
      error:
        error instanceof Error
          ? error.message
          : "Échec de la vérification HTTP",
    };
  }
}

export async function checkSsl(siteUrl) {
  try {
    const validatedUrl = await validatePublicUrl(siteUrl);
    const hostname = validatedUrl.hostname;

    const certificate = await inspectCertificate(
      hostname,
      validatedUrl.port ? Number(validatedUrl.port) : 443,
    );

    const redirect = await checkHttpRedirect(siteUrl);

    return {
      ...certificate,
      ...redirect,
      error_message:
        [certificate.error_message, redirect.error]
          .filter(Boolean)
          .join(" ; ") || null,
    };
  } catch (error) {
    return {
      https_reachable: false,
      certificate_valid: false,
      hostname_match: null,
      certificate_expires_at: null,
      http_redirects_to_https: null,
      error_message:
        error instanceof Error ? error.message : "Échec du contrôle SSL",
    };
  }
}
