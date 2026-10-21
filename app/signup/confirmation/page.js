"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./confirmation.module.css";

const STORAGE_KEY = "site-monitor-signup-intent";
const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const visibleName = name.slice(0, Math.min(2, name.length));
  return `${visibleName}${"•".repeat(Math.max(2, name.length - visibleName.length))}@${domain}`;
}

export default function SignupConfirmationPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorType = params.get("error");
    if (errorType === "temporary") {
      setRecoveryToken(params.get("intent") ?? "");
    }
    if (errorType === "expired") {
      setError(
        "Ce lien a expiré. Connecte-toi puis choisis à nouveau ton forfait depuis ton espace de facturation.",
      );
    } else if (errorType === "email_mismatch" || errorType === "invalid") {
      setError("Ce lien ne correspond pas à ce compte. Ouvre le lien reçu à l’adresse utilisée lors de l’inscription.");
    } else if (errorType === "temporary") {
      setError("La confirmation a réussi, mais la reprise du parcours est momentanément indisponible. Connecte-toi pour continuer.");
    }
    if (["expired", "email_mismatch", "invalid"].includes(errorType)) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored?.email && stored?.token) {
        setEmail(stored.email);
        setToken(stored.token);
      }
    } catch (storageError) {
      console.error("Lecture de la reprise d’inscription :", storageError);
    }
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(
      () => setSecondsLeft((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  async function resendEmail() {
    setPending(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setSecondsLeft(RESEND_COOLDOWN_SECONDS);
        }
        throw new Error(result.error || "Impossible de renvoyer l’e-mail.");
      }

      setMessage("Un nouvel e-mail de confirmation vient d’être envoyé.");
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Le renvoi est momentanément indisponible.",
      );
    } finally {
      setPending(false);
    }
  }

  const hasIntent = Boolean(email && token);

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="confirmation-title">
        <Link href="/" className={styles.brand}>
          SITE<span>MONITOR</span>
        </Link>
        <div className={styles.icon} aria-hidden="true">
          @
        </div>
        <span className={styles.eyebrow}>UNE DERNIÈRE ÉTAPE</span>
        <h1 id="confirmation-title">Confirme ton adresse e-mail</h1>
        {hasIntent ? (
          <p>
            Nous avons envoyé un lien à <strong>{maskEmail(email)}</strong>.
            Vérifie ta boîte de réception et tes courriers indésirables.
          </p>
        ) : (
          <p>
            Ouvre le lien reçu dans l’e-mail pour reprendre ton inscription.
            Si le lien a expiré, reconnecte-toi ou recommence l’inscription.
          </p>
        )}
        <p className={styles.preservedPlan}>
          Ton forfait choisi est conservé pendant 24 heures et tu n’auras pas à
          recommencer le parcours après confirmation.
        </p>

        {message && (
          <p className={styles.success} role="status">
            {message}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {hasIntent && !error && (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={resendEmail}
            disabled={pending || secondsLeft > 0}
          >
            {pending
              ? "Envoi en cours…"
              : secondsLeft > 0
                ? `Réessayer dans ${secondsLeft} s`
                : "Renvoyer l’e-mail"}
          </button>
        )}

        {recoveryToken && (
          <Link
            href={`/auth/complete?intent=${encodeURIComponent(recoveryToken)}`}
            className={styles.secondaryLink}
          >
            Réessayer la reprise de l’inscription
          </Link>
        )}

        <Link href="/login" className={styles.secondaryLink}>
          Retour à la connexion
        </Link>
      </section>
    </main>
  );
}
