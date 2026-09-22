# EDGE-0073 — Functional parity: transport attendance + parent auto-provisioning

## Portées dans ce lot

- `recordTransportAttendance` : la voie transport écrit désormais dans D1 `attendance` avec `method=TRANSPORT`, direction, trajet/véhicule et audit.
- `addNewStudent` : lorsque `ParentPhone`/`parentPhone` est fourni, le Worker crée ou réutilise le compte parent et crée le lien `parent_students` de façon idempotente.
- Un PIN initial de 6 chiffres est généré uniquement pour un nouveau compte parent et est retourné dans `parentAccount.pin`, conformément au contrat historique. Si `WHATSAPP_WEBHOOK_URL` est configuré, le Worker tente la livraison des identifiants sans imposer de fournisseur.

## Sécurité / architecture

- Isolation par `org_id`.
- PIN parent stocké sous forme de hash D1.
- Aucun email, Folder ID, secret ou identifiant fournisseur n'est codé en dur.
- Le webhook WhatsApp est optionnel et fourni par configuration Worker.

## Vérifications

- `node --check` : PASS pour les fichiers modifiés.
- `run-student-lifecycle-test.mjs` : PASS, incluant création/lien parent.
- `run-parent-portal-test.mjs` : PASS.
- `run-codegs-parity-audit-test.mjs` : PASS, 242/242 actions de l'inventaire enregistrées.

## Remarque

Ce lot ferme deux écarts fonctionnels identifiés dans les commentaires des ports précédents. Les mécanismes de pénalités/échéancier financier, les mentions maternelle et quelques fonctions métier secondaires restent à auditer séparément ; le registre d'actions, lui, reste à 242/242.
