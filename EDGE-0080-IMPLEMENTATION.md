# EDGE-0080 — Audit sécurité / permissions — Final parity batch

## Objectif
Fermer l'écart concret entre l'AuditLog de Code.gs et l'audit D1 : les refus de permission doivent être conservés comme événements `ECHEC`, avec l'action et la permission concernée.

## Corrections
- `apiHub` journalise maintenant les refus de permission (`permission_denied`) dans `audit_log`.
- Aucun token, mot de passe ou secret n'est écrit dans l'audit.
- `audit_log` supporte désormais `permission` et `status`.
- Le tableau d'audit expose réellement Permission/Status au lieu de laisser Permission toujours vide et Status toujours `REUSSITE`.
- Les filtres `permission`, `status` et recherche globale prennent ces champs en compte.
- Les diagnostics exposent les nouvelles colonnes.
- Migration D1 `0029_audit_security_fields.sql` ajoutée pour les bases existantes.
- Le schéma neuf contient directement ces colonnes et l'index correspondant.
- Les écritures existantes restent compatibles : leur statut par défaut est `REUSSITE`.
- Aucun secret, email administrateur ou identifiant de dossier n'est hardcodé.

## Validation
- `run-audit-test.mjs`: PASS
- `run-codegs-parity-audit-test.mjs`: PASS (242/242 actions enregistrées)
- `node --check src/lib/audit.js`: PASS
- `node --check src/lib/apiHub.js`: PASS
- `node --check src/actions/audit.js`: PASS

## Limite explicitement vérifiée
Le registre `242/242` confirme la présence des actions, pas une parité ligne-à-ligne. Dans ce lot, les écarts fonctionnels identifiés sur la chaîne AuditLog/permission/status ont été corrigés et testés.
