"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/browser";
import styles from "@/app/login/auth.module.css";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Réinitialisation du mot de passe :", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le mot de passe.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.eyebrow}>SÉCURITÉ DU COMPTE</span>
        <h1>Nouveau mot de passe</h1>
        <p className={styles.description}>
          Choisis un mot de passe d’au moins 8 caractères.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {message && (
            <p className={styles.error} role="alert">
              {message}
            </p>
          )}
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={pending}
          >
            {pending ? "Enregistrement…" : "Enregistrer le mot de passe"}
          </button>
        </form>
      </section>
    </main>
  );
}
