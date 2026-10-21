import "server-only";
import { supabaseAdmin } from "@/utils/supabase/clients";

export async function getAdminPlans() {
  const { data, error } = await supabaseAdmin
    .from("plan_catalog")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Lecture des forfaits impossible : ${error.message}`);
  }
  return data ?? [];
}

export async function getAuthUsersPage({ page = 1, perPage = 25, search = "" }) {
  const query = search.trim().toLowerCase();

  if (!query) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw new Error(
        `Lecture des utilisateurs impossible : ${error.message}`,
      );
    }

    return {
      users: data.users ?? [],
      total: data.total ?? 0,
      hasMore: data.nextPage !== null,
    };
  }

  const matches = [];
  const perPageScan = 1000;

  for (let currentPage = 1; ; currentPage += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page: currentPage,
      perPage: perPageScan,
    });
    if (error) {
      throw new Error(
        `Recherche d’utilisateurs impossible : ${error.message}`,
      );
    }

    const batch = data.users ?? [];
    matches.push(
      ...batch.filter((user) => user.email?.toLowerCase().includes(query)),
    );
    if (batch.length < perPageScan) break;
  }

  const offset = (page - 1) * perPage;
  return {
    users: matches.slice(offset, offset + perPage),
    total: matches.length,
    hasMore: offset + perPage < matches.length,
  };
}

export async function getSubscriptionsForUsers(userIds) {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select(
      "user_id, plan_id, status, current_period_end, cancel_at_period_end, plan_catalog(name)",
    )
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Lecture des abonnements impossible : ${error.message}`);
  }

  return new Map(
    (data ?? []).map((subscription) => [subscription.user_id, subscription]),
  );
}

export async function getExactCount(table, filters = []) {
  let query = supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });
  for (const [column, value] of filters) {
    query = Array.isArray(value)
      ? query.in(column, value)
      : query.eq(column, value);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Comptage ${table} impossible : ${error.message}`);
  return count ?? 0;
}

export async function getTotalAuthUserCount() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    throw new Error(`Comptage des utilisateurs impossible : ${error.message}`);
  }
  return data.total ?? 0;
}
