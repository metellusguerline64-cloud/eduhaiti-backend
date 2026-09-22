# 0061 — Inventaire réel Code.gs → Cloudflare

Cette étape utilise le véritable `Code.gs.txt` fourni dans la conversation comme source du contrat Apps Script.

## Méthode

- analyse du bloc `apiHub(action, data, auth)` uniquement ;
- extraction des actions explicitement dispatchées par `apiHub` ;
- comparaison avec les actions exportées par `src/actions/index.js` ;
- classement par domaine métier pour préparer les prochaines migrations.

## Résultat

- 242 actions distinctes extraites du dispatcher Code.gs ;
- 190 présentes côté Worker ;
- 52 encore à porter.

Le statut **PORTÉ** signifie ici que l'action est exposée dans le registre Cloudflare. Il ne signifie pas que la parité fonctionnelle complète est déjà prouvée pour chaque action : certaines fonctions portées ont encore des commentaires indiquant des sous-fonctionnalités volontairement différées.

## Domaines restant à traiter

- Portail parent : 10
- Élèves : 10
- IA : 8
- École / Paramètres : 10
- Audit / Sécurité : 5
- Présences : 2
- Kiosque : 2
- Utilisateurs / Administration : 1
- Autres : 4

## Règle de migration

Ne pas remplacer les contrats JSON existants sans test. Pour chaque action suivante :

1. retrouver la fonction Code.gs correspondante ;
2. retrouver sa politique de permission ;
3. identifier Sheets/Drive/Properties/Cache utilisés ;
4. comparer au handler Cloudflare ;
5. écrire un contract test ;
6. seulement ensuite marquer l'action comme paritaire.

## 0062 — Parent portal D1 migration

Added `migrations/0028_parent_portal.sql` and `src/actions/parents.js`.
The parent portal actions now use D1 instead of the legacy `parents`, `parent_students`, and `parent_requests` Sheets, with parent-specific sessions stored in the existing `sessions` table. Core self-service registration, approval/rejection, activation, login, child listing, attendance, incidents, and announcements are included. Parent self-service actions are explicitly outside the staff permission matrix; admin request listing/approval remains self-gated by the same permission family used by Code.gs.
