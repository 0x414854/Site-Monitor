import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const CHECK_COLUMNS = "*, websites(client_name, url)";

function parsePage(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) return null;

  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

export async function GET(request) {
  const page = parsePage(new URL(request.url).searchParams.get("page"));

  if (page === null) {
    return NextResponse.json(
      { error: "Numéro de page invalide." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { count, error: countError } = await supabase
    .from("website_checks")
    .select("id", { count: "exact", head: true });

  if (countError) {
    console.error(
      "Comptage de l’historique HTTP :",
      countError.message,
    );
    return NextResponse.json(
      { error: "Impossible de charger le nombre de contrôles." },
      { status: 500 },
    );
  }

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const from = (currentPage - 1) * PAGE_SIZE;

  const { data: checks, error: checksError } = await supabase
    .from("website_checks")
    .select(CHECK_COLUMNS)
    .order("checked_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (checksError) {
    console.error("Chargement de l’historique HTTP :", checksError.message);
    return NextResponse.json(
      { error: "Impossible de charger cet historique." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { checks: checks ?? [], page: currentPage, pageCount, total },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
