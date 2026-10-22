"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/browser";
import styles from "./auth.module.css";

const CALLBACK_PATH = "/auth/callback";
const SIGNUP_INTENT_STORAGE_KEY = "site-monitor-signup-intent";

export default function AuthForm({
  initialError,
  initialPlanId = "free",
  plans = [],
}) {
  const [mode, setMode] = useState("login");
  const [signupStep, setSignupStep] = useState(1);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    initialError === "confirmation_session"
      ? "La confirmation a peut-être été effectuée sans ouvrir ta session. Connecte-toi avec la même adresse : ton forfait choisi sera récupéré automatiquement."
      : initialError
        ? "La connexion n’a pas pu être finalisée. Réessaie."
        : "",
  );
  const [success, setSuccess] = useState(false);

  const isSignup = mode === "signup";
  const isReset = mode === "reset";
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const canContinue = Boolean(selectedPlan);

  function callbackUrl({ intentToken, nextPath } = {}) {
    const url = new URL(CALLBACK_PATH, window.location.origin);

    if (intentToken) url.searchParams.set("intent", intentToken);
    if (nextPath) url.searchParams.set("next", nextPath);

    return url.toString();
  }

  async function createSignupIntent(email = "") {
    const response = await fetch("/api/auth/signup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, planId: selectedPlanId }),
    });

    const result = await response.json();

    if (!response.ok || !result.token) {
      const error = new Error(
        result.error || "Impossible de préparer l’inscription.",
      );
      error.name = "SignupIntentError";
      throw error;
    }

    return result.token;
  }

  function getAuthMessage(error) {
    if (error?.name === "SignupIntentError") return error.message;

    const errorMessage = String(error?.message ?? "").toLowerCase();

    if (
      errorMessage.includes("already registered") ||
      errorMessage.includes("already exists")
    ) {
      return "Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.";
    }

    if (errorMessage.includes("password") && errorMessage.includes("weak")) {
      return "Choisis un mot de passe plus robuste (au moins 8 caractères).";
    }

    if (
      errorMessage.includes("rate limit") ||
      errorMessage.includes("too many")
    ) {
      return "Trop de tentatives. Attends quelques minutes avant de réessayer.";
    }

    if (errorMessage.includes("invalid login credentials")) {
      return "Adresse e-mail ou mot de passe incorrect.";
    }

    return "L’authentification n’a pas abouti. Vérifie tes informations et réessaie.";
  }

  function clearFeedback() {
    setMessage("");
    setSuccess(false);
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setSignupStep(1);
    clearFeedback();
  }

  function continueSignup() {
    if (!canContinue || pending) return;

    clearFeedback();
    setSignupStep(2);
  }

  function backToPlans() {
    if (pending) return;

    clearFeedback();
    setSignupStep(1);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearFeedback();
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    try {
      if (isSignup) {
        // Le forfait a déjà été validé à l'étape 1.
        if (signupStep !== 2 || !canContinue) {
          throw new Error("Sélectionne un forfait avant de continuer.");
        }

        const intentToken = await createSignupIntent(email);

        sessionStorage.setItem(
          SIGNUP_INTENT_STORAGE_KEY,
          JSON.stringify({ email, token: intentToken }),
        );

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callbackUrl({ intentToken }),
          },
        });

        if (error) throw error;

        if (data.user?.identities?.length === 0) {
          sessionStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY);
          setMessage(
            "Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.",
          );
          return;
        }

        if (data.session) {
          window.location.assign(
            `/auth/complete?intent=${encodeURIComponent(intentToken)}`,
          );
          return;
        }

        // Supabase attend la confirmation de l'adresse e-mail.
        window.location.assign("/signup/confirmation");
        return;
      }

      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl({
            nextPath: "/auth/update-password",
          }),
        });

        if (error) throw error;

        setSuccess(true);
        setMessage(
          "Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.",
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      window.location.assign("/auth/continue");
    } catch (error) {
      if (isSignup) {
        sessionStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY);
      }

      console.error("Authentification Supabase :", error);
      setMessage(getAuthMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function handleOAuth(provider) {
    clearFeedback();
    setPending(true);

    try {
      const supabase = createClient();
      const intentToken = isSignup ? await createSignupIntent() : null;

      if (isSignup) {
        sessionStorage.setItem(
          SIGNUP_INTENT_STORAGE_KEY,
          JSON.stringify({ email: "", token: intentToken }),
        );
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl({ intentToken }),
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error(`Authentification ${provider} :`, error);

      if (isSignup) {
        sessionStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY);
      }

      setMessage(getAuthMessage(error));
      setPending(false);
    }
  }

  function formatPlanPrice(plan) {
    if (plan.price_cents <= 0) return "Gratuit";

    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: (plan.currency || "EUR").toUpperCase(),
    }).format(plan.price_cents / 100);
  }

  function getPlanInterval(plan) {
    if (plan.price_cents <= 0) return "Sans abonnement";
    if (plan.billing_interval === "month") return "par mois";
    if (plan.billing_interval === "year") return "par an";

    return "";
  }

  const title = isReset
    ? "Réinitialiser le mot de passe"
    : isSignup
      ? signupStep === 1
        ? "Choisis ton forfait"
        : "Crée ton compte"
      : "Bon retour";

  const description = isReset
    ? "Nous t’enverrons un lien sécurisé par e-mail."
    : isSignup
      ? signupStep === 1
        ? "Trouve la formule adaptée à tes besoins."
        : "Quelques informations et tu pourras commencer."
      : "Connecte-toi pour retrouver ton espace de surveillance.";

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} aria-hidden="true" />
      <div className={styles.backgroundGlowSecondary} aria-hidden="true" />

      <section className={styles.layout} aria-labelledby="auth-title">
        <aside className={styles.introPanel}>
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

          <div className={styles.introContent}>
            <span className={styles.eyebrow}>ESPACE DE SURVEILLANCE</span>
            <h2 className={styles.introTitle}>
              Tes sites.
              <br />
              Sous contrôle.
            </h2>
            <p className={styles.introDescription}>
              Centralise la surveillance de tes sites et retrouve l’essentiel
              depuis un espace unique.
            </p>

            <div className={styles.featureList}>
              <div className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  ✓
                </span>
                <span>Un tableau de bord centralisé</span>
              </div>
              <div className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  ✓
                </span>
                <span>Une formule adaptée à tes besoins</span>
              </div>
              <div className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  ✓
                </span>
                <span>Un accès sécurisé à ton espace</span>
              </div>
            </div>
          </div>

          <p className={styles.introFooter}>
            Surveillance simplifiée, visibilité maîtrisée.
          </p>
        </aside>

        <div className={styles.card}>
          <header className={styles.header}>
            <Link href="/" className={styles.mobileBrand}>
              <span className={styles.brandMark} aria-hidden="true">
                S
              </span>
              <span className={styles.brandName}>
                SITE<span>MONITOR</span>
              </span>
            </Link>

            <Link href="/" className={styles.homeLink}>
              <span aria-hidden="true">←</span> Retour à l’accueil
            </Link>

            {isSignup && (
              <div
                className={styles.progress}
                aria-label={`Étape ${signupStep} sur 2`}
              >
                <div className={styles.progressTrack}>
                  <span
                    className={styles.progressFill}
                    style={{ width: signupStep === 1 ? "50%" : "100%" }}
                  />
                </div>
                <div className={styles.progressLabels}>
                  <span
                    className={signupStep === 1 ? styles.progressActive : ""}
                  >
                    <span>01</span> Forfait
                  </span>
                  <span
                    className={signupStep === 2 ? styles.progressActive : ""}
                  >
                    <span>02</span> Compte
                  </span>
                </div>
              </div>
            )}

            <span className={styles.eyebrow}>
              {isReset
                ? "ACCÈS AU COMPTE"
                : isSignup
                  ? "INSCRIPTION"
                  : "BON RETOUR"}
            </span>

            <h1 id="auth-title" className={styles.title}>
              {title}
            </h1>

            <p className={styles.description}>{description}</p>
          </header>

          {isSignup && signupStep === 1 && (
            <section
              className={styles.planSection}
              aria-labelledby="plan-title"
            >
              <div className={styles.planHeading}>
                <h2 id="plan-title" className={styles.sectionTitle}>
                  Sélectionne ton offre
                </h2>
                <p className={styles.sectionDescription}>
                  Tu pourras poursuivre après avoir choisi ton forfait.
                </p>
              </div>

              {plans.length > 0 ? (
                <div className={styles.planOptions}>
                  {plans.map((plan) => {
                    const isSelected = selectedPlanId === plan.id;

                    return (
                      <button
                        key={plan.id}
                        type="button"
                        className={`${styles.planOption} ${
                          isSelected ? styles.planOptionSelected : ""
                        }`}
                        onClick={() => {
                          setSelectedPlanId(plan.id);
                          clearFeedback();
                        }}
                        disabled={pending}
                        aria-pressed={isSelected}
                      >
                        <span className={styles.planOptionTop}>
                          <span className={styles.planIdentity}>
                            <span
                              className={styles.planRadio}
                              aria-hidden="true"
                            >
                              {isSelected && (
                                <span className={styles.planRadioInner} />
                              )}
                            </span>
                            <span className={styles.planName}>{plan.name}</span>
                          </span>

                          {plan.price_cents <= 0 && (
                            <span className={styles.planBadge}>
                              Pour commencer
                            </span>
                          )}
                          {/* {isSelected && (
                            <span className={styles.selectedLabel}>
                              Sélectionné
                            </span>
                          )} */}
                        </span>

                        <span className={styles.planPriceRow}>
                          <span className={styles.planPrice}>
                            {formatPlanPrice(plan)}
                          </span>
                          <span className={styles.planInterval}>
                            {getPlanInterval(plan)}
                          </span>
                        </span>

                        <span className={styles.planSelectHint}>
                          {isSelected
                            ? "Ton forfait actuel"
                            : "Choisir ce forfait"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.planEmpty}>
                  Les forfaits ne sont pas disponibles pour le moment. Réessaie
                  un peu plus tard.
                </p>
              )}

              <p className={styles.planHelp}>
                Aucun paiement n’est effectué à cette étape.
              </p>

              {message && (
                <p className={styles.error} role="alert">
                  <span aria-hidden="true">!</span>
                  <span>{message}</span>
                </p>
              )}

              <button
                className={styles.primaryButton}
                type="button"
                onClick={continueSignup}
                disabled={!canContinue || pending}
              >
                <span>Continuer</span>
                <span className={styles.buttonArrow} aria-hidden="true">
                  →
                </span>
              </button>
            </section>
          )}

          {(!isSignup || signupStep === 2) && (
            <>
              {isSignup && (
                <div className={styles.selectedPlanSummary}>
                  <div className={styles.summaryCopy}>
                    <span className={styles.summaryLabel}>TON FORFAIT</span>
                    <strong>{selectedPlan?.name}</strong>
                    <span>
                      {selectedPlan
                        ? `${formatPlanPrice(selectedPlan)}${selectedPlan.price_cents > 0 && getPlanInterval(selectedPlan) ? ` ${getPlanInterval(selectedPlan)}` : ""}`
                        : "Aucun forfait sélectionné"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.changePlanButton}
                    onClick={backToPlans}
                    disabled={pending}
                  >
                    Modifier
                  </button>
                </div>
              )}

              {!isReset && (
                <div className={styles.authMethods}>
                  <div className={styles.providers}>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => handleOAuth("google")}
                      disabled={pending}
                    >
                      <span className={styles.googleIcon} aria-hidden="true">
                        G
                      </span>
                      <span>Google</span>
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
                      <span>GitHub</span>
                    </button>
                  </div>

                  <div className={styles.divider}>
                    <span>ou avec ton e-mail</span>
                  </div>
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
                    disabled={pending}
                  />
                </div>

                {!isReset && (
                  <div className={styles.field}>
                    <div className={styles.labelRow}>
                      <label htmlFor="password">Mot de passe</label>
                      {!isSignup && (
                        <button
                          type="button"
                          className={styles.inlineLink}
                          onClick={() => changeMode("reset")}
                          disabled={pending}
                        >
                          Mot de passe oublié ?
                        </button>
                      )}
                    </div>

                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete={
                        isSignup ? "new-password" : "current-password"
                      }
                      minLength={8}
                      placeholder={
                        isSignup ? "8 caractères minimum" : "Ton mot de passe"
                      }
                      required
                      disabled={pending}
                    />
                    {isSignup && (
                      <p className={styles.fieldHint}>
                        Utilise au moins 8 caractères.
                      </p>
                    )}
                  </div>
                )}

                {message && (
                  <p
                    className={success ? styles.success : styles.error}
                    role={success ? "status" : "alert"}
                  >
                    <span aria-hidden="true">{success ? "✓" : "!"}</span>
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

              {isSignup && (
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={backToPlans}
                  disabled={pending}
                >
                  <span aria-hidden="true">←</span> Retour au choix du forfait
                </button>
              )}
            </>
          )}

          <footer className={styles.footer}>
            {isReset ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => changeMode("login")}
                disabled={pending}
              >
                ← Retour à la connexion
              </button>
            ) : (
              <p className={styles.switchMode}>
                {isSignup ? "Déjà un compte ?" : "Pas encore de compte ?"}
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => changeMode(isSignup ? "login" : "signup")}
                  disabled={pending}
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
        </div>
      </section>
    </main>
  );
}
