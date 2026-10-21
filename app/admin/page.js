import Link from "next/link";
import {
  getAdminPlans,
  getExactCount,
  getTotalAuthUserCount,
} from "./admin-data";
import styles from "./admin-page.module.css";

export const dynamic = "force-dynamic";

const BILLABLE_STATUSES = ["active", "trialing"];
const CURRENT_STATUSES = ["active", "trialing", "past_due"];

function formatCurrency(cents, currency) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function AdminOverviewPage() {
  const [users, sites, plans] = await Promise.all([
    getTotalAuthUserCount(),
    getExactCount("websites"),
    getAdminPlans(),
  ]);
  const [activeSubscriptions, planCounts] = await Promise.all([
    getExactCount("user_subscriptions", [["status", CURRENT_STATUSES]]),
    Promise.all(
      plans.map(async (plan) => [
        plan.id,
        await getExactCount("user_subscriptions", [
          ["plan_id", plan.id],
          ["status", CURRENT_STATUSES],
        ]),
      ]),
    ),
  ]);

  const planCountMap = new Map(planCounts);
  const revenueCounts = await Promise.all(
    plans.map(async (plan) => [
      plan.id,
      await getExactCount("user_subscriptions", [
        ["plan_id", plan.id],
        ["status", BILLABLE_STATUSES],
      ]),
    ]),
  );
  const revenueCountMap = new Map(revenueCounts);
  const paidSubscriptions = revenueCounts.reduce(
    (total, [, count]) => total + count,
    0,
  );
  const monthlyByCurrency = new Map();
  for (const plan of plans) {
    if (plan.price_cents <= 0 || !plan.billing_interval) continue;
    const monthlyPrice =
      plan.billing_interval === "year"
        ? Math.round(plan.price_cents / 12)
        : plan.price_cents;
    const planRevenue = (revenueCountMap.get(plan.id) ?? 0) * monthlyPrice;
    if (planRevenue > 0) {
      const currency = plan.currency.toLowerCase();
      monthlyByCurrency.set(
        currency,
        (monthlyByCurrency.get(currency) ?? 0) + planRevenue,
      );
    }
  }
  const monthlyEstimate = monthlyByCurrency.size
    ? [...monthlyByCurrency].map(([currency, amount]) =>
        formatCurrency(amount, currency),
      )
    : formatCurrency(
        0,
        plans.find((plan) => plan.price_cents > 0)?.currency ?? "eur",
      );

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>ADMINISTRATION</span>
        <h1>Vue d’ensemble</h1>
        <p>
          Vue globale du service. Les données restent en lecture seule ici;
          utilise les sections dédiées pour gérer les forfaits et comptes.
        </p>
      </header>

      <section className={styles.stats} aria-label="Indicateurs globaux">
        <article className={styles.card}>
          <span>Comptes créés</span>
          <strong>{users.toLocaleString("fr-FR")}</strong>
          <small>Comptes Supabase Auth</small>
        </article>
        <article className={styles.card}>
          <span>Abonnements en cours</span>
          <strong>{activeSubscriptions.toLocaleString("fr-FR")}</strong>
          <small>Actifs, en essai ou à régulariser</small>
        </article>
        <article className={styles.card}>
          <span>Sites enregistrés</span>
          <strong>{sites.toLocaleString("fr-FR")}</strong>
          <small>Tous comptes confondus</small>
        </article>
        <article className={styles.card}>
          <span>MRR théorique</span>
          <strong>{monthlyEstimate}</strong>
          <small>
            Basé sur {paidSubscriptions} forfait(s) actif(s)/en essai; hors
            taxes, remises et échecs de paiement.
          </small>
        </article>
      </section>

      <div className={styles.columns}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Abonnements par forfait</h2>
            <Link href="/admin/plans">Gérer les offres →</Link>
          </div>
          <div className={styles.planList}>
            {plans.map((plan) => (
              <div className={styles.planRow} key={plan.id}>
                <div className={styles.planName}>
                  <strong>{plan.name}</strong>
                  <small>
                    {plan.price_cents > 0
                      ? `${formatCurrency(plan.price_cents, plan.currency)} / ${plan.billing_interval === "year" ? "an" : "mois"}`
                      : "Gratuit"}
                    {plan.stripe_price_id ? " · Stripe configuré" : ""}
                  </small>
                </div>
                <span>{planCountMap.get(plan.id) ?? 0}</span>
              </div>
            ))}
            {plans.length === 0 && (
              <p className={styles.empty}>Aucun forfait n’est configuré.</p>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Accès rapides</h2>
          </div>
          <div className={styles.planList}>
            <div className={styles.statusRow}>
              <span>Comptes et abonnements</span>
              <Link className={styles.rowLink} href="/admin/users">
                Consulter →
              </Link>
            </div>
            <div className={styles.statusRow}>
              <span>Forfaits et tarifs</span>
              <Link className={styles.rowLink} href="/admin/plans">
                Configurer →
              </Link>
            </div>
            <div className={styles.statusRow}>
              <span>État des intégrations</span>
              <Link className={styles.rowLink} href="/admin/configuration">
                Vérifier →
              </Link>
            </div>
          </div>
          <p className={styles.notice}>
            Le MRR affiché est une estimation basée sur les abonnements en base,
            pas un relevé comptable Stripe.
          </p>
        </section>
      </div>
    </main>
  );
}
