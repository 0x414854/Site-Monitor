"use client";

import { useState, useTransition } from "react";
import {
  createWebsite,
  toggleWebsiteMonitoring,
  deleteWebsite,
} from "@/app/actions/websites";
import styles from "@/styles/components/dashboard/websiteManager.module.css";

export default function WebsiteManager({ websites }) {
  const [sites, setSites] = useState(websites ?? []);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);

  function handleCreate(formData) {
    setMessage(null);

    startTransition(async () => {
      const result = await createWebsite(formData);

      if (result?.error) {
        setMessage({
          type: "error",
          text: result.error,
        });
        return;
      }

      if (!result?.website) {
        setMessage({
          type: "error",
          text: "Le site a été créé, mais les données retournées sont absentes.",
        });
        return;
      }

      setSites((current) => [
        result.website,
        ...current.filter((site) => site.id !== result.website.id),
      ]);

      setMessage({
        type: "success",
        text: result.success ?? "Site ajouté avec succès.",
      });
    });
  }

  function handleToggle(site) {
    setMessage(null);

    startTransition(async () => {
      const result = await toggleWebsiteMonitoring(site.id, !site.active);

      if (result?.error) {
        setMessage({
          type: "error",
          text: result.error,
        });
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
    });
  }
  function handleDelete(site) {
    const confirmed = window.confirm(
      `Veux-tu vraiment supprimer le site "${site.client_name}" ? Cette action est définitive.`,
    );

    if (!confirmed) return;

    setMessage(null);

    startTransition(async () => {
      const result = await deleteWebsite(site.id);

      if (result?.error) {
        setMessage({
          type: "error",
          text: result.error,
        });
        return;
      }

      setSites((current) => current.filter((item) => item.id !== site.id));

      setMessage({
        type: "success",
        text: "Site supprimé avec succès.",
      });
    });
  }

  return (
    <section className={styles.tableSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>CONFIGURATION</span>
          <h2>Gestion des sites</h2>
        </div>

        <span className={styles.periodBadge}>{sites.length} sites</span>
      </div>

      <form action={handleCreate} className={styles.websiteForm}>
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
            type="text"
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

        <button
          type="submit"
          className={styles.createWebsiteButton}
          disabled={pending}
        >
          {pending ? "Enregistrement..." : "Ajouter le site"}
        </button>
      </form>

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
          <h3>Aucun site enregistré</h3>
          <p>Ajoute un site avec le formulaire ci-dessus.</p>
        </div>
      ) : (
        <div className={styles.websiteList}>
          {sites.map((site) => (
            <article key={site.id} className={styles.websiteItem}>
              <div className={styles.siteInfo}>
                <strong>{site.client_name || "Site sans nom"}</strong>

                <span>{site.url}</span>

                <span>
                  Surveillance : {site.active ? "Activée" : "Désactivée"}
                </span>

                <span>
                  Statut :{" "}
                  {site.status ? String(site.status) : "Aucun contrôle connu"}
                </span>
              </div>
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
          ))}
        </div>
      )}
    </section>
  );
}
