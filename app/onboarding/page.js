import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getPendingSignupIntent } from "@/utils/signup-intents";
import PlanSelector from "./plan-selector";
import styles from "./onboarding.module.css";

export const dynamic = "force-dynamic";

function getNotice(params) {
  if (params?.checkout === "cancelled") {
    return "Le paiement a été interrompu. Ton forfait est conservé; tu peux reprendre quand tu veux.";
  }
  if (params?.error === "checkout_failed") {
    return "La session de paiement n’a pas pu être créée. Vérifie la configuration Stripe ou réessaie.";
  }
  return null;
}

export default async function OnboardingPage({ searchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const intent = await getPendingSignupIntent(user.id);
  if (!intent) redirect("/dashboard");

  const { data: plans, error: plansError } = await supabaseAdmin
    .from("plan_catalog")
    .select(
      "id, name, description, price_cents, currency, billing_interval, max_sites, history_days, check_interval_hours, feature_flags, stripe_price_id, active",
    )
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (plansError) {
    console.error("Chargement des forfaits pour la reprise :", plansError.message);
    throw new Error("Impossible de charger les forfaits disponibles.");
  }

  const plan = intent.plan_catalog;
  if (!plan) throw new Error("Le forfait choisi n’existe plus.");
  const notice = getNotice(params);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.brand}>
          SITE<span>MONITOR</span>
        </Link>
        <header className={styles.header}>
          <span className={styles.eyebrow}>INSCRIPTION / ÉTAPE 2 SUR 2</span>
          <h1>Ton compte est prêt</h1>
          <p>
            {user.email ? `Connecté en tant que ${user.email}. ` : ""}
            Confirme ton forfait avant de continuer.
          </p>
        </header>

        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}

        <PlanSelector
          intentId={intent.id}
          selectedPlanId={intent.plan_id}
          plans={plans ?? []}
        />

        {plan.price_cents > 0 && !plan.stripe_price_id && (
          <p className={styles.error} role="alert">
            Ce forfait n’est pas encore configuré pour le paiement. Choisis une
            autre offre ou réessaie plus tard.
          </p>
        )}

        {plan.price_cents === 0 ? (
          <form action="/api/onboarding/complete-free" method="POST">
            <button className={styles.primaryButton} type="submit">
              Continuer avec le forfait gratuit
            </button>
          </form>
        ) : (
          <form action="/api/onboarding/checkout" method="POST">
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={!plan.active || !plan.stripe_price_id}
            >
              Passer au paiement sécurisé
            </button>
          </form>
        )}

        <p className={styles.footerNote}>
          Le forfait payant ne sera activé qu’après confirmation par Stripe.
          <Link href="/login"> Tu peux aussi te déconnecter et reprendre plus tard.</Link>
        </p>
      </div>
    </main>
  );
}
