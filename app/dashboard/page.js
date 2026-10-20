import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import DashboardCharts from "../components/dashboard/dashboardChart";
import styles from "@/styles/page/dashboard.module.css";
import WebsiteManager from "../components/dashboard/websiteManager";
import IncidentHistory from "../components/dashboard/incidentHistory";
import SslStatus from "../components/dashboard/sslStatus";
import DnsDomainStatus from "../components/dashboard/dnsDomainStatus";
import SecurityHeadersStatus from "../components/dashboard/securityHeaderStatus";
import IntegrityStatus from "../components/dashboard/integrityStatus";
import SignOutButton from "../components/dashboard/signOutButton";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;

function isUp(status) {
  return ["up", "online", "ok", "success"].includes(
    String(status ?? "").toLowerCase(),
  );
}

function formatDate(value) {
  if (!value) return "Jamais";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value) {
  if (value === null || value === undefined) return "—";

  return `${Math.round(Number(value))} ms`;
}

function normalizeStatus(status) {
  const value = String(status ?? "").toLowerCase();

  if (isUp(value)) return "up";

  if (["down", "offline", "error", "failed"].includes(value)) {
    return "down";
  }

  return "unknown";
}

function getWebsiteName(website) {
  return website?.client_name || website?.url || "Site sans nom";
}

