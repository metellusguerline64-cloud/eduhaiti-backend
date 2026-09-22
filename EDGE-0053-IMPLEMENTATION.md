# EDGE-0053 — Offline Production Readiness: session, device gate & E2E checks

## Objectif
Fermer les derniers écarts de cohérence avant les essais terrain du mode hors connexion.

## Correctifs
- `getViewerInfo` est maintenant réellement servi par `/edge/local-api` (il était déclaré dans les actions offline mais rejeté par la liste supportée).
- `/edge/local-api` applique le contrôle du terminal enregistré selon `EDU_EDGE_REQUIRE_REGISTERED_DEVICE`.
- Le `deviceId` est retourné avec la réponse offline pour faciliter le diagnostic du terminal actif.
- La session offline conserve son expiration explicite et n'est jamais prolongée par une simple lecture locale.
- Ajout d'un test statique de préparation production couvrant IndexedDB, Edge fallback, persistance de stockage et Background Sync.

## Limitation assumée
Les tests automatisés ne remplacent pas un test physique de coupure Internet, de redémarrage électrique, de quota navigateur ou de Wi-Fi/LAN. Ces essais doivent être réalisés sur appareils réels avant déploiement.
