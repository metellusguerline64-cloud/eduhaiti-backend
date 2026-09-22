# EDGE-0058 — PWA Domain Business Sync UI

## Objectif
Relier visiblement les domaines métier PWA au moteur offline déjà existant, sans changer l'autorité Cloud-first.

## Ajouts
- `getDomainHealth()` dans `frontend-dist/offline-domain.js`.
- Comptage local et en attente par domaine.
- `EDU_SYNC_STATE` et événement `eduhaiti:sync-state`.
- États visibles : LOCAL, EDGE / CLOUD, CLOUD.
- Tableau d'état des données dans le panneau de synchronisation.
- Le wrapper `callApiHub_` publie le domaine/action lors des lectures et écritures.
- API `window.EDU_OFFLINE_STATUS()` pour permettre aux pages métier d'afficher leur état.
- Test statique `test/run-pwa-domain-ui-test.mjs`.

## Domaines suivis
Élèves, Notes, Paiements, Présences, Emploi du temps, Affectations, Enseignants, Classes, Inscriptions, Profil, Paramètres et Médias.

## Autorité
IndexedDB reste la source opérationnelle du terminal hors ligne; Edge reste cache/relais local; Cloud/D1/R2 reste l'autorité finale.

## Validation
- PWA offline smoke: PASS
- PWA domain UI integration: PASS
- Edge security 0057: PASS
- Cloud E2E 0056: PASS
- Chaos/recovery 0055: PASS
- Edge identity/provisioning/offline readiness/resilience: PASS
- `node --check` des deux modules frontend: PASS
