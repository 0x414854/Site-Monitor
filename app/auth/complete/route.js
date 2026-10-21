import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { claimSignupIntent } from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("intent");
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !token) {
    return NextResponse.redirect(new URL("/login?error=auth_callback", url));
  }

  try {
    const result = await claimSignupIntent(token, user);
    if (result.error) {
      const error =
        result.error === "expired" ? "expired" : "invalid";
      return NextResponse.redirect(
        new URL(`/signup/confirmation?error=${error}`, url),
      );
    }

    return NextResponse.redirect(
      new URL(
        result.intent.status === "completed" ? "/dashboard" : "/onboarding",
        url,
      ),
    );
  } catch (error) {
    console.error(
      "Finalisation de l’inscription :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.redirect(
      new URL(
        `/signup/confirmation?error=temporary&intent=${encodeURIComponent(token)}`,
        url,
      ),
    );
  }
}
