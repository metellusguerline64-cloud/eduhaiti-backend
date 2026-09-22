# EDGE-0084 — Présences / Attendance — Finalisation fonctionnelle

## Périmètre
Audit ciblé de `Code.gs` contre `src/actions/attendance.js`, avec regroupement des écarts résiduels liés au pointage élève, au kiosque, au bulk attendance et à la compatibilité NISU.

## Corrections

1. **Date locale Haiti**
   - `Code.gs` utilise `Session.getScriptTimeZone()` pour déterminer la date de présence.
   - Le Worker utilisait auparavant `toISOString().slice(0,10)`, donc UTC.
   - `todayStr()` utilise maintenant l'heure locale `America/Port-au-Prince` via le même helper que le pointage staff.
   - Cela évite un changement de jour artificiel pendant la soirée locale.

2. **Recherche NISU**
   - Le commentaire de `attendance.js` indiquait encore que NISU n'était pas porté.
   - En réalité, la requête D1 vérifiait déjà `custom_fields` (`NISU`/`nisu`).
   - Le commentaire a été corrigé pour refléter le comportement réel.
   - Test ajouté : recherche kiosque uniquement par NISU.

3. **Bulk attendance — compatibilité de résultat**
   - Les résultats retournent désormais `ok` en plus de `success`, avec les codes legacy :
     `INVALID_TYPE`, `MISSING_ID`, `PERMISSION_DENIED`, `ALREADY_SCANNED`, `RECORDED`.
   - Un `type` explicitement différent de `STUDENT` est rejeté.
   - L'absence de `type` reste acceptée pour préserver les anciens appelants déjà présents dans l'application.
   - `alreadyScanned` est conservé pour la compatibilité UI existante.

## Validation

- `run-grades-attendance-test.mjs` — PASS
- `run-staff-attendance-test.mjs` — PASS
- `run-kiosk-attendance-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (242/242 actions enregistrées; 268 runtime actions)
- `run-permissions-test.mjs` — PASS
- `run-promotion-test.mjs` — PASS
- `run-payments-test.mjs` — PASS
- `run-reports-test.mjs` — PASS
- `node --check src/actions/attendance.js` — PASS
- `node --check src/actions/index.js` — PASS

## Conclusion

Aucun écart concret supplémentaire n'a été identifié dans le périmètre attendance audité pour ce lot. La parité fonctionnelle revendiquée ici est limitée aux écarts examinés et testés; le compteur 242/242 reste un registre d'actions et non une preuve de parité ligne par ligne.
