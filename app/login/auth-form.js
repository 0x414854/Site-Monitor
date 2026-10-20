"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/browser";
import styles from "./auth.module.css";

const CALLBACK_PATH = "/auth/callback";

export default function AuthForm({ initialError }) {
  const [mode, setMode] = useState("login");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    initialError ? "La connexion n’a pas pu être finalisée. Réessaie." : "",
  );
  const [success, setSuccess] = useState(false);

  function callbackUrl(nextPath) {
    const url = new URL(CALLBACK_PATH, window.location.origin);
    if (nextPath) url.searchParams.set("next", nextPath);
    return url.toString();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callbackUrl(),
          },
        });

        if (error) throw error;

        if (data.session) {
          window.location.assign("/dashboard");
          return;
        }

        setSuccess(true);
        setMessage(
          "Compte créé. Consulte ta boîte e-mail pour confirmer ton adresse.",
        );
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl("/auth/update-password"),
        });

        if (error) throw error;

        setSuccess(true);
        setMessage(
          "Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        window.location.assign("/dashboard");
      }
    } catch (error) {
      console.error("Authentification Supabase :", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue pendant l’authentification.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleOAuth(provider) {
    setMessage("");
    setPending(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl(),
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error(`Connexion ${provider} :`, error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de démarrer la connexion.",
      );
      setPending(false);
    }
  }

  const isReset = mode === "reset";
  const isSignup = mode === "signup";

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} aria-hidden="true" />

      <section className={styles.card} aria-labelledby="auth-title">
        <header className={styles.header}>
          <Link
            href="/"
            className={styles.brand}
            aria-label="SiteMonitor, accueil"
          >
            <span className={styles.brandMark} aria-hidden="true">
              S
            </span>
            <span className={styles.brandName}>
              SITE<span>MONITOR</span>
            </span>
          </Link>

          <span className={styles.eyebrow}>ESPACE DE SURVEILLANCE</span>

          <h1 id="auth-title" className={styles.title}>
            {isReset
              ? "Réinitialiser le mot de passe"
              : isSignup
                ? "Créer un compte"
                : "Bon retour"}
          </h1>

          <p className={styles.description}>
            {isReset
              ? "Nous t’enverrons un lien sécurisé par e-mail."
              : isSignup
                ? "Crée un compte pour commencer à surveiller tes sites."
                : "Connecte-toi pour accéder à ton dashboard."}
          </p>
        </header>

        {!isReset && (
          <div className={styles.providers}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={pending}
            >
              <span className={styles.providerIcon} aria-hidden="true">
                G
              </span>
              <span>Continuer avec Google</span>
            </button>

            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => handleOAuth("github")}
              disabled={pending}
            >
              <svg
                className={styles.githubIcon}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.29-1.23-1.63-1.23-1.63-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.62 1.21 3.26.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.53 0-1.22.44-2.21 1.15-2.99-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.53.23 2.67.12 2.95.71.78 1.14 1.77 1.14 2.99 0 4.3-2.62 5.25-5.11 5.52.4.35.75 1.02.75 2.06v3.1c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
              </svg>
              <span>Continuer avec GitHub</span>
            </button>
          </div>
        )}

        {!isReset && (
          <div className={styles.divider}>
            <span>ou continuer avec ton e-mail</span>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="email">Adresse e-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder="nom@exemple.fr"
              required
            />
          </div>

          {!isReset && (
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor="password">Mot de passe</label>

                {mode === "login" && (
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={() => {
                      setMode("reset");
                      setMessage("");
                    }}
                  >
                    Oublié ?
                  </button>
                )}
              </div>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                placeholder={
                  isSignup ? "8 caractères minimum" : "Ton mot de passe"
                }
                required
              />
            </div>
          )}

          {message && (
            <p
              className={success ? styles.success : styles.error}
              role={success ? "status" : "alert"}
            >
              <span className={styles.messageIcon} aria-hidden="true">
                {success ? "✓" : "!"}
              </span>
              <span>{message}</span>
            </p>
          )}

          <button
            className={styles.primaryButton}
            type="submit"
            disabled={pending}
          >
            <span>
              {pending
                ? "Patiente…"
                : isReset
                  ? "Envoyer le lien"
                  : isSignup
                    ? "Créer mon compte"
                    : "Se connecter"}
            </span>
            {!pending && (
              <span className={styles.buttonArrow} aria-hidden="true">
                →
              </span>
            )}
          </button>
        </form>

        <footer className={styles.footer}>
          {isReset ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
            >
              ← Retour à la connexion
            </button>
          ) : (
            <p className={styles.switchMode}>
              {isSignup ? "Déjà un compte ?" : "Pas encore de compte ?"}
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  setMode(isSignup ? "login" : "signup");
                  setMessage("");
                }}
              >
                {isSignup ? "Se connecter" : "Créer un compte"}
              </button>
            </p>
          )}

          <p className={styles.securityNote}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Connexion sécurisée
          </p>
        </footer>
      </section>
    </main>
  );
}
