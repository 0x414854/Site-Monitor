import Link from "next/link";
import { getAdminPlans } from "../admin-data";
import PlanEditor from "./planEditor";
import styles from "./plans.module.css";

export const dynamic = "force-dynamic";

const featureLabels = {
  http: "Surveillance HTTP",
  ssl: "Contrôle SSL",
  dns: "Contrôle DNS",
  security_headers: "En-têtes de sécurité",
  integrity: "Contrôle d’intégrité",
  advanced_alerts: "Alertes SSL, DNS et domaine avancées",
  multi_site: "Vue multi-sites",
};

export default async function PlanAdminPage() {
  const plans = await getAdminPlans();

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/billing" className={styles.backLink}>
          ← Retour à la facturation
        </Link>
        <Link href="/admin" className={styles.backLink}>
          Vue d’ensemble admin →
        </Link>

        <header className={styles.header}>
          <span className={styles.eyebrow}>ADMINISTRATION</span>
          <h1>Catalogue des forfaits</h1>
          <p>
            Les modifications s’appliquent aux nouveaux droits. Configure le
            même prix récurrent dans Stripe avant d’enregistrer son identifiant.
          </p>
        </header>

        <div className={styles.planList}>
          {plans.map((plan) => (
            <PlanEditor
              key={plan.id}
              plan={plan}
              featureLabels={featureLabels}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
