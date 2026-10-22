import { supabaseAdmin } from "@/utils/supabase/clients";
import { validatePublicUrl } from "@/utils/monitor/validate-url";
import { persistIntegrityFindings } from "@/utils/monitor/integrity-persistence";
import {
  crawlIntegrityWebsite,
  MAX_LINK_REQUESTS_PER_SCAN,
  MAX_PAGES_PER_SCAN,
} from "@/utils/monitor/integrity-crawler";

async function updateScan(scanId, values) {
  const { data, error } = await supabaseAdmin
    .from("website_integrity_scans")
    .update(values)
    .eq("id", scanId)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Mise à jour du scan ${scanId} impossible : ${error.message}`);
  }
  if (!data) throw new Error(`Le scan ${scanId} n’a pas été mis à jour.`);
}

export async function scanWebsiteIntegrity(website, config) {
  const { data: scan, error: createError } = await supabaseAdmin
    .from("website_integrity_scans")
    .insert({ website_id: website.id, status: "running" })
    .select("id")
    .single();

  if (createError) {
    throw new Error(`Création du scan impossible : ${createError.message}`);
  }
  if (!scan) throw new Error("Supabase n’a pas retourné le scan créé.");

  let result;
  let findingsPersisted = false;

  try {
    result = await crawlIntegrityWebsite(website, config, {
      validateUrl: validatePublicUrl,
    });

    await persistIntegrityFindings(supabaseAdmin, scan.id, result.findings);
    findingsPersisted = true;

    await updateScan(scan.id, {
      finished_at: new Date().toISOString(),
      status: "completed",
      pages_checked: result.pagesChecked,
      links_discovered: result.linksDiscovered,
      external_links_discovered: result.externalLinksDiscovered,
      links_checked: result.linksChecked,
      findings_count: result.findings.length,
      result_reason: result.resultReason,
      error_message: null,
    });

    return {
      websiteId: website.id,
      scanId: scan.id,
      status: "completed",
      pagesChecked: result.pagesChecked,
      linksDiscovered: result.linksDiscovered,
      externalLinksDiscovered: result.externalLinksDiscovered,
      linksChecked: result.linksChecked,
      findingsCount: result.findings.length,
      resultReason: result.resultReason,
      requestsUsed: result.requestsUsed,
      linkRequestsUsed: result.linkRequestsUsed,
      limits: {
        pages: MAX_PAGES_PER_SCAN,
        linkRequests: MAX_LINK_REQUESTS_PER_SCAN,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue du scanner.";

    try {
      await updateScan(scan.id, {
        finished_at: new Date().toISOString(),
        status: "failed",
        pages_checked: result?.pagesChecked ?? 0,
        links_discovered: result?.linksDiscovered ?? 0,
        external_links_discovered: result?.externalLinksDiscovered ?? 0,
        links_checked: result?.linksChecked ?? 0,
        findings_count: findingsPersisted ? result?.findings.length ?? 0 : 0,
        result_reason: null,
        error_message: message.slice(0, 1000),
      });
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        `Le scan ${scan.id} a échoué et son statut n’a pas pu être persisté.`,
      );
    }

    throw error;
  }
}
