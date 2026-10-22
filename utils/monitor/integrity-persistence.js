export async function persistIntegrityFindings(
  supabase,
  scanId,
  findings,
) {
  if (findings.length === 0) return;

  const rows = findings.map((item) => ({
    ...item,
    scan_id: scanId,
  }));
  const { data, error } = await supabase
    .from("website_integrity_findings")
    .insert(rows)
    .select("id");

  if (error) {
    throw new Error(
      `Enregistrement des anomalies du scan impossible : ${error.message}`,
    );
  }
  if (!data || data.length !== rows.length) {
    throw new Error(
      "Le nombre d’anomalies enregistrées ne correspond pas au résultat du scan.",
    );
  }
}
