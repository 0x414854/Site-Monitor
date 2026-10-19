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
      <section className={styles.card}>
        <Link href="/" className={styles.brand}>
          SITE<span>MONITOR</span>
        </Link>

        <span className={styles.eyebrow}>ESPACE DE SURVEILLANCE</span>
        <h1>
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

        {!isReset && (
          <div className={styles.providers}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={pending}
            >
              Continuer avec Google
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => handleOAuth("github")}
              disabled={pending}
            >
              Continuer avec GitHub
            </button>
          </div>
        )}

        {!isReset && <div className={styles.divider}>ou par e-mail</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />

          {!isReset && (
            <>
              <label htmlFor="password">Mot de passe</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </>
          )}

          {message && (
            <p
              className={success ? styles.success : styles.error}
              role={success ? "status" : "alert"}
            >
              {message}
            </p>
          )}

          <button
            className={styles.primaryButton}
            type="submit"
            disabled={pending}
          >
            {pending
              ? "Patiente…"
              : isReset
                ? "Envoyer le lien"
                : isSignup
                  ? "Créer mon compte"
                  : "Se connecter"}
          </button>
        </form>

        {mode === "login" && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setMode("reset");
              setMessage("");
            }}
          >
            Mot de passe oublié ?
          </button>
        )}

        <p className={styles.switchMode}>
          {isReset ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
            >
              Retour à la connexion
            </button>
          ) : (
            <>
              {isSignup ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
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
            </>
          )}
        </p>
      </section>
    </main>
  );
}
