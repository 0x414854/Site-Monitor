"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getUserSubscription } from "@/utils/subscriptions";
import {
  isPlatformAdmin,
  syncPlatformAdminAccount,
} from "@/utils/platform-admin";

function slugify(value) {
  return (
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "site"
  );
}

async function generateUniqueSlug(name, userId, supabase) {
  const base = `${slugify(name)}-${userId}`;

  for (let suffix = 1; suffix <= 100; suffix++) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;

    const { data, error } = await supabase
      .from("websites")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      throw new Error("Impossible de vérifier l'unicité du slug.");
    }

    if (!data) return slug;
  }

  throw new Error("Impossible de générer un slug unique.");
}

export async function createWebsite(formData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError) console.error("Vérification de session :", authError.message);
    return { error: "Connecte-toi pour gérer tes sites." };
  }

  const client_name = String(formData.get("client_name") ?? "").trim();
  let url = String(formData.get("url") ?? "").trim();
  const notification_email = String(
    formData.get("notification_email") ?? "",
  ).trim();

  if (!client_name || !url || !notification_email) {
    return { error: "Le nom, l'URL et l'e-mail sont obligatoires." };
  }

  if (client_name.length > 120 || url.length > 2048) {
    return { error: "Un des champs est trop long." };
  }

  if (
    notification_email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notification_email)
  ) {
    return { error: "L'adresse e-mail est invalide." };
  }

  const platformAdmin = isPlatformAdmin(user);
  let subscription;

  try {
    if (platformAdmin) {
      await syncPlatformAdminAccount(user);
    } else {
      subscription = await getUserSubscription(user.id);
    }
  } catch (error) {
    console.error("Vérification du forfait ou du compte admin :", error);
    return {
      error: platformAdmin
        ? "Impossible de vérifier les droits administrateur."
        : "Impossible de vérifier les limites de ton forfait.",
    };
  }

  if (!platformAdmin) {
    if (subscription.maxSites < 1) {
      return {
        error: "Ton forfait ne permet pas d'ajouter des sites actuellement.",
      };
    }

    const { count: siteCount, error: countError } = await supabase
      .from("websites")
      .select("id", { count: "exact", head: true });

    if (countError) {
      console.error("Comptage des sites actifs :", countError.message);
      return { error: "Impossible de vérifier le nombre de sites du compte." };
    }

    if ((siteCount ?? 0) >= subscription.maxSites) {
      return {
        error: `La limite de ${subscription.maxSites} site${subscription.maxSites > 1 ? "s" : ""} de ton forfait ${subscription.plan.name} est atteinte. Change de forfait pour en ajouter.`,
      };
    }
  }

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsedUrl = new URL(url);

    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname.includes(".") ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      return { error: "L'URL du site est invalide." };
    }

    url = parsedUrl.toString();
  } catch {
    return { error: "L'URL du site est invalide." };
  }

  let slug;

  try {
    slug = await generateUniqueSlug(client_name, user.id, supabase);
  } catch (error) {
    console.error("Génération du slug :", error);
    return { error: "Impossible de préparer l'identifiant du site." };
  }

  const { data, error } = await supabase
    .from("websites")
    .insert({
      owner_id: user.id,
      client_name,
      url,
      notification_email,
      slug,
      active: true,
    })
    .select(
      "id, client_name, url, slug, notification_email, status, active, created_at",
    )
    .single();

  if (error) {
    console.error("Création du site :", error.message);
    if (error.code === "23514" && !platformAdmin) {
      return {
        error: `La limite de ${subscription.maxSites} site${subscription.maxSites > 1 ? "s" : ""} de ton forfait ${subscription.plan.name} est atteinte. Change de forfait pour en ajouter.`,
      };
    }
    return {
      error: "Impossible de créer le site. Vérifie les données.",
    };
  }

  revalidatePath("/dashboard");

  return {
    success: "Site ajouté avec succès.",
    website: data,
  };
}

export async function toggleWebsiteMonitoring(id, active) {
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).trim() === "" ||
    typeof active !== "boolean"
  ) {
    return { error: "Paramètres invalides." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError) console.error("Vérification de session :", authError.message);
    return { error: "Connecte-toi pour gérer tes sites." };
  }

  const { data, error } = await supabase
    .from("websites")
    .update({ active })
    .eq("id", id)
    .select("id, client_name, active")
    .maybeSingle();

  if (error) {
    console.error("Erreur Supabase :", error);
    if (error.code === "23514") {
      return { error: "La limite de sites de ton forfait est atteinte." };
    }
    return { error: "La base de données n'a pas pu modifier ce site." };
  }

  if (!data) {
    return { error: "Site introuvable ou non modifié." };
  }

  revalidatePath("/dashboard");

  return {
    success: true,
    active: data.active,
    website: data,
  };
}

export async function deleteWebsite(id) {
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).trim() === ""
  ) {
    return { error: "Identifiant du site invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (authError) console.error("Vérification de session :", authError.message);
    return { error: "Connecte-toi pour gérer tes sites." };
  }

  const { data, error } = await supabase
    .from("websites")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Suppression du site :", error);
    return {
      error:
        "Impossible de supprimer ce site. Vérifie s'il possède des contrôles associés.",
    };
  }

  if (!data) {
    return { error: "Site introuvable ou déjà supprimé." };
  }

  revalidatePath("/dashboard");

  return { success: true, id: data.id };
}
