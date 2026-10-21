import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUsersPage, getSubscriptionsForUsers } from "../admin-data";
import styles from "../admin-page.module.css";
import pageStyles from "./users.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function getPageNumber(value) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function statusLabel(status) {
  const labels = {
    active: "Actif",
    trialing: "Essai",
    past_due: "À régulariser",
    canceled: "Annulé",
    incomplete: "Incomplet",
  };
  return labels[status] ?? status ?? "Inconnu";
}

export default async function AdminUsersPage({ searchParams }) {
  const params = await searchParams;
  const search = String(params?.q ?? "").trim().slice(0, 254);
  const page = getPageNumber(params?.page);
  const { users, total, hasMore } = await getAuthUsersPage({
    page,
    perPage: PAGE_SIZE,
    search,
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pageCount) {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (pageCount > 1) query.set("page", String(pageCount));
    redirect(`/admin/users${query.size ? `?${query}` : ""}`);
  }
  const subscriptions = await getSubscriptionsForUsers(
    users.map((user) => user.id),
  );
  const makeHref = (nextPage) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (nextPage > 1) query.set("page", String(nextPage));
    const suffix = query.toString();
    return `/admin/users${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>ADMINISTRATION / COMPTES</span>
        <h1>Utilisateurs</h1>
        <p>
          Consultation en lecture seule des comptes et de leur abonnement.
          Aucune action sur le compte utilisateur n’est proposée ici.
        </p>
      </header>

      <section className={`${styles.section} ${pageStyles.userSection}`}>
        <form className={pageStyles.search} action="/admin/users">
          <label htmlFor="user-search">Rechercher par adresse e-mail</label>
          <div>
            <input
              id="user-search"
              name="q"
              type="search"
              maxLength={254}
              defaultValue={search}
              placeholder="nom@exemple.fr"
            />
            <button type="submit">Rechercher</button>
          </div>
        </form>

        <div className={pageStyles.tableWrap}>
          <table className={pageStyles.table}>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Créé le</th>
                <th>Forfait</th>
                <th>État</th>
                <th>Échéance</th>
                <th>Confirmation e-mail</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const subscription = subscriptions.get(user.id);
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.email ?? "Adresse absente"}</strong>
                      <small>{user.id}</small>
                    </td>
                    <td>
                      {user.created_at
                        ? new Intl.DateTimeFormat("fr-FR", {
                            dateStyle: "medium",
                          }).format(new Date(user.created_at))
                        : "—"}
                    </td>
                    <td>
                      {subscription?.plan_catalog?.name ??
                        subscription?.plan_id ??
                        "Non attribué"}
                    </td>
                    <td>
                      <span className={pageStyles.status}>
                        {statusLabel(subscription?.status)}
                      </span>
                    </td>
                    <td>
                      {subscription?.current_period_end
                        ? `${subscription.cancel_at_period_end ? "Fin " : ""}${new Intl.DateTimeFormat("fr-FR", {
                            dateStyle: "medium",
                            timeZone: "UTC",
                          }).format(new Date(subscription.current_period_end))}`
                        : "—"}
                    </td>
                    <td>
                      {user.email_confirmed_at ? "Confirmée" : "En attente"}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td className={pageStyles.empty} colSpan={6}>
                    {search
                      ? "Aucun compte ne correspond à cette adresse."
                      : "Aucun utilisateur trouvé."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className={pageStyles.pagination}>
          <span>
            {total.toLocaleString("fr-FR")} résultat{total > 1 ? "s" : ""}
            {search ? ` pour « ${search} »` : ""}
            {` · page ${Math.min(page, pageCount)} sur ${pageCount}`}
          </span>
          <div>
            {page > 1 && (
              <Link href={makeHref(page - 1)}>← Précédent</Link>
            )}
            {hasMore && page < pageCount && (
              <Link href={makeHref(page + 1)}>Suivant →</Link>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}
