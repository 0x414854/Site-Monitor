"use client";

import { useActionState } from "react";
import { savePlan } from "@/app/actions/plans";
import styles from "./plans.module.css";

const initialState = { success: null, error: null };

export default function PlanEditor({ plan, featureLabels }) {
  const [state, formAction, pending] = useActionState(savePlan, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="plan_id" value={plan.id} />

      <div className={styles.formHeading}>
        <div>
          <span className={styles.planId}>{plan.id}</span>
          <h2>{plan.name}</h2>
        </div>
        <label className={styles.activeToggle}>
          <input
            type="checkbox"
            name="active"
            defaultChecked={plan.active}
          />
          Offre visible
        </label>
      </div>

      <div className={styles.fields}>
        <label>
          Nom
          <input name="name" defaultValue={plan.name} required maxLength={80} />
        </label>
        <label className={styles.wide}>
          Description
          <input
            name="description"
            defaultValue={plan.description}
            maxLength={500}
          />
        </label>
        <label>
          Prix en centimes
          <input
            name="price_cents"
            type="number"
            min="0"
            step="1"
            defaultValue={plan.price_cents}
            required
          />
        </label>
        <label>
          Devise
          <input
            name="currency"
            defaultValue={plan.currency}
            minLength={3}
            maxLength={3}
            required
          />
        </label>
        <label>
          Périodicité
          <select
            name="billing_interval"
            defaultValue={plan.billing_interval ?? ""}
          >
            <option value="">Sans facturation</option>
            <option value="month">Mensuelle</option>
            <option value="year">Annuelle</option>
          </select>
        </label>
        <label>
          Nombre maximal de sites
          <input
            name="max_sites"
            type="number"
            min="0"
            step="1"
            defaultValue={plan.max_sites}
            required
          />
        </label>
        <label>
          Historique (jours)
          <input
            name="history_days"
            type="number"
            min="1"
            step="1"
            defaultValue={plan.history_days}
            required
          />
        </label>
        <label>
          Intervalle de contrôle (heures)
          <input
            name="check_interval_hours"
            type="number"
            min="1"
            step="1"
            defaultValue={plan.check_interval_hours}
            required
          />
        </label>
        <label className={styles.wide}>
          Identifiant du prix Stripe
          <input
            name="stripe_price_id"
            defaultValue={plan.stripe_price_id ?? ""}
            placeholder="price_..."
          />
        </label>
        <label>
          Ordre d’affichage
          <input
            name="display_order"
            type="number"
            min="0"
            step="1"
            defaultValue={plan.display_order}
            required
          />
        </label>
      </div>

      <fieldset className={styles.features}>
        <legend>Fonctionnalités incluses</legend>
        {Object.entries(featureLabels).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              name={`feature_${key}`}
              defaultChecked={Boolean(plan.feature_flags?.[key])}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className={styles.success} role="status">
          {state.success}
        </p>
      )}

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le forfait"}
      </button>
    </form>
  );
}
