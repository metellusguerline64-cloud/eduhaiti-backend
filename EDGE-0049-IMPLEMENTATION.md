# EDGE-0049 — Media Backup Archive & Recovery

## Objectif
Ajouter une sauvegarde/restauration binaire dédiée aux médias locaux Edge sans mélanger les fichiers binaires avec la sauvegarde JSON opérationnelle 0048.

## Fonctionnalités
- `GET /edge/media-backup/export` produit une archive `tar.gz` contenant `manifest.json` et les fichiers présents dans `media/`.
- `POST /edge/media-backup/inspect` vérifie une archive et renvoie un aperçu avant restauration.
- `POST /edge/media-backup/restore?confirm=true` restaure les médias après confirmation explicite.
- Vérification du `siteId` et du format de sauvegarde.
- Contrôle de taille configurable par `EDU_EDGE_MEDIA_BACKUP_MAX_BYTES` (512 MiB par défaut).
- Aucun token/credential n'est exporté.
- Les chemins de fichiers sont contrôlés contre les traversées de répertoire.
- Les médias manquants du dossier local sont signalés implicitement dans le manifeste mais ne bloquent pas l'export.
- La restauration met à jour `media-index.json` et conserve les statuts/metadata existants lorsque disponibles.

## Frontend
Le panneau Edge-first ajoute :
- `Sauvegarder médias`
- `Restaurer médias`

La restauration passe d'abord par `inspect`, puis demande une confirmation avant l'import.

## Format
Archive gzip/tar :
- `manifest.json`
- `media/<encoded-fileKey>.bin`

Le manifest contient `siteId`, `edgeId`, date, liste des médias, noms, MIME, tailles et statuts.

## Limite navigateur/runtime
L'archive est tenue en mémoire pendant l'export/import. Pour de très gros volumes, une future version pourra ajouter une sauvegarde par segments/archives tournantes.

## Tests
`node test/run-edge-media-backup-test.mjs` → PASS
`node --check edge/eduhaiti-edge.mjs` → PASS
`node --check frontend-dist/edge-first.js` → PASS
