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
