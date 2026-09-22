-- ============================================================
-- EduHaïti — D1 schema, Phase 0
-- Only auth-related tables for now. Every future domain table
-- (students, grades, attendance, payments...) follows the same
-- pattern: id (uuid) / updated_at / deleted_at / version, so the
-- Phase 3 sync engine can do delta pulls against any of them the
-- same way. See Section 3 of the migration blueprint.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,          -- uuid, stable forever (Sheets row numbers are not)
  user_id         TEXT,                      -- original "UserID" column from the Users sheet, if used for ID/PIN login
  email           TEXT,
  username        TEXT,
  name            TEXT NOT NULL DEFAULT '',
  password_hash   TEXT NOT NULL,             -- SHA-256 hex, same algorithm as hashPin_ in Code.gs
  role            TEXT,                      -- 'Role' — display/organizational only, see src/lib/permissions.js:
                                              -- access decisions never branch on this column, only on permissions_json
  permissions_json   TEXT NOT NULL DEFAULT '{}', -- 'PermissionsJSON' — {key: true/false}; the real access-control source
  is_teacher         INTEGER NOT NULL DEFAULT 0, -- 'IsTeacher'
  assigned_subjects  TEXT NOT NULL DEFAULT '{}', -- 'AssignedSubjects' — scope for STRICT_STUDENT_SCOPE_PERMISSION_KEYS holders
  photo_url          TEXT,                      -- 'PhotoURL'
  pay_mode           TEXT NOT NULL DEFAULT '',   -- 'PayMode' — 'HOURLY' | 'FIXED' | '' (never guessed)
  pay_rate           REAL NOT NULL DEFAULT 0,    -- 'PayRate'
  pay_fixed_salary   REAL NOT NULL DEFAULT 0,    -- 'PayFixedSalary'
  phone              TEXT,                       -- 'Phone'
  start_date         TEXT,                       -- 'StartDate'
  is_master       INTEGER NOT NULL DEFAULT 0,-- god-mode bypass, checked before ACTION_PERMISSIONS
  is_god_mode     INTEGER NOT NULL DEFAULT 0,-- toggled by 'toggleGodMode' (not yet ported)
  active          INTEGER NOT NULL DEFAULT 1,-- 1/0, mirrors the Sheet's Active column semantics
  reset_required  INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email    ON users(email)   WHERE email    IS NOT NULL AND email    != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id  ON users(user_id) WHERE user_id IS NOT NULL AND user_id != '';
CREATE INDEX IF NOT EXISTS idx_users_username         ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,              -- uuid, same role as the token Utilities.getUuid() produced
  user_id     TEXT NOT NULL,                 -- users.id
  email       TEXT,
  payload     TEXT NOT NULL,                 -- JSON, mirrors buildUserSessionPayload_'s shape
  expires_at  INTEGER NOT NULL,              -- epoch ms — no 6h CacheService ceiling here
  created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- Phase 3 groundwork — generic domain tables + sync plumbing.
