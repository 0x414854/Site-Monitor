import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function getSafeNextPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/dashboard";
  }

  return value;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = getSafeNextPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth_callback", url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Échange du code d'authentification :", error.message);
    return NextResponse.redirect(new URL("/login?error=auth_callback", url));
  }

  return NextResponse.redirect(new URL(nextPath, url));
}
