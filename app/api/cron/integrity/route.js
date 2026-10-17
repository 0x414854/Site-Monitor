import { supabaseAdmin } from "@/utils/supabase/clients";
import { scanWebsiteIntegrity } from "@/utils/monitor/checkIntegrity";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: websites, error: websitesError } = await supabaseAdmin
    .from("websites")
    .select("id,url,client_name")
    .eq("active", true);

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

  const results = await Promise.all(
    (websites || []).map(async (website) => {
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
    failed,
    results,
  });
}
