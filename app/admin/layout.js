import Link from "next/link";
import { requirePlatformAdmin } from "@/utils/platform-admin";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const navigation = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/users", label: "Utilisateurs" },
  { href: "/admin/plans", label: "Forfaits" },
  { href: "/admin/configuration", label: "Configuration" },
];

export default async function AdminLayout({ children }) {
  const user = await requirePlatformAdmin();

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/admin" className={styles.brand}>
          SITE<span>MONITOR</span>
          <small>ADMIN</small>
        </Link>
        <div className={styles.account}>
          <span>{user.email}</span>
          <Link href="/dashboard">Retour à l’application</Link>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Navigation administration">
          <span className={styles.navLabel}>ESPACE ADMIN</span>
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
