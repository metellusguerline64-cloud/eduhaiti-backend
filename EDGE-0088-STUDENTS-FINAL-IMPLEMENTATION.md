# EDGE-0088 — Élèves / Dossier étudiant — Final Parity

## Périmètre
Audit fonctionnel ciblé de la section Élèves de `Code.gs` contre `src/actions/students.js`, à partir du Lot 0087.

## Corrections
- `updateStudent` respecte maintenant `SYSTEM_ID_MODE` comme le legacy : les champs `FirstName`/`LastName` sont modifiables en mode manuel et verrouillés en `AUTO`/`COMPANY`/`COMPANYMODE`.
- Les projections D1 `students.current_level` et `students.section` sont maintenues cohérentes avec la ligne `student_history` ACTIVE lors d'un changement de classe/section.
- Les champs étudiants connus (`FirstName`, `LastName`, `CurrentLevel`, `Section`, `EnrollmentStatus`, `GeneratedSource`, `GeneratedOrgId`, etc.) sont maintenant acceptés par `updateStudent`.
- Les champs de formulaire inconnus sont conservés dans `custom_fields`, équivalent D1 des colonnes supplémentaires du Sheet legacy.
- Les contrôles existants d'accès, d'historique, de recherche NISU via `CustomFields`, de réinscription, radiation et reset PIN sont conservés.

## Tests
- `run-students-test.mjs` — PASS
- `run-student-lifecycle-test.mjs` — PASS
- `run-student-offline-domain-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (239/239 actions enregistrées; registre, pas preuve de parité comportementale totale)
- `run-permissions-test.mjs` — PASS
- `run-grades-attendance-test.mjs` — PASS
- `run-payments-test.mjs` — PASS
- `run-reports-test.mjs` — PASS
- `run-promotion-test.mjs` — PASS
- `run-users-test.mjs` — PASS
- `run-staff-attendance-test.mjs` — PASS
- `run-kiosk-attendance-test.mjs` — PASS
- `node --check src/actions/students.js` — PASS

## Remarque
Un test global de démarrage Edge (`edge-persistent-queue-test.mjs`) échoue dans cet environnement d'exécution avec `Edge ne démarre pas`; il ne s'agit pas d'un échec du domaine Élèves et n'a pas été présenté comme PASS.
