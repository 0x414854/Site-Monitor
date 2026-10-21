import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  claimLatestSignupIntentForUser,
  getPendingSignupIntent,
} from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    let intent = await getPendingSignupIntent(user.id);
    if (!intent) {
      const claimed = await claimLatestSignupIntentForUser(user);
      if (claimed?.status === "completed") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
      intent = claimed ? await getPendingSignupIntent(user.id) : null;
    }

    const url = new URL(request.url);
    const continueToBilling = url.searchParams.get("next") === "billing";
    const destination = intent
      ? "/onboarding"
      : continueToBilling
        ? "/billing"
        : "/dashboard";
    return NextResponse.redirect(new URL(destination, url));
  } catch (error) {
    console.error(
      "Recherche d’une inscription à reprendre :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.redirect(
      new URL("/login?error=onboarding_unavailable", request.url),
    );
  }
}
