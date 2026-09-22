# EDGE-0086 — Communication : canal Push uniquement

## Décision produit
Le module **Communication** de l'application utilise exclusivement le canal **PWA Push Notification**.

Les canaux SMS, WhatsApp et email ne font pas partie du module Communication.

## Changements
- Suppression de `sendSMSBulk`, `testSMSConnection` et `sendWhatsApp` du runtime et du registre des actions.
- Suppression des dépendances de configuration WhatsApp/SMS du module Settings.
- `publishAnnouncement`, messages parent↔administration et messages internes utilisent `channel: PUSH`.
- `sendStudentReportEmail` est conservée uniquement comme nom d'action de compatibilité frontend, mais son comportement est désormais **Push** vers le compte parent associé à l'élève. Aucun email n'est envoyé et l'adresse fournie est ignorée.
- La livraison des identifiants du compte parent créé dans `addNewStudent` passe par une notification Push ciblée au compte parent.
- Aucun fournisseur externe de messagerie n'est requis pour le module Communication.
- Les emails de vérification utilisés par le parcours d'authentification restent hors du module Communication et ne constituent pas un canal de notification utilisateur.

## Validation
- communication test : PASS
- legacy communication/settings test : PASS
- parent portal test : PASS
- permissions test : PASS
- reports test : PASS
- settings test : PASS
- parity registry : PASS (239/239 actions dans le périmètre retenu)
- syntax checks : PASS

## Note de parité
Les trois actions SMS/WhatsApp retirées sont volontairement exclues du registre de parité parce qu'elles ne font plus partie du périmètre fonctionnel retenu. Le registre n'est donc pas une affirmation de parité ligne par ligne avec Code.gs.
