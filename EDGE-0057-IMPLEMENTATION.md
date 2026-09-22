# EDGE-0057 — Sécurité Offline complète

## Objectif
Renforcer le modèle Offline-first sans changer l'autorité Cloud : le terminal peut travailler hors ligne, mais les accès locaux et les écritures synchronisées restent soumis à l'identité Edge, à l'appareil enregistré et aux permissions.

## Mesures
- `EDU_EDGE_REQUIRE_OFFLINE_AUTH=true` par défaut : une synchronisation offline sans session Edge valide est refusée.
- Vérification de l'expiration de la session avant chaque `syncPush`.
- Vérification `siteId` : un batch destiné à un autre site est rejeté.
- Vérification de l'appareil enregistré/révoqué avant `syncPush` lorsque `EDU_EDGE_REQUIRE_REGISTERED_DEVICE=true`.
- Contrôle de permissions par domaine avant mise en queue : étudiants, notes, paiements, présence, emploi du temps et affectations enseignants.
- Les opérations de suppression utilisent également les permissions d'écriture du domaine.
- Upload média protégé par identité + permissions + contrôle de terminal.
- Cloud reste l'autorité finale ; l'Edge ne contourne pas les permissions Cloud.

## Compatibilité tests
Les tests historiques purement locaux qui ne simulent pas une session Edge peuvent définir `EDU_EDGE_REQUIRE_OFFLINE_AUTH=false` et/ou `EDU_EDGE_REQUIRE_REGISTERED_DEVICE=false`. Ces exceptions sont uniquement destinées aux tests ; les valeurs de production restent sécurisées par défaut.

## Test
`npm run test:edge-security`

Le test vérifie notamment :
1. rejet d'un `syncPush` non authentifié ;
2. rejet d'un `siteId` différent ;
3. rejet d'un domaine sans permission ;
4. acceptation d'une écriture autorisée sur un terminal enregistré ;
5. rejet d'une écriture après révocation du terminal.
