# EDGE-0077 — Grades Final Parity

## Objective
Finish the remaining concrete parity gap in the Grades domain before moving to another section.

## Correction
`updateGradeSubjects` no longer writes only a flat `SUBJECTS` setting. Code.gs delegates `updateGradeSubjects_` to `syncSubjectsInSettings_`, which persists the curriculum through `saveChunkedCurriculum_`. The Worker now delegates to the already-ported `saveChunkedCurriculum` action.

Supported inputs:
- legacy `{ levelId, subjects }` shape;
- `{ gradeLevelId, subjects }`;
- `{ level, subjects }`;
- full curriculum map `{ levelId: [...] }`;
- `{ curriculum: { levelId: [...] } }`.

This keeps `CURRICULUM_<LEVEL>` and the derived `SCHOOL_CURRICULUM` snapshot synchronized and preserves permission checks, coefficient/branch normalization, auditing, and atomic persistence already implemented by the curriculum port.

## Verification
- `node --check src/actions/grades.js` — PASS
- `node test/run-grades-attendance-test.mjs` — PASS
- `node test/run-curriculum-test.mjs` — PASS
- `node test/run-exams-test.mjs` — PASS
- `node test/run-codegs-parity-audit-test.mjs` — PASS (242/242 inventory actions registered; 268 runtime actions)
- dedicated `updateGradeSubjects` parity test — PASS

## Status
Grades / evaluation domain: concrete identified parity gaps closed for this audit. No claim is made that unrelated domains are complete.
