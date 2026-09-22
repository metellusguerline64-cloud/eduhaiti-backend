# EDGE-0051 — Audit & Event Timeline

## Objectif
Ajouter un historique local lisible des opérations importantes de l'Edge sans exposer de credentials.

## Backend
- `GET /edge/audit?limit=150&kind=` protégé par l'identité Edge et les droits administrateur.
- Lecture du journal `events.jsonl` depuis la fin, maximum 500 événements par requête.
- Filtre optionnel par `kind`.
- Redaction systématique de `authorization`, `token`, `accessToken`, `refreshToken` et `tokenFingerprint`.
- Journalisation de `device_registered` et `device_unrevoked` en complément des événements existants.

## Frontend
- Bouton `Historique` dans le panneau Edge.
- Timeline modale des événements récents avec libellés français.
- Affichage des informations non sensibles : date, terminal, utilisateur, résolution, erreur ou raison.

## Sécurité
Le journal n'est pas public : session Edge valide + droits administrateur requis. Aucun secret d'authentification n'est renvoyé par l'API d'audit.
