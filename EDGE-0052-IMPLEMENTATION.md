# EDGE-0052 — Offline Production Hardening

## Objectif
Fermer les points de sécurité et de robustesse identifiés avant la validation terrain du mode hors connexion.

## Ajouts
- Support TLS natif optionnel dans le relais Edge via `EDU_EDGE_TLS_CERT_FILE` et `EDU_EDGE_TLS_KEY_FILE`.
- Mode strict `EDU_EDGE_REQUIRE_HTTPS=true` : les requêtes HTTP sont refusées.
- Allowlist CORS via `EDU_EDGE_ALLOWED_ORIGINS`.
- En-tête `X-Eduhaiti-Device-Id` accepté par le CORS Edge.
- Accès à `/edge/local-api` lié au registre des terminaux lorsque `EDU_EDGE_REQUIRE_REGISTERED_DEVICE=true` (valeur par défaut).
- Le manifeste Edge expose les paramètres de sécurité effectifs.
- Aucun secret n'est ajouté au frontend ou aux sauvegardes.

## Session offline
Le cache d'identité reste limité par `EDU_EDGE_OFFLINE_SESSION_TTL_MS` (24 h par défaut), aligné sur la durée de session locale existante. Une session expirée n'est pas réactivée automatiquement.

## Déploiement recommandé
Configurer un certificat TLS adapté au nom local utilisé par la PWA, puis :

```env
EDU_EDGE_REQUIRE_HTTPS=true
EDU_EDGE_TLS_CERT_FILE=./certs/edge.crt
EDU_EDGE_TLS_KEY_FILE=./certs/edge.key
EDU_EDGE_ALLOWED_ORIGINS=https://ecole.example
EDU_EDGE_REQUIRE_REGISTERED_DEVICE=true
```

Ne pas exposer le port Edge directement à Internet. Utiliser le LAN/VPN de l'établissement et une terminaison TLS maîtrisée.
