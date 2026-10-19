# Site Monitor

Application Next.js pour surveiller la disponibilité, les certificats TLS, les
en-têtes de sécurité et l'intégrité de sites web. Les contrôles HTTP et
d'intégrité sont planifiés une fois par jour à 08:00 UTC.

## Démarrage

1. Installer les dépendances avec `npm install`.
2. Configurer les variables suivantes dans `.env.local` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (ou l'ancienne clé publique
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement, utilisée par les tâches cron)
   - `CRON_SECRET`
   - `RESEND_API_KEY` et `ALERT_FROM_EMAIL` pour les notifications e-mail
3. Exécuter la migration
   [`20261019000000_user_auth_and_website_isolation.sql`](./supabase/migrations/20261019000000_user_auth_and_website_isolation.sql)
   sur le projet Supabase.
4. Exécuter la migration de permissions
   [`20261019000001_grant_authenticated_dashboard_access.sql`](./supabase/migrations/20261019000001_grant_authenticated_dashboard_access.sql).
5. Exécuter la migration DNS et expiration de domaine
   [`20261019000004_add_dns_and_domain_checks.sql`](./supabase/migrations/20261019000004_add_dns_and_domain_checks.sql).
   Elle retire également les colonnes de règle HTTP abandonnées.
6. Démarrer l'application avec `npm run dev`.

## Authentification Supabase

Les utilisateurs peuvent créer un compte par e-mail et mot de passe, ou se
connecter avec Google ou GitHub. Dans Supabase, active les fournisseurs Google
et GitHub souhaités, configure leurs identifiants OAuth et ajoute les URL de
redirection suivantes dans la configuration Auth :

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
requièrent le secret `CRON_SECRET`.

## Surveillance DNS et expiration de domaine

Les enregistrements A, AAAA, CNAME, MX, NS et TXT sont comparés au contrôle
précédent afin de signaler les changements et les échecs de résolution. La date
d'expiration du domaine est consultée via RDAP lorsqu'elle est fournie par le
registre. Certains domaines ne publient pas cette information.
