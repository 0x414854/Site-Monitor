import { supabaseAdmin } from "@/utils/supabase/clients";

export const dynamic = "force-dynamic";

function formatDate(date) {
  if (!date) return "—";

  return new Date(date).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function Status({ status }) {
  const labels = {
    up: "En ligne",
    down: "Hors ligne",
    unknown: "En attente",
  };

  const colors = {
    up: "#22c55e",
    down: "#ef4444",
    unknown: "#f59e0b",
  };

  return (
    <span
      style={{
        color: colors[status] || colors.unknown,
        fontWeight: 700,
      }}
    >
      ● {labels[status] || labels.unknown}
    </span>
  );
}

export default async function DashboardPage() {
  const { data: sites, error } = await supabaseAdmin
    .from("websites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main>
        <h1>Erreur de chargement</h1>
      </main>
    );
  }

  const allSites = sites || [];
  const online = allSites.filter((site) => site.status === "up").length;
  const offline = allSites.filter((site) => site.status === "down").length;

  const { data: checks } = await supabaseAdmin
    .from("website_checks")
    .select("*, websites(client_name, url)")
    .order("checked_at", { ascending: false })
    .limit(20);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 5%",
        background: "#0b0b0b",
        color: "#f5f5f5",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <p style={{ color: "#ffad4d" }}>SITE MONITOR</p>
        <h1>Surveillance des sites</h1>
        <p style={{ color: "#aaa" }}>Vue d'ensemble de tes sites clients.</p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {[
          ["Sites suivis", allSites.length],
          ["En ligne", online],
          ["Hors ligne", offline],
        ].map(([label, value]) => (
          <article
            key={label}
            style={{
              padding: 20,
              border: "1px solid #292929",
              borderRadius: 14,
              background: "#121212",
            }}
          >
            <p style={{ color: "#aaa" }}>{label}</p>
            <strong style={{ fontSize: 32 }}>{value}</strong>
          </article>
        ))}
      </section>

      <h2>Sites surveillés</h2>

      <div style={{ overflowX: "auto", marginBottom: 40 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
          }}
        >
          <thead>
            <tr>
              {[
                "Client",
                "Site",
                "État",
                "HTTP",
                "Réponse",
                "Dernier contrôle",
              ].map((heading) => (
                <th
                  key={heading}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid #333",
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSites.map((site) => (
              <tr key={site.id}>
                <td style={{ padding: 12 }}>{site.client_name}</td>
                <td style={{ padding: 12 }}>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#ffad4d" }}
                  >
                    {site.url}
                  </a>
                </td>
                <td style={{ padding: 12 }}>
                  <Status status={site.status} />
                </td>
                <td style={{ padding: 12 }}>{site.last_status_code ?? "—"}</td>
                <td style={{ padding: 12 }}>
                  {site.last_response_ms == null
                    ? "—"
                    : `${site.last_response_ms} ms`}
                </td>
                <td style={{ padding: 12 }}>
                  {formatDate(site.last_checked_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Dernières vérifications</h2>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
          }}
        >
          <thead>
            <tr>
              {["Client", "Site", "Résultat", "HTTP", "Date"].map((heading) => (
                <th
                  key={heading}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid #333",
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(checks || []).map((check) => (
              <tr key={check.id}>
                <td style={{ padding: 12 }}>
                  {check.websites?.client_name || "Client"}
                </td>
                <td style={{ padding: 12 }}>{check.websites?.url || "—"}</td>
                <td style={{ padding: 12 }}>
                  <Status status={check.status} />
                </td>
                <td style={{ padding: 12 }}>{check.status_code ?? "—"}</td>
                <td style={{ padding: 12 }}>{formatDate(check.checked_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
