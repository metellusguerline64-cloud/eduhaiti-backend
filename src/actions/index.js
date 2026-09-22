// This registry replaces apiHub's long if/else chain one action at a time.
// Phase 0 only ports the three actions needed to prove login end to end.
// Phase 1 adds the rest, grouped into files the same way: actions/students.js,
// actions/grades.js, etc., all imported and spread in here.

import { ping, attemptSheetLogin, forcePasswordUpdate, getViewerInfo } from "./auth.js";
import { syncPull, syncPush } from "./sync.js";
import { syncGeneratedIds } from "./students.js";
import {
  getAllStudents,
  getStudentById,
  searchStudents,
  getStudentHistory,
  updateStudent,
  enrollStudent,
  dropStudent,
  reEnrollStudent,
  updateStudentHistory,
  addNewStudent,
  resetStudentPin,
  lookupStudentGlobal,
} from "./students.js";
import { getGrades, getStudentScores, saveManualExamGrade, saveMaternalMentions, getExistingGrade, updateGradeSubjects, getMaternalCurriculumChecks, saveMaternalCurriculumCheck } from "./grades.js";
import {
  getAttendanceForStudent,
  getAttendance,
  getStaffAttendance,
  clockInStaff,
  getStudentAttendance,
  getAttendanceByDate,
  getAttendanceStats,
  getStudentAttendanceStats,
  recordAttendance,
  recordBulkAttendance,
  recordStudentAttendance,
  recordTransportAttendance,
} from "./attendance.js";
import { getStudentPayments, getPayments, getStudentFinanceProfile, getStudentFinanceSummary, recordNewPayment, voidPayment, editPayment, submitOnlinePayment, getMyOnlinePaymentRequests, getPendingOnlinePayments, approveOnlinePayment, rejectOnlinePayment, verifyPaymentByClientRequestId } from "./payments.js";
import { getMonCashConfig, saveMonCashConfig, testMonCashConnection, createMonCashPayment, getMonCashPaymentStatus } from "./moncash.js";
import {
  getStaffAssignments,
  saveStaffAssignment,
  deleteStaffAssignment,
  createSubject,
  deleteSubject,
} from "./teacher_assignments.js";
import { getTimetableData, saveTimetableData } from "./timetable.js";
import { registerAccount, fetchConfig, checkSubdomainAvailable } from "./accounts.js";
import { seedBadgeStudents } from "./badgeSeed.js";
import { getAllAdminUsers, getStaffList, getStaffManagementData, saveStaffAccess, updateUserRoleAndPerms, resetUserPassword, toggleGodMode, toggleUserActiveState, removeUserAccess } from "./users.js";
import { calculateTeacherPayroll, saveTeacherPaymentMode, processPayrollBatch, getPayrollHistory } from "./payroll.js";
import { getSystemAlerts, getNotifications, markNotificationRead, markAllNotificationsRead, confirmTeacherAlertStatus, notifyLateStaff } from "./alerts.js";
import { rolloverAcademicYear, getAcademicYearRolloverStatus, resetAcademicYearRollover } from "./academic_year.js";
import { saveExam, listExams, getExam, deleteExam, publishExam, listExamSubmissions, getExamSubmission, gradeExamSubmission, listStudentExams, startStudentExam, saveExamProgress, submitStudentExam, getStudentExamResult, addQuizQuestion, getQuizQuestions, updateExamSettings, getAvailableExams } from "./exams.js";
import { saveMedia, listMedia, deleteMedia, uploadMediaFile, listHomework, saveHomework, deleteHomework, gradeHomework, getHomeworkGrades, convertHomeworkToExam, listStudentHomework, getStudentHomeworkBulletin } from "./media_homework.js";
import { getDashboardLiveStats, getImmersiveData, getComplexReportData, getUniversalAnalytics, getClassComparisonData, logReportGenerated, generateFullStudentReport, generateReportDownloadUrl } from "./reports.js";
import { getSubjectsByLevel, getFullCurriculum, saveChunkedCurriculum } from "./curriculum.js";
import { getPromotionOverview, getPromotionDecision, processPromotionDecision, getStudentClassRank } from "./promotion.js";
import { issueCertificate, listCertificates, getCertificate, revokeCertificate, verifyCertificate, getCertificatePrintHtml } from "./certificates.js";
import { getSaaSSettings, getSettings, updateSaaSSettings, updateLocalSettings, getSettingsHealth, cleanupSettingsDuplicates } from "./settings.js";
import { updateStudentPortalUrl, saveUserTheme, updateMyProfilePhoto, clearMeigensConfiguration, uploadLogoToDriveSecure, uploadPwaScreenshotToDriveSecure } from "./legacy_settings_profile.js";
import { backupDatabaseToR2, grantBackupServiceAccess } from "./backup.js";
import { checkAndInitSheets, checkCacheHealth, clearAllSchoolCaches, warmSchoolCaches, ensureSchoolIdsSheet, initSchoolIdsSheet, initializeSheetHeaders, initSheets, createSaaSBackup, runGlobalBackupTask } from "./school_maintenance.js";
import { publishAnnouncement, getAnnouncementsForStudent, getAnnouncementsList, deleteAnnouncement, reportSecurityIncident, getStudentIncidents, getIncidentsForStudent, getIncidentsList, sendMessageToAdmin, getMyAdminMessages, getAdminMessagesInbox, replyToAdminMessage, setParentReplyPermission, sendInternalMessage, sendStudentReportEmail } from "./communications.js";
import { getGlobalAuditDashboard, getAuditLogs, getAuditDiagnostics } from "./audit.js";
import { getAvailableAcademicYears } from "./academic_year.js";
import { getStudentFieldsConfig } from "./students.js";
import {
  addInternalNote,
  getInternalNotes,
  getStudentInternalNotes,
  addStudentInternalNote,
  saveMedicalRecord,
  saveDocumentSignature,
} from "./notes.js";
import { getStudentBulletinData, checkStudentBulletinDownloadAllowed } from "./bulletin.js";
import { saveKioskWatchCodes, getKioskWatchCodes } from "./kiosk.js";
import { getPushConfig, registerPushSubscription, unregisterPushSubscription, listPushNotifications } from "./push.js";
import { parentPortalLogin, parentPortalLoginV2, setupParentPin, checkParentPhoneStatus, submitParentRegistrationRequest, getParentPendingRequests, resolveParentRequest, activateParentAccount, getParentChildren, getParentChildAttendance, getParentChildIncidents, getParentAnnouncements } from "./parents.js";
import { studentPortalLogin, setupInitialPin, getActiveEnrollment, getEnrollmentsByClass, verifyStudentByLast4 } from "./student_portal.js";
import { registerBulletinIssue, verifyBulletin } from "./bulletin_verification.js";
import { checkAndUpdateAccountStatus, diagnoseSyncIssue, runAuditMigration, logAudit, writeAuditLog, writeAuditLog_, purgeExpiredTokens, getUnifiedDirectory, getDownloadPageData } from "./legacy_batch_0068.js";
import { getMySchoolId, getSchoolIds, listSchoolIds, getSchoolIdsRecords, upsertSchoolIdRecord, saveSchoolIdRecord, appendSchoolIdRecord, updateSchoolIdRecord } from "./school_ids.js";
import { loginWithIdAndPin, setupStaffPin, sendEmailVerification, verifyEmailOTP, initAiConfigurationLibrary, ensureAiConfigurationLibrarySheets, initAiMasterSheets, forceInitAiMasterSheets } from "./legacy_batch_0069.js";
import { getAiConfigurationAssistanceContext, saveAiApiKeys } from "./legacy_batch_0070.js";
import { handleTemplateUpload } from "./template_upload.js";
import { getAiTokenStatus, checkAiQuota, recordAiDirectTokenUsage, resetAiTokenLog } from "./ai_tokens.js";
import { setUserAiApiKey, getUserAiApiKeyStatus, verifyUserAiApiKey } from "./ai_config.js";
import { generateStudentAiAppreciation, saveStudentAiAppreciation, getStudentAiAppreciation } from "./ai_appreciations.js";
import { getDirectAiKey, translateMeigensText } from "./ai_misc.js";
import { classifyAiIntent } from "./ai_classification.js";
import { processUserMessage } from "./ai_chat.js";
import { getAiChatConversation, getAiChatConversationList, resetAiChatConversation, resetAiTokenSession, getAiChatLibraryStatus } from "./ai_conversations.js";

