import styles from "@/styles/components/dashboard/dnsDomainStatus.module.css";

function formatDate(value) {
  if (!value) return "Indisponible";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indisponible";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function getWebsite(check) {
  const relation = check.websites;
  return Array.isArray(relation) ? relation[0] : relation;
}

function getDnsLabel(status) {
  if (status === "resolved") return "Résolution OK";
  if (status === "missing") return "Aucun A / AAAA";
  if (status === "error") return "Contrôle DNS en erreur";
  return "Pas encore contrôlé";
}

function getDomainExpiry(expiresAt) {
  if (!expiresAt) return "Date d’expiration indisponible via RDAP";

  const days = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 86400000,
  );

  if (days < 0) return `Expiré depuis ${Math.abs(days)} j`;
  if (days === 0) return "Expire aujourd’hui";
  return `Expire dans ${days} j`;
}

function getRecordCount(records = {}) {
  return Object.values(records).reduce(
    (count, values) => count + (Array.isArray(values) ? values.length : 0),
    0,
  );
}

function getRecordSummary(records = {}) {
  return ["A", "AAAA", "CNAME", "MX", "NS", "TXT"]
    .filter((type) => Array.isArray(records[type]) && records[type].length > 0)
    .map((type) => `${type} (${records[type].length})`)
    .join(" · ");
}

function CheckCard({ check, showWebsite }) {
  const website = getWebsite(check);
  const changes = Array.isArray(check.dns_changes) ? check.dns_changes : [];
  const dnsStatusClass =
    check.dns_status === "resolved"
      ? styles.ok
      : check.dns_status === "missing" || check.dns_status === "error"
        ? styles.danger
        : styles.neutral;
  const expiry = getDomainExpiry(check.domain_expires_at);
  const expiryIsNear =
    check.domain_alert_level && check.domain_alert_level !== "d30";

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.identity}>
          {showWebsite && (
            <strong>{website?.client_name || "Site sans nom"}</strong>
          )}
          {showWebsite && website?.url && <span>{website.url}</span>}
          {!showWebsite && (
            <span className={styles.checkedAt}>
              Contrôlé le {formatDate(check.checked_at)}
            </span>
          )}
        </div>
        <span className={`${styles.badge} ${dnsStatusClass}`}>
          {getDnsLabel(check.dns_status)}
        </span>
      </header>

      <div className={styles.details}>
        <div className={styles.detail}>
          <span>Expiration du domaine</span>
          <strong className={expiryIsNear ? styles.expiryWarning : ""}>
            {expiry}
          </strong>
          {check.domain_expires_at && (
            <small>{formatDate(check.domain_expires_at)}</small>
          )}
          {check.rdap_error && !check.domain_expires_at && (
            <small>{check.rdap_error}</small>
          )}
        </div>

        <div className={styles.detail}>
          <span>Enregistrements observés</span>
          <strong>{getRecordCount(check.dns_records)}</strong>
          <small>{getRecordSummary(check.dns_records) || "Aucun record"}</small>
        </div>

        <div className={styles.detail}>
          <span>Changements depuis le dernier contrôle</span>
          <strong>{changes.length}</strong>
          {changes.length > 0 && (
            <small>
              {changes.map((change) => change.type).join(", ")}
            </small>
          )}
        </div>
      </div>

      {check.dns_error && (
        <p className={styles.error} role="status">
          {check.dns_error}
        </p>
      )}

      {check.dns_status === "missing" && (
        <p className={styles.error} role="status">
          Aucun enregistrement A ou AAAA n’a été trouvé pour ce domaine.
        </p>
      )}

      <details className={styles.records}>
        <summary>Voir les enregistrements DNS</summary>
        <dl>
          {Object.entries(check.dns_records ?? {}).map(([type, values]) => (
            <div key={type}>
              <dt>{type}</dt>
              <dd>{values.length ? values.join(", ") : "—"}</dd>
            </div>
          ))}
        </dl>
      </details>

      {showWebsite && (
        <footer className={styles.footer}>
          Dernier contrôle : {formatDate(check.checked_at)}
        </footer>
      )}
    </article>
  );
}

export default function DnsDomainStatus({
  checks = [],
  showHistory = false,
}) {
  const visibleChecks = showHistory
    ? checks
    : [
        ...checks
          .reduce((latestByWebsite, check) => {
            if (!latestByWebsite.has(check.website_id)) {
              latestByWebsite.set(check.website_id, check);
            }
            return latestByWebsite;
          }, new Map())
          .values(),
      ];

  return (
    <section className={styles.section}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>DNS & DOMAINE</span>
          <h2>Résolution DNS et expiration</h2>
          <p>
            Changements des enregistrements DNS et dates d’expiration RDAP.
          </p>
        </div>
        <span className={styles.count}>
          {visibleChecks.length} contrôle{visibleChecks.length > 1 ? "s" : ""}
        </span>
      </header>

      {visibleChecks.length === 0 ? (
        <div className={styles.empty}>
          <h3>Aucun contrôle DNS pour le moment</h3>
          <p>
            Les résultats apparaîtront après le prochain contrôle quotidien.
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleChecks.map((check) => (
            <CheckCard
              check={check}
              key={check.id}
              showWebsite={!showHistory}
            />
          ))}
        </div>
      )}

      <p className={styles.note}>
        Une première résolution réussie établit la référence. Les alertes
        signalent les changements constatés depuis le contrôle précédent.
        Certains registres ne publient pas de date d’expiration RDAP.
      </p>
    </section>
  );
}
