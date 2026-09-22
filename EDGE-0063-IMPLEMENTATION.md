# EduHaïti 0063 — Student Portal + Bulletin Verification

Source of truth: uploaded `Code.gs.txt`, specifically the historical handlers `studentPortalLogin_`, `setupInitialPin_`, `getActiveEnrollment_`, `getEnrollmentsByClass_`, `verifyStudentByLast4_`, `registerBulletinIssue_`, and `verifyBulletin_`.

## Ported actions
- studentPortalLogin
- setupInitialPin
- getActiveEnrollment
- getEnrollmentsByClass
- verifyStudentByLast4
- registerBulletinIssue
- verifyBulletin

## D1
`migrations/0029_student_portal_bulletin.sql` adds `bulletin_verifications` and indexes it by `(org_id, verify_id)` and `(org_id, student_id)`.

Student PINs reuse `students.pin_hash`, which was already introduced by the earlier migration.
Student first-login phone lookup reads the student's `custom_fields` for legacy `ParentPhone`/`Phone2` keys because those columns are not promoted in the current D1 schema.

## Compatibility
- Student login accepts the historical ID/prefix/digit-tail forms.
- First login validates against the parent phone and returns `firstTime:true` without a session, matching the historical two-step flow.
- After `setupInitialPin`, a D1 session is created for the student.
- `getActiveEnrollment` uses the latest `student_history` row and returns null when its status is not ACTIVE.
- `getEnrollmentsByClass` keeps the historical response shape (`success`, `data`, `count`).
- Bulletin verification preserves the historical public verification response fields and increments verification count/timestamp.
- No admin email, folder ID, or API key is hardcoded.

## Tests
`npm run test:student-portal` passes.
Syntax checks pass for the new modules and action registry.
