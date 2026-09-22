# EduHaïti Edge 0041 — API métier locale + synchronisation bidirectionnelle

## Objectif

Renforcer le cycle de synchronisation sans créer une nouvelle autorité :

**Terminal IndexedDB → Edge local → Cloud D1 → Edge → Terminal**

Cloud reste l'autorité globale. IndexedDB reste la source opérationnelle du terminal pour son propre travail hors connexion. Edge conserve un cache du site et une file durable de modifications typées.

## Changements

- `syncPush` Edge conserve le résultat Cloud des lots appliqués pendant une période configurable (`EDU_EDGE_COMPLETED_QUEUE_TTL_MS`, 7 jours par défaut).
- Un même `idempotencyKey` déjà appliqué est rejoué depuis le résultat mémorisé au lieu de recréer/rejouer le lot.
- Le terminal peut donc quitter le site après avoir remis une modification à l'Edge, puis revenir plus tard et obtenir le résultat final sans perdre son entrée d'outbox.
- Les écritures hors Internet restent dans la file persistante Edge et sont appliquées au site-store immédiatement pour les lectures locales.
- Le prochain `syncPull` récupère les changements Cloud lorsque Cloud est disponible, sinon Edge sert son dernier état local.
- `/edge/sync-status` permet d'observer l'état des lots par terminal.
- Le nettoyage des résultats `applied` est différé jusqu'à expiration du TTL, afin de préserver l'idempotence inter-déconnexions.

## Ordre de vérité

1. Cloud D1/R2 : autorité globale.
2. Edge : cache/relais local durable du site.
3. IndexedDB : travail offline du terminal et outbox du terminal.

L'Edge ne valide pas une modification comme globalement définitive avant que Cloud l'accepte.
