# EDGE-0091 — Full multi-tenant SaaS settings port

## Objectif
Fermer l'écart documenté dans le commentaire d'en-tête de `src/lib/settings.js` :
`getSaaSSettings_` (Code.gs) lisait un layer "master" par organisation depuis
la feuille Google Sheets partagée `Register` (plan d'abonnement, date
d'expiration, quotas IA PRO/FREE, champs d'identité) et le fusionnait SOUS
la feuille `Settings` locale de chaque école (`Object.assign({}, masterData,
local)` — le local gagne toujours). Cette couche "master" n'avait jamais été
portée : `getSaaSSettings` (Worker) ne lisait que la table `settings` locale
par tenant.

## Ce qui a changé

**`master-migrations/0002_org_saas_settings_ai_quotas.sql`** (+ mise à jour
de `master-schema.sql` pour les nouvelles installations) — ajoute à `orgs` :
- champs d'identité restants : `address`, `payment_type`,
  `picture_drive_link`, `org_drive_folder_id`, `student_portal_url`,
  `staff_app_url`, `contact_name`
- quotas IA à deux paliers : `ai_pro_access` (flag d'entitlement) +
  `ai_daily_token_limit_pro/free`, `ai_session_token_limit_pro/free`,
  `ai_monthly_token_limit_pro/free`, `ai_pro_daily_pdf_limit`

(`plan`, `expiration_date`, `business_name`, `email`, `phone`, `org_type`,
`design_json`, `rules_json`, `created_at` existaient déjà depuis
EDGE-0079/le travail de provisioning.)

**`src/lib/orgBilling.js`** (nouveau) — `getOrgBillingRow(env)` lit la
ligne `orgs` de ce tenant (`business_id = env.ORG_ID`, la même relation que
`src/lib/tenants.js`/`TENANTS` utilise déjà) ; `mapOrgRowToMasterData(row)`
la reprojette sur les mêmes clés historiques (`SCHOOL_NAME`,
`SUBSCRIPTION_PLAN`, `AI_PRO_DAILY_TOKEN_LIMIT`, etc.), y compris le
parsing de `design_json`/`rules_json` (logo, adresse de secours, préfixe
d'ID) — identique au comportement Code.gs. `resolveAiTierLimits(row)`
choisit le palier PRO ou FREE selon `ai_pro_access`.

**`src/actions/settings.js`** — `buildMerged` accepte maintenant un
paramètre `masterData` et l'utilise comme couche par défaut :
`{...(masterData||{}), ...local}`, exactement la précédence Code.gs.
`getSaaSSettings`/`getSettingsHealth` appellent `getOrgMasterData(env)`
avant de fusionner. Sans `MASTER_DB` lié (tests, environnements
pré-EDGE-0091) `masterData` est `null` et le comportement est strictement
identique à avant.

**`src/actions/ai_tokens.js`** — `quotaSettings` lit d'abord les clés
`settings` locales explicites (`DAILY_TOKEN_LIMIT`, etc. — override admin,
inchangé), puis retombe sur le palier PRO/FREE de `orgs` via
`resolveAiTierLimits` quand aucune valeur locale n'est définie.

## Ce qui n'a délibérément pas changé
- Le chemin d'écriture (`updateSaaSSettings`/`updateLocalSettings`) continue
  d'écrire uniquement dans la table `settings` du tenant, comme
  `persistSettingsEntries_` n'écrivait que dans la feuille `Settings`
  locale. Les champs de facturation (`plan`, `expiration_date`, quotas IA)
  restent gérés par le port du master admin dashboard
  (`masterSetAccountStatus`/`masterChangeSubscriptionPlan`), pas par
  l'écran de paramètres d'une école.
- `AI_PLAN_QUOTAS` (l'ancienne feuille de quotas partagée) reste retirée —
  Code.gs lui-même avait déjà basculé vers des colonnes par organisation
  dans `Register`, ce port continue cette même convention sur `orgs`.

## Validation
- `node test/run-org-billing-settings-test.mjs` : PASS — fusion
  MASTER_DB.orgs comme couche par défaut, override local toujours
  prioritaire, sélection de palier IA PRO/FREE, override explicite de
  quota toujours prioritaire sur le palier.
- Suite complète (`test/*.mjs`, 95 fichiers) : PASS, aucune régression.
- `node test/run-codegs-parity-audit-test.mjs` : PASS (239/239 actions
  d'inventaire enregistrées ; 265 actions runtime au total — inchangé,
  ce lot ajoute une couche de données, pas de nouvelle action).
