import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { validatePublicUrl } from "@/utils/monitor/validate-url";
import { checkSsl } from "@/utils/monitor/check-ssl";
import { checkSecurityHeaders } from "@/utils/monitor/checkSecurityHeaders";
import { checkDnsAndDomain } from "@/utils/monitor/checkDnsDomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 5;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Envoie une alerte lorsque le certificat SSL approche de son expiration.
 * La table website_ssl_alerts empêche les doublons.
 */
async function sendSslExpirationAlert(site, sslResult) {
  const expiresAt = sslResult?.certificate_expires_at;
  const recipient = site.notification_email;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!expiresAt || !recipient) {
    return { sent: false, reason: "missing_expiry_or_recipient" };
  }

  if (!apiKey || !from) {
    console.error(`[SSL] Configuration Resend manquante pour ${site.url}`);
    return { sent: false, reason: "missing_email_configuration" };
  }

  const expiryTimestamp = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiryTimestamp)) {
    console.error(`[SSL] Date d'expiration invalide pour ${site.url}`);
    return { sent: false, reason: "invalid_expiry_date" };
  }

  const now = Date.now();
  const millisecondsLeft = expiryTimestamp - now;
  const daysLeft = millisecondsLeft / DAY_MS;

  let alertType;
  let alertLabel;

  if (daysLeft <= 0) {
    alertType = "expired";
    alertLabel = "Certificat SSL expiré";
  } else if (daysLeft <= 1) {
    alertType = "d1";
    alertLabel = "Expiration du certificat SSL dans moins de 24 heures";
  } else if (daysLeft <= 3) {
    alertType = "d3";
    alertLabel = "Expiration du certificat SSL dans 3 jours ou moins";
  } else if (daysLeft <= 7) {
    alertType = "d7";
    alertLabel = "Expiration du certificat SSL dans 7 jours ou moins";
  } else if (daysLeft <= 14) {
    alertType = "d14";
    alertLabel = "Expiration du certificat SSL dans 14 jours ou moins";
  } else {
    return { sent: false, reason: "not_due" };
  }

  const formattedExpiry = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(expiryTimestamp));

  // Réserver l'alerte avant l'envoi pour éviter les doublons.
  const { error: reservationError } = await supabaseAdmin
    .from("website_ssl_alerts")
    .insert({
      website_id: site.id,
      certificate_expires_at: new Date(expiryTimestamp).toISOString(),
      alert_type: alertType,
    });

  if (reservationError) {
    if (reservationError.code === "23505") {
      return { sent: false, reason: "already_alerted" };
    }

    console.error(
      `[SSL] Impossible de réserver l'alerte pour ${site.url} :`,
      reservationError.message,
    );

    return { sent: false, reason: "reservation_failed" };
  }

  const certificateStatus =
    sslResult.certificate_valid === true
      ? "Valide"
      : sslResult.certificate_valid === false
        ? "Invalide"
        : "Indéterminé";

  const hostnameStatus =
    sslResult.hostname_match === true
      ? "Concordant"
      : sslResult.hostname_match === false
        ? "Non concordant"
        : "Indéterminé";

  const httpsStatus = sslResult.https_reachable ? "Accessible" : "Inaccessible";

  const redirectStatus =
    sslResult.http_redirects_to_https === true
      ? "Oui"
      : sslResult.http_redirects_to_https === false
        ? "Non"
        : "Indéterminé";

  const subject = `[Alerte SSL] ${site.url} — ${alertLabel}`;

  const body = [
    "Alerte de surveillance SSL",
    "",
    alertLabel,
    "",
    `Site : ${site.url}`,
    `Client : ${site.client_name || "Non renseigné"}`,
    `Date d'expiration : ${formattedExpiry}`,
    `État : ${daysLeft <= 0 ? "Certificat expiré" : `Environ ${Math.ceil(daysLeft)} jour(s) restant(s)`}`,
    "",
    "Détails du contrôle :",
    `HTTPS accessible : ${httpsStatus}`,
    `Certificat valide : ${certificateStatus}`,
    `Nom d'hôte correspondant : ${hostnameStatus}`,
    `Redirection HTTP vers HTTPS : ${redirectStatus}`,
    `Détail de l'erreur SSL : ${sslResult.error_message || "Aucune erreur signalée"}`,
    "",
    "Veuillez vérifier le certificat et le renouveler si nécessaire.",
  ].join("\n");

  const resend = new Resend(apiKey);

  try {
    const { error: emailError } = await resend.emails.send({
      from,
      to: [recipient],
      subject,
      text: body,
    });

    if (emailError) {
      throw new Error(emailError.message);
    }

    const { error: updateError } = await supabaseAdmin
      .from("website_ssl_alerts")
      .update({ sent_at: new Date().toISOString() })
      .eq("website_id", site.id)
      .eq("certificate_expires_at", new Date(expiryTimestamp).toISOString())
      .eq("alert_type", alertType);

    if (updateError) {
      console.error(
        `[SSL] E-mail envoyé, mais mise à jour de l'alerte impossible pour ${site.url} :`,
        updateError.message,
      );
    }

    console.log(`[SSL] Alerte ${alertType} envoyée pour ${site.url}`);

    return { sent: true, alertType };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur Resend inconnue";

    console.error(
      `[SSL] Échec d'envoi de l'alerte pour ${site.url} :`,
      message,
    );

    // Supprimer la réservation en cas d'échec d'envoi pour permettre
    // une nouvelle tentative lors du prochain passage du cron.
    const { error: deleteError } = await supabaseAdmin
      .from("website_ssl_alerts")
      .delete()
      .eq("website_id", site.id)
      .eq("certificate_expires_at", new Date(expiryTimestamp).toISOString())
      .eq("alert_type", alertType);

    if (deleteError) {
      console.error(
        `[SSL] Impossible de libérer la réservation pour ${site.url} :`,
        deleteError.message,
      );
    }

    return { sent: false, reason: "email_failed" };
  }
}

