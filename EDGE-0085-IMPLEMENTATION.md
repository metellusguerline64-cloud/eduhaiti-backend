# EDGE-0085 — Communications / Notifications / Delivery

## Objectif
Finaliser les écarts concrets du domaine Communication identifiés entre `Code.gs` et le Worker Cloudflare, sans réintroduire de secrets ou identifiants hardcodés.

## Corrections
- `sendStudentReportEmail` utilise désormais `EMAIL_WEBHOOK_URL` pour une vraie livraison email côté Worker au lieu de remplacer silencieusement l'email par une notification push.
- Le contenu envoyé conserve le bilan académique : nom, moyenne annuelle et décision.
- Validation stricte de l'adresse email destinataire.
- `sendSMSBulk` utilise `SMS_WEBHOOK_URL` et conserve le contrat de retour `success/sent` ; les destinataires sont normalisés et dédupliqués.
- `testSMSConnection` teste le webhook SMS configuré.
- `sendWhatsApp` utilise `WHATSAPP_WEBHOOK_URL`, avec `WHATSAPP_PROVIDER` et `WHATSAPP_INSTANCE_ID` fournis par l'environnement ; aucune clé API n'est acceptée ou exposée côté client.
- Les opérations SMS/WhatsApp/email sont auditées.
- Permissions `pa_send_broadcast`/`p_settings` sont vérifiées pour les opérations de diffusion.
- Les notifications et la messagerie parentale existantes sont conservées.

## Sécurité
Aucun email administrateur, secret API, Folder ID ou credential fournisseur n'est hardcodé. Les intégrations externes sont configurées par variables d'environnement/Worker secrets et webhooks.

## Validation
- `run-communication-test.mjs` — PASS
- `run-settings-test.mjs` — PASS
- `run-settings-historical-test.mjs` — PASS
- `run-legacy-communication-settings-test.mjs` — PASS
- `run-reports-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (242/242 actions enregistrées; 268 actions runtime)
- `node --check src/actions/communications.js` — PASS
- `node --check src/actions/alerts.js` — PASS

## Limite volontaire
Le Worker ne contient pas de credentials fournisseurs. Les webhooks configurés par l'installation doivent effectuer la livraison réelle auprès du fournisseur SMS/WhatsApp/email. Le Worker ne prétend donc pas avoir envoyé un message si aucun canal n'est configuré.