export const actions = {
  ping,
  attemptSheetLogin,
  forcePasswordUpdate,
  getViewerInfo,
  // Account-creation interface (replaces EduHaiti_create.txt / the Register
  // Google Sheet). Runs against env.MASTER_DB, not a school's own DB — see
  // ACCOUNT_ACTIONS in src/index.js, which routes these before any
  // per-school tenant resolution happens (a brand-new signup has no
  // subdomain yet).
  registerAccount,
  fetchConfig,
  checkSubdomainAvailable,
  getPushConfig,
  parentPortalLogin, parentPortalLoginV2, setupParentPin, checkParentPhoneStatus, submitParentRegistrationRequest, getParentPendingRequests, resolveParentRequest, activateParentAccount, getParentChildren, getParentChildAttendance, getParentChildIncidents, getParentAnnouncements,
  studentPortalLogin, setupInitialPin, getActiveEnrollment, getEnrollmentsByClass, verifyStudentByLast4,
  registerBulletinIssue, verifyBulletin,
  loginWithIdAndPin, setupStaffPin, sendEmailVerification, verifyEmailOTP,
  initAiConfigurationLibrary, ensureAiConfigurationLibrarySheets, initAiMasterSheets, forceInitAiMasterSheets, getAiConfigurationAssistanceContext, saveAiApiKeys,
  handleTemplateUpload,
  registerPushSubscription,
  unregisterPushSubscription,
  listPushNotifications,
  getMySchoolId,
  getSchoolIds,
  listSchoolIds,
  getSchoolIdsRecords,
  upsertSchoolIdRecord,
  saveSchoolIdRecord,
  appendSchoolIdRecord,
  updateSchoolIdRecord,
  getAiTokenStatus,
  checkAiQuota,
  recordAiDirectTokenUsage,
  resetAiTokenLog,
  setUserAiApiKey,
  getUserAiApiKeyStatus,
  verifyUserAiApiKey,
  saveStudentAiAppreciation,
  getStudentAiAppreciation,
  generateStudentAiAppreciation,
  getDirectAiKey,
  translateMeigensText,
  classifyAiIntent,
  processUserMessage,
  getAiChatConversation,
  getAiChatConversationList,
  resetAiChatConversation,
  resetAiTokenSession,
  getAiChatLibraryStatus,
  // Offline outbox/delta sync. Promoted typed tables (students, grades,
  // attendance, payments, teacher_assignments, timetable) use real D1 columns;
  // generic tables keep the legacy fields JSON path.
  syncPull,
  syncPush,
  // Full port of Code.gs's Generated_IDs → students background sync
  // (src/lib/generatedIdsSync.js). Runs on a Cron Trigger by default
  // (see the `scheduled` export in src/index.js); this action is the
  // manual/admin trigger, same as calling _scheduleGeneratedIdsSync_
  // directly with force=true in Apps Script.
  syncGeneratedIds,
  // Badge-generation ingest (GAS -> Cloudflare): after Apps Script
  // generates a badge, it POSTs just the resulting student record here —
  // name, phone, class, Drive photo link — no image bytes, no Sheets
  // round-trip. See src/actions/badgeSeed.js for the auth model (shared
  // secret, not a session token).
  seedBadgeStudents,
  getAllAdminUsers,
  getStaffList, getStaffManagementData, saveStaffAccess, toggleUserActiveState, removeUserAccess,
  updateUserRoleAndPerms,
  resetUserPassword,
  toggleGodMode,
  calculateTeacherPayroll,
  saveTeacherPaymentMode,
  processPayrollBatch,
  getPayrollHistory,
  getSystemAlerts,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  confirmTeacherAlertStatus,
  notifyLateStaff,
  rolloverAcademicYear,
  getAcademicYearRolloverStatus,
  resetAcademicYearRollover,
  saveExam, listExams, getExam, deleteExam, publishExam, listExamSubmissions, getExamSubmission, gradeExamSubmission, listStudentExams, startStudentExam, saveExamProgress, submitStudentExam, getStudentExamResult, addQuizQuestion, getQuizQuestions, updateExamSettings, getAvailableExams,
  saveMedia, listMedia, deleteMedia, uploadMediaFile, listHomework, saveHomework, deleteHomework, gradeHomework, getHomeworkGrades, convertHomeworkToExam, listStudentHomework, getStudentHomeworkBulletin,
  getDashboardLiveStats, getImmersiveData, getComplexReportData, getUniversalAnalytics, getClassComparisonData, logReportGenerated, generateFullStudentReport, generateReportDownloadUrl, getSubjectsByLevel, getFullCurriculum, saveChunkedCurriculum,
  getPromotionOverview, getPromotionDecision, processPromotionDecision, getStudentClassRank,
  issueCertificate, listCertificates, getCertificate, revokeCertificate, verifyCertificate, getCertificatePrintHtml,
  getSaaSSettings, getSettings, updateSaaSSettings, updateLocalSettings, getSettingsHealth, cleanupSettingsDuplicates, updateStudentPortalUrl, saveUserTheme, updateMyProfilePhoto, clearMeigensConfiguration, uploadLogoToDriveSecure, uploadPwaScreenshotToDriveSecure, backupDatabaseToR2, grantBackupServiceAccess, checkAndInitSheets, checkCacheHealth, clearAllSchoolCaches, warmSchoolCaches, ensureSchoolIdsSheet, initSchoolIdsSheet, initializeSheetHeaders, initSheets, createSaaSBackup, runGlobalBackupTask, publishAnnouncement, getAnnouncementsForStudent, getAnnouncementsList, deleteAnnouncement, reportSecurityIncident, getStudentIncidents, getIncidentsForStudent, getIncidentsList, sendMessageToAdmin, getMyAdminMessages, getAdminMessagesInbox, replyToAdminMessage, setParentReplyPermission, sendInternalMessage, sendStudentReportEmail,
  // Real ports, verified against Code.gs (src/actions/grades.js /
  // attendance.js) — action names and 'grades'/'attendance' sheet
  // columns match Code.gs exactly. See each file's header comments for any
  // remaining intentional compatibility differences.
  getGrades,
  getStudentScores,
  getMaternalCurriculumChecks,
  saveMaternalCurriculumCheck,
  saveManualExamGrade,
  saveMaternalMentions,
  getExistingGrade,
  updateGradeSubjects,
  getAttendanceForStudent,
  getAttendance,
  getStaffAttendance,
  clockInStaff,
  getStudentAttendance,
  getAttendanceByDate,
  getAttendanceStats,
  getStudentAttendanceStats,
  recordAttendance,
  recordBulkAttendance,
  recordStudentAttendance,
  recordTransportAttendance,
  // Real port, verified against Code.gs (src/actions/payments.js) —
  // core receipt/idempotency/void/edit flow only. See that file's
  // header comment for what's deliberately not ported (tuition-schedule
  // due resolution, penalties, overpayment handling, online-payment
  // approval flow).
  getStudentPayments,
  getPayments,
  getStudentFinanceProfile,
  getStudentFinanceSummary,
  recordNewPayment,
  getMonCashConfig, saveMonCashConfig, testMonCashConnection, createMonCashPayment, getMonCashPaymentStatus,
  voidPayment,
  editPayment, submitOnlinePayment, getMyOnlinePaymentRequests, getPendingOnlinePayments, approveOnlinePayment, rejectOnlinePayment, verifyPaymentByClientRequestId,
  // Real port, verified against Code.gs (src/actions/students.js) —
  // student directory (list/get/search/history) + profile update +
  // enrollment lifecycle. See that file's header comment for what's
  // deliberately not ported (paid% enrichment, viewer/permission
  // scoping, SYSTEM_ID_MODE identity lock, NISU search).
  getAllStudents,
  getStudent: getStudentById,
  getStudentById,
  searchStudents,
  getStudentHistory,
  updateStudent,
  enrollStudent,
  dropStudent,
  reEnrollStudent,
  updateStudentHistory,
  // Real ports, verified against Code.gs (src/actions/students.js) —
  // addNewStudent (dossier add/edit + parent auto-provisioning), resetStudentPin
  // (parent-portal PIN clear), lookupStudentGlobal (Generated_IDs
  // cross-check with legacy-ID-shape tolerance and org scoping).
  addNewStudent,
  resetStudentPin,
  lookupStudentGlobal,
  // Real ports, verified against Code.gs (teacher_assignments.js / timetable.js)
  // — staff-affectation CRUD + class timetable get/save. Teacher assignment
  // responses are scope/redaction-aware and assignments sync the teacher's
  // Users AssignedSubjects scope. Payroll is now ported separately in payroll.js.
  getStaffAssignments,
  saveStaffAssignment,
  deleteStaffAssignment,
  createSubject,
  deleteSubject,
  getTimetableData,
  saveTimetableData,
  // Real ports, verified against Code.gs (src/actions/audit.js) — audit
  // dashboard/log listing read from the real D1 `audit_log` table every
  // write action already populates, plus an unauthenticated diagnostics
  // action. See audit.js's header comment for the Sheet->D1 field mapping
  // (no ECHEC/rejected-attempt rows exist yet — checkActionPermission
  // isn't wired into dispatch, same open item the README already flags).
  getGlobalAuditDashboard,
  getAuditLogs,
  getAuditDiagnostics,
  // Real port (src/actions/academic_year.js) — reads the same
  // settings.ACADEMIC_YEAR / academic_year_archives rows
  // rolloverAcademicYear itself writes, instead of a separate
  // 'Archives_Annuelles' Sheet.
  getAvailableAcademicYears,
  // Real port (src/actions/students.js) — field-customization config for
  // the student form, backed by settings.STUDENT_FIELDS_CONFIG +
  // students.custom_fields discovery instead of Sheet headers/PropertiesService.
  getStudentFieldsConfig,
  // Real ports, verified against Code.gs (src/actions/notes.js) — the
  // internal-notes annex (general or per-student) + their Student-
  // prefixed aliases, medical-record merge into custom_fields, and
  // document-signature capture. See notes.js's header for the full
  // Sheet->D1 mapping.
  addInternalNote,
  getInternalNotes,
  getStudentInternalNotes,
  addStudentInternalNote,
  saveMedicalRecord,
  saveDocumentSignature,
  // Real ports, verified against Code.gs (src/actions/bulletin.js) — the
  // bulletin-download-gating pair. Composes getImmersiveData/
  // getStudentFinanceProfile/listStudentHomework rather than re-querying
  // D1 directly; SP_BULLETIN_PAYMENT_GATE stays off by default, matching
  // the original's own "existing schools see no behavior change" note.
  getStudentBulletinData,
  checkStudentBulletinDownloadAllowed,
  saveKioskWatchCodes,
  getKioskWatchCodes,
  checkAndUpdateAccountStatus, diagnoseSyncIssue, runAuditMigration, logAudit, writeAuditLog, writeAuditLog_, purgeExpiredTokens, getUnifiedDirectory, getDownloadPageData,
};
