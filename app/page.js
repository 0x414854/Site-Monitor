import Link from "next/link";
import styles from "./page.module.css";
import { createClient } from "@/utils/supabase/server";

const features = [
  {
    number: "01",
    icon: "↗",
    title: "Disponibilité HTTP",
    description:
      "Détecte les interruptions, les erreurs HTTP et les temps de réponse anormaux pour repérer les problèmes avant tes utilisateurs.",
    tag: "UPTIME",
  },
  {
    number: "02",
    icon: "◇",
    title: "Certificats SSL",
    description:
      "Surveille les certificats HTTPS et anticipe leur expiration avant qu'ils ne provoquent des alertes de sécurité.",
    tag: "SSL / TLS",
  },
  {
    number: "03",
    icon: "⌘",
    title: "Configuration DNS",
    description:
      "Contrôle les enregistrements DNS essentiels pour identifier les changements ou les configurations inattendues.",
    tag: "DNS",
  },
  {
    number: "04",
    icon: "⌁",
    title: "Intégrité du site",
    description:
      "Détecte les modifications inattendues du contenu surveillé grâce à des contrôles d'intégrité.",
    tag: "INTEGRITY",
  },
  {
    number: "05",
    icon: "⬡",
    title: "En-têtes de sécurité",
    description:
      "Vérifie les principaux en-têtes HTTP de sécurité et identifie les protections manquantes ou mal configurées.",
    tag: "HEADERS",
  },
  {
    number: "06",
    icon: "◷",
    title: "Alertes et historique",
    description:
      "Centralise les événements et les alertes pour comprendre ce qui s'est passé et quand intervenir.",
    tag: "ALERTS",
  },
];

const planFeatureLabels = {
  http: "Surveillance de disponibilité HTTP",
  ssl: "Contrôle du certificat SSL",
  dns: "Vérifications DNS",
  security_headers: "Contrôle des en-têtes de sécurité",
  integrity: "Contrôles d’intégrité",
  advanced_alerts: "Alertes et historique avancés",
  multi_site: "Vue centralisée multi-sites",
};

function getPlanFeatures(plan) {
  const flags = plan.feature_flags ?? {};

  return [
    ...Object.entries(planFeatureLabels)
      .filter(([key]) => flags[key])
      .map(([, label]) => label),
    `Historique des contrôles sur ${plan.history_days} jours`,
    "Alertes essentielles par e-mail",
  ];
}

