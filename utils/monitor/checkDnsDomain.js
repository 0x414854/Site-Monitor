import dns from "node:dns/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Resend } from "resend";
import { supabaseAdmin } from "@/utils/supabase/clients";

const DNS_TIMEOUT_MS = 6000;
const RDAP_TIMEOUT_MS = 8000;
const NO_RECORD_CODES = new Set(["ENODATA", "ENOTFOUND", "ENONAME"]);
const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"];
const EXPIRY_THRESHOLDS = [
  { days: 1, level: "d1" },
  { days: 3, level: "d3" },
  { days: 7, level: "d7" },
  { days: 14, level: "d14" },
  { days: 30, level: "d30" },
];

function withTimeout(promise, timeoutMs, message) {
  let timeout;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function resolveRecords(hostname, type) {
  const resolvers = {
    A: () => dns.resolve4(hostname),
    AAAA: () => dns.resolve6(hostname),
    CNAME: () => dns.resolveCname(hostname),
    MX: async () =>
      (await dns.resolveMx(hostname)).map(
        ({ priority, exchange }) => `${priority} ${exchange.toLowerCase()}`,
      ),
    NS: async () =>
      (await dns.resolveNs(hostname)).map((value) => value.toLowerCase()),
    TXT: async () =>
      (await dns.resolveTxt(hostname)).map((parts) => parts.join("")),
  };

  try {
    const records = await withTimeout(
      resolvers[type](),
      DNS_TIMEOUT_MS,
      `Délai dépassé pendant la résolution DNS ${type}`,
    );

    return [...new Set(records.map(String))].sort();
  } catch (error) {
    if (error instanceof Error && NO_RECORD_CODES.has(error.code)) {
      return [];
    }

    throw error;
  }
}

async function inspectDns(hostname) {
  const entries = await Promise.all(
    RECORD_TYPES.map(async (type) => [
      type,
      await resolveRecords(hostname, type),
    ]),
  );
  const records = Object.fromEntries(entries);

  return {
    status: records.A.length || records.AAAA.length ? "resolved" : "missing",
    records,
    error: null,
  };
}

function getDomainName(hostname) {
  const domain = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

  if (isIP(domain)) return null;
  return domain;
}

async function inspectDomainExpiry(hostname) {
  const domain = getDomainName(hostname);

  if (!domain) {
    return {
      status: "unavailable",
      expiresAt: null,
      error: "Une adresse IP n'a pas de date d'expiration de domaine.",
    };
  }

  try {
    const labels = domain.split(".");
    const candidates = labels
      .slice(0, Math.max(1, labels.length - 1))
      .map((_, index) => labels.slice(index).join("."))
      .slice(0, 6);
    const deadline = Date.now() + RDAP_TIMEOUT_MS;

    for (const candidate of candidates) {
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) break;

      const response = await fetch(
        `https://rdap.org/domain/${encodeURIComponent(candidate)}`,
        {
          headers: {
            accept: "application/rdap+json, application/json",
            "user-agent": "SiteMonitor/1.0",
          },
          signal: AbortSignal.timeout(remainingMs),
        },
      );

      if (response.status === 404 || response.status === 501) {
        await response.body?.cancel().catch(() => {});
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return {
          status: "error",
          expiresAt: null,
          error: `Le service RDAP a répondu HTTP ${response.status}.`,
        };
      }

      const result = await response.json();
      const expirationEvent = result.events?.find((event) =>
        /expir/i.test(String(event.eventAction ?? "")),
      );
      const expirationValue =
        expirationEvent?.eventDate ??
        result.expirationDate ??
        result.expires ??
        null;
      const expiresAt = expirationValue
        ? new Date(expirationValue).toISOString()
        : null;

      if (expiresAt) {
        return { status: "available", expiresAt, error: null };
      }

      return {
        status: "unavailable",
        expiresAt: null,
        error: "La fiche RDAP ne publie pas de date d'expiration.",
      };
    }

    return {
      status: "unavailable",
      expiresAt: null,
      error: "Le registre ne fournit pas de fiche RDAP pour ce domaine.",
    };
  } catch (error) {
    return {
      status: "error",
      expiresAt: null,
      error:
        error instanceof Error
          ? error.message
          : "Impossible de contacter le service RDAP.",
    };
  }
}

