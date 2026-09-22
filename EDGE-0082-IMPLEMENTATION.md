# EDGE-0082 — Rapports / Analytics — Final parity batch

## Objectif
Fermer les écarts fonctionnels concrets identifiés dans le domaine Rapports / Analytics en comparant les implémentations Worker avec les fonctions correspondantes de `Code.gs`.

## Corrections
- `getDashboardLiveStats` : restauration du calcul financier réel du dashboard avec paiements encaissés hors statuts `VOID/CANCELLED/ANNULE/REFUNDED`, résolution des frais attendus par élève actif, calcul des soldes impayés et diagnostic de configuration Finance.
- `getDashboardLiveStats` : comptage des classes avec repli sur les niveaux réellement utilisés lorsque `ACTIVE_LEVELS` n'est pas disponible.
- `getImmersiveData` : utilisation du moteur officiel `getPromotionDecision` afin de respecter les règles configurées du curriculum, diviseurs de bulletin, périodes manquantes, matières critiques, mentions et cycle maternelle.
- `getImmersiveData` : conservation d'un fallback analytique pour les anciennes fiches qui n'ont pas encore de `student_history` active mais disposent de notes, afin de ne pas casser les rapports historiques.
- `resolveExpectedTuition` a été exposée comme helper partagé par `payments.js`, sans duplication de la logique Finance.
- Aucun secret, email administrateur ou identifiant de dossier n'est hardcodé.

## Validation
- `run-reports-test.mjs`: PASS
- `run-payments-test.mjs`: PASS
- `run-finance-final-parity-test.mjs`: PASS
- `run-promotion-test.mjs`: PASS
- `run-permissions-test.mjs`: PASS
- `run-codegs-parity-audit-test.mjs`: PASS (242/242 actions enregistrées; 268 actions runtime)
- `node --check src/actions/reports.js`: PASS
- `node --check src/actions/payments.js`: PASS
- `node --check src/actions/promotion.js`: PASS

## Note de portée
Le registre 242/242 confirme que les actions inventoriées sont enregistrées, mais ne constitue pas à lui seul une preuve de parité ligne par ligne. Ce lot couvre les écarts fonctionnels identifiés et testés dans le périmètre Rapports / Analytics.