const faqs = [
  {
    question: "À qui s'adresse SITE MONITOR ?",
    answer:
      "Aux indépendants, développeurs, propriétaires de sites et agences qui veulent surveiller leurs sites web depuis un espace centralisé.",
  },
  {
    question: "Que signifie surveiller la disponibilité ?",
    answer:
      "Un contrôle HTTP permet de vérifier la réponse d'un site, notamment son code de statut et son temps de réponse. Un code 200 indique que la requête a réussi, mais ne garantit pas à lui seul que toutes les fonctionnalités du site fonctionnent.",
  },
  {
    question: "Puis-je changer de forfait plus tard ?",
    answer:
      "La structure tarifaire proposée prévoit trois niveaux. Les modalités de changement de forfait et de facturation devront être configurées avant l'ouverture des abonnements.",
  },
  {
    question: "Les contrôles sont-ils déjà actifs sur mes sites ?",
    answer:
      "La page présente les fonctionnalités prévues pour le produit. Seuls les contrôles effectivement implémentés et configurés dans ton application pourront fournir des résultats réels.",
  },
];

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={styles.arrowIcon}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={styles.checkIcon}
    >
      <path
        d="m5 10 3.2 3.2L15 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: plans, error: plansError } = await supabase
    .from("plan_catalog")
    .select(
      "id, name, description, price_cents, currency, billing_interval, max_sites, history_days, feature_flags, display_order",
    )
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (plansError) {
    console.error("Chargement des forfaits publics :", plansError.message);
    throw new Error("Impossible de charger les offres.");
  }

  return (
    <main className={styles.page}>
      <nav className={styles.navbar} aria-label="Navigation principale">
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>S</span>
          <span className={styles.logoName}>
            SITE<span>MONITOR</span>
          </span>
        </Link>

        <div className={styles.navLinks}>
          <a href="#fonctionnalites" className={styles.navItem}>
            Fonctionnalités
          </a>
          <a href="#tarifs" className={styles.navItem}>
            Tarifs
          </a>
          <Link href="/login" className={styles.navLogin}>
            Se connecter
          </Link>
          <Link href="/login" className={styles.navCta}>
            Commencer <ArrowIcon />
          </Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid} aria-hidden="true" />

        <div className={`${styles.heroContent} ${styles.reveal}`}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            LA SURVEILLANCE WEB, SIMPLEMENT
          </div>

          <h1 className={styles.heroTitle}>
            Tes sites méritent
            <br />
            une <span>surveillance</span>
            <br />
            sans angle mort.
          </h1>

          <p className={styles.heroDescription}>
            Disponibilité, certificats SSL, DNS, intégrité et sécurité HTTP.
            Garde un œil sur tes sites depuis un seul tableau de bord.
          </p>

          <div className={styles.heroActions}>
            <Link href="/login" className={styles.primaryButton}>
              Surveiller mon premier site <ArrowIcon />
            </Link>
            <a href="#fonctionnalites" className={styles.secondaryButton}>
              Découvrir les fonctionnalités
            </a>
          </div>

          <div className={styles.heroTrust}>
            <span className={styles.trustIcon}>
              <CheckIcon />
            </span>
            <span>Un site pour commencer.</span>
            <span className={styles.trustSeparator}>·</span>
            <span>0 € pour démarrer.</span>
          </div>
        </div>

        <div
          className={`${styles.dashboardWrap} ${styles.revealDelayed}`}
          aria-label="Illustration d'un tableau de bord de surveillance"
        >
          <div className={styles.dashboardHalo} aria-hidden="true" />

          <div className={styles.dashboard}>
            <div className={styles.dashTopbar}>
              <div className={styles.dashBrand}>
                <span className={styles.dashLogo}>S</span>
                <span>Monitoring overview</span>
              </div>
              <span className={styles.demoBadge}>APERÇU DÉMO</span>
            </div>

            <div className={styles.dashHeading}>
              <div>
                <span className={styles.dashKicker}>TABLEAU DE BORD</span>
                <h2>Vue d’ensemble</h2>
                <p>Une vision claire de tes sites web.</p>
              </div>
              <span className={styles.dashPeriod}>Derniers contrôles</span>
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Sites surveillés</span>
                <strong>05</strong>
                <span className={styles.metricHint}>Exemple de données</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Disponibilité</span>
                <strong className={styles.metricGreen}>99,98%</strong>
                <span className={styles.metricHint}>Exemple de données</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Temps de réponse</span>
                <strong>
                  184<span className={styles.metricUnit}> ms</span>
                </strong>
                <span className={styles.metricHint}>Exemple de données</span>
              </div>
            </div>

            <div className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div>
                  <span className={styles.metricLabel}>TEMPS DE RÉPONSE</span>
                  <strong>Activité des contrôles</strong>
                </div>
                <span className={styles.chartLegend}>
                  <span /> Réponse HTTP
                </span>
              </div>
              <div className={styles.chart}>
                {[
                  34, 45, 39, 56, 42, 48, 36, 61, 50, 43, 67, 46, 53, 38, 49,
                  62, 44, 35, 55, 42, 59, 46, 39, 51,
                ].map((height, index) => (
                  <span
                    key={index}
                    className={styles.chartBar}
                    style={{ "--bar-height": `${height}%` }}
                  />
                ))}
              </div>
              <div className={styles.chartAxis}>
                <span>Il y a 24 h</span>
                <span>Maintenant</span>
              </div>
            </div>

            <div className={styles.siteList}>
              <div className={styles.siteListHeader}>
                <span>EXEMPLE DE SITES</span>
                <span>STATUT</span>
              </div>
              {[
                ["site-exemple.fr", "HTTPS", "En ligne"],
                ["boutique-exemple.fr", "HTTPS", "En ligne"],
                ["api-exemple.fr", "HTTP", "À vérifier"],
              ].map(([site, protocol, status]) => (
                <div className={styles.siteRow} key={site}>
                  <span className={styles.siteIdentity}>
                    <span className={styles.siteFavicon}>
                      {site.charAt(0).toUpperCase()}
                    </span>
                    <span className={styles.siteNameGroup}>
                      <strong>{site}</strong>
                      <small>{protocol} · Exemple fictif</small>
                    </span>
                  </span>
                  <span
                    className={
                      status === "En ligne"
                        ? styles.siteStatus
                        : styles.siteStatusWarning
                    }
                  >
                    <span />
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.floatCard}>
            <span className={styles.floatIcon}>
              <CheckIcon />
            </span>
            <span>
              <strong>Un seul espace</strong>
              <small>Tes contrôles réunis</small>
            </span>
          </div>
        </div>

        <a href="#fonctionnalites" className={styles.scrollCue}>
          <span className={styles.scrollLine} />
          EXPLORER
        </a>
      </section>

      <section className={styles.proofStrip}>
        <p>UNE VISION CLAIRE DE LA SANTÉ DE TES SITES</p>
        <div className={styles.proofItems}>
          <span>
            <i>01</i> Disponibilité HTTP
          </span>
          <span>
            <i>02</i> Certificats SSL
          </span>
          <span>
            <i>03</i> DNS & intégrité
          </span>
          <span>
            <i>04</i> Sécurité HTTP
          </span>
        </div>
      </section>

      <section
        id="fonctionnalites"
        className={`${styles.section} ${styles.featuresSection}`}
      >
        <div className={styles.sectionHeading}>
          <span className={styles.sectionEyebrow}>CE QUI COMPTE VRAIMENT</span>
          <h2>
            La santé de tes sites,
            <br />
            <span>sans multiplier les outils.</span>
          </h2>
          <p>
            Les informations essentielles réunies dans un espace conçu pour
            t'aider à détecter les problèmes et à agir plus rapidement.
          </p>
        </div>

        <div className={styles.featureGrid}>
          {features.map((feature) => (
            <article className={styles.featureCard} key={feature.number}>
              <div className={styles.featureTop}>
                <span className={styles.featureIcon}>{feature.icon}</span>
                <span className={styles.featureNumber}>{feature.number}</span>
              </div>
              <span className={styles.featureTag}>{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <span className={styles.featureArrow} aria-hidden="true">
                ↗
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.workflowSection}>
        <div className={styles.workflowVisual}>
          <div className={`${styles.orbit} ${styles.orbitOuter}`} />
          <div className={`${styles.orbit} ${styles.orbitInner}`} />
          <div className={styles.orbitCore}>
            <span className={styles.coreLogo}>S</span>
            <strong>Un seul espace</strong>
            <span>Pour tous tes sites</span>
          </div>
          <span className={`${styles.orbitNode} ${styles.nodeTop}`}>SSL</span>
          <span className={`${styles.orbitNode} ${styles.nodeRight}`}>
            HTTP
          </span>
          <span className={`${styles.orbitNode} ${styles.nodeBottom}`}>
            DNS
          </span>
          <span className={`${styles.orbitNode} ${styles.nodeLeft}`}>TLS</span>
        </div>

        <div className={styles.workflowContent}>
          <span className={styles.sectionEyebrow}>MOINS DE DISPERSION</span>
          <h2>
            Comprends ce qui se passe.
            <br />
            <span>Réagis au bon moment.</span>
          </h2>
          <p>
            Plus besoin de jongler entre plusieurs outils pour vérifier les
            éléments essentiels de tes sites. Centralise tes contrôles, consulte
            les résultats et identifie plus facilement les points à examiner.
          </p>
          <ul className={styles.workflowList}>
            <li>
              <CheckIcon /> Un tableau de bord multi-sites
            </li>
            <li>
              <CheckIcon /> Des résultats lisibles et exploitables
            </li>
            <li>
              <CheckIcon /> Un historique pour comprendre les incidents
            </li>
          </ul>
          <Link href="/login" className={styles.textCta}>
            Créer mon espace <ArrowIcon />
          </Link>
        </div>
      </section>

      <section
        id="tarifs"
        className={`${styles.section} ${styles.pricingSection}`}
      >
        <div className={styles.sectionHeading}>
          <span className={styles.sectionEyebrow}>DES TARIFS LISIBLES</span>
          <h2>
            Commence petit.
            <br />
            <span>Évolue à ton rythme.</span>
          </h2>
          <p>
            Commence gratuitement avec un site, puis augmente ta capacité
            lorsque tes besoins évoluent.
          </p>
        </div>

        <div className={styles.pricingGrid}>
          {plans.map((plan) => {
            const featured = plan.id === "starter";
            const formattedPrice = new Intl.NumberFormat("fr-FR", {
              maximumFractionDigits: 2,
            }).format(plan.price_cents / 100);

            return (
            <article
              className={`${styles.priceCard} ${
                featured ? styles.priceCardFeatured : ""
              }`}
              key={plan.id}
            >
              {featured && (
                <span className={styles.popularBadge}>LE PLUS POPULAIRE</span>
              )}

              <div className={styles.planHeader}>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className={styles.price}>
                <span className={styles.currency}>
                  {new Intl.NumberFormat("fr-FR", {
                    style: "currency",
                    currency: plan.currency.toUpperCase(),
                    maximumFractionDigits: 0,
                  })
                    .formatToParts(plan.price_cents / 100)
                    .find((part) => part.type === "currency")?.value ?? "€"}
                </span>
                <strong>{formattedPrice}</strong>
                <span className={styles.pricePeriod}>
                  {plan.billing_interval === "month"
                    ? "/ mois"
                    : plan.billing_interval === "year"
                      ? "/ an"
                      : "pour toujours"}
                </span>
              </div>

              <div className={styles.siteAllowance}>
                <CheckIcon />
                <strong>
                  {plan.max_sites === 1
                    ? "1 site surveillé"
                    : `Jusqu’à ${plan.max_sites} sites`}
                </strong>
              </div>

              <Link
                href={`/login?plan=${encodeURIComponent(plan.id)}`}
                className={
                  featured
                    ? styles.priceButtonFeatured
                    : styles.priceButton
                }
              >
                {plan.price_cents === 0
                  ? "Commencer gratuitement"
                  : `Choisir ${plan.name}`}{" "}
                <ArrowIcon />
              </Link>

              <div className={styles.planDivider} />

              <span className={styles.planIncludes}>Inclus dans l'offre</span>
              <ul className={styles.planFeatures}>
                {getPlanFeatures(plan).map((feature) => (
                  <li key={feature}>
                    <CheckIcon />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
            );
          })}
        </div>

        <p className={styles.pricingNote}>
          Les limites et fonctionnalités affichées proviennent de la
          configuration actuelle des forfaits. Les prix et conditions peuvent
          évoluer avant la commercialisation.
        </p>
      </section>

      <section className={styles.faqSection}>
        <div className={styles.faqIntro}>
          <span className={styles.sectionEyebrow}>QUESTIONS FRÉQUENTES</span>
          <h2>
            Des réponses
            <br />
            <span>sans détour.</span>
          </h2>
          <p>Les informations utiles avant de commencer.</p>
        </div>

        <div className={styles.faqList}>
          {faqs.map((faq) => (
            <details className={styles.faqItem} key={faq.question}>
              <summary>
                {faq.question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalGlow} aria-hidden="true" />
        <span className={styles.sectionEyebrow}>
          TON PROCHAIN CONTRÔLE COMMENCE ICI
        </span>
        <h2>
          Garde tes sites
          <br />
          <span>à portée de vue.</span>
        </h2>
        <p>
          Crée ton espace et commence avec un premier site. Tu pourras évoluer
          vers une offre supérieure selon tes besoins.
        </p>
        <Link href="/login" className={styles.primaryButton}>
          Commencer gratuitement <ArrowIcon />
        </Link>
        <span className={styles.finalNote}>1 site · 0 € pour commencer</span>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>S</span>
          <span className={styles.logoName}>
            SITE<span>MONITOR</span>
          </span>
        </Link>

        <p>La visibilité sur tes sites, en un seul endroit.</p>

        <div className={styles.footerLinks}>
          <a href="#fonctionnalites">Fonctionnalités</a>
          <a href="#tarifs">Tarifs</a>
          <Link href="/login">Connexion</Link>
        </div>

        <span className={styles.copyright}>
          © {new Date().getFullYear()} SITE MONITOR
        </span>
      </footer>
    </main>
  );
}