async function checkWebsite(site) {
  const startedAt = Date.now();
  const dnsDomainPromise = checkDnsAndDomain(site).catch((error) => {
    console.error(
      `[DNS] Échec du contrôle pour ${site.url} :`,
      error instanceof Error ? error.message : "Erreur inconnue",
    );

    return {
      error:
        error instanceof Error
          ? error.message
          : "Échec de l'enregistrement du contrôle DNS.",
    };
  });

  let statusCode = null;
  let errorMessage = null;
  let isUp = false;
  // 3. Contrôle SSL, historique et alertes
  let sslSaved = false;
  let sslAlert = { sent: false, reason: "not_checked" };
  let securityHeaders = null;
  let securityIsHttps = false;

  // 1. Contrôle HTTP existant
  try {
    let url = await validatePublicUrl(site.url);
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "SiteMonitor/1.0",
        },
      });

      statusCode = response.status;

      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);

      if (!isRedirect) {
        // Récupérer les headers de la réponse finale pour le contrôle de sécurité.
        securityHeaders = response.headers;
        securityIsHttps = url.protocol === "https:";

        isUp = statusCode < 500;

        if (!isUp) {
          errorMessage = `Erreur HTTP ${statusCode}`;
        }

        await response.body?.cancel().catch(() => {});
        break;
      }

      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});

      if (!location) {
        throw new Error("Redirection sans destination");
      }

      if (redirects >= MAX_REDIRECTS) {
        throw new Error("Trop de redirections");
      }

      // Valider également chaque destination de redirection.
      url = await validatePublicUrl(new URL(location, url).toString());
    }
  } catch (error) {
    errorMessage =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Délai dépassé"
        : error instanceof Error
          ? error.message
          : "Site inaccessible";
  }

  const responseMs = Date.now() - startedAt;

  // 2. Enregistrement HTTP existant
  const { data, error } = await supabaseAdmin.rpc("record_website_check", {
    p_website_id: site.id,
    p_is_up: isUp,
    p_status_code: statusCode,
    p_response_ms: responseMs,
    p_error_message: errorMessage,
  });

  if (error) {
    const dnsDomain = await dnsDomainPromise;

    return {
      site: site.url,
      status: "unknown",
      httpStatus: statusCode,
      responseMs,
      error: `Échec de l'enregistrement du contrôle HTTP : ${error.message}`,
      dnsDomain,
    };
  }

  try {
    const sslResult = await checkSsl(site.url);

    const { error: sslError } = await supabaseAdmin
      .from("website_ssl_checks")
      .insert({
        website_id: site.id,
        https_reachable: sslResult.https_reachable,
        certificate_valid: sslResult.certificate_valid,
        hostname_match: sslResult.hostname_match,
        certificate_expires_at: sslResult.certificate_expires_at,
        http_redirects_to_https: sslResult.http_redirects_to_https,
        error_message: sslResult.error_message,
      });

    if (sslError) {
      console.error(
        `[SSL] Échec d'enregistrement pour ${site.url} :`,
        sslError.message,
      );
    } else {
      sslSaved = true;
      console.log(`[SSL] Contrôle enregistré pour ${site.url}`);
    }

    // L'envoi d'alerte est indépendant de l'enregistrement de l'historique SSL.
    sslAlert = await sendSslExpirationAlert(site, sslResult);
  } catch (sslError) {
    console.error(
      `[SSL] Échec du contrôle pour ${site.url} :`,
      sslError instanceof Error ? sslError.message : "Erreur inconnue",
    );
  }

  let securitySaved = false;
  let securityResult = null;

  try {
    if (securityHeaders) {
      securityResult = checkSecurityHeaders(securityHeaders, securityIsHttps);

      const { error: securityError } = await supabaseAdmin
        .from("website_security_checks")
        .insert({
          website_id: site.id,
          https_used: securityResult.https_used,
          hsts_present: securityResult.hsts_present,
          csp_present: securityResult.csp_present,
          nosniff_present: securityResult.nosniff_present,
          iframe_protection_present: securityResult.iframe_protection_present,
          cookies_checked: securityResult.cookies_checked,
          cookie_findings: securityResult.cookie_findings,
          findings: securityResult.findings,
          security_score: securityResult.security_score,
        });

      if (securityError) {
        console.error(
          `[Security] Échec d'enregistrement pour ${site.url} :`,
          securityError.message,
        );
      } else {
        securitySaved = true;
      }
    }
  } catch (securityError) {
    console.error(
      `[Security] Erreur pour ${site.url} :`,
      securityError instanceof Error
        ? securityError.message
        : "Erreur inconnue",
    );
  }

  return {
    site: site.url,
    status: data?.status ?? "unknown",
    httpStatus: statusCode,
    responseMs,
    sslSaved,
    sslAlert,
    securitySaved,
    securityScore: securityResult?.security_score ?? null,
    dnsDomain: await dnsDomainPromise,
  };
}

