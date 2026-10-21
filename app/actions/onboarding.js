"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getStripe } from "@/utils/stripe";
import { getSignupIntentForUser } from "@/utils/signup-intents";

export async function updateSignupPlan(_previousState, formData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { error: "Reconnecte-toi pour continuer." };

  const intentId = String(formData.get("intent_id") ?? "");
  const planId = String(formData.get("plan_id") ?? "");
  if (!intentId || !/^[a-z0-9_-]{1,80}$/.test(planId)) {
    return { error: "Choix de forfait invalide." };
  }

  try {
    const intent = await getSignupIntentForUser(intentId, user.id);
    if (
      !intent ||
      !["payment_required", "payment_failed", "checkout_open"].includes(
        intent.status,
      )
    ) {
      return { error: "Cette inscription ne peut plus être modifiée." };
    }
    if (intent.status === "checkout_open" && !intent.checkout_session_id) {
      return {
        error:
          "Une session de paiement est en cours de préparation. Patiente quelques minutes avant de modifier le forfait.",
      };
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from("plan_catalog")
      .select("id, active, price_cents")
      .eq("id", planId)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan?.active) {
      return { error: "Ce forfait n’est plus disponible. Choisis une autre offre." };
    }

    if (intent.checkout_session_id) {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(
        intent.checkout_session_id,
      );
      if (session.status === "complete") {
        return {
          error:
            "Le paiement est déjà terminé. Attends sa confirmation avant de modifier le forfait.",
        };
      }
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(session.id);
      } else if (session.status !== "expired") {
        return {
          error:
            "La session de paiement est en cours de traitement. Réessaie dans quelques instants.",
        };
      }
    }

    const isFree = plan.price_cents === 0;
    const now = new Date().toISOString();
    const { data: updatedIntent, error: updateError } = await supabaseAdmin
      .from("signup_intents")
      .update({
        plan_id: plan.id,
        status: isFree ? "completed" : "payment_required",
        checkout_session_id: null,
        checkout_started_at: null,
        completed_at: isFree ? now : null,
        updated_at: now,
      })
      .eq("id", intent.id)
      .eq("user_id", user.id)
      .in("status", ["payment_required", "payment_failed", "checkout_open"])
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedIntent) {
      return { error: "Le forfait a changé entre-temps. Recharge la page." };
    }

    if (isFree) {
      const { error: subscriptionError } = await supabaseAdmin
        .from("user_subscriptions")
        .update({
          plan_id: "free",
          status: "active",
          stripe_subscription_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
          updated_at: now,
        })
        .eq("user_id", user.id);
      if (subscriptionError) throw subscriptionError;
    }

    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    revalidatePath("/billing");
    return { success: "Forfait mis à jour." };
  } catch (error) {
    console.error(
      "Modification du forfait d’inscription :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return { error: "Impossible de modifier le forfait. Réessaie." };
  }
}
