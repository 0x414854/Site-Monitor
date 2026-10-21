import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getStripe } from "@/utils/stripe";
import {
  getPendingSignupIntent,
  reserveSignupCheckout,
  resetSignupCheckout,
  saveSignupCheckoutSession,
} from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

function getSiteUrl(request) {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredUrl) return new URL(configuredUrl);
  if (process.env.VERCEL_URL) return new URL(`https://${process.env.VERCEL_URL}`);
  return new URL(request.url).origin;
}

function redirectWithError(request, error) {
  const url = new URL("/onboarding", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function priceMatchesPlan(price, plan) {
  const expectedInterval =
    plan.billing_interval === "year" ? "year" : "month";
  return (
    price.active &&
    price.type === "recurring" &&
    price.unit_amount === plan.price_cents &&
    price.currency.toLowerCase() === plan.currency.toLowerCase() &&
    price.recurring?.interval === expectedInterval &&
    price.recurring?.interval_count === 1
  );
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Requête non autorisée." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  try {
    const intent = await getPendingSignupIntent(user.id);
    if (!intent || !intent.plan_catalog) {
      return NextResponse.redirect(new URL("/dashboard", request.url), 303);
    }

    if (intent.status === "checkout_open" && intent.checkout_session_id) {
      const stripe = getStripe();
      const existingSession = await stripe.checkout.sessions.retrieve(
        intent.checkout_session_id,
      );
      if (existingSession.status === "open" && existingSession.url) {
        return NextResponse.redirect(existingSession.url, 303);
      }
      if (existingSession.status === "complete") {
        return NextResponse.redirect(
          new URL("/onboarding/complete", request.url),
          303,
        );
      }
      if (existingSession.status !== "expired") {
        return redirectWithError(request, "checkout_failed");
      }
      await resetSignupCheckout(intent.id);
    }

    const refreshedIntent = await getPendingSignupIntent(user.id);
    if (!refreshedIntent?.plan_catalog?.active) {
      return redirectWithError(request, "checkout_failed");
    }
    const { plan_catalog: plan } = refreshedIntent;
    if (!plan.stripe_price_id || plan.price_cents <= 0) {
      return redirectWithError(request, "checkout_failed");
    }

    const stripe = getStripe();
    const stripePrice = await stripe.prices.retrieve(plan.stripe_price_id);
    if (!priceMatchesPlan(stripePrice, plan)) {
      console.error(
        `Le tarif Stripe configuré ne correspond pas au forfait ${plan.id}.`,
      );
      return redirectWithError(request, "checkout_failed");
    }

    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    if (subscription?.stripe_subscription_id) {
      return NextResponse.redirect(new URL("/billing", request.url), 303);
    }

    const attempt = await reserveSignupCheckout(refreshedIntent.id);
    if (attempt == null) return redirectWithError(request, "checkout_failed");

    const siteUrl = getSiteUrl(request);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        client_reference_id: user.id,
        customer: subscription?.stripe_customer_id ?? undefined,
        customer_email: subscription?.stripe_customer_id
          ? undefined
          : user.email,
        metadata: {
          user_id: user.id,
          plan_id: plan.id,
          signup_intent_id: refreshedIntent.id,
        },
        subscription_data: {
          metadata: {
            user_id: user.id,
            plan_id: plan.id,
            signup_intent_id: refreshedIntent.id,
          },
        },
        success_url: new URL("/onboarding/complete", siteUrl).toString(),
        cancel_url: new URL("/onboarding?checkout=cancelled", siteUrl).toString(),
      },
      {
        idempotencyKey: `signup-${refreshedIntent.id}-${attempt}`,
      },
    );

    if (!session.url) {
      throw new Error("Stripe n’a pas retourné d’URL de paiement.");
    }

    try {
      await saveSignupCheckoutSession(refreshedIntent.id, session.id);
    } catch (saveError) {
      console.error(
        "Enregistrement de la session Checkout :",
        saveError instanceof Error ? saveError.message : "Erreur inconnue",
      );
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error(
      "Création du paiement d’inscription :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return redirectWithError(request, "checkout_failed");
  }
}