--
-- We don't yet have Code.gs in hand to know the exact Sheet columns
-- for Students / Classes / Timetable / Grades / etc (see README "Known
-- gaps" — real field lists still need to come from the actual sheets).
-- So each domain table below carries the four sync columns every
-- table needs (id / version / updated_at / deleted_at) plus a single
-- `fields` JSON column holding whatever the Sheet row had. Once the
-- real Code.gs is available, promote frequently-queried keys out of
-- `fields` into real typed columns — the sync engine below doesn't
-- care either way, it only ever looks at the four sync columns.
--
-- UPDATE: `grades` and `attendance` (further down) have since been
-- promoted to real typed columns — see the ⚠️ UNVERIFIED GUESS block
-- above those two tables. `classes`, `teacher_assignments`,
-- `timetable`, `payments`, and `notifications` are still generic.
-- ============================================================

-- Real schema, ported from Code.gs's 'students' Sheet (see addNewStudent_ /
-- syncAssignedStudentsFromGeneratedIds_). Column names mirror the Sheet
-- headers exactly (StudentCode, LastName, ...) so mapping stays obvious
-- when reading the original alongside this file. Sync columns
-- (version/updated_at/deleted_at) are kept so this table can still join
-- the offline sync engine later — see "Known gap" note in sync.js.
CREATE TABLE IF NOT EXISTS students (
  id                 TEXT PRIMARY KEY,          -- uuid, our synthetic PK (Sheet had none — StudentCode is the natural key)
  student_code       TEXT NOT NULL,             -- 'StudentCode' — natural/business key, unique per org
  org_id             TEXT NOT NULL,             -- resolved via getOrgId_() in Code.gs; one Worker deployment = one org here
  last_name          TEXT,                      -- 'LastName'
  first_name         TEXT,                      -- 'FirstName'
  phone              TEXT,                      -- 'Phone'
  gender             TEXT,                      -- 'Gender'
  birth_date         TEXT,                      -- 'BirthDate'
  address             TEXT,                     -- 'Address'
  photo_url          TEXT,                      -- 'PhotoURL' — normalized via normalizePhotoUrl_
  current_level      TEXT,                      -- 'CurrentLevel'
  section            TEXT NOT NULL DEFAULT 'A', -- 'Section'
  enrollment_status  TEXT NOT NULL DEFAULT 'ACTIVE', -- 'EnrollmentStatus'
  active             INTEGER NOT NULL DEFAULT 1,     -- 'Active' (TRUE/FALSE in the Sheet)
  generated_source   TEXT,                      -- 'GeneratedSource' — e.g. 'Generated_IDs'
  generated_org_id   TEXT,                      -- 'GeneratedOrgId'
  custom_fields      TEXT NOT NULL DEFAULT '{}',-- 'CustomFields' — JSON, any formObj key with no matching column
  pin_hash           TEXT,                      -- 'PinHash' — parent-portal PIN; resetStudentPin_ clears this (see migrations/0019)
  created_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_code_org ON students(student_code, org_id);
CREATE INDEX IF NOT EXISTS idx_students_updated_at ON students(updated_at);

-- Port of the 'studenthistory' Sheet. One ACTIVE row per student per
-- school year; addNewStudent_ updates GradeLevelID in place when a
-- student's level changes instead of appending a new row for the same
-- year (see the `existActive` branch in syncAssignedStudentsFromGeneratedIds_).
CREATE TABLE IF NOT EXISTS student_history (
  id              TEXT PRIMARY KEY,       -- uuid, our synthetic PK
  history_id      TEXT NOT NULL,          -- 'HistoryID' — 'HIS-' + 8 hex chars in Code.gs
  student_id      TEXT NOT NULL,          -- 'StudentID' — students.student_code, not students.id
  org_id          TEXT NOT NULL,
  school_year     TEXT NOT NULL,          -- 'SchoolYear'
  grade_level_id  TEXT,                   -- 'GradeLevelID'
  section         TEXT NOT NULL DEFAULT 'A',
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- 'Status' — ACTIVE | DROPPED | ALUMNI
  drop_reason     TEXT,                   -- 'DropReason' — set by dropStudent_/dropStudent
  drop_date       TEXT,                   -- 'DropDate'
  updated_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_student_history_student_year ON student_history(student_id, school_year);
CREATE INDEX IF NOT EXISTS idx_student_history_active ON student_history(student_id, status);

-- Port of PropertiesService-backed org config (SYSTEM_ID_MODE,
-- ACADEMIC_YEAR, etc — read from the 'Settings' Sheet / Register in
-- Code.gs). One Worker deployment = one org/school, so no org_id
-- column is needed here (unlike student_history, which can, in
-- principle, span a shared multi-org Master spreadsheet).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Port of the CacheService throttle stamp in _scheduleGeneratedIdsSync_
-- ("run at most once every 10 minutes"). One row per stamp key; D1 has
-- no native TTL so expiry is checked on read, same as loadSessionToken.
CREATE TABLE IF NOT EXISTS sync_stamps (
  key         TEXT PRIMARY KEY,
  value       TEXT,               -- JSON, e.g. { imported, updated, at } from the last run
  expires_at  INTEGER NOT NULL    -- epoch ms
);

CREATE TABLE IF NOT EXISTS classes (
  id          TEXT PRIMARY KEY,
  fields      TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_classes_updated_at ON classes(updated_at);

-- teacher_assignments / timetable — REAL port, verified against Code.gs's
-- ensureTeacherAssignmentsSheetStructure_/ensureTimetableSheetStructure_
-- and getStaffAssignments_/saveStaffAssignment_/deleteStaffAssignment_/
-- getTimetableData_/saveTimetableData_ (Code.gs was in context for this
-- pass — see src/actions/teacher_assignments.js and
-- src/actions/timetable.js for exact line references and what was
-- payroll computation is now ported in src/actions/payroll.js).
--
-- Column names mirror the real Sheet headers 1:1, same standard
-- students/grades/attendance/payments were held to. `org_id`, `version`,
-- and `deleted_at` are the only additions beyond the real Sheet columns.
--
-- Promoted out of the generic `fields` JSON table (and out of
-- SYNC_TABLES in src/lib/sync.js) — each now has its own dedicated
-- write path with its own version-based upsert, instead of going
-- through the generic syncPush.
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id             TEXT PRIMARY KEY,          -- 'AssignmentID' — 'AFC-' + 8 hex chars, same as Code.gs
  org_id         TEXT NOT NULL,             -- addition, see grades/attendance/payments above
  teacher_name   TEXT NOT NULL,             -- 'TeacherName'
  teacher_id     TEXT,                      -- 'TeacherID' — email/userId when linked, else a copy of TeacherName
  class_name     TEXT NOT NULL,             -- 'ClassName'
  class_id       TEXT,                      -- 'ClassID'
  subject        TEXT,                      -- 'Subject'
  day            TEXT,                      -- 'Day'
  start_time     TEXT,                      -- 'StartTime' — 'HH:MM'
  end_time       TEXT,                      -- 'EndTime' — 'HH:MM'
  hours          REAL NOT NULL DEFAULT 0,   -- 'Hours'
  rate           REAL NOT NULL DEFAULT 0,   -- 'Rate'
  salary         REAL NOT NULL DEFAULT 0,   -- 'Salary'
  payment_mode   TEXT NOT NULL DEFAULT '',  -- 'PaymentMode' — 'HOURLY' | 'FIXED' | '' (never guessed)
  has_conflict   INTEGER NOT NULL DEFAULT 0,-- 'HasConflict'
  active         INTEGER NOT NULL DEFAULT 1,-- 'Active' — soft delete, same as the Sheet's TRUE/FALSE convention
  created_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'CreatedAt'
  version        INTEGER NOT NULL DEFAULT 1,-- addition, same optimistic-concurrency convention as grades/payments
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'UpdatedAt'
  deleted_at     TEXT,                      -- addition, for sync-engine tombstones
  meta_json      TEXT NOT NULL DEFAULT '{}' -- 'MetaJSON'
);
-- Mirrors the (teacher, className, subject, day, start) composite match
-- saveStaffAssignment_ does by hand before deciding update-vs-insert.
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_composite
  ON teacher_assignments(org_id, teacher_name, class_name, subject, day, start_time);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_updated_at ON teacher_assignments(updated_at);

CREATE TABLE IF NOT EXISTS timetable (
  id          TEXT PRIMARY KEY,          -- 'SlotID' — 'TT-' + 8 hex chars, same as Code.gs
  org_id      TEXT NOT NULL,             -- addition, see teacher_assignments above
  class_name  TEXT,                      -- 'ClassName'
  day_index   INTEGER NOT NULL DEFAULT 0,-- 'DayIndex'
  day_label   TEXT,                      -- 'DayLabel'
  start_time  TEXT,                      -- 'StartTime' — 'HH:MM'
  end_time    TEXT,                      -- 'EndTime' — 'HH:MM'
  subject     TEXT,                      -- 'Subject'
  teacher     TEXT,                      -- 'Teacher'
  teacher_id  TEXT,                      -- 'TeacherID'
  conflict    INTEGER NOT NULL DEFAULT 0,-- 'Conflict'
  active      INTEGER NOT NULL DEFAULT 1,-- 'Active' — soft delete
  created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'CreatedAt'
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'UpdatedAt'
  deleted_at  TEXT,                      -- addition, for sync-engine tombstones — see saveTimetableData's
                                          -- "replace semantics" note in src/actions/timetable.js
  meta_json   TEXT NOT NULL DEFAULT '{}' -- 'MetaJSON'
);
CREATE INDEX IF NOT EXISTS idx_timetable_org_day ON timetable(org_id, day_index);
CREATE INDEX IF NOT EXISTS idx_timetable_updated_at ON timetable(updated_at);

-- ============================================================
-- grades / attendance — REAL port, verified against Code.gs's
-- SHEET_DEFS + saveManualExamGrade_ / getGrades_ / recordAttendance_ /
-- recordBulkAttendance_ / getAttendanceForStudent_ (Code.gs was in
-- context for this pass — see src/actions/grades.js and
-- src/actions/attendance.js for exact line references and the list of
-- pieces deliberately left out of this port).
--
-- Column names below mirror the real Sheet headers 1:1 (GradeID,
-- HistoryID, StudentID, ... / RecordID, HistoryID, StudentID, ...),
-- same standard `students` was held to. `org_id` and `deleted_at` are
-- the only additions beyond the real Sheet columns — Code.gs has one
-- spreadsheet per school so it never needed an org column, and Sheets
-- rows are never soft-deleted the way D1 rows need to be for the sync
-- engine's tombstone convention.
--
-- Payments is NOT promoted here and stays on the generic `fields`
-- JSON table further down — no port attempted for it yet.
-- ============================================================

-- Port of the 'grades' Sheet. Code.gs stores ONE row per
-- (StudentID, SubjectID[, HistoryID]) and merges every period's score
-- into that row's ScoresJSON (e.g. {"T1":15,"T2":12}) — see
-- saveManualExamGrade_. Score/Mention/PeriodID on the row itself just
-- reflect whichever period was written most recently; getGrades_
-- expands ScoresJSON back into one entry per graded period at read
-- time (ported in src/actions/grades.js).
CREATE TABLE IF NOT EXISTS grades (
  id               TEXT PRIMARY KEY,          -- 'GradeID' — 'GRD-' + 8 hex chars, same as Code.gs
  history_id       TEXT,                      -- 'HistoryID'
  student_id       TEXT NOT NULL,             -- 'StudentID' — students.student_code
  org_id           TEXT NOT NULL,             -- addition: one Worker = one org, not in the original Sheet
  grade_level_id   TEXT,                      -- 'GradeLevelID'
  subject_id       TEXT NOT NULL,             -- 'SubjectID'
  period_id        TEXT,                      -- 'PeriodID' — last period written; ScoresJSON is the source of truth
  score            REAL,                      -- 'Score' — last period written; null for a mention-only row
  mention          TEXT,                      -- 'Mention' — maternelle mentions (Excellent/Bien/...), not numeric
  teacher_id       TEXT,                      -- 'TeacherID'
  scores_json      TEXT NOT NULL DEFAULT '{}',-- 'ScoresJSON' — {"T1": 15, "T2": "Excellent", ...}
  created_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'Timestamp'
  version          INTEGER NOT NULL DEFAULT 1,-- addition, for the same optimistic-concurrency rule STRICT_TABLES used
  updated_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'UpdatedAt'
  deleted_at       TEXT                       -- addition, for soft-delete/tombstones
);
-- Mirrors the (StudentID, SubjectID, HistoryID) match saveManualExamGrade_
-- does by hand before deciding update-vs-insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_student_subject_history
  ON grades(org_id, student_id, subject_id, IFNULL(history_id, ''));
CREATE INDEX IF NOT EXISTS idx_grades_updated_at ON grades(updated_at);

-- Port of the 'attendance' Sheet.
CREATE TABLE IF NOT EXISTS attendance (
  id             TEXT PRIMARY KEY,            -- 'RecordID' — 'ATT-' + 8 hex chars, same as Code.gs
  history_id     TEXT,                        -- 'HistoryID'
  student_id     TEXT NOT NULL,               -- 'StudentID'
  org_id         TEXT NOT NULL,               -- addition, see grades above
  grade_level_id TEXT,                        -- 'GradeLevelID'
  date           TEXT NOT NULL,               -- 'Date' — 'YYYY-MM-DD'
  status         TEXT NOT NULL DEFAULT 'PRESENT', -- 'Status' — PRESENT | ABSENT | RETARD/LATE | SORTIE
  recorded_by    TEXT,                        -- 'RecordedBy' — email, or 'KIOSK'
  meta_json      TEXT NOT NULL DEFAULT '{}',  -- 'MetaJSON' — {"method":"KIOSK","mode":"IN","time":"08:03:00"}
  version        INTEGER NOT NULL DEFAULT 1,  -- addition
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT                         -- addition
);
CREATE INDEX IF NOT EXISTS idx_attendance_student_org_date ON attendance(student_id, org_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_updated_at ON attendance(updated_at);

-- staff_attendance — admin-confirmed staff status records. Self clock-in/out
-- remains in attendance with grade_level_id='STAFF', matching Code.gs.
CREATE TABLE IF NOT EXISTS staff_attendance (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  email          TEXT NOT NULL,
  name           TEXT,
  status         TEXT NOT NULL,
  late_minutes   INTEGER NOT NULL DEFAULT 0,
  class_name     TEXT,
  confirmed_by   TEXT,
  timestamp      TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_org_email_date ON staff_attendance(org_id,email,timestamp);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_updated_at ON staff_attendance(updated_at);

-- payments — REAL port, verified against Code.gs's 'Finance' Sheet
-- (SHEET_DEFS) and recordNewPayment_ / voidPayment_ / editPayment_ /
-- getStudentPayments_. Column names mirror the Finance sheet's row
-- layout 1:1 (ReceiptID, HistoryID, StudentID, StudentName,
-- Description, Amount, Cashier, Status, Notes, Date, Reference,
-- ClientRequestID). `org_id`, `version`, and `deleted_at` are the only
-- additions beyond the real Sheet columns, same convention as
-- grades/attendance above. Promoted out of the generic `fields` JSON
-- table (and out of SYNC_TABLES/STRICT_TABLES in src/lib/sync.js) —
-- see src/actions/payments.js for exactly what was and wasn't ported
-- from recordNewPayment_'s much larger tuition-schedule/penalty logic.
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,          -- 'ReceiptID' — 'REC-' + 10 hex chars, same as Code.gs
  org_id             TEXT NOT NULL,              -- addition, see grades/attendance above
  history_id         TEXT,                       -- 'HistoryID'
  student_id         TEXT NOT NULL,              -- 'StudentID'
  student_name       TEXT,                       -- 'StudentName'
  description        TEXT,                       -- 'Description' (a.k.a. designation)
  amount             REAL NOT NULL,              -- 'Amount' — the amount actually recorded (finalAmt)
  cashier_email      TEXT,                       -- 'Cashier' — always an email in the original, never a display name
  status             TEXT NOT NULL DEFAULT 'PAID', -- 'Status' — PAID | PARTIAL | VOID
  notes              TEXT,                       -- 'Notes' — free text, void/edit audit notes get appended here too
  payment_date       TEXT,                       -- 'Date'
  reference          TEXT,                       -- 'Reference' — cheque/transfer number, etc.
  client_request_id  TEXT,                       -- 'ClientRequestID' — idempotency key for retried submissions
  created_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
-- Mirrors _findPaymentByClientRequestId_'s dedup scope (per org; the
-- original scoped by spreadsheet, one Worker = one org here).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_client_request_id
  ON payments(org_id, client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id != '';
CREATE INDEX IF NOT EXISTS idx_payments_student_org ON payments(student_id, org_id);
CREATE INDEX IF NOT EXISTS idx_payments_updated_at ON payments(updated_at);
-- Online payment requests — port of Code.gs `online_payment_requests`.
CREATE TABLE IF NOT EXISTS online_payment_requests (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, student_id TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '', history_id TEXT, grade_level_id TEXT,
  amount REAL NOT NULL, method TEXT NOT NULL DEFAULT 'MonCash', reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING', submitted_at TEXT NOT NULL,
  reviewed_by TEXT, reviewed_by_name TEXT, reviewed_at TEXT, review_note TEXT, receipt_id TEXT,
  proof_file_url TEXT, proof_file_name TEXT, proof_file_id TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_online_payment_requests_student ON online_payment_requests(org_id, student_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_online_payment_requests_pending ON online_payment_requests(org_id, status, submitted_at);


CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  fields      TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_updated_at ON notifications(updated_at);

-- Web Push subscriptions. One parent may have several devices; endpoint is
-- unique per school so subscriptions can never cross tenant databases.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'parent',
  owner_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(org_id, endpoint) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner
  ON push_subscriptions(org_id, owner_type, owner_id, active);

CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'parent',
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT,
  error TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_notifications_owner
  ON push_notifications(org_id, owner_type, owner_id, status, created_at);

-- Idempotency ledger for the outbox batch-ingest endpoint (Section 4,
-- "Server ingest"): each client-generated idempotency_key is recorded
-- once, so a retried batch (flaky connectivity, service worker retry)
-- never double-applies a write.
CREATE TABLE IF NOT EXISTS sync_applied_ops (
  idempotency_key TEXT PRIMARY KEY,
  table_name      TEXT NOT NULL,
  row_id          TEXT NOT NULL,
  applied_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Audit log (Phase 2, "cheap in D1, was awkward in Sheets") — who
-- changed what, from which device, starting now so it's already in
-- place once grades/attendance/payments get ported for real.
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  user_id     TEXT,
  device_id   TEXT,
  op          TEXT NOT NULL,               -- 'insert' | 'update' | 'delete' | 'permission_denied'
  diff        TEXT,                        -- JSON, best-effort before/after
  created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
  ,permission TEXT
  ,status     TEXT NOT NULL DEFAULT 'REUSSITE'
);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_row ON audit_log(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_status_permission ON audit_log(status, permission);


-- Payroll (promoted from migration 0010 for fresh databases).
-- EduHaïti — Payroll port from Code.gs Payroll sheet.
CREATE TABLE IF NOT EXISTS payroll (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  date              TEXT NOT NULL,
  mois              TEXT,
  collaborateur     TEXT NOT NULL,
  salaire_base      REAL NOT NULL DEFAULT 0,
  retenues          REAL NOT NULL DEFAULT 0,
  salaire_net       REAL NOT NULL DEFAULT 0,
  statut            TEXT NOT NULL DEFAULT 'PAYE',
  traite_par        TEXT,
  collaborateur_id  TEXT,
  periode_debut     TEXT,
  periode_fin       TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_org_date ON payroll(org_id,date);
CREATE INDEX IF NOT EXISTS idx_payroll_org_collaborator ON payroll(org_id,collaborateur_id);
CREATE INDEX IF NOT EXISTS idx_payroll_updated_at ON payroll(updated_at);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id, read_at);

CREATE TABLE IF NOT EXISTS academic_year_archives (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  year TEXT NOT NULL,
  next_year TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by TEXT,
  snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_academic_year_archives_org_closed ON academic_year_archives(org_id,closed_at DESC);

-- Exam Builder / Runner / Grading — port of Exams + Exam_Submissions sheets.
CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, subject TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', cycle TEXT, classes_csv TEXT, students_csv TEXT, settings_json TEXT NOT NULL DEFAULT '{}', questions_json TEXT NOT NULL DEFAULT '[]', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_exams_org_updated ON exams(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_exams_org_status ON exams(org_id,status);
CREATE TABLE IF NOT EXISTS exam_submissions (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, exam_id TEXT NOT NULL, student_id TEXT NOT NULL, student_name TEXT, attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, submitted_at TEXT, status TEXT NOT NULL DEFAULT 'IN_PROGRESS', answers_json TEXT NOT NULL DEFAULT '[]', grades_json TEXT NOT NULL DEFAULT '{}', auto_score REAL, manual_score REAL, score REAL, max_score REAL, feedback TEXT, updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_exam_sub_org_exam ON exam_submissions(org_id,exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_sub_org_student ON exam_submissions(org_id,student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_sub_attempt ON exam_submissions(org_id,exam_id,student_id,attempt);

-- Media Library + Homework — port of Media_Library, Homeworks, Homework_Grades.
CREATE TABLE IF NOT EXISTS media_library (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT, type TEXT NOT NULL DEFAULT 'DOC', source TEXT NOT NULL DEFAULT 'URL', url TEXT, file_id TEXT, mime TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, thumbnail TEXT, cycle TEXT, level TEXT, classes_csv TEXT, subject TEXT, description TEXT, tags_csv TEXT, uploaded_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_org_updated ON media_library(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_media_org_type ON media_library(org_id,type);
CREATE TABLE IF NOT EXISTS homeworks (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, subject TEXT, subject_branch TEXT, period TEXT, cycle TEXT, classes_csv TEXT, description TEXT, due_date TEXT, max_score REAL NOT NULL, weight REAL NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_homeworks_org_updated ON homeworks(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_homeworks_org_due ON homeworks(org_id,due_date);
CREATE TABLE IF NOT EXISTS homework_grades (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, student_name TEXT, class_name TEXT, score REAL NOT NULL DEFAULT 0, max_score REAL NOT NULL DEFAULT 0, comment TEXT, submitted_at TEXT, graded_by TEXT, graded_at TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hw_grade_student ON homework_grades(org_id,homework_id,student_id);
CREATE INDEX IF NOT EXISTS idx_hw_grades_org_hw ON homework_grades(org_id,homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_grades_org_student ON homework_grades(org_id,student_id);

-- MonCash online payment transactions. See migrations/0018_moncash.sql.
CREATE TABLE IF NOT EXISTS moncash_payments (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, student_id TEXT NOT NULL, user_id TEXT,
  amount REAL NOT NULL, amount_due REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'HTG',
  payment_type TEXT NOT NULL DEFAULT 'TUITION', description TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL, moncash_transaction_id TEXT, moncash_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  paid_at TEXT, raw_response TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_moncash_order ON moncash_payments(org_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_moncash_transaction ON moncash_payments(org_id, moncash_transaction_id) WHERE moncash_transaction_id IS NOT NULL AND moncash_transaction_id != '';
CREATE INDEX IF NOT EXISTS idx_moncash_student ON moncash_payments(org_id, student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moncash_status ON moncash_payments(org_id, status, updated_at);

-- Port of the 'internal_notes' Sheet (addInternalNote_/getInternalNotes_
-- and their Student-prefixed aliases). A NULL student_id is a general/
-- admin note not tied to one student — same as an empty StudentID cell
-- in the original.
CREATE TABLE IF NOT EXISTS internal_notes (
  id            TEXT PRIMARY KEY,
  note_id       TEXT NOT NULL,             -- 'NoteID' — 'NOTE-' + 8 hex chars
  org_id        TEXT NOT NULL,
  student_id    TEXT,                      -- 'StudentID'
  content       TEXT NOT NULL DEFAULT '',  -- 'Content'
  author        TEXT,                      -- 'Author' — viewer.email
  author_role   TEXT,                      -- 'AuthorRole' — viewer.role
  meta_json     TEXT NOT NULL DEFAULT '{}',-- 'MetaJSON' — {visibility, historyId}
  created_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_internal_notes_student ON internal_notes(org_id, student_id);

-- Port of the ad hoc 'document_signatures' Sheet saveDocumentSignature_
-- lazily creates on first use in Code.gs (SignatureID/StudentID/
-- DocumentType/SignatureData/SignedAt/SignedBy) — a real table from the
-- start here, same columns.
CREATE TABLE IF NOT EXISTS document_signatures (
  id             TEXT PRIMARY KEY,
  signature_id   TEXT NOT NULL,               -- 'SignatureID' — 'SIG-' + 8 hex chars
  org_id         TEXT NOT NULL,
  student_id     TEXT,                        -- 'StudentID'
  document_type  TEXT NOT NULL DEFAULT 'General', -- 'DocumentType'
  signature_data TEXT NOT NULL DEFAULT '',    -- 'SignatureData'
  signed_by      TEXT,                        -- 'SignedBy' — viewer.email
  signed_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), -- 'SignedAt'
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_signatures_student ON document_signatures(org_id, student_id);
