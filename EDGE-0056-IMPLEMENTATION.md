# EDGE-0056 — Synchronisation Cloud de bout en bout

Cette étape ajoute un test d'intégration local qui vérifie le parcours complet Terminal → Edge → Cloud → Edge → Terminal/local state.

## Vérifications

1. Un terminal enregistré pousse une opération via l'Edge vers un faux Cloud.
2. Le Cloud applique l'opération et renvoie son résultat autoritatif.
3. Le rejeu de la même `idempotencyKey` ne crée aucun doublon.
4. Une donnée créée côté Cloud est récupérée par `syncPull` via l'Edge.
5. L'Edge réconcilie son `site-store` avec les données Cloud.
6. Après redémarrage du processus Edge, l'état réconcilié reste disponible localement.

Le faux Cloud n'est qu'un environnement de test : aucune donnée réelle D1/R2 n'est modifiée.

## Test

```bash
npm run test:edge-cloud-e2e
```

Résultat attendu : `EDGE-0056 cloud reconnect end-to-end test: PASS`.