function getAverageResponseTime(checks) {
  const responseTimes = checks
    .map((check) => Number(check.response_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (responseTimes.length === 0) return null;

  return (
    responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
  );
}

function buildDailyStats(checks) {
  const now = new Date();
  const days = [];

  for (let offset = PERIOD_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayChecks = checks.filter((check) => {
      const timestamp = new Date(check.checked_at).getTime();

      return (
        Number.isFinite(timestamp) &&
        timestamp >= date.getTime() &&
        timestamp < nextDate.getTime()
      );
    });

    const successfulChecks = dayChecks.filter((check) =>
      isUp(check.status),
    ).length;

    days.push({
      date: date.toISOString(),
      label: new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      }).format(date),
      availability: dayChecks.length
        ? Math.round((successfulChecks / dayChecks.length) * 1000) / 10
        : null,
      total: dayChecks.length,
    });
  }

  return days;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError) console.error("Vérification de session :", authError.message);
    redirect("/login");
  }

  const now = Date.now();
  const since = new Date(now - PERIOD_DAYS * DAY_MS).toISOString();

  const currentPeriodStart = now - DAY_MS;
  const previousPeriodStart = now - 2 * DAY_MS;

  const [
    { data: websites, error: websitesError },
    { data: checks, error: checksError },
    { data: recentChecks, error: recentChecksError },
    { data: incidents, error: incidentsError },
    { count: openIncidentsCount, error: openIncidentsError },
    { data: sslChecks, error: sslChecksError },
    { data: dnsChecks, error: dnsChecksError },
    { data: securityChecks, error: securityChecksError },
    { data: integrityScans, error: integrityScansError },
  ] = await Promise.all([
    supabase
      .from("websites")
      .select(
        "id, client_name, url, slug, notification_email, status, active, created_at, consecutive_failures, last_checked_at",
      )
      .order("created_at", { ascending: false }),

    supabase
      .from("website_checks")
      .select("status, response_ms, status_code, checked_at, website_id")
      .gte("checked_at", since)
      .order("checked_at", { ascending: true })
      .limit(10000),

    supabase
      .from("website_checks")
      .select("*, websites(client_name, url)")
      .order("checked_at", { ascending: false })
      .limit(10),

    supabase
      .from("website_incidents")
      .select(
        `
      id,
      website_id,
      started_at,
      resolved_at,
      last_error,
      status_code,
      websites(client_name, url)
    `,
      )
      .order("started_at", { ascending: false })
      .limit(20),

    supabase
      .from("website_incidents")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),

    supabase
      .from("website_ssl_checks")
      .select("*, websites(client_name, url)")
      .order("checked_at", { ascending: false })
      .limit(50),

    supabase
      .from("website_dns_checks")
      .select(
        "id, website_id, checked_at, dns_status, dns_records, dns_changes, dns_error, rdap_status, rdap_error, domain_expires_at, domain_alert_level, websites(client_name, url)",
      )
      .order("checked_at", { ascending: false })
      .limit(500),

    supabase
      .from("website_security_checks")
      .select(
        `
    id,
    website_id,
    checked_at,
    https_used,
    hsts_present,
    csp_present,
    nosniff_present,
    iframe_protection_present,
    cookies_checked,
    cookie_findings,
    findings,
    security_score,
    website:websites (
      url,
      client_name
    )
  `,
      )
      .order("checked_at", { ascending: false }),

    supabase
      .from("website_integrity_scans")
      .select(
        `
    id,
    website_id,
    started_at,
    finished_at,
    status,
    pages_checked,
    links_checked,
    findings_count,
    error_message,
    websites(client_name, url)
  `,
      )
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  const scanList = integrityScans ?? [];
  const scanIds = scanList.map((scan) => scan.id);

  let integrityFindings = [];
  let integrityFindingsError = null;

  if (scanIds.length > 0) {
    const result = await supabase
      .from("website_integrity_findings")
      .select(
        `
      id,
      scan_id,
      category,
      severity,
      url,
      status_code,
      message,
      details,
      created_at
    `,
      )
      .in("scan_id", scanIds)
      .order("created_at", { ascending: false })
      .limit(500);

    integrityFindings = result.data ?? [];
    integrityFindingsError = result.error;
  }

  const error =
    websitesError ||
    checksError ||
    recentChecksError ||
    incidentsError ||
    openIncidentsError ||
    sslChecksError ||
    dnsChecksError ||
    securityChecksError ||
    integrityScansError ||
    integrityFindingsError;

  if (error) {
    console.error("Erreur dashboard Supabase :", error.message);

    return (
      <main className={styles.page}>
        <section className={styles.errorCard}>
          <h1>Impossible de charger le dashboard</h1>
          <p>
            Vérifie la connexion Supabase, les migrations et les permissions de
            la base de données.
          </p>
          <p>
            Détail technique : {error.message}
          </p>
        </section>
      </main>
    );
  }

  const siteList = websites ?? [];
  const activeSites = siteList.filter((site) => site.active);
  const checkList = checks ?? [];
  const latestChecks = recentChecks ?? [];
  const incidentList = incidents ?? [];
  const openIncidentCount = openIncidentsCount ?? 0;

  const onlineCount = activeSites.filter((site) => isUp(site.status)).length;

  const downCount = activeSites.filter(
    (site) => normalizeStatus(site.status) === "down",
  ).length;

  const successfulChecks = checkList.filter((check) =>
    isUp(check.status),
  ).length;

  const uptime = checkList.length
    ? (successfulChecks / checkList.length) * 100
    : null;

  // Contrôles des dernières 24 heures.
  const currentPeriodChecks = checkList.filter((check) => {
    const timestamp = new Date(check.checked_at).getTime();

    return (
      Number.isFinite(timestamp) &&
      timestamp >= currentPeriodStart &&
      timestamp <= now
    );
  });

  // Contrôles entre 24 et 48 heures auparavant.
  const previousPeriodChecks = checkList.filter((check) => {
    const timestamp = new Date(check.checked_at).getTime();

    return (
      Number.isFinite(timestamp) &&
      timestamp >= previousPeriodStart &&
      timestamp < currentPeriodStart
    );
  });

  const averageResponseTime = getAverageResponseTime(currentPeriodChecks);

  const previousAverageResponseTime =
    getAverageResponseTime(previousPeriodChecks);

  // Positif = réponse plus lente ; négatif = réponse plus rapide.
  const responseTimeChange =
    averageResponseTime !== null &&
    previousAverageResponseTime !== null &&
    previousAverageResponseTime > 0
      ? ((averageResponseTime - previousAverageResponseTime) /
          previousAverageResponseTime) *
        100
      : null;

  const responseChangeLabel =
    responseTimeChange === null
      ? "Comparaison indisponible"
      : `${responseTimeChange > 0 ? "+" : ""}${responseTimeChange.toLocaleString(
          "fr-FR",
          {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
          },
        )}% par rapport aux 24 h précédentes`;

  const dailyStats = buildDailyStats(checkList);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>SITE MONITOR / VUE D’ENSEMBLE</span>
            <h1>Vue d’ensemble</h1>
            <p className={styles.subtitle}>
              L’état de tes sites et les points à surveiller, en un coup d’œil.
            </p>
          </div>

          <div className={styles.headerMeta}>
            <span className={styles.liveDot} />
            <span>Prochain contrôle · 08:00 UTC</span>
            <SignOutButton email={user.email} />
          </div>
        </header>

        <section className={styles.statsGrid} aria-label="Statistiques">
          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Surveillance active</span>
              <span className={styles.statIcon}>◈</span>
            </div>
            <strong className={styles.statValue}>{activeSites.length}</strong>
            <span className={styles.statCaption}>
              {siteList.length} site{siteList.length > 1 ? "s" : ""} enregistré
              {siteList.length > 1 ? "s" : ""}
            </span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Sites en ligne</span>
              <span className={`${styles.statusDot} ${styles.green}`} />
            </div>
            <strong className={styles.statValue}>{onlineCount}</strong>
            <span className={styles.statCaption}>Statut actuel connu</span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Incidents en cours</span>
              <span className={`${styles.statusDot} ${styles.red}`} />
            </div>
            <strong className={styles.statValue}>{openIncidentCount}</strong>
            <span className={styles.statCaption}>
              {downCount} site{downCount > 1 ? "s" : ""} actuellement en panne
            </span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Disponibilité</span>
              <span className={styles.statIcon}>↗</span>
            </div>
            <strong className={styles.statValue}>
              {uptime === null ? "—" : `${uptime.toFixed(1)}%`}
            </strong>
            <span className={styles.statCaption}>
              Sur les 30 derniers jours
            </span>
          </article>
        </section>

        <section className={styles.secondaryStats}>
          <div>
            <span className={styles.secondaryLabel}>
              Temps de réponse moyen (24 h)
            </span>
            <strong>
              {averageResponseTime === null
                ? "—"
                : `${Math.round(averageResponseTime).toLocaleString(
                    "fr-FR",
                  )} ms`}
            </strong>
            <p
              className={`${styles.responseChange} ${
                responseTimeChange === null || responseTimeChange === 0
                  ? ""
                  : responseTimeChange > 0
                    ? styles.responseSlower
                    : styles.responseFaster
              }`}
            >
              {responseChangeLabel}
            </p>
          </div>

          <div>
            <span className={styles.secondaryLabel}>Contrôles enregistrés</span>
            <strong>{checkList.length.toLocaleString("fr-FR")}</strong>
          </div>

          <div>
            <span className={styles.secondaryLabel}>Dernier contrôle reçu</span>
            <strong className={styles.lastCheck}>
              {formatDate(latestChecks[0]?.checked_at)}
            </strong>
          </div>
        </section>

        <nav className={styles.sectionNav} aria-label="Sections du dashboard">
          <a href="#websites">Sites</a>
          <a href="#alerts">Incidents</a>
          <a href="#security">Sécurité</a>
          <a href="#dns">DNS & domaine</a>
          <a href="#integrity">Intégrité</a>
          <a href="#performance">Performance</a>
          <a href="#activity">Activité</a>
        </nav>

        <div id="websites" className={styles.anchorSection}>
          <WebsiteManager websites={siteList} />
        </div>

        <div id="alerts" className={styles.anchorSection}>
          <IncidentHistory incidents={incidentList} />
        </div>

        <div id="security" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>PROTECTION</span>
            <h2>Sécurité</h2>
            <p>Certificats HTTPS et bonnes pratiques des en-têtes.</p>
          </div>
          <SslStatus checks={sslChecks ?? []} />
          <SecurityHeadersStatus checks={securityChecks} />
        </div>

        <div id="dns" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>RÉSOLUTION & ENREGISTREMENT</span>
            <h2>DNS & domaine</h2>
            <p>Évolution des enregistrements et expiration connue du domaine.</p>
          </div>
          <DnsDomainStatus checks={dnsChecks ?? []} />
        </div>

        <div id="integrity" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>CONTENU & LIENS</span>
            <h2>Intégrité</h2>
            <p>Anomalies détectées lors de l’exploration des sites.</p>
          </div>
          <IntegrityStatus
            websites={siteList}
            scans={scanList}
            findings={integrityFindings}
          />
        </div>

        <section id="performance" className={styles.chartSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>PERFORMANCE</span>
              <h2>Disponibilité des sites</h2>
            </div>
            <span className={styles.periodBadge}>30 derniers jours</span>
          </div>
          <DashboardCharts data={dailyStats} />

          <p className={styles.chartNote}>
            Le taux quotidien correspond aux contrôles réussis divisés par le
            nombre total de contrôles enregistrés. Les jours sans données ne
            sont pas calculés.
          </p>
        </section>

        <section id="activity" className={styles.tableSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>ACTIVITÉ</span>
              <h2>Derniers contrôles</h2>
            </div>
            <span className={styles.periodBadge}>
              {latestChecks.length} résultats
            </span>
          </div>

          {latestChecks.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>◌</span>
              <h3>Aucun contrôle enregistré</h3>
              <p>
                Les résultats apparaîtront ici après le premier passage de ton
                système de surveillance.
              </p>
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Statut</th>
                    <th>Code HTTP</th>
                    <th>Réponse</th>
                    <th>Date</th>
                  </tr>
                </thead>

                <tbody>
                  {latestChecks.map((check) => {
                    const status = normalizeStatus(check.status);
                    const siteName = getWebsiteName(check.websites);

                    return (
                      <tr key={check.id}>
                        <td>
                          <div className={styles.siteCell}>
                            <span
                              className={`${styles.statusDot} ${
                                status === "up"
                                  ? styles.green
                                  : status === "down"
                                    ? styles.red
                                    : styles.gray
                              }`}
                            />
                            <div className={styles.siteInfo}>
                              <strong>{siteName}</strong>
                              {check.websites?.url && (
                                <span>{check.websites.url}</span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td>
                          <span
                            className={`${styles.statusBadge} ${
                              status === "up"
                                ? styles.badgeUp
                                : status === "down"
                                  ? styles.badgeDown
                                  : styles.badgeUnknown
                            }`}
                          >
                            {status === "up"
                              ? "En ligne"
                              : status === "down"
                                ? "En panne"
                                : "Inconnu"}
                          </span>
                        </td>

                        <td>{check.status_code ?? "—"}</td>
                        <td>{formatDuration(check.response_ms)}</td>
                        <td className={styles.dateCell}>
                          {formatDate(check.checked_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <span>Site Monitor</span>
          <span>Actualisé à la demande du serveur · Fuseau horaire local</span>
        </footer>
      </div>
    </main>
  );
}
