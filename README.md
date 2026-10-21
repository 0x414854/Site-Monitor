# Site Monitor

Application Next.js pour surveiller la disponibilité, les certificats TLS, les
en-têtes de sécurité et l'intégrité de sites web. Les contrôles HTTP et
d'intégrité sont planifiés une fois par jour à 08:00 UTC.

## Ajouter provider Github et google

##

## Démarrage

1. Installer les dépendances avec `npm install`.
2. Configurer les variables suivantes dans `.env.local` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (ou l'ancienne clé publique
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement, utilisée par les tâches cron)
   - `CRON_SECRET`
   - `RESEND_API_KEY` et `ALERT_FROM_EMAIL` pour les notifications e-mail
   - `NEXT_PUBLIC_SITE_URL` (URL canonique de l'application)
   - `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` pour la facturation
   - `PLATFORM_ADMIN_EMAIL` pour protéger l'espace d'administration
3. Exécuter la migration
   [`20261019000000_user_auth_and_website_isolation.sql`](./supabase/migrations/20261019000000_user_auth_and_website_isolation.sql)
   sur le projet Supabase.
4. Exécuter la migration de permissions
   [`20261019000001_grant_authenticated_dashboard_access.sql`](./supabase/migrations/20261019000001_grant_authenticated_dashboard_access.sql).
5. Exécuter la migration DNS et expiration de domaine
   [`20261019000004_add_dns_and_domain_checks.sql`](./supabase/migrations/20261019000004_add_dns_and_domain_checks.sql).
   Elle retire également les colonnes de règle HTTP abandonnées.
6. Exécuter la migration des forfaits
   [`20261020000000_add_subscription_plans.sql`](./supabase/migrations/20261020000000_add_subscription_plans.sql).
   Elle crée le catalogue, attribue le forfait Gratuit aux comptes existants et
   applique le quota de sites côté base de données.
7. Exécuter la migration du parcours d'inscription
   [`20261020000002_add_signup_onboarding.sql`](./supabase/migrations/20261020000002_add_signup_onboarding.sql).
   Elle ajoute les intentions d'inscription, leurs limites de renvoi/paiement
   ainsi que la déduplication des événements Stripe. Elle doit être appliquée
   après la migration des forfaits.
8. Exécuter la migration d'exemption de quota administrateur
   [`20261021000000_admin_site_limit_exemption.sql`](./supabase/migrations/20261021000000_admin_site_limit_exemption.sql).
   Elle permet au compte défini par `PLATFORM_ADMIN_EMAIL` d'ajouter des sites
   sans le quota de son forfait. L'application donne aussi à ce compte accès
   aux contrôles d'en-têtes et d'intégrité, ainsi qu'à leur exécution planifiée;
   les limites et fonctionnalités des autres comptes restent inchangées.
9. Démarrer l'application avec `npm run dev`.

## Authentification Supabase

Les utilisateurs peuvent créer un compte par e-mail et mot de passe, ou se
connecter avec Google ou GitHub. L'inscription conserve le forfait choisi dans
une intention serveur pendant 24 heures. Après confirmation de l'adresse, le
compte est associé à cette intention et le parcours reprend sur une page de
récapitulatif. Un compte payant reste sur le forfait Gratuit tant que Stripe
n'a pas confirmé l'abonnement; les utilisateurs peuvent modifier leur choix
avant de commencer le paiement. La connexion ultérieure reprend aussi une
inscription payante inachevée.

Dans Supabase, active les fournisseurs Google et GitHub souhaités, configure
leurs identifiants OAuth et ajoute les URL de redirection suivantes dans la
configuration Auth :

- Développement : `http://localhost:3000/auth/callback`
- Production : `https://<ton-domaine>/auth/callback`

Configure aussi l'URL du site et les modèles e-mail de confirmation et de
réinitialisation de mot de passe. Pour une utilisation en production, configure
un fournisseur SMTP fiable pour Supabase Auth.

## Isolation des données

La migration ajoute `owner_id` aux sites et active les politiques RLS sur les
sites, contrôles, incidents, vérifications SSL, audits de sécurité et données
d'intégrité. Les pages et actions de l'application utilisent la session de
l'utilisateur; seul le code serveur des tâches planifiées utilise la clé
`SUPABASE_SERVICE_ROLE_KEY`.

Au déploiement de la migration, les sites historiques sont attribués au compte
authentifié le plus ancien s'il en existe un. Sinon, le premier compte créé les
récupère automatiquement. Crée donc ton compte avant d'ouvrir l'application aux
inscriptions publiques afin de conserver la propriété des données existantes.

## Tâches planifiées

`vercel.json` planifie les contrôles de disponibilité et d'intégrité chaque
jour à 08:00 UTC. Les routes `/api/cron/check` et `/api/cron/integrity`
requièrent le secret `CRON_SECRET`. Chaque route n'exécute que les sites dont
l'intervalle de forfait est échu et respecte le quota en surveillant en
priorité les sites les plus anciens. Après un changement de forfait à la baisse,
les sites excédentaires restent dans le compte mais ne sont pas contrôlés.

Pour augmenter la fréquence plus tard, il faudra aussi augmenter la fréquence
du cron dans `vercel.json` (et vérifier les limites de l'offre Vercel utilisée).
Une fréquence de forfait plus courte que la cadence du cron ne peut pas être
respectée par ce déploiement.

## Surveillance DNS et expiration de domaine

Les enregistrements A, AAAA, CNAME, MX, NS et TXT sont comparés au contrôle
précédent afin de signaler les changements et les échecs de résolution. La date
d'expiration du domaine est consultée via RDAP lorsqu'elle est fournie par le
registre. Certains domaines ne publient pas cette information.

## Forfaits et facturation Stripe

Le forfait est sélectionné à l'inscription. Le compte reçoit d'abord le forfait
Gratuit; un forfait payant n'est activé qu'après confirmation par le webhook
Stripe. Les quotas de sites, la rétention d'historique, l'intervalle des
contrôles et les fonctionnalités sont lus depuis `plan_catalog` et appliqués
côté serveur. Le quota est aussi protégé par un trigger SQL.
Les alertes essentielles de disponibilité restent actives; l'option
`advanced_alerts` contrôle les alertes e-mail SSL, DNS et expiration de domaine.

L'espace `/admin` est réservé à l'adresse définie par `PLATFORM_ADMIN_EMAIL`,
comparée à l'adresse du compte connecté. Le dashboard n'affiche son lien
d'administration qu'à ce compte, et le layout serveur de toutes les pages
`/admin/*` vérifie aussi l'accès. Les actions d'écriture d'administration
vérifient à nouveau la session et l'adresse côté serveur.

- `/admin` : comptes, abonnements, sites et MRR théorique.
- `/admin/users` : comptes et abonnements en lecture seule, avec recherche
  d'adresse e-mail et pagination.
- `/admin/plans` : configuration des forfaits et validation des Price IDs.
- `/admin/configuration` : présence des variables d'intégration sans afficher
  leurs valeurs secrètes.

Les données d'authentification et de facturation sont chargées exclusivement
côté serveur avec les privilèges de service; aucune clé privilégiée n'est
envoyée au navigateur. Le MRR est une estimation depuis les forfaits en base,
pas une source comptable. La recherche d'e-mail parcourt les pages de l'API
Supabase Auth et peut devenir coûteuse si le nombre de comptes augmente
fortement; à cette échelle, prévoir un répertoire utilisateur indexé.

Dans Stripe :

1. Crée les prix récurrents correspondant aux forfaits payants.
2. Configure leurs Price IDs dans `/admin/plans` après connexion avec
   l'adresse définie par `PLATFORM_ADMIN_EMAIL`.
3. Configure le portail client Stripe pour permettre aux utilisateurs de gérer
   leur abonnement.
4. Ajoute l'endpoint `https://<ton-domaine>/api/billing/webhook` avec les
   événements `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `checkout.session.async_payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted` et `invoice.payment_failed`; renseigne le
   secret de signature fourni dans `STRIPE_WEBHOOK_SECRET`.

Les changements de forfaits payants et les annulations des abonnés existants
sont effectués via le portail Stripe depuis `/billing`. La migration des
forfaits et celle du parcours d'inscription doivent être exécutées avant
d'utiliser ces parcours. Les Price IDs, les événements webhook et les clés
Stripe sont nécessaires avant d'activer les paiements en production.
