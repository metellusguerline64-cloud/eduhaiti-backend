# EduHaïti — 0042 Edge Media Offline

## Objectif
Étendre le modèle **Terminal IndexedDB → Edge local → Cloud D1/R2** aux médias.

## Fonctionnement
- Le terminal continue de conserver le fichier dans `IndexedDB.mediaBlobs` et son entrée dans `mediaOutbox`.
- Lorsque l’Edge du site est accessible, `offline-domain-integration.js` transfère une copie au nouvel endpoint `POST /edge/media/upload`.
- L’Edge écrit le fichier dans son stockage local `EDU_EDGE_DATA_DIR/media/`, conserve les métadonnées dans `media-index.json` et la file durable dans `media-queue.json`.
- Si Cloud est indisponible, le média reste sur l’Edge et peut être servi localement aux utilisateurs autorisés.
- Lorsque Cloud revient, l’Edge appelle `uploadMediaFile` puis `saveMedia` avec la session autorisée et conserve le résultat Cloud dans la file jusqu’à réconciliation.
- `GET /edge/media-status` permet de suivre les médias en attente/échoués et leurs identifiants Cloud lorsqu’ils existent.
- `GET /edge/media` fournit l’index média local aux utilisateurs autorisés.
- `GET /edge/media/file?key=...` sert un fichier local avec contrôle de session/permission.

## Sécurité
- Le cache d’identité 0040 reste la porte d’entrée offline.
- Les fichiers ne sont pas exposés anonymement par l’API média Edge.
- Le token brut n’est pas stocké dans le cache d’identité ; la file média conserve toutefois la session nécessaire au relais Cloud, comme la file `syncPush` existante. L’Edge doit rester sur le LAN/site de confiance et ne doit pas être exposé directement à Internet.
- Cloud reste l’autorité globale ; l’Edge n’est qu’un relais/cache local durable.

## Limites assumées
- La taille maximale d’une requête Edge suit `EDU_EDGE_MAX_BODY` via `MAX_BODY` (16 MiB par défaut dans cette version).
- Le stockage Edge dépend du disque local et n’est pas limité à une durée artificielle ; la rétention des éléments terminés de la file est contrôlée par `EDU_EDGE_MEDIA_COMPLETED_TTL_MS` (30 jours par défaut).
- La synchronisation Background Sync existante vers Cloud reste disponible comme filet de sécurité lorsque l’Edge n’est pas découvert.

## Tests
- `node test/run-edge-media-offline-test.mjs`
- `node test/run-edge-identity-test.mjs`
- `node test/run-edge-bidirectional-sync-test.mjs`
- `node test/pwa-offline-domain-test.mjs`
- `node test/pwa-offline-media-test.mjs`
- `node frontend-dist/pwa-offline-smoke-test.mjs`
