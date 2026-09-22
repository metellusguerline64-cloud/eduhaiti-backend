# EDGE-0079 — Cycle de vie des comptes / synchronisation du statut

## Périmètre du lot
Ce lot ferme un écart concret identifié dans la migration : `checkAndUpdateAccountStatus` utilisait encore une table `schools` et des colonnes `active/subscription_plan`, alors que le contrôle de comptes Cloud est désormais porté par `MASTER_DB.orgs` (`status`, `plan`, `expiration_date`).

## Corrections
- `checkAndUpdateAccountStatus` lit maintenant `MASTER_DB.orgs`.
- Ciblage individuel par `orgId`, `schoolId`, `businessId` ou `subdomain`.
- `all=true` reste réservé aux comptes master/GodMode.
- Les plans à vie restent actifs.
- Une date d'expiration passée entraîne `SUSPENDED`; une date future maintient `ACTIVE`.
- Un compte sans date d'expiration conserve son état existant, conformément au comportement du code source.
- Le résultat conserve `reviewed`, `changed` et `data` pour compatibilité frontend.
- Les changements sont audités dans le D1 de l'école.
- Ajout de `orgs.expiration_date` au schéma Master et d'un index.
- Aucun email, secret, Folder ID ou identifiant administrateur n'est hardcodé.

## Ce qui n'est pas déclaré terminé
Le `Code.gs` fourni dans ce projet ne contient pas de fonctions nommées `masterSetAccountStatus` ou `masterChangeSubscriptionPlan`; elles ne sont donc pas inventées dans ce lot. La surface Mission Overseer (`is_mother` / `parent_org_id`) reste également un chantier séparé tant qu'une implémentation source exploitable n'est pas présente.

## Validation
- `run-account-status-test.mjs`: PASS
- `run-accounts-test.mjs`: PASS
- `run-codegs-parity-audit-test.mjs`: PASS (242/242 actions enregistrées; ce test mesure le registre, pas une preuve de parité comportementale complète)
- `node --check src/actions/legacy_batch_0068.js`: PASS
- `node --check src/actions/accounts.js`: PASS
