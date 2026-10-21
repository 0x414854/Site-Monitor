import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import IncidentHistory from "@/app/components/dashboard/incidentHistory";
import SslStatus from "@/app/components/dashboard/sslStatus";
import DnsDomainStatus from "@/app/components/dashboard/dnsDomainStatus";
import SecurityHeadersStatus from "@/app/components/dashboard/securityHeaderStatus";
import DashboardCharts from "@/app/components/dashboard/dashboardChart";
import IntegrityStatus from "@/app/components/dashboard/integrityStatus";
import styles from "@/styles/page/dashboard.module.css";
import { getUserSubscription } from "@/utils/subscriptions";
import {
  isPlatformAdmin,
  syncPlatformAdminAccount,
} from "@/utils/platform-admin";

export const dynamic = "force-dynamic";

function normalizeStatus(status) {
  const value = String(status ?? "").toLowerCase();

  if (["up", "online", "ok", "success"].includes(value)) return "up";
  if (["down", "offline", "error", "failed"].includes(value)) return "down";

  return "unknown";
}

function formatDate(value) {
  if (!value) return "Jamais";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indisponible";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function WebsiteDetailPage({ params }) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError) console.error("Vérification de session :", authError.message);
    redirect("/login");
  }

  const { data: website, error: websiteError } = await supabase
    .from("websites")
    .select(
      "id, client_name, url, slug, status, active, created_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (websiteError) {
    console.error("Chargement du site :", websiteError.message);
    throw new Error("Impossible de charger ce site.");
  }

  if (!website) notFound();

  const platformAdmin = isPlatformAdmin(user);
  if (platformAdmin) await syncPlatformAdminAccount(user);
  const subscription = await getUserSubscription(user.id);
  const canViewSecurityHeaders =
    platformAdmin || subscription.features.security_headers;
  const historyDays = Math.max(1, subscription.historyDays || 30);
  const since = new Date(Date.now() - historyDays * 86400000).toISOString();

  const [
    { data: checks, error: checksError },
    { data: incidents, error: incidentsError },
    { data: sslChecks, error: sslError },
    { data: dnsChecks, error: dnsChecksError },
    { data: securityChecks, error: securityError },
    { data: integrityScans, error: integrityScansError },
  ] = await Promise.all([
    supabase
      .from("website_checks")
      .select("id, status, response_ms, status_code, checked_at, website_id")
      .eq("website_id", website.id)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true })
      .limit(5000),

    supabase
      .from("website_incidents")
      .select(
        "id, website_id, started_at, resolved_at, last_error, status_code, websites(client_name, url)",
      )
      .eq("website_id", website.id)
      .order("started_at", { ascending: false })
      .limit(50),

    supabase
      .from("website_ssl_checks")
      .select("*, websites(client_name, url)")
      .eq("website_id", website.id)
      .order("checked_at", { ascending: false })
      .limit(100),

    supabase
      .from("website_dns_checks")
      .select(
        "id, website_id, checked_at, dns_status, dns_records, dns_changes, dns_error, rdap_status, rdap_error, domain_expires_at, domain_alert_level",
      )
      .eq("website_id", website.id)
      .order("checked_at", { ascending: false })
      .limit(30),

    canViewSecurityHeaders
      ? supabase
      .from("website_security_checks")
      .select("*")
      .eq("website_id", website.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      : Promise.resolve({ data: [], error: null }),

    platformAdmin || subscription.features.integrity
      ? supabase
          .from("website_integrity_scans")
          .select(
            "id, website_id, started_at, finished_at, status, pages_checked, links_checked, findings_count, error_message",
          )
          .eq("website_id", website.id)
          .order("started_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    checksError ||
    incidentsError ||
    sslError ||
    dnsChecksError ||
    securityError ||
    integrityScansError
  ) {
    console.error("Chargement des détails du site :", {
      checksError,
      incidentsError,
      sslError,
      dnsChecksError,
      securityError,
      integrityScansError,
    });

    throw new Error("Impossible de charger les données de surveillance.");
  }

  const scanList = integrityScans ?? [];
  const { data: integrityFindings, error: integrityFindingsError } =
    scanList.length && (platformAdmin || subscription.features.integrity)
      ? await supabase
          .from("website_integrity_findings")
          .select(
            "id, scan_id, category, severity, url, status_code, message, details, created_at",
          )
          .in(
            "scan_id",
            scanList.map((scan) => scan.id),
          )
          .order("created_at", { ascending: false })
          .limit(500)
      : { data: [], error: null };

  if (integrityFindingsError) {
    console.error(
      "Chargement des anomalies d’intégrité :",
      integrityFindingsError.message,
    );
    throw new Error("Impossible de charger les anomalies d’intégrité.");
  }

  const checkList = checks ?? [];
  const latestCheck = checkList.at(-1);
  const status = normalizeStatus(website.status);

  const successful = checkList.filter(
    (check) => normalizeStatus(check.status) === "up",
  ).length;

  const uptime = checkList.length
    ? ((successful / checkList.length) * 100).toFixed(1)
    : null;

  const responseTimes = checkList
    .map((check) => Number(check.response_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const averageResponse = responseTimes.length
    ? Math.round(
        responseTimes.reduce((sum, value) => sum + value, 0) /
          responseTimes.length,
      )
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            marginBottom: 26,
            color: "#ffad4d",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          ← Retour au dashboard
        </Link>

        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>SITE MONITOR / SITE DETAIL</span>
            <h1>{website.client_name || "Site sans nom"}</h1>
            <p className={styles.subtitle}>{website.url}</p>
          </div>

          <span
            className={`${styles.detailStatus} ${
              status === "up"
                ? styles.detailUp
                : status === "down"
                  ? styles.detailDown
                  : styles.detailUnknown
            }`}
          >
            {status === "up"
              ? "En ligne"
              : status === "down"
                ? "En panne"
                : "État inconnu"}
          </span>
        </header>

        <section className={styles.statsGrid} aria-label="Statistiques du site">
          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Surveillance</span>
            </div>
            <strong className={styles.detailValue}>
              {website.active ? "Activée" : "Désactivée"}
            </strong>
            <span className={styles.statCaption}>Configuration actuelle</span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Disponibilité</span>
            </div>
            <strong className={styles.statValue}>
              {uptime === null ? "—" : `${uptime}%`}
            </strong>
            <span className={styles.statCaption}>
              {historyDays} derniers jours disponibles
            </span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Réponse moyenne</span>
            </div>
            <strong className={styles.statValue}>
              {averageResponse === null ? "—" : `${averageResponse} ms`}
            </strong>
            <span className={styles.statCaption}>
              Sur les contrôles disponibles
            </span>
          </article>

          <article className={styles.statCard}>
            <div className={styles.statTop}>
              <span>Dernier contrôle</span>
            </div>
            <strong className={styles.detailValue}>
              {formatDate(latestCheck?.checked_at)}
            </strong>
            <span className={styles.statCaption}>
              {checkList.length} contrôles sur {historyDays} jours
            </span>
          </article>
        </section>

        <nav className={styles.sectionNav} aria-label="Sections de la fiche site">
          <a href="#performance">Performance</a>
          <a href="#incidents">Incidents</a>
          <a href="#security">Sécurité</a>
          <a href="#dns">DNS & domaine</a>
          <a href="#integrity">Intégrité</a>
          <a href="#activity">Historique</a>
        </nav>

        <section id="performance" className={styles.chartSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>PERFORMANCE</span>
              <h2>Disponibilité du site</h2>
            </div>
          </div>
          <DashboardCharts checks={checkList} />
        </section>

        <div id="incidents" className={styles.anchorSection}>
          <IncidentHistory incidents={incidents ?? []} />
        </div>

        <div id="security" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>PROTECTION</span>
            <h2>Sécurité</h2>
            <p>Certificat HTTPS et configuration des en-têtes.</p>
          </div>
          <SslStatus checks={sslChecks ?? []} />
          {canViewSecurityHeaders ? (
            <SecurityHeadersStatus
              checks={(securityChecks ?? []).map((check) => ({
                ...check,
                website: {
                  client_name: website.client_name,
                  url: website.url,
                },
                website_url: website.url,
                client_name: website.client_name,
              }))}
            />
          ) : (
            <div className={styles.planGate}>
              Le contrôle des en-têtes est inclus dans les forfaits Starter et
              Pro. <Link href="/billing">Découvrir les forfaits</Link>
            </div>
          )}
        </div>

        <div id="dns" className={styles.categorySection}>
          <div className={styles.categoryHeading}>
            <span className={styles.eyebrow}>RÉSOLUTION & ENREGISTREMENT</span>
            <h2>DNS & domaine</h2>
            <p>Historique des enregistrements et expiration RDAP.</p>
          </div>
          <DnsDomainStatus checks={dnsChecks ?? []} showHistory />
        </div>

        {(platformAdmin || subscription.features.integrity) && (
          <div id="integrity" className={styles.categorySection}>
            <IntegrityStatus
              websites={[website]}
              scans={scanList}
              findings={integrityFindings ?? []}
            />
          </div>
        )}

        <section id="activity" className={styles.tableSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>ACTIVITÉ</span>
              <h2>Historique des contrôles</h2>
            </div>
            <span className={styles.periodBadge}>
              {checkList.length} résultats
            </span>
          </div>

          {checkList.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>Aucun contrôle enregistré</h3>
              <p>Les résultats apparaîtront après le premier contrôle.</p>
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Statut</th>
                    <th>Code HTTP</th>
                    <th>Temps de réponse</th>
                  </tr>
                </thead>
                <tbody>
                  {[...checkList].reverse().map((check) => {
                    const checkStatus = normalizeStatus(check.status);

                    return (
                      <tr key={check.id}>
                        <td>{formatDate(check.checked_at)}</td>
                        <td>
                          <span
                            className={`${styles.statusBadge} ${
                              checkStatus === "up"
                                ? styles.badgeUp
                                : checkStatus === "down"
                                  ? styles.badgeDown
                                  : styles.badgeUnknown
                            }`}
                          >
                            {checkStatus === "up"
                              ? "En ligne"
                              : checkStatus === "down"
                                ? "En panne"
                                : "Inconnu"}
                          </span>
                        </td>
                        <td>{check.status_code ?? "—"}</td>
                        <td>
                          {check.response_ms == null
                            ? "—"
                            : `${Math.round(check.response_ms)} ms`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
