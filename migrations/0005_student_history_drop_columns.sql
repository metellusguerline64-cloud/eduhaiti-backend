-- Migration 0005: adds `drop_reason` / `drop_date` to `student_history`,
-- needed by the real port of dropStudent_ / getStudentHistory_ (see
-- src/actions/students.js). Unlike migrations 0002-0004, this one is
-- NON-DESTRUCTIVE — student_history already holds real ported data
-- (Generated_IDs sync, grades/attendance/payments all read it) so it's
-- an additive ALTER, not a DROP/CREATE.
--
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0005_student_history_drop_columns.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0005_student_history_drop_columns.sql
--
-- On a brand-new database, schema.sql already has these columns — this
-- migration is only needed if student_history was created before this
-- port landed.

ALTER TABLE student_history ADD COLUMN drop_reason TEXT;
ALTER TABLE student_history ADD COLUMN drop_date TEXT;
