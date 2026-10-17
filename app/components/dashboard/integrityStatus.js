"use client";

import { useMemo, useState } from "react";
import styles from "@/styles/components/dashboard/integrityStatus.module.css";

function formatDate(value) {
  if (!value) return "Jamais";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getSiteName(website) {
  if (Array.isArray(website)) website = website[0];
  return website?.client_name || website?.url || "Site sans nom";
}

function severityLabel(severity) {
  return (
    {
      critical: "Critique",
      high: "Élevée",
      medium: "Moyenne",
      low: "Faible",
      info: "Information",
    }[severity] ||
    severity ||
    "Inconnue"
  );
}

function categoryLabel(category) {
  return (
    {
      page_error: "Erreur de page",
      broken_link: "Lien cassé",
      redirect: "Redirection",
      sensitive_file: "Fichier sensible",
    }[category] ||
    category ||
    "Autre"
  );
}

function scanStatusLabel(status) {
  return (
    {
      completed: "Terminé",
      running: "En cours",
      failed: "Échec",
    }[status] ||
    status ||
    "Inconnu"
  );
}

export default function IntegrityStatus({ websites, scans, findings }) {
  const [selectedSite, setSelectedSite] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");

  const latestScans = useMemo(() => {
    const map = new Map();

    for (const scan of scans) {
      if (!map.has(scan.website_id)) {
        map.set(scan.website_id, scan);
      }
    }

    return map;
  }, [scans]);

  const siteById = useMemo(
    () => new Map(websites.map((site) => [site.id, site])),
    [websites],
  );

  const scanById = useMemo(
    () => new Map(scans.map((scan) => [scan.id, scan])),
    [scans],
  );

  const currentFindings = useMemo(() => {
    return findings
      .map((finding) => {
        const scan = scanById.get(finding.scan_id);

        return {
          ...finding,
          websiteId: scan?.website_id,
          website: siteById.get(scan?.website_id),
        };
      })
      .filter((finding) => finding.websiteId);
  }, [findings, scanById, siteById]);

  const filteredFindings = currentFindings.filter((finding) => {
    const matchesSite =
      selectedSite === "all" || finding.websiteId === selectedSite;

    const matchesSeverity =
      selectedSeverity === "all" || finding.severity === selectedSeverity;

    return matchesSite && matchesSeverity;
  });

  const criticalCount = currentFindings.filter(
    (item) => item.severity === "critical",
  ).length;

  const highCount = currentFindings.filter(
    (item) => item.severity === "high",
  ).length;

  const failedScans = [...latestScans.values()].filter(
    (scan) => scan.status === "failed",
  ).length;

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>CONTRÔLE QUOTIDIEN</span>
          <h2>Intégrité des sites</h2>
          <p>
            Pages en erreur, liens cassés, redirections et fichiers sensibles.
          </p>
        </div>

        <span className={styles.counter}>
          {currentFindings.length} anomalies
        </span>
      </div>

      <div className={styles.summary}>
        <article className={styles.summaryCard}>
          <span>Sites avec un scan</span>
          <strong>{latestScans.size}</strong>
        </article>

        <article className={styles.summaryCard}>
          <span>Anomalies critiques</span>
          <strong className={styles.criticalText}>{criticalCount}</strong>
        </article>

        <article className={styles.summaryCard}>
          <span>Anomalies élevées</span>
          <strong className={styles.highText}>{highCount}</strong>
        </article>

        <article className={styles.summaryCard}>
          <span>Derniers scans en échec</span>
          <strong>{failedScans}</strong>
        </article>
      </div>

      <div className={styles.siteGrid}>
        {websites.map((site) => {
          const scan = latestScans.get(site.id);

          return (
            <article className={styles.siteCard} key={site.id}>
              <div className={styles.siteCardTop}>
                <div className={styles.siteIdentity}>
                  <strong>{site.client_name || "Site sans nom"}</strong>
                  <span>{site.url}</span>
                </div>

                <span
                  className={`${styles.scanBadge} ${
                    scan?.status === "completed"
                      ? styles.completed
                      : scan?.status === "failed"
                        ? styles.failed
                        : scan?.status === "running"
                          ? styles.running
                          : styles.unknown
                  }`}
                >
                  {scanStatusLabel(scan?.status || "unknown")}
                </span>
              </div>

              {scan ? (
                <>
                  <div className={styles.scanMetrics}>
                    <div>
                      <strong>{scan.pages_checked ?? 0}</strong>
                      <span>Pages</span>
                    </div>
                    <div>
                      <strong>{scan.links_checked ?? 0}</strong>
                      <span>Liens examinés</span>
                    </div>
                    <div>
                      <strong>{scan.findings_count ?? 0}</strong>
                      <span>Anomalies</span>
                    </div>
                  </div>

                  <p className={styles.scanDate}>
                    Dernier scan : {formatDate(scan.started_at)}
                  </p>

                  {scan.error_message && (
                    <p className={styles.scanError}>{scan.error_message}</p>
                  )}
                </>
              ) : (
                <p className={styles.noScan}>Aucun scan enregistré.</p>
              )}
            </article>
          );
        })}
      </div>

      <div className={styles.findingsSection}>
        <div className={styles.findingsHeading}>
          <div>
            <h3>Anomalies détectées</h3>
            <p>Résultats des scans les plus récents enregistrés.</p>
          </div>

          <span className={styles.counter}>
            {filteredFindings.length} résultats
          </span>
        </div>

        <div className={styles.filters}>
          <label>
            <span>Site</span>
            <select
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value)}
            >
              <option value="all">Tous les sites</option>
              {websites.map((site) => (
                <option value={site.id} key={site.id}>
                  {site.client_name || site.url}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Gravité</span>
            <select
              value={selectedSeverity}
              onChange={(event) => setSelectedSeverity(event.target.value)}
            >
              <option value="all">Toutes les gravités</option>
              <option value="critical">Critique</option>
              <option value="high">Élevée</option>
              <option value="medium">Moyenne</option>
              <option value="low">Faible</option>
              <option value="info">Information</option>
            </select>
          </label>
        </div>

        {filteredFindings.length === 0 ? (
          <div className={styles.empty}>
            <strong>Aucune anomalie à afficher</strong>
            <p>
              Aucun résultat ne correspond aux filtres sélectionnés. Cela ne
              signifie pas nécessairement que toutes les pages ont été testées.
            </p>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Gravité</th>
                  <th>Catégorie</th>
                  <th>Résultat</th>
                  <th>URL concernée</th>
                  <th>Date</th>
                </tr>
              </thead>

              <tbody>
                {filteredFindings.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.siteName}>
                      {getSiteName(item.website)}
                    </td>

                    <td>
                      <span
                        className={`${styles.severity} ${
                          styles[item.severity] || ""
                        }`}
                      >
                        {severityLabel(item.severity)}
                      </span>
                    </td>

                    <td>{categoryLabel(item.category)}</td>

                    <td>
                      <div className={styles.message}>
                        {item.message}
                        {item.status_code != null && (
                          <span>HTTP {item.status_code}</span>
                        )}
                      </div>
                    </td>

                    <td className={styles.urlCell}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.url}
                      </a>
                    </td>

                    <td className={styles.date}>
                      {formatDate(item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
