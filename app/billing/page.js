import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { isPlatformAdmin } from "@/utils/platform-admin";
import styles from "./billing.module.css";

export const dynamic = "force-dynamic";

function getMessage(params) {
  if (params?.checkout === "success") {
    return "Retour reçu de Stripe. Le forfait sera activé après confirmation du paiement par le webhook.";
  }
  if (params?.checkout === "cancelled") {
    return "Le paiement a été annulé. Ton forfait actuel n’a pas changé.";
  }
  if (params?.error === "plan_not_configured") {
    return "Ce forfait n’est pas encore relié à un tarif Stripe.";
  }
  if (params?.error === "plan_unavailable") {
    return "Le forfait demandé n’est pas disponible pour le moment.";
  }
  if (params?.error === "checkout_failed") {
    return "Impossible de démarrer le paiement. Réessaie ou contacte le support.";
  }
  if (params?.error) {
    return "La gestion de l’abonnement est momentanément indisponible.";
  }
  return null;
}

export default async function BillingPage({ searchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect("/login");

  const [
    { data: subscription, error: subscriptionError },
    { data: plans, error: plansError },
    { count: siteCount, error: siteCountError },
  ] = await Promise.all([
    supabase
      .from("user_subscriptions")
      .select(
        "plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id, plan_catalog(name, price_cents, currency, billing_interval, max_sites, history_days, feature_flags)",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("plan_catalog")
      .select("id, name, price_cents, currency, billing_interval, max_sites, active")
      .eq("active", true)
      .order("display_order", { ascending: true }),
    supabase
      .from("websites")
      .select("id", { count: "exact", head: true }),
  ]);

  const error = subscriptionError || plansError || siteCountError;

  if (error) {
    console.error("Chargement de la facturation :", error.message);
    throw new Error("Impossible de charger les informations de forfait.");
  }

  if (!subscription?.plan_catalog) {
    throw new Error("Aucun abonnement n’est associé à ce compte.");
  }

  const plan = subscription.plan_catalog;
  const siteLimit = Number(plan.max_sites);
  const platformAdmin = isPlatformAdmin(user);
  const isPaid =
    subscription.plan_id !== "free" &&
    ["active", "trialing", "past_due"].includes(subscription.status);
  const message = getMessage(params);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/dashboard" className={styles.backLink}>
          ← Retour au dashboard
        </Link>
        {platformAdmin && (
          <Link href="/admin" className={styles.backLink}>
            Espace administration →
          </Link>
        )}

        <header className={styles.header}>
          <span className={styles.eyebrow}>COMPTE & FACTURATION</span>
          <h1>Ton abonnement</h1>
          <p>Consulte ton forfait et ajuste-le selon tes besoins.</p>
        </header>

        {message && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}
        {(siteCount ?? 0) > siteLimit && (
          <p className={styles.message} role="status">
            Ton forfait autorise {siteLimit} site(s). Les sites en excédent
            restent dans ton compte, mais seuls les {siteLimit} plus anciens
            sont contrôlés.
          </p>
        )}

        <section className={styles.currentPlan}>
          <div>
            <span className={styles.label}>Forfait actuel</span>
            <h2>{plan.name}</h2>
            <p>
              {new Intl.NumberFormat("fr-FR", {
                style: "currency",
                currency: plan.currency.toUpperCase(),
                maximumFractionDigits: 2,
              }).format(plan.price_cents / 100)}
              {plan.billing_interval === "month"
                ? " / mois"
                : plan.billing_interval === "year"
                  ? " / an"
                  : " · pour toujours"}
            </p>
          </div>

          <div className={styles.usage}>
            <span className={styles.label}>Sites surveillés</span>
            <strong>
              {siteCount ?? 0} / {siteLimit}
            </strong>
          </div>

          <div className={styles.planStatus}>
            <span className={styles.label}>État</span>
            <strong>
              {subscription.status === "active"
                ? "Actif"
                : subscription.status === "trialing"
                  ? "Période d’essai"
                  : subscription.status === "past_due"
                    ? "Paiement à régulariser"
                    : subscription.status}
            </strong>
            {subscription.current_period_end && (
              <small>
                {subscription.cancel_at_period_end
                  ? "Fin de période : "
                  : "Prochaine échéance : "}
                {new Intl.DateTimeFormat("fr-FR", {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(subscription.current_period_end))}
              </small>
            )}
          </div>
        </section>

        {isPaid && (
          <a className={styles.portalButton} href="/api/billing/portal">
            Gérer mon abonnement et mon moyen de paiement
          </a>
        )}

        <section className={styles.planSection}>
          <div className={styles.sectionHeading}>
            <span className={styles.eyebrow}>FAIS ÉVOLUER TON COMPTE</span>
            <h2>Choisir un forfait</h2>
            <p>
              Les changements de forfait payant et les annulations se gèrent
              depuis le portail sécurisé de facturation.
            </p>
          </div>

          <div className={styles.planGrid}>
            {(plans ?? []).map((availablePlan) => {
              const isCurrent = availablePlan.id === subscription.plan_id;

              return (
                <article
                  key={availablePlan.id}
                  className={`${styles.planCard} ${
                    isCurrent ? styles.planCardCurrent : ""
                  }`}
                >
                  <div>
                    <h3>{availablePlan.name}</h3>
                    <strong>
                      {new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: availablePlan.currency.toUpperCase(),
                        maximumFractionDigits: 2,
                      }).format(availablePlan.price_cents / 100)}
                      <small>
                        {availablePlan.billing_interval === "month"
                          ? " / mois"
                          : availablePlan.billing_interval === "year"
                            ? " / an"
                            : " · pour toujours"}
                      </small>
                    </strong>
                    <p>
                      Jusqu’à {availablePlan.max_sites} site
                      {availablePlan.max_sites > 1 ? "s" : ""}
                    </p>
                  </div>

                  {isCurrent ? (
                    <span className={styles.currentBadge}>Forfait actuel</span>
                  ) : isPaid ? (
                    <a className={styles.planButton} href="/api/billing/portal">
                      Changer dans Stripe
                    </a>
                  ) : availablePlan.price_cents === 0 ? (
                    <span className={styles.mutedAction}>
                      Inclus comme forfait de départ
                    </span>
                  ) : (
                    <a
                      className={styles.planButton}
                      href={`/api/billing/checkout?plan=${encodeURIComponent(availablePlan.id)}`}
                    >
                      Choisir {availablePlan.name}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
