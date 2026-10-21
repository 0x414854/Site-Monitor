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

  const { data: subscription, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Lecture de l'abonnement Stripe :", error.message);
    return NextResponse.redirect(
      new URL("/billing?error=portal_unavailable", request.url),
    );
  }

  if (!subscription?.stripe_customer_id) {
    return NextResponse.redirect(
      new URL("/billing?error=no_active_subscription", request.url),
    );
  }

  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: new URL("/billing", getSiteUrl(request)).toString(),
    });

    return NextResponse.redirect(portal.url);
  } catch (stripeError) {
    console.error("Création du portail client Stripe :", stripeError);
    return NextResponse.redirect(
      new URL("/billing?error=portal_failed", request.url),
    );
  }
}
