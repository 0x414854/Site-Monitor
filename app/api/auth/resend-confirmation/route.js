import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import {
  getSignupIntentByToken,
  normalizeEmail,
  reserveSignupEmailResend,
} from "@/utils/signup-intents";

export const dynamic = "force-dynamic";

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return origin && origin === new URL(request.url).origin;
}

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Requête non autorisée." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const token = String(body?.token ?? "");
  const email = normalizeEmail(body?.email);

  if (!token || token.length > 100 || !email || email.length > 254) {
    return NextResponse.json(
      { error: "Inscription introuvable ou expirée. Recommence l’inscription." },
      { status: 400 },
    );
  }

  try {
    const intent = await getSignupIntentByToken(token);
    if (
      !intent ||
      !intent.email ||
      normalizeEmail(intent.email) !== email ||
      intent.status !== "awaiting_email" ||
      new Date(intent.expires_at).getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "Inscription introuvable ou expirée. Recommence l’inscription." },
        { status: 400 },
      );
    }

    const allowed = await reserveSignupEmailResend(intent.subject_hash);
    if (!allowed) {
      return NextResponse.json(
        { error: "Un e-mail vient d’être envoyé. Attends une minute avant de réessayer." },
        { status: 429 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Configuration publique Supabase indisponible.");
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const callback = new URL("/auth/callback", new URL(request.url).origin);
    callback.searchParams.set("intent", token);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: callback.toString() },
    });

    if (error) {
      console.error("Renvoi de l’e-mail de confirmation :", error.message);
      return NextResponse.json(
        { error: "Impossible d’envoyer l’e-mail. Vérifie l’adresse et réessaie plus tard." },
        { status: 502 },
      );
    }

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error(
      "Renvoi de l’e-mail de confirmation :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.json(
      { error: "Le renvoi est momentanément indisponible." },
      { status: 500 },
    );
  }
}
