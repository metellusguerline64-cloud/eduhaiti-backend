# MonCash — déploiement EduHaïti

## 1. Prérequis

Le Worker utilise :

- Cloudflare Workers
- D1 par tenant
- le système d'actions/API Hub existant
- R2 seulement pour les autres modules, pas pour les credentials MonCash

Les credentials MonCash sont chiffrés dans D1 avec AES-GCM. La clé de chiffrement est un Cloudflare Worker Secret partagé par le déploiement.

## 2. Migration D1

Depuis `worker/` :

```bash
npm run db:migrate:moncash:local
npm run db:migrate:moncash:remote
```

La migration est `migrations/0018_moncash.sql`.

Chaque base D1 d'école doit recevoir cette migration.

## 3. Secret Cloudflare

Créer une clé forte et la stocker comme Secret Worker :

```bash
npx wrangler secret put MONCASH_CREDENTIALS_KEY
```

Ne pas mettre cette valeur dans `wrangler.toml`, `[vars]`, le frontend ou Git.

## 4. Configuration d'une école

La configuration est enregistrée via `saveMonCashConfig`.

Exemple conceptuel, sans secret réel :

```json
{
  "enabled": true,
  "environment": "SANDBOX",
  "businessKey": "MERCHANT_BUSINESS_KEY",
  "clientId": "MONCASH_CLIENT_ID",
  "clientSecret": "MONCASH_CLIENT_SECRET",
  "apiKey": "MONCASH_SECRET_API_KEY"
}
```

Le `clientSecret` et l'`apiKey` sont chiffrés avant stockage.

Le `getMonCashConfig` ne renvoie jamais leur valeur.

## 5. Sandbox / Production

Le choix `SANDBOX` ou `PRODUCTION` est enregistré côté serveur.

Les endpoints utilisés par le Worker sont :

Sandbox :

- API : `https://sandbox.moncashbutton.digicelgroup.com/Api`
- Gateway : `https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware`

Production :

- API : `https://moncashbutton.digicelgroup.com/Api`
- Gateway : `https://moncashbutton.digicelgroup.com/Moncash-middleware`

Ces valeurs proviennent de la documentation REST MonCash disponible au moment de l'intégration. Avant production, confirmer avec Digicel/MonCash que le contrat API et les credentials du marchand correspondent toujours à cette documentation.

## 6. Return URL

L'école ne saisit jamais une Return URL dans EduHaïti.

La route Worker est :

`/api/moncash/return`

Le tenant est déterminé par le Host de la requête. Pour un tenant `mt1967`, l'URL technique peut être :

`https://mt1967.eduflow.win/api/moncash/return`

Cette URL est une convention d'infrastructure EduHaïti. Elle doit être enregistrée dans le compte marchand MonCash pendant l'onboarding technique du marchand, pas par l'administrateur de l'école.

## 7. Flux de paiement

1. Le Worker détermine le tenant depuis le Host.
2. Il vérifie la session.
3. Il vérifie l'accès à l'élève.
4. Il calcule le solde dû à partir du montant de scolarité configuré et des paiements Finance déjà enregistrés.
5. Il refuse un montant supérieur au solde serveur.
6. Il crée une ligne locale `PENDING`.
7. Il génère un `orderId` unique.
8. Il appelle `CreatePayment` MonCash côté serveur.
9. Il retourne seulement `paymentId`, `orderId`, `status` et `redirectUrl`.
10. MonCash traite le paiement.
11. Le Worker reçoit le retour.
12. Le Worker vérifie le paiement auprès de MonCash.
13. Seulement après vérification, le paiement passe à `PAID` et est enregistré dans `payments`.
14. Une notification interne est créée pour les administrateurs concernés de la même école.

## 8. Idempotence

La table `moncash_payments` possède une contrainte unique par tenant sur `order_id` et `moncash_transaction_id`.

Le paiement Finance utilise une clé d'idempotence :

`MONCASH:<paymentId>`

Une seconde vérification ne crée donc pas une seconde ligne Finance et ne renvoie pas une seconde notification.

## 9. Audit

Les événements suivants sont écrits dans `audit_log` :

- création
- création échouée
- vérification
- paiement confirmé
- anomalie de montant
- changement de statut

Les credentials ne sont jamais écrits dans l'audit.

## 10. Tests

```bash
npm run test:moncash
npm run test:payments
npm run test:permissions
npm run test:access-scope
npm run test:online-payments
```

Le test MonCash utilise un faux endpoint HTTP et ne contacte pas MonCash réel.

## 11. Passage Production

Avant le passage Production :

1. créer/valider le marchand MonCash de l'école ;
2. confirmer Business Key, Client ID, Client Secret et Secret API Key ;
3. confirmer la Return URL technique auprès de MonCash ;
4. tester un paiement Sandbox complet ;
5. vérifier le montant reçu et la référence ;
6. vérifier la notification admin ;
7. vérifier le non-double-crédit ;
8. enregistrer les credentials Production avec `saveMonCashConfig` ;
9. changer `environment` en `PRODUCTION` côté serveur ;
10. effectuer un petit paiement réel contrôlé.
