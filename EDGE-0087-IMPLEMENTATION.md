# EDGE-0087 — Médias / Documents / Devoirs — Final Parity Hardening

## Périmètre
Audit du bloc `Media_Library`, upload média, `Homeworks`, `Homework_Grades` et accès élève, comparé aux fonctions correspondantes de `Code.gs`.

## Corrections du lot
- Alignement du filtrage média élève sur la classe vérifiée du dossier élève, plutôt que sur une classe fournie par la requête.
- Ajout du contrôle de permission étudiant identique au legacy pour `listStudentHomework` : `sp_view_homework`, `pt_view_exam_calendar` ou `p_grades`.
- Verrouillage du filtrage de devoirs côté élève sur `current_level` vérifié via `assertStudentAccess`; `data.className` ne peut plus modifier le périmètre d'un élève connecté.
- `getStudentHomeworkBulletin` utilise désormais l'identifiant élève résolu côté serveur.
- Conservation de R2 comme stockage Worker-native, sans dépendance à un Drive ou à un Folder ID hardcodé.
- Les actions Media/Homework restent tenant-scoped via `resolveOrgId`.

## Non-ajouté volontairement
- Aucun `filterMediaByType` artificiel n'a été ajouté au backend : cette fonction n'existe pas dans le périmètre correspondant de `Code.gs`; le filtrage par type est déjà supporté par `listMedia({type})`.
- Aucun canal email/SMS/WhatsApp n'est introduit : le lot Communication 0086 reste Push Notification uniquement.

## Validation
- `run-media-homework-test.mjs` — PASS
- `run-media-parity-hardening-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (239/239 actions du registre courant)
- `pwa-offline-media-test.mjs` — PASS
- `run-edge-media-offline-test.mjs` — PASS
- `run-edge-media-backup-test.mjs` — PASS
- `run-grades-attendance-test.mjs` — PASS
- `run-reports-test.mjs` — PASS
- `run-permissions-test.mjs` — PASS
- `node --check` — PASS

## Conclusion
Aucun écart concret supplémentaire identifié dans le périmètre fonctionnel Media/Homework audité après ces corrections et tests. Cela ne constitue pas une affirmation de parité comportementale absolue de l'ensemble de l'application.
