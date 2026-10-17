import { supabaseAdmin } from "@/utils/supabase/clients";
import { scanWebsiteIntegrity } from "@/utils/monitor/checkIntegrity";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: websites, error } = await supabaseAdmin
    .from("websites")
    .select("id, url, client_name")
    .eq("active", true);

  if (error) {
    return Response.json(
      { error: "Impossible de récupérer les sites actifs" },
      { status: 500 },
    );
  }

  const results = await Promise.all(
    (websites || []).map(async (website) => {
      const { data: config, error: configError } = await supabaseAdmin
        .from("website_integrity_config")
        .select("important_paths, max_pages, max_links_per_page, enabled")
        .eq("website_id", website.id)
        .maybeSingle();

      if (configError) {
        return {
          websiteId: website.id,
          status: "failed",
          error: configError.message,
        };
      }

      if (!config || !config.enabled) {
        return { websiteId: website.id, status: "skipped" };
      }

      try {
        const result = await scanWebsiteIntegrity(website, config);
        return { ...result, status: "completed" };
      } catch (err) {
        return {
          websiteId: website.id,
          status: "failed",
          error: err instanceof Error ? err.message : "Erreur inconnue",
        };
      }
    }),
  );

  const failed = results.filter((item) => item.status === "failed").length;

  return Response.json({
    success: failed === 0,
    sitesProcessed: results.length,
    failed,
    results,
  });
}
