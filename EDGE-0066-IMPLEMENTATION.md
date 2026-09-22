# EDGE-0066 — Kiosk + Attendance

Ported the two remaining Code.gs kiosk-watch actions:
- saveKioskWatchCodes
- getKioskWatchCodes

Legacy `Settings!KIOSK_WATCH_CODES` is now backed by D1 `settings`.
No Google Sheets/Drive dependency and no hardcoded administrator identity.

Attendance was already ported in `src/actions/attendance.js`; 0066 verifies the
kiosk-facing attendance functions are registered alongside the new watch-code
actions. The existing multi-device attendance sync/conflict rules remain the
source of truth.

Migration: `migrations/0030_kiosk_watch_codes.sql`
Test: `npm run test:kiosk-attendance`
