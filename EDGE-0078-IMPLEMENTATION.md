# EDGE-0078 — Affectations / Emploi du temps / Paie — Final parity batch

## Objectif
Fermer les écarts fonctionnels restants du domaine personnel : permissions sur paie/timetable et cohérence avec la politique ACTION_PERMISSIONS de Code.gs.

## Corrections
- Payroll (`calculateTeacherPayroll`, `saveTeacherPaymentMode`, `processPayrollBatch`, `getPayrollHistory`) applique maintenant les permissions définies dans `ACTION_PERMISSIONS`, au lieu d'exiger uniquement `is_master/is_god_mode`.
- Timetable (`getTimetableData`, `saveTimetableData`) applique maintenant les mêmes permissions que Code.gs.
- Les tests timetable ont été adaptés avec un compte admin explicite afin de vérifier le nouveau contrôle d'accès.
- Commentaires obsolètes de `teacher_assignments.js`, `timetable.js` et `schema.sql` corrigés.
- Aucun secret, email administrateur ou identifiant de dossier n'est hardcodé.

## Validation
- run-timetable-test.mjs: PASS
- run-payroll-test.mjs: PASS
- run-teacher-assignments-test.mjs: PASS
- run-codegs-parity-audit-test.mjs: PASS (242/242)
- node --check payroll.js: PASS
- node --check timetable.js: PASS
- node --check teacher_assignments.js: PASS
