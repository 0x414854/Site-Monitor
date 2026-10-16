import styles from "@/styles/components/dashboard/incidentHistory.module.css";

function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getDuration(startedAt, resolvedAt) {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();

  if (!Number.isFinite(start) || end < start) return "—";

  const totalMinutes = Math.floor((end - start) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;

  return `${minutes} min`;
}

function getWebsite(incident) {
  const relation = incident.websites;
  return Array.isArray(relation) ? relation[0] : relation;
}

export default function IncidentHistory({ incidents = [] }) {
  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>SURVEILLANCE</span>
          <h2>Historique des incidents</h2>
        </div>

        <span className={styles.count}>
          {incidents.length} incident{incidents.length > 1 ? "s" : ""}
        </span>
      </div>

      {incidents.length === 0 ? (
        <div className={styles.empty}>
          <h3>Aucun incident enregistré</h3>
          <p>
            Les incidents apparaîtront ici lorsqu’un site sera déclaré en panne.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Site</th>
                <th>État</th>
                <th>Début</th>
                <th>Rétablissement</th>
                <th>Durée</th>
                <th>Code HTTP</th>
                <th>Dernière erreur</th>
              </tr>
            </thead>

            <tbody>
              {incidents.map((incident) => {
                const website = getWebsite(incident);
                const isOpen = !incident.resolved_at;

                return (
                  <tr key={incident.id}>
                    <td>
                      <div className={styles.site}>
                        <strong>
                          {website?.client_name ||
                            website?.url ||
                            "Site inconnu"}
                        </strong>

                        {website?.url && <span>{website.url}</span>}
                      </div>
                    </td>

                    <td>
                      <span
                        className={`${styles.badge} ${
                          isOpen ? styles.open : styles.resolved
                        }`}
                      >
                        {isOpen ? "En cours" : "Résolu"}
                      </span>
                    </td>

                    <td>{formatDate(incident.started_at)}</td>
                    <td>{isOpen ? "—" : formatDate(incident.resolved_at)}</td>
                    <td>
                      {getDuration(incident.started_at, incident.resolved_at)}
                    </td>
                    <td>{incident.status_code ?? "—"}</td>
                    <td className={styles.error}>
                      {incident.last_error || "Aucun détail"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
