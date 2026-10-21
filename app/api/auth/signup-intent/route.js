import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabase/clients";
import {
  createSignupIntent,
  createSignupToken,
  hashSignupSubject,
  normalizeEmail,
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

  const planId = String(body?.planId ?? "").trim();
  const email = normalizeEmail(body?.email);

  if (
    !/^[a-z0-9_-]{1,80}$/.test(planId) ||
    (email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
  ) {
    return NextResponse.json(
      { error: "Vérifie l’adresse e-mail et le forfait sélectionné." },
      { status: 400 },
    );
  }

  const { data: plan, error: planError } = await supabaseAdmin
    .from("plan_catalog")
    .select("id, active")
    .eq("id", planId)
    .maybeSingle();

  if (planError) {
    console.error("Vérification du forfait d’inscription :", planError.message);
    return NextResponse.json(
      { error: "Impossible de vérifier le forfait. Réessaie." },
      { status: 500 },
    );
  }
  if (!plan?.active) {
    return NextResponse.json(
      { error: "Ce forfait n’est plus disponible. Choisis une autre offre." },
      { status: 400 },
    );
  }

  const forwardedIp =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local-client";
  const subject = email || `ip:${forwardedIp}`;
  const token = createSignupToken();

  try {
    const result = await createSignupIntent({
      email,
      subject,
      planId,
      token,
    });

    if (result.limited) {
      return NextResponse.json(
        { error: "Trop de tentatives. Attends un moment avant de réessayer." },
        { status: 429 },
      );
    }

    return NextResponse.json({ token: result.token });
  } catch (error) {
    console.error(
      "Création de l’intention d’inscription :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return NextResponse.json(
      { error: "Impossible de préparer l’inscription. Réessaie." },
      { status: 500 },
    );
  }
}
