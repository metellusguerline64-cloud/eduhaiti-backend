# EDGE-0059 — Intégration des états de synchronisation dans les pages métier

## Objectif
Afficher directement dans les pages métier PWA l'état de synchronisation du domaine concerné, sans modifier le contrat métier ni l'autorité des données.

## Pages couvertes
- Élèves → `students`
- Fiche élève → `student-workspace`
- Notes → `grades`
- Présences → `attendance`
- Finance/Paiements → `payments`
- Emploi du temps → `timetable`
- Affectations enseignants → `teacher_assignments`

## États affichés
- `LOCAL` — travail hors ligne
- `EDGE` — réseau local
- `CLOUD` — données à jour côté Cloud
- `SYNCHRONISATION` — état transitoire

Le composant ajoute aussi le nombre d'opérations locales/en attente et les conflits connus, lorsqu'ils sont disponibles.

## Action utilisateur
Chaque page couverte reçoit un bouton **Synchroniser** qui appelle `window.EDU_OFFLINE_SYNC_NOW()` lorsqu'il est disponible. L'action reste non bloquante si le réseau n'est pas disponible : les opérations restent dans le mécanisme offline existant.

## Architecture conservée
`IndexedDB terminal → Edge → Cloud/D1/R2`.
Cloud reste l'autorité finale.

## Fichier
`frontend-dist/domain-page-sync-ui.js`

Le script est chargé après `offline-domain-integration.js` dans `frontend-dist/index.html`.

## Validation
- `node --check frontend-dist/domain-page-sync-ui.js` — PASS
- `test/run-domain-page-sync-ui-test.mjs` — PASS

Note : `npm test` n'est pas défini dans le package existant ; la validation 0059 utilise donc son test ciblé et les tests Edge/PWA existants disponibles individuellement.