function getDomainAlertLevel(expiresAt) {
  if (!expiresAt) return null;

  const daysLeft = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 86400000,
  );

  if (daysLeft < 0) return { level: "expired", daysLeft };

  const threshold = EXPIRY_THRESHOLDS.find(
    ({ days }) => daysLeft <= days,
  );

  return threshold ? { ...threshold, daysLeft } : null;
}

function compareDnsRecords(previousRecords = {}, currentRecords = {}) {
  return RECORD_TYPES.map((type) => {
    const previous = previousRecords[type] ?? [];
    const current = currentRecords[type] ?? [];

    return {
      type,
      added: current.filter((record) => !previous.includes(record)),
      removed: previous.filter((record) => !current.includes(record)),
    };
  }).filter((change) => change.added.length || change.removed.length);
}

function getAlertKey(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sendAlert(site, alertType, alertKey, subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!site.notification_email) {
    console.error(
      `[DNS] Aucun destinataire d'alerte configuré pour ${site.url}.`,
    );
    return "skipped";
  }

  if (!apiKey || !from) {
    console.error(
      `[DNS] Configuration Resend manquante pour ${site.url}; e-mail non envoyé.`,
    );
    return "failed";
  }

  const { data: reservation, error: reservationError } = await supabaseAdmin
    .from("website_dns_alerts")
    .insert({
      website_id: site.id,
      alert_type: alertType,
      alert_key: alertKey,
    })
    .select("id")
    .single();

  if (reservationError) {
    if (reservationError.code === "23505") return "duplicate";
    throw new Error(`Réservation d'alerte impossible : ${reservationError.message}`);
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [site.notification_email],
      subject,
      text: body,
    });

    if (error) throw new Error(error.message);

    const { error: updateError } = await supabaseAdmin
      .from("website_dns_alerts")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", reservation.id);

    if (updateError) {
      console.error(
        `[DNS] E-mail envoyé, mais mise à jour de l'alerte impossible : ${updateError.message}`,
      );
    }

    return "sent";
  } catch (error) {
    const { error: deleteError } = await supabaseAdmin
      .from("website_dns_alerts")
      .delete()
      .eq("id", reservation.id);

    if (deleteError) {
      console.error(
        `[DNS] Impossible de libérer la réservation d'alerte : ${deleteError.message}`,
      );
    }

    console.error(
      `[DNS] Échec d'envoi de l'alerte pour ${site.url} :`,
      error instanceof Error ? error.message : "Erreur Resend inconnue",
    );
    return "failed";
  }
}

function getRecordChangeDescription(changes) {
  return changes
    .map((change) => {
      const additions = change.added.map((value) => `+ ${value}`);
      const removals = change.removed.map((value) => `- ${value}`);

      return `${change.type} : ${[...additions, ...removals].join(", ")}`;
    })
    .join("\n");
}

