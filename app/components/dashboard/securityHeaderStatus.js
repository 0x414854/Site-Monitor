"use client";

import { useState } from "react";
import styles from "@/styles/components/dashboard/securityHeaderStatus.module.css";

function formatDate(value) {
  if (!value) return "Jamais";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Date inconnue";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getScoreLabel(score) {
  if (score >= 80) return "Bonne couverture";
  if (score >= 50) return "À améliorer";
  return "Protection insuffisante";
}

function ScoreRing({ score }) {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));

  return (
    <div
      className={styles.scoreRing}
      style={{ "--score": `${safeScore * 3.6}deg` }}
      role="img"
      aria-label={`Score de sécurité : ${safeScore} sur 100`}
    >
      <div className={styles.scoreInner}>
        <span className={styles.scoreNumber}>{safeScore}</span>
        <span className={styles.scoreOutOf}>/ 100</span>
      </div>
    </div>
  );
}

function StatusLabel({ ok, children }) {
  return (
    <span
      className={`${styles.status} ${
        ok ? styles.statusOk : styles.statusMissing
      }`}
    >
      <span className={styles.statusDot} aria-hidden="true" />
      {children}
    </span>
  );
}

function SecurityCheck({ finding }) {
  const ok = finding.status === "ok";

  return (
    <div className={styles.checkItem}>
      <div className={styles.checkTop}>
        <span className={styles.checkName}>{finding.label}</span>
        <StatusLabel ok={ok}>{ok ? "Détecté" : "À vérifier"}</StatusLabel>
      </div>

      {finding.value && <p className={styles.headerValue}>{finding.value}</p>}

      {!ok && finding.recommendation && (
        <p className={styles.recommendation}>
          <strong>Recommandation :</strong> {finding.recommendation}
        </p>
      )}
    </div>
  );
}

