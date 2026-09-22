-- Migration 0019: adds `pin_hash` to `students`, needed by the real port
-- of resetStudentPin_ (see src/actions/students.js). NON-DESTRUCTIVE,
-- same convention as migration 0005 — students already holds real
-- ported data (Generated_IDs sync, the whole student directory) so this
-- is an additive ALTER, not a DROP/CREATE.
--
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0019_student_pin_hash.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0019_student_pin_hash.sql
--
-- On a brand-new database, schema.sql already has this column — this
-- migration is only needed if `students` was created before this port
-- landed. Code.gs's own resetStudentPin_ only ever clears this column
-- (sets it back to '' so the next parent-portal login re-collects a
-- PIN); nothing in this pass sets it, since PIN issuance itself belongs
-- to the parent-portal login flow, not ported here.

ALTER TABLE students ADD COLUMN pin_hash TEXT;
