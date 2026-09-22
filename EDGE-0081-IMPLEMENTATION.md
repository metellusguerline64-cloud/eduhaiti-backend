# EDGE-0081 — Utilisateurs / Administration — hardening parity

## Périmètre audité
Comparaison du domaine `STAFF / USERS` de `Code.gs` avec `src/actions/users.js` : listing, gestion des accès, création/mise à jour, reset mot de passe, activation/désactivation, suppression d'accès et GodMode.

## Corrections du lot
1. Les actions utilisateurs vérifient désormais directement la permission déclarée dans `ACTION_PERMISSIONS`, en plus de la protection du routeur.
2. Une modification d'un compte GodMode conserve le marqueur GodMode et le rôle `ADMIN`, au lieu de désynchroniser `permissions_json` et `is_god_mode`.
3. La sauvegarde utilisateur conserve les champs existants lorsque le payload ne fournit pas certains champs, notamment photo/contact.
4. Une photo utilisateur dépassant 48 000 caractères n'est pas enregistrée et produit un avertissement, conformément au comportement legacy.
5. Le champ `is_god_mode` est synchronisé avec les permissions lors de la création/mise à jour.
6. Les opérations sensibles restent auditées et les sessions sont révoquées lors d'un reset, d'une désactivation ou d'un changement GodMode.
7. Aucun email administrateur, secret ou identifiant de dossier n'est hardcodé.

## Validation
- `run-users-test.mjs`: PASS
- `run-users-parity-hardening-test.mjs`: PASS
- `run-school-ids-admin-test.mjs`: PASS
- `run-codegs-parity-audit-test.mjs`: PASS (242/242 actions enregistrées ; ce registre ne constitue pas à lui seul une preuve de parité comportementale)
- `node --check src/actions/users.js`: PASS
