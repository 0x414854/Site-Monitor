"use client";

import { useActionState } from "react";
import { updateSignupPlan } from "@/app/actions/onboarding";
import styles from "./onboarding.module.css";

const initialState = { error: null, success: null };

function formatPrice(plan) {
  const price = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(plan.price_cents / 100);
  if (plan.price_cents === 0) return "Gratuit";
  return `${price} / ${plan.billing_interval === "year" ? "an" : "mois"}`;
}

export default function PlanSelector({ intentId, selectedPlanId, plans }) {
  const [state, formAction, pending] = useActionState(
    updateSignupPlan,
    initialState,
  );

  return (
    <section className={styles.planCard}>
      <div className={styles.planHeader}>
        <div>
          <span className={styles.label}>FORFAIT SÉLECTIONNÉ</span>
          <h2>{plans.find((plan) => plan.id === selectedPlanId)?.name ?? "Offre"}</h2>
        </div>
        <strong className={styles.price}>
          {formatPrice(
            plans.find((plan) => plan.id === selectedPlanId) ?? {
              currency: "eur",
              price_cents: 0,
            },
          )}
        </strong>
      </div>

      <form action={formAction} className={styles.changePlan}>
        <input type="hidden" name="intent_id" value={intentId} />
        <label htmlFor="onboarding-plan">Modifier le forfait avant de payer</label>
        <div className={styles.changePlanRow}>
          <select
            id="onboarding-plan"
            name="plan_id"
            defaultValue={selectedPlanId}
            disabled={pending}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {formatPrice(plan)} · {plan.max_sites} site(s)
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending}>
            {pending ? "Mise à jour…" : "Mettre à jour"}
          </button>
        </div>
        {state.error && (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className={styles.success} role="status">
            {state.success} Recharge la page pour afficher le récapitulatif à jour.
          </p>
        )}
      </form>

      <div className={styles.entitlements}>
        <span>Jusqu’à {plans.find((plan) => plan.id === selectedPlanId)?.max_sites ?? 0} site(s)</span>
        <span>
          {plans.find((plan) => plan.id === selectedPlanId)?.history_days ?? 0} jours
          d’historique
        </span>
      </div>
    </section>
  );
}
