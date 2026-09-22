# EDGE-0046 — Supervision Edge & contrôle de synchronisation

## Ajouts
- GET `/edge/overview`: état synthétique du site, terminaux, file sync, file médias et store local.
- POST `/edge/sync/flush`: déclenchement manuel du flush des files métier et médias.
- Protection par identité Edge et permissions administratives.
- Dashboard `edge-first.js`: cartes de supervision, bouton Synchroniser, rafraîchissement automatique toutes les 30 secondes.

## Sécurité
- Aucune nouvelle autorité globale n'est créée.
- L'Edge utilise l'identité/permissions déjà provisionnées.
- Le flush manuel est réservé aux comptes master/god mode ou permissions de gestion prévues.
