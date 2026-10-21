import Link from "next/link";
import { getAdminPlans } from "../admin-data";
import styles from "../admin-page.module.css";
import configStyles from "./configuration.module.css";

export const dynamic = "force-dynamic";

const integrations = [
  {
    title: "Supabase",
    variables: [
      ["NEXT_PUBLIC_SUPABASE_URL", "URL du projet"],
      ["SUPABASE_PUBLIC_KEY", "Clé publique (publishable ou anon)"],
      ["SUPABASE_SERVICE_ROLE_KEY", "Clé serveur privilégiée"],
    ],
  },
  {
    title: "Stripe",
    variables: [
      ["STRIPE_SECRET_KEY", "Clé API serveur"],
      ["STRIPE_WEBHOOK_SECRET", "Signature du webhook"],
      ["NEXT_PUBLIC_SITE_URL", "URL publique de l’application"],
    ],
  },
  {
    title: "Surveillance et notifications",
    variables: [
      ["CRON_SECRET", "Protection des tâches planifiées"],
      ["RESEND_API_KEY", "Envoi des e-mails"],
      ["ALERT_FROM_EMAIL", "Adresse expéditeur"],
      ["PLATFORM_ADMIN_EMAIL", "Compte autorisé à administrer"],
    ],
  },
];

function isConfigured(variable) {
  if (variable === "SUPABASE_PUBLIC_KEY") {
    return Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return Boolean(process.env[variable]?.trim());
}

export default async function AdminConfigurationPage() {
  const plans = await getAdminPlans();
  const paidPlans = plans.filter((plan) => plan.price_cents > 0);
  const configuredStripePrices = paidPlans.filter(
    (plan) => plan.stripe_price_id,
  ).length;

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>ADMINISTRATION / SYSTÈME</span>
        <h1>Configuration</h1>
        <p>
          Vérification de présence des intégrations. Les valeurs secrètes ne
          sont jamais affichées dans cette interface.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Variables d’environnement</h2>
        </div>
        <div className={configStyles.integrationGrid}>
          {integrations.map((integration) => (
            <article className={configStyles.integration} key={integration.title}>
              <h3>{integration.title}</h3>
              {integration.variables.map(([variable, label]) => {
                const configured = isConfigured(variable);
                return (
                  <div className={styles.statusRow} key={variable}>
                    <div className={configStyles.variable}>
                      <strong>{label}</strong>
                      <code>{variable}</code>
                    </div>
                    <span
                      className={`${styles.pill} ${
                        configured ? "" : styles.pillOff
                      }`}
                    >
                      {configured ? "Configurée" : "Manquante"}
                    </span>
                  </div>
                );
              })}
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${configStyles.prices}`}>
        <div className={styles.sectionHeader}>
          <h2>Tarifs Stripe des forfaits</h2>
          <Link href="/admin/plans">Configurer les forfaits →</Link>
        </div>
        {paidPlans.length === 0 ? (
          <p className={styles.empty}>Aucun forfait payant n’est configuré.</p>
        ) : (
          <div className={configStyles.priceSummary}>
            <strong>
              {configuredStripePrices} / {paidPlans.length}
            </strong>
            <span>forfaits payants reliés à un Price ID Stripe</span>
          </div>
        )}
      </section>

      <p className={styles.notice}>
        Ces indicateurs vérifient que les variables existent dans
        l’environnement du serveur courant. Ils ne garantissent pas que les
        clés sont valides ou que les services externes sont opérationnels.
      </p>
    </main>
  );
}
