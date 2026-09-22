# EDGE-0089 — Examens / Notes / Bulletins — Final

## Périmètre audité

Audit fonctionnel ciblé de `Code.gs` contre le Worker Cloudflare/D1 pour :
- examens en ligne et soumissions ;
- questions de quiz legacy ;
- saisie et lecture des notes ;
- mentions ;
- bulletins ;
- contrôle d'accès au bulletin ;
- devoirs projetés dans le bulletin ;
- pont examens/devoirs → `grades`.

## Correction de ce lot

### 1. Préflight téléchargement bulletin — verrouillage du périmètre étudiant

`checkStudentBulletinDownloadAllowed` pouvait recevoir un `studentId` fourni par le client et l'utiliser pour le contrôle financier alors que la session était celle d'un élève.

Correction : une session `STUDENT` ne peut désormais préflight que son propre `studentId` vérifié depuis la session. Une demande pour un autre élève renvoie `allowed:false` avec `reason: "scope"`.

Cette correction évite une fuite de décision/état financier via le préflight et aligne le contrôle de téléchargement sur le principe d'accès au propre dossier.

## Éléments vérifiés sans changement

- cycle de vie examen : save/list/get/delete/publish ;
- soumissions : list/get/grade ;
- disponibilité étudiant par statut, ouverture, échéance et classe/élève ;
- reprise d'une tentative en cours ;
- limite de tentatives ;
- auto-évaluation des types de questions portés ;
- pénalité de retard ;
- visibilité des résultats ;
- sélection BEST/LAST/FIRST/AVG du résultat ;
- pont vers les notes canoniques ;
- `saveManualExamGrade`, `getGrades`, `getExistingGrade`, `updateGradeSubjects` et `saveMaternalMentions` ;
- bulletin classique ;
- `SINGLE_SUBJECT_MODE` ;
- verrou financier optionnel du bulletin ;
- téléchargement conditionné à `pt_download_bulletin` ;
- notes internes, dossier médical et signatures de documents ;
- permissions et scope étudiant.

## Tests

- `run-bulletin-test.mjs` — PASS
- `run-exams-test.mjs` — PASS
- `run-grades-attendance-test.mjs` — PASS
- `run-media-homework-test.mjs` — PASS
- `run-reports-test.mjs` — PASS
- `run-payments-test.mjs` — PASS
- `run-promotion-test.mjs` — PASS
- `run-permissions-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (registre)
- syntax checks examens/notes/grades/bulletin — PASS

## Limite d'interprétation

Le registre `Code.gs` indique la couverture des actions enregistrées, mais `N/N` n'est pas une preuve de parité comportementale totale. Ce lot signifie qu'aucun écart concret supplémentaire n'a été identifié dans le périmètre audité et que la correction de sécurité a été testée.
