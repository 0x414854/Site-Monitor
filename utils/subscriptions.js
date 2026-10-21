import { supabaseAdmin } from "@/utils/supabase/clients";

export async function getUserSubscription(userId) {
  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select(
      "plan_id, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, plan_catalog(id, name, max_sites, history_days, check_interval_hours, feature_flags)",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Lecture du forfait impossible : ${error.message}`);
  }

  if (!data?.plan_catalog) {
    throw new Error(`Aucun forfait configuré pour l'utilisateur ${userId}.`);
  }

  const eligible = ["active", "trialing", "past_due"].includes(data.status);

  return {
    ...data,
    plan: eligible ? data.plan_catalog : null,
    features: eligible ? data.plan_catalog.feature_flags ?? {} : {},
    maxSites: eligible ? Number(data.plan_catalog.max_sites) : 0,
    historyDays: eligible ? Number(data.plan_catalog.history_days) : 0,
    checkIntervalHours: eligible
      ? Number(data.plan_catalog.check_interval_hours)
      : null,
  };
}

export async function getSubscriptionsByUserIds(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];

  if (ids.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select(
      "user_id, status, plan_catalog(id, max_sites, history_days, check_interval_hours, feature_flags)",
    )
    .in("user_id", ids);

  if (error) {
    throw new Error(`Lecture des forfaits impossible : ${error.message}`);
  }

  const { data: adminAccounts, error: adminError } = await supabaseAdmin
    .from("platform_admin_accounts")
    .select("user_id")
    .in("user_id", ids);

  if (adminError) {
    throw new Error(`Lecture des comptes administrateur impossible : ${adminError.message}`);
  }

  const adminIds = new Set((adminAccounts ?? []).map((account) => account.user_id));

  return new Map(
    (data ?? []).map((subscription) => {
      const enabled = ["active", "trialing", "past_due"].includes(
        subscription.status,
      );
      const plan = enabled ? subscription.plan_catalog : null;
      const isAdmin = adminIds.has(subscription.user_id);

      return [
        subscription.user_id,
        {
          status: subscription.status,
          plan: isAdmin
            ? (plan ?? { id: "admin", name: "Administrateur" })
            : plan,
          features: isAdmin
            ? {
                http: true,
                ssl: true,
                dns: true,
                security_headers: true,
                integrity: true,
                advanced_alerts: true,
                multi_site: true,
              }
            : (plan?.feature_flags ?? {}),
          maxSites: isAdmin
            ? Number.POSITIVE_INFINITY
            : plan
              ? Number(plan.max_sites)
              : 0,
          checkIntervalHours: isAdmin
            ? Number(plan?.check_interval_hours ?? 24)
            : plan
              ? Number(plan.check_interval_hours)
              : null,
        },
      ];
    }),
  );
}

export function isCheckDue(lastCheckedAt, intervalHours, now = Date.now()) {
  if (!lastCheckedAt) return true;

  const previousTimestamp = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(previousTimestamp)) return true;

  return now - previousTimestamp >= intervalHours * 60 * 60 * 1000;
}
