import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getStripe } from "@/utils/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapStripeStatus(status) {
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "active") return "active";
  if (status === "canceled") return "canceled";
  return "incomplete";
}

async function saveStripeSubscription(stripeSubscription, { canceled = false } = {}) {
  const isCanceled = canceled || stripeSubscription.status === "canceled";
  const stripeCustomerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id;
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("user_subscriptions")
    .select("user_id, plan_id")
    .eq("stripe_subscription_id", stripeSubscription.id)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const userId =
    stripeSubscription.metadata?.user_id || existing?.user_id;
  if (isCanceled && !existing) return;

  if (userId) {
    const { data: current, error: currentError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (currentError) throw currentError;

    if (
      current?.stripe_subscription_id &&
      current.stripe_subscription_id !== stripeSubscription.id
    ) {
      const currentStripeSubscription = await getStripe().subscriptions.retrieve(
        current.stripe_subscription_id,
      );

      if (
        currentStripeSubscription.created >= stripeSubscription.created ||
        isCanceled
      ) {
        return;
      }
    }
  }

  const stripePriceId =
    stripeSubscription.items?.data?.[0]?.price?.id ?? null;
  const { data: matchingPlan, error: planLookupError } = stripePriceId
    ? await supabaseAdmin
        .from("plan_catalog")
        .select("id")
        .eq("stripe_price_id", stripePriceId)
        .maybeSingle()
    : { data: null, error: null };

  if (planLookupError) throw planLookupError;
  if (stripePriceId && !matchingPlan) {
    throw new Error(
      `Le tarif Stripe ${stripePriceId} n'est associé à aucun forfait.`,
    );
  }

  const planId = isCanceled
    ? "free"
    : matchingPlan?.id ||
      stripeSubscription.metadata?.plan_id ||
      existing?.plan_id;

  if (!userId || !planId) {
    throw new Error(
      `Métadonnées utilisateur/forfait manquantes pour l'abonnement ${stripeSubscription.id}.`,
    );
  }

  const { error } = await supabaseAdmin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      plan_id: planId,
      status: isCanceled ? "active" : mapStripeStatus(stripeSubscription.status),
      stripe_customer_id: stripeCustomerId ?? null,
      stripe_subscription_id: isCanceled ? null : stripeSubscription.id,
      current_period_end: isCanceled
        ? null
        : stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
          : null,
      cancel_at_period_end: isCanceled
        ? false
        : Boolean(stripeSubscription.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;

  const signupIntentId = stripeSubscription.metadata?.signup_intent_id;
  if (signupIntentId && !isCanceled) {
    const intentCompleted = ["active", "trialing"].includes(
      stripeSubscription.status,
    );
    const intentFailed = ["past_due", "unpaid"].includes(
      stripeSubscription.status,
    );

    if (intentCompleted || intentFailed) {
      const nextIntentStatus = intentCompleted ? "completed" : "payment_failed";
      const { data: updatedIntent, error: intentUpdateError } =
        await supabaseAdmin
          .from("signup_intents")
          .update({
            status: nextIntentStatus,
            completed_at: intentCompleted ? new Date().toISOString() : null,
            checkout_session_id: null,
            checkout_started_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", signupIntentId)
          .eq("user_id", userId)
          .eq("plan_id", planId)
          .in("status", [
            "payment_required",
            "checkout_open",
            "payment_failed",
          ])
          .select("id")
          .maybeSingle();

      if (intentUpdateError) throw intentUpdateError;
      if (!updatedIntent) {
        const { data: existingIntent, error: intentLookupError } =
          await supabaseAdmin
            .from("signup_intents")
            .select("status, user_id, plan_id")
            .eq("id", signupIntentId)
            .maybeSingle();
        if (intentLookupError) throw intentLookupError;
        const alreadyCompleted =
          existingIntent?.status === "completed" &&
          existingIntent.user_id === userId;
        if (!alreadyCompleted) {
          throw new Error(
            `L'intention d'inscription ${signupIntentId} ne correspond pas à l'abonnement Stripe.`,
          );
        }
      }
    }
  }
}

async function handleEvent(event) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

    if (!subscriptionId) {
      throw new Error("La session Checkout ne contient pas d'abonnement.");
    }

    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    await saveStripeSubscription(subscription);
    return;
  }

  if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object;
    const intentId = session.metadata?.signup_intent_id;
    if (!intentId) return;

    const isFailed = event.type === "checkout.session.async_payment_failed";
    const { error } = await supabaseAdmin
      .from("signup_intents")
      .update({
        status: isFailed ? "payment_failed" : "payment_required",
        checkout_session_id: null,
        checkout_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", intentId)
      .eq("checkout_session_id", session.id)
      .eq("status", "checkout_open");
    if (error) throw error;
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const subscription = await getStripe().subscriptions.retrieve(
      event.data.object.id,
    );
    await saveStripeSubscription(subscription);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    await saveStripeSubscription(event.data.object, { canceled: true });
    return;
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const subscriptionId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id;

    if (subscriptionId) {
      const subscription =
        await getStripe().subscriptions.retrieve(subscriptionId);
      await saveStripeSubscription(subscription);
    }
  }
}

export async function POST(request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error("Signature ou secret webhook Stripe manquant.");
    return NextResponse.json(
      { error: "Configuration webhook indisponible." },
      { status: 400 },
    );
  }

  let event;

  try {
    const body = await request.text();
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error(
      "Vérification de la signature webhook Stripe :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  try {
    const { data: claimStatus, error: claimError } = await supabaseAdmin.rpc(
      "claim_stripe_webhook_event",
      { p_event_id: event.id, p_event_type: event.type },
    );
    if (claimError) throw claimError;
    if (claimStatus === "processed") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claimStatus !== "claimed") {
      return NextResponse.json(
        { error: "Événement webhook déjà en cours." },
        { status: 500 },
      );
    }

    await handleEvent(event);
    const { error: completeError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("event_id", event.id);
    if (completeError) throw completeError;
    return NextResponse.json({ received: true });
  } catch (error) {
    const { error: eventError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "failed",
        last_error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Erreur inconnue",
      })
      .eq("event_id", event.id)
      .neq("status", "processed");
    if (eventError) {
      console.error("Mise à jour de l’état du webhook :", eventError.message);
    }
    console.error(
      `Traitement webhook Stripe ${event.id} (${event.type}) :`,
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.json(
      { error: "Traitement webhook impossible." },
      { status: 500 },
    );
  }
}
