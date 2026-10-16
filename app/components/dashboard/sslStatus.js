import styles from "@/styles/components/dashboard/sslStatus.module.css";

function formatDate(value) {
  if (!value) return "Indisponible";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indisponible";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getDaysLeft(value) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;

  return Math.ceil((timestamp - Date.now()) / 86400000);
}

function getCertificateStatus(check) {
  if (check.https_reachable === false) {
    return { label: "TLS inaccessible", className: styles.danger };
  }

  if (check.certificate_valid === true) {
    return { label: "Certificat valide", className: styles.success };
  }

  if (check.certificate_valid === false) {
    return { label: "Certificat invalide", className: styles.danger };
  }

  return { label: "Inconnu", className: styles.neutral };
}

function getExpiryStatus(days) {
  if (days === null) {
    return { label: "Indisponible", className: styles.neutral };
  }

  if (days < 0) {
    return {
      label: `Expiré depuis ${Math.abs(days)} j`,
      className: styles.danger,
    };
  }

  if (days <= 14) {
    return {
      label: `${days} j restant${days > 1 ? "s" : ""}`,
      className: styles.warning,
    };
  }

  return {
    label: `${days} j restant${days > 1 ? "s" : ""}`,
    className: styles.success,
  };
}

function StatusBadge({ label, className }) {
  return <span className={`${styles.badge} ${className}`}>{label}</span>;
}

export default function SslStatus({ checks = [] }) {
  // Garder uniquement le contrôle le plus récent de chaque site.
  const latestChecks = [
    ...checks
      .reduce((latestByWebsite, check) => {
        const websiteId = check.website_id;

        if (!websiteId) return latestByWebsite;

        const existing = latestByWebsite.get(websiteId);

        if (
          !existing ||
          new Date(check.checked_at).getTime() >
            new Date(existing.checked_at).getTime() ||
          (new Date(check.checked_at).getTime() ===
            new Date(existing.checked_at).getTime() &&
            check.id > existing.id)
        ) {
          latestByWebsite.set(websiteId, check);
        }

        return latestByWebsite;
      }, new Map())
      .values(),
  ];

  const errors = [
    ...new Set(
      latestChecks.map((check) => check.error_message).filter(Boolean),
    ),
  ];

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h2 className={styles.heading}>
            <span className={styles.headingIcon} aria-hidden="true">
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                <path d="M12 14v3" />
              </svg>
            </span>
            Certificats HTTPS / SSL
          </h2>
          <p className={styles.subtitle}>
            Surveillance des certificats, des domaines et des redirections
            HTTPS.
          </p>
        </div>

        <span className={styles.count}>
          {latestChecks.length} contrôle{latestChecks.length > 1 ? "s" : ""}
        </span>
      </header>

      {latestChecks.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          <h3 className={styles.emptyTitle}>
            Aucun contrôle SSL pour le moment
          </h3>
          <p className={styles.emptyText}>
            Les résultats apparaîtront ici après le premier contrôle de tes
            sites.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Certificat</th>
                  <th scope="col">Expiration</th>
                  <th scope="col">Domaine</th>
                  <th scope="col">Redirection HTTPS</th>
                  <th scope="col">Dernier contrôle</th>
                </tr>
              </thead>

              <tbody>
                {latestChecks.map((check) => {
                  const website = Array.isArray(check.websites)
                    ? check.websites[0]
                    : check.websites;

                  const days = getDaysLeft(check.certificate_expires_at);
                  const certificate = getCertificateStatus(check);
                  const expiry = getExpiryStatus(days);

                  return (
                    <tr key={check.id}>
                      <td>
                        <span className={styles.siteName}>
                          {website?.client_name || "Site inconnu"}
                        </span>
                        {website?.url && (
                          <span className={styles.siteUrl}>{website.url}</span>
                        )}
                      </td>

                      <td>
                        <StatusBadge
                          label={certificate.label}
                          className={certificate.className}
                        />
                      </td>

                      <td>
                        <div className={styles.expiration}>
                          <StatusBadge
                            label={expiry.label}
                            className={expiry.className}
                          />
                          {check.certificate_expires_at && (
                            <span className={styles.expirationDate}>
                              {formatDate(check.certificate_expires_at)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        {check.hostname_match === true ? (
                          <StatusBadge
                            label="Correspondance OK"
                            className={styles.success}
                          />
                        ) : check.hostname_match === false ? (
                          <StatusBadge
                            label="Nom incorrect"
                            className={styles.danger}
                          />
                        ) : (
                          <StatusBadge
                            label="Non vérifié"
                            className={styles.neutral}
                          />
                        )}
                      </td>

                      <td>
                        {check.http_redirects_to_https === true ? (
                          <StatusBadge
                            label="Activée"
                            className={styles.success}
                          />
                        ) : check.http_redirects_to_https === false ? (
                          <StatusBadge
                            label="Absente"
                            className={styles.warning}
                          />
                        ) : (
                          <StatusBadge
                            label="Non vérifiée"
                            className={styles.neutral}
                          />
                        )}
                      </td>

                      <td>
                        <span className={styles.expirationDate}>
                          {formatDate(check.checked_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {errors.length > 0 && (
            <div className={styles.errorPanel}>
              <h3 className={styles.errorTitle}>
                Détails des erreurs détectées
              </h3>
              <ul className={styles.errorList}>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
