"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/styles/page/dashboard.module.css";

const PAGE_SIZE = 10;

function normalizeStatus(status) {
  const value = String(status ?? "").toLowerCase();

  if (["up", "online", "ok", "success"].includes(value)) return "up";
  if (["down", "offline", "error", "failed"].includes(value)) return "down";
  return "unknown";
}

function getWebsiteName(website) {
  return website?.client_name || website?.url || "Site sans nom";
}

function formatDuration(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(Number(value))} ms`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getPageFromUrl() {
  const value = new URL(window.location.href).searchParams.get("activityPage");
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;

  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function getPageUrl(page) {
  const url = new URL(window.location.href);
  if (page === 1) {
    url.searchParams.delete("activityPage");
  } else {
    url.searchParams.set("activityPage", String(page));
  }
  url.hash = "activity";
  return `${url.pathname}${url.search}${url.hash}`;
}

export default function ActivityHistory({
  initialChecks,
  initialPage,
  total,
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [page, setPage] = useState(initialPage);
  const [resultCount, setResultCount] = useState(total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestController = useRef(null);

  const pageCount = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));

  const loadPage = useCallback(async (requestedPage, updateHistory) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/dashboard/activity?page=${encodeURIComponent(requestedPage)}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Impossible de charger l’historique.");
      }

      setChecks(payload.checks);
      setPage(payload.page);
      setResultCount(payload.total);

      if (updateHistory) {
        window.history.pushState({}, "", getPageUrl(payload.page));
      } else if (payload.page !== requestedPage) {
        window.history.replaceState({}, "", getPageUrl(payload.page));
      }
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Impossible de charger l’historique.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    function handlePopState() {
      const requestedPage = getPageFromUrl();
      if (requestedPage !== page) {
        void loadPage(requestedPage, false);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      requestController.current?.abort();
    };
  }, [loadPage, page]);

  function handlePageChange(nextPage) {
    if (loading || nextPage < 1 || nextPage > pageCount || nextPage === page) {
      return;
    }
    void loadPage(nextPage, true);
  }

  const firstResult = resultCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, resultCount);

  return (
    <section id="activity" className={styles.tableSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>ACTIVITÉ</span>
          <h2>Derniers contrôles</h2>
        </div>
        <span className={styles.periodBadge}>
          {resultCount.toLocaleString("fr-FR")} résultats
        </span>
      </div>

      {error && (
        <p className={styles.activityError} role="alert">
          {error}
        </p>
      )}

      {checks.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>◌</span>
          <h3>Aucun contrôle enregistré</h3>
          <p>
            Les résultats apparaîtront ici après le premier passage du système
            de surveillance.
          </p>
        </div>
      ) : (
        <div
          className={styles.tableWrapper}
          aria-busy={loading}
          aria-live="polite"
        >
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
              {checks.map((check) => {
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

      {resultCount > 0 && (
        <nav
          className={styles.activityPagination}
          aria-label="Pagination des contrôles HTTP"
        >
          <span aria-live="polite">
            Page {page} sur {pageCount} · {firstResult}–{lastResult} sur{" "}
            {resultCount.toLocaleString("fr-FR")}
          </span>
          <div>
            <button
              type="button"
              onClick={() => handlePageChange(page - 1)}
              disabled={loading || page <= 1}
            >
              ← Plus récents
            </button>
            <button
              type="button"
              onClick={() => handlePageChange(page + 1)}
              disabled={loading || page >= pageCount}
            >
              {loading ? "Chargement…" : "Plus anciens →"}
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
