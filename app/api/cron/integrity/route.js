import { supabaseAdmin } from "@/utils/supabase/clients";
import { scanWebsiteIntegrity } from "@/utils/monitor/checkIntegrity";
import {
  getSubscriptionsByUserIds,
  isCheckDue,
} from "@/utils/subscriptions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: websites, error: websitesError } = await supabaseAdmin
    .from("websites")
    .select("id,owner_id,url,client_name,active")
    .order("created_at", { ascending: true });

  if (websitesError) {
    console.error(
      "[Integrity cron] Erreur de récupération des sites:",
      websitesError,
    );

    return Response.json(
      { error: "Impossible de récupérer les sites actifs" },
      { status: 500 },
    );
  }

  let subscriptions;

  try {
    subscriptions = await getSubscriptionsByUserIds(
      (websites ?? []).map((website) => website.owner_id),
    );
  } catch (error) {
    console.error(
      "[Integrity cron] Impossible de charger les forfaits:",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return Response.json(
      { error: "Impossible de vérifier les droits des sites." },
      { status: 500 },
    );
  }

  const websiteIds = (websites ?? []).map((website) => website.id);
  const { data: recentScans, error: scansError } = websiteIds.length
    ? await supabaseAdmin
        .from("website_integrity_scans")
        .select("website_id, started_at")
        .in("website_id", websiteIds)
        .order("started_at", { ascending: false })
        .limit(5000)
    : { data: [], error: null };

  if (scansError) {
    console.error(
      "[Integrity cron] Impossible de vérifier les derniers scans:",
      scansError.message,
    );
    return Response.json(
      { error: "Impossible de vérifier la fréquence des scans." },
      { status: 500 },
    );
  }

  const latestScanByWebsite = new Map();

  for (const scan of recentScans ?? []) {
    if (!latestScanByWebsite.has(scan.website_id)) {
      latestScanByWebsite.set(scan.website_id, scan.started_at);
    }
  }

  const now = Date.now();
  const eligibleWebsites = [];
  let skippedByPlan = 0;
  let skippedByQuota = 0;
  let skippedNotDue = 0;
  const siteCountByOwner = new Map();

  for (const website of websites ?? []) {
    const subscription = subscriptions.get(website.owner_id);

    if (!subscription?.plan || !subscription.features.integrity) {
      skippedByPlan += Number(website.active);
      continue;
    }

    const usedSlots = siteCountByOwner.get(website.owner_id) ?? 0;
    siteCountByOwner.set(website.owner_id, usedSlots + 1);

    if (usedSlots >= subscription.maxSites) {
      skippedByQuota += Number(website.active);
      continue;
    }

    if (!website.active) continue;

    if (
      !isCheckDue(
        latestScanByWebsite.get(website.id),
        subscription.checkIntervalHours,
        now,
      )
    ) {
      skippedNotDue += 1;
      continue;
    }

    eligibleWebsites.push(website);
  }

  const results = await Promise.all(
    eligibleWebsites.map(async (website) => {
      try {
        const { data: config, error: configError } = await supabaseAdmin
          .from("website_integrity_config")
          .select(
            `
            important_paths,
            max_pages,
            max_links_per_page,
            enabled,
            locale_prefixes,
            default_locale
          `,
          )
          .eq("website_id", website.id)
          .maybeSingle();

        if (configError) {
          throw new Error(
            `Erreur de lecture de la configuration : ${configError.message}`,
          );
        }

        if (!config) {
          return {
            websiteId: website.id,
            clientName: website.client_name,
            status: "skipped",
            reason: "Configuration d'intégrité absente",
          };
        }

        if (!config.enabled) {
          return {
            websiteId: website.id,
            clientName: website.client_name,
            status: "skipped",
            reason: "Scanner désactivé pour ce site",
          };
        }

        const result = await scanWebsiteIntegrity(website, config);

        return {
          ...result,
          clientName: website.client_name,
          status: "completed",
        };
      } catch (error) {
        console.error(
          `[Integrity cron] Échec pour ${website.client_name} (${website.id}):`,
          error,
        );

        return {
          websiteId: website.id,
          clientName: website.client_name,
          status: "failed",
          error: error instanceof Error ? error.message : "Erreur inconnue",
        };
      }
    }),
  );

  const failed = results.filter((result) => result.status === "failed").length;

  return Response.json({
    success: failed === 0,
    sitesProcessed: results.length,
    skippedByPlan,
    skippedByQuota,
    skippedNotDue,
    failed,
    results,
  });
}
