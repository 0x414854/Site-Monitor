import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/clients";

export function isPlatformAdmin(user) {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(
    adminEmail && user?.email?.trim().toLowerCase() === adminEmail,
  );
}

export async function syncPlatformAdminAccount(user) {
  if (!isPlatformAdmin(user)) return false;

  const { error } = await supabaseAdmin
    .from("platform_admin_accounts")
    .upsert(
      { singleton: true, user_id: user.id },
      { onConflict: "singleton" },
    );

  if (error) {
    throw new Error(
      `Synchronisation du compte administrateur impossible : ${error.message}`,
    );
  }

  return true;
}

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("Vérification de session administrateur :", error.message);
  }

  if (!user) redirect("/login");
  if (!isPlatformAdmin(user)) notFound();

  return user;
}
