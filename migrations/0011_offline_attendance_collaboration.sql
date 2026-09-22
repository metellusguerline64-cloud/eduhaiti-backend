-- Offline multi-device attendance collaboration.
-- Do not add a UNIQUE(student_id,date) constraint: legacy data and special
-- attendance flows may contain historical duplicates. The typed sync layer
-- enforces the business key at synchronization time and distinguishes harmless
-- same-status duplicates from real status conflicts.
CREATE INDEX IF NOT EXISTS idx_attendance_org_student_date_updated
  ON attendance(org_id, student_id, date, updated_at);
