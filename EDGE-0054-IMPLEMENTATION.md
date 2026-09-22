# EDGE-0054 — Résilience de reprise multi-terminal

## Objectif
Renforcer la reprise après coupure réseau, fermeture/reprise du navigateur et redémarrage brutal de l'Edge, sans créer de nouvelles opérations ni perdre l'outbox.

## Changements
- **Écritures JSON atomiques côté Edge** : les états persistants (queue, store, identité, appareils, conflits, médias) sont écrits dans un fichier temporaire puis renommés. Une interruption pendant l'écriture ne remplace donc pas directement le fichier actif par un JSON partiel.
- **Synchronisation terminal sérialisée** : `syncNow()` utilise un verrou de promesse afin d'éviter deux flush concurrents du même outbox.
- **Heartbeat de reprise terminal** : toutes les 20 secondes, si des opérations ou médias sont en attente, une synchronisation est tentée. Cela couvre notamment le retour du LAN vers l'Edge sans événement `online` fiable.
- **Reprise `pageshow` et `focus`** : au retour sur une page restaurée ou lorsque l'utilisateur revient dans la fenêtre, une synchronisation est relancée.
- **Idempotence conservée** : les mêmes `idempotencyKey` peuvent être renvoyées après une interruption ; l'Edge/Cloud réutilisent le résultat déjà appliqué plutôt que de créer une nouvelle opération.
- **Médias** : la file média reste durable et est relancée par le même mécanisme de reprise.

## Architecture maintenue
`IndexedDB terminal → Edge local → Cloud/D1/R2`

Cloud reste l'autorité globale. L'Edge reste un relais/cache local durable.

## Validation
- `node --check edge/eduhaiti-edge.mjs`
- `node --check frontend-dist/offline-domain-integration.js`
- Les tests Edge existants de 0053 doivent rester verts.
