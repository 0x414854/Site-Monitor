import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/utils/supabase/clients";

const INTENT_LIFETIME_HOURS = 24;

function getHashSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Clé de signature serveur indisponible.");
  return secret;
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function hashSignupToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashSignupSubject(value) {
  return createHmac("sha256", getHashSecret())
    .update(normalizeEmail(value))
    .digest("hex");
}

export function createSignupToken() {
  return randomBytes(32).toString("base64url");
}

export async function createSignupIntent({ email, subject, planId, token }) {
  const tokenHash = hashSignupToken(token);
  const subjectHash = hashSignupSubject(subject);
  const { data: allowed, error: rateLimitError } = await supabaseAdmin.rpc(
    "reserve_signup_intent",
    { p_subject_hash: subjectHash },
  );

  if (rateLimitError) {
    throw new Error(`Limitation d’inscription indisponible : ${rateLimitError.message}`);
  }
  if (!allowed) return { limited: true };

  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .insert({
      token_hash: tokenHash,
      subject_hash: subjectHash,
      email: email || null,
      plan_id: planId,
      status: "awaiting_email",
      expires_at: new Date(
        Date.now() + INTENT_LIFETIME_HOURS * 60 * 60 * 1000,
      ).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Création de l’intention d’inscription impossible : ${error.message}`);
  }

  return { limited: false, id: data.id, token };
}

export async function getSignupIntentByToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .select(
      "id, email, subject_hash, user_id, plan_id, status, expires_at, checkout_session_id, checkout_attempt, plan_catalog(id, name, description, price_cents, currency, billing_interval, stripe_price_id, max_sites, history_days, check_interval_hours, feature_flags, active)",
    )
    .eq("token_hash", hashSignupToken(token))
    .maybeSingle();

  if (error) {
    throw new Error(`Lecture de l’inscription impossible : ${error.message}`);
  }
  return data;
}

export async function claimSignupIntent(token, user) {
  const intent = await getSignupIntentByToken(token);
  const email = normalizeEmail(user.email);
  const hasOAuthIdentity = user.identities?.some((identity) =>
    ["google", "github"].includes(identity.provider),
  );

  if (!intent) return { error: "invalid" };

  if (intent.email) {
    if (!email || !user.email_confirmed_at) return { error: "invalid" };
    if (normalizeEmail(intent.email) !== email) {
      return { error: "email_mismatch" };
    }
  } else if (!hasOAuthIdentity) {
    return { error: "invalid" };
  }

  if (new Date(intent.expires_at).getTime() <= Date.now()) {
    if (intent.status === "awaiting_email") {
      const { error } = await supabaseAdmin
        .from("signup_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", intent.id)
        .eq("status", "awaiting_email");
      if (error) {
        throw new Error(`Expiration de l’inscription impossible : ${error.message}`);
      }
    }
    return { error: "expired" };
  }

  if (intent.user_id && intent.user_id !== user.id) {
    return { error: "invalid" };
  }

  if (intent.user_id === user.id) {
    return { intent };
  }

  const isFree = intent.plan_id === "free";
  const nextStatus = isFree ? "completed" : "payment_required";
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .update({
      email: email || null,
      user_id: user.id,
      status: nextStatus,
      completed_at: isFree ? now : null,
      updated_at: now,
    })
    .eq("id", intent.id)
    .is("user_id", null)
    .eq("status", "awaiting_email")
    .select(
      "id, email, user_id, plan_id, status, expires_at, checkout_session_id, checkout_attempt, plan_catalog(id, name, price_cents, currency, billing_interval, stripe_price_id, active)",
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Association du compte à l’inscription impossible : ${error.message}`);
  }
  if (!data) {
    const latest = await getSignupIntentByToken(token);
    return latest?.user_id === user.id
      ? { intent: latest }
      : { error: "invalid" };
  }

  return { intent: data };
}

export async function claimLatestSignupIntentForUser(user) {
  const email = normalizeEmail(user.email);
  if (!email || !user.email_confirmed_at) return null;

  const { data: intent, error: lookupError } = await supabaseAdmin
    .from("signup_intents")
    .select("id, plan_id, expires_at")
    .eq("email", email)
    .is("user_id", null)
    .eq("status", "awaiting_email")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Recherche de l’inscription à reprendre impossible : ${lookupError.message}`);
  }
  if (!intent) return null;

  const isFree = intent.plan_id === "free";
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .update({
      user_id: user.id,
      email,
      status: isFree ? "completed" : "payment_required",
      completed_at: isFree ? now : null,
      updated_at: now,
    })
    .eq("id", intent.id)
    .eq("email", email)
    .is("user_id", null)
    .eq("status", "awaiting_email")
    .gt("expires_at", now)
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw new Error(`Association de l’inscription au compte impossible : ${error.message}`);
  }

  return data;
}

export async function getPendingSignupIntent(userId) {
  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .select(
      "id, email, user_id, plan_id, status, expires_at, checkout_session_id, checkout_attempt, plan_catalog(id, name, description, price_cents, currency, billing_interval, stripe_price_id, max_sites, history_days, check_interval_hours, feature_flags, active)",
    )
    .eq("user_id", userId)
    .in("status", ["payment_required", "checkout_open", "payment_failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Lecture de la reprise d’inscription impossible : ${error.message}`);
  }
  return data;
}

export async function getSignupIntentForUser(intentId, userId) {
  const { data, error } = await supabaseAdmin
    .from("signup_intents")
    .select(
      "id, email, user_id, plan_id, status, checkout_session_id, checkout_attempt, plan_catalog(id, name, price_cents, currency, billing_interval, stripe_price_id, active)",
    )
    .eq("id", intentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Lecture de l’inscription impossible : ${error.message}`);
  }
  return data;
}

export async function reserveSignupEmailResend(subjectHash) {
  const { data, error } = await supabaseAdmin.rpc(
    "reserve_signup_email_resend",
    { p_subject_hash: subjectHash },
  );
  if (error) {
    throw new Error(`Limitation du renvoi impossible : ${error.message}`);
  }
  return Boolean(data);
}

export async function reserveSignupCheckout(intentId) {
  const { data, error } = await supabaseAdmin.rpc("reserve_signup_checkout", {
    p_intent_id: intentId,
  });
  if (error) {
    throw new Error(`Réservation du paiement impossible : ${error.message}`);
  }
  return data;
}

export async function saveSignupCheckoutSession(intentId, sessionId) {
  const { error } = await supabaseAdmin
    .from("signup_intents")
    .update({
      checkout_session_id: sessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("status", "checkout_open");
  if (error) {
    throw new Error(`Enregistrement de la session de paiement impossible : ${error.message}`);
  }
}

export async function resetSignupCheckout(intentId, status = "payment_required") {
  const { error } = await supabaseAdmin
    .from("signup_intents")
    .update({
      status,
      checkout_session_id: null,
      checkout_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("status", "checkout_open");
  if (error) {
    throw new Error(`Réinitialisation du paiement impossible : ${error.message}`);
  }
}
