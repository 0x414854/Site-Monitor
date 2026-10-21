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
import ActivityHistory from "../components/dashboard/activityHistory";
import { getUserSubscription } from "@/utils/subscriptions";
import Link from "next/link";
import {
  isPlatformAdmin,
  syncPlatformAdminAccount,
} from "@/utils/platform-admin";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;
const ACTIVITY_PAGE_SIZE = 10;

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

function normalizeStatus(status) {
  const value = String(status ?? "").toLowerCase();

  if (isUp(value)) return "up";

  if (["down", "offline", "error", "failed"].includes(value)) {
    return "down";
  }

  return "unknown";
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

export default async function DashboardPage({ searchParams }) {
  const params = await searchParams;
  const requestedPage = Number(params?.activityPage ?? 1);
  const activityPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError)
      console.error("Vérification de session :", authError.message);
    redirect("/login");
  }

  const platformAdmin = isPlatformAdmin(user);
  if (platformAdmin) await syncPlatformAdminAccount(user);
  const subscription = await getUserSubscription(user.id);
  const canViewSecurityHeaders =
    platformAdmin || subscription.features.security_headers;
  const canViewIntegrity = platformAdmin || subscription.features.integrity;
  const now = Date.now();
  const historyDays = Math.max(1, subscription.historyDays || PERIOD_DAYS);
  const since = new Date(now - historyDays * DAY_MS).toISOString();

  const currentPeriodStart = now - DAY_MS;
  const previousPeriodStart = now - 2 * DAY_MS;

  const [
    { data: websites, error: websitesError },
    { data: checks, error: checksError },
    {
      data: recentChecks,
      error: recentChecksError,
      count: recentChecksCount,
    },
    { data: lastCheck, error: lastCheckError },
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
      .select("*, websites(client_name, url)", { count: "exact" })
      .order("checked_at", { ascending: false })
      .order("id", { ascending: false })
      .range(
        (activityPage - 1) * ACTIVITY_PAGE_SIZE,
        activityPage * ACTIVITY_PAGE_SIZE - 1,
      ),

    supabase
      .from("website_checks")
      .select("checked_at")
      .order("checked_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),

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

    canViewSecurityHeaders
      ? supabase
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
          .order("checked_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),

    canViewIntegrity
      ? supabase
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
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
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
    lastCheckError ||
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
          <p>Détail technique : {error.message}</p>
        </section>
      </main>
    );
  }

  const siteList = websites ?? [];
  const activeSites = siteList.filter((site) => site.active);
  const checkList = checks ?? [];
  const activityChecks = recentChecks ?? [];
  const activityTotal = recentChecksCount ?? 0;
  const activityPageCount = Math.max(
    1,
    Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE),
  );

  if (activityPage > activityPageCount) {
    redirect(
      activityPageCount === 1
        ? "/dashboard#activity"
        : `/dashboard?activityPage=${activityPageCount}#activity`,
    );
  }

  const incidentList = incidents ?? [];
  const openIncidentCount = openIncidentsCount ?? 0;

  const onlineCount = activeSites.filter((site) => isUp(site.status)).length;

  const downCount = activeSites.filter(
    (site) => normalizeStatus(site.status) === "down",
  ).length;

  const last30Checks = checkList.filter((check) => {
    const timestamp = new Date(check.checked_at).getTime();
    return (
      Number.isFinite(timestamp) && timestamp >= now - PERIOD_DAYS * DAY_MS
    );
  });

  const successfulChecks = last30Checks.filter((check) =>
    isUp(check.status),
  ).length;

  const uptime = last30Checks.length
    ? (successfulChecks / last30Checks.length) * 100
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

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>
              SITE MONITOR / VUE D’ENSEMBLE
            </span>
            <h1>Vue d’ensemble</h1>
            <p className={styles.subtitle}>
              L’état de tes sites et les points à surveiller, en un coup d’œil.
            </p>
          </div>

          <div className={styles.headerMeta}>
            <span className={styles.liveDot} />
            <span>Prochain contrôle · 08:00 UTC</span>
            {platformAdmin && (
              <Link href="/admin" className={styles.subscriptionLink}>
                Administration →
              </Link>
            )}
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

        {!platformAdmin && (
          <section className={styles.subscriptionSummary}>
            <div>
              <span className={styles.secondaryLabel}>Forfait actuel</span>
              <strong>{subscription.plan.name}</strong>
              <span className={styles.subscriptionUsage}>
                {siteList.length} / {subscription.maxSites} sites · historique{" "}
                {subscription.historyDays} jours
              </span>
            </div>
            <Link href="/billing" className={styles.subscriptionLink}>
              Gérer mon forfait <span aria-hidden="true">→</span>
            </Link>
          </section>
        )}

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
              {formatDate(lastCheck?.checked_at)}
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
          <WebsiteManager
            websites={siteList}
            siteLimit={
              platformAdmin
                ? Number.POSITIVE_INFINITY
                : subscription.maxSites
            }
            planName={
              platformAdmin ? "administrateur" : subscription.plan.name
            }
          />
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
          {canViewSecurityHeaders ? (
            <SecurityHeadersStatus checks={securityChecks} />
          ) : (
            <div className={styles.planGate}>
              Les en-têtes de sécurité sont inclus dans les forfaits Starter et
              Pro. <Link href="/billing">Découvrir les forfaits</Link>
            </div>
          )}
        </div>

        <div id="dns" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>RÉSOLUTION & ENREGISTREMENT</span>
            <h2>DNS & domaine</h2>
            <p>
              Évolution des enregistrements et expiration connue du domaine.
            </p>
          </div>
          <DnsDomainStatus checks={dnsChecks ?? []} />
        </div>

        <div id="integrity" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>CONTENU & LIENS</span>
            <h2>Intégrité</h2>
            <p>Anomalies détectées lors de l’exploration des sites.</p>
          </div>
          {canViewIntegrity ? (
            <IntegrityStatus
              websites={siteList}
              scans={scanList}
              findings={integrityFindings}
            />
          ) : (
            <div className={styles.planGate}>
              Le contrôle d’intégrité est inclus dans les forfaits Starter et
              Pro. <Link href="/billing">Découvrir les forfaits</Link>
            </div>
          )}
        </div>

        <section id="performance" className={styles.chartSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>PERFORMANCE</span>
              <h2>Disponibilité des sites</h2>
            </div>
          </div>
          <DashboardCharts checks={checkList} />

          <p className={styles.chartNote}>
            Le taux quotidien correspond aux contrôles réussis divisés par le
            nombre total de contrôles enregistrés. Les jours sans données ne
            sont pas calculés.
          </p>
        </section>

        <ActivityHistory
          initialChecks={activityChecks}
          initialPage={activityPage}
          total={activityTotal}
        />

        <footer className={styles.footer}>
          <span>Site Monitor</span>
          <span>Actualisé à la demande du serveur · Fuseau horaire local</span>
        </footer>
      </div>
    </main>
  );
}
