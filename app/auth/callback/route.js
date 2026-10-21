import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { claimSignupIntent } from "@/utils/signup-intents";

function getCallbackError(error) {
  if (error === "expired") return "expired";
  if (error === "email_mismatch") return "email_mismatch";
  return "invalid";
}

function getConfirmationError(error) {
  const errorCode = error?.code ?? "";
  const message = error?.message ?? "";
  return errorCode === "otp_expired" ||
    /expired|invalid.*token/i.test(message)
    ? "expired"
    : "confirmation_session";
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const intentToken = url.searchParams.get("intent");
  const authErrorCode = url.searchParams.get("error_code");
  const nextPath =
    url.searchParams.get("next") === "/auth/update-password"
      ? "/auth/update-password"
      : "/auth/continue";

  if (!code) {
    const destination =
      intentToken && authErrorCode === "otp_expired"
        ? "/signup/confirmation?error=expired"
        : intentToken
          ? "/login?error=confirmation_session"
          : "/login?error=auth_callback";
    return NextResponse.redirect(new URL(destination, url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Échange du code d'authentification :", error.message);
    const confirmationError = intentToken
      ? getConfirmationError(error)
      : null;
    return NextResponse.redirect(
      new URL(
        confirmationError === "expired"
          ? "/signup/confirmation?error=expired"
          : confirmationError
            ? "/login?error=confirmation_session"
            : "/login?error=auth_callback",
        url,
      ),
    );
  }

  if (intentToken) {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        return NextResponse.redirect(
          new URL("/signup/confirmation?error=invalid", url),
        );
      }

      const result = await claimSignupIntent(intentToken, user);
      if (result.error) {
        return NextResponse.redirect(
          new URL(
            `/signup/confirmation?error=${getCallbackError(result.error)}`,
            url,
          ),
        );
      }

      return NextResponse.redirect(
        new URL(
          result.intent.status === "completed" ? "/dashboard" : "/onboarding",
          url,
        ),
      );
    } catch (intentError) {
      console.error(
        "Reprise de l’inscription après confirmation :",
        intentError instanceof Error ? intentError.message : "Erreur inconnue",
      );
      return NextResponse.redirect(
        new URL(
          `/signup/confirmation?error=temporary&intent=${encodeURIComponent(intentToken)}`,
          url,
        ),
      );
    }
  }

  return NextResponse.redirect(new URL(nextPath, url));
}
