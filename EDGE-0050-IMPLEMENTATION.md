# EDGE-0050 — Health & Self-Healing

Ajout d'une supervision de santé locale et d'un mécanisme de self-healing limité aux opérations sûres et idempotentes.

## Edge
- `GET /edge/health` retourne un diagnostic détaillé.
- `GET /edge/health/details` fournit le diagnostic aux administrateurs authentifiés.
- `POST /edge/self-heal` lance une vérification/réparation administrateur.
- Watchdog périodique configurable (`EDU_EDGE_HEALTH_WATCHDOG_MS`, défaut 30 s).
- Vérification du stockage avec `fs.statfs`.
- Alertes `ok`, `warning`, `critical` selon `EDU_EDGE_HEALTH_DISK_WARN_PCT` et `EDU_EDGE_HEALTH_DISK_CRITICAL_PCT`.
- Détection des files métier/médias en attente ou échouées et des conflits ouverts.
- Nettoyage des éléments déjà appliqués selon les TTL existants.
- Relance automatique des files uniquement via les fonctions idempotentes de synchronisation existantes quand Cloud est configuré.
- Aucun nettoyage agressif de données lorsque le stockage est critique.
- Journalisation des opérations `self_heal`.

## Frontend
Le panneau Edge affiche l'état de santé, le pourcentage de stockage utilisé, l'état Cloud et les problèmes détectés, avec un bouton **Réparer / vérifier maintenant** et confirmation.

## Sécurité
Les endpoints de diagnostic détaillé et de réparation exigent une identité Edge valide et des droits administrateur. Le self-healing ne supprime pas les données saines et ne rejoue pas les actions legacy non idempotentes.