function CookieAudit({ cookies, checked }) {
  const [expanded, setExpanded] = useState(false);

  if (!checked) {
    return (
      <div className={styles.cookieEmpty}>
        Les attributs des cookies n’ont pas pu être vérifiés.
      </div>
    );
  }

  if (!cookies?.length) {
    return (
      <div className={styles.cookieEmpty}>
        Aucun en-tête Set-Cookie observé sur cette réponse. Cela ne prouve pas
        que le site n’utilise aucun cookie de session.
      </div>
    );
  }

  const issueCount = cookies.reduce(
    (total, cookie) => total + (cookie.issues?.length || 0),
    0,
  );

  return (
    <div className={styles.cookieSection}>
      <div className={styles.cookieSummary}>
        <div>
          <strong>{cookies.length}</strong>
          <span>
            {cookies.length > 1 ? " cookies observés" : " cookie observé"}
          </span>
        </div>

        <StatusLabel ok={issueCount === 0}>
          {issueCount === 0
            ? "Attributs présents"
            : `${issueCount} point(s) à vérifier`}
        </StatusLabel>
      </div>

      <button
        type="button"
        className={styles.expandButton}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Masquer les détails" : "Voir les détails des cookies"}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className={styles.cookieList}>
          {cookies.map((cookie, index) => (
            <article
              className={styles.cookieCard}
              key={`${cookie.name}-${index}`}
            >
              <h4>{cookie.name}</h4>

              <div className={styles.cookieAttributes}>
                <StatusLabel ok={cookie.secure}>Secure</StatusLabel>
                <StatusLabel ok={cookie.httpOnly}>HttpOnly</StatusLabel>
                <StatusLabel ok={Boolean(cookie.sameSite)}>
                  SameSite{cookie.sameSite ? `: ${cookie.sameSite}` : ""}
                </StatusLabel>
              </div>

              {cookie.issues?.length > 0 && (
                <ul className={styles.cookieIssues}>
                  {cookie.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      <p className={styles.cookieDisclaimer}>
        Les attributs manquants sont des points à examiner, pas une preuve
        automatique de vulnérabilité. Vérifie quels cookies sont liés à
        l’authentification et les exigences propres à chaque cookie.
      </p>
    </div>
  );
}

function SecurityCard({ check }) {
  const [expanded, setExpanded] = useState(false);

  const website = check.website;
  const websiteUrl =
    check.website_url || website?.url || `Site ${check.website_id}`;

  const findings = Array.isArray(check.findings) ? check.findings : [];
  const score = Number(check.security_score) || 0;
  const missingCount = findings.filter(
    (finding) => finding.status !== "ok",
  ).length;

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.siteIdentity}>
          <div className={styles.siteIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 19 6v5c0 4.5-2.9 7.8-7 10-4.1-2.2-7-5.5-7-10V6l7-3Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="m9 12 2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className={styles.siteText}>
            <h3>
              {website?.client_name || check.client_name || "Site surveillé"}
            </h3>
            <a
              className={styles.siteUrl}
              href={websiteUrl.startsWith("http") ? websiteUrl : undefined}
              target="_blank"
              rel="noreferrer"
            >
              {websiteUrl}
            </a>
          </div>
        </div>

        <div className={styles.scoreBlock}>
          <ScoreRing score={score} />
          <span className={styles.scoreLabel}>{getScoreLabel(score)}</span>
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span>
          <span className={styles.metaDot} />
          {check.https_used ? "Réponse HTTPS" : "Réponse HTTP"}
        </span>
        <span>Audité le {formatDate(check.checked_at)}</span>
      </div>

      <div className={styles.progressTrack}>
        <div
          className={styles.progressValue}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>

      <div className={styles.summaryRow}>
        <span className={styles.summaryTitle}>En-têtes de sécurité</span>
        <span className={styles.summaryCount}>
          {findings.length - missingCount}/{findings.length} détectés
        </span>
      </div>

      <div className={styles.checkGrid}>
        {findings.map((finding) => (
          <SecurityCheck key={finding.key} finding={finding} />
        ))}
      </div>

      <div className={styles.cookiesPanel}>
        <div className={styles.cookieHeading}>
          <div>
            <h4>Attributs des cookies</h4>
            <p>Secure · HttpOnly · SameSite</p>
          </div>
          <span className={styles.cookieIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect
                x="5"
                y="10"
                width="14"
                height="11"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M8 10V7a4 4 0 0 1 8 0v3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>

        <CookieAudit
          cookies={check.cookie_findings}
          checked={check.cookies_checked}
        />
      </div>

      {findings.some((finding) => finding.status !== "ok") && (
        <button
          type="button"
          className={styles.detailsButton}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Masquer les recommandations"
            : "Afficher les recommandations"}
          <span aria-hidden="true">{expanded ? "−" : "↗"}</span>
        </button>
      )}

      {expanded && (
        <div className={styles.recommendationsPanel}>
          <h4>Actions recommandées</h4>
          {findings
            .filter((finding) => finding.status !== "ok")
            .map((finding) => (
              <div className={styles.actionItem} key={finding.key}>
                <span className={styles.actionMarker} />
                <div>
                  <strong>{finding.label}</strong>
                  <p>{finding.recommendation}</p>
                </div>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

export default function SecurityHeadersStatus({
  checks = [],
  loading = false,
  error = null,
}) {
  if (loading) {
    return (
      <section className={styles.wrapper} aria-live="polite">
        <div className={styles.loading}>
          <span className={styles.spinner} />
          Chargement des audits de sécurité…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.wrapper}>
        <div className={styles.emptyState}>
          <h3>Impossible de charger les audits</h3>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  const sortedChecks = [...checks].sort(
    (a, b) => new Date(b.checked_at) - new Date(a.checked_at),
  );

  const latestByWebsite = Array.from(
    sortedChecks
      .reduce((map, check) => {
        if (!map.has(check.website_id)) {
          map.set(check.website_id, check);
        }
        return map;
      }, new Map())
      .values(),
  );

  const averageScore = latestByWebsite.length
    ? Math.round(
        latestByWebsite.reduce(
          (sum, check) => sum + (Number(check.security_score) || 0),
          0,
        ) / latestByWebsite.length,
      )
    : 0;

  const sitesToReview = latestByWebsite.filter(
    (check) => (Number(check.security_score) || 0) < 100,
  ).length;

  return (
    <section className={styles.wrapper}>
      <header className={styles.pageHeader}>
        <div className={styles.headingGroup}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            SURVEILLANCE & PROTECTION
          </div>
          <h2>Configuration de sécurité HTTP</h2>
          <p>
            Visibilité sur les en-têtes de sécurité et les attributs des cookies
            observés.
          </p>
        </div>

        <div className={styles.auditBadge}>
          <span className={styles.auditBadgeDot} />
          Audit automatisé
        </div>
      </header>

      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Sites audités</span>
          <strong className={styles.metricValue}>
            {latestByWebsite.length}
          </strong>
          <span className={styles.metricHint}>Dernier résultat par site</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Score moyen</span>
          <strong className={styles.metricValue}>
            {averageScore}
            <small>/100</small>
          </strong>
          <span className={styles.metricHint}>Présence des 4 protections</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>À examiner</span>
          <strong className={styles.metricValue}>{sitesToReview}</strong>
          <span className={styles.metricHint}>
            Au moins une protection absente
          </span>
        </div>
      </div>

      {latestByWebsite.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 19 6v5c0 4.5-2.9 7.8-7 10-4.1-2.2-7-5.5-7-10V6l7-3Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3>Aucun audit disponible</h3>
          <p>
            Les résultats apparaîtront après le prochain passage du cron et
            l’enregistrement réussi dans Supabase.
          </p>
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {latestByWebsite.map((check) => (
            <SecurityCard key={check.website_id} check={check} />
          ))}
        </div>
      )}

      <p className={styles.footerNote}>
        Un en-tête détecté n’est pas nécessairement bien configuré. Les
        résultats sont indicatifs et doivent être interprétés selon les besoins
        et les fonctionnalités de chaque site.
      </p>
    </section>
  );
}
