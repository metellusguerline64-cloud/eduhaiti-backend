# EDGE-0060 — Gestion complète des élèves hors ligne

## Objectif
Le module Élèves dispose désormais d'une façade Offline-first durable pour créer, modifier, rechercher et supprimer un élève sans connexion.

## Fonctionnalités
- `window.EDU_OFFLINE_STUDENTS.save()` pour création/modification locale.
- `get()`, `list()` et `search()` depuis IndexedDB.
- `remove()` avec tombstone via `dropStudent`.
- validation de l'adresse à 21 caractères maximum.
- photo élève stockée dans `mediaBlobs` et placée dans `mediaOutbox`.
- URL locale `offline://student-photo/...` résoluble après redémarrage.
- événements `eduhaiti:student-local-change` et `eduhaiti:student-photo-local`.
- les écritures continuent d'utiliser l'outbox typé et les clés d'idempotence existantes.

## Flux
Terminal IndexedDB → Edge → Cloud/D1/R2.

Cloud reste l'autorité finale. Aucune donnée d'identification ou credential n'est stockée dans ce module.

## Validation
`npm run test:student-offline` doit afficher :
`PWA-0060 student offline domain test: PASS`
