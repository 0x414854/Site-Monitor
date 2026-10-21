import { redirect } from "next/navigation";
import AuthForm from "./auth-form";
import { createClient } from "@/utils/supabase/server";
import { getPendingSignupIntent } from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const requestedPlanId = params?.plan;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const pendingIntent = await getPendingSignupIntent(user.id);
    if (pendingIntent) redirect("/onboarding");
    redirect(
      requestedPlanId && requestedPlanId !== "free"
        ? "/auth/continue?next=billing"
        : "/auth/continue",
    );
  }

  const { data: plans, error } = await supabase
    .from("plan_catalog")
    .select("id, name, price_cents, currency, billing_interval")
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("Chargement des forfaits pour l'inscription :", error.message);
    throw new Error("Impossible de charger les forfaits.");
  }

  const selectedPlan = plans?.some((plan) => plan.id === requestedPlanId)
    ? requestedPlanId
    : "free";

  return (
    <AuthForm
      initialError={params?.error ?? null}
      initialPlanId={selectedPlan}
      plans={plans ?? []}
    />
  );
}
