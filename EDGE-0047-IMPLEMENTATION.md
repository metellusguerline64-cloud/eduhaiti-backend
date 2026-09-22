# EDGE-0047 — Centre des conflits

## Objectif
Ajouter un centre de conflits local à l’Edge pour rendre visibles les conflits de synchronisation multi-terminal et permettre une résolution explicite sans transformer l’Edge en autorité globale.

## Backend Edge
- `conflicts.json` persistant dans `EDU_EDGE_DATA_DIR`.
- Les réponses Cloud `status=conflict` sont enregistrées avec terminal, utilisateur, table, ligne, version Cloud, données locales et ligne serveur.
- `GET /edge/conflicts` liste les conflits et leur état.
- `POST /edge/conflicts/resolve` accepte `cloud`, `local` ou `manual`.
- `cloud` retire la modification locale conflictuelle lorsqu’elle revient avec le même idempotency key.
- `local` et `manual` créent une nouvelle opération avec la version Cloud connue comme `baseVersion` et l’envoient à Cloud lorsque Cloud est disponible.
- Cloud reste l’autorité finale.

## Client
Le dashboard Edge affiche le nombre de conflits ouverts et ouvre le Centre des conflits. Chaque conflit montre les données Cloud et locales et propose :
- Conserver Cloud
- Conserver local
- Résoudre manuellement (JSON de champs)

## Sécurité
Toutes les routes de conflit exigent une identité Edge valide et des permissions d’administration. Aucune résolution ne contourne Cloud.

## Tests
- `node test/run-edge-conflict-center-test.mjs` — PASS
- `node test/run-edge-supervision-test.mjs` — PASS
- `node test/run-edge-device-registry-test.mjs` — PASS
- `node test/run-edge-bidirectional-sync-test.mjs` — PASS

Les tests d’intégration qui lancent un sous-processus Node peuvent dépendre du chemin `process.execPath` disponible dans l’environnement d’exécution.
