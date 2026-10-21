import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getStripe } from "@/utils/stripe";

export const dynamic = "force-dynamic";

function getSiteUrl(request) {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredUrl) return new URL(configuredUrl);

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return new URL(`https://${vercelUrl}`);

  return new URL(request.url).origin;
}

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const requestedPlanId = new URL(request.url).searchParams.get("plan");

  if (!requestedPlanId || requestedPlanId === "free") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const [{ data: plan, error: planError }, { data: subscription, error }] =
    await Promise.all([
      supabaseAdmin
        .from("plan_catalog")
        .select("id, name, price_cents, currency, billing_interval, stripe_price_id")
        .eq("id", requestedPlanId)
        .eq("active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("user_subscriptions")
        .select("plan_id, status, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  if (planError || error) {
    console.error("Lecture du forfait avant paiement :", planError ?? error);
    return NextResponse.redirect(
      new URL("/billing?error=plan_unavailable", request.url),
    );
  }

  if (!plan || !plan.stripe_price_id || plan.price_cents <= 0) {
    return NextResponse.redirect(
      new URL("/billing?error=plan_not_configured", request.url),
    );
  }

  if (subscription?.stripe_subscription_id) {
    return NextResponse.redirect(
      new URL("/api/billing/portal", request.url),
    );
  }

  try {
    const stripe = getStripe();
    const siteUrl = getSiteUrl(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      client_reference_id: user.id,
      customer:
        subscription?.stripe_customer_id ?? undefined,
      customer_email: subscription?.stripe_customer_id
        ? undefined
        : user.email,
      metadata: {
        user_id: user.id,
        plan_id: plan.id,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_id: plan.id,
        },
      },
      success_url: new URL(
        "/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        siteUrl,
      ).toString(),
      cancel_url: new URL("/billing?checkout=cancelled", siteUrl).toString(),
    });

    if (!session.url) {
      throw new Error("Stripe n'a pas retourné d'URL de paiement.");
    }

    return NextResponse.redirect(session.url);
  } catch (stripeError) {
    console.error("Création de la session Stripe :", stripeError);
    return NextResponse.redirect(
      new URL("/billing?error=checkout_failed", request.url),
    );
  }
}
