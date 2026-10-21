"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getStripe } from "@/utils/stripe";
import { isPlatformAdmin } from "@/utils/platform-admin";

const FEATURE_KEYS = [
  "http",
  "ssl",
  "dns",
  "security_headers",
  "integrity",
  "advanced_alerts",
  "multi_site",
];

export async function savePlan(_previousState, formData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !isPlatformAdmin(user)) {
    return { error: "Accès non autorisé." };
  }

  const id = String(formData.get("plan_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceCents = Number(formData.get("price_cents"));
  const currency = String(formData.get("currency") ?? "").trim().toLowerCase();
  const billingIntervalValue = String(
    formData.get("billing_interval") ?? "",
  ).trim();
  const maxSites = Number(formData.get("max_sites"));
  const historyDays = Number(formData.get("history_days"));
  const checkIntervalHours = Number(formData.get("check_interval_hours"));
  const stripePriceId =
    String(formData.get("stripe_price_id") ?? "").trim() || null;
  const displayOrder = Number(formData.get("display_order"));
  const active = formData.get("active") === "on";

  if (
    !id ||
    !name ||
    name.length > 80 ||
    description.length > 500 ||
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    !/^[a-z]{3}$/.test(currency) ||
    !["", "month", "year"].includes(billingIntervalValue) ||
    (priceCents > 0 && !billingIntervalValue) ||
    !Number.isSafeInteger(maxSites) ||
    maxSites < 0 ||
    !Number.isSafeInteger(historyDays) ||
    historyDays < 1 ||
    !Number.isSafeInteger(checkIntervalHours) ||
    checkIntervalHours < 1 ||
    !Number.isSafeInteger(displayOrder) ||
    displayOrder < 0
  ) {
    return { error: "Vérifie les valeurs saisies pour ce forfait." };
  }

  if (stripePriceId) {
    try {
      const stripePrice = await getStripe().prices.retrieve(stripePriceId);

      if (
        !stripePrice.active ||
        stripePrice.unit_amount !== priceCents ||
        stripePrice.currency.toLowerCase() !== currency ||
        stripePrice.recurring?.interval !== billingIntervalValue
      ) {
        return {
          error:
            "Le tarif Stripe doit être actif et correspondre au prix, à la devise et à la périodicité saisis.",
        };
      }
    } catch (error) {
      console.error("Validation du tarif Stripe :", error);
      return {
        error: "Impossible de vérifier le tarif Stripe. Vérifie son identifiant.",
      };
    }
  }

  const featureFlags = Object.fromEntries(
    FEATURE_KEYS.map((key) => [
      key,
      formData.get(`feature_${key}`) === "on",
    ]),
  );

  const { error } = await supabaseAdmin
    .from("plan_catalog")
    .update({
      name,
      description,
      price_cents: priceCents,
      currency,
      billing_interval: billingIntervalValue || null,
      stripe_price_id: stripePriceId,
      max_sites: maxSites,
      history_days: historyDays,
      check_interval_hours: checkIntervalHours,
      feature_flags: featureFlags,
      display_order: displayOrder,
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error(`Mise à jour du forfait ${id} :`, error.message);
    return { error: "Impossible d’enregistrer ce forfait." };
  }

  revalidatePath("/");
  revalidatePath("/login");
  revalidatePath("/billing");
  revalidatePath("/admin/plans");

  return { success: `Forfait ${name} enregistré.` };
}
