// Full port of Code.gs's action-permission policy — the actual gate that
// runs on every apiHub() call, right after auth and before the ACTION
// SWITCH (Code.gs lines ~6776-7104 of the uploaded background-sync file).
//
// THE POINT OF THIS FILE (flagged during review): permission in this app
// was NEVER role-based. `viewer.role` (Code.gs's Users.Role column) is
// display/organizational only — every real access decision reads
// `viewer.permissions` (Users.PermissionsJSON, a flat {key: true/false}
// map) against the ACTION_PERMISSIONS list below. A custom role like
// "Surveillant" or "Assistant pédagogique" can hold any permission key;
// nothing here ever branches on the Role string. This is exactly what was
// missing from the Cloudflare port so far — schema.sql's `users` table
// had no permissions_json/is_teacher/assigned_subjects columns at all
// (see migrations/0007_users_permissions.sql), and no action file checked
// anything beyond "is there a valid session".
//
// STRICT_STUDENT_SCOPE_PERMISSION_KEYS_: portal-level ("pt_*") permissions
// that put a viewer into class/student "strict scope" mode — they can
// only see the class(es)/student(s) assigned to them, never the whole
// school — regardless of Role. Code.gs's own comment flags a past bug:
// this list was missing 'pt_view_photo'/'pt_view_contact' in one copy of
// it while the frontend's copy had them, so a viewer holding only one of
// those two fell through every strict-scope check as if scopeless. Ported
// with the fix already applied (both keys included).
export const STRICT_STUDENT_SCOPE_PERMISSION_KEYS_ = [
  "pt_view_class_list",
  "pt_view_student_profile",
  "pt_view_history",
  "pt_view_photo",
  "pt_view_contact",
  "pt_mark_attendance",
  "pt_view_attendance",
  "pt_enter_grades",
  "pt_edit_grades",
  "pt_view_bulletin",
  "pt_view_class_perf",
  "pt_view_ranking",
];
// Friendly alias (no trailing underscore) for callers outside this file —
// the underscored name above is kept because the policy map below
// references it verbatim via .concat(), same as Code.gs.
export const STRICT_STUDENT_SCOPE_PERMISSION_KEYS = STRICT_STUDENT_SCOPE_PERMISSION_KEYS_;

