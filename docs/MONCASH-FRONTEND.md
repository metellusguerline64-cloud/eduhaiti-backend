# MonCash — intégration frontend EduHaïti

## Bouton

Dans le portail élève/parent, ajouter le bouton :

`💳 Payer avec MonCash`

Le bouton doit être placé dans le même écran que le résumé des frais ou le bouton de paiement existant.

## Appel

Le frontend utilise le mécanisme API déjà présent dans EduHaïti. Il appelle :

```js
const result = await api("createMonCashPayment", {
  studentId,
  paymentType: "TUITION",
  amount,
  description: "Frais scolaires"
});

if (result.success && result.redirectUrl) {
  window.location.href = result.redirectUrl;
}
```

Le frontend ne fournit jamais `tenantId`, `clientId`, `clientSecret`, `apiKey`, `businessKey` ou une URL MonCash.

## États

Après la création, afficher : `PENDING`.

Le Worker est la source de vérité. Le frontend peut rafraîchir avec :

```js
const status = await api("getMonCashPaymentStatus", { paymentId });
```

Afficher selon `status` :

- `PENDING` : Paiement en attente
- `PAID` : Paiement confirmé
- `FAILED` : Paiement échoué
- `CANCELLED` : Paiement annulé
- `EXPIRED` : Paiement expiré
- `REJECTED` : Paiement rejeté

## Retour MonCash

La redirection est gérée par le Worker sur :

`/api/moncash/return`

Le frontend ne traite pas directement `transactionId` et ne marque jamais un paiement `PAID`.

## Administration

Utiliser :

- `getMonCashConfig`
- `saveMonCashConfig`
- `testMonCashConnection`

`getMonCashConfig` retourne uniquement des indicateurs de configuration. Les secrets ne sont pas retournés.

L'interface admin ne doit jamais afficher ou modifier :

- Return URL
- Callback URL
- Alert URL
- endpoint API MonCash

Le bouton `Test de connexion` appelle `testMonCashConnection` côté Worker.

## Sécurité frontend

Ne jamais faire :

```js
payment.status = "PAID";
```

Ne jamais accepter un `tenantId` venant du navigateur pour choisir l'école bénéficiaire.

Ne jamais stocker les credentials MonCash dans localStorage, sessionStorage, cookies frontend ou variables JavaScript publiques.
