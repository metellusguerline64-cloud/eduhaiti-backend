# Lot 0075 — Finance Final Parity

## Objectif
Fermer les écarts Finance identifiés entre `Code.gs` et le Worker avant de passer au domaine suivant.

## Corrections
- Détection de paiement de scolarité compatible avec `designation`, `paymentType` et `description`.
- Résolution des frais selon `FIN_PAYMENT_PLANS`, classe/cycle/global, `TUITION_MODE`, `TUITION_BY_CLASS`, `TUITION_BY_CYCLE` et fallback global.
- Respect de la sémantique de `Code.gs` pour `monthly.amount` (pas de multiplication automatique par `monthly.count`).
- Calcul du dû courant à partir des échéances déjà dues et du solde annuel.
- Exclusion des paiements `VOID/CANCELLED/ANNULE/REFUNDED` des totaux.
- Application des restrictions `classPaymentTypes` par classe.
- Paiements partiels selon `PAY_ALLOW_PARTIAL`.
- Surpaiement selon `PAY_OVERPAYMENT_ACTION` avec conservation de la sémantique `CHANGE/REFUND/CREDIT` de `Code.gs` (ajustement de l'écriture + traçabilité dans les notes, sans inventer un mouvement financier séparé absent de la source).
- Pénalités `FIN_PENALTY_AMOUNT`, `FIN_PENALTY_TYPE`, `FIN_PENALTY_RECURRENCE`, `FIN_GRACE_PERIOD` alignées sur la règle présente dans `Code.gs`.
- Libellés intelligents mensuel/trimestre/semestre.
- Nom du caissier résolu depuis `users` dans l'historique Finance.
- Profil Finance : totaux, dette et transactions cohérents avec les statuts actifs.
- Paiement en ligne : soumission, preuve R2, file d'attente, approbation/rejet et contrôle d'autorisation.
- Idempotence et contrôle de concurrence conservés.

## Vérifications
- `node --check src/actions/payments.js` : PASS
- Finance final parity static test : PASS
- Finance regression test : PASS
- Code.gs registry parity : PASS (242/242 actions enregistrées; 268 runtime actions)
- Student lifecycle : PASS
- Parent portal registry : PASS

## Limite de portée
Le registre 242/242 vérifie la présence des actions, pas leur équivalence ligne par ligne. Le présent lot porte sur le domaine Finance et ses flux dépendants directement identifiés dans `Code.gs`.
