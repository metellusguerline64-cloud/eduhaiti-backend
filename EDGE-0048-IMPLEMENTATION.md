# EDGE-0048 — Sauvegarde opérationnelle & récupération Edge

## Objectif
Protéger l’état local utile à la continuité de service Edge sans transformer une sauvegarde en credential d’authentification.

## Backend Edge
- `GET /edge/backup/export` exporte un snapshot JSON de l’état opérationnel.
- `POST /edge/backup/restore` restaure ce snapshot après validation du site et confirmation explicite.
- L’export inclut : site-store, queue de synchronisation, état média/index, conflits et registre des terminaux.
- Les empreintes de tokens des terminaux sont retirées de l’export.
- Le cache d’identité offline n’est jamais exporté.
- La restauration exige une identité Edge administrateur valide.
- Une sauvegarde provenant d’un autre `siteId` est refusée.
- Sans `confirm:true`, l’import renvoie un aperçu et ne modifie rien.

## Médias binaires
Le snapshot JSON n’inclut volontairement pas les fichiers binaires de `EDU_EDGE_DATA_DIR/media/`. Ils doivent être sauvegardés au niveau du système de fichiers ou feront l’objet d’un mécanisme d’archive média dédié.

## Client
Le panneau Edge-first ajoute :
- `Exporter sauvegarde`
- `Restaurer`
- confirmation avant remplacement de l’état local.

## Sécurité
Une sauvegarde n’est pas un moyen de reconnecter automatiquement un utilisateur : les credentials/empreintes d’authentification ne sont pas exportés.

## Test
- `node test/run-edge-backup-recovery-test.mjs` — PASS
