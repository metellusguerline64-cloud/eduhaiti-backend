# EDGE-0076 — Grades / Évaluation parity finalisation

## Vérification effectuée
La section Notes/Évaluation a été auditée contre `Code.gs`, avec priorité aux écarts explicitement signalés dans `grades.js`.

## Corrections
- `saveMaternalMentions` était déjà présent dans le Worker : le commentaire de gap a été corrigé pour ne plus le considérer comme absent.
- Le plafond de note de `saveManualExamGrade` ne repose plus uniquement sur `MAX_SCORE` global.
- Ajout d'une résolution du plafond à partir du curriculum actif de l'élève et de la matière, en recherchant le coefficient/max et la somme des branches lorsque celles-ci existent.
- Fallback conservé vers `MAX_SCORE` de l'école, puis 100 lorsque le curriculum ne contient pas la matière/niveau exploitable, conformément au comportement observé dans `getSubjectMaxScore_`.
- La validation des périodes `T1..T6` reste appliquée selon `NUM_PERIODS` / `TOTAL_TERMS`.
- Les mentions maternelle restent séparées des notes numériques afin de ne pas polluer les calculs de moyenne.

## Tests
- `node --check src/actions/grades.js` : PASS
- Vérification statique des exports/registry : à exécuter avec la suite complète du projet avant livraison.
