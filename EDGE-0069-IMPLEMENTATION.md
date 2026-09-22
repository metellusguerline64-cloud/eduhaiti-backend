# EDGE-0069 — First login / Staff PIN / AI configuration

Migrated 8 Code.gs actions into D1-native Worker adapters:
- loginWithIdAndPin
- setupStaffPin
- sendEmailVerification
- verifyEmailOTP
- ensureAiConfigurationLibrarySheets
- initAiConfigurationLibrary
- initAiMasterSheets
- forceInitAiMasterSheets

Infrastructure:
- migrations/0030_batch_0069_first_login_ai.sql
- D1 table `email_otps` for single-use 10-minute OTPs
- D1 table `ai_configuration_library` for tenant-scoped AI configuration datasets
- Email delivery uses `EMAIL_WEBHOOK_URL`; no provider credential is hardcoded.

Important: AI initialization ports the storage/initialization contract, but does not silently recreate Google Sheets seed content that is not represented in the current D1 schema. `sendEmailVerification` requires an explicit email webhook binding.
