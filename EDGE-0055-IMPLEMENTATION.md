# EDGE-0055 — Tests de chaos et reprise après panne

## Objectif
Vérifier par exécution réelle du processus Edge que les données locales et la file d'attente survivent à un arrêt brutal puis à un redémarrage, et qu'un replay avec la même `idempotencyKey` ne crée pas de doublon.

## Scénario automatisé
1. Démarrage d'un Edge isolé, sans Cloud.
2. `syncPush` d'une première opération : elle est persistée en `pending`.
3. Vérification du `site-store.json`.
4. Arrêt brutal du processus (`SIGKILL`) : simulation d'une panne sans shutdown propre.
5. Redémarrage avec le même répertoire de données.
6. Vérification que queue + store sont restaurés.
7. Rejeu de la même `idempotencyKey` : aucune deuxième entrée de queue.
8. Ajout d'une deuxième opération.
9. Nouveau `SIGKILL` + redémarrage.
10. Vérification que les deux opérations restent `pending` et que `/edge/health` les comptabilise.

## Commande
`npm run test:edge-chaos`

## Résultat attendu
`EDGE-0055 chaos/recovery test: PASS`

## Limites
Ce test simule les pannes du processus Edge et la persistance disque. Il ne remplace pas un test physique de coupure électrique, de panne du disque, de navigateur mobile ou de réseau Wi-Fi réel.
