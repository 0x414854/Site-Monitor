import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }

  const [{ data: intent, error: intentError }, { data: subscription, error }] =
    await Promise.all([
      supabaseAdmin
        .from("signup_intents")
        .select("status, plan_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("user_subscriptions")
        .select("plan_id, status")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  if (intentError || error) {
    console.error("Vérification de fin d’inscription :", intentError ?? error);
    return NextResponse.json(
      { error: "État du paiement indisponible." },
      { status: 500 },
    );
  }

  const complete =
    intent?.status === "completed" &&
    intent.plan_id === subscription?.plan_id &&
    ["active", "trialing"].includes(subscription?.status);

  return NextResponse.json({ complete });
}