async function processNotificationQueue() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!apiKey || !from) {
    console.error("Configuration Resend manquante.");

    return {
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const { data: events, error } = await supabaseAdmin.rpc(
    "claim_notification_events",
    { p_limit: 20 },
  );

  if (error) {
    console.error("Impossible de réserver les notifications :", error.message);

    return {
      sent: 0,
      failed: 0,
      queueError: true,
    };
  }

  if (!events?.length) {
    return { sent: 0, failed: 0 };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;

  for (const event of events) {
    let deliveryError = null;

    try {
      const { error: emailError } = await resend.emails.send({
        from,
        to: [event.recipient],
        subject: event.subject,
        text: event.body,
      });

      if (emailError) {
        deliveryError = emailError.message;
      }
    } catch (error) {
      deliveryError =
        error instanceof Error ? error.message : "Erreur Resend inconnue";
    }

    const delivered = !deliveryError;

    const { error: updateError } = await supabaseAdmin
      .from("notification_outbox")
      .update({
        status: delivered ? "sent" : "failed",
        sent_at: delivered ? new Date().toISOString() : null,
        error_message: delivered ? null : deliveryError,
      })
      .eq("id", event.id)
      .eq("status", "sending");

    if (updateError) {
      console.error(
        `Impossible de mettre à jour la notification ${event.id} :`,
        updateError.message,
      );
    }

    if (delivered) {
      sent += 1;
    } else {
      failed += 1;
      console.error(`Échec de notification ${event.id} :`, deliveryError);
    }
  }

  return { sent, failed };
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { data: sites, error } = await supabaseAdmin
    .from("websites")
    .select(
      "id, client_name, url, notification_email, status, consecutive_failures, created_at, last_checked_at, active",
    )
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      "Erreur Supabase lors de la récupération des sites :",
      error.message,
    );

    return NextResponse.json(
      { error: "Impossible de récupérer les sites" },
      { status: 500 },
    );
  }

  const results = [];

  for (let i = 0; i < (sites ?? []).length; i += BATCH_SIZE) {
    const batch = sites.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (site) => {
        try {
          return await checkWebsite(site);
        } catch (error) {
          console.error(
            `Erreur de contrôle pour ${site.url} :`,
            error instanceof Error ? error.message : "Erreur inconnue",
          );

          return {
            site: site.url,
            error:
              error instanceof Error
                ? error.message
                : "Échec du contrôle ou de l'enregistrement",
          };
        }
      }),
    );

    results.push(...batchResults);
  }

  const notifications = await processNotificationQueue();

  const checkFailures = results.filter((result) => result.error).length;

  return NextResponse.json({
    checked: results.length,
    checkFailures,
    batchSize: BATCH_SIZE,
    notifications,
    results,
  });
}
