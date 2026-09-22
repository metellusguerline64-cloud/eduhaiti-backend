# EduHaïti Edge 0036

## Ce qui est activé

- Auto-détection same-origin : si le PWA est servi par l'Edge, le terminal récupère automatiquement `siteId` et `edgeId`.
- Provisioning manuel conservé pour un PWA servi depuis Cloudflare Pages.
- File persistante locale Edge pour les lots `syncPush` idempotents lorsque Cloud est indisponible.
- Retry automatique Edge vers Cloud.
- Suivi de file avec `/edge/queue` et `/edge/sync-status`.
- Le terminal ne retire pas son outbox tant que Cloud n'a pas confirmé l'opération.
- Les appels API legacy non idempotents ne sont pas rejoués automatiquement par Edge.

## Limite volontaire

Un navigateur ne peut pas scanner arbitrairement le LAN/mDNS depuis une page web. Le zéro-configuration complet depuis un PWA hébergé dans le Cloud nécessitera un mécanisme de provisioning réseau (DNS local, QR ou agent/installeur). Si le PWA est servi directement par Edge, la découverte est déjà zéro-configuration.

## Sécurité

Le dossier `.eduhaiti-edge` contient la file locale et peut contenir les informations d'authentification nécessaires au rejeu des `syncPush`. Il doit être protégé par les permissions du système d'exploitation et ne doit pas être partagé publiquement. Une prochaine phase pourra remplacer le rejeu avec jeton utilisateur par une identité Edge dédiée à durée courte.
