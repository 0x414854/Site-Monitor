import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { validatePublicUrl } from "@/utils/monitor/validate-url";
import { checkSsl } from "@/utils/monitor/check-ssl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 5;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;

async function checkWebsite(site) {
  const startedAt = Date.now();

  let statusCode = null;
  let errorMessage = null;
  let isUp = false;

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

      // Valide aussi la destination de chaque redirection.
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

  // L'enregistrement de l'historique, du statut et de la transition
  // se fait dans une seule transaction SQL.
  const { data, error } = await supabaseAdmin.rpc("record_website_check", {
    p_website_id: site.id,
    p_is_up: isUp,
    p_status_code: statusCode,
    p_response_ms: responseMs,
    p_error_message: errorMessage,
  });

  if (error) {
    throw new Error(`Échec de l'enregistrement Supabase : ${error.message}`);
  }

  // Contrôle SSL indépendant du contrôle de disponibilité.
  let sslSaved = false;

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
  } catch (sslError) {
    console.error(
      `[SSL] Échec du contrôle pour ${site.url} :`,
      sslError instanceof Error ? sslError.message : "Erreur inconnue",
    );
  }

  return {
    site: site.url,
    status: data?.status ?? "unknown",
    httpStatus: statusCode,
    responseMs,
    sslSaved,
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
            error: "Échec du contrôle ou de l'enregistrement",
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
