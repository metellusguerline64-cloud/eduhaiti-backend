# EduHaïti API — Cloudflare Worker (Phase 0 + Phase 3 groundwork + Generated_IDs sync)

Ports `apiHub`'s login path off Google Apps Script/Sheets onto Cloudflare
Workers + D1. Live actions: `ping`, `attemptSheetLogin`, `getViewerInfo`,
`syncPull`, `syncPush`, `syncGeneratedIds`, the real
`getGrades`/`saveManualExamGrade`/`getExistingGrade`/`updateGradeSubjects`,
`getAttendanceForStudent`/`getStudentAttendance`/`getAttendanceByDate`/
`getAttendanceStats`/`getStudentAttendanceStats`/`recordAttendance`/
`recordBulkAttendance`/`recordStudentAttendance`,
`getStudentPayments`/`recordNewPayment`/`voidPayment`/`editPayment`,
the student directory/lifecycle — `getAllStudents`/`getStudentById`/
`searchStudents`/`getStudentHistory`/`updateStudent`/`enrollStudent`/
`dropStudent`/`reEnrollStudent`/`updateStudentHistory` — and the staff
timetable/affectation domain — `getStaffAssignments`/
`saveStaffAssignment`/`deleteStaffAssignment`/`createSubject`/
`deleteSubject`/`getTimetableData`/`saveTimetableData` — plus staff
clock-in/out (`clockInStaff`/`getStaffAttendance`) and a Cron-triggered
background job. Seven major domains/workflows are now ported in staged form
(students, grades, attendance, payments, teacher_assignments/timetable,
users/permissions/scope, staff attendance, auth) before the remaining
HR/payroll and ~630 legacy actions are migrated.

Auth was tested locally against Miniflare's D1 emulation: login issues
a token, `getViewerInfo` resolves it back to the right user, wrong
passwords/tokens fail cleanly. The Generated_IDs sync (below) was
verified separately against a sqlite-backed D1 shim with fixture data.
Unported actions return a clear "not ported yet" error instead of
breaking silently.

## Users, permissions, viewer scope, and staff attendance

This pass completes the next security/HR layer without changing the frontend action names:

- `getAllAdminUsers`, `updateUserRoleAndPerms`, `resetUserPassword`, and `toggleGodMode` use the D1 `users` table.
- `AssignedSubjects` is synchronized when a teacher affectation is saved, using email → user ID → name matching like the original Code.gs helper.
- `getStaffAssignments` now preserves the original security boundary: master/GodMode/staff-affectation admins receive the full roster; ordinary portal viewers receive only their own affectations and pay fields (`hours`, `rate`, `salary`) are removed.
- `clockInStaff` / `getStaffAttendance` now use the existing `attendance` table with `grade_level_id='STAFF'`, matching the original staff clock-in/out design. The second scan closes the same day's open punch rather than creating a second row.
- `staff_attendance` is now a dedicated D1 companion table for admin-confirmed LATE/ABSENT records, ready for the payroll calculation layer.

Migration: `migrations/0009_staff_attendance.sql`.

Tests: `test/run-users-test.mjs`, `test/run-access-scope-test.mjs`,
`test/run-teacher-assignments-test.mjs`, and `test/run-staff-attendance-test.mjs`,
plus the full existing test suite.

## Full port: Generated_IDs → students background sync

