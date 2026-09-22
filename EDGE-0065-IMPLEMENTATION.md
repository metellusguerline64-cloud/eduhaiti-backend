# EDGE-0065 — Backup service access compatibility

Port of the legacy Code.gs `grantBackupServiceAccess` action.

In the Cloudflare architecture, Google Drive sharing does not exist. D1 backups are stored in the private R2 `BACKUP_BUCKET` binding. The legacy action name is retained for API compatibility, but it never grants Drive access, persists a service-account credential, or hardcodes an email/folder ID.

The action requires a valid session and backup permission and returns `accessMode: R2_PRIVATE_BINDING`.

Test: `test/run-backup-service-access-test.mjs` — PASS.
