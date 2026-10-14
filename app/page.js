import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <nav className={styles.navbar}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>S</span>
          <span>
            SITE<span className={styles.logoAccent}>MONITOR</span>
          </span>
        </Link>

        <Link href="/dashboard" className={styles.navLink}>
          Dashboard <span aria-hidden="true">↗</span>
        </Link>
      </nav>

      <section className={styles.hero}>
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.badge}>
          <span className={styles.statusDot} />
          SURVEILLANCE DE SITES WEB
        </div>

        <h1 className={styles.title}>
          Tes sites web.
          <br />
          <span>Gardés à l’œil.</span>
        </h1>

        <p className={styles.description}>
          Surveille l'état de tes sites web depuis un seul espace. Consulte leur
          disponibilité, les derniers contrôles et les éventuelles
          interruptions.
        </p>

        <div className={styles.actions}>
          <Link href="/dashboard" className={styles.primaryButton}>
            Accéder au dashboard
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <div className={styles.windowDots}>
              <span />
              <span />
              <span />
            </div>
            <span className={styles.previewLabel}>APERÇU DU MONITORING</span>
            <span className={styles.liveBadge}>
              <span className={styles.statusDot} />
              MONITORING
            </span>
          </div>

          <div className={styles.previewBody}>
            <div className={styles.previewText}>
              <span>DISPONIBILITÉ</span>
              <strong>En un coup d’œil.</strong>
              <p>Un espace centralisé pour tes sites.</p>
            </div>

            <div className={styles.previewIcon} aria-hidden="true">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 25H14L20 12L28 36L34 22H43"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <div className={styles.previewFooter}>
            <span>ÉTAT DES SITES</span>
            <span>HISTORIQUE DES CONTRÔLES</span>
            <span>ALERTES EMAIL</span>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} SITE MONITOR</span>
        <span>Simple. Clair. Efficace.</span>
      </footer>
    </main>
  );
}
