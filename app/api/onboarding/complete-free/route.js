import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import { getPendingSignupIntent } from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

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
    if (!intent || intent.plan_id !== "free") {
      return NextResponse.redirect(new URL("/onboarding", request.url), 303);
    }

    const now = new Date().toISOString();
    const { data: updatedIntent, error: intentError } = await supabaseAdmin
      .from("signup_intents")
      .update({
        status: "completed",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", intent.id)
      .eq("user_id", user.id)
      .in("status", ["payment_required", "payment_failed", "checkout_open"])
      .select("id")
      .maybeSingle();
    if (intentError) throw intentError;
    if (!updatedIntent) {
      return NextResponse.redirect(new URL("/dashboard", request.url), 303);
    }

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

    return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  } catch (error) {
    console.error(
      "Activation du forfait gratuit :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.redirect(
      new URL("/onboarding?error=checkout_failed", request.url),
      303,
    );
  }
}
