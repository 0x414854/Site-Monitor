import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/utils/supabase/clients";

// Premier échec : le site n'est pas immédiatement déclaré en panne.
// Deuxième échec consécutif : son état passe à down et une alerte est envoyée.
// Contrôle réussi après une panne : son état repasse à up et une notification de rétablissement est envoyée.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function sendAlert(to, subject, message) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY manquante");
    return;
  }
  if (!apiKey || !from || !to) {
    console.error("Configuration email manquante ou destinataire invalide.");
    return;
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    text: message,
  });

  if (error) {
    console.error("Erreur d'envoi d'alerte:", error.message);
  }
}

async function checkWebsite(site) {
  const startedAt = Date.now();
  let statusCode = null;
  let errorMessage = null;
  let isUp = false;

  try {
    const url = new URL(site.url);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Protocole non autorisé");
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "SiteMonitor/1.0",
      },
    });

    statusCode = response.status;
    isUp = response.status < 500;

    // Libère le corps de réponse sans le télécharger intégralement.
    await response.body?.cancel().catch(() => {});
  } catch (error) {
    errorMessage =
      error.name === "TimeoutError"
        ? "Délai dépassé"
        : error.message || "Site inaccessible";
  }

  const responseMs = Date.now() - startedAt;
  const previousStatus = site.status;
  const failures = isUp ? 0 : site.consecutive_failures + 1;

  let newStatus = isUp ? "up" : failures >= 2 ? "down" : previousStatus;

  const { error: historyError } = await supabaseAdmin
    .from("website_checks")
    .insert({
      website_id: site.id,
      status: isUp ? "up" : "down",
      status_code: statusCode,
      response_ms: responseMs,
      error_message: errorMessage,
    });

  if (historyError) throw historyError;

  const { error: updateError } = await supabaseAdmin
    .from("websites")
    .update({
      status: newStatus,
      last_status_code: statusCode,
      last_response_ms: responseMs,
      last_checked_at: new Date().toISOString(),
      consecutive_failures: failures,
    })
    .eq("id", site.id);

  if (updateError) throw updateError;

  if (newStatus === "down" && previousStatus !== "down") {
    await sendAlert(
      site.notification_email,
      `Site inaccessible : ${site.client_name}`,
      `Le site ${site.url} semble inaccessible.\n` +
        `Erreur : ${errorMessage || `HTTP ${statusCode}`}\n` +
        `Vérifie l'hébergement et le serveur.`,
    );
  }

  if (isUp && previousStatus === "down") {
    await sendAlert(
      site.notification_email,
      `Site rétabli : ${site.client_name}`,
      `Le site ${site.url} répond à nouveau.\n` +
        `Code HTTP : ${statusCode}\n` +
        `Temps de réponse : ${responseMs} ms.`,
    );
  }

  return {
    site: site.url,
    status: newStatus,
    httpStatus: statusCode,
    responseMs,
  };
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { data: sites, error } = await supabaseAdmin
    .from("websites")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("Erreur Supabase:", error.message);
    return NextResponse.json(
      { error: "Impossible de récupérer les sites" },
      { status: 500 },
    );
  }

  const results = [];

  for (const site of sites) {
    try {
      results.push(await checkWebsite(site));
    } catch (error) {
      console.error(`Erreur pour ${site.url}:`, error.message);
      results.push({
        site: site.url,
        error: "Échec de l'enregistrement du contrôle",
      });
    }
  }

  return NextResponse.json({
    checked: results.length,
    results,
  });
}