`src/lib/generatedIdsSync.js` is a real, line-by-line port of three
functions from the actual `Code.gs` (not a stub) —
`_scheduleGeneratedIdsSync_`, `syncAssignedStudentsFromGeneratedIds_`,
and the student+history-writing half of `addNewStudent_` — replacing
the "every doGet, throttled by a CacheService stamp" pattern with a
real **Cloudflare Cron Trigger** (`scheduled` export in `src/index.js`,
every 10 minutes, configured in `wrangler.toml`'s `[triggers]`).

What it does, same as the original:
- Reads the `Generated_IDs` sheet (still on Google Sheets — see below),
  normalizes headers the same accent/whitespace-stripping way, and finds
  the ID/Nom/Prenom/Phone/OrgId/PhotoURL/Status/Classe/Sexe/Adresse/
  DateNaissance columns by name, not position.
- Same normalization: Drive photo links → `drive.google.com/thumbnail?...`,
  same inactive-status regex (`INACTIF|SUSPENDU|BLOCKED|...`).
- Same "only import codes not already in `students`" guard — this is
  the exact fix Code.gs's own comments describe for the "profile resets
  on every page load" bug, ported forward rather than reintroduced.
- Same student_history behavior: one ACTIVE row per student per school
  year, updates `GradeLevelID` in place on a level change instead of
  duplicating rows.
- Same throttle *shape* (an outer "don't even start" stamp, an inner
  "already synced recently" stamp) — now backed by a `sync_stamps` D1
  table instead of `CacheService`/`PropertiesService`, since one Worker
  deployment = one school and Cron already prevents most of the
  redundant calls the original was throttling against.
- Writes to `audit_log` on every insert/update (device_id
  `cron:generated_ids_sync`), reusing the same table the Phase 3 sync
  engine already writes to.

**Verified**, not just written: `test/run-sync-test.mjs` runs this real
code (not a copy) against a sqlite-backed D1 shim
(`test/d1shim.mjs`) and fixture Generated_IDs rows
(`test/fake-sheets-api.js`), asserting: only the active, matching-org
row gets imported; the inactive row and the other org's row are
skipped; the photo URL gets normalized; a history row is created with
the right school year and level; and a second run doesn't re-import or
duplicate anything. Run it yourself:

```bash
npm install
node test/run-sync-test.mjs
```

**Deliberately not ported** (flagged, not silently dropped):
- `syncParentAccountForStudent_` / `deliverParentCredentials_` — the
  parent-portal account auto-provisioning and WhatsApp credential
  delivery that `addNewStudent_` triggers for brand-new students. The
  ported function always returns `parentAccount: null` instead of
  pretending this happened.
- The full multi-tenant `getSaaSSettings_` (the "Register" spreadsheet
  with billing plan / AI quota columns). Only the two settings keys
  this specific job reads — `SYSTEM_ID_MODE` / `SYSTEM_ID_PREFIX` /
  `ACADEMIC_YEAR` — are ported, via a flat `settings` D1 table
  (`src/lib/settings.js`) seeded once per school at cutover instead of
  read from Sheets.
- `updateStudent_` (the student-dossier edit screen) — this job only
  ever inserts brand-new students from `Generated_IDs`, it never edits
  an existing one, same as the original.

**Why `Generated_IDs` is still read from Google Sheets, not D1:**
that sheet is fed by an external student-registration flow that isn't
part of `Code.gs`/`apiHub` (a Google Form or similar), so it isn't
something this migration can port on its own — it needs its own
replacement, or to stay on Sheets as an intake surface indefinitely.
`src/lib/googleAuth.js` + `src/lib/sheetsApi.js` implement a service-
account OAuth2 flow (JWT-bearer, signed with Web Crypto) so the Worker
can read it the same way `SpreadsheetApp` did — see `wrangler.toml` for
the two secrets this needs (`GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) and share Viewer access on
`MASTER_AUTH_ID` with that service account.

A manual trigger is also registered as an action —
`?action=syncGeneratedIds` or `&force=true` — for admin use/testing
outside the Cron schedule (`src/actions/students.js`).

## Generic sync engine (Section 4)

`src/lib/sync.js` implements delta-pull and outbox batch-ingest against
**any** table, not one integration per domain:

- `schema.sql` has real typed tables for `students`/`student_history`,
  `grades`/`attendance`, `payments`, and `teacher_assignments`/
  `timetable` (all ported from actual `Code.gs` columns — see above)
  plus generic `fields`-JSON tables for the two domains not yet ported
  for real — `classes`, `notifications` — each with the four sync
  columns (`id` / `version` / `updated_at` / `deleted_at`). The typed
  tables are intentionally excluded from the generic sync engine below
  (see `SYNC_TABLES` in `src/lib/sync.js`) now that each has its own
  dedicated write path with real columns and its own conflict handling
  (inline `baseVersion` checks in `payments.js`, composite-key matching
  in `teacher_assignments.js`, etc. — see each file).
- `syncPull` (`?action=syncPull&table=classes&cursor=...`) returns rows
  changed since a cursor, tombstones included, plus the next cursor —
  for whichever tables are still in `SYNC_TABLES`.
- `syncPush` (`POST {action: "syncPush", data: {entries: [...]}}`)
  applies a batch of outbox entries idempotently (via
  `sync_applied_ops`) and enforces last-write-wins by default.
  `STRICT_TABLES` (reject-on-stale-`baseVersion` instead of
  overwriting) is currently empty — that stricter rule now lives inside
  each promoted domain's own action file instead (see `grades.js` /
  `payments.js` / etc.); add a table back here if a future promotion
  needs that same strictness before it gets its own dedicated path.
- Every applied write lands a row in `audit_log` (who/what/when),
  covering the Phase 2 "audit logging on write" task ahead of schedule
  since it was free to add once writes went through one function.
- `scripts/contract-test.js` diffs a live Worker response against a
  captured real Apps Script response, field by field — run this per
  action as Phase 1 ports things for real (Section 6 mitigation for
  "response-shape drift").

**Why `classes`/`notifications` still use a `fields` JSON blob:**
`Code.gs` is now available in full (674 functions), but porting every
domain's real columns in one pass isn't something to do without
testing each one — `students`/`student_history` above is the model:
real columns, ported logic, and a runnable test before calling it done,
not just a schema guess. The sync engine only reads the four sync
columns either way, so it works correctly today; promoting `fields`
keys into typed columns per domain is additive and doesn't require
touching `sync.js`.

## Students — real Code.gs port (directory + lifecycle)

`src/actions/students.js` now also ports the core student-domain
actions, against the `students`/`student_history` tables that
`generatedIdsSync.js` already writes to:

- `getAllStudents` / `getStudentById` / `searchStudents` — the student
  directory, joining each student to their LATEST `student_history` row
  (same "latest wins" rule as `_buildActiveHistoryMap`/
  `_getLatestHistoryRow_`) via a window-function query, so `CurrentLevel`/
  `Section`/`Active`/`ActiveHistoryID` reflect real enrollment state
  instead of a stale column on `students` itself. Attendance % is
  ported for real (`_buildStudentAttendancePercentMap_`, including its
  optional `ACADEMIC_YEAR`-window filter); **paid % is not** — see
  below.
- `getStudentHistory` — full enrollment history for one student, newest
  year first, with an `isCurrent` flag per row.
- `updateStudent` — patches demographic fields (phone/gender/birth
  date/address/photo/custom fields); a `CurrentLevel`/`Section` change
  patches the active `student_history` row in place, or creates a
  fresh one if none is active — same two-step behavior as
  `updateStudent_`.
- `enrollStudent` / `dropStudent` / `reEnrollStudent` — the enrollment
  lifecycle. `dropStudent` never touches the original ACTIVE row, it
  appends a new DROPPED one (so history stays a real audit trail);
  `enrollStudent` and `reEnrollStudent` both refuse to double-enroll a
  student whose latest row is already ACTIVE.
- `updateStudentHistory` — direct patch of one history row by
  `historyId` (section/level/status), independent of the two above.

**Deliberately NOT ported** (flagged in the file header, not silently
dropped): paid% enrichment (depends on the same unported tuition-schedule
resolver `payments.js` already flags — the `paid`/`Paid` field is
omitted rather than faked as `'0%'`); viewer/permission scoping and
field redaction (`filterStudentsByViewerScope_`/
`_redactStudentListForViewer_`/`ensureViewerCanAccessStudentScope_` —
every authenticated caller sees/edits every student for now, same gap
as grades/attendance/payments); the `SYSTEM_ID_MODE` identity-lock
(this port is simply stricter — `updateStudent` never accepts
name/code edits at all, in any mode); and the `NISU` substring match in
search (same D1-schema gap noted in `attendance.js`).

Schema note: `student_history` gained two non-destructive columns
(`drop_reason`, `drop_date`) needed for a faithful `dropStudent` port —
see `migrations/0005_student_history_drop_columns.sql` (additive
`ALTER TABLE`, safe to run against a deployment with real history data,
unlike the earlier destructive `DROP`/`CREATE` migrations):

```bash
npm run db:migrate:student-history-drop-cols:local
npm run db:migrate:student-history-drop-cols:remote
```

**Verified**: `test/run-students-test.mjs` runs this real code against
the sqlite-backed D1 shim — joined active-history fields on the list
view, a not-yet-enrolled student reading as `"Non inscrit"`, attendance%
math, search by name/code, a class change patching the history row in
place instead of duplicating it, the full enroll → drop → re-enroll
cycle (including both rejection paths), a direct history patch, and
full `audit_log` coverage.

```bash
npm install
npm run test:students
```

## Payments — real Code.gs port (verified, scoped)

`src/actions/payments.js` ports the core of Code.gs's payment actions
against a real `payments` D1 table (`ReceiptID`/`HistoryID`/`StudentID`/
`StudentName`/`Description`/`Amount`/`Cashier`/`Status`/`Notes`/`Date`/
`Reference`/`ClientRequestID`, mirroring the `Finance` Sheet's own
columns — see `schema.sql`), replacing the placeholder generic `fields`
JSON table it used before:

- `getStudentPayments` — ports `getStudentPayments_`: lists a student's
  payments, defaulting to their current active `HistoryID` (via
  `student_history`) unless `allYears`/`historyId` says otherwise.
- `recordNewPayment` — ports the receipt/idempotency/audit core of
  `recordNewPayment_`: minimum-amount check, `clientRequestId`-based
  idempotent replay (a retried submission returns the existing receipt
  instead of writing a duplicate), unique receipt-id generation with a
  collision check, PAID/PARTIAL status from `amountPaid` vs `amountDue`,
  and a `PAY_ALLOW_PARTIAL` settings gate.
- `voidPayment` / `editPayment` — direct ports: void never deletes a
  row (marks `Status='VOID'`, requires a reason, is idempotent on a
  second call), edit only touches amount/date/reference/method-note
  (never studentId or description) and never recomputes status
  automatically — both match `voidPayment_`/`editPayment_` exactly.

**recordNewPayment_ in Code.gs is the single largest action in the
whole file (~380 lines)** because it also resolves a school's tuition
*schedule* (frequency, per-period amount owed, prior payments this
year via `computeStudentOutstanding_`) to compute `due` automatically,
then layers overpayment splitting (change/refund/advance-credit) and
late-fee penalties on top. **None of that is ported.** `recordNewPayment`
here requires the caller to pass `amountDue` explicitly (falling back
to "paid in full" if omitted, the same fallback Code.gs itself uses
when its schedule resolver comes back empty); overpayments are recorded
at face value with a note instead of being split; penalties are always
0. See the header comment in `payments.js` for the complete list,
including per-class payment-method restrictions and the separate
student-submitted "online payment, admin-approves" flow (Groupe B in
Code.gs) — neither is built here.

Conflict handling: `payments` used to sit in `sync.js`'s
`STRICT_TABLES` (reject a stale write instead of silently overwriting —
Section 6 risk). Now that it has its own write path, `voidPayment`/
`editPayment` enforce that same rule directly via an optional
`baseVersion` argument, and `STRICT_TABLES` is now empty (nothing left
routes payments/grades/attendance through the generic engine — see the
comment in `src/lib/sync.js`).

**Verified**: `test/run-payments-test.mjs` runs this real code against
the sqlite-backed D1 shim, asserting PAID vs PARTIAL status, receipt-id
generation, `HistoryID` defaulting, idempotent-retry replay (no
duplicate row), void requiring a reason and being idempotent, a stale
`baseVersion` being rejected as a conflict, edits being blocked on a
voided payment, and full `audit_log` coverage (insert/void/edit).

```bash
npm install
npm run test:payments
```

Migration note: same pattern as grades/attendance — if you already ran
the old generic `payments` shape against a deployment, run
`migrations/0004_real_payments_port.sql` to replace it (destructive —
drops and recreates the table, safe only because Sheets/Apps Script
stays authoritative for payments per the blueprint's Phase 2 rollout
and no real D1 payments data should exist yet):

```bash
npm run db:migrate:payments-v2:local
npm run db:migrate:payments-v2:remote
```

On a brand-new database, `schema.sql` already has the real shape.

## Test infra note: `node:sqlite`, not `better-sqlite3`

`test/d1shim.mjs` now uses Node's built-in `node:sqlite` (stable enough
for this use since Node 22) instead of the `better-sqlite3` native
module. `better-sqlite3` needs `node-gyp` to compile from source in
this environment, which needs to download Node's headers from
`nodejs.org` — outside this sandbox's egress allowlist, so `npm install`
failed outright. `node:sqlite` needs no compile step, so every test
file (`run-sync-test.mjs`, `run-grades-attendance-test.mjs`, and the
new `run-payments-test.mjs`) now runs with a plain `npm install` on
Node ≥22.5. If you're on an older Node locally, either upgrade or swap
the shim back to `better-sqlite3` — the wrapper's `bind/run/first/all`
surface is intentionally identical either way, so no test file needs
to change.

## Next up: Phase 1 domain actions

What's a verified port so far: `attemptSheetLogin` / `getViewerInfo`
(auth), the `Generated_IDs` → `students` background sync in full, the
student directory/lifecycle, `grades`/`attendance`/`payments`, and
`teacher_assignments`/`timetable` (real action names + real Sheet
columns, see above). Still stubbed as "not ported yet": the other ~630
actions behind `apiHub`'s if/else chain — `classes`/`notifications`
(still on the generic `fields` JSON sync engine), full payroll
computation (`calculateTeacherPayroll_`/`saveTeacherPaymentMode_` — see
the disclaimer in `src/actions/teacher_assignments.js`; it needs a
staff-attendance table and `Users.PayMode`/`PayRate`/`PayFixedSalary`
columns neither of which are ported yet), the online-payment approval
flow, viewer/permission scoping across every domain, and the larger
subsystems (messaging, exams/quizzes, bulletins/report cards, AI
appreciation text, parent portal) that haven't been touched at all yet.

Same approach each time: pick a domain, find its functions in
`Code.gs`, port them into `src/actions/<domain>.js` with real D1
columns in `schema.sql` (not `fields` JSON), and verify against a
sqlite-backed test the way `test/run-sync-test.mjs` does, before wiring
a `contract-test.js` sample from the live app. Students/grades/
attendance/payments/teacher_assignments/timetable now all have that
level of scrutiny; `classes`/`notifications` remain on the generic
`fields` JSON engine and can follow the same recipe next.

## Teacher assignments / timetable — real Code.gs port (verified)

`src/actions/teacher_assignments.js` and `src/actions/timetable.js`
were written with `Code.gs` in context. Real action names and real
`teacher_assignments`/`timetable` Sheet columns (`AssignmentID`/
`TeacherName`/`TeacherID`/`ClassName`/`ClassID`/`Subject`/`Day`/
`StartTime`/`EndTime`/`Hours`/`Rate`/`Salary`/`PaymentMode`/
`HasConflict`/... and `SlotID`/`ClassName`/`DayIndex`/`DayLabel`/
`StartTime`/`EndTime`/`Subject`/`Teacher`/`TeacherID`/`Conflict`/...)
are ported from `ensureTeacherAssignmentsSheetStructure_`/
`ensureTimetableSheetStructure_` and from the actual functions behind
each `apiHub` action:

- `getStaffAssignments` — ports `getStaffAssignments_`'s roster read.
  **Not ported**: the admin-vs-non-admin response redaction (full
  roster+pay for admins, own-rows-only-pay-stripped for a `pt_*`
  portal-permission holder) — this D1 port's `getViewerInfo` doesn't
  resolve permissions/`isMaster`/`isGodMode` yet, so every authenticated
  caller currently gets the full, unredacted list. Don't expose this
  action to non-admin callers until viewer scoping lands.
- `saveStaffAssignment` — ports `saveStaffAssignment_`: matches an
  existing row by id first, then by the (teacher, className, subject,
  day, start) composite key, same as the original; carries forward the
  same `payMode`/`paymentMode` field-name fix Code.gs itself has (only
  a recognized `HOURLY`/`FIXED` value overwrites what's stored — a
  blank one doesn't wipe it). **Not ported**:
  `_syncClassToTeacherUsersRow_` (writing the assigned class onto the
  teacher's Users row) — this D1 `users` table has no `AssignedSubjects`
  column yet, so the response's `usersSync` is always
  `{success:false, error:"not_ported"}` instead of pretending it
  happened.
- `deleteStaffAssignment` — soft-delete (`Active=FALSE`), same as
  Code.gs; no match is reported as success, not an error, same as the
  original.
- `createSubject`/`deleteSubject` — thin aliases, same relationship to
  `saveStaffAssignment`/`deleteStaffAssignment` as in Code.gs.
- `getTimetableData`/`saveTimetableData` — port `getTimetableData_`/
  `saveTimetableData_`. **Intentional deviation, flagged**: the original
  dispatcher calls these with no `auth` parameter at all — Code.gs never
  checks a token before serving or overwriting the whole timetable. This
  port requires a valid session token instead of reproducing that gap.
  `saveTimetableData_` in Code.gs clears the whole sheet body and
  rewrites it from the payload every call (full-state replace, not a
  diff); this port reproduces that end state via soft-delete (every
  active row not in the new payload gets `deleted_at` set) instead of a
  hard wipe, so the sync engine's tombstone convention still applies to
  clients pulling deltas.

**Deliberately not ported**: full payroll (`calculateTeacherPayroll_`,
`saveTeacherPaymentMode_`, the `Payroll` sheet) — this is a
significantly larger follow-up port, not attempted here (see the header
comment in `teacher_assignments.js` for exactly why: it needs an
unported staff clock-in/out attendance table plus `Users.PayMode`/
`PayRate`/`PayFixedSalary` columns); `_autoRepairTeacherAssignmentIdsOnce_`/
`repairTeacherAssignmentIds_` (a one-time legacy-data backfill, not
relevant to a fresh D1 deployment); and the CacheService-based
`VIEWER_*`/`TEACHER_AFFECTATION_ROWS_*` invalidation dance (D1 reads are
live, nothing to invalidate).

**Verified**, not just written: `test/run-teacher-assignments-test.mjs`
and `test/run-timetable-test.mjs` run this real code (not a copy)
against a sqlite-backed D1 shim, asserting: composite-key matching
updates in place instead of duplicating; a blank `payMode` doesn't wipe
a previously-set one; delete is a soft-delete and is a no-op-success on
no match; and — for timetable — a full-state save both keeps a
carried-forward slot's id (bumping its version) and soft-deletes
whatever wasn't resent, with an empty-array save clearing everything.
Run them yourself:

```bash
npm install
npm run test:teacher-assignments
npm run test:timetable
```

Migration note: if you already ran the base `schema.sql` against a
deployment (the old generic `fields` shape), run
`migrations/0006_real_teacher_assignments_timetable_port.sql` next to
replace both tables with the real schema — it's destructive (drops and
recreates both tables), same convention as migrations 0003/0004:

```bash
npm run db:migrate:teacher-assignments-timetable-v2:local
npm run db:migrate:teacher-assignments-timetable-v2:remote
```

On a brand-new database, `schema.sql` already has the real shape —
just run `npm run db:migrate:remote` as usual and skip the 000x
migration files entirely.

## Grades / attendance — real Code.gs port (verified)

`src/actions/grades.js` and `src/actions/attendance.js` were rewritten
with `Code.gs` in context, replacing an earlier guessed version. Real
action names and real `grades`/`attendance` Sheet columns
(`GradeID`/`HistoryID`/`StudentID`/`SubjectID`/`PeriodID`/`Score`/
`Mention`/`ScoresJSON`/... and `RecordID`/`HistoryID`/`StudentID`/
`Date`/`Status`/`RecordedBy`/`MetaJSON`) are ported from Code.gs's
`SHEET_DEFS` and from the actual functions behind each `apiHub` action:

- `getGrades` — ports `getGrades_`, including its "expand `ScoresJSON`
  into one entry per graded period" fix (the sheet stores one row per
  student+subject with every period merged into one JSON blob).
- `saveManualExamGrade` — ports `saveManualExamGrade_`: upserts that
  one row per (student, subject[, history]), validates `PeriodID`
  is `T1`–`T6`, rejects a missing period as a hard error instead of a
  silent `T1` default (same fix Code.gs itself carries).
- `getExistingGrade`, `updateGradeSubjects` — thin ports; see the
  disclaimer in `grades.js` for what `updateGradeSubjects` simplifies.
- `getAttendanceForStudent` / `getStudentAttendance` (alias) /
  `getAttendanceByDate` / `getAttendanceStats` /
  `getStudentAttendanceStats` — direct ports of their `_`-suffixed
  originals.
- `recordAttendance` / `recordBulkAttendance` — port the kiosk
  IN/OUT check-in and bulk-class-marking flows, including the
  one-row-per-student-per-day duplicate rule.
- `recordStudentAttendance` — full port, including `verifyStudentByLast4_`:
  a kiosk sends a partial code/name fragment (`shortCode`), matched via
  case-insensitive substring search against `StudentCode`/`FirstName`/
  `LastName`. **One gap remains**: the original also matches against
  `NISU`, which isn't a dedicated column in this D1 schema (it would
  live inside `students.custom_fields` JSON) — a term that only
  matches NISU won't resolve here. Flag this if a school's kiosk flow
  relies on NISU lookups specifically.

**Deliberately not ported** (see the header comment in each file for
the full list): `saveMaternalMentions_` (maternelle mention batches),
per-subject `MAX_SCORE`/`NUM_PERIODS` enforcement beyond what's seeded
in the `settings` table, viewer/permission scoping on grade and
attendance reads, `recordTransportAttendance_`, `getStaffAttendance_`
(a different sheet), the NISU half of the student lookup above, and
the derived-cache invalidation calls that have no Worker-side
equivalent yet.

**Verified**, not just written: `test/run-grades-attendance-test.mjs`
runs this real code (not a copy) against a sqlite-backed D1 shim,
asserting the `T1`/`T2` merge-not-duplicate behavior, the missing/
invalid-period rejection, the same-day attendance duplicate rule,
`recordBulkAttendance` skipping already-marked students while still
processing the rest of the batch, and full `audit_log` coverage. Run
it yourself:

```bash
npm install
npm run test:grades-attendance
```

If your school's `Code.gs` has since diverged from the version this
was ported against (custom columns, a forked grading scheme, etc.),
re-check `src/actions/grades.js` / `attendance.js` against your actual
file before trusting this without re-running the tests. Run
`scripts/contract-test.js` against a captured real `apiHub()` response
per action before cutover, same as any other ported domain.

Migration note: if you already ran `migrations/0002_promote_grades_attendance.sql`
against a deployment (the old guessed schema), run
`migrations/0003_real_grades_attendance_port.sql` next to replace it
with the real schema — it's destructive (drops and recreates both
tables), which is safe only because Sheets/Apps Script is still
authoritative for these two domains per the blueprint's rollout plan
(Section 5, Phase 2) and no real D1 data should exist yet:

```bash
npm run db:migrate:grades-attendance-v2:local
npm run db:migrate:grades-attendance-v2:remote
```

On a brand-new database, `schema.sql` already has the real shape —
just run `npm run db:migrate:remote` as usual and skip the 000x
migration files entirely.

## Deploy

```bash
npm install
npx wrangler login

# Create the database, then paste the returned database_id into wrangler.toml
npx wrangler d1 create eduhaiti-db

# Apply the schema
npm run db:migrate:remote

# Import users from a Sheets CSV export (File → Download → CSV in the Users sheet)
npm run import:users -- ./users.csv > seed.sql
npm run db:seed:remote

# Deploy
npm run deploy
```

## Test it

```bash
curl "https://eduhaiti-api.<your-subdomain>.workers.dev/?action=ping"

curl "https://eduhaiti-api.<your-subdomain>.workers.dev/?action=attemptSheetLogin&identifier=you@school.ht&password=yourpass"
# → { "success": true, "status": "AUTHORIZED", "token": "..." }

curl "https://eduhaiti-api.<your-subdomain>.workers.dev/?action=getViewerInfo&token=<token from above>"
```

## Point the frontend at it (school.html)

In `SETTINGS_CONFIG_CACHE` (or `localStorage['edu_http_base_url']`), set:

```
SCRIPT_EXEC_URL = "https://eduhaiti-api.<your-subdomain>.workers.dev/"
```

`callApiHub_`'s Path B will pick it up automatically — no other frontend
change needed for the actions ported so far.

## Account-creation interface (replaces the Register Google Sheet)

Schools (and other org types — churches, businesses, hotels, savings
groups) now sign up through a real interface instead of Google Sheets +
`EduHaiti_create.txt`:

- `src/signupPage.js` — single-file HTML/JS/CSS page, served by this same
  Worker at `GET /signup` (no build step, no separate Pages deploy needed
  yet). Two tabs: "Créer un compte" (signup) and "J'ai déjà un compte"
  (activation lookup).
- `src/actions/accounts.js` — `registerAccount`, `fetchConfig`,
  `checkSubdomainAvailable`. These run **before** any school/tenant is
  resolved (`ACCOUNT_ACTIONS` in `src/index.js` routes them straight to
  `env.MASTER_DB`, skipping `resolveTenantFromRequest` entirely — a
  brand-new signup has no subdomain yet).
- `master-schema.sql` — a **separate** D1 database (`MASTER_DB` binding,
  never `DB`) holding just the `orgs` registry: one row per org, shared
  across every school this Worker or any other Meigens Tech Worker serves.
  This is the direct replacement for the `Register` sheet on
  `MASTER_AUTH_ID`.

What was ported from `EduHaiti_create.txt`, and what wasn't:

- `saveClientData()` → `registerAccount`: same generated fields
  (business ID, subdomain, reg token), same `_slugify_`/
  `_generateUniqueSubdomain_` shape (`src/lib/accounts.js`) — but
  **actually checked for uniqueness** this time. The original
  `generateBusinessId()` was flagged as collision-prone (`"MT" + random
  4-digit number`, no check against existing rows); `generateUniqueBusinessId`
  here checks every candidate against `orgs.business_id` and widens from
  4 → 5 → 6 digits after 50 failed attempts at each width, instead of
  trusting randomness.
- `handleApiRequest_`'s `fetchConfig` branch → `fetchConfig`: same
  email+PIN activation lookup, returns the same shape (`businessName`,
  `designJson`, `rulesJson`, `subdomain`, `regToken`) plus a ready-to-use
  `tenantAppUrl`.
- **Not ported**: the Mission Overseer satellite-management actions
  (`ensureMissionColumns_`'s full read/write surface — only the
  `is_mother`/`parent_org_id` columns exist so far), the signup welcome
  email, and `masterSetAccountStatus`/`masterChangeSubscriptionPlan` (the
  master admin dashboard's own activate/suspend/change-plan actions,
  which write to this same `orgs` table but belong with that dashboard's
  port, not the public signup surface).
- **New, no Sheets equivalent**: `checkSubdomainAvailable`, so the signup
  page can validate live instead of only finding out about a name
  collision after submitting.

Note this was ported from memory of `EduHaiti_create.txt`'s documented
behavior, not the file itself (not shared this session) — re-check
`src/actions/accounts.js` against the real file before trusting the exact
field names/validation rules for production cutover, same as any other
domain in this project.

**Verified**, not just written: `test/run-accounts-test.mjs` runs this
real code against a sqlite-backed D1 shim, asserting: invalid signups are
rejected, a valid signup gets a unique `MT#####` business ID and a
slugified (accent-stripped) subdomain, a duplicate email is rejected, a
name collision gets a `-2` suffix instead of an error, `fetchConfig`
rejects a wrong PIN/unknown email and accepts the right one, and a
suspended org is rejected even with the correct PIN. Run it yourself:

```bash
npm install
npm run test:accounts
```

Deploy:

```bash
npm run db:master:create
# paste the returned database_id into wrangler.toml's MASTER_DB block
npm run db:master:migrate:remote
npm run deploy
# then visit https://<your-worker>.workers.dev/signup
```

## Local development

## Permissions: action-based, not role-based (reviewed this session)

Confirmed against Code.gs: `Role` (Users.Role / `viewer.role`) is
display/organizational only. Every real access decision in Code.gs reads
`viewer.permissions` — a flat `{key: true/false}` map from
`Users.PermissionsJSON` — against a per-action policy list
(`ACTION_PERMISSIONS` in `src/lib/permissions.js`, a **verbatim** port of
Code.gs's `policy` object, ~150 actions, OR-semantics: any ONE held key
satisfies the requirement). A custom role like "Surveillant" can hold any
permission key; nothing ever branches on the Role string itself.

This was a real gap in the port so far — `schema.sql`'s `users` table had
no `permissions_json`/`is_teacher`/`assigned_subjects` columns at all, and
no ported action checked anything beyond "is there a valid session". Fixed
this session:

- `migrations/0007_users_permissions.sql` (and `schema.sql` directly, for
  new databases) — adds `permissions_json`, `is_teacher`,
  `assigned_subjects`, `is_master`, `is_god_mode`, plus the HR fields
  (`photo_url`, `pay_mode`, `pay_rate`, `pay_fixed_salary`, `phone`,
  `start_date`) from Code.gs's real `USERS_HEADERS`.
- `src/lib/permissions.js` — `ACTION_PERMISSIONS` (the full policy map),
  `checkActionPermission(viewer, action)` (verbatim port of the gating
  check: unknown action rejected, `isMaster`/`isGodMode` bypass, OR-list
  match), and `requiresStrictStudentScope(viewer)`
  (`STRICT_STUDENT_SCOPE_PERMISSION_KEYS_`, with the historical missing
  `pt_view_photo`/`pt_view_contact` bug already fixed, same as Code.gs's
  own comment describes).
- `src/actions/auth.js`'s `getViewerInfo` now returns `permissions`,
  `isTeacher`, `assignedSubjects`, `isMaster`, `isGodMode` — not just
  `role`.
- **Verified**: `test/run-permissions-test.mjs` — master/godmode bypass,
  a bare role with no matching key is rejected, OR-list matching, empty
  policy entries, strict-scope detection, the missing-keys bug staying
  fixed.

**Deliberately NOT done yet — `checkActionPermission` is not wired into
`apiHub.js`'s dispatch.** Turning it on requires reconciling this Worker's
action names against Code.gs's `ACTION_PERMISSIONS` keys first, and two
concrete mismatches are already confirmed by grep:

- Worker's `getStudentById` vs. Code.gs's policy key `'getStudent'`.
- Worker's `getAttendanceForStudent`/`getStudentAttendance` vs. Code.gs's
  policy key `'getAttendance'` (a different, admin-facing action in
  Code.gs — needs checking whether the Worker's per-student read should
  map to `'getAttendance'`'s requirement or needs its own policy entry).

Flipping the gate on today, as-is, would also break every existing
passing test (`test:students`, `test:grades-attendance`, `test:payments`,
etc.) — none of their fixtures set `permissions`/`isMaster` on the test
viewer, since no action checked those fields before now. Next step: walk
every already-ported action, resolve each name mismatch (rename the
Worker action, add a Code.gs-side alias, or add a missing policy entry —
case by case), update every test fixture's viewer to hold the right
permission key, THEN call `checkActionPermission` from `apiHub.js` before
the switch. Worth its own session rather than folding it into this one.

## Local development

```bash
npx wrangler d1 execute eduhaiti-db --local --file=./schema.sql
npx wrangler dev --local
```


## Migration status — Users / Permissions / Scope
- Added D1 Users CRUD actions: `getAllAdminUsers`, `updateUserRoleAndPerms`, `resetUserPassword`, `toggleGodMode`.
- Added server-side student scope enforcement based on the Code.gs `pt_*` strict-scope permission set.
- Teacher `teacher_assignments` rows are merged into effective class scope.
- Student, grade, attendance and payment reads/writes now reject out-of-scope student access.
- Run `npm test`-equivalent targeted tests: `npm run test:permissions` and `node test/run-access-scope-test.mjs`.


## Migration status — Payroll
- `calculateTeacherPayroll` ported: teacher assignments (`HOURLY`/`FIXED`) plus general staff Users pay configuration.
- `saveTeacherPaymentMode` ported for assignment or teacher scope.
- `processPayrollBatch` ported with overlapping-period duplicate protection.
- `getPayrollHistory` ported.
- D1 migration: `migrations/0010_payroll.sql`.
- Test: `npm run test:payroll`.


## Dernier avancement

- Payroll / paie: port réel D1 + tests.
- Alertes système/RH: `getSystemAlerts`, `confirmTeacherAlertStatus`, `notifyLateStaff` portés.
- Alertes portées: classes sans professeur, retards probables des enseignants, absences élèves du jour et absences récurrentes.
- `confirmTeacherAlertStatus` écrit les confirmations LATE/ABSENT dans `staff_attendance`.
- `notifyLateStaff` conserve validation + audit; l’envoi email reste à brancher sur un fournisseur Worker (MailChannels/Resend/etc.) car `MailApp` n’existe plus côté Cloudflare.

## Reports / Analytics — port 0015

Added `src/actions/reports.js`, preserving the Code.gs action contract for:
- `getImmersiveData`
- `getComplexReportData`
- `getUniversalAnalytics`
- `getClassComparisonData`
- `logReportGenerated`
- `getSubjectsByLevel`

The implementation uses D1 `students`, `grades`, `attendance`, `payments`, and `settings`, applies the existing student access-scope guard, and writes report-generation events to `audit_log`. No email dependency is introduced.

Test: `npm run test:reports`


## Online payments — real D1/R2 port (0017)

Ported the Code.gs `online_payment_requests` workflow:
- `submitOnlinePayment` creates a PENDING request in D1 and stores an optional proof file in R2 (`MEDIA_BUCKET`).
- `getMyOnlinePaymentRequests` returns the student's own request history.
- `getPendingOnlinePayments` returns the admin validation queue.
- `approveOnlinePayment` claims the request, records the real Finance payment, then marks the request APPROVED with reviewer and receipt.
- `rejectOnlinePayment` marks the request REJECTED and stores the review note without creating a Finance payment.
- `verifyPaymentByClientRequestId` now reads the D1 Finance table instead of scanning the Google Sheet/cache.

D1 migration: `migrations/0017_online_payment_requests.sql`.
Proof uploads use R2 instead of `uploadFileToSchoolDrive_`. The existing `/media/<key>` Worker route serves the resulting object.

Verified with `test/run-online-payments-test.mjs`: reference/proof validation, PENDING queue, approval-to-Finance, reviewer/receipt recording, verification miss, and rejection-without-finance-write all pass.

## D1 → R2 backups

The Worker now includes an infrastructure-level logical backup path in `src/actions/backup.js`. Each daily Cron run creates a gzip-compressed JSON snapshot containing SQLite table definitions and rows, stored under `backups/<ORG_ID>/...json.gz` in the dedicated `BACKUP_BUCKET` R2 binding. The existing Generated_IDs sync keeps its 10-minute Cron cadence; backups run only on the daily `17 2 * * *` Cron event.

Configure the dedicated R2 bucket in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "eduhaiti-backups"
```

Then deploy. The manual authenticated action `backupDatabaseToR2` requires `pa_save_settings` (or master/god mode). The Worker cannot execute `wrangler d1 export` from runtime, so this is a portable logical backup rather than a native D1 SQL dump.

## MonCash — paiement en ligne réel (0018)

Le Worker contient maintenant une intégration MonCash tenant-isolée :

- `createMonCashPayment`
- `getMonCashPaymentStatus`
- `getMonCashConfig`
- `saveMonCashConfig`
- `testMonCashConnection`
- route globale `/api/moncash/return`
- table D1 `moncash_payments`
- notification interne admin après confirmation
- idempotence Finance et transaction
- chiffrement AES-GCM des credentials dans `MONCASH_CONFIG_ENC`

Les credentials sont protégés par le Secret Worker `MONCASH_CREDENTIALS_KEY`.

La documentation frontend et deployment se trouve dans :

- `docs/MONCASH-FRONTEND.md`
- `docs/MONCASH-DEPLOYMENT.md`

### Limite actuelle de validation du montant

Le calcul serveur de ce module utilise le montant de scolarité global `TUITION_AMOUNT_GLOBAL` ou `TUITION_AMOUNT`, moins les paiements déjà enregistrés pour l'historique actif de l'élève. Le moteur complet de calendrier/frequency/penalty/overpayment de `recordNewPayment_` de Code.gs n'est pas encore entièrement porté. MonCash refuse donc la création si ce calcul serveur n'est pas disponible, au lieu de faire confiance au montant du frontend.

### Référence API MonCash

L'implémentation suit les endpoints documentés par MonCash pour OAuth, `CreatePayment`, `RetrieveTransactionPayment` et `RetrieveOrderPayment`. La documentation officielle disponible est ancienne et doit être revalidée avec MonCash/Digicel avant la production.

## 0019 — staff management hardening

- Completed Cloudflare/D1 actions for `getStaffList`, `getStaffManagementData`, `saveStaffAccess`, `toggleUserActiveState`, and `removeUserAccess`.
- Staff password updates now use bound SQL parameters instead of interpolating the password hash into SQL.
- Suspended users are rejected by the API permission resolver and `getViewerInfo` immediately, in addition to the existing session-side active check.
- Student history latest-row selection now uses SQLite `rowid` as a deterministic tie-breaker when multiple history writes share the same timestamp.
- Full local action test suite passes after these corrections.

## 0020 — audit dashboard, academic years, student field config

Closed three more gaps found while diffing `cases.txt` (the full list of
`apiHub` action names from the real `Code.gs`) against what's actually
registered in `src/actions/index.js` — 46 names were missing before this
pass, 42 after:

- **`src/actions/audit.js` (new)** — real port of `getGlobalAuditDashboard_`/
  `getAuditLogs`/`getAuditDiagnostics_`. Adapted, not line-for-line: the
  original read a Sheets-backed `AuditLog` tab written to by every
  permission check (including rejected/`ECHEC` attempts). That gate
  (`checkActionPermission`) *is* wired into `apiHub.js`'s dispatch already
  — an earlier section of this README called that "not done yet"; checked
  `src/lib/apiHub.js` directly, it's live for every action outside
  `UNPOLICED_ACTIONS`. But nothing currently writes a row for a *rejected*
  attempt, so this port reads the real D1 `audit_log` table instead (every
  write action already inserts into it via `writeAudit()`) and always
  reports `Status: 'REUSSITE'`. Full field-mapping table is in the file's
  header comment. `getAuditDiagnostics` stays unauthenticated, matching
  both the original's own "no permission required (safe: read-only)"
  comment and its real `ACTION_PERMISSIONS` policy entry (`[]`, open to
  any authenticated viewer) already present in `permissions.js`.
- **`getAvailableAcademicYears`** (`academic_year.js`) — ports
  `getAvailableAcademicYears_`'s "Zero Fallback" behavior (errors out if
  `ACADEMIC_YEAR` isn't set instead of guessing) against the real
  `settings` table and `academic_year_archives` — the same rows
  `rolloverAcademicYear` itself already writes, instead of a separate
  `Archives_Annuelles` Sheet.
- **`getStudentFieldsConfig`** (`students.js`) — ports the student
  form-customization config screen. The original discovered extra fields
  from the `students` Sheet's own header row; since D1 has fixed typed
  columns, this port discovers extra fields from `custom_fields` JSON keys
  actually in use across the org's students instead — same intent (surface
  fields the school has started using), real data, not a stub. Saved
  per-field overrides (label/required/enabled) now live in
  `settings.STUDENT_FIELDS_CONFIG` (JSON), replacing
  `PropertiesService.STUDENT_FORM_CONFIG`.

All three were already covered by real `ACTION_PERMISSIONS` policy entries
in `permissions.js` (`p_audit`/`p_settings`/`pa_save_settings` for the
audit pair, `p_grades` for academic years, the student-dossier keys for
field config) — nothing needed adding there.

Test: `npm run test:audit` (`test/run-audit-test.mjs`) — runs the new
actions both directly and through the real `apiHub()` dispatcher, so the
permission gate itself is exercised, not just the handler logic; covers
dashboard pagination/filtering, the `getAuditLogs` alias, the
unauthenticated diagnostics path, year-rollover interaction, and
discovered-vs-saved custom-field precedence (including that a saved
override can never unlock a locked system field).

**Still missing from `cases.txt`** (42 action names, was 46): the AI
chat/appreciation/token subsystem (`classifyAiIntent`, `processUserMessage`,
`getAiTokenStatus`, `generateStudentAiAppreciation`, etc. — no D1 tables
yet), exam quiz-builder extras (`addQuizQuestion`, `getQuizQuestions`,
`updateExamSettings`, `getAvailableExams`), comms providers (`sendSMSBulk`,
`testSMSConnection`, `sendStudentReportEmail`, `sendWhatsApp` — need a
Worker-side SMS/email/WhatsApp provider since `MailApp`/`GmailApp` don't
exist on Cloudflare), medical/internal-notes (`saveMedicalRecord`,
`saveDocumentSignature`, `addInternalNote`/`getInternalNotes` and their
`Student`-prefixed aliases), `addNewStudent`/`resetStudentPin`/
`lookupStudentGlobal` (student-lifecycle actions `students.js` doesn't
have yet, distinct from the ones already ported), bulletin-download gating
(`getStudentBulletinData`, `checkStudentBulletinDownloadAllowed`), and the
badge/School-ID-card subsystem (`getMySchoolId` — needs its own `school_ids`
D1 table + a port of `getSchoolIdsRecords_`, out of scope for this pass).

Same recipe each time: find the function(s) in
`Code_gs_background-sync__1_.txt`, check whether a D1 table already exists
or needs a new migration, port with real columns, write a
`test/run-*-test.mjs` against `d1shim.mjs`, wire into
`src/actions/index.js`, confirm the `ACTION_PERMISSIONS` entry exists (add
one if not), then document here.

## 0021 — student lifecycle (`addNewStudent`/`resetStudentPin`/
`lookupStudentGlobal`) + internal notes / medical / signatures

Closes two of the six gaps 0020 flagged as still missing:

- **`src/actions/students.js` additions** — `addNewStudent` (Code.gs
  ~line 8206, identity+history slice only), `resetStudentPin` (~line
  23790, clears the parent-portal `pin_hash`), `lookupStudentGlobal`
  (~line 8497, the `Generated_IDs` cross-check with legacy-ID-shape
  tolerance — `MT-XXXX` matches `MTXXXX` — and org scoping). `addNewStudent`
  is add-or-edit by `StudentCode`: resending the same code updates the
  existing row without blanking fields the caller omitted, same as the
  original form-submit behavior; a new code inserts the student plus one
  ACTIVE `student_history` row. Deliberately not ported (see the file's
  header): `SYSTEM_ID_MODE` identity-lock handling, and the
  `syncParentAccountForStudent_`/WhatsApp-credential-delivery side effect
  already flagged as unported back in the Generated_IDs sync section —
  `addNewStudent` here always returns `parentAccount: null` the same way.
- **`src/actions/notes.js` (new)** — the student-file annex, separate
  from the directory/lifecycle domain: `addInternalNote`/`getInternalNotes`
  (Code.gs ~8752/~8769) and their thin `Student`-prefixed aliases
  `addStudentInternalNote`/`getStudentInternalNotes` (~10307/~10294),
  `saveMedicalRecord` (~16020), `saveDocumentSignature` (~16043). Two new
  D1 tables — `internal_notes`, `document_signatures`
  (`migrations/0020_internal_notes_document_signatures.sql`) — with real
  columns matching Code.gs's own `SHEET_DEFS`/ad hoc sheet shape. Medical
  records get no new table, matching the original: `saveMedicalRecord_`
  never had one either, it merges a `medical` key into the student's
  CustomFields JSON, so this port merges into `students.custom_fields` the
  same way. A note with no `studentId` is recorded as a general/admin note
  rather than rejected, same as an empty `StudentID` cell in the original.
- Both additions go through `assertStudentAccess`/`loadViewer`
  (`src/lib/accessScope.js`) rather than Code.gs's own
  `ensureViewerCanAccessStudentScope_(auth, ...)` call — the same
  resolved-viewer substitution every other ported domain in this project
  already makes.
- `ACTION_PERMISSIONS` entries for all nine actions already existed in
  `permissions.js` (`pa_add_student`/`pa_edit_student` for the
  lifecycle trio, `pa_edit_student` plus a `p_dossier` OR-option for the
  notes domain) — nothing needed adding there.

Tests: `npm run test:student-lifecycle` (`test/run-student-lifecycle-test.mjs`)
and `npm run test:notes` (`test/run-notes-test.mjs`), both run for real
against `d1shim.mjs`; every other existing suite (27 files total) still
passes unmodified.

**Still missing from `cases.txt`: 33 action names (was 42)** —
`addNewStudent`/`resetStudentPin`/`lookupStudentGlobal` and the
medical/notes group are now off this list. What's left, grouped the same
way as before:

- **AI chat/appreciation/token subsystem** — `classifyAiIntent`,
  `processUserMessage`, `getAiTokenStatus`, `getDirectAiKey`,
  `checkAiQuota`, `recordAiDirectTokenUsage`, `resetAiTokenLog`,
  `setUserAiApiKey`, `getUserAiApiKeyStatus`, `verifyUserAiApiKey`,
  `generateStudentAiAppreciation`, `saveStudentAiAppreciation`,
  `getStudentAiAppreciation`, `translateMeigensText` — no D1 tables yet;
  biggest remaining group (13 actions), and needs a design decision on
  where the AI call itself happens (Worker-side fetch to an LLM API vs.
  keeping today's per-user-key model).
- **Exam quiz-builder extras** — `addQuizQuestion`, `getQuizQuestions`,
  `updateExamSettings`, `getAvailableExams`, plus `getMaternalCurriculumChecks`/
  `saveMaternalCurriculumCheck` — natural next add-on to the already-ported
  `exams.js`.
- **Comms providers** — `sendSMSBulk`, `testSMSConnection`,
  `sendStudentReportEmail`, `sendWhatsApp` — blocked on choosing a
  Worker-side SMS/email/WhatsApp provider, same open item `notifyLateStaff`
  already flagged (`MailApp`/`GmailApp` don't exist on Cloudflare).
- **Bulletin-download gating** — `getStudentBulletinData`,
  `checkStudentBulletinDownloadAllowed`.
- **Small settings/profile odds and ends** — `updateStudentPortalUrl`,
  `saveUserTheme`, `updateMyProfilePhoto`, `clearMeigensConfiguration`,
  `uploadLogoToDriveSecure`, `uploadPwaScreenshotToDriveSecure` (the last
  two need an R2-backed replacement for the Drive upload helper, same
  pattern `backup.js`/`media_homework.js` already use).
- **Badge/School-ID-card subsystem** — `getMySchoolId`, needs its own
  `school_ids` D1 table + a port of `getSchoolIdsRecords_`.

Recipe unchanged: find the function(s) in `Code.gs`, check whether a D1
table already exists or needs a new migration, port with real columns,
write a `test/run-*-test.mjs` against `d1shim.mjs`, wire into
`src/actions/index.js`, confirm the `ACTION_PERMISSIONS` entry exists,
then document here.

## 0022 — bulletin-download gating

Closes the smallest of the six 0021 groups: `getStudentBulletinData` and
`checkStudentBulletinDownloadAllowed`.

- **`src/actions/bulletin.js` (new)** — real ports of
  `getStudentBulletinData_` (Code.gs ~line 14588) and
  `checkStudentBulletinDownloadAllowed_` (~line 1188), plus their two
  private helpers `_evaluateStudentBulletinPaymentGate_` (~line 1144) and
  `_buildHomeworkBulletinLines_` (~line 14650). **No new D1 table or
  migration** — this domain has no state of its own; it composes three
  already-ported actions instead of re-querying D1 directly:
  `getImmersiveData` (reports.js) for name/photo/average/decision/
  subject breakdown, `getStudentFinanceProfile` (payments.js) for the
  due/paid/debt figures the payment gate reads, and
  `listStudentHomework` (media_homework.js) for the `SINGLE_SUBJECT_MODE`
  homework-as-bulletin-line rows.
- The payment gate (`SP_BULLETIN_PAYMENT_GATE`, off by default) and its
  `SP_BULLETIN_PAYMENT_SCOPE` ('DOWNLOAD' default / 'VIEW' / 'BOTH') and
  `SP_BULLETIN_PAYMENT_THRESHOLD_PCT` knobs are ported with the same
  "Zero Fallback" guarantees as the original: an unconfigured tuition
  amount, an unreadable settings row, or a `getStudentFinanceProfile`
  error all resolve to `allowed: true` rather than blocking on our own
  uncertainty. The gate only ever applies to a `role === 'STUDENT'`
  portal session viewing/downloading their own bulletin — staff, teacher,
  and admin sessions pulling up a student's bulletin on the student's
  behalf are never restricted by it, matching the original exactly.
- `readBooleanConfigValue_` and `_requireConfigMaxScore_`/
  `_getConfigMaxScore_` are ported verbatim (same TRUE/1/YES/ON/OUI and
  FALSE/0/NO/OFF/NON string handling, same four-key MAX_SCORE fallback
  chain and the same thrown "MAX_SCORE non configuré" error when nothing
  is set — caught the same way the original's own try/catch does, so a
  single-subject-mode build failure degrades to an empty scores array
  instead of breaking the whole bulletin).
- `ACTION_PERMISSIONS` entries for both actions already existed in
  `permissions.js` (the `p_grades`/`pt_view_bulletin`/`pa_generate_report`
  OR-list for the data fetch, the open `[]` — any authenticated viewer —
  entry for the preflight check) — nothing needed adding there.

Test: `npm run test:bulletin` (`test/run-bulletin-test.mjs`), run for real
against `d1shim.mjs` — covers the staff-always-unrestricted path, the
`pt_download_bulletin` permission gate, the payment-threshold gate at
both `SP_BULLETIN_PAYMENT_SCOPE` settings (proving DOWNLOAD-scoped gating
leaves `getStudentBulletinData`'s own VIEW untouched, and that widening
scope to VIEW then actually enforces it there), and single-subject-mode
homework-to-bulletin conversion with score normalization onto the
configured `MAX_SCORE`. Writing it surfaced a real access-scope subtlety
worth noting: giving a test admin viewer `pt_view_bulletin` or
`pt_edit_grades` — both members of `accessScope.js`'s `STRICT_SCOPE_KEYS`
— flips that viewer into the portal-restricted access model the same way
it would for a real teacher/portal account, correctly denying access to
a student with no assigned scope. The test's admin fixture now uses
`p_grades`/`pa_generate_report`/`pa_save_settings` instead, none of which
carry that scoping side effect. Every other existing suite (29 files)
still passes unmodified.

**Still missing from `cases.txt`: 31 action names** (was 33). What's
left, unchanged from 0021's grouping other than this one closing:

- AI chat/appreciation/token subsystem (13 actions — still the big one)
- Exam quiz-builder extras (`addQuizQuestion`, `getQuizQuestions`,
  `updateExamSettings`, `getAvailableExams`,
  `getMaternalCurriculumChecks`/`saveMaternalCurriculumCheck`)
- Comms providers (`sendSMSBulk`, `testSMSConnection`,
  `sendStudentReportEmail`, `sendWhatsApp`)
- Small settings/profile odds and ends (`updateStudentPortalUrl`,
  `saveUserTheme`, `updateMyProfilePhoto`, `clearMeigensConfiguration`,
  `uploadLogoToDriveSecure`, `uploadPwaScreenshotToDriveSecure`)
- Badge/School-ID-card subsystem (`getMySchoolId`)

Recipe unchanged: find the function(s) in `Code.gs`, check whether a D1
table already exists or needs a new migration, port with real columns,
write a `test/run-*-test.mjs` against `d1shim.mjs`, wire into
`src/actions/index.js`, confirm the `ACTION_PERMISSIONS` entry exists,
then document here.

## 0024 — communication + settings/profile/file uploads

This pass ports the remaining communication and settings/profile actions from `Code.gs` while keeping the existing frontend action names. Communication actions now include `sendSMSBulk`, `testSMSConnection`, `sendStudentReportEmail`, and `sendWhatsApp` (CallMeBot, UltraMsg, WATI, and 360dialog). `sendStudentReportEmail` uses the Worker `RESEND_API_KEY`/`FROM_EMAIL` configuration rather than Apps Script `MailApp`.

The settings/profile group now includes `updateStudentPortalUrl`, `saveUserTheme`, `updateMyProfilePhoto`, `clearMeigensConfiguration`, `uploadLogoToDriveSecure`, and `uploadPwaScreenshotToDriveSecure`. Register/Drive dependencies are replaced by tenant D1 settings and optional R2 `MEDIA_BUCKET`. Uploaded assets are served through the existing `/media/<key>` Worker route; set `PUBLIC_BASE_URL` if absolute asset URLs are required.

For email delivery, configure `RESEND_API_KEY` as a Worker secret and `FROM_EMAIL` as a verified sender. For logo/PWA uploads, enable the `MEDIA_BUCKET` R2 binding in `wrangler.toml`.

Validation: legacy communication/settings tests pass, existing communication/settings tests pass, and syntax checks pass for the modified action modules.

## 0023 — legacy quiz-builder + maternelle curriculum checklist

Closes the exam/grade-builder group that remained after 0022. Six Code.gs
actions are now implemented on D1:

- **`src/actions/exams.js`** — `addQuizQuestion`, `getQuizQuestions`,
  `updateExamSettings`, and `getAvailableExams`.
  - `addQuizQuestion` / `getQuizQuestions` preserve the legacy
    `Exam_Questions` contract and response shape (`text`, `options`,
    `correct`, `points`, `type`) while storing rows in the new D1
    `quiz_questions` table.
  - `updateExamSettings` preserves Code.gs's exact key convention:
    `EXAM_SETTINGS_<sanitized ExamTitle>`, stored in the existing D1
    `settings` table rather than creating a second configuration store.
  - `getAvailableExams` preserves the original behavior of deriving the
    available titles from distinct non-empty `grades.SubjectID` values.
- **`src/actions/grades.js`** — `getMaternalCurriculumChecks` and
  `saveMaternalCurriculumCheck`.
  - Uses a new D1 `maternal_curriculum_checks` table with one logical row per
    `(ClassKey, RowKey, Period)`.
  - Keeps T1–T6 validation and allows an empty `Mention` to mean an unchecked
    criterion, matching the original Sheet behavior.

No permission policy changes were necessary: the corresponding
`ACTION_PERMISSIONS` entries were already present in `permissions.js`.
The six actions are now registered through `src/actions/index.js` and are
therefore reachable through the real `apiHub()` dispatcher.

Migration:

- `migrations/0021_legacy_quiz_maternal.sql`
- Local: `npm run db:migrate:legacy-quiz-maternal:local`
- Remote: `npm run db:migrate:legacy-quiz-maternal:remote`

Test coverage:

- `test/run-legacy-quiz-maternal-test.mjs`
- `npm run test:legacy-quiz-maternal`
- Existing `test/run-exams-test.mjs` and `test/run-grades-attendance-test.mjs`
  also pass.
- Full local action test suite passes after this port.

Source verification: Code.gs's `addQuizQuestion_` still creates/uses the
`Exam_Questions` structure, while `getAvailableExams_` reads `grades`; the
maternelle actions read/write `maternal_curriculum_checks` and validate the
period as T1–T6. These contracts were used as the migration basis.

**Still missing from `cases.txt`: 10 action names.** The remaining groups are:

- **AI chat/appreciation/token subsystem** — all tracked AI actions are now
  ported through D1 and Worker secrets, including classification, proxy chat,
  quotas, encrypted user keys, direct-key lookup, translation fallback, and
  appreciation generation/storage.
- **Comms providers (4)** — `sendSMSBulk`, `testSMSConnection`,
  `sendStudentReportEmail`, `sendWhatsApp`; these require Worker-side
  provider integrations because Apps Script `MailApp`/`GmailApp` are not
  available on Cloudflare.
- **Settings/profile/file uploads (6)** — `updateStudentPortalUrl`,
  `saveUserTheme`, `updateMyProfilePhoto`, `clearMeigensConfiguration`,
  `uploadLogoToDriveSecure`, `uploadPwaScreenshotToDriveSecure`; the two
  upload actions need the R2-backed replacement for Drive.
- **School-ID card** — `getMySchoolId` is now ported through the D1
  `school_ids` table; the legacy Sheet-backed write/admin actions remain
  outside this pass.

## 0025 — School ID lookup

`getMySchoolId` now reads the tenant-scoped `school_ids` table and preserves
the legacy response shape (`found`, `schoolId`, `trackingNumber`, `className`,
`photoUrl`, `status`). Student access is checked through the existing scope
guard, and identifier matching tolerates punctuation differences such as
`MT-123` versus `MT123`.

Migration: `migrations/0023_school_ids.sql`.

Validation: `npm run test:school-ids`.

## 0026 — AI token quota

The quota actions now use the tenant-scoped `ai_token_usage` table instead of
the legacy `AI_Token_Log` sheet. Daily, monthly, and per-conversation limits
are read from `DAILY_TOKEN_LIMIT`, `MONTHLY_TOKEN_LIMIT`, and
`SESSION_TOKEN_LIMIT` settings. Usage is capped per request, scoped to the
authenticated user and tenant, and the admin reset is audited.

Migration: `migrations/0024_ai_token_usage.sql`.

Validation: `npm run test:ai-tokens`.

## 0027 — AI user provider configuration

`setUserAiApiKey`, `getUserAiApiKeyStatus`, and `verifyUserAiApiKey` now use
the tenant-scoped `ai_user_configs` table. Provider keys are encrypted with
AES-GCM using the Worker secret `AI_USER_CONFIG_KEY`; the status response never
returns the key. Verification performs the provider request only when the
explicit verify action is called.

Migration: `migrations/0025_ai_user_configs.sql`.

Validation: `npm run test:ai-config`.

## 0028 — AI appreciation storage

`saveStudentAiAppreciation` and `getStudentAiAppreciation` now use the
tenant-scoped `ai_appreciations` table. Records are keyed by student and
period, require the existing student access guard, preserve the `T1`-`T6`
contract, and cap edited text at 1200 characters.

Migration: `migrations/0026_ai_appreciations.sql`.

Validation: `npm run test:ai-appreciations`.

## 0029 — AI appreciation generation

`generateStudentAiAppreciation` now validates criteria and period, calls the
configured Anthropic Worker secret, normalizes the response to the legacy
short-text contract, and stores the generated result in `ai_appreciations`.
Duplicate generation for the same student and period is rejected.

Configuration: `npx wrangler secret put ANTHROPIC_API_KEY`.

Validation: `npm run test:ai-appreciation-generation`.

## 0030 — AI chat proxy and intent classification

`classifyAiIntent` now filters the supplied intent catalog by viewer
permissions and uses Anthropic only when multiple choices remain.
`processUserMessage` now validates the AI session, enforces the D1 quota,
calls Anthropic server-side, returns `reply`/`text`/`message` compatibility
fields, and records provider usage in `ai_token_usage`.

Validation: `npm run test:ai-classification` and `npm run test:ai-chat`.

## 0031 — AI conversation storage

`getAiChatConversation`, `getAiChatConversationList`, `resetAiChatConversation`,
`resetAiTokenSession`, and `getAiChatLibraryStatus` now use the tenant-scoped
`ai_chat_messages` D1 table. Conversation history and lists are isolated by
authenticated user and organization; resets create a fresh conversation ID.

Migration: `migrations/0027_ai_chat.sql`.

Validation: `npm run test:ai-conversations`.

## 0032 — AI persistence and PWA-only communication

`processUserMessage` now writes the current user message and the successful
assistant response to `ai_chat_messages`, while provider failures and quota
rejections leave no partial chat turn. The existing conversation list and
history actions therefore reflect real chat traffic instead of only seeded
rows.

Parent/admin communications use the Web Push queue exclusively: parent
messages target `staff` subscriptions and admin replies target `parent`
subscriptions. SMS and WhatsApp actions remain explicitly disabled; no SMS
or WhatsApp provider secret is required.

Validation: `npm run test:ai-chat` and `npm run test:communication`.

## 0033 — School ID administration

The School ID admin aliases `getSchoolIds`, `listSchoolIds`,
`getSchoolIdsRecords`, `upsertSchoolIdRecord`, `saveSchoolIdRecord`,
`appendSchoolIdRecord`, and `updateSchoolIdRecord` now use the tenant-scoped
`school_ids` table. Reads and writes require the existing dossier/settings
permissions, writes are audited, and matching preserves the legacy tolerant
code behavior (`MT-123` equals `MT123`).

Validation: `npm run test:school-ids-admin` and `npm run test:school-ids`.

## 0034 — PWA-only communication provider

Internal messages and report notifications now enqueue Web Push records for
the relevant `staff` or `parent` subscriptions. `sendStudentReportEmail`
keeps its legacy action name for frontend compatibility but no longer calls
Resend; it creates a PWA bulletin notification instead. SMS and WhatsApp
remain disabled and require no provider credentials.

Validation: `npm run test:communication`.

## 0035 — PWA voice messages

The parent communication composer now supports real browser audio capture via
`MediaRecorder`, in addition to speech-to-text dictation. Audio messages are
validated as supported audio data and capped at 1.5 MB before being stored with
the message and exposed through an HTML audio player. Push notifications still
carry only the text summary; the audio is available when the parent opens the
conversation.

Validation: `npm run test:communication`.

The next high-value block is the **AI subsystem**, but unlike the six actions
just ported it needs a deliberate storage/provider design before copying the
Code.gs behavior: AI conversation/token state and the actual model call need
an explicit Cloudflare-safe replacement rather than a superficial wrapper.

## Latest migration slice — profile photos to R2

`updateMyProfilePhoto` now follows the same file-storage direction as the
blueprint: when the tenant has an R2 `MEDIA_BUCKET`, a data-URL profile photo
is decoded, validated, stored under `profile-photos/<ORG_ID>/...`, and only
the resulting media URL is written to `users.photo_url`. The response keeps
the existing `photo` field and additionally reports `storage: "r2"`.

For staged/local deployments without `MEDIA_BUCKET`, the previous D1 URL
fallback remains available so the migration does not break existing profile
editing. R2 uploads are capped at 5 MiB and accept PNG/JPEG/WEBP/GIF.

Verified by `test/run-legacy-communication-settings-test.mjs`, including a
realistic R2 binding stub and database assertion that `users.photo_url` stores
the R2 URL rather than the image data.

## Offline-first canonical domain layer (0026)

The PWA now treats IndexedDB as the durable local source for promoted domain data. Offline reads for students, grades, payments, attendance, timetable, teachers and assignments use domain records when available. Offline mutations for student changes, grades, payments and attendance are converted to typed outbox entries with idempotency keys.

When connectivity returns, the open app posts the outbox to `syncPush` and pulls D1 deltas through `syncPull`. The Service Worker can perform the same typed push/pull while the PWA is closed when the browser grants Background Sync execution.

Service Worker Cache Storage remains shell/static-only; school data is kept in IndexedDB.

## Offline local-first policy v2 (0031)
- IndexedDB is the operational source of truth while offline.
- Local storage is quota-aware; no arbitrary offline-day or 25 MB/file cap is imposed by the application.
- `navigator.storage.persist()` is requested when supported to reduce eviction risk; browsers still control quotas and persistence.
- An optional school offline-expiration policy remains available, but it is separate from storage capacity.
- Other users see changes only after the offline device synchronizes with Cloudflare/D1/R2.
- Successful cloud operations reconcile IndexedDB so local data stays current.


## Local-first admin workspace v2 (0032)
- Added a live synchronization health panel: connectivity mode, pending domain changes, pending media, conflicts, last successful sync, storage usage, and last sync error.
- Added a conflict viewer that exposes local/server payload context without silently deleting or resolving conflicts.
- Sync failures are persisted in IndexedDB and surfaced for diagnosis.
- The local-first model remains device-scoped: offline changes are not visible to other users until they reach the cloud.
- No deployment or Cloudflare credential changes are performed by this package.


## Portable workspace v3 (0033)
- Portable folders now use `eduhaiti-offline/` with a manifest and separate JSON data files.
- Media blobs are stored individually under `eduhaiti-offline/media/` and indexed by `media-index.json`; they are no longer Base64-embedded into one giant JSON file.
- Import/export processes media one file at a time, reducing memory pressure for large photo/media collections.
- The previous `eduhaiti-offline.json` format remains readable as a migration path.
- Folder synchronization merges local/external metadata before rewriting the portable folder.

## Offline multi-device attendance collaboration (0034)
- Attendance IDs created offline are unique per device operation; they no longer depend only on `student + date`.
- Each offline attendance stores `deviceId` and `recordedAtLocal` in `meta_json`.
- The server treats `org + student + date` as the attendance business key during typed sync.
- If two devices submit the same student/day with the same status, the second operation is collapsed as a harmless duplicate.
- If two devices submit the same student/day with different statuses, the operation is returned as a conflict instead of creating a second attendance row.
- `updated_at` remains the server synchronization time; the original local event time is preserved separately.
- This prevents simultaneous offline scans at the same clock time from colliding merely because their timestamps match.


## Edge-first par site v1 (0035)
- Le Cloud reste l'autorité globale; l'Edge du site est un relais local optionnel.
- Le terminal reste Offline-first: IndexedDB enregistre d'abord, même si Edge et Internet sont indisponibles.
- Le client peut préférer l'Edge pour `syncPush`/`syncPull`, puis retombe automatiquement sur le Cloud.
- `edge/eduhaiti-edge.mjs` fournit un relais LAN minimal avec `/edge/health`, `/edge/config` et proxy `/api`.
- Activation par terminal: configurer l'URL de l'Edge dans le panneau « Edge-first du site ».
- Activation du site: lancer l'Edge sur un PC/serveur toujours allumé, définir `EDU_EDGE_SITE_ID`, `EDU_EDGE_ID`, `EDU_EDGE_CLOUD_URL`, puis exposer le port sur le LAN.
- En production, une PWA HTTPS doit utiliser une URL Edge HTTPS de confiance; une URL HTTP locale peut être bloquée par les règles de contenu mixte des navigateurs.
- Aucun identifiant administrateur, mot de passe ou clé secrète n'est écrit dans le code du client.

## Edge v2 — provisioning, auto-discovery et file locale persistante (0036)

Cette version renforce Edge-first sans changer la hiérarchie des autorités :
- **Cloudflare/D1 = autorité globale** ;
- **Edge = relais local du site + file persistante des `syncPush` idempotents** ;
- **terminal = IndexedDB/offline-first**.

### Comportement réseau

Un terminal peut perdre la connexion à l'Edge et continuer à travailler. Ses opérations restent dans son outbox IndexedDB.

Si le terminal atteint l'Edge mais que l'Internet du site est coupé, l'Edge accepte et conserve les lots `syncPush` dans `.eduhaiti-edge/sync-queue.json`, puis réessaie automatiquement vers le Cloud. Les opérations ne sont pas supprimées du terminal tant que le Cloud n'a pas confirmé `applied`/`already_applied`.

Les actions API legacy autres que `syncPush` ne sont pas mises en file par l'Edge : elles échouent normalement et le terminal applique son propre fallback/local-first. Cela évite de rejouer aveuglément une action non idempotente.

### Endpoints Edge

- `GET /edge/health` : état du site, Edge et file locale.
- `GET /edge/discovery` : identité et endpoints de provisioning/découverte.
- `GET /edge/config` : configuration publique non secrète.
- `GET /edge/queue` : supervision de la file locale.
- `GET /edge/sync-status?deviceId=...` : suivi des lots par terminal.
- `POST /api/?action=syncPush` : relais normal ou mise en file si le Cloud n'est pas joignable.

### Auto-discovery

Le frontend essaie d'abord `location.origin/edge/health`. Ainsi, si le PWA est servi directement par l'Edge, le terminal découvre automatiquement `siteId` et `edgeId`, sans IP codée en dur.

Lorsque le PWA est servi depuis Cloudflare Pages, le navigateur ne peut pas scanner arbitrairement le LAN/mDNS depuis une page web. Dans ce cas, l'URL Edge peut être provisionnée une fois (URL locale, QR code ou DNS interne). Une fois enregistrée, les reconnexions sont automatiques.

### Configuration Edge

Copier `edge/.env.example` et définir :

```text
EDU_EDGE_SITE_ID=MT1967
EDU_EDGE_ID=EDGE-MT1967-01
EDU_EDGE_CLOUD_URL=https://mt1967.eduflow.win/api
EDU_EDGE_HOST=0.0.0.0
EDU_EDGE_PORT=8787
EDU_EDGE_DATA_DIR=./.eduhaiti-edge
EDU_EDGE_RETRY_MS=15000
```

Puis lancer :

```bash
npm run edge:start
```

La configuration locale est persistante dans le dossier `EDU_EDGE_DATA_DIR`. Ne jamais mettre de mot de passe administrateur, clé API ou secret Cloud dans le frontend.

## Edge-first par site v3 (0037) — stockage local du site

0037 ajoute un **site store persistant** sur l'Edge (`.eduhaiti-edge/site-store.json`).

- Cloud reste l'autorité globale.
- Les terminaux restent Offline-first avec IndexedDB.
- L'Edge conserve les lignes reçues par `syncPull` et les opérations `syncPush` acceptées localement.
- `syncPull` essaie d'abord Cloud quand Internet est disponible, met à jour le site store, puis renvoie les données Cloud.
- Si Cloud est indisponible, `syncPull` peut répondre depuis le site store avec `stale:true`.
- Les opérations `syncPush` déjà mises en file sont immédiatement reflétées dans le site store pour permettre la continuité locale.
- La file persistante de 0036 continue de pousser vers Cloud automatiquement.
- `/edge/data-status` expose un état compact du store local.

### Limite volontaire de 0037

Le site store est d'abord utilisé par le protocole de synchronisation typé. Les anciennes actions API non typées continuent d'être proxifiées vers Cloud et ne sont pas rejouées aveuglément hors connexion. La prochaine étape peut étendre progressivement le store aux lectures métier afin de faire du LAN Edge un véritable réseau scolaire autonome sans Internet.


## Edge-first par site v4 (0038) — Edge Local API

0038 active la continuité LAN quand le terminal n'a plus Internet mais peut encore joindre l'Edge du site.

- `syncPush` peut être envoyé à l'Edge même lorsque `navigator.onLine === false`.
- Le terminal conserve toujours son IndexedDB/outbox comme sécurité locale.
- Si l'Edge est joignable, la modification est transmise immédiatement à sa file persistante/site store.
- `syncPull` peut être servi par le site store quand Cloud est indisponible.
- L'Edge continue de privilégier Cloud lorsqu'il est joignable et réconcilie ensuite son store local.
- Les anciennes actions métier non idempotentes ne sont toujours pas rejouées aveuglément.

### Scénario réel

```text
Professeur --LAN--> Edge --Internet--> Cloud
      |                 |
      |                 X Internet coupé
      |                 |
      +---- IndexedDB <-+
             +
             Edge store

Internet revient : Edge -> Cloud automatiquement
```

Cette version ne prétend pas encore transformer chaque ancien endpoint historique en API locale complète. Les domaines typés restent la voie sûre pour l'autonomie Edge.

## Edge Local API métier v1 — 0039

L'Edge expose maintenant `GET /edge/local-api` pour certaines lectures métier à partir de son site-store local : `getStudents`, `getGrades`, `getPayments`, `getAttendance`, `getStudentAttendance`, `getAttendanceForStudent`, `getTimetableData` et `getStaffAssignments`.

Ordre offline côté terminal : **IndexedDB du terminal → Edge local → Cloud**. L'Edge n'est donc pas l'autorité globale et ne remplace pas le stockage local du terminal. Les lectures Edge sont explicitement marquées `edgeServed:true` et `stale:true` afin que l'interface puisse signaler qu'il s'agit du dernier état connu du site.

L'API locale exige la présence d'un en-tête `Authorization`. La validation complète du jeton hors ligne au niveau Edge sera renforcée dans une phase ultérieure de cache d'identité/permissions ; ne pas exposer directement le port Edge à Internet.


## 0040 — Edge Identity & Permissions Offline

L’Edge conserve maintenant une **identité locale temporaire** pour les sessions déjà validées par le Cloud. Le bearer token n’est jamais écrit en clair : seule son empreinte SHA-256 est utilisée comme clé dans `identity-cache.json`.

- Le cache est alimenté automatiquement lorsqu’un `getViewerInfo` authentifié passe par l’Edge.
- `frontend-dist/edge-first.js` réchauffe ce cache périodiquement quand l’Edge est disponible et que le terminal possède déjà son token.
- `/edge/local-api` exige désormais une identité locale valide et applique les permissions métier avant de servir les données.
- `isMaster` / `isGodMode` conservent le bypass prévu par la politique Cloud.
- L’identité locale expire par défaut après 24 h (`EDU_EDGE_OFFLINE_SESSION_TTL_MS`), sans devenir une nouvelle autorité globale.
- Une session absente/expirée est refusée hors connexion : le terminal peut continuer avec son IndexedDB local si celui-ci possède les données et droits nécessaires.

Ordre de confiance : **Cloud → identité Edge mise en cache → API métier Edge → IndexedDB terminal pour ses propres données offline**. L’Edge ne doit pas être exposé directement à Internet.

Test : `npm run test:edge-identity`.

## Edge Media Offline v1 — 0042

La couche média suit désormais le même chemin local-first que les données métier : **IndexedDB terminal → Edge local → Cloud D1/R2**. L’Edge dispose d’une file média persistante (`media-queue.json`), d’un index (`media-index.json`) et d’un répertoire local `media/`. Les utilisateurs autorisés peuvent consulter les métadonnées locales via `/edge/media`, suivre la file via `/edge/media-status` et récupérer un fichier via `/edge/media/file?key=...`. Le transfert Cloud est rejoué automatiquement lorsque la connectivité revient. Le cache d’identité/permissions 0040 est requis pour les accès média offline.


## 0043 — Auto-Provisioning & Site Discovery

0043 ajoute un protocole de découverte/provisionnement local sans transformer le navigateur en scanner réseau arbitraire. L'Edge expose le manifeste standard `/.well-known/eduhaiti-edge` et `/edge/discovery`, contenant `siteId`, `edgeId`, URL détectée et capacités locales.

Le terminal peut découvrir automatiquement un Edge lorsque l'application PWA est servie par cet Edge (same-origin), ou utiliser une URL Edge fournie par l'administrateur. Pour un site Cloud-servi, le bouton **Provisionner** demande l'URL de l'Edge et un code de provisionnement configuré uniquement côté Edge (`EDU_EDGE_PROVISION_CODE`). Le code n'est jamais intégré au frontend.

Le provisionnement est donc : **découverte → validation du manifeste → code local → configuration persistante du terminal**. Il n'y a pas de scan IP silencieux ni de promesse de découverte LAN universelle depuis un navigateur.

Endpoints 0043 : `GET /.well-known/eduhaiti-edge`, `GET /edge/discovery`, `GET /edge/provision`, `POST /edge/provision`. Le POST exige `X-Eduhaiti-Provision-Code`.

Test : `npm run test:edge-provisioning`.

## Edge Supervision 0046

Le dashboard Edge expose maintenant une vue de supervision locale avec compteurs de terminaux, synchronisations et médias en attente. Un bouton **Synchroniser** permet à un administrateur autorisé de déclencher immédiatement le flush des files Edge vers Cloud. Les routes `/edge/overview` et `/edge/sync/flush` restent protégées par l'identité Edge et les permissions.

## EDGE-0047 — Centre des conflits

L’Edge conserve désormais un `conflicts.json` persistant et expose `/edge/conflicts` ainsi que `/edge/conflicts/resolve`. Le dashboard permet de comparer les données Cloud/locales et de choisir explicitement Cloud, local ou une résolution manuelle. Les résolutions local/manual sont soumises à Cloud avec la version serveur connue ; Cloud reste l’autorité finale. Une résolution Cloud permet de retirer proprement l’ancienne opération locale lorsqu’elle revient avec la même clé d’idempotence.

## Edge 0048 — Sauvegarde opérationnelle & récupération

L’Edge propose désormais un export/import JSON de son état opérationnel. Les caches d’identité et empreintes de tokens ne sont jamais exportés. Les fichiers binaires du dossier `media/` ne sont pas inclus dans le JSON.

Routes : `GET /edge/backup/export`, `POST /edge/backup/restore`.

## Edge Media Backup 0049

L'Edge dispose désormais d'une sauvegarde binaire dédiée aux médias locaux : `GET /edge/media-backup/export`, inspection préalable avec `POST /edge/media-backup/inspect`, puis restauration confirmée avec `POST /edge/media-backup/restore?confirm=true`. Les archives sont des `tar.gz` avec manifeste et fichiers médias. Les credentials ne sont jamais inclus. Limite configurable par `EDU_EDGE_MEDIA_BACKUP_MAX_BYTES` (512 MiB par défaut).

## Edge Health & Self-Healing — 0050

L'Edge surveille maintenant son stockage, ses files de synchronisation, ses médias et ses conflits. Un watchdog lance périodiquement des réparations limitées et sûres. Les administrateurs disposent des endpoints `/edge/health/details` et `/edge/self-heal` ainsi que du panneau de santé dans le dashboard.


## EDGE-0051 — Audit & Event Timeline

L’Edge expose `GET /edge/audit` pour consulter un historique administrateur local des synchronisations, terminaux, conflits, sauvegardes, réparations et erreurs. Les champs d’authentification sont systématiquement retirés de la réponse. Le dashboard Edge ajoute le bouton **Historique**.

## 0052 — Offline Production Hardening
Le relais Edge peut maintenant être durci pour la production : TLS natif, HTTPS obligatoire, allowlist CORS et exigence d'un terminal enregistré pour l'API métier locale. Voir `EDGE-0052-IMPLEMENTATION.md` et `edge/.env.example`.

## 0053 — Offline Production Readiness
- `getViewerInfo` disponible via Edge local.
- Contrôle d'identité + terminal enregistré appliqué aux lectures locales.
- Test de préparation : `npm run test:offline-readiness`.
- Les essais de coupure/rétablissement réseau et d'alimentation restent des essais terrain, pas des simulations Node.

## EDGE-0057 — Sécurité Offline complète

0057 renforce l'autorisation des opérations offline : session Edge valide et non expirée, isolation par `siteId`, contrôle du terminal enregistré/révoqué et permissions par domaine pour les `syncPush`. Les uploads média appliquent également le contrôle de terminal. `EDU_EDGE_REQUIRE_OFFLINE_AUTH` est activé par défaut.