export async function checkDnsAndDomain(site) {
  let hostname;

  try {
    hostname = new URL(site.url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error(`URL invalide pour le contrôle DNS : ${site.url}`);
  }

  const [dnsResult, domainResult] = await Promise.all([
    inspectDns(hostname).catch((error) => ({
      status: "error",
      records: Object.fromEntries(RECORD_TYPES.map((type) => [type, []])),
      error:
        error instanceof Error ? error.message : "Échec de la résolution DNS.",
    })),
    inspectDomainExpiry(hostname),
  ]);

  const [
    { data: previous, error: previousError },
    { data: previousResolved, error: resolvedError },
  ] = await Promise.all([
    supabaseAdmin
      .from("website_dns_checks")
      .select(
        "id, dns_status, dns_records, domain_expires_at, domain_alert_level",
      )
      .eq("website_id", site.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("website_dns_checks")
      .select("dns_records")
      .eq("website_id", site.id)
      .eq("dns_status", "resolved")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (previousError) {
    throw new Error(
      `Lecture de l'historique DNS impossible : ${previousError.message}`,
    );
  }
  if (resolvedError) {
    throw new Error(
      `Lecture de la référence DNS impossible : ${resolvedError.message}`,
    );
  }

  const dnsChanges =
    previousResolved && dnsResult.status === "resolved"
      ? compareDnsRecords(previousResolved.dns_records, dnsResult.records)
      : [];
  const domainAlert = getDomainAlertLevel(domainResult.expiresAt);
  const domainAlertLevel = domainAlert?.level ?? null;

  let alertsSent = 0;
  let alertRetryRequired = false;
  const checkedDay = new Date().toISOString().slice(0, 10);

  if (dnsResult.status === "missing" && previous?.dns_status !== "missing") {
    const sent = await sendAlert(
      site,
      "dns_missing",
      `${checkedDay}:missing`,
      `[Alerte DNS] Résolution manquante pour ${site.url}`,
      [
        `La résolution DNS de ${hostname} ne retourne aucun enregistrement A ou AAAA.`,
        `Site : ${site.url}`,
        `Contrôle : ${new Date().toISOString()}`,
      ].join("\n"),
    );
    alertsSent += Number(sent === "sent");
    alertRetryRequired ||= sent === "failed";
  } else if (
    dnsResult.status === "resolved" &&
    previous?.dns_status === "missing"
  ) {
    const sent = await sendAlert(
      site,
      "dns_recovered",
      `${checkedDay}:recovered`,
      `[Rétablissement DNS] ${site.url}`,
      `La résolution DNS de ${hostname} fonctionne de nouveau.\nSite : ${site.url}`,
    );
    alertsSent += Number(sent === "sent");
    alertRetryRequired ||= sent === "failed";
  } else if (dnsChanges.length > 0) {
    const changeSummary = getRecordChangeDescription(dnsChanges);
    const key = getAlertKey(`${checkedDay}:${JSON.stringify(dnsChanges)}`);
    const sent = await sendAlert(
      site,
      "dns_changed",
      key,
      `[Alerte DNS] Enregistrements modifiés pour ${site.url}`,
      [
        `Un ou plusieurs enregistrements DNS de ${hostname} ont changé depuis le dernier contrôle.`,
        "",
        changeSummary,
        "",
        `Site : ${site.url}`,
        `Contrôle : ${new Date().toISOString()}`,
      ].join("\n"),
    );
    alertsSent += Number(sent === "sent");
    alertRetryRequired ||= sent === "failed";
  }

  const previousExpiry = previous?.domain_expires_at
    ? new Date(previous.domain_expires_at).toISOString()
    : null;

  if (
    domainAlert &&
    (previous?.domain_alert_level !== domainAlert.level ||
      previousExpiry !== domainResult.expiresAt)
  ) {
    const expiryLabel =
      domainAlert.level === "expired"
        ? "Le domaine est expiré"
        : `Le domaine expire dans ${domainAlert.daysLeft} jour(s)`;
    const key = `${domainResult.expiresAt}:${domainAlert.level}`;
    const sent = await sendAlert(
      site,
      "domain_expiry",
      key,
      `[Alerte domaine] ${expiryLabel} — ${site.url}`,
      [
        expiryLabel,
        `Domaine : ${getDomainName(hostname) ?? hostname}`,
        `Date d'expiration RDAP : ${domainResult.expiresAt}`,
        `Site : ${site.url}`,
      ].join("\n"),
    );
    alertsSent += Number(sent === "sent");
    alertRetryRequired ||= sent === "failed";
  }

  if (alertRetryRequired) {
    return {
      checkId: null,
      dnsStatus: dnsResult.status,
      dnsChanges: dnsChanges.length,
      dnsError: dnsResult.error,
      rdapStatus: domainResult.status,
      domainExpiresAt: domainResult.expiresAt,
      domainAlertLevel,
      alertsSent,
      alertRetryRequired: true,
    };
  }

  const { data: check, error: insertError } = await supabaseAdmin
    .from("website_dns_checks")
    .insert({
      website_id: site.id,
      dns_status: dnsResult.status,
      dns_records: dnsResult.records,
      dns_changes: dnsChanges,
      dns_error: dnsResult.error,
      rdap_status: domainResult.status,
      rdap_error: domainResult.error,
      domain_expires_at: domainResult.expiresAt,
      domain_alert_level: domainAlertLevel,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(
      `Enregistrement du contrôle DNS impossible : ${insertError.message}`,
    );
  }

  return {
    checkId: check.id,
    dnsStatus: dnsResult.status,
    dnsChanges: dnsChanges.length,
    dnsError: dnsResult.error,
    rdapStatus: domainResult.status,
    domainExpiresAt: domainResult.expiresAt,
    domainAlertLevel,
    alertsSent,
  };
}