// Verbatim port of the `policy` object from Code.gs (action name -> ''
// | 'permKey' | ['permKey', ...]). '' or [] means "any authenticated
// viewer, no specific permission required" (still requires a valid
// session — see checkActionPermission below). Copied straight from the
// source file including its own inline comments (the FIX/PATCH notes
// explain real bugs Code.gs already found and fixed in this exact
// mapping — worth keeping so the history isn't lost). A couple of keys
// ('getAiChatConversation', 'resetAiChatConversation', 'resetAiTokenSession')
// are defined twice in the original with the same value both times —
// kept as-is for fidelity; JS objects just keep the last one, so there's
// no behavior difference.
export const ACTION_PERMISSIONS = {
      'getViewerInfo':                   '',
      'getSaaSSettings':                 '',
      'getSettings':                     '',
      'updateSaaSSettings':              'pa_save_settings',
      'getSettingsHealth':               'p_settings',
      'cleanupSettingsDuplicates':        'pa_save_settings',
      'backupDatabaseToR2':               'pa_save_settings',
      'updateStudentPortalUrl':            'pa_save_settings',
      'updateLocalSettings':             'pa_save_settings',
      'saveAiApiKeys':                   'pa_save_settings',
      'uploadLogoToDriveSecure':         'pa_save_settings',
      'uploadPwaScreenshotToDriveSecure':'pa_save_settings',
      'clearMeigensConfiguration':       'pa_save_settings',
      'saveUserTheme':                   '',
      'getTimetableData':                ['p_staff','pa_teacher_affectation','p_settings'],
      'saveTimetableData':               'pa_teacher_affectation',
      'updateMyProfilePhoto':            '',
      'getSubjectsByLevel':              '',
      'getFullCurriculum':               '',
      'saveChunkedCurriculum':           'pa_save_settings',
      'getAllAdminUsers':                 ['p_staff','pa_manage_users','pa_add_staff'],
      'getStaffList':                    ['p_staff','pa_manage_users','pa_add_staff','pa_teacher_affectation'],
      'saveStaffAccess':                 'pa_manage_users',
      'updateUserRoleAndPerms':          'pa_manage_users',
      'getStaffManagementData':          ['p_staff','pa_manage_users','pa_add_staff'],
      'toggleUserActiveState':           'pa_manage_users',
      'removeUserAccess':                'pa_manage_users',
      'resetUserPassword':               'pa_manage_users',
      'toggleGodMode':                   'pa_manage_users',
      'getStaffAttendance':              'p_hr_attendance',
      'clockInStaff':                    'p_hr_attendance',
      // FIX: these four all required a "view" permission (p_dossier /
      // pt_view_class_list / pt_view_student_profile) with NO alternate path
      // for a viewer who only holds an "entry" permission — pt_mark_attendance,
      // pt_enter_grades, pt_edit_grades, etc. But you cannot mark attendance or
      // enter a grade for a class without first being able to load that
      // class's roster: the roster fetch is a PREREQUISITE of the entry
      // action, not an unrelated privilege. A viewer granted only
      // pt_mark_attendance (say) was passing the write-action's own gate but
      // failing here just to see who to mark attendance for — the assigned
      // class loaded (once the earlier scope-loading fix landed) but its
      // students never did. Now any STRICT_STUDENT_SCOPE_PERMISSION_KEYS_
      // holder can read the roster; getAllStudents_/searchStudents_/etc.
      // still scope the result to that viewer's assigned class/students via
      // filterStudentsByViewerScope_ — this only fixes the read GATE, not
      // the scoping, which was already correct.
      'getAllStudents':                   ['p_dossier','pa_add_student','pa_edit_student'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'getStudent':                      ['p_dossier','pa_edit_student'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'addNewStudent':                   'pa_add_student',
      'updateStudent':                   'pa_edit_student',
      'resetStudentPin':                 'pa_edit_student',
      'lookupStudentGlobal':             ['p_dossier','pa_add_student','pa_edit_student'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'searchStudents':                  ['p_dossier','pa_add_student','pa_edit_student'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'getStudentFieldsConfig':          ['p_dossier','pa_add_student','pa_edit_student'],
      'getStudentHistory':               ['p_dossier','p_history','pa_edit_student','pt_view_history','pt_view_student_profile'],
      'getAvailableAcademicYears':       'p_grades',
      'saveMedicalRecord':               'pa_edit_student',
      'saveDocumentSignature':           'pa_edit_student',
      'addInternalNote':                 'pa_edit_student',
      'getInternalNotes':                ['p_dossier','pa_edit_student'],
      'addStudentInternalNote':          'pa_edit_student',
      'getStudentInternalNotes':         ['p_dossier','pa_edit_student'],
      'getStudentAttendance':            ['p_attendance','pt_view_attendance','pt_mark_attendance'],
      'getStudentPayments':              ['p_finance','pa_record_payment'],
      'getPayments':                     ['p_finance','pa_record_payment'],
      'verifyPaymentByClientRequestId':  ['p_finance','pa_record_payment'],
      'getMonCashConfig':                 ['p_settings','pa_save_settings'],
      'saveMonCashConfig':                ['p_settings','pa_save_settings'],
      'testMonCashConnection':            ['p_settings','pa_save_settings'],
      'createMonCashPayment':             [],
      'getMonCashPaymentStatus':          [],
      'approveOnlinePayment':            'p_approve_payments',
      'rejectOnlinePayment':             'p_approve_payments',
      'getPendingOnlinePayments':        'p_approve_payments',
      'submitOnlinePayment':             [],
      'getMyOnlinePaymentRequests':      [],
      'recordNewPayment':                'pa_record_payment',
      // Void/edit are deliberately gated behind p_approve_payments — a
      // higher-trust permission than the ordinary cashier pa_record_payment
      // — since these mutate/cancel money already recorded, not just record new money.
      'voidPayment':                     'p_approve_payments',
      'editPayment':                     'p_approve_payments',
      'getStudentFinanceProfile':        ['p_finance','pa_record_payment'],
      'getStudentFinanceSummary':         ['p_finance','pa_record_payment'],
      'processPayrollBatch':             ['p_finance','p_payroll'],
      'calculateTeacherPayroll':         ['p_finance','p_payroll','pa_teacher_affectation'],
      'saveTeacherPaymentMode':          ['p_finance','p_payroll','pa_teacher_affectation'],
      'getPayrollHistory':                ['p_finance','p_payroll'],
      'getDashboardLiveStats':           '',
      'recordBulkAttendance':            ['p_attendance','pt_mark_attendance'],
      'getAttendanceStats':              ['p_attendance','pt_view_attendance','pt_mark_attendance'],
      'getAttendance':                   ['p_attendance','pt_view_attendance','pt_mark_attendance'],
      'getAttendanceByDate':             ['p_attendance','pt_view_attendance','pt_mark_attendance'],
      'recordStudentAttendance':         ['p_attendance','pt_mark_attendance'],
      'recordTransportAttendance':       'p_attendance',
      'getStudentAttendanceStats':       ['p_attendance','pt_view_attendance','pt_mark_attendance'],
      'generateFullStudentReport':       ['pa_generate_report','p_grades','pt_view_bulletin','pt_export_data'],
      // Bulletin fetch is used by the bulletin button preflight. If this stays
      // p_grades-only, users with bulletin view permission see the button but fail at runtime.
      'getStudentBulletinData':          ['p_grades','pt_view_bulletin','pa_generate_report'],
      // Student-portal preflight check before the "Télécharger" button
      // actually renders/downloads a PDF — gates on pt_download_bulletin +
      // the payment condition, but only for the student's own self-view
      // session (see checkStudentBulletinDownloadAllowed_). Staff/admin
      // sessions always pass through, so no broad permission requirement
      // here — same "any authenticated viewer" pattern as
      // getStudentHomeworkBulletin.
      'checkStudentBulletinDownloadAllowed': [],
      // FIX: was 'p_grades' only (an admin-wide grades permission), so a
      // viewer holding only pt_enter_grades/pt_edit_grades — the portal
      // permission that's supposed to let them enter grades for their own
      // assigned class — could submit grades via saveManualExamGrade-style
      // actions but could never load the gradebook/table to enter them into
      // in the first place. Same "entry implies read of your own scope"
      // fix as getAllStudents/getStudent/etc. above.
      'getGrades':                       ['p_grades'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'getStudentScores':                'p_grades',
      // FIX: was 'p_manual' only. Every "Enseignant" role's default permission
      // set enables pt_enter_grades/pt_edit_grades but never p_manual (that
      // key lives only in the admin-only permission group and isn't even
      // rendered as a toggle when editing a teacher-mode account — see
      // teacherSchema in the client). Net effect: any teacher-portal account
      // could open the grade-entry modal (gated by p_manual OR
      // pt_enter_grades OR pt_edit_grades — see grades view gate) and fill it
      // in, but every save silently failed here with "Permission [P_MANUAL]
      // manquante" because this policy never accepted the portal keys as an
      // alternative. pt_enter_grades/pt_edit_grades now satisfy this action
      // directly, matching the pattern already used for getGrades and others.
      'saveManualExamGrade':             ['p_manual','pt_enter_grades','pt_edit_grades'],
      // Same bug, same fix — this is the maternelle-mentions equivalent of
      // saveManualExamGrade_ (see its own doc comment above the function).
      'saveMaternalMentions':            ['p_manual','pt_enter_grades','pt_edit_grades'],
      'generateStudentAiAppreciation':   ['p_manual','pt_enter_grades','pt_edit_grades'],
      'saveStudentAiAppreciation':       ['p_manual','pt_enter_grades','pt_edit_grades'],
      'getStudentAiAppreciation':        ['p_grades','p_manual','pt_enter_grades','pt_edit_grades','pt_view_bulletin'],
      // Class-wide "curriculum" checklist (renderMaternalCurriculumTable_ on
      // the frontend) — same permission set as the per-student mentions
      // above: reading it is part of grade entry, saving it needs the same
      // grade-entry rights, not a stricter admin-only one.
      'getMaternalCurriculumChecks':      ['p_grades','p_manual','pt_enter_grades','pt_edit_grades'],
      'saveMaternalCurriculumCheck':      ['p_manual','pt_enter_grades','pt_edit_grades'],
      'getAvailableExams':               'p_review',
      'getExistingGrade':                'p_review',
      'updateGradeSubjects':             'pa_save_settings',
      'addQuizQuestion':                 'p_manual',
      'getQuizQuestions':                'p_review',
      'updateExamSettings':              'pa_save_settings',
      'classifyAiIntent':                'p_use_ai',
      'processUserMessage':              'p_use_ai',
      'setUserAiApiKey':                 'p_use_ai',
      'getUserAiApiKeyStatus':           'p_use_ai',
      'verifyUserAiApiKey':              'p_use_ai',
      // FIX: these five are fully implemented in the ACTION SWITCH below
      // (getAiTokenStatus_, getDirectAiKey_, checkAiQuota_,
      // recordAiDirectTokenUsage_, resetAiTokenLog_ all exist and are
      // dispatched) but were never added to this whitelist — every request
      // for them was rejected here with "Action non reconnue" before ever
      // reaching the switch. This is what produced the red "Budget IA
      // quotidien" error banner ("Action non reconnue: getAiTokenStatus")
      // on load, since the chat UI calls getAiTokenStatus first to render
      // that bar. Same p_use_ai gate as the other AI actions above.
      'getAiTokenStatus':                'p_use_ai',
      'getDirectAiKey':                  'p_use_ai',
      'checkAiQuota':                    'p_use_ai',
      'recordAiDirectTokenUsage':        'p_use_ai',
      'resetAiTokenLog':                 'p_use_ai',
      'getAiChatConversation':           'p_use_ai',
      'resetAiChatConversation':         'p_use_ai',
      'resetAiTokenSession':             'p_use_ai',
      'getAiChatLibraryStatus':          'p_use_ai',
      'translateMeigensText':            '',
      'getPromotionOverview':            ['p_audit','pa_promote_student'],
      'getPromotionDecision':            ['p_audit','pa_promote_student'],
      'processPromotionDecision':        'pa_promote_student',
      'getGlobalAuditDashboard':         ['p_audit','p_settings','pa_save_settings'],
      'getAuditLogs':                    ['p_audit','p_settings','pa_save_settings'],
      'getAuditDiagnostics':             [],
      // ── Exam Builder / Runner / Grading ───────────────────────────────────
      // NOTE: access to this feature is intentionally gated by exam/build
      // permissions (pt_build_exam, p_manual, p_build, p_review, p_grades),
      // NOT by pt_enter_grades (Saisir des notes) alone — a staff member
      // who can only enter grades for their assigned classes should not see
      // or reach the Examens & Quiz module. See VIEW_PERMISSION_REQUIREMENTS
      // on the client (exams/homework) for the matching page-level gate.
      'saveExam':                        ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      'listExams':                       ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'getExam':                         ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'deleteExam':                      ['pt_build_exam','p_manual','pa_save_settings'],
      'publishExam':                     ['pt_build_exam','p_manual','pa_save_settings'],
      'listExamSubmissions':             ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'getExamSubmission':               ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'gradeExamSubmission':             ['pt_build_exam','p_manual','p_review','pt_edit_grades','pa_save_settings'],
      'listStudentExams':                [],
      'startStudentExam':                [],
      'saveExamProgress':                [],
      'submitStudentExam':               [],
      'getStudentExamResult':            [],
      // ── Phase 1/2 additions — classement réel & carte d'identité élève.
      // Contrôle d'accès fait à l'intérieur des fonctions elles-mêmes via
      // ensureViewerCanAccessStudentScope_, comme les autres routes
      // "self-service élève" ci-dessus ([] = pas de permission staff requise).
      'getStudentClassRank':             [],
      'issueCertificate':                'pa_generate_report',
      'listCertificates':                ['p_dossier','pa_generate_report','pt_view_bulletin'],
      'getCertificate':                  ['p_dossier','pa_generate_report','pt_view_bulletin'],
      'revokeCertificate':               'pa_generate_report',
      'getCertificatePrintHtml':         ['pa_generate_report','pt_export_data','pt_view_bulletin'],
      'verifyCertificate':               '',
      'getMySchoolId':                   [],
      // ── Media Library ─────────────────────────────────────────────────────
      // FIX: listMedia previously had an empty permission list ([]), meaning
      // ANY authenticated staff account — even one with zero permissions —
      // could call it directly and pull the entire media library. Every other
      // media action (saveMedia/deleteMedia/uploadMediaFile) already requires
      // one of these; list access must be gated the same way.
      'listMedia':                       ['pt_build_exam','p_manual','p_review','p_build','pa_save_settings'],
      'saveMedia':                       ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      'deleteMedia':                     ['pt_build_exam','p_manual','pa_save_settings'],
      'uploadMediaFile':                 ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      // ── Homework ──────────────────────────────────────────────────────────
      // NOTE: same intentional gate as the Exam Builder block above — the
      // homework/quiz module requires exam/build permissions, not plain
      // pt_enter_grades.
      'listHomework':                    ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'saveHomework':                    ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      'deleteHomework':                  ['pt_build_exam','p_manual','pa_save_settings'],
      'gradeHomework':                   ['pt_build_exam','p_manual','p_review','pt_edit_grades','pa_save_settings'],
      'getHomeworkGrades':               ['pt_build_exam','p_manual','p_review','p_grades','pa_save_settings'],
      'convertHomeworkToExam':           ['pt_build_exam','p_manual','pa_save_settings'],
      'listStudentHomework':             [],
      'getStudentHomeworkBulletin':      [],
      'getImmersiveData':                'p_audit',
      'getComplexReportData':            ['p_audit','pa_generate_report'],
      'getUniversalAnalytics':           'p_audit',
      'getClassComparisonData':          '',
      'reportSecurityIncident':          '',
      'publishAnnouncement':             'pa_send_broadcast',
      'sendInternalMessage':             ['pa_send_broadcast','pt_send_message'],
      // ── Groupe B (portail élève) — self-service élève ([] = pas de permission
      // staff requise, contrôle d'accès fait via ensureViewerCanAccessStudentScope_
      // à l'intérieur des fonctions, comme getStudentClassRank ci-dessus).
      'getAnnouncementsForStudent':      [],
      'getAnnouncementsList':            'pa_send_broadcast',
      'deleteAnnouncement':              'pa_send_broadcast',
      'getStudentIncidents':             [],
      'getIncidentsForStudent':          ['pt_file_incident','p_staff','pa_teacher_affectation'],
      'getIncidentsList':                ['pt_file_incident','p_staff','pa_teacher_affectation'],
      'sendMessageToAdmin':              [],
      'getMyAdminMessages':              [],
      'getAdminMessagesInbox':           ['pa_send_broadcast','pt_send_message'],
      'replyToAdminMessage':             ['pa_send_broadcast','pt_send_message'],
      'setParentReplyPermission':        ['pa_send_broadcast','pt_send_message'],
      'checkAndInitSheets':              '',
      'warmSchoolCaches':                '',
      'generateReportDownloadUrl':       ['pa_generate_report','pt_export_data'],
      // FIX: was admin-only (p_staff/pa_teacher_affectation), which silently
      // blocked any non-admin viewer from ever loading it — but this is also
      // the ONLY endpoint the frontend uses to discover a viewer's OWN
      // assigned class(es)/subject(s) (see hydrateTeacherAffectationsFromApi_
      // -> applyTeacherOwnAffectationScope_ in the frontend). A user who only
      // holds a portal permission like pt_mark_attendance or pt_enter_grades
      // (regardless of their Role label — "Teacher", a custom role, etc.)
      // needs to call this too, or their assigned class never loads. Widening
      // the gate is safe because getStaffAssignments_() itself now scopes the
      // response (and strips salary/rate/hours) for callers who don't hold
      // the admin-level permission.
      'getStaffAssignments':             ['p_staff','pa_teacher_affectation'].concat(STRICT_STUDENT_SCOPE_PERMISSION_KEYS_),
      'deleteStaffAssignment':           'pa_teacher_affectation',
      'createSubject':                   'pa_teacher_affectation',
      'deleteSubject':                   'pa_teacher_affectation',
      'logReportGenerated':              ['p_audit','pa_generate_report','p_grades','pt_view_bulletin','pt_export_data'],
      'getUnifiedDirectory':             ['p_attendance','pt_mark_attendance','pt_view_attendance'],
      'handleTemplateUpload':            'pa_save_settings',
      'recordAttendance':                ['p_attendance','pt_mark_attendance'],
      'saveStaffAssignment':             'pa_teacher_affectation',
      'sendStudentReportEmail':          ['pa_generate_report','pt_view_bulletin'],
      'setupInitialPin':                 '',
      'loginWithIdAndPin':               '',
      'setupStaffPin':                   '',
      'sendEmailVerification':           '',
      'verifyEmailOTP':                  '',
      'studentPortalLogin':              '',
      'rolloverAcademicYear':            'pa_save_settings',
      'getAcademicYearRolloverStatus':   ['p_settings','pa_save_settings'],
      'resetAcademicYearRollover':       'pa_save_settings',
      'createSaaSBackup':                'pa_save_settings',
      'runGlobalBackupTask':             'pa_save_settings',
      'grantBackupServiceAccess':        'pa_save_settings',
      'checkAndUpdateAccountStatus':     'pa_save_settings',
      'initAiConfigurationLibrary':      'pa_save_settings',
      'initAiMasterSheets':              'pa_save_settings',
      'ensureAiConfigurationLibrarySheets': 'pa_save_settings',
      'forceInitAiMasterSheets':         'pa_save_settings',
      'getAiChatConversationList':      'p_use_ai',
      'ensureSchoolIdsSheet':            '',
      'initSchoolIdsSheet':              '',
      'initializeSheetHeaders':          '',
      'getSchoolIds':                    ['p_dossier','pa_add_student','pa_edit_student','p_settings'],
      'listSchoolIds':                   ['p_dossier','pa_add_student','pa_edit_student','p_settings'],
      'getSchoolIdsRecords':             ['p_dossier','pa_add_student','pa_edit_student','p_settings'],
      'saveSchoolIdRecord':              ['pa_add_student','pa_edit_student','p_settings'],
      'appendSchoolIdRecord':            ['pa_add_student','pa_edit_student','p_settings'],
      'updateSchoolIdRecord':            ['pa_add_student','pa_edit_student','p_settings'],
      'upsertSchoolIdRecord':            ['pa_add_student','pa_edit_student','p_settings'],
      'enrollStudent':                   'pa_add_student',
      'diagnoseSyncIssue':               'p_settings',
      'dropStudent':                     'pa_edit_student',
      'reEnrollStudent':                 'pa_add_student',
      'getActiveEnrollment':             ['p_dossier','pa_edit_student'],
      'updateStudentHistory':            'pa_edit_student',
      // ── PATCH: Nouvelles routes ────────────────────────────────────────
      'getSystemAlerts':                 '',
      'getNotifications':                '',
      'getPushConfig':                   '',
      'registerPushSubscription':        '',
      'unregisterPushSubscription':      '',
      'listPushNotifications':           '',
      'markNotificationRead':            '',
      'markAllNotificationsRead':        '',
      'confirmTeacherAlertStatus':       ['p_attendance','p_staff','p_hr_attendance'],
      'notifyLateStaff':                 'p_hr_attendance',
      'saveKioskWatchCodes':             ['p_attendance','p_settings'],
      'getKioskWatchCodes':              ['p_attendance','p_settings'],
      'DROP_STUDENT':                    'pa_edit_student',
      // ── PATCH: Bulletin authenticity verification ─────────────────────
      'registerBulletinIssue':           [], // any authenticated viewer that can open a bulletin
      'verifyBulletin':                  [], // any authenticated viewer (public-ish lookup)
      // ── PATCH: Sheet bootstrap ─────────────────────────────────────────
      'initSheets':                      [], // safe to call by anyone — idempotent
};

// Resolves the small handful of cases where this Worker's action name
// (chosen while porting src/actions/*.js) doesn't literally match the key
// Code.gs's own `policy` object above uses for the equivalent access
// decision. Confirmed by grep against the uploaded Code.gs (background-sync
// file) this session — exactly two real mismatches so far:
//   - Worker's getStudentById reads one student by id/code; Code.gs's
//     policy gates that exact read under 'getStudent' (its dispatcher
//     calls the read function getStudent_ under that action name).
//   - Worker's getAttendanceForStudent / getStudentAttendance (alias, see
//     ALIASES-equivalent in attendance.js) is the per-student attendance
//     read; Code.gs's policy key for that is 'getStudentAttendance'
//     itself (NOT 'getAttendance', which is a separate, admin-facing,
//     whole-class/whole-school action with the same required keys anyway
//     but is a distinct action in Code.gs's own dispatcher).
// Add an entry here — never rename the exported action or duplicate a
// policy row — whenever a future port introduces another name mismatch;
// this keeps ACTION_PERMISSIONS a true verbatim copy of Code.gs's policy.
export const PERMISSION_ACTION_ALIASES = {
  getStaffList: 'getAllAdminUsers',
  getStaffManagementData: 'getAllAdminUsers',
  saveStaffAccess: 'updateUserRoleAndPerms',
  getStudentById: "getStudent",
  getAttendanceForStudent: "getStudentAttendance",
};

// Worker-native actions with no equivalent entry in Code.gs's policy
// object at all — they didn't exist in Code.gs, so there is nothing to
// verbatim-port a permission requirement FROM. Each is deliberately open
// for a documented reason (see inline comments); this list is checked
// BEFORE ACTION_PERMISSIONS lookup so these never hit the "Action non
// reconnue" branch of checkActionPermission.
export const UNPOLICED_ACTIONS = new Set([
  "ping", // health check, no data touched
  "attemptSheetLogin", // pre-auth: this IS how a token is obtained
  "forcePasswordUpdate", // pre-auth password-reset completion, same flow as login
  "registerAccount", // pre-tenant, runs against MASTER_DB (see index.js ACCOUNT_ACTIONS)
  "fetchConfig", // pre-tenant, runs against MASTER_DB
  "checkSubdomainAvailable", // pre-tenant, runs against MASTER_DB
  "syncPull", // generic outbox/delta engine — gated per-table by SYNC_TABLES, not per-action
  "syncPush", // generic outbox/delta engine — gated per-table by SYNC_TABLES, not per-action
  "syncGeneratedIds", // Cron/admin trigger for the Generated_IDs background job, not an end-user action
  "seedBadgeStudents",
  "parentPortalLogin",
  "parentPortalLoginV2",
  "setupParentPin",
  "checkParentPhoneStatus",
  "submitParentRegistrationRequest",
  "activateParentAccount",
  "getParentChildren",
  "getParentChildAttendance",
  "getParentChildIncidents",
  "getParentAnnouncements", // GAS-to-Worker badge ingest — no session token exists for a server trigger;
                       // gated by its own shared-secret check (env.BADGE_INGEST_KEY) inside the handler
                       // instead. See src/actions/badgeSeed.js.
]);

// Verbatim port of the gating check that runs right after `policy[action]`
// is looked up in Code.gs (same order: unknown action rejected first,
// master/godmode bypass everything, otherwise ANY ONE of the required
// keys being true on viewer.permissions is enough — it's an OR list, not
// an AND list, e.g. STRICT_STUDENT_SCOPE_PERMISSION_KEYS_ appended to an
// admin permission on the same action).
//
// Returns { allowed: true } or { allowed: false, error } — never throws —
// so call sites can `return respond(...)`-equivalent the same way Code.gs
// did. `action` must already be the alias-resolved name (see apiHub.js's
// ALIASES table) since ACTION_PERMISSIONS keys match Code.gs's action
// names exactly, same convention normalizeApiHubResponse already follows.
export function checkActionPermission(viewer, action) {
  if (!(action in ACTION_PERMISSIONS)) {
    return { allowed: false, error: "Action non reconnue: " + action };
  }
  if (viewer && (viewer.isMaster || viewer.isGodMode)) {
    return { allowed: true };
  }
  const perm = ACTION_PERMISSIONS[action];
  const perms = (viewer && viewer.permissions) || {};
  const requiredPerms = Array.isArray(perm) ? perm.filter(Boolean) : perm ? [perm] : [];
  if (requiredPerms.length && !requiredPerms.some((k) => !!perms[k])) {
    return {
      allowed: false,
      error: "Permission [" + requiredPerms.join(" | ").toUpperCase() + "] manquante.",
    };
  }
  return { allowed: true };
}

// Small helper for the "strict scope" pattern several action files already
// reference in their own comments (filterStudentsByViewerScope_,
// requiresStrictStudentScope_) but couldn't implement without this list —
// true if the viewer holds ONLY portal-level keys and no broader
// admin/staff permission, meaning results must be scoped down to their
// own assigned class/student(s) rather than the whole school.
export function requiresStrictStudentScope(viewer) {
  const perms = (viewer && viewer.permissions) || {};
  if (viewer && (viewer.isMaster || viewer.isGodMode)) return false;
  return STRICT_STUDENT_SCOPE_PERMISSION_KEYS.some((k) => !!perms[k]);
}
