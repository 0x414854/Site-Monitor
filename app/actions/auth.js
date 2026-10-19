"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Déconnexion Supabase :", error.message);
    throw new Error("Impossible de fermer la session.");
  }

  redirect("/login");
}
