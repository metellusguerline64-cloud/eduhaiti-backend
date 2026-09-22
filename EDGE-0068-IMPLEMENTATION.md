# EDGE-0068 — Administration + Audit + Legacy utility batch

Batch migration of 10 remaining Code.gs actions:
- checkAndUpdateAccountStatus
- diagnoseSyncIssue
- runAuditMigration
- logAudit
- writeAuditLog
- writeAuditLog_
- purgeExpiredTokens
- getUnifiedDirectory
- getDownloadPageData

The GAS-only Sheets/PropertiesService/Drive behavior is replaced by D1-native operations. Audit writes use the existing audit_log writer. Session cleanup uses the existing D1 sessions table.

No administrator email, Drive ID, or secret is hardcoded.
