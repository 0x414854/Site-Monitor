"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createWebsite,
  toggleWebsiteMonitoring,
  deleteWebsite,
} from "@/app/actions/websites";
import styles from "@/styles/components/dashboard/websiteManager.module.css";

function getStatus(status) {
  const value = String(status ?? "").toLowerCase();

  if (["up", "online", "ok", "success"].includes(value)) {
    return { label: "En ligne", className: styles.statusUp };
  }

  if (["down", "offline", "error", "failed"].includes(value)) {
    return { label: "En panne", className: styles.statusDown };
  }

  return { label: "État inconnu", className: styles.statusUnknown };
}

export default function WebsiteManager({ websites = [] }) {
  const router = useRouter();
  const [sites, setSites] = useState(websites);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  function handleCreate(formData) {
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await createWebsite(formData);

        if (result?.error || !result?.website) {
          setMessage({
            type: "error",
            text: result?.error ?? "Les données du site sont indisponibles.",
          });
          return;
        }

        setSites((current) => [
          result.website,
          ...current.filter((site) => site.id !== result.website.id),
        ]);

        document.getElementById("website-create-form")?.reset();
        setIsFormOpen(false);

        setMessage({
          type: "success",
          text: result.success ?? "Site ajouté avec succès.",
        });

        router.refresh();
      } catch {
        setMessage({
          type: "error",
          text: "Une erreur est survenue lors de l'ajout du site.",
        });
      }
    });
  }

  function handleToggle(site) {
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await toggleWebsiteMonitoring(site.id, !site.active);

        if (result?.error) {
          setMessage({ type: "error", text: result.error });
          return;
        }

        setSites((current) =>
          current.map((item) =>
            item.id === site.id ? { ...item, active: result.active } : item,
          ),
        );

        setMessage({
          type: "success",
          text: result.active
            ? "Surveillance activée."
            : "Surveillance désactivée.",
        });

        router.refresh();
      } catch {
        setMessage({
          type: "error",
          text: "Impossible de modifier la surveillance.",
        });
      }
    });
  }

  function handleDelete(site) {
    const confirmed = window.confirm(
      `Supprimer "${site.client_name}" ? Cette action est définitive.`,
    );

    if (!confirmed) return;

    setMessage(null);

    startTransition(async () => {
      try {
        const result = await deleteWebsite(site.id);

        if (result?.error) {
          setMessage({ type: "error", text: result.error });
          return;
        }

        setSites((current) => current.filter((item) => item.id !== site.id));

        setMessage({
          type: "success",
          text: "Site supprimé avec succès.",
        });

        router.refresh();
      } catch {
        setMessage({
          type: "error",
          text: "Impossible de supprimer ce site.",
        });
      }
    });
  }

  function toggleForm() {
    if (pending) return;

    setIsFormOpen((open) => !open);
    setMessage(null);
  }

  return (
    <section className={styles.manager}>
      <div className={styles.managerHeading}>
        <div className={styles.headerContent}>
          <span className={styles.eyebrow}>CONFIGURATION</span>
          <h2>Mes sites</h2>
          <p>Consulte l’état de chaque site ou ouvre sa fiche détaillée.</p>
        </div>

        <div className={styles.headingActions}>
          <span className={styles.siteCount}>
            {sites.length} {sites.length > 1 ? "sites" : "site"}
          </span>

          <button
            type="button"
            className={`${styles.addButton} ${
              isFormOpen ? styles.addButtonOpen : ""
            }`}
            onClick={toggleForm}
            aria-expanded={isFormOpen}
            aria-controls="website-create-form"
            disabled={pending}
          >
            <span className={styles.addIcon} aria-hidden="true">
              {isFormOpen ? "−" : "+"}
            </span>
            <span>{isFormOpen ? "Fermer" : "Ajouter un site"}</span>
          </button>
        </div>
      </div>

      {isFormOpen && (
        <form
          id="website-create-form"
          action={handleCreate}
          className={styles.websiteForm}
        >
          <div className={styles.formIntro}>
            <span className={styles.formIcon} aria-hidden="true">
              +
            </span>
            <div>
              <h3>Nouveau site</h3>
              <p>Renseigne les informations pour démarrer la surveillance.</p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formField}>
              <label htmlFor="client_name">Nom du site</label>
              <input
                id="client_name"
                name="client_name"
                type="text"
                placeholder="Mon entreprise"
                maxLength={120}
                required
              />
            </div>

            <div className={styles.formField}>
              <label htmlFor="url">URL du site</label>
              <input
                id="url"
                name="url"
                type="url"
                placeholder="https://exemple.fr"
                maxLength={2048}
                required
              />
            </div>

            <div className={styles.formField}>
              <label htmlFor="notification_email">E-mail de notification</label>
              <input
                id="notification_email"
                name="notification_email"
                type="email"
                placeholder="contact@exemple.fr"
                maxLength={254}
                required
              />
            </div>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={toggleForm}
              disabled={pending}
            >
              Annuler
            </button>

            <button
              type="submit"
              className={styles.createWebsiteButton}
              disabled={pending}
            >
              {pending ? "Enregistrement..." : "Ajouter le site"}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={
            message.type === "error"
              ? styles.errorMessage
              : styles.successMessage
          }
        >
          {message.text}
        </p>
      )}

      {sites.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            +
          </span>
          <h3>Aucun site enregistré</h3>
          <p>Ajoute ton premier site pour commencer à le surveiller.</p>
          {!isFormOpen && (
            <button
              type="button"
              className={styles.emptyAddButton}
              onClick={toggleForm}
            >
              + Ajouter mon premier site
            </button>
          )}
        </div>
      ) : (
        <div className={styles.websiteList}>
          {sites.map((site) => {
            const status = getStatus(site.status);

            return (
              <article key={site.id} className={styles.websiteCard}>
                <Link
                  href={`/dashboard/${encodeURIComponent(site.slug)}`}
                  className={styles.websiteCardLink}
                  aria-label={`Voir les détails de ${site.client_name}`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.siteInitial} aria-hidden="true">
                      {(site.client_name || "S").charAt(0).toUpperCase()}
                    </span>

                    <span
                      className={`${styles.statusBadge} ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <h3>{site.client_name || "Site sans nom"}</h3>
                  <p className={styles.siteUrl}>{site.url}</p>

                  <div className={styles.cardMeta}>
                    <span>
                      <span
                        className={`${styles.monitorDot} ${
                          site.active ? styles.monitorOn : styles.monitorOff
                        }`}
                      />
                      Surveillance {site.active ? "activée" : "désactivée"}
                    </span>

                    <span className={styles.detailsLink}>
                      Voir les détails <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </Link>

                <div className={styles.websiteActions}>
                  <button
                    type="button"
                    className={
                      site.active
                        ? styles.deactivateButton
                        : styles.activateButton
                    }
                    onClick={() => handleToggle(site)}
                    disabled={pending}
                  >
                    {site.active ? "Désactiver" : "Activer"}
                  </button>

                  <button
                    type="button"
                    className={styles.deleteWebsiteButton}
                    onClick={() => handleDelete(site)}
                    disabled={pending}
                  >
                    Supprimer
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
