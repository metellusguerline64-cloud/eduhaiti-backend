# EduHaïti Edge 0037 — Site Local Data Store

## Objectif

Ajouter un stockage local persistant à l’Edge sans changer la hiérarchie d’autorité : Cloud = autorité globale, Edge = relais/store local du site, terminal = Offline-first.

## Flux

1. `syncPush` arrive sur l’Edge. Les entrées sont mises en file persistante et reflétées immédiatement dans le site store.
2. Si Cloud répond, les outcomes Cloud sont réconciliés dans le store.
3. `syncPull` essaie Cloud en premier. Les lignes reçues sont enregistrées dans le store.
4. Si Cloud est indisponible, l’Edge répond avec le delta disponible dans son store et marque `edgeServed:true`, `stale:true`.
5. La queue 0036 réessaie Cloud périodiquement.

## Fichiers

- `edge/eduhaiti-edge.mjs` : store + fallback `syncPull`.
- `.eduhaiti-edge/site-store.json` : fichier créé automatiquement à l’exécution.
- `test/edge-persistent-queue-test.mjs` : test queue + lecture locale.

## Endpoints

- `GET /edge/health`
- `GET /edge/discovery`
- `GET /edge/queue`
- `GET /edge/sync-status?deviceId=...`
- `GET /edge/data-status`
- `GET /api/?action=syncPull&table=...`
- `POST /api/?action=syncPush`

## Limite

0037 ne transforme pas encore toutes les actions métier historiques en lectures locales. Cela sera fait progressivement, domaine par domaine, pour éviter de servir des données locales incorrectes ou de rejouer des actions non idempotentes.
