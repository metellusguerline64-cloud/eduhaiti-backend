// ============================================================
// CONSTANTS
// ============================================================
// ── SECURITY: Spreadsheet IDs are intentionally hardcoded by request.
const MASTER_AUTH_ID    = '1D9TDDQ-x-VMBK6eq0stBi8MUOnkA-L02NooCVvWXL90';
const MASTER_SPREADSHEET_ID = MASTER_AUTH_ID;
// Tableur dédié à la mémoire IA (historique des conversations + feuilles de configuration AI_LIB_*)
const AI_MEMORY_SPREADSHEET_ID = '1mQpgFCqQUboZkG2wtfuaxSdUb5fnARHe5knlsJbC7bQ';
if (!MASTER_AUTH_ID) throw new Error('[EduHaïti] MASTER_AUTH_ID non défini.');
if (!AI_MEMORY_SPREADSHEET_ID) throw new Error('[EduHaïti] AI_MEMORY_SPREADSHEET_ID non défini.');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG MAX SCORE HELPER — never hardcodes a grading scale.
// Reads MAX_SCORE (or maxScore) from the school Settings sheet.
// Falls back only for display; throws in calculation paths.
// ─────────────────────────────────────────────────────────────────────────────
function _getConfigMaxScore_(cfg) {
  var c = cfg || {};
  var v = Number(c.MAX_SCORE || c.maxScore || c.max_score || c.GRADE_MAX || c.gradeMax || 0);
  return (isFinite(v) && v > 0) ? v : null;
}
function _requireConfigMaxScore_(cfg, context) {
  var v = _getConfigMaxScore_(cfg);
  if (v !== null) return v;
  var ctx = context ? ' (' + context + ')' : '';
  throw new Error('MAX_SCORE non configuré' + ctx + '. Allez dans Paramètres › Évaluation.');
}
const USERS_SHEET_NAME  = 'Users';
const TEACHER_ASSIGNMENTS_SHEET_NAME = 'teacher_assignments';
const TIMETABLE_SHEET_NAME = 'timetable';
const SCHOOL_IDS_SHEET_NAME = 'School IDs';
const SCHOOL_IDS_HEADERS = [
  'Student Code',
  'School ID',
  'Class',
  'Date',
  'Json: Student infos',
  'Status',
  'Tracking Number',
  'Form URL',
  'Photo URL',
  'Photo Quality',
  'Mode',
  'Updated At'
];
const USERS_HEADERS     = ['UserID','Name','Email','Role','PermissionsJSON',
                           'Password','Reset_Req','Active','CreatedAt',
                           'LastLoginAt','IsTeacher','AssignedSubjects','PhotoURL'];

function ensureUsersSheetStructure_(ssInput) {
  const ss = ssInput || getSS_();
  let sh = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET_NAME);
    sh.getRange(1, 1, 1, USERS_HEADERS.length)
      .setValues([USERS_HEADERS])
      .setFontWeight('bold')
      .setBackground('#f3f3f3');
    sh.setFrozenRows(1);
    return sh;
  }

  const existingHeaders = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(x => String(x).trim());

  USERS_HEADERS.forEach(header => {
    if (existingHeaders.indexOf(header) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1)
        .setValue(header)
        .setFontWeight('bold')
        .setBackground('#fff2cc');
    }
  });

  return sh;
}

function ensureStructuredSheet_(sheetName, headers, ssInput) {
  const ss = ssInput || getSS_();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#f3f3f3');
    sh.setFrozenRows(1);
    return sh;
  }

  const existingHeaders = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(x => String(x).trim());

  headers.forEach(header => {
    if (existingHeaders.indexOf(header) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1)
        .setValue(header)
        .setFontWeight('bold')
        .setBackground('#fff2cc');
    }
  });

  return sh;
}

function ensureTeacherAssignmentsSheetStructure_(ssInput) {
  return ensureStructuredSheet_(TEACHER_ASSIGNMENTS_SHEET_NAME, [
    'AssignmentID','TeacherName','TeacherID','ClassName','ClassID','Subject',
    'Day','StartTime','EndTime','Hours','Rate','Salary','HasConflict',
    'Active','CreatedAt','UpdatedAt','MetaJSON'
  ], ssInput);
}

function ensureTimetableSheetStructure_(ssInput) {
  return ensureStructuredSheet_(TIMETABLE_SHEET_NAME, [
    'SlotID','ClassName','DayIndex','DayLabel','StartTime','EndTime','Subject',
    'Teacher','TeacherID','Conflict','Active','CreatedAt','UpdatedAt','MetaJSON'
  ], ssInput);
}

function getAuthSpreadsheetForIds_() {
  return SpreadsheetApp.openById(MASTER_AUTH_ID);
}

function ensureSchoolIdsSheetInAuth_(headers) {
  const ss = getAuthSpreadsheetForIds_();
  const normalizedHeaders = (Array.isArray(headers) && headers.length ? headers : SCHOOL_IDS_HEADERS)
    .map(function(h) { return String(h || '').trim(); })
    .filter(Boolean);
  const sh = ensureStructuredSheet_(SCHOOL_IDS_SHEET_NAME, normalizedHeaders, ss);
  return { ss: ss, sh: sh, headers: normalizedHeaders };
}

function mapRowByHeaders_(headers, row) {
  const out = {};
  (headers || []).forEach(function(h, idx) {
    out[String(h || '').trim()] = row && row[idx] !== undefined ? row[idx] : '';
  });
  return out;
}

function normalizeSchoolIdRecord_(record) {
  const src = (record && typeof record === 'object') ? record : {};
  var values = src.values || src.studentInfos || src.studentInfo || src['Json: Student infos'] || {};
  if (typeof values === 'string') {
    try { values = JSON.parse(values); } catch (_err) { values = { raw: String(values || '') }; }
  }

  const schoolId = String(src['School ID'] || src.generatedId || src.id || '').trim();
  const studentCode = String(src['Student Code'] || src.studentCode || src['Tracking Number'] || src.trackingNumber || '').trim();
  const tracking = String(src['Tracking Number'] || src.trackingNumber || studentCode || schoolId || '').trim();
  const className = String(src['Class'] || src.className || src.class || '').trim();
  const formUrl = String(src['Form URL'] || src.formUrl || '').trim();
  const photoUrl = String(src['Photo URL'] || src.photoUrl || src.photo || '').trim();
  var photoQuality = src['Photo Quality'] || src.photoQuality || {};
  if (typeof photoQuality === 'object') {
    try { photoQuality = JSON.stringify(photoQuality); } catch (_errJson) { photoQuality = ''; }
  }
  photoQuality = String(photoQuality || '').trim();
  const status = String(src['Status'] || src.status || 'CREATED').trim() || 'CREATED';
  const mode = String(src['Mode'] || src.mode || '').trim();
  const date = String(src['Date'] || src.date || new Date()).trim();
  const updatedAt = String(src['Updated At'] || src.updatedAt || new Date().toISOString()).trim();

  return {
    'Student Code': studentCode || tracking,
    'School ID': schoolId,
    'Class': className,
    'Date': date,
    'Json: Student infos': JSON.stringify(values || {}),
    'Status': status,
    'Tracking Number': tracking,
    'Form URL': formUrl,
    'Photo URL': photoUrl,
    'Photo Quality': photoQuality,
    'Mode': mode,
    'Updated At': updatedAt,
    studentCode: studentCode || tracking,
    generatedId: schoolId,
    trackingNumber: tracking,
    className: className,
    formUrl: formUrl,
    photoUrl: photoUrl,
    photoQuality: photoQuality,
    status: status,
    mode: mode,
    date: date,
    updatedAt: updatedAt,
    values: values
  };
}

function normalizeSchoolCodeToken_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function schoolCodeVariants_(value) {
  var raw = String(value || '').trim();
  if (!raw) return [];
  var compact = normalizeSchoolCodeToken_(raw);
  var variants = {};
  if (raw) variants[String(raw).toUpperCase()] = true;
  if (compact) variants[compact] = true;

  // Heuristic support for "without prefix" comparisons.
  var compactNoPrefix = compact.replace(/^[A-Z]+/, '');
  if (compactNoPrefix) variants[compactNoPrefix] = true;

  return Object.keys(variants);
}

function schoolCodesMatch_(a, b) {
  var left = schoolCodeVariants_(a);
  var right = schoolCodeVariants_(b);
  if (!left.length || !right.length) return false;

  var rightMap = {};
  for (var i = 0; i < right.length; i++) rightMap[right[i]] = true;
  for (var j = 0; j < left.length; j++) {
    if (rightMap[left[j]]) return true;
  }
  return false;
}

function ensureSchoolIdsSheet_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var ensured = ensureSchoolIdsSheetInAuth_(data && data.headers);
  var warmup = null;
  try { warmup = warmSchoolCachesOnInit_(auth || {}); } catch (_warmErr) {}
  return {
    success: true,
    sheetName: SCHOOL_IDS_SHEET_NAME,
    spreadsheetId: MASTER_AUTH_ID,
    headers: ensured.headers,
    message: 'Sheet School IDs initialisée dans Auth spreadsheet.',
    cacheWarmup: warmup
  };
}

function getSchoolIdsRecords_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

  var ensured = ensureSchoolIdsSheetInAuth_(data && data.headers);
  var sh = ensured.sh;
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) {
    return {
      success: true,
      data: [],
      records: [],
      sheetName: SCHOOL_IDS_SHEET_NAME,
      spreadsheetId: MASTER_AUTH_ID,
      headers: ensured.headers
    };
  }

  var rows = sh.getRange(2, 1, lastRow - 1, ensured.headers.length).getValues();
  var records = rows.map(function(r) {
    return normalizeSchoolIdRecord_(mapRowByHeaders_(ensured.headers, r));
  });

  return {
    success: true,
    data: records,
    records: records,
    sheetName: SCHOOL_IDS_SHEET_NAME,
    spreadsheetId: MASTER_AUTH_ID,
    headers: ensured.headers
  };
}

function upsertSchoolIdRecord_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

  var ensured = ensureSchoolIdsSheetInAuth_(data && data.headers);
  var sh = ensured.sh;
  var headers = ensured.headers;
  var record = normalizeSchoolIdRecord_((data && data.record) || data || {});

  if (!record['School ID']) return { success: false, error: 'School ID requis.' };

  var lastRow = sh.getLastRow();
  var updateRow = -1;
  var idxStudentCode = headers.indexOf('Student Code');
  var idxSchoolId = headers.indexOf('School ID');
  var idxTracking = headers.indexOf('Tracking Number');

  if (lastRow > 1 && idxSchoolId !== -1) {
    var dataRows = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < dataRows.length; i++) {
      var existingStudentCode = (idxStudentCode !== -1) ? String(dataRows[i][idxStudentCode] || '').trim() : '';
      var existingSchoolId = String(dataRows[i][idxSchoolId] || '').trim();
      var existingTracking = (idxTracking !== -1) ? String(dataRows[i][idxTracking] || '').trim() : '';
      if ((existingStudentCode && schoolCodesMatch_(existingStudentCode, record['Student Code'] || record['Tracking Number'])) ||
          (record['Tracking Number'] && existingTracking && schoolCodesMatch_(existingTracking, record['Tracking Number'])) ||
          (!record['Student Code'] && !record['Tracking Number'] && existingSchoolId && schoolCodesMatch_(existingSchoolId, record['School ID']))) {
        updateRow = i + 2;
        break;
      }
    }
  }

  var rowValues = headers.map(function(h) { return record[h] !== undefined ? record[h] : ''; });
  if (updateRow > 0) {
    sh.getRange(updateRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sh.appendRow(rowValues);
    updateRow = sh.getLastRow();
  }

  return {
    success: true,
    row: updateRow,
    record: record,
    sheetName: SCHOOL_IDS_SHEET_NAME,
    spreadsheetId: MASTER_AUTH_ID,
    message: updateRow > lastRow ? 'Record ajouté.' : 'Record mis à jour.'
  };
}

function getMasterPermsTemplate_() {
  return {
    p_settings:true, pa_save_settings:true, p_pic:true, p_dossier:true,
    pa_add_student:true, pa_edit_student:true, p_grades:true,
    p_manual:true, p_review:true, p_build:true, pa_generate_report:true,
    pa_promote_student:true, p_staff:true, pa_add_staff:true,
    pa_manage_users:true, pa_teacher_affectation:true, p_finance:true,
    pa_record_payment:true, pa_send_broadcast:true, p_audit:true,
    p_attendance:true, p_hr_attendance:true, p_use_ai:true,
    p_approve_payments:true
  };
}

function normalizeSettingKey_(key) {
  return String(key || '').trim().toUpperCase().replace(/[\s_]/g, '');
}

function findHeaderIndex_(headers, names) {
  const normalizedHeaders = (headers || []).map(h => normalizeSettingKey_(h));
  const normalizedNames = (names || []).map(normalizeSettingKey_);
  return normalizedHeaders.findIndex(h => normalizedNames.indexOf(h) !== -1);
}

function extractPrimaryEmail_(rawValue) {
  const tokens = String(rawValue || '')
    .split(/[;,|\n\r]+/)
    .map(t => String(t || '').trim().toLowerCase())
    .filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tokens[i])) return tokens[i];
  }
  const direct = String(rawValue || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct) ? direct : '';
}

function normalizeHaitiPhoneCandidate_(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const tokens = raw
    .split(/[;,|\n\r/]+/)
    .map(t => String(t || '').trim())
    .filter(Boolean);

  const candidates = tokens.length ? tokens : [raw];
  let fallback = '';
  for (let i = 0; i < candidates.length; i++) {
    const token = candidates[i];
    const digits = token.replace(/\D/g, '');
    if (!digits) continue;
    if (/^(?:\+?509)?\d{8}$/.test(token.replace(/[\s()-]/g, '')) || /^(?:509)?\d{8}$/.test(digits)) {
      return digits.slice(-8);
    }
    if (!fallback && digits.length >= 8) fallback = digits.slice(-8);
  }
  return fallback;
}

function normalizeSpreadsheetId_(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  // Accept full Sheets URLs and extract /d/{id}
  const urlMatch = raw.match(/\/d\/([a-zA-Z0-9-_]{20,})/i);
  if (urlMatch && urlMatch[1]) return String(urlMatch[1]).toLowerCase();

  // Strip wrapping quotes then extract the longest id-like token
  const cleaned = raw.replace(/^['"]+|['"]+$/g, '');
  const tokenMatch = cleaned.match(/[a-zA-Z0-9-_]{20,}/);
  return String(tokenMatch ? tokenMatch[0] : cleaned).toLowerCase();
}

function getRegisteredAdminIdentity_(ssId) {
  const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
  const reg = master.getSheetByName('Register');
  if (!reg) throw new Error('Registre Master introuvable.');

  const data = reg.getDataRange().getValues();
  if (!data || !data.length) throw new Error('Registre Master vide.');

  const headers = data[0];
  const iSheet = findHeaderIndex_(headers, ['USER_SPREADSHEET_ID']);
  const iId = findHeaderIndex_(headers, ['ID']);
  const iEmail = findHeaderIndex_(headers, ['EMAIL']);
  const iName = findHeaderIndex_(headers, ['NAME']);
  const iBusinessName = findHeaderIndex_(headers, ['BUSINESS_NAME']);
  const iPhone = findHeaderIndex_(headers, ['PHONE']);
  const iTxnPhone = findHeaderIndex_(headers, ['TRANSACTION_PHONE']);
  const iActive = findHeaderIndex_(headers, ['IS_ACTIVE']);
  if (iSheet === -1) throw new Error('Colonne USER_SPREADSHEET_ID manquante.');

  const targetSsId = normalizeSpreadsheetId_(ssId);
  const row = data.find((record, index) => {
    if (index === 0) return false;
    return normalizeSpreadsheetId_(record[iSheet]) === targetSsId;
  });
  if (!row) throw new Error('Tableur non enregistre.');

  const email = iEmail !== -1 ? extractPrimaryEmail_(row[iEmail]) : '';
  const phone = normalizeHaitiPhoneCandidate_(
    iPhone !== -1 && row[iPhone] ? row[iPhone] : (iTxnPhone !== -1 ? row[iTxnPhone] : '')
  );
  const transactionPhone = iTxnPhone !== -1 ? normalizeHaitiPhoneCandidate_(row[iTxnPhone]) : '';
  const isActive = iActive === -1 ? true : !['FALSE', 'NON', 'NO', '0'].includes(String(row[iActive] || '').trim().toUpperCase());

  return {
    id: iId !== -1 ? String(row[iId] || '').trim() : '',
    email: email,
    phone: phone,
    transactionPhone: transactionPhone,
    name: iName !== -1 ? String(row[iName] || '').trim() : '',
    businessName: iBusinessName !== -1 ? String(row[iBusinessName] || '').trim() : '',
    isActive: isActive,
    row: row,
    headers: headers
  };
}

function isInternalReadOnlyPerms_(perms) {
  return !!(perms && (perms.isInternalAccount || perms.isReadOnly));
}

function parsePermissionsCell_(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return {};
  if (raw.toUpperCase() === 'GODMODE') {
    return { isGodMode: true, isInternalAccount: true, isReadOnly: true };
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && String(parsed).trim().toUpperCase() === 'GODMODE') {
      return { isGodMode: true, isInternalAccount: true, isReadOnly: true };
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch(e) {
    return {};
  }
}

function normalizeScopeToken_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeScopeCycleKey_(value) {
  const raw = normalizeScopeToken_(value);
  if (!raw) return '';
  if (raw.indexOf('MAT') !== -1) return 'MATERNELLE';
  if (raw.indexOf('FOND') !== -1 || raw.indexOf('PRIMA') !== -1 || raw.indexOf('AF') !== -1) return 'FONDAMENTAL';
  if (raw.indexOf('SECOND') !== -1 || raw.indexOf('RHETO') !== -1 || raw.indexOf('PHILO') !== -1 || raw.indexOf('TERM') !== -1 || raw.indexOf('LYCEE') !== -1 || raw.indexOf('COLLEGE') !== -1) return 'SECONDAIRE';
  if (raw.indexOf('MASTER') !== -1) return 'UNI_MASTER';
  if (raw.indexOf('LICENCE') !== -1 || raw.indexOf('UNIVERS') !== -1) return 'UNI_LICENCE';
  if (raw.indexOf('DIP') !== -1) return 'PROF_DIP';
  if (raw.indexOf('PROF') !== -1 || raw.indexOf('CERT') !== -1) return 'PROF_CERT';
  return '';
}

function parseViewerAccessScope_(assignmentsRaw) {
  const out = { classes: [], cycles: [], studentIds: [], selfOnly: false, restricted: false };
  const seenClasses = {};
  const seenCycles = {};
  const seenStudentIds = {};

  const addClass = function(label) {
    const raw = String(label || '').trim();
    const norm = normalizeScopeToken_(raw);
    if (!raw || !norm || seenClasses[norm]) return;
    seenClasses[norm] = true;
    out.classes.push(raw);
  };

  const addCycle = function(value) {
    const key = normalizeScopeCycleKey_(value);
    if (!key || seenCycles[key]) return;
    seenCycles[key] = true;
    out.cycles.push(key);
  };

  const addStudentId = function(value) {
    const sid = resolveStudentId_(value);
    const norm = normalizeScopeToken_(sid);
    if (!sid || !norm || seenStudentIds[norm]) return;
    seenStudentIds[norm] = true;
    out.studentIds.push(sid);
  };

  const visit = function(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'string') {
      const txt = String(value || '').trim();
      if (!txt) return;
      if ((txt.charAt(0) === '{' && txt.charAt(txt.length - 1) === '}') || (txt.charAt(0) === '[' && txt.charAt(txt.length - 1) === ']')) {
        try { visit(JSON.parse(txt)); return; } catch (_err) {}
      }
      if (/^class\s*:/i.test(txt)) { addClass(txt.replace(/^class\s*:/i, '').trim()); return; }
      if (/^cycle\s*:/i.test(txt)) { addCycle(txt.replace(/^cycle\s*:/i, '').trim()); return; }
      if (/^student\s*:/i.test(txt)) { addStudentId(txt.replace(/^student\s*:/i, '').trim()); return; }
      if (/^self\s*:?$/i.test(txt)) { out.selfOnly = true; return; }
      if (/^(mat|maternelle|fond|fondamental|secondaire|second|licence|master|prof|cert|diplome|dip)$/i.test(txt.replace(/[_\-]+/g, ' ').trim())) {
        addCycle(txt);
      }
      return;
    }
    if (typeof value === 'object') {
      ['classes', 'classesAllowed', 'assignedClasses'].forEach(function(key) {
        if (Array.isArray(value[key])) value[key].forEach(addClass);
      });
      ['cycles', 'cyclesAllowed', 'assignedCycles'].forEach(function(key) {
        if (Array.isArray(value[key])) value[key].forEach(addCycle);
      });
      ['studentIds', 'students', 'studentsAllowed', 'allowedStudentIds', 'assignedStudentIds'].forEach(function(key) {
        if (Array.isArray(value[key])) value[key].forEach(addStudentId);
      });
      if (value.className) addClass(value.className);
      if (value.classId) addClass(value.classId);
      if (value.cycle) addCycle(value.cycle);
      if (value.cycleKey) addCycle(value.cycleKey);
      if (value.studentId) addStudentId(value.studentId);
      if (value.studentCode) addStudentId(value.studentCode);
      if (value.selfOnly === true || value.onlySelf === true) out.selfOnly = true;
    }
  };

  visit(assignmentsRaw);
  out.restricted = !!(out.classes.length || out.cycles.length || out.studentIds.length || out.selfOnly);
  return out;
}

function resolveLevelCycleKey_(levelName) {
  return normalizeScopeCycleKey_(levelName);
}

function canViewerAccessLevel_(viewer, levelName) {
  if (!viewer || viewer.isMaster || viewer.isGodMode) return true;
  const scope = parseViewerAccessScope_(viewer.assignedSubjects || (viewer.permissions && viewer.permissions.assignedSubjects));
  if (!scope.restricted) return true;
  const rawLevel = String(levelName || '').trim();
  const normLevel = normalizeScopeToken_(rawLevel);
  if (scope.classes.some(function(label) { return normalizeScopeToken_(label) === normLevel; })) return true;
  const cycleKey = resolveLevelCycleKey_(rawLevel);
  return !!(cycleKey && scope.cycles.indexOf(cycleKey) !== -1);
}

function canViewerAccessStudent_(viewer, studentId) {
  if (!viewer || viewer.isMaster || viewer.isGodMode) return true;
  const sid = resolveStudentId_(studentId);
  if (!sid) return false;
  const scope = parseViewerAccessScope_(viewer.assignedSubjects || (viewer.permissions && viewer.permissions.assignedSubjects));
  if (!scope.studentIds.length) return !scope.selfOnly;
  return scope.studentIds.some(function(value) {
    return normalizeScopeToken_(value) === normalizeScopeToken_(sid);
  });
}

function resolveStudentLevelForScope_(studentId) {
  try {
    const sid = resolveStudentId_(studentId);
    if (!sid) return '';
    const students = getAllStudents_() || [];
    const row = students.find(function(s) {
      return String(s.StudentCode || s.studentCode || s.StudentID || s.studentId || s.id || '').trim() === sid;
    });
    return row ? String(row.CurrentLevel || row.currentLevel || row.level || row.GradeLevel || row.grade || '').trim() : '';
  } catch(e) {
    return '';
  }
}

function resolveStudentId_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value !== 'object') return '';

  const obj = value;
  const keys = [
    'studentId', 'StudentId', 'studentID', 'StudentID',
    'studentCode', 'StudentCode', 'id', 'ID', 'Student_ID'
  ];
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }

  if (obj.data && typeof obj.data === 'object') {
    const nestedDataId = resolveStudentId_(obj.data);
    if (nestedDataId) return nestedDataId;
  }
  if (obj.student && typeof obj.student === 'object') {
    const nestedStudentId = resolveStudentId_(obj.student);
    if (nestedStudentId) return nestedStudentId;
  }
  return '';
}

function ensureViewerCanAccessStudentScope_(studentId, tokenOrViewer) {
  const viewer = tokenOrViewer && typeof tokenOrViewer === 'object' && tokenOrViewer.success !== undefined
    ? tokenOrViewer
    : (tokenOrViewer ? getViewerInfo_(tokenOrViewer) : null);
  if (!viewer || !viewer.success || viewer.isMaster || viewer.isGodMode) {
    return { success: true, viewer: viewer || null, level: resolveStudentLevelForScope_(studentId) };
  }
  const perms = viewer.permissions || {};
  const requiresStrictScope = [
    'pt_view_class_list','pt_view_student_profile','pt_view_history',
    'pt_mark_attendance','pt_view_attendance','pt_enter_grades',
    'pt_edit_grades','pt_view_bulletin','pt_view_class_perf','pt_view_ranking'
  ].some(function(key) { return !!perms[key]; });
  const scope = parseViewerAccessScope_(viewer.assignedSubjects || (viewer.permissions && viewer.permissions.assignedSubjects));
  if (requiresStrictScope && !scope.restricted) {
    return { success: false, error: 'Accès refusé : aucun élève ou aucune classe n’est assigné à ce compte.' };
  }
  if ((scope.selfOnly || scope.studentIds.length) && !canViewerAccessStudent_(viewer, studentId)) {
    return { success: false, error: 'Accès refusé : ce compte élève ne peut consulter que son propre dossier.' };
  }
  const level = resolveStudentLevelForScope_(studentId);
  if (!canViewerAccessLevel_(viewer, level)) {
    return { success: false, error: 'Accès refusé : ce rapport est hors de la classe / du cycle assigné.' };
  }
  return { success: true, viewer: viewer, level: level };
}

function filterStudentsByViewerScope_(students, viewer) {
  const rows = Array.isArray(students) ? students.slice() : [];
  if (!viewer || viewer.isMaster || viewer.isGodMode) return rows;
  const perms = viewer.permissions || {};
  const requiresStrictScope = [
    'pt_view_class_list','pt_view_student_profile','pt_view_history',
    'pt_mark_attendance','pt_view_attendance','pt_enter_grades',
    'pt_edit_grades','pt_view_bulletin','pt_view_class_perf','pt_view_ranking'
  ].some(function(key) { return !!perms[key]; });
  const scope = parseViewerAccessScope_(viewer.assignedSubjects || (viewer.permissions && viewer.permissions.assignedSubjects));
  if (requiresStrictScope && !scope.restricted) return [];
  if (!scope.restricted) return rows;
  if (scope.selfOnly || scope.studentIds.length) {
    return rows.filter(function(s) {
      return canViewerAccessStudent_(viewer, s);
    });
  }
  return rows.filter(function(s) {
    const level = String(s.CurrentLevel || s.currentLevel || s.level || s.GradeLevel || s.grade || '').trim();
    return canViewerAccessLevel_(viewer, level);
  });
}

function readBooleanConfigValue_(cfg, key, defaultValue) {
  if (!cfg || typeof cfg !== 'object' || cfg[key] === undefined || cfg[key] === null || cfg[key] === '') {
    return !!defaultValue;
  }
  const raw = cfg[key];
  if (typeof raw === 'string') {
    const txt = raw.trim().toUpperCase();
    if (['TRUE', '1', 'YES', 'ON', 'OUI'].indexOf(txt) !== -1) return true;
    if (['FALSE', '0', 'NO', 'OFF', 'NON'].indexOf(txt) !== -1) return false;
  }
  return !!raw;
}

function buildStudentViewerAccessScope_(studentId, levelName) {
  const level = String(levelName || '').trim();
  const scope = {
    selfOnly: true,
    studentIds: studentId ? [String(studentId).trim()] : [],
    classes: level ? [level] : [],
    cycles: []
  };
  const cycleKey = resolveLevelCycleKey_(level);
  if (cycleKey) scope.cycles.push(cycleKey);
  return scope;
}

function buildStudentPortalPermissions_(cfg) {
  const settings = (cfg && typeof cfg === 'object') ? cfg : {};
  const canViewProfile = readBooleanConfigValue_(settings, 'SP_VIEW_OWN_PROFILE', true);
  const canViewAttendance = readBooleanConfigValue_(settings, 'SP_VIEW_ATTENDANCE', true);
  const canViewGrades = readBooleanConfigValue_(settings, 'SP_VIEW_GRADES', true);
  const canViewBulletin = readBooleanConfigValue_(settings, 'SP_VIEW_BULLETIN', true);
  const canViewExamCalendar = readBooleanConfigValue_(settings, 'SP_VIEW_EXAM_CALENDAR', true);
  const canViewExams = readBooleanConfigValue_(settings, 'SP_VIEW_EXAMS', canViewExamCalendar);
  const canViewHomework = readBooleanConfigValue_(settings, 'SP_VIEW_HOMEWORK', canViewExamCalendar);
  const canViewFees = readBooleanConfigValue_(settings, 'SP_VIEW_FEES', true);
  const canViewPayments = readBooleanConfigValue_(settings, 'STUDENT_PORTAL_VIEW_PAYMENTS', true);
  const canViewHistory = readBooleanConfigValue_(settings, 'SP_VIEW_HISTORY', true);
  const canViewDocuments = readBooleanConfigValue_(settings, 'SP_VIEW_DOCUMENTS', false);

  return {
    studentPortal: true,
    p_dossier: !!(canViewProfile || canViewGrades || canViewAttendance || canViewHistory || canViewFees || canViewBulletin || canViewPayments || canViewDocuments),
    pt_view_student_profile: !!(canViewProfile || canViewGrades || canViewAttendance || canViewHistory || canViewFees || canViewBulletin || canViewPayments),
    p_grades: !!(canViewGrades || canViewBulletin || canViewExamCalendar || canViewExams || canViewHomework),
    pt_view_bulletin: !!canViewBulletin,
    p_history: !!canViewHistory,
    pt_view_history: !!canViewHistory,
    pt_view_attendance: !!canViewAttendance,
    p_finance: !!(canViewFees || canViewPayments),
    pt_view_exam_calendar: !!(canViewExamCalendar || canViewExams || canViewHomework),
    sp_view_exams: !!canViewExams,
    sp_view_homework: !!canViewHomework,
    sp_view_documents: !!canViewDocuments
  };
}

function getBootstrapOwnerContext_() {
  let ownerEmail = '';
  let activeUserEmail = '';
  try { ownerEmail = Session.getEffectiveUser().getEmail().toLowerCase().trim(); } catch(e) {}
  try { activeUserEmail = Session.getActiveUser().getEmail().toLowerCase().trim(); } catch(e) {}
  return {
    ownerEmail: ownerEmail,
    activeUserEmail: activeUserEmail,
    isOwnerActiveUser: !!ownerEmail && !!activeUserEmail && ownerEmail === activeUserEmail
  };
}

function isBootstrapSettingKeyAllowed_(key) {
  const normalized = normalizeSettingKey_(key);
  return [
    'OWNERPHONE', 'ADMINPHONE', 'CONTACTPHONE', 'SCHOOLPHONE', 'PHONE',
    'SCHOOLNAME', 'SCHOOLADDR', 'SCHOOLADDRESS', 'BOTSETUPSTATE'
  ].indexOf(normalized) !== -1;
}

// ────────────────────────────────────────────────────────────────────────────
// Liste canonique des clés Settings indispensables au bon fonctionnement.
// Utilisée par getSaaSSettingsHealth_ pour signaler à l'admin ce qui manque.
// ────────────────────────────────────────────────────────────────────────────
var REQUIRED_SAAS_SETTING_KEYS_ = [
  // Identité école
  'schoolName', 'orgId', 'schoolCode', 'currentAcademicYear',
  'schoolPhone', 'schoolEmail', 'schoolAddress',
  // Académique
  'academicStructure', 'gradingType', 'NUM_PERIODS', 'maxScore',
  'passingScore', 'PROMOTION_MIN_AVG', 'ACTIVE_LEVELS',
  // Finance
  'currency', 'TUITION_MODE'
];

// Clés conditionnellement requises (validées seulement si la fonctionnalité
// associée est activée).
var CONDITIONAL_SAAS_SETTING_KEYS_ = {
  notifyAbsence:    ['WHATSAPP_PROVIDER', 'WHATSAPP_API_KEY'],
  notifyPayment:    ['WHATSAPP_PROVIDER', 'WHATSAPP_API_KEY'],
  notifyPromotion:  ['WHATSAPP_PROVIDER', 'WHATSAPP_API_KEY'],
  notifyGrades:     ['WHATSAPP_PROVIDER', 'WHATSAPP_API_KEY']
};

function _isSettingValuePresent_(val) {
  if (val === null || val === undefined) return false;
  var s = String(val).trim();
  if (!s) return false;
  if (s === '{}' || s === '[]') return false;
  return true;
}

function persistSettingsEntries_(entries) {
  const ss = getSS_();
  let sh = ss.getSheetByName('Settings');
  if (!sh) {
    sh = ss.insertSheet('Settings');
    sh.appendRow(['KEY','VALUE','LAST_UPDATED']);
    sh.setFrozenRows(1);
  }

  // Sérialise les écritures concurrentes pour éviter les doublons
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(_) { /* best effort */ }

  try {
    const data = sh.getDataRange().getValues();

    // Carte KEY → liste de numéros de ligne (1-indexed). Permet de détecter
    // les doublons existants et de les supprimer après mise à jour.
    const rowsByKey = {};
    for (let i = 1; i < data.length; i++) {
      const k = String(data[i][0] || '').trim();
      if (!k) continue;
      (rowsByKey[k] = rowsByKey[k] || []).push(i + 1);
    }

    const ts = new Date();
    const rowsToDelete = [];

    entries.forEach(entry => {
      let val = entry.value;
      if (val !== null && typeof val === 'object') val = JSON.stringify(val);
      else if (typeof val === 'boolean') val = val ? 'TRUE' : 'FALSE';
      else if (val === undefined || val === null) val = '';
      else val = String(val);

      // Mirror to Script Properties for fast bootstrap reads, but skip large /
      // structured config blobs (curriculum chunks, school curriculum) that can
      // exceed the 9KB-per-property limit and that NO read path consults from
      // ScriptProperties anyway. Keeping them here just leaves stale data behind
      // after a curriculum reset.
      const skipScriptProp = /^(CURRICULUM_|SCHOOL_CURRICULUM$)/i.test(String(entry.name || ''));
      if (!skipScriptProp) {
        try { PropertiesService.getScriptProperties().setProperty(entry.name, val); } catch(_) {}
      } else {
        // Best-effort cleanup: if a previous version persisted it, drop it now.
        try { PropertiesService.getScriptProperties().deleteProperty(entry.name); } catch(_) {}
      }

      const rows = rowsByKey[entry.name] || [];
      if (rows.length === 0) {
        const newRow = sh.getLastRow() + 1;
        // Force the VALUE column to plain text BEFORE writing so Sheets never
        // auto-converts time-like strings ("08:00") into Date cells anchored
        // on 1899-12-30, which corrupts ATTENDANCE_ENTRY_TIME and similar
        // settings on read.
        try { sh.getRange(newRow, 2).setNumberFormat('@'); } catch(_) {}
        sh.appendRow([entry.name, val, ts]);
      } else {
        // Garde la première ligne, marque les autres pour suppression
        const keepRow = rows[0];
        try { sh.getRange(keepRow, 2).setNumberFormat('@'); } catch(_) {}
        sh.getRange(keepRow, 2, 1, 2).setValues([[val, ts]]);
        for (let j = 1; j < rows.length; j++) rowsToDelete.push(rows[j]);
      }
    });

    // Supprime les lignes en doublons en partant du bas (préserve les indices)
    if (rowsToDelete.length) {
      rowsToDelete.sort(function(a,b){ return b - a; });
      rowsToDelete.forEach(function(r){ try { sh.deleteRow(r); } catch(_){} });
    }

    // Invalidate the in-process settings caches so the next read sees the
    // freshly-persisted values instead of returning a stale merged blob.
    try { invalidateSaaSSettingsCache_(ss); } catch(_) {}
    try {
      const c = CacheService.getScriptCache();
      if (c) {
        // Curriculum-specific cache used by _readFullCurriculum.
        c.remove('CURRICULUM_CACHE_' + ss.getId());
        c.remove('CURRICULUM_CACHE_MAIN');
      }
    } catch(_) {}

    return { success:true, count: entries.length, duplicatesRemoved: rowsToDelete.length };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

// Audit complet de la feuille Settings : doublons et clés essentielles manquantes.
// Optionnellement, supprime les doublons existants quand opts.cleanup === true.
function getSaaSSettingsHealth_(opts) {
  opts = opts || {};
  const ss = getSS_();
  const sh = ss && ss.getSheetByName('Settings');
  if (!sh) return { success:false, error:'Feuille Settings introuvable.' };

  const data = sh.getDataRange().getValues();
  const rowsByKey = {};
  const valueByKey = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0] || '').trim();
    if (!k) continue;
    (rowsByKey[k] = rowsByKey[k] || []).push(i + 1);
    // Conserve la dernière valeur non vide rencontrée
    const v = data[i][1];
    if (_isSettingValuePresent_(v)) valueByKey[k] = v;
    else if (!(k in valueByKey)) valueByKey[k] = v;
  }

  const duplicates = {};
  const duplicateRowsToRemove = [];
  Object.keys(rowsByKey).forEach(function(k){
    const rows = rowsByKey[k];
    if (rows.length > 1) {
      duplicates[k] = rows.length;
      // Conserve la 1ère, supprime les autres
      for (let j = 1; j < rows.length; j++) duplicateRowsToRemove.push(rows[j]);
    }
  });

  let cleaned = 0;
  if (opts.cleanup && duplicateRowsToRemove.length) {
    const lock = LockService.getScriptLock();
    try { lock.waitLock(8000); } catch(_){}
    try {
      duplicateRowsToRemove.sort(function(a,b){ return b - a; });
      duplicateRowsToRemove.forEach(function(r){ try { sh.deleteRow(r); cleaned++; } catch(_){} });
    } finally { try { lock.releaseLock(); } catch(_){} }
  }

  // Clés requises absentes ou vides
  const missingRequired = REQUIRED_SAAS_SETTING_KEYS_.filter(function(k){
    return !_isSettingValuePresent_(valueByKey[k]);
  });

  // Clés conditionnellement requises (seulement si la fonctionnalité est ON)
  const missingConditional = [];
  Object.keys(CONDITIONAL_SAAS_SETTING_KEYS_).forEach(function(triggerKey){
    const v = String(valueByKey[triggerKey] || '').trim().toUpperCase();
    if (v !== 'TRUE') return;
    CONDITIONAL_SAAS_SETTING_KEYS_[triggerKey].forEach(function(depKey){
      if (!_isSettingValuePresent_(valueByKey[depKey]) && missingConditional.indexOf(depKey) === -1) {
        missingConditional.push(depKey + ' (requis car ' + triggerKey + '=TRUE)');
      }
    });
  });

  return {
    success: true,
    totalKeys: Object.keys(rowsByKey).length,
    duplicates: duplicates,
    duplicatesRemoved: cleaned,
    missingRequired: missingRequired,
    missingConditional: missingConditional,
    healthy: missingRequired.length === 0 && Object.keys(duplicates).length === 0
  };
}

function deriveDefaultPassFromPhone_(rawPhone) {
  const digits = normalizeHaitiPhoneCandidate_(rawPhone);
  return digits || '123456';
}

function ensureInternalGodModeAccount_(ssInput, options) {
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log(msg); };
  const healExisting = !!(options && options.healExisting);

  const ssForCache = ssInput || SpreadsheetApp.getActiveSpreadsheet();
  const seedCacheKey = 'GODMODE_SEED_OK_' + ssForCache.getId();
  const seedCached = _safeCacheGetData_(seedCacheKey);
  if (seedCached && !healExisting) {
    return { success:true, created:false, skipped:true, reason:'RECENT_SEED_CACHE', logs };
  }

  // Serialize concurrent calls to prevent duplicate row creation
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(e) {
    log('[SEED] Could not acquire lock: ' + e.message);
    return { success:false, error:'LOCK_TIMEOUT', logs };
  }

  try {
    const ss = ssInput || getSS_();
    if (!ss) { lock.releaseLock(); return { success:false, error:'NO_SPREADSHEET', logs }; }

    const registeredIdentity = getRegisteredAdminIdentity_(ss.getId());
    if (!registeredIdentity.isActive) {
      lock.releaseLock();
      return { success:false, error:'REGISTER_ACCOUNT_INACTIVE', logs };
    }

    let ownerEmail = String(registeredIdentity.email || '').toLowerCase().trim();
    let ownerPhone = String(registeredIdentity.phone || '').trim();
    const txnPhone = String(registeredIdentity.transactionPhone || '').trim();
    const ownerName = String(registeredIdentity.name || registeredIdentity.businessName || 'Internal GodMode').trim();
    const internalUserId = String(registeredIdentity.id || 'U-GODMODE').trim() || 'U-GODMODE';

    // ── DEBUG ──────────────────────────────────────────────────────────────
    log('🔐 [SEED:DEBUG] ── Admin identity from Master Register ──');
    log('🔐 [SEED:DEBUG] Email            : ' + ownerEmail);
    log('🔐 [SEED:DEBUG] PHONE column     : ' + ownerPhone);
    log('🔐 [SEED:DEBUG] TRANSACTION_PHONE: ' + txnPhone);
    log('🔐 [SEED:DEBUG] Phone used for password (ownerPhone): ' + ownerPhone);
    // ──────────────────────────────────────────────────────────────────────

    if (!ownerEmail) {
      try { ownerEmail = Session.getEffectiveUser().getEmail().toLowerCase().trim(); } catch(e) {}
    }
    if (!ownerEmail || ownerEmail.indexOf('@') === -1) {
      lock.releaseLock();
      return { success:false, error:'OWNER_EMAIL_MISSING', logs };
    }

    if (!ownerPhone) ownerPhone = ERROR_CONFIG.contactPhone || '';

    const defaultPass = deriveDefaultPassFromPhone_(ownerPhone);
    const defaultHash = hashPin_(defaultPass);

    // ── DEBUG ──────────────────────────────────────────────────────────────
    log('🔐 [SEED:DEBUG] deriveDefaultPassFromPhone_ result: ' + defaultPass);
    log('🔐 [SEED:DEBUG] hashPin_(defaultPass)             : ' + defaultHash);
    // ──────────────────────────────────────────────────────────────────────

    let sh = ensureUsersSheetStructure_(ss);

    if (ss.getSheetByName('Admin_Users')) {
      try { migrateAdminUsersSheet_(ss); } catch(e) {}
      sh = ensureUsersSheetStructure_(ss);
    }

    const rows = sh.getDataRange().getValues();
    if (!rows || !rows.length) { lock.releaseLock(); return { success:false, error:'USERS_HEADERS_MISSING', logs }; }

    const h = rows[0].map(x => String(x).trim().toLowerCase());
    const find = (names) => h.findIndex(x => names.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
    const iUserId    = find(['userid','id']);
    const iName      = find(['name','nom']);
    const iEmail     = find(['email']);
    const iRole      = find(['role']);
    const iPerms     = find(['permissionsjson','permissions']);
    const iPass      = find(['password']);
    const iReset     = find(['resetreq']);
    const iActive    = find(['active']);
    const iCreated   = find(['createdat']);
    const iIsTeacher = find(['isteacher']);
    const iSubjects  = find(['assignedsubjects']);
    if (iEmail === -1 || iPass === -1 || iPerms === -1) { lock.releaseLock(); return { success:false, error:'USERS_STRUCTURE_INVALID', logs }; }

    const basePerms = 'GodMode';

    // Deduplicate: find all matching rows, keep first, delete extras
    const matchingIdxs = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][iEmail] || '').toLowerCase().trim() === ownerEmail) {
        matchingIdxs.push(i);
      }
    }
    if (matchingIdxs.length > 1) {
      log('[SEED] Deduplicating ' + (matchingIdxs.length - 1) + ' extra admin row(s) for ' + ownerEmail);
      // Delete from bottom up to preserve row indices
      for (let d = matchingIdxs.length - 1; d >= 1; d--) {
        sh.deleteRow(matchingIdxs[d] + 1); // +1 because sheet rows are 1-indexed
      }
    }
    let rowIdx = matchingIdxs.length > 0 ? matchingIdxs[0] : -1;

    if (rowIdx === -1) {
      const newRow = new Array(rows[0].length).fill('');
      if (iUserId !== -1)    newRow[iUserId]    = internalUserId;
      if (iName !== -1)      newRow[iName]       = ownerName;
      newRow[iEmail]                             = ownerEmail;
      if (iRole !== -1)      newRow[iRole]       = 'ADMIN';
      newRow[iPerms]                             = basePerms;
      newRow[iPass]                              = defaultHash;
      if (iReset !== -1)     newRow[iReset]      = 'TRUE';
      if (iActive !== -1)    newRow[iActive]     = 'TRUE';
      if (iCreated !== -1)   newRow[iCreated]    = new Date();
      if (iIsTeacher !== -1) newRow[iIsTeacher]  = 'FALSE';
      if (iSubjects !== -1)  newRow[iSubjects]   = '[]';
      sh.appendRow(newRow);
      log('🔐 [SEED:DEBUG] Created new admin row with hash: ' + defaultHash);
      _safeCachePut(seedCacheKey, JSON.stringify({ ok:true, created:true }), 180);
      lock.releaseLock();
      return { success:true, created:true, email:ownerEmail, logs };
    }

    if (!healExisting) {
      _safeCachePut(seedCacheKey, JSON.stringify({ ok:true, changed:false, existing:true }), 180);
      lock.releaseLock();
      return { success:true, created:false, changed:false, existing:true, email:ownerEmail, logs };
    }

    const row = rows[rowIdx].slice();
    let changed = false;

    const storedPass  = String(row[iPass] || '').trim();
    const resetPending = iReset === -1 || String(row[iReset] || '').toUpperCase() !== 'FALSE';
    const isValidHash  = /^[0-9a-f]{64}$/.test(storedPass);

    // ── DEBUG ──────────────────────────────────────────────────────────────
    log('🔐 [SEED:DEBUG] ── Existing row check ──');
    log('🔐 [SEED:DEBUG] Stored hash   : ' + storedPass);
    log('🔐 [SEED:DEBUG] Expected hash : ' + defaultHash);
    log('🔐 [SEED:DEBUG] Hashes match  : ' + (storedPass === defaultHash));
    log('🔐 [SEED:DEBUG] Valid 64-char : ' + isValidHash);
    log('🔐 [SEED:DEBUG] Reset pending : ' + resetPending);
    // ──────────────────────────────────────────────────────────────────────

    const permsRaw = String(row[iPerms] || '').trim();
    const parsedPerms = parsePermissionsCell_(permsRaw);
    const hasGodModePerm = permsRaw.toUpperCase() === 'GODMODE' || !!(parsedPerms && parsedPerms.isGodMode);

    // Seed should only heal missing/invalid critical fields, not overwrite admin profile every load.
    if (!permsRaw || !hasGodModePerm)                                                      { row[iPerms] = basePerms; changed = true; }
    if (iUserId !== -1 && !String(row[iUserId] || '').trim())                              { row[iUserId] = internalUserId; changed = true; }
    if (iName !== -1 && ownerName && !String(row[iName] || '').trim())                    { row[iName] = ownerName; changed = true; }
    if (iRole !== -1 && String(row[iRole] || '').toUpperCase() !== 'ADMIN')             { row[iRole] = 'ADMIN'; changed = true; }
    if (iActive !== -1 && String(row[iActive] || '').toUpperCase() === 'FALSE')         { row[iActive] = 'TRUE'; changed = true; }
    // Preserve existing Reset_Req state for seed admin to avoid re-triggering reset loops.

    // Never overwrite an existing valid hash. Only heal missing/invalid password data.
    if (resetPending && (!storedPass || !isValidHash)) {
      log('🔐 [SEED:DEBUG] ⚠️ Missing/invalid hash while Reset_Req=TRUE — seeding hash to: ' + defaultHash);
      row[iPass] = defaultHash;
      changed = true;
    } else if (resetPending && storedPass !== defaultHash) {
      log('🔐 [SEED:DEBUG] Existing custom hash preserved while Reset_Req=TRUE (no overwrite).');
    }

    if (changed) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);

    _safeCachePut(seedCacheKey, JSON.stringify({ ok:true, changed:changed }), 180);

    lock.releaseLock();
    return { success:true, created:false, changed:changed, email:ownerEmail, logs };
  } catch(e) {
    log('🔐 [SEED:DEBUG] EXCEPTION: ' + e.message);
    try { lock.releaseLock(); } catch(_) {}
    return { success:false, error:e.message, logs };
  }
}
const SHEET_DEFS = [
  { name: 'students', headers: [
      'StudentCode','FirstName','LastName','Gender','BirthDate',
      'BirthPlace','Phone','Phone2','Email','Address',
      'FatherName','MotherName','ParentPhone','ParentEmail',
      'EmergencyContact','NISU','PhotoURL','PinHash',
      'EnrollmentStatus','Active','CreatedAt','UpdatedAt','CustomFields'
  ]},
  { name: 'studenthistory', headers: [
      'HistoryID','StudentID','SchoolYear','GradeLevelID',
      'Section','Status','DropReason','DropDate','Timestamp','UpdatedAt'
  ]},
  { name: 'grades', headers: [
      'GradeID','HistoryID','StudentID','GradeLevelID',
      'SubjectID','PeriodID','Score','TeacherID','ScoresJSON',
      'Timestamp','UpdatedAt'
  ]},
  { name: 'attendance', headers: [
      'RecordID','HistoryID','StudentID','GradeLevelID',
      'Date','Status','RecordedBy','MetaJSON'
  ]},
  { name: 'Finance', headers: [
      'ReceiptID','HistoryID','StudentID','StudentName',
      'Type','Amount','Cashier','Status','Notes','Date','Reference'
  ]},
  { name: 'auditlog', headers: [
      'Timestamp','Json'
  ]},
  { name: 'Users', headers: USERS_HEADERS },
  { name: 'Settings', headers: ['KEY','VALUE','LAST_UPDATED'] },
    { name: TEACHER_ASSIGNMENTS_SHEET_NAME, headers: [
      'AssignmentID','TeacherName','TeacherID','ClassName','ClassID','Subject',
      'Day','StartTime','EndTime','Hours','Rate','Salary','HasConflict',
      'Active','CreatedAt','UpdatedAt','MetaJSON'
    ]},
    { name: TIMETABLE_SHEET_NAME, headers: [
      'SlotID','ClassName','DayIndex','DayLabel','StartTime','EndTime','Subject',
      'Teacher','TeacherID','Conflict','Active','CreatedAt','UpdatedAt','MetaJSON'
    ]},
  { name: 'internal_notes', headers: [
      'NoteID','StudentID','Content','Author','AuthorRole',
      'CreatedAt','MetaJSON'
  ]}
];

const AI_CONFIG_SHEETS = {
  cycles: 'AI_LIB_CYCLES',
  levels: 'AI_LIB_LEVELS',
  subjects: 'AI_LIB_SUBJECTS',
  branches: 'AI_LIB_SUBJECT_BRANCHES',
  questions: 'AI_CONFIG_QUESTIONS',
  defaults: 'AI_CONFIG_DEFAULTS'
};

const AI_CONFIG_HEADERS = {
  cycles: ['cycle_key', 'cycle_label', 'display_order', 'is_active', 'notes'],
  levels: ['level_id', 'level_label', 'cycle_key', 'display_order', 'is_active'],
  subjects: ['subject_id', 'subject_label', 'cycle_key', 'apply_levels', 'coefficient', 'points', 'is_active', 'source', 'notes'],
  branches: ['branch_id', 'subject_id', 'branch_label', 'branch_max', 'apply_levels', 'branch_group', 'display_order', 'is_active'],
  questions: ['section_key', 'section_title', 'question_order', 'question_id', 'prompt', 'input_type', 'required', 'options_json', 'help_text', 'is_dynamic'],
  defaults: ['setting_key', 'default_value', 'description', 'category']
};

const AI_CHAT_LIBRARY_SHEET_NAME = 'AI_CHAT_LOGS';
const AI_CHAT_LIBRARY_HEADERS = [
  'Timestamp',
  'UserEmail',
  'ConversationId',
  'TurnId',
  'Role',
  'Message',
  'MessageJSON',
  'Model',
  'Provider',
  'TokensIn',
  'TokensOut',
  'MetaJSON'
];

function _resolveMasterAuthSpreadsheetId_() {
  // Priority order: explicit script properties -> hardcoded constant.
  try {
    var props = PropertiesService.getScriptProperties();
    var keys = ['MASTER_AUTH_ID', 'MASTER_SPREADSHEET_ID', 'AUTH_SPREADSHEET_ID', 'AI_MASTER_SPREADSHEET_ID'];
    for (var i = 0; i < keys.length; i++) {
      var v = String(props.getProperty(keys[i]) || '').trim();
      if (v) return v;
    }
  } catch (_e) {}
  return String(MASTER_AUTH_ID || MASTER_SPREADSHEET_ID || '').trim();
}

function _openMasterAuthSpreadsheet_() {
  var resolvedId = _resolveMasterAuthSpreadsheetId_();
  if (!resolvedId) throw new Error('MASTER_AUTH_ID non défini.');
  var ss = SpreadsheetApp.openById(resolvedId);
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('MASTER_AUTH_ID', resolvedId);
    props.setProperty('MASTER_SPREADSHEET_ID', resolvedId);
  } catch (_e) {}
  return ss;
}

function _slugifyAiToken_(value) {
  var s = String(value || '').trim().toLowerCase();
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_e) {}
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'item';
}

function _normalizeSeedRowWidth_(row, width) {
  var out = Array.isArray(row) ? row.slice(0, width) : [];
  while (out.length < width) out.push('');
  return out;
}

function _toBooleanLoose_(value, fallback) {
  if (value === true || value === false) return value;
  var txt = String(value == null ? '' : value).trim().toLowerCase();
  if (!txt) return !!fallback;
  if (txt === '1' || txt === 'true' || txt === 'yes' || txt === 'oui' || txt === 'on') return true;
  if (txt === '0' || txt === 'false' || txt === 'no' || txt === 'non' || txt === 'off') return false;
  return !!fallback;
}

function _getAiLibrarySpreadsheet_() {
  // AI config sheets (AI_LIB_*, AI_CONFIG_*) live in the dedicated AI memory spreadsheet.
  try {
    return SpreadsheetApp.openById(AI_MEMORY_SPREADSHEET_ID);
  } catch (_e) {
    Logger.log('AI Library: AI memory spreadsheet not accessible. ID=' + AI_MEMORY_SPREADSHEET_ID);
    return null;
  }
}

function _getAiChatLibrarySpreadsheet_() {
  // Chat memory lives in the dedicated AI memory spreadsheet.
  try {
    return SpreadsheetApp.openById(AI_MEMORY_SPREADSHEET_ID);
  } catch (_e) {
    Logger.log('AI Chat Library: AI memory spreadsheet not accessible. ID=' + AI_MEMORY_SPREADSHEET_ID);
    return null;
  }
}

function _ensureAiChatLibrarySheet_() {
  var ss = _getAiChatLibrarySpreadsheet_();
  if (!ss) {
    Logger.log('AI Chat Library: Master auth spreadsheet not accessible');
    return { success: false, error: 'Spreadsheet de bibliotheque chat introuvable.' };
  }
  Logger.log('AI Chat Library: Ensuring sheet ' + AI_CHAT_LIBRARY_SHEET_NAME + ' in spreadsheet ' + ss.getId());
  var sh = ensureStructuredSheet_(AI_CHAT_LIBRARY_SHEET_NAME, AI_CHAT_LIBRARY_HEADERS, ss);
  if (!sh) {
    Logger.log('AI Chat Library: Failed to create sheet ' + AI_CHAT_LIBRARY_SHEET_NAME);
    return { success: false, error: 'Impossible de creer la feuille AI_CHAT_LOGS.' };
  }
  Logger.log('AI Chat Library: Sheet created successfully');
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('AI_CHAT_LIBRARY_SPREADSHEET_ID', String(ss.getId() || ''));
    props.setProperty('AI_CHAT_LIBRARY_SHEET_NAME', AI_CHAT_LIBRARY_SHEET_NAME);
    props.setProperty('AI_CHAT_LIBRARY_SHEET_ID', String(sh.getSheetId() || ''));
  } catch (_e) {}
  return { success: true, ss: ss, sh: sh };
}

function _aiChatUserKey_(email) {
  return String(email || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function _aiChatActiveConversationPropKey_(email) {
  return 'AI_CHAT_ACTIVE_CONV_' + _aiChatUserKey_(email);
}

function _resolveAiConversationId_(email, requestedId, forceNew) {
  var props = PropertiesService.getScriptProperties();
  var key = _aiChatActiveConversationPropKey_(email);
  var requested = String(requestedId || '').trim();
  if (forceNew) {
    var fresh = Utilities.getUuid();
    props.setProperty(key, fresh);
    return fresh;
  }
  if (requested) {
    props.setProperty(key, requested);
    return requested;
  }
  var existing = String(props.getProperty(key) || '').trim();
  if (existing) return existing;
  var created = Utilities.getUuid();
  props.setProperty(key, created);
  return created;
}

// ── AI HISTORY CACHE KEY HELPER ───────────────────────────────────────────
function _aiHistoryCacheKey_(email, conversationId) {
  var e = String(email || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  var c = String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(-20);
  return 'AI_HIST_' + e + '_' + c;
}

function _appendAiChatLogEntry_(entry) {
  var role = String(entry && entry.role || '').trim().toLowerCase();
  if (role !== 'user' && role !== 'assistant') return false;

  var ensured = _ensureAiChatLibrarySheet_();
  if (!ensured || ensured.success === false) {
    Logger.log('AI Chat Log: Failed to ensure sheet - ' + (ensured && ensured.error));
    return false;
  }
  var messageText = String(entry && entry.message || '');
  var visibleMessage = _normalizeVisibleChatMessage_(role, messageText);
  if (!visibleMessage) return false;
  var sh = ensured.sh;
  var row = [
    new Date(),
    String(entry.userEmail || '').trim(),
    String(entry.conversationId || '').trim(),
    String(entry.turnId || '').trim(),
    role,
    visibleMessage,
    JSON.stringify(entry.messageJson || {}),
    String(entry.model || ''),
    String(entry.provider || ''),
    Number(entry.tokensIn || 0),
    Number(entry.tokensOut || 0),
    JSON.stringify(entry.meta || {})
  ];
  sh.appendRow(row);
  // ── INVALIDATE history cache so next load reflects the new row ────────
  try {
    var hKey = _aiHistoryCacheKey_(entry.userEmail, entry.conversationId);
    CacheService.getScriptCache().remove(hKey);
  } catch (_) {}
  return true;
}

function _loadAiConversationMessages_(email, conversationId, limit) {
  var cap = Math.max(1, Number(limit || 8));
  // ── CACHE READ: skip spreadsheet round-trip when cache is warm ────────
  var hKey = _aiHistoryCacheKey_(email, conversationId);
  try {
    var cached = CacheService.getScriptCache().get(hKey);
    if (cached) {
      var arr = JSON.parse(cached);
      return arr.slice(-cap);
    }
  } catch (_) {}

  var ensured = _ensureAiChatLibrarySheet_();
  if (!ensured || ensured.success === false) return [];
  var sh = ensured.sh;
  var last = sh.getLastRow();
  if (last <= 1) return [];

  // ── BATCH READ: fetch only the most recent rows (max 500) ─────────────
  var maxRows = Math.min(Math.max(last - 1, 1), 500);
  var start = Math.max(2, last - maxRows + 1);
  var data = sh.getRange(start, 1, last - start + 1, AI_CHAT_LIBRARY_HEADERS.length).getValues();
  var user = String(email || '').trim().toLowerCase();
  var conv = String(conversationId || '').trim();
  var messages = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowUser = String(row[1] || '').trim().toLowerCase();
    var rowConv = String(row[2] || '').trim();
    if (rowUser !== user || rowConv !== conv) continue;
    var role = String(row[4] || '').trim().toLowerCase();
    if (role !== 'user' && role !== 'assistant') continue;
    var text = _normalizeVisibleChatMessage_(role, String(row[5] || '')).trim();
    if (!role || !text) continue;
    messages.push({ role: role, content: text });
  }

  // ── CACHE WRITE: warm the cache for subsequent calls (5 min TTL) ──────
  try {
    var serialized = JSON.stringify(messages);
    if (serialized.length < 90000) { // CacheService 100KB limit
      CacheService.getScriptCache().put(hKey, serialized, 300);
    }
  } catch (_) {}

  return messages.slice(-cap);
}

function _listAiConversations_(email, limit) {
  var ensured = _ensureAiChatLibrarySheet_();
  if (!ensured || ensured.success === false) return [];
  var sh = ensured.sh;
  var last = sh.getLastRow();
  if (last <= 1) return [];

  var maxRows = Math.min(Math.max(last - 1, 1), 4000);
  var start = Math.max(2, last - maxRows + 1);
  var data = sh.getRange(start, 1, last - start + 1, AI_CHAT_LIBRARY_HEADERS.length).getValues();
  var user = String(email || '').trim().toLowerCase();
  var byConv = {};

  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowUser = String(row[1] || '').trim().toLowerCase();
    if (rowUser !== user) continue;
    var conv = String(row[2] || '').trim();
    var role = String(row[4] || '').trim();
    var text = String(row[5] || '').trim();
    if (!conv || !role || !text) continue;
    if (!byConv[conv]) {
      byConv[conv] = {
        conversationId: conv,
        lastMessageAt: row[0] || null,
        preview: text.slice(0, 140),
        messageCount: 0
      };
    }
    byConv[conv].messageCount += 1;
  }

  var out = Object.keys(byConv).map(function(k) { return byConv[k]; });
  out.sort(function(a, b) {
    var ta = a && a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    var tb = b && b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });
  return out.slice(0, Math.max(1, Number(limit || 20)));
}

function getAiChatConversationList_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canUse = viewer.isMaster || viewer.isGodMode || (viewer.permissions && viewer.permissions.p_use_ai);
  if (!canUse) return { success: false, error: 'Permission p_use_ai requise.' };
  var payload = (data && typeof data === 'object') ? data : {};
  return {
    success: true,
    items: _listAiConversations_(viewer.email, Number(payload.limit || 20))
  };
}

function _buildAiWelcomeMessage_(viewer) {
  var rawName = String((viewer && viewer.name) || '').trim();
  var firstName = rawName ? rawName.split(/\s+/)[0] : '';
  var role = String((viewer && viewer.role) || '').trim().toUpperCase();
  var school = String((viewer && viewer.orgName) || '').trim();
  if (!school || school === 'Mon Ecole') school = 'votre ecole';
  var userLabel = firstName || 'cher collegue';

  var roleLabel = 'membre de l\'equipe';
  if (role === 'DIRECTOR' || role === 'PRINCIPAL' || role === 'ADMIN') roleLabel = 'responsable';
  else if (role === 'TEACHER') roleLabel = 'enseignant';
  else if (role === 'STUDENT') roleLabel = 'eleve';

  return 'Bienvenue ' + userLabel + '. Je suis votre assistant EduHaiti pour ' + school + '. '
    + 'Je vois que vous etes connecte en tant que ' + roleLabel + '. '
    + 'Je peux vous aider sur les presences, notes, finances, bulletins et configuration. '
    + 'Que voulez-vous faire en premier ?';
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN OPTIMIZATIONS — Sliding-window summarization + LLMLingua-style compression
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _compressMessageContent_
 * Strip heavy markdown and structural blocks from a history message so it
 * consumes fewer tokens when re-sent as context.
 * Reduction target: ~50% (mirrors LLMLingua token-compression approach).
 */
function _compressMessageContent_(text) {
  if (!text) return '';
  var out = String(text);
  // Remove heavy structured blocks — they're executed, not needed in history
  out = out.replace(/\[CURRICULUM_DISPLAY\][\s\S]*?\[\/CURRICULUM_DISPLAY\]/gi, '[données curriculum]');
  out = out.replace(/\[AI_ACTION\][\s\S]*?\[\/AI_ACTION\]/gi, '[action exécutée]');
  // Collapse markdown decoration
  out = out.replace(/={3,}/g, '—');
  out = out.replace(/\*{2,}/g, '');
  out = out.replace(/#{1,6}\s*/g, '');
  // Collapse whitespace runs
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}

/**
 * _applyHistorySlidingWindow_
 * Implements sliding-window + extractive summarization:
 *   • Last 4 messages  → kept verbatim (at 300 chars each)
 *   • Older messages   → collapsed into a one-line summary prefix
 *   • Summary stored in proxyContext.historySummary to avoid recalculating
 *
 * This replaces the full-history resend pattern (was +40s / +60% tokens).
 * After: ~200 tokens/turn × 4 turns = ~800 tokens vs previous 16,000.
 */
function _applyHistorySlidingWindow_(messages, proxyContext) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  var WINDOW = 4;          // keep last N messages verbatim
  var MSG_CHARS = 300;     // max chars per verbatim message
  var SUMMARY_CHARS = 500; // max chars for the summary prefix

  if (messages.length <= WINDOW) {
    // Within window — just compress each message
    return messages.map(function(m) {
      return { role: m.role, content: _compressMessageContent_(String(m.content || '')).slice(0, MSG_CHARS) };
    });
  }

  var recent  = messages.slice(-WINDOW);
  var older   = messages.slice(0, -WINDOW);

  // Re-use a cached summary when it already covers the older segment
  var ctx = proxyContext || {};
  var existingSummary     = String(ctx.historySummary || '');
  var existingSummaryLen  = Number(ctx.historySummaryTurnCount || 0);

  var summary;
  if (existingSummary && existingSummaryLen >= older.length) {
    summary = existingSummary;
  } else {
    // Extractive: one line per older message (role + first 120 chars)
    var lines = older.map(function(m) {
      var roleLabel = m.role === 'assistant' ? 'IA' : 'User';
      return roleLabel + ': ' + _compressMessageContent_(String(m.content || '')).slice(0, 120);
    });
    summary = lines.join(' | ').slice(0, SUMMARY_CHARS);
    // Persist in proxyContext so the next turn doesn't recompute
    if (proxyContext) {
      proxyContext.historySummary         = summary;
      proxyContext.historySummaryTurnCount = older.length;
    }
  }

  var summaryMsg = { role: 'user', content: '[Résumé conversation précédente: ' + summary + ']' };
  var verbatim   = recent.map(function(m) {
    return { role: m.role, content: _compressMessageContent_(String(m.content || '')).slice(0, MSG_CHARS) };
  });
  return [summaryMsg].concat(verbatim);
}

function getAiChatConversation_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canUse = viewer.isMaster || viewer.isGodMode || (viewer.permissions && viewer.permissions.p_use_ai);
  if (!canUse) return { success: false, error: 'Permission p_use_ai requise.' };
  var payload = (data && typeof data === 'object') ? data : {};
  var requestedId = String(payload.conversationId || '').trim();
  var conversationId = _resolveAiConversationId_(viewer.email, requestedId, false);
  var history = _loadAiConversationMessages_(viewer.email, conversationId, Number(payload.limit || 30));
  if (!history.length && !requestedId) {
    var latest = _listAiConversations_(viewer.email, 1);
    if (latest && latest.length && latest[0].conversationId) {
      conversationId = _resolveAiConversationId_(viewer.email, String(latest[0].conversationId || '').trim(), false);
      history = _loadAiConversationMessages_(viewer.email, conversationId, Number(payload.limit || 30));
    }
  }
  history = (Array.isArray(history) ? history : []).map(function(m) {
    var role = String((m && m.role) || 'assistant');
    var content = _normalizeVisibleChatMessage_(role, String((m && (m.content || m.text)) || ''));
    return { role: role, content: content };
  }).filter(function(m) {
    return String(m.content || '').trim().length > 0;
  });
  if (!history.length && !requestedId) {
    var welcome = _buildAiWelcomeMessage_(viewer);
    history = [{ role: 'assistant', content: welcome }];
    try {
      _appendAiChatLogEntry_({
        userEmail: viewer.email,
        conversationId: conversationId,
        turnId: Utilities.getUuid(),
        role: 'assistant',
        message: welcome,
        messageJson: { role: 'assistant', text: welcome, at: new Date().toISOString(), kind: 'welcome' },
        model: 'system',
        provider: 'system',
        tokensIn: 0,
        tokensOut: 0,
        meta: { source: 'getAiChatConversation_', firstOpen: true }
      });
    } catch (_welcomeErr) {}
  }
  return {
    success: true,
    conversationId: conversationId,
    history: history
  };
}

function resetAiChatConversation_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canUse = viewer.isMaster || viewer.isGodMode || (viewer.permissions && viewer.permissions.p_use_ai);
  if (!canUse) return { success: false, error: 'Permission p_use_ai requise.' };
  var conversationId = _resolveAiConversationId_(viewer.email, '', true);
  writeAuditLog_('AI_CHAT_RESET', 'IA', 'Nouvelle conversation AI: ' + conversationId, 'p_use_ai');
  return { success: true, conversationId: conversationId, message: 'Nouvelle conversation creee.' };
}

function resetAiTokenSession_(data, auth) {
  var res = resetAiChatConversation_(data, auth);
  if (res && res.success) {
    res.sessionReset = true;
    res.message = 'Session IA réinitialisée.';
  }
  return res;
}

function getAiChatLibraryStatus_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canUse = viewer.isMaster || viewer.isGodMode || (viewer.permissions && viewer.permissions.p_use_ai);
  if (!canUse) return { success: false, error: 'Permission p_use_ai requise.' };

  var props = PropertiesService.getScriptProperties();
  var sheetId = String(props.getProperty('AI_CHAT_LIBRARY_SPREADSHEET_ID') || '').trim();
  var sheetName = String(props.getProperty('AI_CHAT_LIBRARY_SHEET_NAME') || '').trim();
  var sheetSid = String(props.getProperty('AI_CHAT_LIBRARY_SHEET_ID') || '').trim();
  var status = {
    sheetName: sheetName || AI_CHAT_LIBRARY_SHEET_NAME,
    spreadsheetId: sheetId || null,
    spreadsheetSheetId: sheetSid || null,
    exists: false,
    sheetAccessible: false,
    foundSheet: false
  };

  if (sheetId) {
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      status.exists = !!ss;
      if (ss) {
        var sh = ss.getSheetByName(status.sheetName);
        status.sheetAccessible = !!sh;
        status.foundSheet = !!sh;
      }
    } catch (e) {
      status.error = 'Impossible d ouvrir le classeur ID: ' + String(e && e.message || e);
    }
  }

  try {
    var defaultSs = _getAiChatLibrarySpreadsheet_();
    status.defaultSpreadsheetId = defaultSs ? String(defaultSs.getId() || '') : null;
  } catch (e) {
    status.defaultSpreadsheetError = String(e && e.message || e);
  }

  return { success: true, status: status };
}

function _readAiSheetRowsByHeader_(sheetName, expectedHeaders) {
  try {
    var ss = _getAiLibrarySpreadsheet_();
    if (!ss) return [];
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return [];
    var width = Math.max(sh.getLastColumn(), (expectedHeaders || []).length || 1);
    var values = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    if (!values || values.length < 2) return [];
    var header = values[0].map(function(v) { return String(v || '').trim(); });
    var rows = [];
    values.slice(1).forEach(function(r) {
      var rowObj = {};
      header.forEach(function(h, idx) { rowObj[h] = r[idx]; });
      if ((expectedHeaders || []).length) {
        expectedHeaders.forEach(function(h) {
          if (!(h in rowObj)) rowObj[h] = '';
        });
      }
      var hasAny = Object.keys(rowObj).some(function(k) { return String(rowObj[k] || '').trim() !== ''; });
      if (hasAny) rows.push(rowObj);
    });
    return rows;
  } catch (_e) {
    return [];
  }
}

function _normalizeLevelKeyForMatch_(value) {
  return _slugifyAiToken_(value).replace(/^sec_/, 'secondaire_');
}

function _getCycleForLevelKey_(levelKey) {
  var key = String(levelKey || '').trim();
  var keyNorm = _normalizeLevelKeyForMatch_(key);
  var lvlRows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.levels, AI_CONFIG_HEADERS.levels);
  for (var i = 0; i < lvlRows.length; i++) {
    var rid = String(lvlRows[i].level_id || '').trim();
    if (!rid) continue;
    if (_normalizeLevelKeyForMatch_(rid) === keyNorm) return String(lvlRows[i].cycle_key || '').trim();
  }
  if (keyNorm.indexOf('mat_') === 0 || keyNorm === 'maternelle') return 'maternelle';
  if (keyNorm.indexOf('fond_') === 0 || keyNorm === 'fondamental' || keyNorm === 'primaire') return 'fondamental';
  if (keyNorm.indexOf('sec_') === 0 || keyNorm.indexOf('secondaire_') === 0 || keyNorm === 'secondaire') return 'secondaire';
  if (keyNorm.indexOf('uni_l') === 0 || keyNorm === 'uni_licence') return 'uni_licence';
  if (keyNorm.indexOf('uni_m') === 0 || keyNorm === 'uni_master') return 'uni_master';
  if (keyNorm.indexOf('prof_c') === 0 || keyNorm === 'prof_cert') return 'prof_cert';
  if (keyNorm.indexOf('prof_d') === 0 || keyNorm === 'prof_dip') return 'prof_dip';
  return '';
}

function _appliesToLevel_(applyLevelsRaw, levelKey) {
  var applyRaw = String(applyLevelsRaw || '').trim();
  if (!applyRaw) return true;
  var needle = _normalizeLevelKeyForMatch_(levelKey);
  return applyRaw.split(',').map(function(v) { return _normalizeLevelKeyForMatch_(String(v || '').trim()); }).filter(Boolean).indexOf(needle) !== -1;
}

function _getAiCurriculumForLevelFromSheets_(levelKey) {
  var cycleKey = _getCycleForLevelKey_(levelKey);
  if (!cycleKey) return [];

  var subjectRows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.subjects, AI_CONFIG_HEADERS.subjects)
    .filter(function(r) {
      var isActive = _toBooleanLoose_(r.is_active, true);
      var rowCycle = String(r.cycle_key || '').trim();
      return isActive && rowCycle === cycleKey && _appliesToLevel_(r.apply_levels, levelKey);
    });
  if (!subjectRows.length) return [];

  var branchRows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.branches, AI_CONFIG_HEADERS.branches)
    .filter(function(r) {
      return _toBooleanLoose_(r.is_active, true) && _appliesToLevel_(r.apply_levels, levelKey);
    });

  var curriculum = subjectRows.map(function(sr) {
    var subjectId = String(sr.subject_id || '').trim();
    var localBranches = branchRows
      .filter(function(br) { return String(br.subject_id || '').trim() === subjectId; })
      .sort(function(a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); })
      .map(function(br) {
        var max = Number(br.branch_max);
        var branch = {
          label: String(br.branch_label || '').trim()
        };
        if (Number.isFinite(max)) branch.max = max;
        if (String(br.branch_group || '').trim()) branch.group = String(br.branch_group || '').trim();
        return branch;
      })
      .filter(function(br) { return !!br.label; });

    var coeff = Number(sr.coefficient);
    var points = Number(sr.points);
    var item = {
      id: subjectId || _slugifyAiToken_(sr.subject_label),
      subjectId: subjectId || _slugifyAiToken_(sr.subject_label),
      subject: String(sr.subject_label || '').trim(),
      label: String(sr.subject_label || '').trim(),
      branches: localBranches
    };
    if (Number.isFinite(coeff)) item.coeff = coeff;
    if (Number.isFinite(points)) item.points = points;
    return item;
  }).filter(function(it) { return !!it.subject; });

  return curriculum;
}

function getAiConfigurationAssistanceContext_(levelKeys, currentConfig) {
  // Load what's currently configured
  var configured = {};
  var chunkKeys = Object.keys(currentConfig || {}).filter(k => /^CURRICULUM_/i.test(String(k || '')));
  chunkKeys.forEach(function(key) {
    var chunk = currentConfig[key];
    if (typeof chunk === 'string') {
      try { chunk = JSON.parse(chunk); } catch(_e) { chunk = null; }
    }
    if (!chunk) return;
    if (Array.isArray(chunk)) {
      var levelId = String(key).replace(/^CURRICULUM_/i, '').toLowerCase();
      if (chunk.length) configured[levelId] = chunk;
    } else if (typeof chunk === 'object') {
      Object.keys(chunk).forEach(levelId => {
        if (Array.isArray(chunk[levelId]) && chunk[levelId].length) {
          configured[levelId] = chunk[levelId];
        }
      });
    }
  });

  // Load what's in the master library
  var libraryData = {};
  (Array.isArray(levelKeys) ? levelKeys : []).forEach(function(rawKey) {
    var levelKey = String(rawKey || '').trim();
    if (levelKey) {
      libraryData[levelKey] = _getAiCurriculumForLevelFromSheets_(levelKey) || [];
    }
  });

  // Build comparison
  var summary = {
    requestedLevels: Array.isArray(levelKeys) ? levelKeys : [],
    configuredLevels: Object.keys(configured),
    libraryLevels: Object.keys(libraryData),
    missingLevels: [],
    configured: configured,
    library: libraryData,
    recommendations: []
  };

  // Identify which levels are not yet configured
  (Array.isArray(levelKeys) ? levelKeys : []).forEach(function(key) {
    if (!configured[key]) {
      summary.missingLevels.push(key);
      summary.recommendations.push('Niveau ' + key + ' : pas encore configuré. Notre bibliothèque de référence propose ' + (libraryData[key] ? libraryData[key].length : 0) + ' matière(s) recommandées.');
    } else {
      var configCount = (configured[key] ? configured[key].length : 0);
      var libraryCount = (libraryData[key] ? libraryData[key].length : 0);
      if (configCount !== libraryCount) {
        summary.recommendations.push('Niveau ' + key + ' : actuellement ' + configCount + ' matière(s) configurée(s), mais ' + libraryCount + ' disponible(s) dans le master.');
      }
    }
  });

  return {
    success: true,
    data: summary,
    message: summary.missingLevels.length > 0
      ? ('Configuration secondaire incomplète : ' + summary.missingLevels.length + '/' + (Array.isArray(levelKeys) ? levelKeys.length : 0) + ' niveaux manquent. Complétez-la via l\'assistant de configuration.')
      : 'Configuration secondaire complète.'
  };
}

function _getAiConfigurationQuestionsFromSheets_() {
  var rows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.questions, AI_CONFIG_HEADERS.questions);
  if (!rows.length) return null;

  var grouped = {};
  rows.sort(function(a, b) {
    var sa = String(a.section_key || '');
    var sb = String(b.section_key || '');
    if (sa !== sb) return sa.localeCompare(sb);
    return Number(a.question_order || 0) - Number(b.question_order || 0);
  });

  rows.forEach(function(r) {
    var sectionKey = String(r.section_key || '').trim();
    if (!sectionKey) return;
    if (!grouped[sectionKey]) {
      grouped[sectionKey] = {
        title: String(r.section_title || sectionKey),
        questions: []
      };
    }

    var inputType = String(r.input_type || 'text').trim().toLowerCase();
    if (inputType === 'template') {
      grouped[sectionKey].questionTemplate = String(r.prompt || '').trim();
      grouped[sectionKey].instructions = String(r.help_text || '').trim();
      return;
    }

    var q = {
      id: String(r.question_id || '').trim() || (sectionKey + '_' + String(r.question_order || grouped[sectionKey].questions.length + 1)),
      prompt: String(r.prompt || '').trim(),
      type: inputType || 'text',
      required: _toBooleanLoose_(r.required, false)
    };
    if (String(r.options_json || '').trim()) {
      try {
        var parsed = JSON.parse(String(r.options_json));
        if (Array.isArray(parsed) && parsed.length) q.options = parsed;
      } catch (_e) {}
    }
    if (q.prompt) grouped[sectionKey].questions.push(q);
  });

  return Object.keys(grouped).length ? grouped : null;
}

function _getAiDefaultsMapFromSheets_() {
  var rows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.defaults, AI_CONFIG_HEADERS.defaults);
  if (!rows.length) return {};
  var out = {};
  rows.forEach(function(r) {
    var key = String(r.setting_key || '').trim();
    if (!key) return;
    var raw = r.default_value;
    var txt = String(raw == null ? '' : raw).trim();
    if (/^true$/i.test(txt)) out[key] = true;
    else if (/^false$/i.test(txt)) out[key] = false;
    else if (txt !== '' && !isNaN(Number(txt))) out[key] = Number(txt);
    else out[key] = txt;
  });
  return out;
}

function _getAiActiveLevelIdsFromSheets_() {
  var rows = _readAiSheetRowsByHeader_(AI_CONFIG_SHEETS.levels, AI_CONFIG_HEADERS.levels);
  if (!rows.length) return [];
  return rows
    .filter(function(r) { return _toBooleanLoose_(r.is_active, true); })
    .sort(function(a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); })
    .map(function(r) { return String(r.level_id || '').trim(); })
    .filter(Boolean);
}

function _getAiCycleRows_() {
  return [
    ['maternelle', 'Maternelle', 1, true, 'Cycle prescolaire'],
    ['fondamental', 'Fondamental', 2, true, '1AF a 9AF'],
    ['secondaire', 'Secondaire', 3, true, 'NS1 a NS4'],
    ['uni_licence', 'Universite Licence', 4, true, 'L1 a L4'],
    ['uni_master', 'Universite Master', 5, true, 'M1 a M2'],
    ['prof_cert', 'Professionnel Certificat', 6, true, 'Certificats professionnels'],
    ['prof_dip', 'Professionnel Diplome', 7, true, 'Diplomes professionnels']
  ];
}

function _getAiLevelRows_() {
  return [
    ['mat_k1', '1re Annee Kindergarten (K1)', 'maternelle', 1, true],
    ['mat_k2', '2me Annee Kindergarten (K2)', 'maternelle', 2, true],
    ['mat_k3', '3me Annee Kindergarten (K3)', 'maternelle', 3, true],
    ['fond_1af', '1re AF', 'fondamental', 1, true],
    ['fond_2af', '2me AF', 'fondamental', 2, true],
    ['fond_3af', '3me AF', 'fondamental', 3, true],
    ['fond_4af', '4me AF', 'fondamental', 4, true],
    ['fond_5af', '5me AF', 'fondamental', 5, true],
    ['fond_6af', '6me AF', 'fondamental', 6, true],
    ['fond_7af', '7me AF', 'fondamental', 7, true],
    ['fond_8af', '8me AF', 'fondamental', 8, true],
    ['fond_9af', '9me AF', 'fondamental', 9, true],
    ['sec_ns1', 'NS1', 'secondaire', 1, true],
    ['sec_ns2', 'NS2', 'secondaire', 2, true],
    ['sec_ns3', 'NS3', 'secondaire', 3, true],
    ['sec_ns4', 'NS4', 'secondaire', 4, true],
    ['uni_l1', 'Licence 1', 'uni_licence', 1, true],
    ['uni_l2', 'Licence 2', 'uni_licence', 2, true],
    ['uni_l3', 'Licence 3', 'uni_licence', 3, true],
    ['uni_l4', 'Licence 4', 'uni_licence', 4, true],
    ['uni_m1', 'Master 1', 'uni_master', 1, true],
    ['uni_m2', 'Master 2', 'uni_master', 2, true],
    ['prof_c1', 'Certificat Niveau 1', 'prof_cert', 1, true],
    ['prof_c2', 'Certificat Niveau 2', 'prof_cert', 2, true],
    ['prof_d1', 'Diplome Technique 1', 'prof_dip', 1, true],
    ['prof_d2', 'Diplome Technique 2', 'prof_dip', 2, true]
  ];
}

// ─── FULL FRONTEND CURRICULUM (mirrors SUBJECT_REGISTRY + LEVEL_REGISTRY in school.html) ───────
var FRONTEND_CURRICULUM_ = (function() {
  var cycleLevels = {
    maternelle: 'mat_k1,mat_k2,mat_k3',
    fondamental: 'fond_1af,fond_2af,fond_3af,fond_4af,fond_5af,fond_6af,fond_7af,fond_8af,fond_9af',
    secondaire: 'sec_ns1,sec_ns2,sec_ns3,sec_ns4',
    uni_licence: 'uni_l1,uni_l2,uni_l3,uni_l4',
    uni_master: 'uni_m1,uni_m2',
    prof_cert: 'prof_c1,prof_c2',
    prof_dip: 'prof_d1,prof_d2'
  };
  var registry = {
    mat: {
      langage:          { id:'mat_langage',          label:'Langage',                   group:'intellectuel',   points:0 },
      pre_lecture:      { id:'mat_pre_lecture',      label:'Pré-lecture',               group:'intellectuel',   points:0 },
      pre_ecriture:     { id:'mat_pre_ecriture',     label:'Pré-écriture',              group:'intellectuel',   points:0 },
      pre_calcul:       { id:'mat_pre_calcul',       label:'Pré-calcul',                group:'intellectuel',   points:0 },
      poesie:           { id:'mat_poesie',           label:'Poésie',                    group:'intellectuel',   points:0 },
      chant:            { id:'mat_chant',            label:'Chant',                     group:'intellectuel',   points:0 },
      contes:           { id:'mat_contes',           label:'Contes',                    group:'intellectuel',   points:0 },
      histoire_mat:     { id:'mat_histoire',         label:'Histoire',                  group:'intellectuel',   points:0 },
      rythmes:          { id:'mat_rythmes',          label:'Rythmes',                   group:'sensori_moteur', points:0 },
      exercices_sens:   { id:'mat_exercices_sens',   label:'Exercices sensoriels',      group:'sensori_moteur', points:0 },
      travaux_manuels:  { id:'mat_travaux_manuels',  label:'Travaux manuels',           group:'sensori_moteur', points:0 },
      coloriage:        { id:'mat_coloriage',        label:'Coloriage',                 group:'sensori_moteur', points:0 },
      peinture:         { id:'mat_peinture',         label:'Peinture',                  group:'sensori_moteur', points:0 },
      dessin:           { id:'mat_dessin',           label:'Dessin',                    group:'sensori_moteur', points:0 },
      modelage:         { id:'mat_modelage',         label:'Modelage',                  group:'sensori_moteur', points:0 },
      culture_physique: { id:'mat_culture_physique', label:'Culture physique',          group:'sensori_moteur', points:0 },
      jeux_libres:      { id:'mat_jeux_libres',      label:'Jeux libres',               group:'sensori_moteur', points:0 },
      obeissance:       { id:'mat_obeissance',       label:'Obéissance',                group:'moral',          points:0 },
      respect:          { id:'mat_respect',          label:'Respect',                   group:'moral',          points:0 },
      discipline:       { id:'mat_discipline',       label:'Discipline',                group:'moral',          points:0 },
      volonte:          { id:'mat_volonte',          label:'Volonté',                   group:'moral',          points:0 },
      langage_usage:    { id:'mat_langage_usage',    label:'Utilisation du langage',    group:'moral',          points:0 },
      prononciation:    { id:'mat_prononciation',    label:'Bonne prononciation',       group:'moral',          points:0 },
      calme:            { id:'mat_calme',            label:'Calme',                     group:'moral',          points:0 },
      attentif:         { id:'mat_attentif',         label:'Attentif',                  group:'moral',          points:0 },
      poli:             { id:'mat_poli',             label:'Poli(e)',                   group:'moral',          points:0 },
      gentil:           { id:'mat_gentil',           label:'Gentil(le)',                group:'moral',          points:0 },
      education_morale: { id:'mat_education_morale', label:'Éducation morale',          group:'moral',          points:0 }
    },
    fond: {
      comm_fr:         { id:'fond_comm_fr',   label:'COMMUNICATION FRANÇAISE',     group:'principal',   coeff:500, branches:[{label:'Lecture / Compréhension',max:100},{label:'Grammaire / Conjugaison',max:100},{label:'Orthographe / Dictée',max:100},{label:'Production écrite',max:100},{label:'Poésie / Récitation',max:100}] },
      mathematiques:   { id:'fond_math',      label:'MATHÉMATIQUES',               group:'principal',   coeff:500, branches:[{label:'Numération',max:100},{label:'Opérations',max:100},{label:'Problèmes',max:100},{label:'Calcul mental',max:100},{label:'Géométrie',max:100}] },
      sciences:        { id:'fond_sciences',  label:'SCIENCES EXPÉRIMENTALES',     group:'principal',   coeff:300, branches:[{label:'Le corps humain',max:100},{label:'Les plantes',max:100},{label:'Les animaux',max:100},{label:'Environnement',max:100}] },
      sciences_sociales:{id:'fond_sc_soc',   label:'SCIENCES SOCIALES',           group:'principal',   coeff:300, branches:[{label:'Histoire',max:100},{label:'Géographie',max:100},{label:'Éducation civique',max:100}] },
      comm_creole:     { id:'fond_creole',    label:'COMMUNICATION CRÉOLE',        group:'principal',   coeff:200, branches:[{label:'Lecture',max:100},{label:'Expression écrite',max:100}] },
      anglais:         { id:'fond_anglais',   label:'ANGLAIS',                     group:'secondaire',  coeff:200 },
      espagnol:        { id:'fond_espagnol',  label:'ESPAGNOL',                    group:'secondaire',  coeff:200 },
      informatique:    { id:'fond_info',      label:'INFORMATIQUE',                group:'secondaire',  coeff:100 },
      education_chretienne: { id:'fond_ed_chret', label:'ÉDUCATION CHRÉTIENNE',  group:'secondaire',  coeff:100 },
      sport:           { id:'fond_sport',     label:'ÉDUCATION PHYSIQUE',         group:'secondaire',  coeff:100 },
      dessin:          { id:'fond_dessin',    label:'DESSIN',                      group:'secondaire',  coeff:100 },
      art:             { id:'fond_art',       label:'ÉDUCATION ARTISTIQUE',       group:'secondaire',  coeff:100 },
      conduite:        { id:'fond_conduite',  label:'CONDUITE',                    group:'formation',   coeff:0   }
    },
    sec: {
      francais:        { id:'sec_fr',      label:'FRANÇAIS',              group:'principal', coeff:300, branches:[{label:'Grammaire / Syntaxe',max:100},{label:'Contraction de texte',max:100},{label:'Expression écrite',max:100}] },
      litterature:     { id:'sec_lit',     label:'LITTÉRATURE',           group:'principal', coeff:200, branches:[{label:'Littérature Française',max:100},{label:'Littérature Haïtienne',max:100}] },
      philosophie:     { id:'sec_philo',   label:'PHILOSOPHIE',           group:'principal', coeff:200, branches:[{label:'Étude de texte',max:100},{label:'Dissertation',max:100}] },
      math:            { id:'sec_math',    label:'MATHÉMATIQUES',         group:'principal', coeff:500, branches:[{label:'Algèbre',max:100},{label:'Trigonométrie',max:100},{label:'Fonctions',max:100},{label:'Statistiques',max:100},{label:'Analyse',max:100}] },
      physique:        { id:'sec_phy',     label:'PHYSIQUE',              group:'principal', coeff:400, branches:[{label:'Mécanique',max:100},{label:'Électricité',max:100},{label:'Optique',max:100},{label:'Énergie',max:100},{label:'Magnétisme',max:100}] },
      chimie:          { id:'sec_chimie',  label:'CHIMIE',                group:'principal', coeff:400, branches:[{label:'Chimie générale',max:100},{label:'Chimie organique',max:100},{label:'Chimie minérale',max:100},{label:'Chimie physique',max:100}] },
      svt:             { id:'sec_svt',     label:'SVT',                   group:'principal', coeff:400, branches:[{label:'Biologie',max:100},{label:'Génétique',max:100},{label:'Écologie',max:100},{label:'Anatomie',max:100}] },
      sciences_sociales:{id:'sec_sc_soc', label:'SCIENCES SOCIALES',     group:'principal', coeff:300, branches:[{label:'Histoire',max:100},{label:'Géographie',max:100},{label:'Économie',max:100},{label:'Civisme',max:100}] },
      anglais:         { id:'sec_anglais', label:'ANGLAIS',               group:'secondaire', coeff:200 },
      espagnol:        { id:'sec_espagnol',label:'ESPAGNOL',              group:'secondaire', coeff:200 },
      informatique:    { id:'sec_info',    label:'INFORMATIQUE',          group:'secondaire', coeff:100 },
      education_civique:{id:'sec_civ',    label:'ÉDUCATION CIVIQUE',     group:'secondaire', coeff:100 },
      sport:           { id:'sec_sport',   label:'ÉDUCATION PHYSIQUE',   group:'secondaire', coeff:100 },
      conduite:        { id:'sec_conduite',label:'CONDUITE',              group:'formation',  coeff:0   },
      art:             { id:'sec_art',     label:'ÉDUCATION ARTISTIQUE', group:'secondaire', coeff:100 },
      compta:          { id:'sec_compta',  label:'COMPTABILITÉ / ÉCONOMIE',group:'secondaire',coeff:200 },
      geologie:        { id:'sec_geologie',label:'GÉOLOGIE',              group:'secondaire', coeff:100 }
    },
    uni_licence: {
      methodologie: { id:'uni_methodo',    label:'Méthodologie Universitaire',      points:3 },
      communication:{ id:'uni_comm',       label:'Communication Professionnelle',   points:3 },
      informatique: { id:'uni_info',       label:'Informatique Appliquée',          points:3 },
      droit_intro:  { id:'uni_droit',      label:'Introduction au Droit',           points:4 },
      economie:     { id:'uni_eco',        label:'Économie Générale',               points:4 }
    },
    uni_master: {
      recherche:  { id:'uni_recherche',  label:'Séminaire de Recherche',  points:5  },
      memoire:    { id:'uni_memoire',    label:'Préparation Mémoire',     points:10 },
      management: { id:'uni_management', label:'Management Stratégique',  points:4  }
    },
    prof_cert: {
      pratique: { id:'prof_pratique',  label:'Atelier Pratique',              points:100 },
      theorie:  { id:'prof_theorie',   label:'Théorie du Métier',             points:100 },
      securite: { id:'prof_securite',  label:'Santé et Sécurité au Travail', points:50  },
      stage:    { id:'prof_stage',     label:'Stage en Entreprise',           points:200 }
    },
    prof_dip: {
      gestion_projet: { id:'prof_projet',     label:'Gestion de Projet',       points:100 },
      specialite:     { id:'prof_specialite', label:'Technique de Spécialité', points:200 },
      stage_pro:      { id:'prof_stage_pro',  label:'Stage Professionnel',     points:200 }
    }
  };
  var cycleMap = { mat:'maternelle', fond:'fondamental', sec:'secondaire', uni_licence:'uni_licence', uni_master:'uni_master', prof_cert:'prof_cert', prof_dip:'prof_dip' };
  return { registry: registry, cycleLevels: cycleLevels, cycleMap: cycleMap };
})();

function _buildAiSubjectAndBranchRows_() {
  var subjects = [];
  var branches = [];

  var fc = FRONTEND_CURRICULUM_;
  var registry = fc.registry;
  var cycleLevels = fc.cycleLevels;
  var cycleMap = fc.cycleMap;

  Object.keys(registry).forEach(function(regKey) {
    var cycleKey = cycleMap[regKey] || regKey;
    var levelStr = cycleLevels[cycleKey] || '';
    var cycleSubjects = registry[regKey];
    Object.keys(cycleSubjects).forEach(function(subKey) {
      var item = cycleSubjects[subKey];
      if (!item || !item.id) return;
      var coeff = item.coeff != null ? item.coeff : '';
      var points = item.points != null ? item.points : '';
      var group = String(item.group || '').trim();
      subjects.push([
        item.id,
        item.label,
        cycleKey,
        levelStr,
        coeff,
        points,
        true,
        'frontend_registry',
        group
      ]);
      if (Array.isArray(item.branches)) {
        item.branches.forEach(function(b, idx) {
          var bl = String((b && b.label) || '').trim();
          if (!bl) return;
          branches.push([
            item.id + '__' + (idx + 1),
            item.id,
            bl,
            b.max != null ? b.max : '',
            levelStr,
            group,
            idx + 1,
            true
          ]);
        });
      }
    });
  });

  return { subjects: subjects, branches: branches };
}

function _DEPRECATED_buildAiSubjectAndBranchRows_legacy_() {
  // Kept for reference only; no longer called
  var subjects = [];
  var branches = [];
  var cycleLevels = {
    maternelle: 'mat_ps,mat_ms,mat_gs,mat_h1,mat_h2',
    fondamental: 'fond_1af,fond_2af,fond_3af,fond_4af,fond_5af,fond_6af,fond_7af,fond_8af,fond_9af',
    secondaire: 'sec_ns1,sec_ns2,sec_ns3,sec_ns4',
    uni_licence: 'uni_l1,uni_l2,uni_l3,uni_l4',
    uni_master: 'uni_m1,uni_m2',
    prof_cert: 'prof_c1,prof_c2',
    prof_dip: 'prof_d1,prof_d2'
  };

  var addSubject = function(cycleKey, label, coefficient, points, src, note, branchDefs) {
    var subjectId = cycleKey + '_' + _slugifyAiToken_(label);
    subjects.push([
      subjectId,
      label,
      cycleKey,
      cycleLevels[cycleKey] || '',
      coefficient == null ? '' : coefficient,
      points == null ? '' : points,
      true,
      src || 'library',
      note || ''
    ]);
    (Array.isArray(branchDefs) ? branchDefs : []).forEach(function(b, idx) {
      var branchLabel = String((b && b.label) || '').trim();
      if (!branchLabel) return;
      var max = (b && b.max != null) ? b.max : '';
      branches.push([
        subjectId + '__' + (idx + 1),
        subjectId,
        branchLabel,
        max,
        cycleLevels[cycleKey] || '',
        String((b && b.group) || '').trim(),
        idx + 1,
        true
      ]);
    });
  };

  _getDefaultCurriculumForLevel_('maternelle').forEach(function(item) {
    addSubject('maternelle', item.subject, '', '', 'library', 'Curriculum maternelle', item.branches || []);
  });

  _getDefaultCurriculumForLevel_('fondamental').forEach(function(item) {
    addSubject('fondamental', item.subject, item.coeff || '', '', 'library', 'Curriculum fondamental', item.branches || []);
  });

  _getDefaultCurriculumForLevel_('sec_ns4').forEach(function(item) {
    addSubject('secondaire', item.subject, item.coeff || '', '', 'library', 'Curriculum secondaire', item.branches || []);
  });

  addSubject('uni_licence', 'Methodologie Universitaire', '', 3, 'library', 'Catalogue universite licence', []);
  addSubject('uni_licence', 'Communication Professionnelle', '', 3, 'library', 'Catalogue universite licence', []);
  addSubject('uni_licence', 'Informatique Appliquee', '', 3, 'library', 'Catalogue universite licence', []);
  addSubject('uni_licence', 'Introduction au Droit', '', 4, 'library', 'Catalogue universite licence', []);
  addSubject('uni_licence', 'Economie Generale', '', 4, 'library', 'Catalogue universite licence', []);
  addSubject('uni_master', 'Seminaire de Recherche', '', 5, 'library', 'Catalogue universite master', []);
  addSubject('uni_master', 'Preparation Memoire', '', 10, 'library', 'Catalogue universite master', []);
  addSubject('uni_master', 'Management Strategique', '', 4, 'library', 'Catalogue universite master', []);
  addSubject('prof_cert', 'Atelier Pratique', '', 100, 'library', 'Catalogue professionnel certificat', []);
  addSubject('prof_cert', 'Theorie du Metier', '', 100, 'library', 'Catalogue professionnel certificat', []);
  addSubject('prof_cert', 'Sante et Securite au Travail', '', 50, 'library', 'Catalogue professionnel certificat', []);
  addSubject('prof_cert', 'Stage en Entreprise', '', 200, 'library', 'Catalogue professionnel certificat', []);
  addSubject('prof_dip', 'Gestion de Projet', '', 100, 'library', 'Catalogue professionnel diplome', []);
  addSubject('prof_dip', 'Technique de Specialite', '', 200, 'library', 'Catalogue professionnel diplome', []);
  addSubject('prof_dip', 'Stage Professionnel', '', 200, 'library', 'Catalogue professionnel diplome', []);

  var branchTemplates = {
    fondamental_francais: [
      { label: 'Lecture / Comprehension', max: 100 },
      { label: 'Grammaire / Conjugaison', max: 100 },
      { label: 'Orthographe / Dictee', max: 100 },
      { label: 'Production ecrite', max: 100 },
      { label: 'Poesie / Recitation', max: 100 }
    ],
    fondamental_mathematiques: [
      { label: 'Numeration', max: 100 },
      { label: 'Operations', max: 100 },
      { label: 'Problemes', max: 100 },
      { label: 'Calcul mental', max: 100 },
      { label: 'Geometrie', max: 100 }
    ],
    secondaire_mathematiques: [
      { label: 'Algebre', max: 100 },
      { label: 'Trigonometrie', max: 100 },
      { label: 'Fonctions', max: 100 },
      { label: 'Statistiques', max: 100 },
      { label: 'Analyse', max: 100 }
    ]
  };

  Object.keys(branchTemplates).forEach(function(subjectId) {
    var exists = branches.some(function(row) { return String(row[1]) === subjectId; });
    if (exists) return;
    branchTemplates[subjectId].forEach(function(b, idx) {
      branches.push([
        subjectId + '__' + (idx + 1),
        subjectId,
        b.label,
        b.max,
        '',
        '',
        idx + 1,
        true
      ]);
    });
  });

  return { subjects: subjects, branches: branches };
} // end _DEPRECATED_buildAiSubjectAndBranchRows_legacy_

function _buildAiQuestionRows_() {
  var rows = [];
  var sections = {};
  try {
    sections = (typeof _getConfigurationQuestions_ === 'function') ? (_getConfigurationQuestions_() || {}) : {};
  } catch (_e) {
    sections = {};
  }
  var keys = Object.keys(sections || {});
  var sectionOrder = 0;
  keys.forEach(function(sectionKey) {
    sectionOrder++;
    var section = sections[sectionKey] || {};
    var sectionTitle = String(section.title || sectionKey);
    var qOrder = 0;
    (Array.isArray(section.questions) ? section.questions : []).forEach(function(q) {
      qOrder++;
      rows.push([
        sectionKey,
        sectionTitle,
        qOrder,
        String(q.id || (sectionKey + '_' + qOrder)),
        String(q.prompt || ''),
        String(q.type || 'text'),
        !!q.required,
        q.options ? JSON.stringify(q.options) : '',
        '',
        false
      ]);
    });
    if (section.questionTemplate) {
      qOrder++;
      rows.push([
        sectionKey,
        sectionTitle,
        qOrder,
        sectionKey + '_template',
        String(section.questionTemplate),
        'template',
        true,
        '',
        String(section.instructions || ''),
        true
      ]);
    }
  });

  if (!rows.length) {
    rows.push([
      'academic',
      'Structure academique',
      1,
      'period_passing_avg',
      'Moyenne minimale de passage par periode ?',
      'number',
      true,
      '',
      'Exemple: 50 sur 100 ou 5 sur 10',
      false
    ]);
  }
  return rows;
}

function _getAiDefaultRows_() {
  return [
    ['SCORE_SCALE', '100', 'Echelle de notation par defaut', 'evaluation'],
    ['NUM_PERIODS', '3', 'Nombre de periodes annuelles', 'evaluation'],
    ['PERIOD_PASSING_AVG', '50', 'Moyenne minimale de passage par periode', 'evaluation'],
    ['MIN_ADJOURN_AVG', '50', 'Moyenne minimale d adjournement', 'evaluation'],
    ['PROMOTION_MIN_AVG', '59.9', 'Moyenne generale minimale de promotion', 'evaluation'],
    ['ATTENDANCE_USE_SCHEDULE', 'true', 'Utiliser affectations pour heure de debut', 'attendance'],
    ['NO_CLASS_WEEKDAYS_AUTO', '1', 'Detection automatique jours sans cours', 'attendance'],
    ['NO_CLASS_WEEKDAYS', '', 'Liste manuelle des jours sans cours', 'attendance'],
    ['AI_CONFIG_READY', 'true', 'Bibliotheque AI prete pour entretien guide', 'ai']
  ];
}

function ensureAiConfigurationLibrarySheets_(ssInput, options) {
  var ss = ssInput || _getAiLibrarySpreadsheet_();
  if (!ss) return { success: false, error: 'Spreadsheet introuvable.' };
  var opts = (options && typeof options === 'object') ? options : {};
  var force = !!opts.force;
  var subjectData = _buildAiSubjectAndBranchRows_();
  var datasets = [
    { key: 'cycles', sheet: AI_CONFIG_SHEETS.cycles, headers: AI_CONFIG_HEADERS.cycles, rows: _getAiCycleRows_() },
    { key: 'levels', sheet: AI_CONFIG_SHEETS.levels, headers: AI_CONFIG_HEADERS.levels, rows: _getAiLevelRows_() },
    { key: 'subjects', sheet: AI_CONFIG_SHEETS.subjects, headers: AI_CONFIG_HEADERS.subjects, rows: subjectData.subjects },
    { key: 'branches', sheet: AI_CONFIG_SHEETS.branches, headers: AI_CONFIG_HEADERS.branches, rows: subjectData.branches },
    { key: 'questions', sheet: AI_CONFIG_SHEETS.questions, headers: AI_CONFIG_HEADERS.questions, rows: _buildAiQuestionRows_() },
    { key: 'defaults', sheet: AI_CONFIG_SHEETS.defaults, headers: AI_CONFIG_HEADERS.defaults, rows: _getAiDefaultRows_() }
  ];

  var summary = {};
  datasets.forEach(function(ds) {
    var sh = ensureStructuredSheet_(ds.sheet, ds.headers, ss);
    var hasData = sh.getLastRow() > 1;
    var shouldSeed = force || !hasData;
    if (shouldSeed) {
      if (sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), ds.headers.length)).clearContent();
      }
      if (ds.rows.length) {
        var normalized = ds.rows.map(function(r) { return _normalizeSeedRowWidth_(r, ds.headers.length); });
        sh.getRange(2, 1, normalized.length, ds.headers.length).setValues(normalized);
      }
    }
    summary[ds.key] = {
      sheet: ds.sheet,
      seeded: shouldSeed,
      rows: Math.max(sh.getLastRow() - 1, 0)
    };
  });
  return { success: true, summary: summary };
}

function initAiConfigurationLibrary_(data, auth) {
  var opts = (data && typeof data === 'object') ? data : {};
  var force = !!opts.force;
  // AI config sheets always live in the auth spreadsheet (MASTER_AUTH_ID)
  var ss = _openMasterAuthSpreadsheet_();
  if (!ss) return { success: false, error: 'Spreadsheet auth introuvable.' };

  var seeded = ensureAiConfigurationLibrarySheets_(ss, { force: force });
  if (!seeded || seeded.success === false) {
    return seeded || { success: false, error: 'Initialisation echouee.' };
  }
  writeAuditLog_('INIT_AI_CONFIG_LIBRARY', 'MASTER_AUTH', 'Initialisation des feuilles AI dans ' + ss.getId(), 'pa_save_settings');
  return {
    success: true,
    target: 'master_auth',
    spreadsheetId: ss.getId(),
    summary: seeded.summary,
    message: 'Feuilles AI creees et initialisees dans le spreadsheet auth.'
  };
}

function initAiMasterSheets_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canManage = viewer.isMaster || viewer.isGodMode || (viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings));
  if (!canManage) return { success: false, error: 'Droits insuffisants.' };

  try {
    var result = _initAiMasterSheetsStrict_(true); // force=true to ensure creation
    return result;
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

function forceInitAiMasterSheets_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  var canManage = viewer.isMaster || viewer.isGodMode || (viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings));
  if (!canManage) return { success: false, error: 'Droits insuffisants.' };

  var force = !!(data && data.force);
  try {
    var result = _initAiMasterSheetsStrict_(force);
    return {
      success: true,
      message: 'Initialisation forcée des feuilles AI réussie.',
      resolvedMasterSpreadsheetId: String(_resolveMasterAuthSpreadsheetId_() || ''),
      aiMemorySpreadsheetId: AI_MEMORY_SPREADSHEET_ID,
      aiInit: result
    };
  } catch (e) {
    return {
      success: false,
      error: String(e && e.message || e),
      resolvedMasterSpreadsheetId: String(_resolveMasterAuthSpreadsheetId_() || ''),
      aiMemorySpreadsheetId: AI_MEMORY_SPREADSHEET_ID,
      aiInit: {
        success: false,
        error: String(e && e.message || e),
        spreadsheetId: AI_MEMORY_SPREADSHEET_ID
      }
    };
  }
}

// ============================================================
// ERROR HANDLING & BEAUTIFUL ALERTS
// ============================================================
const ERROR_CONFIG = {
  contactPhone: '+509 36 21 40 67',
  contactEmail: 'support@meigens.tech',
  companyName: 'Meigens Tech',
  supportHours: 'Lun-Ven: 8h-18h (HT)'
};

/**
 * Generates a beautiful error HTML page with contact information
 * @param {string} title Main error title (e.g., "Accès Bloqué")
 * @param {string} message Detailed error message
 * @param {string} errorCode Optional error code reference
 * @return {HtmlOutput} Beautiful error page
 */
function createBeautifulErrorPage(title, message, errorCode) {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title || 'Erreur'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      overflow: hidden;
      animation: slideIn 0.4s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateY(30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .error-header {
      background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
      padding: 40px 30px;
      color: white;
      text-align: center;
    }
    .error-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
    }
    .error-title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    .error-subtitle {
      font-size: 14px;
      opacity: 0.95;
      font-weight: 400;
    }
    .error-body {
      padding: 40px 30px;
    }
    .error-message {
      background: #f8fafc;
      border-left: 4px solid #f43f5e;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      font-size: 15px;
      color: #1e293b;
      line-height: 1.6;
    }
    .error-code {
      background: #0f172a;
      color: #94a3b8;
      padding: 12px 16px;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      margin-bottom: 30px;
      word-break: break-all;
    }
    .support-section {
      background: linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);
      border: 1px solid #0284c7;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .support-title {
      font-size: 16px;
      font-weight: 700;
      color: #0c4a6e;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .support-title::before {
      content: "📞";
      font-size: 20px;
    }
    .contact-item {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 14px;
      color: #0c4a6e;
    }
    .contact-item:last-child {
      margin-bottom: 0;
    }
    .contact-label {
      font-weight: 600;
      min-width: 60px;
    }
    .contact-value {
      color: #0284c7;
      font-weight: 700;
    }
    .phone-link {
      color: #0284c7;
      text-decoration: none;
      font-weight: 700;
      transition: color 0.2s;
    }
    .phone-link:hover {
      color: #0369a1;
    }
    .email-link {
      color: #0284c7;
      text-decoration: none;
      font-weight: 700;
      transition: color 0.2s;
    }
    .email-link:hover {
      color: #0369a1;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .info-box {
      background: #f1f5f9;
      padding: 16px;
      border-radius: 8px;
      text-align: center;
      border: 1px solid #cbd5e1;
    }
    .info-box-label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .info-box-value {
      font-size: 14px;
      color: #1e293b;
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 30px;
      flex-wrap: wrap;
    }
    .btn {
      flex: 1;
      min-width: 140px;
      padding: 12px 20px;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px rgba(102,126,234,0.4);
    }
    .btn-secondary {
      background: white;
      border: 2px solid #cbd5e1;
      color: #1e293b;
    }
    .btn-secondary:hover {
      border-color: #667eea;
      color: #667eea;
      background: #f8f9fb;
    }
    .footer {
      background: #f8fafc;
      padding: 20px 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
    }
    .footer a {
      color: #0284c7;
      text-decoration: none;
    }
    @media (max-width: 480px) {
      .error-header { padding: 30px 20px; }
      .error-body { padding: 25px 20px; }
      .error-title { font-size: 22px; }
      .info-grid { grid-template-columns: 1fr; }
      .actions { flex-direction: column; }
      .btn { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-header">
      <div class="error-icon">⚠️</div>
      <div class="error-title">${title || 'Une erreur est survenue'}</div>
      <div class="error-subtitle">Accès temporairement indisponible</div>
    </div>
    
    <div class="error-body">
      <div class="error-message">
        <strong>Détail:</strong> ${message || 'Une erreur inattendue s\'est produite.'}
      </div>
      
      ${errorCode ? '<div class="error-code">Code: ' + errorCode + '</div>' : ''}
      
      <div class="support-section">
        <div class="support-title">Besoin d'aide?</div>
        <div class="contact-item">
          <span class="contact-label">Téléphone:</span>
          <a href="tel:${ERROR_CONFIG.contactPhone.replace(/[^0-9+]/g, '')}" class="phone-link">${ERROR_CONFIG.contactPhone}</a>
        </div>
        <div class="contact-item">
          <span class="contact-label">Email:</span>
          <a href="mailto:${ERROR_CONFIG.contactEmail}" class="email-link">${ERROR_CONFIG.contactEmail}</a>
        </div>
        <div class="contact-item">
          <span class="contact-label">Heures:</span>
          <span class="contact-value">${ERROR_CONFIG.supportHours}</span>
        </div>
      </div>
      
      <div class="info-grid">
        <div class="info-box">
          <div class="info-box-label">Support</div>
          <div class="info-box-value">${ERROR_CONFIG.companyName}</div>
        </div>
        <div class="info-box">
          <div class="info-box-label">Heure</div>
          <div class="info-box-value">${new Date().toLocaleString('fr-HT', {hour: '2-digit', minute: '2-digit'})}</div>
        </div>
      </div>
      
      <div class="actions">
        <button class="btn btn-primary" onclick="location.reload()">
          🔄 Réessayer
        </button>
        <button class="btn btn-secondary" onclick="history.back()">
          ← Retour
        </button>
      </div>
    </div>
    
    <div class="footer">
      <strong>${ERROR_CONFIG.companyName}</strong> | Système de Gestion Scolaire
      <br />Tous droits réservés © 2025
    </div>
  </div>
</body>
</html>`;
  
  return HtmlService.createHtmlOutput(html).setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/**
 * Wrapper to return error response with beautiful HTML alert
 * Useful for doGet/doPost handlers or any web-facing function
 */
function returnErrorPage(title, message, errorCode) {
  return createBeautifulErrorPage(title, message, errorCode);
}

var DB = {
  openById: function(id) {
    if (!id || id === 'DYNAMIC_SaaS_MODE') return getSS_();
    return SpreadsheetApp.openById(id);
  }
};

// ============================================================
// CACHE MANAGEMENT
// ============================================================
function _getCacheStats() {
  const cache = CacheService.getScriptCache();
  return { cache: cache };
}

function _cleanupOldCacheEntries() {
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  try {
    // Clean old curriculum caches
    const curriculumKeys = ['CURRICULUM_CACHE_MAIN'];
    curriculumKeys.forEach(key => {
      const data = cache.get(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed._timestamp && (now - parsed._timestamp) > 2700000) { // 45 min
            cache.remove(key);
          }
        } catch(e) {
          cache.remove(key);
        }
      }
    });
  } catch(e) {
    // Cache cleanup failed, continue
  }
}

function _safeCachePut(key, value, ttlSeconds) {
  try {
    const cache = CacheService.getScriptCache();
    let dataObj;
    try {
      dataObj = JSON.parse(value);
    } catch(e) {
      // If value is not JSON, treat it as plain data
      dataObj = { _data: value };
    }
    dataObj._timestamp = Date.now();
    cache.put(key, JSON.stringify(dataObj), ttlSeconds);
  } catch(e) {
    // Cache put failed (likely quota exceeded), try cleanup and retry once
    _cleanupOldCacheEntries();
    try {
      const cache = CacheService.getScriptCache();
      cache.put(key, value, ttlSeconds);
    } catch(e2) {
      // Still failed - this indicates cache is full
      // Note: We can't directly trigger frontend from backend, but the checkCacheHealth_
      // function will detect this on the next check
    }
  }
}

function _safeCacheGetData_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed._data !== undefined) return parsed._data;
      const clone = Object.assign({}, parsed);
      delete clone._timestamp;
      return clone;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

// ============================================================
// LICENCE CHECK
// ============================================================
function parseRegisterDate_(raw) {
  if (!raw) return null;
  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) return raw;

  const s = String(raw).trim();
  if (!s) return null;

  const direct = new Date(s);
  if (!isNaN(direct.getTime())) return direct;

  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;

  const p1 = parseInt(m[1], 10);
  const p2 = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  const hh = parseInt(m[4] || '0', 10);
  const mm = parseInt(m[5] || '0', 10);
  const ss = parseInt(m[6] || '0', 10);
  if (year < 100) year += 2000;

  const month = p1 > 12 ? p2 : p1;
  const day = p1 > 12 ? p1 : p2;
  const parsed = new Date(year, month - 1, day, hh, mm, ss);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSubscriptionPlan_(plan) {
  return String(plan || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function isLifetimePlan_(plan) {
  const p = normalizeSubscriptionPlan_(plan);
  return !!p && (p.includes('VIE') || p.includes('LIFETIME') || p.includes('A VIE'));
}

function evaluateAccountStatusFromRegisterRow_(row, idx, nowMs) {
  const now = nowMs || Date.now();
  const planRaw = idx.iPlan !== -1 ? row[idx.iPlan] : '';
  const plan = String(planRaw || '').trim();
  const isLifetime = isLifetimePlan_(plan);
  const expirationDate = idx.iExp !== -1 ? parseRegisterDate_(row[idx.iExp]) : null;
  const currentActive = !['FALSE', 'NON', 'NO', '0'].includes(String(row[idx.iActive] || 'TRUE').trim().toUpperCase());

  let shouldBeActive = currentActive;
  let reason = 'UNCHANGED';

  if (isLifetime) {
    shouldBeActive = true;
    reason = 'LIFETIME_PLAN';
  } else if (expirationDate) {
    shouldBeActive = expirationDate.getTime() >= now;
    reason = shouldBeActive ? 'VALID_UNTIL_DATE' : 'EXPIRED';
  } else {
    reason = currentActive ? 'NO_EXPIRY_ACTIVE' : 'NO_EXPIRY_INACTIVE';
  }

  return {
    shouldBeActive: shouldBeActive,
    currentActive: currentActive,
    reason: reason,
    plan: plan,
    expirationDate: expirationDate
  };
}

function checkAndUpdateAccountStatus_(payload, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

    const data = payload || {};
    const runAll = data.all === true || String(data.scope || '').toLowerCase() === 'all';
    if (runAll && !viewer.isMaster && !viewer.isGodMode) {
      return { success: false, error: 'Seul un administrateur master peut synchroniser tous les comptes.' };
    }

    const activeSsId = SpreadsheetApp.getActiveSpreadsheet().getId();
    const targetSsId = String(data.spreadsheetId || activeSsId).trim();
    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg = master.getSheetByName('Register');
    if (!reg) return { success: false, error: 'Registre Master introuvable.' };

    const matrix = reg.getDataRange().getValues();
    if (!matrix || matrix.length < 2) return { success: false, error: 'Registre Master vide.' };

    const h = matrix[0].map(x => String(x).trim().toUpperCase());
    const iSsId = h.indexOf('USER_SPREADSHEET_ID');
    const iActive = h.indexOf('IS_ACTIVE');
    const iPlan = h.indexOf('SUBSCRIPTION_PLAN');
    const iExp = h.indexOf('EXPIRATION_DATE');
    const iId = h.indexOf('ID');
    const iBiz = h.indexOf('BUSINESS_NAME');
    if (iSsId === -1 || iActive === -1) {
      return { success: false, error: 'Colonnes USER_SPREADSHEET_ID / IS_ACTIVE manquantes.' };
    }

    const idx = { iActive: iActive, iPlan: iPlan, iExp: iExp };
    const now = Date.now();
    const updates = [];
    const touchedSpreadsheetIds = {};

    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r];
      const ssId = String(row[iSsId] || '').trim();
      if (!ssId) continue;
      if (!runAll && ssId !== targetSsId) continue;

      const evalResult = evaluateAccountStatusFromRegisterRow_(row, idx, now);
      const newActiveCell = evalResult.shouldBeActive ? 'TRUE' : 'FALSE';
      const oldActiveCell = String(row[iActive] || '').trim().toUpperCase();

      if (oldActiveCell !== newActiveCell) {
        reg.getRange(r + 1, iActive + 1).setValue(newActiveCell);
      }

      touchedSpreadsheetIds[ssId] = true;
      updates.push({
        row: r + 1,
        id: iId !== -1 ? String(row[iId] || '').trim() : '',
        businessName: iBiz !== -1 ? String(row[iBiz] || '').trim() : '',
        spreadsheetId: ssId,
        previousActive: oldActiveCell || 'TRUE',
        nextActive: newActiveCell,
        changed: oldActiveCell !== newActiveCell,
        plan: evalResult.plan,
        expirationDate: evalResult.expirationDate ? evalResult.expirationDate.toISOString() : '',
        reason: evalResult.reason
      });
    }

    if (!updates.length) {
      return {
        success: false,
        error: runAll
          ? 'Aucune ligne de compte avec USER_SPREADSHEET_ID valide.'
          : 'Aucun compte trouvé pour ce tableur dans le Registre Master.'
      };
    }

    Object.keys(touchedSpreadsheetIds).forEach(ssId => {
      try { CacheService.getScriptCache().remove('SUB_CHECK_' + ssId); } catch(e) {}
    });

    writeMasterAuthAuditLog_(
      'ACCOUNT_STATUS_SYNC',
      runAll ? 'ALL_ACCOUNTS' : targetSsId,
      {
        actor: viewer.email || '',
        scope: runAll ? 'ALL' : 'SINGLE',
        totalReviewed: updates.length,
        changed: updates.filter(x => x.changed).length
      },
      'SYSTEM_ALERT',
      false
    );

    return {
      success: true,
      scope: runAll ? 'ALL' : 'SINGLE',
      reviewed: updates.length,
      changed: updates.filter(x => x.changed).length,
      data: updates
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function formatSupportDate_(raw) {
  const d = parseRegisterDate_(raw);
  if (!d) return 'Non renseignée';
  const tz = Session.getScriptTimeZone() || 'Etc/GMT';
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss');
}

function getBlockedPageContext_(ssId, token) {
  const ctx = {
    isPrivileged: false,
    schoolName: '',
    schoolEmail: '',
    schoolPhone: '',
    registeredDate: 'Non renseignée',
    lastPaymentDate: 'Non renseignée',
    expirationDate: 'Non renseignée',
    plan: 'Non renseigné',
    paymentType: 'Non renseigné',
    accountStatus: 'INCONNU'
  };

  const isMeigensEmail_ = (value) => {
    const v = String(value || '').trim().toLowerCase();
    return v === 'meigenstech@gmail.com' || v.endsWith('@meigens.tech');
  };
  const normalizeDigits_ = (value) => String(value || '').replace(/[^0-9]/g, '');

  try {
    const tokenStr = normalizeAuthToken_(token);
    const session = tokenStr ? loadSessionToken_(tokenStr) : null;
    const sessionEmail = session && session.email ? String(session.email).toLowerCase().trim() : '';

    if (sessionEmail) {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
      if (sh && sh.getLastRow() > 1) {
        const rows = sh.getDataRange().getValues();
        const h = rows[0].map(x => String(x).trim().toLowerCase());
        const find = (names) => h.findIndex(x => names.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
        const iEmail = find(['email']);
        const iRole = find(['role']);
        const iPerms = find(['permissionsjson', 'permissions']);
        const iActive = find(['active', 'actif']);

        if (iEmail !== -1) {
          const candidates = rows.slice(1).filter(r => String(r[iEmail] || '').toLowerCase().trim() === sessionEmail);
          const row = candidates.find(r => iActive === -1 || String(r[iActive] || '').toUpperCase() !== 'FALSE') || candidates[0];
          if (row) {
            const perms = iPerms !== -1 ? parsePermissionsCell_(row[iPerms]) : {};
            ctx.isPrivileged = !!(perms && perms.isGodMode);
          }
        }
      }
    }
  } catch (e) {}

  // Fallback to the main auth resolver so admins are recognized even when
  // lightweight session parsing above misses a valid token context.
  if (!ctx.isPrivileged) {
    try {
      const viewer = getViewerInfo_(token);
      if (viewer && viewer.success) {
        ctx.isPrivileged = !!(viewer.isMaster || viewer.isGodMode);
      }
    } catch (e) {}
  }

  try {
    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg = master.getSheetByName('Register');
    if (!reg || reg.getLastRow() < 2) return ctx;

    const data = reg.getDataRange().getValues();
    const h = data[0].map(x => String(x).trim().toUpperCase());
    const idx = {
      ssId: h.indexOf('USER_SPREADSHEET_ID'),
      businessName: h.indexOf('BUSINESS_NAME'),
      contactName: h.indexOf('NAME'),
      email: h.indexOf('EMAIL'),
      phone: h.indexOf('PHONE'),
      txnPhone: h.indexOf('TRANSACTION_PHONE'),
      created: h.indexOf('DATE_CREATED'),
      plan: h.indexOf('SUBSCRIPTION_PLAN'),
      paymentType: h.indexOf('PAYMENT_TYPE'),
      exp: h.indexOf('EXPIRATION_DATE'),
      active: h.indexOf('IS_ACTIVE')
    };

    const iLastPayment = h.findIndex(x => ['LAST_PAYMENT_DATE', 'LAST_PAYMENT_AT', 'PAYMENT_DATE', 'DATE_DERNIER_PAIEMENT'].includes(x));
    if (idx.ssId === -1) return ctx;

    const targetSsId = normalizeSpreadsheetId_(ssId);
    const matches = data.filter((r, i) => i > 0 && normalizeSpreadsheetId_(r[idx.ssId]) === targetSsId);
    if (!matches.length) return ctx;
    const nowMs = Date.now();
    const isInactive = (value) => {
      const v = String(value || '').trim().toUpperCase();
      return v === 'FALSE' || v === 'NON' || v === 'NO' || v === '0';
    };
    const isRowCurrent = (r) => {
      if (idx.active !== -1 && isInactive(r[idx.active])) return false;
      const planVal = idx.plan !== -1 ? String(r[idx.plan] || '').trim() : '';
      if (isLifetimePlan_(planVal)) return true;
      const expDate = idx.exp !== -1 ? parseRegisterDate_(r[idx.exp]) : null;
      if (!expDate) return true;
      return expDate.getTime() >= nowMs;
    };
    const row = matches.slice().reverse().find(isRowCurrent) || matches[matches.length - 1];

    ctx.schoolName = idx.businessName !== -1 ? String(row[idx.businessName] || '').trim() : '';
    if (!ctx.schoolName && idx.contactName !== -1) ctx.schoolName = String(row[idx.contactName] || '').trim();

    ctx.schoolEmail = idx.email !== -1 ? String(row[idx.email] || '').trim() : '';
    ctx.schoolPhone = idx.phone !== -1 ? String(row[idx.phone] || '').trim() : '';
    if (!ctx.schoolPhone && idx.txnPhone !== -1) ctx.schoolPhone = String(row[idx.txnPhone] || '').trim();

    ctx.registeredDate = idx.created !== -1 ? formatSupportDate_(row[idx.created]) : ctx.registeredDate;
    ctx.lastPaymentDate = iLastPayment !== -1 ? formatSupportDate_(row[iLastPayment]) : 'Non renseignée';
    ctx.expirationDate = idx.exp !== -1 ? formatSupportDate_(row[idx.exp]) : ctx.expirationDate;
    ctx.plan = idx.plan !== -1 ? (String(row[idx.plan] || '').trim() || 'Non renseigné') : ctx.plan;
    ctx.paymentType = idx.paymentType !== -1 ? (String(row[idx.paymentType] || '').trim() || 'Non renseigné') : ctx.paymentType;
    ctx.accountStatus = idx.active !== -1 && ['FALSE', 'NON', 'NO', '0'].includes(String(row[idx.active] || '').trim().toUpperCase()) ? 'SUSPENDU' : 'ACTIF';
  } catch (e) {}

  // Prefer local school contact settings for non-privileged users.
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shSettings = ss.getSheetByName('Settings');
    if (shSettings && shSettings.getLastRow() > 1) {
      const rows = shSettings.getDataRange().getValues();
      const kv = {};
      for (let i = 1; i < rows.length; i++) {
        const key = String(rows[i][0] || '').trim().toUpperCase();
        if (!key) continue;
        kv[key] = rows[i][1];
      }

      const localEmail = String(
        kv.CONTACTEMAIL || kv.SCHOOLEMAIL || kv.ADMINEMAIL || kv.SUPPORTEMAIL || ''
      ).trim();
      const localPhone = String(
        kv.CONTACTPHONE || kv.SCHOOLPHONE || kv.ADMINPHONE || kv.PHONE || ''
      ).trim();

      const shouldFallbackEmail = !ctx.schoolEmail || isMeigensEmail_(ctx.schoolEmail);
      if (shouldFallbackEmail && localEmail && !isMeigensEmail_(localEmail)) {
        ctx.schoolEmail = localEmail;
      }

      const shouldFallbackPhone = !ctx.schoolPhone;
      if (shouldFallbackPhone && localPhone) {
        ctx.schoolPhone = localPhone;
      }
    }
  } catch (e) {}

  // Final fallback: use Users sheet admin email if school email is empty or still Meigens internal.
  if (!ctx.schoolEmail || isMeigensEmail_(ctx.schoolEmail)) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const shUsers = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
      if (shUsers && shUsers.getLastRow() > 1) {
        const rows = shUsers.getDataRange().getValues();
        const h = rows[0].map(x => String(x).trim().toLowerCase());
        const find = (names) => h.findIndex(x => names.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
        const iEmail = find(['email']);
        const iRole = find(['role']);
        const iActive = find(['active', 'actif']);
        if (iEmail !== -1) {
          const isUsable = (r) => {
            const email = String(r[iEmail] || '').trim();
            const activeOk = iActive === -1 || String(r[iActive] || '').toUpperCase() !== 'FALSE';
            return email && activeOk && !isMeigensEmail_(email);
          };
          let adminRow = null;
          if (iRole !== -1) {
            adminRow = rows.slice(1).find(r => String(r[iRole] || '').toUpperCase() === 'ADMIN' && isUsable(r)) || null;
          }
          if (!adminRow) adminRow = rows.slice(1).find(r => isUsable(r)) || null;
          if (adminRow) ctx.schoolEmail = String(adminRow[iEmail] || '').trim();
        }
      }
    } catch (e) {}
  }

  const meigensDigits = normalizeDigits_(ERROR_CONFIG.contactPhone || '+50946256973');
  const schoolDigits = normalizeDigits_(ctx.schoolPhone);
  if (!ctx.isPrivileged && schoolDigits && (schoolDigits === meigensDigits || schoolDigits === meigensDigits.replace(/^509/, ''))) {
    ctx.schoolPhone = '';
  }

  return ctx;
}

function checkSubscriptionStatus_(options) {
  const opts = options || {};
  const forceFresh = !!opts.forceFresh;
  const requestedOrgId = String(opts.orgId || '').trim().toLowerCase();
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const ssId    = ss.getId();
  const requestedSsId = normalizeSpreadsheetId_(opts.spreadsheetId || ssId);
  // Cache the subscription check for 15 minutes to avoid
  // opening the master spreadsheet on every write operation.
  const cacheScope = requestedOrgId ? ('ORG_' + requestedOrgId) : requestedSsId;
  const cKey   = 'SUB_CHECK_' + cacheScope;
  const cached = forceFresh ? null : _safeCacheGetData_(cKey);
  if (cached && cached.success) return cached;
  const master  = SpreadsheetApp.openById(MASTER_AUTH_ID);
  const reg     = master.getSheetByName('Register');
  if (!reg) throw new Error('Registre Master introuvable.');
  const data    = reg.getDataRange().getValues();
  const h       = data[0].map(x => String(x).trim().toUpperCase());
  const iSsId   = h.indexOf('USER_SPREADSHEET_ID');
  const iActive = h.indexOf('IS_ACTIVE');
  const iName   = h.indexOf('BUSINESS_NAME');
  const iPlan   = h.indexOf('SUBSCRIPTION_PLAN');
  const iExp    = h.indexOf('EXPIRATION_DATE');
  const iMode   = h.indexOf('ID_GENERATION_MODE');
  const iOrgId  = h.indexOf('ID');
  const iStaffUrl = h.indexOf('STAFF_APP_URL');
  const iStudentUrl = h.indexOf('STUDENT_PORTAL_URL');
  if (iSsId === -1) throw new Error('Colonne USER_SPREADSHEET_ID manquante.');

  let matchedRows = data.filter((r, idx) => {
    if (idx === 0) return false;
    const rowSsId = normalizeSpreadsheetId_(r[iSsId]);
    const rowOrgId = iOrgId !== -1 ? String(r[iOrgId] || '').trim().toLowerCase() : '';
    const ssMatch = rowSsId && rowSsId === requestedSsId;
    const orgMatch = requestedOrgId && rowOrgId && rowOrgId === requestedOrgId;
    return !!(ssMatch || orgMatch);
  });

  // Fallback: when request has no org/spreadsheet identifier, try resolving tenant by current script id
  // from STAFF_APP_URL / STUDENT_PORTAL_URL in Register.
  if (!matchedRows.length && !requestedOrgId) {
    let currentScriptId = '';
    try { currentScriptId = String(ScriptApp.getScriptId() || '').trim(); } catch (_) {}
    if (currentScriptId) {
      matchedRows = data.filter((r, idx) => {
        if (idx === 0) return false;
        const staffUrl = iStaffUrl !== -1 ? String(r[iStaffUrl] || '') : '';
        const studentUrl = iStudentUrl !== -1 ? String(r[iStudentUrl] || '') : '';
        return staffUrl.indexOf(currentScriptId) !== -1 || studentUrl.indexOf(currentScriptId) !== -1;
      });
    }
  }

  if (!matchedRows.length) throw new Error('Ce systeme n\'est pas certifie par Meigens Tech.');

  const nowMs = Date.now();
  const isInactive = (value) => {
    const v = String(value || '').trim().toUpperCase();
    return v === 'FALSE' || v === 'NON' || v === 'NO' || v === '0';
  };
  const isRowValid = (r) => {
    if (isInactive(r[iActive])) return false;
    const planVal = iPlan !== -1 ? String(r[iPlan] || '').trim() : '';
    if (isLifetimePlan_(planVal)) return true;
    const expDate = iExp !== -1 ? parseRegisterDate_(r[iExp]) : null;
    if (!expDate) return true;
    return expDate.getTime() >= nowMs;
  };

  // Pick the most recent still-valid row first; this prevents false failures when
  // duplicate rows exist for the same spreadsheet id and one of them is expired.
  const row = matchedRows.slice().reverse().find(isRowValid) || matchedRows[matchedRows.length - 1];
  const active = String(row[iActive] || 'TRUE').trim().toUpperCase();
  if (active === 'FALSE' || active === 'NON')
    throw new Error('Compte suspendu. Contactez Meigens Tech.');

  const plan = iPlan !== -1 ? String(row[iPlan] || '').trim() : '';
  const isLifetime = isLifetimePlan_(plan);
  const expirationDate = iExp !== -1 ? parseRegisterDate_(row[iExp]) : null;
  if (!isLifetime && expirationDate && expirationDate.getTime() < Date.now()) {
    throw new Error('Abonnement expiré. Contactez Meigens Tech pour renouveler votre accès.');
  }

  const result = {
    success: true,
    orgId:   row[iOrgId],
    orgName: row[iName] || 'Mon Ecole',
    mode:    row[iMode]  || 'Manual',
    spreadsheetId: iSsId !== -1 ? String(row[iSsId] || ssId).trim() : ssId,
    subscriptionPlan: plan,
    expirationDate: expirationDate ? expirationDate.toISOString() : '',
    isActive: true
  };
  _safeCachePut(cKey, JSON.stringify(result), 900); // 15-min cache (bypassed when forceFresh=true)
  return result;
}

// ============================================================
// SPREADSHEET RESOLVER
// ============================================================
function getActiveSpreadsheetSafe_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet() || null;
  } catch (_err) {
    return null;
  }
}

// ── PERFORMANCE FIX: getSS_() no longer calls checkSubscriptionStatus_() on
// every invocation.  Subscription is verified once at request entry (doGet /
// apiHub initialisation).  Calling it here added 2-4 s of cross-spreadsheet
// latency to every single sheet write.
function getSS_(targetYear) {
  const active = getActiveSpreadsheetSafe_();
  if (!active) return null;
  if (!targetYear) return active;
  const archSh = active.getSheetByName('Archives_Annuelles');
  if (archSh && archSh.getLastRow() > 1) {
    const d = archSh.getDataRange().getValues();
    const h = d[0].map(x => String(x).trim().toUpperCase());
    const yIdx = h.indexOf('ANNEE SCOLAIRE');
    const idIdx = h.findIndex(x => x === 'ARCHIVE_ID' || x.includes('ID'));
    if (yIdx !== -1 && idIdx !== -1) {
      for (let i = 1; i < d.length; i++) {
        if (String(d[i][yIdx]).trim() === String(targetYear).trim() && d[i][idIdx]) {
          return SpreadsheetApp.openById(d[i][idIdx]);
        }
      }
    }
  }
  return active;
}

function getOrgId_() {
  const activeSs = getActiveSpreadsheetSafe_();
  if (!activeSs) return 'UNKNOWN_ORG';
  const ssId = activeSs.getId();
  const cacheKey = 'ORG_ID_' + ssId;
  const cached = _safeCacheGetData_(cacheKey);
  if (cached) return String(cached);

  const up = PropertiesService.getUserProperties();
  const propKey = 'CURRENT_ORG_ID_' + ssId;
  let id = up.getProperty(propKey);
  if (!id) {
    try {
      const org = resolveOrgBySpreadsheetId_(ssId);
      id = org.orgId;
      up.setProperty(propKey, id);
    } catch(e) {
      id = 'UNKNOWN_ORG';
    }
  }

  _safeCachePut(cacheKey, JSON.stringify(id), 1800);
  return id;
}

/**
 * Removes the cached SaaS settings blobs for the active spreadsheet so the
 * next getSaaSSettings_() call rebuilds the merged config from the Settings
 * sheet. Must be called after every Settings-sheet write.
 */
function invalidateSaaSSettingsCache_(ss) {
  try {
    const target = ss || getSS_();
    if (!target) return;
    const ssId = target.getId();
    const cache = CacheService.getScriptCache();
    if (!cache) return;
    // Known cache keys built by getSaaSSettings_(): one per academic year + CURRENT.
    const keys = ['SAAS_SETTINGS_' + ssId + '_CURRENT'];
    try {
      const conf = PropertiesService.getScriptProperties();
      const yr = conf && conf.getProperty('CURRENT_ACADEMIC_YEAR');
      if (yr) keys.push('SAAS_SETTINGS_' + ssId + '_' + yr);
    } catch(_) {}
    // Invalidate the AI full system snapshot too (config changed)
    keys.push('AI_SYS_SNAP_V2_' + ssId);
    cache.removeAll(keys);
  } catch(_) { /* non-fatal */ }
}

// Helper: invalidate the AI system snapshot cache when students/grades/payments/attendance change.
function _invalidateAiSystemSnapshot_() {
  try {
    var ssId = getSS_().getId();
    CacheService.getScriptCache().remove('AI_SYS_SNAP_V2_' + ssId);
  } catch (_) {}
}

function resolveOrgBySpreadsheetId_(ssId) {
  const master  = SpreadsheetApp.openById(MASTER_AUTH_ID);
  const sheet   = master.getSheetByName('Register');
  const data    = sheet.getDataRange().getValues();
  const h       = data[0].map(x => String(x).trim().toUpperCase());
  const iId     = h.indexOf('ID');
  const iName   = h.indexOf('BUSINESS_NAME');
  const iSheet  = h.indexOf('USER_SPREADSHEET_ID');
  const iDesign = h.indexOf('ID_DESIGN_JSON');
  const targetId = normalizeSpreadsheetId_(ssId);
  const matches = data.slice(1).filter(r => normalizeSpreadsheetId_(r[iSheet]) === targetId);
  if (!matches.length) throw new Error('Tableur non enregistre.');
  // Prefer most recent row with a BUSINESS_NAME
  const row = matches.slice().reverse().find(r => String(r[iName] || '').trim()) || matches[matches.length - 1];
  let orgName = String(row[iName] || '').trim() || 'Mon Ecole';
  // Prefer the design-panel display name if set
  if (iDesign !== -1 && row[iDesign]) {
    try {
      const dj = JSON.parse(row[iDesign] || '{}');
      if (dj.general && dj.general.schoolName) orgName = String(dj.general.schoolName).trim() || orgName;
    } catch(e) {}
  }
  return { orgId: row[iId], orgName };
}

// ============================================================
// SETTINGS -- JSON cell helpers
// ============================================================

function _ensureRegisterAiQuotaHeaders_(registerSheet) {
  if (!registerSheet) return;
  var currentHeaders = registerSheet.getRange(1, 1, 1, Math.max(registerSheet.getLastColumn(), 1))
    .getValues()[0].map(function(x) { return String(x || '').trim(); });
  var normalized = currentHeaders.map(function(h) { return String(h || '').trim().toUpperCase(); });
  var required = ['SUBSCRIPTION_PLAN', 'AI_DAILY_TOKEN_LIMIT', 'AI_SESSION_TOKEN_LIMIT', 'AI_MONTHLY_TOKEN_LIMIT'];
  var missing = [];
  required.forEach(function(header) {
    if (normalized.indexOf(header) === -1) missing.push(header);
  });
  if (missing.length) {
    registerSheet.getRange(1, currentHeaders.length + 1, 1, missing.length)
      .setValues([missing])
      .setFontWeight('bold')
      .setBackground('#fff2cc');
  }
}

function getSaaSSettings_(token, targetYear) {
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const ssId    = ss.getId();
    const cacheKey = 'SAAS_SETTINGS_' + ssId + '_' + (targetYear ? String(targetYear) : 'CURRENT');
    const cached = _safeCacheGetData_(cacheKey);
    if (cached) {
      try {
        const cachedMaster = SpreadsheetApp.openById(MASTER_AUTH_ID);
        const cachedReg = cachedMaster.getSheetByName('Register');
        if (cachedReg) _ensureRegisterAiQuotaHeaders_(cachedReg);
      } catch (_) {}
      return { success: true, data: cached };
    }

    const master  = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg     = master.getSheetByName('Register');
    if (!reg) return { success: false, error: 'Register sheet introuvable.' };
    _ensureRegisterAiQuotaHeaders_(reg);
    const regLastRow = reg.getLastRow();
    const regLastCol = reg.getLastColumn();
    if (regLastRow < 1 || regLastCol < 1) return { success: false, error: 'Register vide.' };
    const rh      = reg.getRange(1, 1, 1, regLastCol).getValues()[0].map(x => String(x || '').trim().toUpperCase());

    // Quota configuration is now expected per org in Register, so we do not auto-create AI_PLAN_QUOTAS.

    const iSsId   = rh.indexOf('USER_SPREADSHEET_ID');
    const iName   = rh.indexOf('BUSINESS_NAME');
    const iDesign = rh.indexOf('ID_DESIGN_JSON');
    const iRules  = rh.indexOf('ID_RULES_JSON');
    const iAddr   = rh.findIndex(x => ['SCHOOL_ADDR','ADDRESS','ADRESSE'].includes(x));
    const iRegId  = rh.indexOf('ID');
    const iType   = rh.indexOf('ORG_TYPE');
    const iDrive  = rh.indexOf('ORG_DRIVE_FOLDER_ID');
    const iPortal = rh.indexOf('STUDENT_PORTAL_URL');
    const iStaff  = rh.indexOf('STAFF_APP_URL');
    const iPlan   = rh.indexOf('SUBSCRIPTION_PLAN');
    const iExpiry = rh.indexOf('EXPIRATION_DATE');
    const iPay    = rh.indexOf('PAYMENT_TYPE');
    const iCreated = rh.indexOf('DATE_CREATED');
    const iPicDrv = rh.indexOf('PICTURE_DRIVE_LINK');
    const iRegEmail = rh.indexOf('EMAIL');
    const iRegPhone = rh.indexOf('PHONE');
    const iRegPhoneTxn = rh.indexOf('TRANSACTION_PHONE');
    const iContactName = rh.indexOf('NAME');
    const iAiProAccess = rh.indexOf('AI_PRO_ACCESS');
    const iAiProDailyLimit = rh.indexOf('AI_PRO_DAILY_TOKEN_LIMIT');
    const iAiFreeDailyLimit = rh.indexOf('AI_FREE_DAILY_TOKEN_LIMIT');
    const iAiDailyLimit = rh.indexOf('AI_DAILY_TOKEN_LIMIT');
    const iAiDailyLimitPro = rh.indexOf('AI_DAILY_TOKEN_LIMIT_PRO');
    const iAiDailyLimitFree = rh.indexOf('AI_DAILY_TOKEN_LIMIT_FREE');
    const iAiSessionLimit = rh.indexOf('AI_SESSION_TOKEN_LIMIT');
    const iAiSessionLimitPro = rh.indexOf('AI_SESSION_TOKEN_LIMIT_PRO');
    const iAiSessionLimitFree = rh.indexOf('AI_SESSION_TOKEN_LIMIT_FREE');
    const iAiProSessionLimit = rh.indexOf('AI_PRO_SESSION_TOKEN_LIMIT');
    const iAiFreeSessionLimit = rh.indexOf('AI_FREE_SESSION_TOKEN_LIMIT');
    const iAiMonthlyLimit = rh.indexOf('AI_MONTHLY_TOKEN_LIMIT');
    const iAiMonthlyLimitPro = rh.indexOf('AI_MONTHLY_TOKEN_LIMIT_PRO');
    const iAiMonthlyLimitFree = rh.indexOf('AI_MONTHLY_TOKEN_LIMIT_FREE');
    const iAiProMonthlyLimit = rh.indexOf('AI_PRO_MONTHLY_TOKEN_LIMIT');
    const iAiFreeMonthlyLimit = rh.indexOf('AI_FREE_MONTHLY_TOKEN_LIMIT');
    const iAiProDailyPdfLimit = rh.indexOf('AI_PRO_DAILY_PDF_LIMIT');

    const extractOrgIdFromUrl_ = (url) => {
      const txt = String(url || '').trim();
      if (!txt) return '';
      const match = txt.match(/[?&]orgId=([^&#]+)/i);
      return match ? decodeURIComponent(match[1]) : '';
    };

    // Fast lookup: avoid loading entire Register matrix (can contain very large JSON cells).
    const targetSsId_ = normalizeSpreadsheetId_(ssId);
    let regRow = null;
    if (iSsId !== -1 && regLastRow > 1) {
      const idRange = reg.getRange(2, iSsId + 1, regLastRow - 1, 1);
      const exactMatches = idRange.createTextFinder(String(ssId || '').trim())
        .matchCase(false)
        .matchEntireCell(true)
        .findAll();

      if (exactMatches && exactMatches.length) {
        for (let m = exactMatches.length - 1; m >= 0; m--) {
          const rowNumber = exactMatches[m].getRow();
          const candidate = reg.getRange(rowNumber, 1, 1, regLastCol).getValues()[0];
          if (!regRow) regRow = candidate;
          if (iName !== -1 && String(candidate[iName] || '').trim()) {
            regRow = candidate;
            break;
          }
        }
      }

      // Fallback for formatted/misaligned IDs: scan only ID + name columns, then fetch one row.
      if (!regRow) {
        const idValues = idRange.getValues();
        const nameValues = (iName !== -1)
          ? reg.getRange(2, iName + 1, regLastRow - 1, 1).getValues()
          : [];

        let chosenRow = -1;
        for (let i = idValues.length - 1; i >= 0; i--) {
          const rowId = normalizeSpreadsheetId_(idValues[i][0]);
          if (rowId !== targetSsId_) continue;
          if (chosenRow === -1) chosenRow = i + 2;
          if (iName !== -1 && String((nameValues[i] && nameValues[i][0]) || '').trim()) {
            chosenRow = i + 2;
            break;
          }
        }

        if (chosenRow !== -1) {
          regRow = reg.getRange(chosenRow, 1, 1, regLastCol).getValues()[0];
        }
      }
    }

    let masterData = {
      SCHOOL_NAME:'Etablissement Meigens', SCHOOL_LOGO:'',
      SCHOOL_ADDR:'', SCHOOL_EMAIL:'', SCHOOL_PHONE:'',
      SYSTEM_ID_MODE:'COMPANY', SYSTEM_ID_PREFIX:'MT',
      SCHOOL_CODE:'', ORG_ID:'', ORG_REGISTER_ID:'', ORG_NAME:'', ORG_TYPE:'',
      USER_SPREADSHEET_ID:ss.getId(), STUDENT_PORTAL_URL:'', STAFF_APP_URL:'',
      ORG_DRIVE_FOLDER_ID:'', SUBSCRIPTION_PLAN:'', EXPIRATION_DATE:'',
      PAYMENT_TYPE:'', DATE_CREATED:'', CONTACT_NAME:'', CURRENT_ACADEMIC_YEAR:'',
      PICTURE_DRIVE_LINK:'', BUSINESS_NAME:'', EMAIL:'', PHONE:'', TRANSACTION_PHONE:'',
      NAME:'', ADDRESS:'', AI_PRO_ACCESS:'',
      AI_PRO_DAILY_TOKEN_LIMIT:'', AI_FREE_DAILY_TOKEN_LIMIT:'',
      AI_DAILY_TOKEN_LIMIT:'', AI_DAILY_TOKEN_LIMIT_PRO:'', AI_DAILY_TOKEN_LIMIT_FREE:'',
      AI_SESSION_TOKEN_LIMIT:'', AI_SESSION_TOKEN_LIMIT_PRO:'', AI_SESSION_TOKEN_LIMIT_FREE:'',
      AI_PRO_SESSION_TOKEN_LIMIT:'', AI_FREE_SESSION_TOKEN_LIMIT:'',
      AI_MONTHLY_TOKEN_LIMIT:'', AI_MONTHLY_TOKEN_LIMIT_PRO:'', AI_MONTHLY_TOKEN_LIMIT_FREE:'',
      AI_PRO_MONTHLY_TOKEN_LIMIT:'', AI_FREE_MONTHLY_TOKEN_LIMIT:'',
      AI_PRO_DAILY_PDF_LIMIT:''
    };
    if (regRow) {
      const regIdValue = iRegId !== -1 ? String(regRow[iRegId] || '').trim() : '';
      const portalUrl = iPortal !== -1 ? String(regRow[iPortal] || '').trim() : '';
      const portalOrgId = extractOrgIdFromUrl_(portalUrl);

      masterData.SCHOOL_NAME = String(regRow[iName] || '').trim() || masterData.SCHOOL_NAME;
      masterData.BUSINESS_NAME = masterData.SCHOOL_NAME;
      masterData.ORG_NAME = masterData.SCHOOL_NAME;
      masterData.SCHOOL_CODE = regIdValue || masterData.SCHOOL_CODE;
      masterData.ORG_REGISTER_ID = regIdValue;
      masterData.ORG_ID = portalOrgId || regIdValue || getOrgId_() || '';
      masterData.ORG_TYPE = iType !== -1 ? String(regRow[iType] || '').trim() : '';
      masterData.USER_SPREADSHEET_ID = iSsId !== -1 ? String(regRow[iSsId] || '').trim() : ss.getId();
      masterData.STUDENT_PORTAL_URL = portalUrl;
      masterData.STAFF_APP_URL = iStaff !== -1 ? String(regRow[iStaff] || '').trim() : '';
      masterData.ORG_DRIVE_FOLDER_ID = iDrive !== -1 ? String(regRow[iDrive] || '').trim() : '';
      masterData.SUBSCRIPTION_PLAN = iPlan !== -1 ? String(regRow[iPlan] || '').trim() : '';
      masterData.EXPIRATION_DATE = iExpiry !== -1 ? String(regRow[iExpiry] || '').trim() : '';
      masterData.PAYMENT_TYPE = iPay !== -1 ? String(regRow[iPay] || '').trim() : '';
      masterData.DATE_CREATED = iCreated !== -1 ? String(regRow[iCreated] || '').trim() : '';
      masterData.PICTURE_DRIVE_LINK = iPicDrv !== -1 ? String(regRow[iPicDrv] || '').trim() : '';
      masterData.CONTACT_NAME = iContactName !== -1 ? String(regRow[iContactName] || '').trim() : '';
      masterData.NAME = masterData.CONTACT_NAME;
      masterData.AI_PRO_ACCESS = iAiProAccess !== -1 ? String(regRow[iAiProAccess] || '').trim() : '';
      masterData.AI_PRO_DAILY_TOKEN_LIMIT = iAiProDailyLimit !== -1 ? String(regRow[iAiProDailyLimit] || '').trim() : '';
      masterData.AI_FREE_DAILY_TOKEN_LIMIT = iAiFreeDailyLimit !== -1 ? String(regRow[iAiFreeDailyLimit] || '').trim() : '';
      masterData.AI_DAILY_TOKEN_LIMIT = iAiDailyLimit !== -1 ? String(regRow[iAiDailyLimit] || '').trim() : '';
      masterData.AI_DAILY_TOKEN_LIMIT_PRO = iAiDailyLimitPro !== -1 ? String(regRow[iAiDailyLimitPro] || '').trim() : '';
      masterData.AI_DAILY_TOKEN_LIMIT_FREE = iAiDailyLimitFree !== -1 ? String(regRow[iAiDailyLimitFree] || '').trim() : '';
      masterData.AI_SESSION_TOKEN_LIMIT = iAiSessionLimit !== -1 ? String(regRow[iAiSessionLimit] || '').trim() : '';
      masterData.AI_SESSION_TOKEN_LIMIT_PRO = iAiSessionLimitPro !== -1 ? String(regRow[iAiSessionLimitPro] || '').trim() : '';
      masterData.AI_SESSION_TOKEN_LIMIT_FREE = iAiSessionLimitFree !== -1 ? String(regRow[iAiSessionLimitFree] || '').trim() : '';
      masterData.AI_PRO_SESSION_TOKEN_LIMIT = iAiProSessionLimit !== -1 ? String(regRow[iAiProSessionLimit] || '').trim() : '';
      masterData.AI_FREE_SESSION_TOKEN_LIMIT = iAiFreeSessionLimit !== -1 ? String(regRow[iAiFreeSessionLimit] || '').trim() : '';
      masterData.AI_MONTHLY_TOKEN_LIMIT = iAiMonthlyLimit !== -1 ? String(regRow[iAiMonthlyLimit] || '').trim() : '';
      masterData.AI_MONTHLY_TOKEN_LIMIT_PRO = iAiMonthlyLimitPro !== -1 ? String(regRow[iAiMonthlyLimitPro] || '').trim() : '';
      masterData.AI_MONTHLY_TOKEN_LIMIT_FREE = iAiMonthlyLimitFree !== -1 ? String(regRow[iAiMonthlyLimitFree] || '').trim() : '';
      masterData.AI_PRO_MONTHLY_TOKEN_LIMIT = iAiProMonthlyLimit !== -1 ? String(regRow[iAiProMonthlyLimit] || '').trim() : '';
      masterData.AI_FREE_MONTHLY_TOKEN_LIMIT = iAiFreeMonthlyLimit !== -1 ? String(regRow[iAiFreeMonthlyLimit] || '').trim() : '';
      masterData.AI_PRO_DAILY_PDF_LIMIT = iAiProDailyPdfLimit !== -1 ? String(regRow[iAiProDailyPdfLimit] || '').trim() : '';

      if (iAddr !== -1 && regRow[iAddr]) masterData.SCHOOL_ADDR = String(regRow[iAddr]).trim();
      masterData.ADDRESS = masterData.SCHOOL_ADDR;
      if (iRegEmail !== -1) masterData.SCHOOL_EMAIL = String(regRow[iRegEmail] || '').trim();
      masterData.EMAIL = masterData.SCHOOL_EMAIL;
      if (iRegPhone !== -1) masterData.SCHOOL_PHONE = String(regRow[iRegPhone] || '').trim();
      masterData.PHONE = masterData.SCHOOL_PHONE;
      if (iRegPhoneTxn !== -1) masterData.TRANSACTION_PHONE = String(regRow[iRegPhoneTxn] || '').trim();
      if (!masterData.SCHOOL_PHONE && masterData.TRANSACTION_PHONE)
        masterData.SCHOOL_PHONE = masterData.TRANSACTION_PHONE;
      if (iDesign !== -1 && regRow[iDesign]) {
        try {
          const dj = JSON.parse(regRow[iDesign] || '{}');
          if (dj.visuals && dj.visuals.logoUrl) masterData.SCHOOL_LOGO = dj.visuals.logoUrl;
          if (!masterData.SCHOOL_ADDR && dj.contact && dj.contact.address)
            masterData.SCHOOL_ADDR = dj.contact.address;
          // Prefer the user-configured display name from the design panel over billing name
          if (dj.general && dj.general.schoolName)
            masterData.SCHOOL_NAME = String(dj.general.schoolName).trim() || masterData.SCHOOL_NAME;
          if (dj.general && dj.general.promotion)
            masterData.CURRENT_ACADEMIC_YEAR = String(dj.general.promotion).trim();
          if (dj.general && dj.general.companyIdMode === 'ON') masterData.SYSTEM_ID_MODE = 'COMPANY';
        } catch(e) {}
      }
      if (iRules !== -1 && regRow[iRules]) {
        try {
          const rj = JSON.parse(regRow[iRules] || '{}');
          masterData.SYSTEM_ID_PREFIX = (rj.codeGeneration && rj.codeGeneration.prefix) || rj.idPrefix || 'MT';
        } catch(e) {}
      }
    }

    let localSh = null;
    if (targetYear) {
      const safeYear     = String(targetYear).replace(/[^a-zA-Z0-9]/g, '_');
      const snapshotName = 'Settings_' + safeYear;
      localSh = ss.getSheetByName(snapshotName);
      if (!localSh) {
        const archSh = ss.getSheetByName('Archives_Annuelles');
        if (archSh && archSh.getLastRow() > 1) {
          const archData = archSh.getDataRange().getValues();
          const ah       = archData[0].map(x => String(x).trim().toUpperCase());
          const iYear    = ah.indexOf('ANNEE SCOLAIRE');
          const iAId     = ah.indexOf('ARCHIVE_ID');
          const iSnap    = ah.indexOf('SETTINGS_SHEET');
          for (let i = 1; i < archData.length; i++) {
            if (String(archData[i][iYear]).trim() === String(targetYear).trim()) {
              if (iSnap !== -1 && archData[i][iSnap]) {
                localSh = ss.getSheetByName(String(archData[i][iSnap]));
              }
              if (!localSh && iAId !== -1 && archData[i][iAId]) {
                try {
                  const archSS = SpreadsheetApp.openById(archData[i][iAId]);
                  localSh      = archSS.getSheetByName('Settings');
                } catch(e2) {}
              }
              break;
            }
          }
        }
      }
    }
    if (!localSh) localSh = ss.getSheetByName('Settings');

    let local = {};
    if (localSh) {
      const rows = localSh.getDataRange().getValues();
      const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'UTC';
      for (let i = 1; i < rows.length; i++) {
        const key = String(rows[i][0]).trim();
        if (!key) continue;
        let val = rows[i][1];
        // Google Sheets sometimes auto-formats a string like "08:00" written
        // for time-only settings (e.g. ATTENDANCE_ENTRY_TIME) as a real Date
        // anchored on 1899-12-30. JSON serialization then sends a UTC ISO
        // string back to the front-end, which displays the wrong wall clock
        // because of the timezone shift. Re-format such Dates as plain
        // "HH:mm" using the spreadsheet's own timezone so the value the user
        // saved is the value the user gets back.
        if (val instanceof Date && !isNaN(val.getTime())) {
          try {
            val = Utilities.formatDate(val, tz, 'HH:mm');
          } catch(_) {
            val = String(val);
          }
        }
        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try { val = JSON.parse(val); } catch(e) {}
        }
        local[key] = val;
      }
    }
    // local Settings sheet keys override masterData defaults so user-set values win.
    let merged = Object.assign({}, masterData, local);
    // Always expose canonical keys the frontend can rely on regardless of local key spelling.
    if (!merged.SCHOOL_EMAIL && merged.CONTACTEMAIL) merged.SCHOOL_EMAIL = merged.CONTACTEMAIL;
    if (!merged.SCHOOL_EMAIL && merged.SCHOOLEMAIL)  merged.SCHOOL_EMAIL = merged.SCHOOLEMAIL;
    if (!merged.SCHOOL_PHONE && merged.CONTACTPHONE) merged.SCHOOL_PHONE = merged.CONTACTPHONE;
    if (!merged.SCHOOL_PHONE && merged.SCHOOLPHONE)  merged.SCHOOL_PHONE = merged.SCHOOLPHONE;
    if (!merged.SCHOOL_NAME  && merged.SCHOOLNAME)   merged.SCHOOL_NAME  = merged.SCHOOLNAME;
    if (!merged.SCHOOL_NAME  && merged.BUSINESS_NAME) merged.SCHOOL_NAME = merged.BUSINESS_NAME;
    if (!merged.SCHOOL_ADDR  && merged.ADDRESS) merged.SCHOOL_ADDR = merged.ADDRESS;
    if (!merged.SCHOOL_EMAIL && merged.EMAIL) merged.SCHOOL_EMAIL = merged.EMAIL;
    if (!merged.SCHOOL_PHONE && merged.PHONE) merged.SCHOOL_PHONE = merged.PHONE;
    if (!merged.SCHOOL_PHONE && merged.TRANSACTION_PHONE) merged.SCHOOL_PHONE = merged.TRANSACTION_PHONE;
    if (!merged.CONTACT_NAME && merged.NAME) merged.CONTACT_NAME = merged.NAME;
    if (!merged.ORG_ID) merged.ORG_ID = getOrgId_() || '';

    if (!merged.schoolName && merged.SCHOOL_NAME) merged.schoolName = merged.SCHOOL_NAME;
    if (!merged.schoolLogo && merged.SCHOOL_LOGO) merged.schoolLogo = merged.SCHOOL_LOGO;
    if (!merged.schoolAddress && merged.SCHOOL_ADDR) merged.schoolAddress = merged.SCHOOL_ADDR;
    if (!merged.schoolEmail && merged.SCHOOL_EMAIL) merged.schoolEmail = merged.SCHOOL_EMAIL;
    if (!merged.schoolPhone && merged.SCHOOL_PHONE) merged.schoolPhone = merged.SCHOOL_PHONE;
    if (!merged.schoolCode && merged.SCHOOL_CODE) merged.schoolCode = merged.SCHOOL_CODE;
    if (!merged.orgId && merged.ORG_ID) merged.orgId = merged.ORG_ID;
    if (!merged.orgType && merged.ORG_TYPE) merged.orgType = merged.ORG_TYPE;
    if (!merged.orgName && merged.ORG_NAME) merged.orgName = merged.ORG_NAME;
    if (!merged.userSpreadsheetId && merged.USER_SPREADSHEET_ID) merged.userSpreadsheetId = merged.USER_SPREADSHEET_ID;
    if (!merged.studentPortalUrl && merged.STUDENT_PORTAL_URL) merged.studentPortalUrl = merged.STUDENT_PORTAL_URL;
    if (!merged.staffAppUrl && merged.STAFF_APP_URL) merged.staffAppUrl = merged.STAFF_APP_URL;
    if (!merged.orgDriveFolderId && merged.ORG_DRIVE_FOLDER_ID) merged.orgDriveFolderId = merged.ORG_DRIVE_FOLDER_ID;
    if (!merged.subscriptionPlan && merged.SUBSCRIPTION_PLAN) merged.subscriptionPlan = merged.SUBSCRIPTION_PLAN;
    if (!merged.expirationDate && merged.EXPIRATION_DATE) merged.expirationDate = merged.EXPIRATION_DATE;
    if (!merged.paymentType && merged.PAYMENT_TYPE) merged.paymentType = merged.PAYMENT_TYPE;
    if (!merged.dateCreated && merged.DATE_CREATED) merged.dateCreated = merged.DATE_CREATED;
    if (!merged.currentAcademicYear && merged.CURRENT_ACADEMIC_YEAR) merged.currentAcademicYear = merged.CURRENT_ACADEMIC_YEAR;
    // Principal / director comes from Register column C = NAME.
    if (merged.CONTACT_NAME) merged.schoolDirector = merged.CONTACT_NAME;
    if (!merged.adminProxyEmail && merged.SCHOOL_EMAIL) merged.adminProxyEmail = merged.SCHOOL_EMAIL;
    // Expose the script deployment exec URL so the frontend can build correct shareable links.
    if (!merged.SCRIPT_EXEC_URL) {
      try {
        const svc = ScriptApp.getService();
        if (svc) {
          const execUrl = svc.getUrl() || '';
          if (execUrl) { merged.SCRIPT_EXEC_URL = execUrl; merged.scriptExecUrl = execUrl; }
        }
      } catch(_) {}
    }
    merged = normalizeSaaSSettingsAcademicYear_(merged);
    _safeCachePut(cacheKey, JSON.stringify(merged), 1800);
    return { success: true, data: merged };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Enregistre les clés API IA UNIQUEMENT dans Script Properties — jamais dans
// la feuille Settings (évite toute exposition via getSaaSSettings_).
// Accessible uniquement aux admins / godmode.
/**
 * Purge all expired SESSION_TOKEN_* entries from Script Properties.
 * Each login writes one entry; stale ones never self-delete unless accessed.
 * Returns { deleted, kept, errors }.
 */
function purgeExpiredSessionTokens_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const now = Date.now();
    let deleted = 0, kept = 0, errors = 0;
    const toDelete = [];
    Object.keys(all).forEach(function(key) {
      if (!key.startsWith('SESSION_TOKEN_')) return;
      try {
        const rec = JSON.parse(all[key] || '{}');
        const exp = Number(rec && rec.exp || 0);
        // Delete if: no expiry field, already expired, or unparseable
        if (!exp || now > exp) {
          toDelete.push(key);
        } else {
          kept++;
        }
      } catch(_) {
        toDelete.push(key); // corrupt record — remove it
        errors++;
      }
    });
    // Delete in batches of 20 to avoid quota issues
    for (let i = 0; i < toDelete.length; i += 20) {
      const batch = toDelete.slice(i, i + 20);
      batch.forEach(function(k) {
        try { props.deleteProperty(k); deleted++; } catch(_) { errors++; }
      });
    }
    console.log('[purgeExpiredSessionTokens_] deleted=' + deleted + ' kept=' + kept + ' errors=' + errors);
    return { success: true, deleted: deleted, kept: kept, errors: errors };
  } catch(e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

function saveAiApiKeys_(data, auth) {
  const viewer = getViewerInfo_(auth);
  if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
  const isAdmin = viewer.isMaster || viewer.isGodMode ||
    (viewer.permissions && (viewer.permissions.pa_save_settings || viewer.permissions.p_settings));
  if (!isAdmin) return { success: false, error: 'Droits insuffisants.' };

  const gemini = String((data && data.gemini) || '').trim();
  const claude  = String((data && data.claude)  || '').trim();
  if (!gemini && !claude) return { success: false, error: 'Aucune clé fournie.' };

  // Clear space by purging expired session tokens before writing new keys.
  try { purgeExpiredSessionTokens_(); } catch(_) {}

  try {
    const props = PropertiesService.getScriptProperties();
    if (gemini) props.setProperty('GEMINI_API_KEY', gemini);
    if (claude)  props.setProperty('ANTHROPIC_API_KEY', claude);
    // Invalidate viewer cache so the next getViewerInfo_ picks up the new keys.
    try {
      const c = CacheService.getScriptCache();
      if (c) c.remove('VIEWER_' + (viewer.token || ''));
    } catch(_) {}
    return {
      success: true,
      configured: { gemini: !!gemini, claude: !!claude }
    };
  } catch(e) {
    return { success: false, error: String(e && e.message || 'Erreur inconnue') };
  }
}

function updateSaaSSettings_(payload, token) {
  if (!payload || typeof payload !== 'object') return { success: false, error: "Cle 'name' manquante." };

  const entries = payload.name
    ? [{ name: String(payload.name).trim(), value: payload.value }]
    : Object.keys(payload)
        .filter(key => !['token', 'auth', 'meta'].includes(String(key).toLowerCase()))
        .map(key => ({ name: String(key).trim(), value: payload[key] }))
        .filter(entry => !!entry.name);

  if (!entries.length) return { success: false, error: "Cle 'name' manquante." };

  const viewer = getViewerInfo_(token);
  const hasSettingsPermission = viewer.success && (
    viewer.isMaster ||
    viewer.isGodMode ||
    (viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings))
  );
  const bootstrapOwner = getBootstrapOwnerContext_();
  const isBootstrapWrite = !hasSettingsPermission
    && bootstrapOwner.isOwnerActiveUser
    && entries.every(entry => isBootstrapSettingKeyAllowed_(entry.name));

  if (!hasSettingsPermission && !isBootstrapWrite)
    return { success: false, error: 'Droits insuffisants.' };

  try {
    // Validation : refuse de vider une clé requise (sauf bypass explicite)
    if (!payload.allowEmptyRequired) {
      const blocked = entries.filter(function(e){
        return REQUIRED_SAAS_SETTING_KEYS_.indexOf(e.name) !== -1
            && !_isSettingValuePresent_(e.value);
      }).map(function(e){ return e.name; });
      if (blocked.length) {
        return {
          success: false,
          error: 'Clés essentielles ne peuvent être vidées : ' + blocked.join(', '),
          blocked: blocked
        };
      }
    }

    const persisted = persistSettingsEntries_(entries);
    const actor = hasSettingsPermission ? viewer.email : (bootstrapOwner.ownerEmail || bootstrapOwner.activeUserEmail || 'BOOTSTRAP_OWNER');
    const action = isBootstrapWrite ? 'BOOTSTRAP_SETTING' : 'UPDATE_SETTING';
    const perm = isBootstrapWrite ? 'BOOTSTRAP' : 'pa_save_settings';

    // Fix 5: record old value alongside new value in the audit log so changes
    // can be reviewed and reverted. Previously only wrote "Updated by <actor>".
    // We read old values from the Settings sheet that persistSettingsEntries_
    // already opened; a second read is cheaper than losing audit traceability.
    var _oldSettingsMap = {};
    try {
      var _auditSh = getSS_().getSheetByName('Settings');
      if (_auditSh && _auditSh.getLastRow() > 1) {
        var _auditData = _auditSh.getDataRange().getValues();
        for (var _ai = 1; _ai < _auditData.length; _ai++) {
          var _ak = String(_auditData[_ai][0] || '').trim();
          if (_ak) _oldSettingsMap[_ak] = String(_auditData[_ai][1] != null ? _auditData[_ai][1] : '');
        }
      }
    } catch(_auditReadErr) { /* non-fatal — fall back to unknown */ }

    entries.forEach(function(entry) {
      var oldVal = _oldSettingsMap.hasOwnProperty(entry.name)
        ? _oldSettingsMap[entry.name]
        : '(not set)';
      var newVal = entry.value !== null && typeof entry.value === 'object'
        ? JSON.stringify(entry.value)
        : String(entry.value != null ? entry.value : '');
      // Truncate very long values (curriculum blobs etc.) so audit rows stay readable
      var oldShort = oldVal.length > 120 ? oldVal.slice(0, 120) + '…' : oldVal;
      var newShort = newVal.length > 120 ? newVal.slice(0, 120) + '…' : newVal;
      var detail = 'Updated by ' + actor + ' | old: ' + oldShort + ' | new: ' + newShort;
      writeAuditLog_(action, entry.name, detail, perm);
    });
    // Mirror ATTENDANCE_WATCHLIST writes to the AttendanceAlarms sheet so the
    // alarms can be inspected/edited as a real sheet, not just a JSON blob.
    try {
      entries.forEach(function(entry){
        if (String(entry.name) === 'ATTENDANCE_WATCHLIST' && typeof _mirrorAttendanceWatchlistToSheet_ === 'function') {
          _mirrorAttendanceWatchlistToSheet_(entry.value);
        }
      });
    } catch(_) { /* non-fatal */ }
    return {
      success: true,
      message: entries.length === 1 ? ('Sauvegarde : ' + entries[0].name) : ('Sauvegarde : ' + entries.length + ' paramètres'),
      bootstrap: isBootstrapWrite,
      count: persisted.count,
      duplicatesRemoved: persisted.duplicatesRemoved || 0
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function updateStudentPortalUrlInRegister_(payload, token) {
  const body = payload || {};
  const url = String(body.url || body.link || '').trim();
  const orgId = String(body.orgId || body.ORG_ID || '').trim();
  if (!url) return { success:false, error:'Lien du portail étudiant manquant.' };

  const viewer = getViewerInfo_(token);
  const hasSettingsPermission = viewer && viewer.success && (
    viewer.isMaster ||
    viewer.isGodMode ||
    (viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings))
  );
  if (!hasSettingsPermission)
    return { success:false, error:'Droits insuffisants.' };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ssId = normalizeSpreadsheetId_(ss.getId());
    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg = master.getSheetByName('Register');
    if (!reg) return { success:false, error:'Register sheet introuvable.' };

    const data = reg.getDataRange().getValues();
    if (!data || !data.length) return { success:false, error:'Register vide.' };
    const h = data[0].map(x => String(x || '').trim().toUpperCase());
    const iSs = h.indexOf('USER_SPREADSHEET_ID');
    const iOrg = h.indexOf('ID');
    let iPortal = h.indexOf('STUDENT_PORTAL_URL');
    let iUpdated = h.indexOf('LAST_UPDATED');

    if (iSs === -1)
      return { success:false, error:'Colonne USER_SPREADSHEET_ID manquante dans Register.' };

    if (iPortal === -1) {
      reg.getRange(1, h.length + 1).setValue('STUDENT_PORTAL_URL');
      iPortal = h.length;
      h.push('STUDENT_PORTAL_URL');
    }
    if (iUpdated === -1) {
      reg.getRange(1, h.length + 1).setValue('LAST_UPDATED');
      iUpdated = h.length;
      h.push('LAST_UPDATED');
    }

    const normOrg = String(orgId || '').toLowerCase();
    let targetRow = -1;
    for (let r = data.length - 1; r >= 1; r--) {
      const rowSs = normalizeSpreadsheetId_(data[r][iSs]);
      if (rowSs !== ssId) continue;
      if (normOrg && iOrg !== -1) {
        const rowOrg = String(data[r][iOrg] || '').trim().toLowerCase();
        if (rowOrg !== normOrg) continue;
      }
      targetRow = r + 1;
      break;
    }
    if (targetRow === -1)
      return { success:false, error:'Organisation introuvable dans Register.' };

    // PERF FIX: batch url + timestamp into one setValues() call.
    const regRowData = reg.getRange(targetRow, 1, 1, h.length).getValues()[0];
    regRowData[iPortal] = url;
    regRowData[iUpdated] = new Date();
    reg.getRange(targetRow, 1, 1, regRowData.length).setValues([regRowData]);

    try {
      const cacheKey = 'SAAS_SETTINGS_' + ss.getId() + '_CURRENT';
      _safeCachePut(cacheKey, JSON.stringify(null), 1);
    } catch (_) {}

    return { success:true, message:'Lien portail étudiant mis à jour.', row:targetRow };
  } catch (e) {
    return { success:false, error:e.message };
  }
}

// ============================================================
// AUTH
// ============================================================
function hashPin_(pin) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin, Utilities.Charset.UTF_8);
  return raw.map(b => { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function normalizeAuthToken_(value) {
  let raw = value;

  if (raw && typeof raw === 'object') {
    if (raw.token) raw = raw.token;
    else if (raw.auth) raw = raw.auth;
    else if (raw.value) raw = raw.value;
    else {
      try { raw = JSON.stringify(raw); }
      catch (e) { raw = String(raw); }
    }
  }

  let str = String(raw || '').trim();
  str = str.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();

  const uuid = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid && uuid[0]) return uuid[0];

  return str;
}

function parseCachedSessionValue_(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {}
  return { email: String(rawValue).trim() };
}

function storeSessionToken_(token, payload, ttlSeconds) {
  const tokenStr = normalizeAuthToken_(token);
  if (!tokenStr) return;

  const ttl = Math.max(60, Number(ttlSeconds || 21600));
  const expiresAt = Date.now() + (ttl * 1000);
  const serializedPayload = (typeof payload === 'string') ? payload : JSON.stringify(payload || {});

  // Fast path: script cache
  try { CacheService.getScriptCache().put(tokenStr, serializedPayload, ttl); } catch (e) {}

  // Durable fallback: script properties (small, bounded payload)
  try {
    const record = JSON.stringify({
      exp: expiresAt,
      payload: serializedPayload
    });
    PropertiesService.getScriptProperties().setProperty('SESSION_TOKEN_' + tokenStr, record);
  } catch (e) {}
}

function loadSessionToken_(token) {
  const tokenStr = normalizeAuthToken_(token);
  if (!tokenStr) return null;

  // 1) cache lookup (fastest)
  try {
    const cachedRaw = CacheService.getScriptCache().get(tokenStr);
    if (cachedRaw) {
      console.log('[SESSION_TOKEN] Cache HIT for token: ' + tokenStr.substring(0, 8) + '...');
      return parseCachedSessionValue_(cachedRaw);
    }
  } catch (e) {
    console.log('[SESSION_TOKEN] Cache lookup error: ' + e.message);
  }

  console.log('[SESSION_TOKEN] Cache MISS - checking PropertiesService for token: ' + tokenStr.substring(0, 8) + '...');

  // 2) durable fallback (PropertiesService)
  try {
    const propKey = 'SESSION_TOKEN_' + tokenStr;
    const stored = PropertiesService.getScriptProperties().getProperty(propKey);
    if (!stored) {
      console.log('[SESSION_TOKEN] Token NOT found in PropertiesService: ' + tokenStr.substring(0, 8) + '...');
      return null;
    }

    const rec = JSON.parse(stored || '{}');
    if (!rec || !rec.payload) {
      console.log('[SESSION_TOKEN] Invalid session record structure');
      PropertiesService.getScriptProperties().deleteProperty(propKey);
      return null;
    }

    const exp = Number(rec.exp || 0);
    const now = Date.now();
    if (exp && now > exp) {
      console.log('[SESSION_TOKEN] Token EXPIRED (exp=' + new Date(exp).toISOString() + ', now=' + new Date(now).toISOString() + ')');
      PropertiesService.getScriptProperties().deleteProperty(propKey);
      return null;
    }

    console.log('[SESSION_TOKEN] Token found in PropertiesService, repopulating cache (exp=' + new Date(exp).toISOString() + ')');

    // Repopulate cache for faster subsequent calls
    try {
      const ttlRemaining = exp ? Math.max(60, Math.floor((exp - now) / 1000)) : 300;
      CacheService.getScriptCache().put(tokenStr, String(rec.payload), ttlRemaining);
      console.log('[SESSION_TOKEN] Repopulated cache with TTL=' + ttlRemaining + 's');
    } catch (e) {
      console.log('[SESSION_TOKEN] Cache repopulation error: ' + e.message);
    }

    return parseCachedSessionValue_(rec.payload);
  } catch (e) {
    console.log('[SESSION_TOKEN] PropertiesService lookup error: ' + e.message);
    return null;
  }
}

function buildUserSessionPayload_(sheetName, headers, row) {
  const h = headers.map(x => String(x).trim().toLowerCase());
  const find = (names) => h.findIndex(x => names.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
  const iUserId = find(['userid', 'id']);
  const iEmail = find(['email']);
  return {
    sheetName: sheetName || USERS_SHEET_NAME,
    userId: iUserId > -1 ? String(row[iUserId] || '').trim() : '',
    email: iEmail > -1 ? String(row[iEmail] || '').trim().toLowerCase() : ''
  };
}

function normalizeLoginIdentifier_(value) {
  return String(value || '').trim().toLowerCase();
}

function collectLoginCandidateRows_(data, iEmail, iUserId, iUsername, identifier) {
  const target = normalizeLoginIdentifier_(identifier);
  if (!target) return [];

  const out = [];
  const isEmailLike = target.indexOf('@') !== -1;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const email = iEmail !== -1 ? normalizeLoginIdentifier_(row[iEmail]) : '';
    const userId = iUserId !== -1 ? normalizeLoginIdentifier_(row[iUserId]) : '';
    const username = iUsername !== -1 ? normalizeLoginIdentifier_(row[iUsername]) : '';
    const emailLocal = email && email.indexOf('@') !== -1 ? email.split('@')[0] : '';

    if (target === email || target === userId || (username && target === username)) {
      out.push(i);
      continue;
    }
    if (!isEmailLike && emailLocal && target === emailLocal) {
      out.push(i);
    }
  }
  return out;
}

function collectLoginCandidateRowNumbersFromSheet_(sh, iEmail, iUserId, iUsername, identifier) {
  const target = normalizeLoginIdentifier_(identifier);
  if (!target || !sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const rowMap = {};
  const addRow = function(rowNumber) {
    const row = Number(rowNumber || 0);
    if (row >= 2) rowMap[row] = true;
  };

  const addExactMatches = function(colIdx, rawValue) {
    if (colIdx === -1) return;
    const txt = String(rawValue || '').trim();
    if (!txt) return;
    try {
      const matches = sh.getRange(2, colIdx + 1, lastRow - 1, 1)
        .createTextFinder(txt)
        .matchCase(false)
        .matchEntireCell(true)
        .findAll();
      (matches || []).forEach(function(cell) { addRow(cell.getRow()); });
    } catch (e) {}
  };

  addExactMatches(iEmail, target);
  addExactMatches(iUserId, target);
  addExactMatches(iUsername, target);

  if (target.indexOf('@') === -1 && iEmail !== -1) {
    try {
      const emailValues = sh.getRange(2, iEmail + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < emailValues.length; i++) {
        const email = normalizeLoginIdentifier_(emailValues[i][0]);
        const emailLocal = email && email.indexOf('@') !== -1 ? email.split('@')[0] : '';
        if (emailLocal && emailLocal === target) addRow(i + 2);
      }
    } catch (e) {}
  }

  return Object.keys(rowMap).map(function(v) { return Number(v); }).sort(function(a, b) { return a - b; });
}

function attemptSheetLogin_(identifier, password) {
  const logs = [];
  const debugEnabled = false; // Flip to true only when diagnosing a login issue.
  const log = (msg) => {
    if (!debugEnabled) return;
    logs.push(msg);
    console.log(msg);
  };

  try {
    // Cheap input validation BEFORE any Sheets API call (saves a round-trip on bad input).
    const target   = normalizeLoginIdentifier_(identifier);
    const rawInput = String(password || '').trim();
    if (!target || !rawInput)
      return { success: false, message: 'Identifiants incorrects.', logs };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
    if (!sh) return { success: false, message: 'Feuille Users introuvable.', logs };

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1)
      return { success: false, message: 'Feuille Users vide.', logs };

    // ⚡ ONE bulk read instead of 4+ separate getRange calls and 3 TextFinder.findAll() calls.
    // This is the single biggest speedup: Sheets API round-trips are ~200-800ms each.
    const data    = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = data[0];
    const h    = headers.map(x => String(x).trim().toLowerCase());
    const find = (names) => h.findIndex(x =>
      names.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, ''))
    );

    const iEmail     = find(['email']);
    const iUserId    = find(['userid', 'id']);
    const iUsername  = find(['username', 'login', 'identifiant']);
    const iPass      = find(['password', 'motdepasse', 'pass']);
    const iActive    = find(['active', 'actif']);
    const iReset     = find(['resetreq', 'reset_req', 'resetrequired']);
    const iLastLogin = find(['lastloginat', 'lastlogin', 'derniereconnexion']);

    if (iEmail === -1 || iPass === -1)
      return { success: false, message: 'Structure Users invalide. Colonnes: ' + headers.join(', '), logs };

    const hashed = hashPin_(rawInput);

    // In-memory candidate lookup (already used by forcePasswordUpdate_, no extra API calls).
    const candidateIdx = collectLoginCandidateRows_(data, iEmail, iUserId, iUsername, target);
    log('🔐 [LOGIN:DEBUG] target=' + target + ' candidates=' + candidateIdx.length);

    if (!candidateIdx.length)
      return { success: false, message: 'Identifiants incorrects.', logs };

    const passMatchesAt = (idx) => {
      const stored = String(data[idx][iPass] || '').trim();
      return stored.toLowerCase() === hashed || stored === rawInput;
    };
    const isRowActive = (idx) => {
      if (iActive === -1) return true;
      return String(data[idx][iActive] || '').toUpperCase() !== 'FALSE';
    };

    // Prefer an active row that matches; fall back to any matching row to surface "Compte suspendu".
    let matchIdx = candidateIdx.find(i => passMatchesAt(i) && isRowActive(i));
    if (matchIdx === undefined) matchIdx = candidateIdx.find(i => passMatchesAt(i));

    if (matchIdx === undefined)
      return { success: false, message: 'Identifiants incorrects.', logs };

    const row        = data[matchIdx];
    const rowNumber  = matchIdx + 1; // sheet rows are 1-based; data[0] is headers (sheet row 1)
    const storedPass = String(row[iPass] || '').trim();

    if (!isRowActive(matchIdx)) return { success: false, message: 'Compte suspendu.', logs };

    // Upgrade plaintext to hash lazily (best-effort, never blocks login).
    if (storedPass === rawInput) {
      try { sh.getRange(rowNumber, iPass + 1).setValue(hashed); } catch(e) {}
    }

    const token = Utilities.getUuid();
    const sessionPayload = buildUserSessionPayload_(sh.getName(), headers, row);
    storeSessionToken_(token, sessionPayload, 21600);

    if (iLastLogin !== -1) {
      try { sh.getRange(rowNumber, iLastLogin + 1).setValue(new Date()); } catch(e) {}
    }

    const defaultHash   = hashPin_('123456');
    const isDefaultPass = storedPass.toLowerCase() === defaultHash || storedPass === '123456';
    if ((iReset !== -1 && String(row[iReset]).toUpperCase() === 'TRUE') || isDefaultPass)
      return { success: true, status: 'RESET_REQUIRED', token, logs };

    return { success: true, status: 'AUTHORIZED', token, logs };

  } catch(e) {
    console.log('🔐 [LOGIN:ERROR] ' + e.message);
    return { success: false, message: 'Erreur login: ' + e.message, logs };
  }
}
function forcePasswordUpdate_(identifier, oldPass, newPass, resetToken) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
    if (!sh) return { success: false, error: 'Feuille Users introuvable.' };

    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim().toLowerCase());
    const find = (names) => h.findIndex(x => names.some(v => x.replace(/[\s_]/g,'') === v.replace(/[\s_]/g,'')));

    const iEmail  = find(['email']);
    const iUserId = find(['userid', 'id']);
    const iUsername = find(['username', 'login', 'identifiant']);
    const iPass   = find(['password', 'motdepasse', 'pass']);
    const iActive = find(['active', 'actif']);
    const iReset  = find(['resetreq', 'reset_req', 'resetrequired']);

    const target = normalizeLoginIdentifier_(identifier);
    const oldRaw = String(oldPass || '').trim();
    const newRaw = String(newPass || '').trim();
    if (!target || !newRaw)
      return { success: false, error: 'Validation echouee.' };

    const tokenStr       = normalizeAuthToken_(resetToken);
    const trustedSession = tokenStr ? loadSessionToken_(tokenStr) : null;
    const trustedEmail   = trustedSession && trustedSession.email ? String(trustedSession.email).toLowerCase().trim() : '';
    const trustedUserId  = trustedSession && trustedSession.userId ? String(trustedSession.userId).toLowerCase().trim() : '';
    const hasTrustedSession = !!(trustedEmail || trustedUserId);

    const oldHashed  = oldRaw ? hashPin_(oldRaw) : '';
    const newHashed  = hashPin_(newRaw);
    const isRowActive = (idx) => iActive === -1 || String(data[idx][iActive]).toUpperCase() !== 'FALSE';

    const candidates = collectLoginCandidateRows_(data, iEmail, iUserId, iUsername, target);
    if (!candidates.length)
      return { success: false, error: 'Validation echouee.' };

    let rowIdx = -1;

    if (hasTrustedSession) {
      rowIdx = candidates.find(i => {
        if (!isRowActive(i)) return false;
        const rowEmail = iEmail !== -1 ? normalizeLoginIdentifier_(data[i][iEmail]) : '';
        const rowUserId = iUserId !== -1 ? normalizeLoginIdentifier_(data[i][iUserId]) : '';
        if (trustedEmail && rowEmail === trustedEmail) return true;
        if (trustedUserId && rowUserId === trustedUserId) return true;
        return false;
      });
      if (rowIdx === undefined) rowIdx = candidates[0];
    } else {
      for (let k = 0; k < candidates.length; k++) {
        const i = candidates[k];
        const storedPass = String(data[i][iPass] || '').trim();
        const oldMatches = !!oldRaw && (storedPass.toLowerCase() === oldHashed || storedPass === oldRaw);
        if (oldMatches && isRowActive(i)) { rowIdx = i; break; }
        if (oldMatches && rowIdx === -1)    rowIdx = i;
      }
    }

    if (rowIdx !== -1) {
      // PERF FIX: batch password + reset flag into one setValues() call.
      const updPassRow = data[rowIdx].slice();
      updPassRow[iPass] = newHashed;
      if (iReset !== -1) updPassRow[iReset] = 'FALSE';
      sh.getRange(rowIdx + 1, 1, 1, updPassRow.length).setValues([updPassRow]);
      const token = Utilities.getUuid();
      const sessionPayload = buildUserSessionPayload_(sh.getName(), data[0], data[rowIdx]);
      storeSessionToken_(token, sessionPayload, 21600);
      return { success: true, token };
    }

    return { success: false, error: 'Validation echouee.' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
function getViewerInfo_(token) {
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log(msg); };

  // ── FAST PATH: viewer cache check BEFORE any sheet/seed work ──────────
  // The Users sheet scan + ensureInternalGodModeAccount_ each cost a sheet
  // round-trip. Hitting the cache first turns repeat calls (every API hit
  // during a session) into a sub-millisecond lookup.
  try {
    const fastToken = normalizeAuthToken_(token);
    const fastInvalid = ['null','undefined','','PREVIEW_TOKEN'].some(t => fastToken.toUpperCase() === String(t).toUpperCase());
    if (fastToken && !fastInvalid) {
      const fastCached = _safeCacheGetData_('VIEWER_' + fastToken);
      if (fastCached && fastCached.success) {
        return Object.assign({}, fastCached, { logs: ['[AUTH] fast-cache hit'] });
      }
    }
  } catch (_e) {}

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ssId = ss.getId();

    // Run seed and collect its debug logs
    const seedResult = ensureInternalGodModeAccount_(ss, { healExisting: false });
    if (seedResult && Array.isArray(seedResult.logs)) {
      seedResult.logs.forEach(l => log(l));
    }
    if (!seedResult || seedResult.success === false) {
      log('[GODMODE_SEED] Failed for Users sheet ' + ssId + ': ' + ((seedResult && seedResult.error) || 'UNKNOWN'));
    }

    let deploymentOwnerEmail = '';
    try { deploymentOwnerEmail = Session.getEffectiveUser().getEmail().toLowerCase().trim(); } catch(e) {}

    const tokenStr = normalizeAuthToken_(token);
    const invalidLiterals = ['null', 'undefined', '', 'PREVIEW_TOKEN'];
    const hasInvalidLiteral = invalidLiterals.some(t => tokenStr.toUpperCase() === String(t).toUpperCase());
    const hasUsableToken = !!tokenStr && !hasInvalidLiteral;

    log('[AUTH_COMPARE] ownerEmail=' + (deploymentOwnerEmail || '(empty)') +
        ' hasUsableToken=' + hasUsableToken);

    // Strict verification: never authenticate from Google session context alone.
    if (!hasUsableToken) {
      log('[AUTH] No usable token supplied — verification denied.');
      return { success: false, error: 'TOKEN_MISSING', logs };
    }

    if (hasUsableToken) {
      const cachedViewer = _safeCacheGetData_('VIEWER_' + tokenStr);
      if (cachedViewer && cachedViewer.success) {
        log('[AUTH] Returning cached viewer for token');
        // Attach logs to cached viewer so frontend still sees them
        return Object.assign({}, cachedViewer, { logs });
      }
    }

    let orgName = 'Mon Ecole';
    try {
      const orgNameCacheKey = 'ORG_NAME_' + ssId;
      const cachedOrgName = _safeCacheGetData_(orgNameCacheKey);
      if (cachedOrgName) orgName = String(cachedOrgName);
      else {
        orgName = resolveOrgBySpreadsheetId_(ssId).orgName;
        _safeCachePut(orgNameCacheKey, JSON.stringify(orgName), 1800);
      }
    } catch(e) { log('[AUTH] orgName resolve failed: ' + e.message); }

    const MASTER_PERMS = getMasterPermsTemplate_();

    let cachedEmail = '';
    let cachedUserId = '';
    let preferredSheetName = '';
    let cachedVal = '';
    if (hasUsableToken) {
      const cachedSession = loadSessionToken_(tokenStr);
      if (!cachedSession) {
        log('[AUTH] ❌ Session token not found or expired for token: ' + tokenStr.substring(0, 8) + '...');
        return { success: false, error: 'SESSION_EXPIRED', logs };
      }
      log('[AUTH] ✅ Session token loaded successfully');
      cachedEmail        = cachedSession.email       ? String(cachedSession.email).toLowerCase().trim()       : '';
      cachedUserId       = cachedSession.userId      ? String(cachedSession.userId).trim()                    : '';
      preferredSheetName = cachedSession.sheetName   ? String(cachedSession.sheetName).trim()                 : '';
      cachedVal          = String(cachedSession.userId || cachedSession.studentCode || cachedSession.email || '').trim();
      log('[AUTH] Session loaded — email=' + cachedEmail + ' userId=' + cachedUserId + ' sheet=' + preferredSheetName);
    }

    const targetEmail = (cachedEmail || '').toLowerCase().trim();
    log('[AUTH] targetEmail resolved to: ' + (targetEmail || '(empty)'));
    if (!targetEmail) return { success: false, error: 'TOKEN_MISSING', logs };

    // Clés IA lues une seule fois depuis Script Properties, injectées dans
    // TOUS les viewers (staff ET élèves) pour les appels directs navigateur.
    const _aiSessionKey_ = {};
    try {
      const _sp_ = PropertiesService.getScriptProperties();
      const _gk_ = String(_sp_.getProperty('GEMINI_API_KEY')    || '').trim();
      const _ck_ = String(_sp_.getProperty('ANTHROPIC_API_KEY') || '').trim();
      if (_gk_) _aiSessionKey_.gemini = _gk_;
      if (_ck_) _aiSessionKey_.claude = _ck_;
    } catch(_e_) { log('[AUTH] aiSessionKey read error: ' + _e_.message); }

    // [A] Search in Users / Admin_Users (Staff + GodMode)
    const userSheetNames = [];
    [preferredSheetName, USERS_SHEET_NAME, 'Admin_Users'].forEach(name => {
      if (name && userSheetNames.indexOf(name) === -1) userSheetNames.push(name);
    });
    log('[AUTH] Searching sheets: ' + userSheetNames.join(', '));

    for (let s = 0; s < userSheetNames.length; s++) {
      const shUsers = ss.getSheetByName(userSheetNames[s]);
      if (!shUsers) { log('[AUTH] Sheet not found: ' + userSheetNames[s]); continue; }

      const dataU = shUsers.getDataRange().getValues();
      if (!dataU || dataU.length < 2) { log('[AUTH] Sheet empty: ' + userSheetNames[s]); continue; }

      const hU = dataU[0].map(x => String(x).trim().toLowerCase());
      const find = (names) => hU.findIndex(x => names.some(v => x.replace(/[\s_]/g,'') === v.replace(/[\s_]/g,'')));

      const iEmail    = find(['email']);
      const iUserId   = find(['userid', 'id']);
      const iActive   = find(['active', 'actif']);
      const iRole     = find(['role']);
      const iJson     = find(['permissionsjson', 'permissions']);
      const iName     = find(['name', 'nom']);
      const iTeacher  = find(['isteacher']);
      const iSubjects = find(['assignedsubjects']);
      const iReset    = find(['resetreq', 'reset_req', 'resetrequired']);
      const iPhoto    = find(['photo', 'photourl', 'avatarurl', 'picture']);
      if (iEmail === -1) { log('[AUTH] No Email column in sheet: ' + userSheetNames[s]); continue; }

      const candidates = dataU.slice(1).filter(r => String(r[iEmail]).toLowerCase().trim() === targetEmail);
      log('[AUTH] Sheet "' + userSheetNames[s] + '" — candidates matching email: ' + candidates.length);
      if (!candidates.length) continue;

      let rowU = null;
      if (hasUsableToken && cachedUserId && iUserId !== -1) {
        rowU = candidates.find(r => String(r[iUserId] || '').trim() === cachedUserId) || null;
      }
      if (!rowU) rowU = candidates.find(r => iActive === -1 || String(r[iActive]).toUpperCase() !== 'FALSE');
      if (!rowU) rowU = candidates[0];

      if (iActive !== -1 && String(rowU[iActive]).toUpperCase() === 'FALSE') {
        log('[AUTH] Account is suspended for: ' + targetEmail);
        return { success: false, error: 'ACCOUNT_SUSPENDED', logs };

            // Enforce password reset before granting full session access
            if (iReset !== -1 && String(rowU[iReset] || '').toUpperCase() === 'TRUE') {
              log('[AUTH] RESET_REQUIRED for: ' + targetEmail);
              return { success: true, status: 'RESET_REQUIRED', token: tokenStr,
                       email: targetEmail,
                       name: iName !== -1 ? String(rowU[iName] || '') : targetEmail.split('@')[0],
                       logs };
            }
      }

      let perms = parsePermissionsCell_(rowU[iJson]);
      let assignedSubjects = [];
      try { assignedSubjects = JSON.parse(rowU[iSubjects] || '[]'); } catch(e) {}

      let isGodModeEnabled  = Boolean(perms.isGodMode);

      // GODMODE GUARD: if the logged-in email matches the registered owner in Master Register
      // (or is an internal Meigens account), force godmode even if the Users sheet PermissionsJson
      // got cleared/corrupted. This prevents lockout of the master/admin account.
      if (!isGodModeEnabled) {
        try {
          const registered = getRegisteredAdminIdentity_(ssId);
          const ownerEmail = String(registered && registered.email || '').toLowerCase().trim();
          const isRegisteredOwner = ownerEmail && ownerEmail === targetEmail;
          const isMeigensInternal = targetEmail === 'meigenstech@gmail.com' || targetEmail.endsWith('@meigens.tech');
          if (isRegisteredOwner || isMeigensInternal) {
            log('[AUTH] 🔓 Auto-granting GODMODE — email matches registered owner / Meigens internal: ' + targetEmail);
            isGodModeEnabled = true;
            perms.isGodMode = true;
            // Heal the Users sheet so future logins are direct
            try {
              if (iJson !== -1) {
                const targetRow = dataU.findIndex((r, idx) => idx > 0 && String(r[iEmail]).toLowerCase().trim() === targetEmail);
                if (targetRow > 0) {
                  shUsers.getRange(targetRow + 1, iJson + 1).setValue('GodMode');
                  log('[AUTH] ✅ Healed PermissionsJson for ' + targetEmail);
                }
              }
            } catch (healErr) { log('[AUTH] heal skipped: ' + healErr.message); }
          }
        } catch (guardErr) { log('[AUTH] godmode guard failed: ' + guardErr.message); }
      }

      const isReadOnlyAccount = isInternalReadOnlyPerms_(perms);
      delete perms.isGodMode;
      perms.assignedSubjects = assignedSubjects;

      const roleUpper    = (iRole !== -1 ? rowU[iRole] : 'STAFF').toString().toUpperCase();
      const isMasterUser = isGodModeEnabled;

      log('[AUTH] Role=' + roleUpper + ' isGodMode=' + isGodModeEnabled + ' hasUsableToken=' + hasUsableToken);

      const staffViewer = {
        success:          true,
        isMaster:         isMasterUser,
        email:            targetEmail,
        orgName,
        role:             roleUpper,
        name:             iName !== -1 ? rowU[iName] : targetEmail.split('@')[0],
        token:            tokenStr,
        permissions:      perms,
        isTeacher:        iTeacher !== -1 ? String(rowU[iTeacher]).toUpperCase() === 'TRUE' : false,
        assignedSubjects: assignedSubjects,
        userId:           iUserId !== -1 ? String(rowU[iUserId] || '').trim() : cachedUserId,
        isGodMode:        isGodModeEnabled,
        isReadOnly:       isReadOnlyAccount,
         photo:            iPhoto !== -1 ? String(rowU[iPhoto] || '').trim() : '',
        aiSessionKey:     _aiSessionKey_,
        logs
      };

      if (isGodModeEnabled) {
        staffViewer.permissions = Object.assign({}, MASTER_PERMS, staffViewer.permissions || {});
      }

      if (hasUsableToken) _safeCachePut('VIEWER_' + tokenStr, JSON.stringify(staffViewer), 300);
      log('[AUTH] ✅ Viewer resolved successfully for: ' + targetEmail);
      return staffViewer;
    }

    // [B] Search in Students sheet (token required)
    const shStud = hasUsableToken ? ss.getSheetByName('students') : null;
    if (shStud) {
      const dataS = shStud.getDataRange().getValues();
      const hS    = dataS[0].map(x => String(x).trim().toLowerCase());
      const iCode  = hS.indexOf('studentcode');
      const iFName = hS.indexOf('firstname');
      const iLName = hS.indexOf('lastname');
      const iLevel = hS.indexOf('currentlevel');
      const iPhoto = hS.indexOf('photourl');
      const iEmail = hS.indexOf('email');

      const rowS = dataS.find(r => String(r[iCode]).trim() === String(cachedVal || '').trim());
      if (rowS) {
        log('[AUTH] ✅ Student viewer resolved for cachedVal: ' + cachedVal);
        const studentLevel = iLevel !== -1 ? String(rowS[iLevel] || '').trim() : '';
        const studentPhoto = iPhoto !== -1 ? String(rowS[iPhoto] || '').trim() : '';
        const studentEmail = iEmail !== -1 ? String(rowS[iEmail] || '').trim() : (targetEmail || '');
        const settingsRes = getSaaSSettings_(tokenStr);
        const settingsData = settingsRes && settingsRes.success && settingsRes.data && typeof settingsRes.data === 'object'
          ? settingsRes.data
          : {};
        const studentScope = buildStudentViewerAccessScope_(cachedVal, studentLevel);
        const studentPerms = buildStudentPortalPermissions_(settingsData);
        studentPerms.assignedSubjects = studentScope;
        const studentViewer = {
          success:     true,
          isMaster:    false,
          role:        'STUDENT',
          id:          cachedVal,
          userId:      cachedVal,
          email:       studentEmail,
          name:        (rowS[iFName] || '') + ' ' + (rowS[iLName] || ''),
          orgName,
          token:       tokenStr,
          level:       studentLevel,
          photo:       studentPhoto,
          accessScope: studentScope,
          assignedSubjects: studentScope,
          permissions: studentPerms,
          isGodMode:   false,
          aiSessionKey: _aiSessionKey_ || {},
          logs
        };
        _safeCachePut('VIEWER_' + tokenStr, JSON.stringify(studentViewer), 300);
        return studentViewer;
      }
    }

    log('[AUTH] ❌ USER_NOT_FOUND for targetEmail: ' + targetEmail);
    return { success: false, error: 'USER_NOT_FOUND', logs };

  } catch(e) {
    log('[AUTH] ❌ EXCEPTION: ' + e.message);
    return { success: false, error: e.message, logs };
  }
}
// ============================================================
// FONCTION HELPER — Données page de téléchargement mobile
// À AJOUTER dans votre backend, avant doGet
// ============================================================
const MOBILE_APK_URL_ = 'https://expo.dev/accounts/metellus90/projects/edu-haiti/builds/1b8983d0-e788-4209-845b-267cea1565bf.apk';

function getDownloadPageData_(fallbackSchoolName) {
  try {
    const settings = getSaaSSettings_(null);
    const data     = (settings && settings.success && settings.data) ? settings.data : {};

    // URL de déploiement auto-détectée
    let scriptExecUrl = String(data.SCRIPT_EXEC_URL || data.scriptExecUrl || '').trim();
    if (!scriptExecUrl) {
      try {
        const svc = ScriptApp.getService();
        if (svc) scriptExecUrl = svc.getUrl() || '';
      } catch(_) {}
    }

    const schoolName = String(
      data.SCHOOL_NAME || data.schoolName || data.ORG_NAME || data.orgName ||
      fallbackSchoolName || 'École'
    ).trim();
    const schoolLogo = String(data.SCHOOL_LOGO || data.schoolLogo || data.logoUrl || '').trim();
    const apkUrl     = String(data.MOBILE_APK_URL || data.apkUrl || MOBILE_APK_URL_ || '').trim();

    return { success: true, scriptExecUrl, schoolName, schoolLogo, apkUrl };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// doGet - Routage intelligent
// ============================================================
function doGet(e) {
  try {
    // Handle API calls via action parameter
    if (e && e.parameter && e.parameter.action) {
      const action = e.parameter.action;
      const data = {};
      const auth = e.parameter.token || e.parameter.auth || null;
      
      // Copy all parameters except action and auth/token to data
      if (e.parameter) {
        Object.keys(e.parameter).forEach(key => {
          if (key !== 'action' && key !== 'token' && key !== 'auth') {
            data[key] = e.parameter[key];
          }
        });
      }
      
      const result = apiHub(action, data, auth);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const getParam_ = function(names){
      if (!e || !e.parameter) return '';
      for (let i = 0; i < names.length; i++) {
        const key = names[i];
        if (Object.prototype.hasOwnProperty.call(e.parameter, key)) {
          const val = String(e.parameter[key] || '').trim();
          if (val) return val;
        }
      }
      return '';
    };

    // PERF: Use 15-min cache for subscription status (was forceFresh: true on every load).
    // Cache busts automatically when admin saves a new plan via updateSaaSSettings_.
    // Force-fresh can still be requested via ?refresh=1 in the URL.
    const reqOrgId = getParam_(['orgId', 'orgID', 'orgid', 'ORG_ID']);
    const reqSpreadsheetId = getParam_(['spreadsheetId', 'spreadsheetID', 'spreadsheetid', 'sheetId', 'sheetID', 'sheetid', 'ssId', 'SSID']);
    const wantFresh = getParam_(['refresh', 'forceFresh', 'nocache']) === '1';
    const license = checkSubscriptionStatus_({ forceFresh: wantFresh, orgId: reqOrgId, spreadsheetId: reqSpreadsheetId });
    const schoolName = license.orgName;
    // PERF: Defer the heavy Generated_IDs sync to a background trigger
    // instead of blocking page load. The trigger runs every 10 minutes.
    try { _scheduleGeneratedIdsSync_(); } catch(syncErr) { Logger.log('SYNC schedule ignored: ' + syncErr.message); }
    const token = (e && e.parameter && e.parameter.token) ? String(e.parameter.token).trim() : '';
    const page  = (e && e.parameter && e.parameter.page)  ? String(e.parameter.page).toLowerCase() : 'admin';
    const verifyParam = getParam_(['verify', 'verifyId']);
    const idParam = getParam_(['id']);

    // 1. Page de téléchargement mobile (publique — aucune auth requise)
    // Lien à partager aux élèves/staff : https://script.google.com/.../exec?page=download
    if (page === 'download') {
      const dlData = getDownloadPageData_(schoolName);
      const t = HtmlService.createTemplateFromFile('DownloadPage');
      t.schoolName    = dlData.schoolName    || schoolName || 'École';
      t.schoolLogo    = dlData.schoolLogo    || '';
      t.scriptExecUrl = dlData.scriptExecUrl || '';
      t.apkUrl        = dlData.apkUrl        || MOBILE_APK_URL_ || '';
      return t.evaluate()
        .setTitle('Télécharger l\'app — ' + (dlData.schoolName || schoolName))
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width,initial-scale=1,maximum-scale=1');
    }

    // 2. Page de vérification publique
    // Accept direct QR URLs like ?verify=BV-... without requiring page=verify.
    if (verifyParam || page === 'verify') {
      const verifyId = String(verifyParam || '').trim();
      const isBulletinId = /^BV-/i.test(verifyId || idParam);

      // Bulletin authenticity route (QR format BV-...)
      if (verifyId || isBulletinId) {
        const bulletinRes = verifyBulletin_({ verifyId: (verifyId || idParam) }, null);
        const rec = (bulletinRes && bulletinRes.record) ? bulletinRes.record : {};
        const verified = !!(bulletinRes && bulletinRes.success && bulletinRes.verified);
        const safeSchool = String((bulletinRes && bulletinRes.schoolName) || schoolName || 'École');
        const safeLogo = String((bulletinRes && bulletinRes.schoolLogo) || '').trim();
        const safeId = String((bulletinRes && bulletinRes.verifyId) || verifyId || idParam || '').trim();
        const esc = function(v){
          return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
        const logoSrc = safeLogo ? esc(safeLogo) : 'https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png';

        const html = ''
          + '<!DOCTYPE html><html><head><meta charset="UTF-8">'
          + '<meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<title>Vérification Bulletin - ' + esc(safeSchool) + '</title>'
          + '<style>'
          + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 52%,#0b5d3b 100%);font-family:Segoe UI,Arial,sans-serif;color:#fff}'
          + '.card{width:min(860px,96vw);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:20px;padding:24px 26px;box-shadow:0 26px 70px rgba(2,6,23,.45);backdrop-filter:blur(5px)}'
          + '.hero{display:flex;gap:18px;align-items:center;margin-bottom:16px}'
          + '.logo-wrap{position:relative;width:104px;height:104px;display:grid;place-items:center;border-radius:999px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.28)}'
          + '.logo{width:72px;height:72px;border-radius:999px;object-fit:cover;background:#fff;padding:4px;animation:spin 1.1s linear infinite}'
          + '.check{position:absolute;right:-4px;bottom:-4px;width:34px;height:34px;border-radius:999px;background:#16a34a;border:3px solid #dcfce7;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(22,163,74,.45)}'
          + '.check svg{width:18px;height:18px;stroke:#fff;stroke-width:3;fill:none}'
          + '.ttl{font-size:28px;font-weight:900;letter-spacing:.3px;line-height:1.12}'
          + '.sub{margin-top:4px;font-size:13px;color:#dbeafe}'
          + '.pill{display:inline-block;margin-top:10px;padding:7px 12px;border-radius:999px;background:rgba(22,163,74,.22);border:1px solid rgba(34,197,94,.45);font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#bbf7d0}'
          + '.grid{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}'
          + '.row{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 12px}'
          + '.k{font-size:11px;color:#bfdbfe;text-transform:uppercase;letter-spacing:.55px;margin-bottom:4px}'
          + '.v{font-size:15px;font-weight:800;color:#fff;word-break:break-word}'
          + '.bad{margin-top:10px;font-weight:900;color:#fecaca;background:rgba(127,29,29,.35);border:1px solid rgba(248,113,113,.6);padding:10px 12px;border-radius:10px}'
          + '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'
          + '</style></head><body>'
          + '<div class="card">'
          + '<div class="hero">'
          +   '<div class="logo-wrap"><img class="logo" src="' + logoSrc + '" alt="Logo école">'
          +     '<div class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.3 4.3L19 7.4"/></svg></div>'
          +   '</div>'
          +   '<div><div class="ttl">Vérification du bulletin</div>'
          +   '<div class="sub">Établissement: ' + esc(safeSchool) + '</div>'
          +   '<div class="pill">Document authentifié</div></div>'
          + '</div>'
          + '<div class="grid">'
          +   '<div class="row"><div class="k">ID</div><div class="v">' + esc(safeId) + '</div></div>'
          +   '<div class="row"><div class="k">Élève</div><div class="v">' + esc(String(rec.studentName || '--')) + '</div></div>'
          +   '<div class="row"><div class="k">Classe</div><div class="v">' + esc(String(rec.className || '--')) + '</div></div>'
          +   '<div class="row"><div class="k">Année</div><div class="v">' + esc(String(rec.year || '--')) + '</div></div>'
          +   '<div class="row"><div class="k">Période</div><div class="v">' + esc(String(rec.period || '--')) + '</div></div>'
          +   '<div class="row"><div class="k">Émis le</div><div class="v">' + esc(String(rec.issuedAt || '--')) + '</div></div>'
          + '</div>'
          + (verified
              ? ''
              : '<div class="bad">Document non authentifié</div>')
          + '</div></body></html>';

        return HtmlService.createHtmlOutput(html)
          .setTitle('Vérification -- ' + safeSchool)
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      }

      // Legacy public verify route by id
      const certData = getImmersiveData_({ id: String(idParam || '').trim() });
      if (!certData.success) return HtmlService.createHtmlOutput('Document non authentifié');
      const t = HtmlService.createTemplateFromFile('PublicVerify');
      t.res = certData; t.schoolName = schoolName;
      return t.evaluate().setTitle('Vérification -- ' + schoolName).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // 3. Validation de la session
    const viewer = getViewerInfo_(token || null);

    // 4. ROUTAGE : Choix du template selon le rôle (le login est géré par le fichier principal)
    let templateName = 'Admin'; // Par défaut
    if (viewer.success && (viewer.role === 'STUDENT' || page === 'student')) {
      templateName = 'StudentPortal';
    }

    const t = HtmlService.createTemplateFromFile(templateName);
    let userSettingsSafe = {};
    try {
      const sr = getSaaSSettings_(token || null);
      if (sr && sr.success && sr.data && typeof sr.data === 'object') userSettingsSafe = sr.data;
    } catch (_settingsErr) {}
    if (!userSettingsSafe || typeof userSettingsSafe !== 'object') userSettingsSafe = {};
    if (!userSettingsSafe.googleSheetId) {
      try {
        const activeSs = SpreadsheetApp.getActiveSpreadsheet();
        userSettingsSafe.googleSheetId = activeSs ? String(activeSs.getId() || '').trim() : '';
      } catch (_ssErr) {
        userSettingsSafe.googleSheetId = '';
      }
    }

    t.userSettings = userSettingsSafe;
    t.token    = token;
    t.isMaster = viewer.isMaster === true;
    t.role     = viewer.role || '';
    t.orgName  = schoolName;
    t.userName = viewer.name || '';

    const out = t.evaluate()
      .setTitle(schoolName + ' -- ' + (viewer.success && viewer.role === 'STUDENT' ? 'Espace Élève' : 'Portail Admin'))
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport','width=device-width,initial-scale=1,maximum-scale=1');

    // Runtime hardening: avoid frontend crashes when older deployed templates reference bulletin helpers before definition.
    const guardBootstrap = '<script>(function(){try{if(typeof ensureBackendBulletinDataReady_!=="function"){window.ensureBackendBulletinDataReady_=function(){return Promise.resolve(true);};}}catch(_e){}})();</script>';
    try {
      out.setContent(guardBootstrap + out.getContent());
    } catch (_guardErr) {}
    return out;

  } catch(err) {
    // ── Collect forensic context ─────────────────────────────────────────
    const ts = new Date().toISOString();
    let deployerEmail = '';
    let activeEmail   = '';
    let scriptId      = '';
    let scriptUrl     = '';
    let spreadsheetId = '';
    let spreadsheetName = '';
    try { deployerEmail = Session.getEffectiveUser().getEmail(); } catch(_) {}
    try { activeEmail   = Session.getActiveUser().getEmail();    } catch(_) {}
    try { scriptId      = ScriptApp.getScriptId();               } catch(_) {}
    try { scriptUrl     = ScriptApp.getService().getUrl();       } catch(_) {}
    try {
      const _ss = SpreadsheetApp.getActiveSpreadsheet();
      spreadsheetId   = _ss.getId();
      spreadsheetName = _ss.getName();
    } catch(_) {}

    const errMessage = String((err && err.message) || 'Erreur inconnue');
    const isFraudSignal = /certifi|autoris|enregistr/i.test(errMessage);
    const isExpiredSignal = /abonnement\s*expir|expir|renouvel/i.test(errMessage);
    const isSuspendedSignal = /compte\s*suspendu|suspendu/i.test(errMessage);
    const blockReason = isFraudSignal
      ? 'FRAUD_ALERT'
      : (isExpiredSignal
          ? 'SUBSCRIPTION_EXPIRED'
          : (isSuspendedSignal ? 'ACCOUNT_SUSPENDED' : 'ACCESS_BLOCKED'));
    const subject = isFraudSignal
      ? '🚨 [ALERTE FRAUDE] Tentative d\'accès non autorisé — ' + ts
      : '⚠️ [Erreur doGet] ' + errMessage.slice(0, 80) + ' — ' + ts;
    // Only send an email alert for genuine fraud/unauthorized access.
    // Subscription expiry and suspension are expected operational states —
    // logging them to the sheet is enough; no email spam to Meigens.
    let alertResult = { success: false, transport: 'SKIPPED', sheetLogged: false };
    if (isFraudSignal) {
      alertResult = sendFraudAlert_({
        ts, deployerEmail, activeEmail, scriptId, scriptUrl,
        spreadsheetId, spreadsheetName, errorMessage: errMessage, isFraudSignal
      });
    } else {
      // Log non-fraud errors silently to the sheet and auditlog only.
      const sheetWrite = writeSecurityAlert_({
        timestamp: new Date(ts),
        alertType: blockReason,
        severity: 'LOW',
        transport: 'NONE',
        emailSent: false,
        recipients: [],
        deployerEmail, activeEmail, scriptId, scriptUrl,
        spreadsheetId, spreadsheetName,
        errorMessage: errMessage,
        deliveryError: '',
        meta: { subject, isFraudSignal: false }
      });
      writeMasterAuthAuditLog_(
        blockReason, spreadsheetId || scriptId || 'UNKNOWN',
        { deployerEmail, activeEmail, errorMessage: errMessage },
        'SYSTEM_LOG', false
      );
      alertResult.sheetLogged = !!(sheetWrite && sheetWrite.success);
    }

    // ── Render the error page ────────────────────────────────────────────
    const reqToken = (e && e.parameter && (e.parameter.token || e.parameter.auth))
      ? String(e.parameter.token || e.parameter.auth).trim()
      : '';
    const getParam_ = function(names){
      if (!e || !e.parameter) return '';
      for (let i = 0; i < names.length; i++) {
        const key = names[i];
        if (Object.prototype.hasOwnProperty.call(e.parameter, key)) {
          const val = String(e.parameter[key] || '').trim();
          if (val) return val;
        }
      }
      return '';
    };
    const reqOrgId = getParam_(['orgId', 'orgID', 'orgid', 'ORG_ID']);
    const reqSpreadsheetId = getParam_(['spreadsheetId', 'spreadsheetID', 'spreadsheetid', 'sheetId', 'sheetID', 'sheetid', 'ssId', 'SSID']);
    const reqPage = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).trim() : '';
    const reqDebug = (e && e.parameter && e.parameter.debug) ? String(e.parameter.debug).trim().toLowerCase() : '';
    const blockedCtx = getBlockedPageContext_(spreadsheetId, reqToken);

    // If the deployer is a Meigens staff account, always show the privileged admin
    // detail view — this prevents Meigens from seeing a generic blocked screen on
    // their own internal/test spreadsheets that have no token yet.
    const isMeigensDeployer = /meigenstech@gmail\.com|@meigens\.tech/i.test(deployerEmail);
    if (!blockedCtx.isPrivileged && isMeigensDeployer) {
      blockedCtx.isPrivileged = true;
    }

    const showDebugPanel = blockedCtx.isPrivileged || isMeigensDeployer || reqDebug === '1' || reqDebug === 'true' || reqDebug === 'yes';
    const debugSnapshot = collectBlockedAlertDebug_({
      blockReason: blockReason,
      errorMessage: errMessage,
      alertResult: alertResult,
      deployerEmail: deployerEmail,
      activeEmail: activeEmail,
      scriptId: scriptId,
      spreadsheetId: spreadsheetId,
      spreadsheetName: spreadsheetName,
      request: {
        token: reqToken,
        orgId: reqOrgId,
        spreadsheetId: reqSpreadsheetId,
        page: reqPage
      }
    });
    const debugJson = htmlEncodeForDebug_(JSON.stringify(debugSnapshot, null, 2));

    const showSubscriptionReason = blockReason === 'SUBSCRIPTION_EXPIRED' && blockedCtx.isPrivileged;

    const pageTitle = showSubscriptionReason
      ? 'Abonnement Expiré'
      : (blockReason === 'FRAUD_ALERT' ? 'Alerte Sécurité' : 'Accès Bloqué');
    const pageIcon = showSubscriptionReason
      ? '⏳'
      : (blockReason === 'FRAUD_ALERT' ? '🚨' : '🔒');

    const displayMsg = showSubscriptionReason
      ? (blockedCtx.isPrivileged
          ? 'Abonnement établissement expiré. Vous êtes connecté en administrateur : détails de souscription affichés ci-dessous.'
          : 'L\'abonnement de cet établissement est expiré. Veuillez contacter l\'administration pour renouveler l\'accès.')
      : (blockReason === 'FRAUD_ALERT'
          ? 'Tentative d\'accès non autorisée détectée. Cet accès est bloqué pour des raisons de sécurité.'
          : (blockedCtx.isPrivileged
              ? 'Compte établissement bloqué. Vous êtes connecté en administrateur : détails affichés ci-dessous.'
              : 'Accès refusé. Contactez l\'administrateur de l\'établissement pour assistance.'));

    const meigensEmail = 'meigenstech@gmail.com';
    const meigensPhoneRaw = ERROR_CONFIG.contactPhone || '+50946256973';
    const schoolEmail = blockedCtx.schoolEmail || '';
    const schoolPhoneRaw = blockedCtx.schoolPhone || '';
    const useMeigensSupport = blockedCtx.isPrivileged || blockReason === 'FRAUD_ALERT';
    const supportEmail = useMeigensSupport ? meigensEmail : (schoolEmail || meigensEmail);
    const supportPhoneRaw = useMeigensSupport ? meigensPhoneRaw : (schoolPhoneRaw || meigensPhoneRaw);
    const supportPhoneDigits = String(supportPhoneRaw).replace(/[^0-9]/g, '');
    const supportPhoneIntl = supportPhoneDigits
      ? (supportPhoneDigits.length === 8
          ? ('+509' + supportPhoneDigits)
          : (supportPhoneDigits.startsWith('509') ? ('+' + supportPhoneDigits) : ('+' + supportPhoneDigits)))
      : '';
    const waDigits = supportPhoneIntl ? supportPhoneIntl.replace(/[^0-9]/g, '') : '';
    const visibleEmail = supportEmail || 'Non disponible';
    const visiblePhone = supportPhoneIntl || 'Non disponible';
    const waTargetName = useMeigensSupport ? 'Meigens Tech' : (blockedCtx.schoolName || 'Administration école');
    const mailHref = 'mailto:' + supportEmail + '?subject=' + encodeURIComponent(subject) +
                     '&body=' + encodeURIComponent('Script ID: ' + scriptId + '\nDéployeur: ' + deployerEmail + '\nRéférence: ' + ts);
    const callHref = 'tel:' + supportPhoneIntl;
    const waHref = 'https://wa.me/' + waDigits +
             '?text=' + encodeURIComponent('Bonjour ' + waTargetName + ', accès bloqué. Référence: ' + ts + ' | Script: ' + scriptId);

    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="fr"><head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + pageTitle + '</title>' +
      '<style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#07070f;color:#edeae0;' +
        'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}' +
      '.brand{font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#525268;margin-bottom:36px;text-align:center}' +
      '.card{background:#0d0d1c;border:1px solid rgba(224,80,80,.25);border-radius:16px;padding:48px 44px;max-width:520px;' +
        'width:100%;text-align:center;box-shadow:0 0 60px rgba(224,80,80,.08)}' +
      '.icon{font-size:42px;margin-bottom:20px}' +
      'h2{font-size:21px;font-weight:700;color:#e05050;margin-bottom:12px;letter-spacing:-.3px}' +
      '.msg{font-size:14px;color:#9e9eb8;line-height:1.75;margin-bottom:28px}' +
      '.divider{border:none;border-top:1px solid rgba(255,255,255,.07);margin:24px 0}' +
      '.meta{font-size:12px;color:#c7cce1;line-height:1.9;margin-bottom:28px;text-align:left;' +
        'background:#121529;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:16px 18px}' +
      '.meta b{color:#f2f5ff}' +
      '.debug{font-size:11px;color:#c8d2ff;line-height:1.55;margin-top:12px;text-align:left;background:#0f1329;border:1px solid rgba(126,155,255,.35);border-radius:8px;padding:12px}' +
      '.debug b{color:#f2f5ff}' +
      '.debug pre{margin-top:8px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,Monaco,monospace;font-size:10px;color:#b8c8ff}' +
      '.help{background:#101022;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px 16px;margin-bottom:18px;text-align:left}' +
      '.help p{font-size:13px;color:#b7b7cc;line-height:1.6;margin-bottom:8px}' +
      '.help strong{color:#f0f0ff}' +
      '.contacts{font-size:13px;color:#d8d8ef;line-height:1.8}' +
      '.contacts a{color:#f7b2b2;text-decoration:none}' +
      '.contacts a:hover{text-decoration:underline}' +
      '.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}' +
      '.cta{display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#b03030,#e05050);' +
        'color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;' +
        'letter-spacing:.3px;transition:opacity .2s}' +
      '.cta:hover{opacity:.85}' +
      '.notice{margin-top:22px;font-size:12px;color:#d5dbf5;line-height:1.7;background:#14162a;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:12px 14px}' +
      '</style></head><body>' +
      '<div class="brand">' + (blockedCtx.isPrivileged ? 'Meigens Tech · Système de Gestion Scolaire' : 'Système de Gestion Scolaire') + '</div>' +
      '<div class="card">' +
        '<div class="icon">' + pageIcon + '</div>' +
        '<h2>' + pageTitle + '</h2>' +
        '<p class="msg">' + displayMsg + '</p>' +
        '<div class="help">' +
          '<p><strong>Support immédiat:</strong> ' +
            (useMeigensSupport ? 'contactez Meigens Tech.' : 'contactez l\'administration de votre établissement.') +
          '</p>' +
          '<div class="contacts">' +
            'Email: ' + (supportEmail ? '<a href="' + mailHref + '">' + visibleEmail + '</a>' : visibleEmail) + '<br>' +
            'Téléphone: ' + (supportPhoneIntl ? '<a href="' + callHref + '">' + visiblePhone + '</a>' : visiblePhone) + '<br>' +
            'WhatsApp: ' + (waDigits ? '<a href="' + waHref + '" target="_blank">Ouvrir WhatsApp</a>' : 'Non disponible') +
          '</div>' +
          '<div class="actions">' +
            (supportPhoneIntl ? '<a class="cta" href="' + callHref + '">Appeler</a>' : '') +
            (waDigits ? '<a class="cta" href="' + waHref + '" target="_blank">WhatsApp</a>' : '') +
            (supportEmail ? '<a class="cta" href="' + mailHref + '">Email</a>' : '') +
          '</div>' +
        '</div>' +
        '<hr class="divider">' +
        '<div class="meta">' +
          (blockedCtx.isPrivileged
            ? '<b>Date d\'inscription :</b> ' + blockedCtx.registeredDate + '<br>' +
              '<b>Dernier paiement :</b> ' + blockedCtx.lastPaymentDate + '<br>' +
              '<b>Date d\'expiration :</b> ' + blockedCtx.expirationDate + '<br>' +
              '<b>Plan :</b> ' + blockedCtx.plan + '<br>' +
              '<b>Type de paiement :</b> ' + blockedCtx.paymentType + '<br>' +
              '<b>Statut du compte :</b> ' + blockedCtx.accountStatus + '<br>' +
              '<b>Référence :</b> ' + ts
            : '<b>Établissement :</b> ' + (blockedCtx.schoolName || 'Non renseigné')) +
        '</div>' +
        (showDebugPanel
          ? '<div class="debug"><b>Trace de débogage accès</b><pre>' + debugJson + '</pre></div>'
          : '') +
        '<p class="notice">' +
          (showSubscriptionReason
            ? 'Accès désactivé suite à une expiration d\'abonnement. Le renouvellement réactivera l\'application.'
            : (blockReason === 'FRAUD_ALERT'
                ? 'Blocage sécurité actif. Une alerte a été transmise automatiquement aux équipes Meigens Tech.'
                : (blockedCtx.isPrivileged
            ? 'Ces informations sont visibles uniquement pour l\'administrateur GodMode connecté. Les contrôles de sécurité et d\'audit restent exécutés en arrière-plan.'
            : 'Accès refusé.')) ) +
          '</p>' +
      '</div>' +
      '</body></html>'
    ).setTitle(pageTitle + ' — Meigens Tech');
  }
}

function htmlEncodeForDebug_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectBlockedAlertDebug_(params) {
  const p = params || {};
  const req = p.request || {};
  const reqOrgId = String(req.orgId || '').trim().toLowerCase();
  const reqSpreadsheetId = normalizeSpreadsheetId_(req.spreadsheetId || '');
  const debug = {
    timestamp: new Date().toISOString(),
    blockReason: String(p.blockReason || ''),
    errorMessage: String(p.errorMessage || ''),
    request: {
      orgId: reqOrgId || '',
      spreadsheetIdRaw: String(req.spreadsheetId || ''),
      spreadsheetIdNormalized: reqSpreadsheetId || '',
      page: String(req.page || ''),
      hasToken: !!req.token,
      tokenLength: String(req.token || '').length
    },
    runtime: {
      deployerEmail: String(p.deployerEmail || ''),
      activeEmail: String(p.activeEmail || ''),
      scriptId: String(p.scriptId || ''),
      spreadsheetId: String(p.spreadsheetId || ''),
      spreadsheetName: String(p.spreadsheetName || '')
    },
    register: {
      checked: false,
      totalRows: 0,
      matchesBySpreadsheetId: 0,
      matchesByOrgId: 0,
      matchesByScriptUrl: 0,
      sampleMatches: []
    },
    alerts: {
      transport: String((p.alertResult && p.alertResult.transport) || ''),
      success: !!(p.alertResult && p.alertResult.success),
      sheetLogged: !!(p.alertResult && p.alertResult.sheetLogged)
    }
  };

  try {
    const activeSs = SpreadsheetApp.getActiveSpreadsheet();
    const activeSsNorm = normalizeSpreadsheetId_(activeSs ? activeSs.getId() : '');
    debug.runtime.activeSpreadsheetNormalized = activeSsNorm;

    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg = master.getSheetByName('Register');
    if (!reg) {
      debug.register.error = 'Register sheet introuvable';
      return debug;
    }

    const data = reg.getDataRange().getValues();
    if (!data || data.length < 2) {
      debug.register.error = 'Register vide';
      debug.register.checked = true;
      return debug;
    }

    const h = data[0].map(x => String(x || '').trim().toUpperCase());
    const iSsId = h.indexOf('USER_SPREADSHEET_ID');
    const iOrgId = h.indexOf('ID');
    const iBiz = h.indexOf('BUSINESS_NAME');
    const iEmail = h.indexOf('EMAIL');
    const iPhone = h.indexOf('PHONE');
    const iActive = h.indexOf('IS_ACTIVE');
    const iPlan = h.indexOf('SUBSCRIPTION_PLAN');
    const iExp = h.indexOf('EXPIRATION_DATE');
    const iStaffUrl = h.indexOf('STAFF_APP_URL');
    const iStudentUrl = h.indexOf('STUDENT_PORTAL_URL');
    const currentScriptId = String((debug.runtime && debug.runtime.scriptId) || '').trim();

    debug.register.checked = true;
    debug.register.totalRows = Math.max(0, data.length - 1);
    debug.register.headerIndexes = {
      iSsId: iSsId,
      iOrgId: iOrgId,
      iBiz: iBiz,
      iActive: iActive,
      iPlan: iPlan,
      iExp: iExp,
      iStaffUrl: iStaffUrl,
      iStudentUrl: iStudentUrl
    };

    const samples = [];
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const rowSsIdRaw = iSsId !== -1 ? String(row[iSsId] || '') : '';
      const rowSsId = normalizeSpreadsheetId_(rowSsIdRaw);
      const rowOrgId = iOrgId !== -1 ? String(row[iOrgId] || '').trim().toLowerCase() : '';
      const rowStaffUrl = iStaffUrl !== -1 ? String(row[iStaffUrl] || '') : '';
      const rowStudentUrl = iStudentUrl !== -1 ? String(row[iStudentUrl] || '') : '';
      const ssMatched = !!rowSsId && (rowSsId === reqSpreadsheetId || rowSsId === activeSsNorm);
      const orgMatched = !!reqOrgId && !!rowOrgId && rowOrgId === reqOrgId;
      const scriptMatched = !!currentScriptId && (rowStaffUrl.indexOf(currentScriptId) !== -1 || rowStudentUrl.indexOf(currentScriptId) !== -1);

      if (ssMatched) debug.register.matchesBySpreadsheetId++;
      if (orgMatched) debug.register.matchesByOrgId++;
      if (scriptMatched) debug.register.matchesByScriptUrl++;

      if (ssMatched || orgMatched || scriptMatched) {
        samples.push({
          rowNumber: r + 1,
          id: iOrgId !== -1 ? String(row[iOrgId] || '').trim() : '',
          businessName: iBiz !== -1 ? String(row[iBiz] || '').trim() : '',
          email: iEmail !== -1 ? String(row[iEmail] || '').trim() : '',
          phone: iPhone !== -1 ? String(row[iPhone] || '').trim() : '',
          isActive: iActive !== -1 ? String(row[iActive] || '').trim() : '',
          plan: iPlan !== -1 ? String(row[iPlan] || '').trim() : '',
          expiration: iExp !== -1 ? String(row[iExp] || '').trim() : '',
          rowSpreadsheetIdRaw: rowSsIdRaw,
          rowSpreadsheetIdNormalized: rowSsId,
          rowStaffUrl: rowStaffUrl,
          rowStudentUrl: rowStudentUrl,
          matchBySpreadsheetId: ssMatched,
          matchByOrgId: orgMatched,
          matchByScriptUrl: scriptMatched
        });
      }
    }

    debug.register.sampleMatches = samples.slice(0, 12);
  } catch (err) {
    debug.register.error = String((err && err.message) || err || 'UNKNOWN');
  }

  return debug;
}

function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }
function getScriptUrl() { return ScriptApp.getService().getUrl(); }
function getLatestUI(e) { return doGet(e); }

function writeSecurityAlert_(payload) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_AUTH_ID);
    let sh = ss.getSheetByName('security_alerts');
    if (!sh) {
      sh = ss.insertSheet('security_alerts');
      sh.appendRow([
        'Timestamp','AlertType','Severity','Transport','EmailSent','Recipients',
        'DeployerEmail','ActiveEmail','ScriptID','ScriptURL','SpreadsheetID',
        'SpreadsheetName','ErrorMessage','DeliveryError','MetaJSON'
      ]);
      sh.setFrozenRows(1);
    }

    const data = payload || {};
    sh.appendRow([
      data.timestamp || new Date(),
      data.alertType || 'SYSTEM_ALERT',
      data.severity || 'MEDIUM',
      data.transport || 'NONE',
      data.emailSent ? 'TRUE' : 'FALSE',
      Array.isArray(data.recipients) ? data.recipients.join(', ') : String(data.recipients || ''),
      data.deployerEmail || '',
      data.activeEmail || '',
      data.scriptId || '',
      data.scriptUrl || '',
      data.spreadsheetId || '',
      data.spreadsheetName || '',
      data.errorMessage || '',
      data.deliveryError || '',
      JSON.stringify(data.meta || {})
    ]);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function writeMasterAuthAuditLog_(action, target, details, permUsed, isError) {
  try {
    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    let sh = master.getSheetByName('auditlog');
    if (!sh) {
      sh = master.insertSheet('auditlog');
      sh.appendRow(['Timestamp','Json']);
      sh.setFrozenRows(1);
    }
    // PERF FIX: _normalizeAuditSheetToCompact_ removed from hot path.
    // It performed a full sheet read + potential rewrite on every call.
    // Run it manually from the admin setup/init function if migration is needed.
    const ts = new Date();
    const actor = _resolveSessionEmailSafe_('System');
    const status = isError ? 'ECHEC' : 'OK';
    let detObj = details;
    if (typeof detObj !== 'object' || detObj === null) detObj = { value: String(details || '') };
    let jsonStr = '';
    try {
      jsonStr = JSON.stringify({
        action: String(action || 'UNKNOWN_ACTION'),
        target: String(target || 'SYSTEM'),
        actor: actor,
        permission: String(permUsed || ''),
        status: status,
        isError: !!isError,
        details: detObj
      });
    } catch (_e) {
      jsonStr = String(details || '');
    }
    if (jsonStr.length > 45000) jsonStr = jsonStr.slice(0, 45000) + '...[truncated]';
    _appendRowSafe_(sh, [ts, jsonStr], 3);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function sendFraudAlert_(payload) {
  const data = payload || {};
  const ts = data.ts || new Date().toISOString();
  const deployerEmail = String(data.deployerEmail || '').trim();
  const activeEmail = String(data.activeEmail || '').trim();
  const scriptId = String(data.scriptId || '').trim();
  const scriptUrl = String(data.scriptUrl || '').trim();
  const spreadsheetId = String(data.spreadsheetId || '').trim();
  const spreadsheetName = String(data.spreadsheetName || '').trim();
  const errorMessage = String(data.errorMessage || 'Erreur inconnue').trim();
  const isFraudSignal = !!data.isFraudSignal;
  const primaryRecipient = 'meigenstech@gmail.com';
  const ccRecipients = [];
  if (deployerEmail && deployerEmail.toLowerCase() !== primaryRecipient) ccRecipients.push(deployerEmail);

  const subject = isFraudSignal
    ? '[ALERTE FRAUDE] Tentative d\'acces non autorise - ' + ts
    : '[ALERTE doGet] ' + errorMessage.slice(0, 80) + ' - ' + ts;

  const body =
    'Bonjour equipe Meigens Tech,\n\n' +
    (isFraudSignal
      ? 'Une tentative d\'acces a ete detectee sur un systeme non certifie ou suspendu.\n' +
        'Ceci peut indiquer une tentative de fraude ou une utilisation non autorisee du logiciel.\n\n'
      : 'Une erreur s\'est produite lors du chargement de l\'application.\n\n') +
    'INFORMATIONS FORENSIQUES\n' +
    'Date / Heure       : ' + ts + '\n' +
    'Erreur             : ' + errorMessage + '\n' +
    'Deployeur (owner)  : ' + (deployerEmail || 'inconnu') + '\n' +
    'Utilisateur actif  : ' + (activeEmail || 'inconnu') + '\n' +
    'Script ID          : ' + (scriptId || 'inconnu') + '\n' +
    'Script URL         : ' + (scriptUrl || 'inconnu') + '\n' +
    'Spreadsheet ID     : ' + (spreadsheetId || 'inconnu') + '\n' +
    'Spreadsheet Name   : ' + (spreadsheetName || 'inconnu') + '\n\n' +
    (isFraudSignal ? 'Action recommandee : verifier si ce tableau est une copie pirate et revoquer l\'acces.\n\n' : '') +
    'Ce message a ete envoye automatiquement par le systeme de surveillance Meigens Tech.';

  const mailPayload = {
    to: primaryRecipient,
    subject: subject,
    body: body
  };
  if (ccRecipients.length) mailPayload.cc = ccRecipients.join(',');

  const result = {
    success: false,
    transport: '',
    recipients: [primaryRecipient].concat(ccRecipients),
    error: '',
    sheetLogged: false,
    sheetError: ''
  };

  try {
    MailApp.sendEmail(mailPayload);
    result.success = true;
    result.transport = 'MailApp';
  } catch (mailErr) {
    result.error = 'MailApp: ' + mailErr.message;
    try {
      GmailApp.sendEmail(mailPayload.to, mailPayload.subject, mailPayload.body, ccRecipients.length ? { cc: mailPayload.cc } : {});
      result.success = true;
      result.transport = 'GmailApp';
      result.error = '';
    } catch (gmailErr) {
      result.error += ' | GmailApp: ' + gmailErr.message;
    }
  }

  writeMasterAuthAuditLog_(
    isFraudSignal ? 'FRAUD_ALERT_EMAIL' : 'ERROR_ALERT_EMAIL',
    spreadsheetId || scriptId || 'UNKNOWN_TARGET',
    {
      sent: result.success,
      transport: result.transport || 'NONE',
      recipients: result.recipients,
      deployerEmail: deployerEmail || '',
      activeEmail: activeEmail || '',
      scriptId: scriptId || '',
      scriptUrl: scriptUrl || '',
      spreadsheetName: spreadsheetName || '',
      errorMessage: errorMessage,
      deliveryError: result.error || ''
    },
    'SYSTEM_ALERT',
    !result.success
  );

  const sheetWrite = writeSecurityAlert_({
    timestamp: new Date(ts),
    alertType: isFraudSignal ? 'FRAUD_ALERT' : 'ERROR_ALERT',
    severity: isFraudSignal ? 'CRITICAL' : 'HIGH',
    transport: result.transport || 'NONE',
    emailSent: result.success,
    recipients: result.recipients,
    deployerEmail: deployerEmail,
    activeEmail: activeEmail,
    scriptId: scriptId,
    scriptUrl: scriptUrl,
    spreadsheetId: spreadsheetId,
    spreadsheetName: spreadsheetName,
    errorMessage: errorMessage,
    deliveryError: result.error || '',
    meta: {
      subject: subject,
      isFraudSignal: isFraudSignal
    }
  });
  result.sheetLogged = !!(sheetWrite && sheetWrite.success);
  result.sheetError = sheetWrite && sheetWrite.success ? '' : String((sheetWrite && sheetWrite.error) || 'UNKNOWN_SHEET_WRITE_ERROR');

  return result;
}

function normalizeApiHubRequest_(action, data, auth) {
  let nextAction = action;
  let nextData   = data;
  let nextAuth   = auth;

  // Support object-style calls: apiHub({ action, data, auth })
  if (nextAction && typeof nextAction === 'object') {
    const payload = nextAction;
    nextAction = payload.action || payload.funcName || payload.name || '';
    if (nextData === undefined) {
      if (payload.data !== undefined) nextData = payload.data;
      else if (payload.params !== undefined) nextData = payload.params;
      else if (payload.body !== undefined) nextData = payload.body;
      else nextData = {};
    }
    if (nextAuth === undefined) nextAuth = payload.auth !== undefined ? payload.auth : payload.token;
  }

  // Support mixed calls where action lives in data
  if ((!nextAction || String(nextAction).trim() === '') && nextData && typeof nextData === 'object') {
    nextAction = nextData.action || nextData.funcName || nextData.name || '';
  }

  if (nextData === undefined || nextData === null) nextData = {};

  // Flatten common frontend wrappers
  if (nextData && typeof nextData === 'object') {
    if (nextData.params && typeof nextData.params === 'object') {
      nextData = Object.assign({}, nextData, nextData.params);
    }
    if (nextData.body && typeof nextData.body === 'object') {
      nextData = Object.assign({}, nextData, nextData.body);
    }
  }

  if (typeof nextAuth === 'string') nextAuth = { token: nextAuth };
  if ((!nextAuth || typeof nextAuth !== 'object') && nextData && typeof nextData === 'object' && nextData.token) {
    nextAuth = { token: String(nextData.token) };
  }

  const aliases = {
    saveConfig: 'updateLocalSettings',
    attemptSheetLogin_: 'attemptSheetLogin',
    forcePasswordUpdate_: 'forcePasswordUpdate',
    getDashboardStats: 'getDashboardLiveStats',
    getStudents: 'getAllStudents',
    getGrades: 'getGrades',
    createStudent: 'addNewStudent',
    editStudent: 'updateStudent',
    updateStudentIdentity: 'updateStudent',
    RECORD_PAYMENT: 'recordNewPayment',
    RECORD_GRADE: 'saveManualExamGrade',
    GENERATE_REPORT: 'generateFullStudentReport',
    MARK_ATTENDANCE: 'recordBulkAttendance',
    getAuditLog: 'getAuditLogs',
    getFinanceReport: 'getComplexReportData',
    getStudentReport: 'generateFullStudentReport',
    // Fix: Map underscore-suffixed names to canonical names
    lookupStudentGlobal_: 'lookupStudentGlobal',
    checkCacheHealth_: 'checkCacheHealth',
    clearAllSchoolCaches_: 'clearAllSchoolCaches',
    checkAndUpdateAccountStatus_: 'checkAndUpdateAccountStatus',
    chatbotSmart: 'processUserMessage',
    assistantChat: 'processUserMessage',
    aiChat: 'processUserMessage',
    chatWithAI: 'processUserMessage',
    // ── Fix 1b: orphan action aliases ────────────────────────────────────
    getConfig:        'getSaaSSettings',
    getClasses:       'getSubjectsByLevel',
    getEnrollments:   'getAllStudents',
    PROMOTE_STUDENT:  'processPromotionDecision',
    SEND_MESSAGE:     'sendInternalMessage',
    BROADCAST_MESSAGE:'publishAnnouncement',
    deactivateUser:   'toggleUserActiveState',
    getUsers:         'getAllAdminUsers',
    listUsers:        'getAllAdminUsers'
  };

  const canonicalAction = aliases[nextAction] || nextAction;

  // Fix 5: Normalize academic year field name to canonical 'academicYear' throughout
  if (nextData && typeof nextData === 'object') {
    if (nextData.schoolYear !== undefined && nextData.academicYear === undefined) {
      nextData = Object.assign({}, nextData, { academicYear: nextData.schoolYear });
    }
    if (nextData.academic_year !== undefined && nextData.academicYear === undefined) {
      nextData = Object.assign({}, nextData, { academicYear: nextData.academic_year });
    }
  }

  return {
    action: canonicalAction,
    data: nextData,
    auth: nextAuth || {}
  };
}

function normalizeApiHubResponse_(action, result) {
  const meta = { action: action, timestamp: new Date().toISOString() };

  if (result === undefined) return { success: true, data: null, meta: meta };
  if (result === null) return { success: true, data: null, meta: meta };

  if (Array.isArray(result)) {
    return { success: true, data: result, count: result.length, meta: meta };
  }

  if (typeof result === 'object') {
    if (Object.prototype.hasOwnProperty.call(result, 'success')) {
      const out = Object.assign({}, result);
      if (!Object.prototype.hasOwnProperty.call(out, 'meta')) out.meta = meta;
      if (out.success && !Object.prototype.hasOwnProperty.call(out, 'data')) {
        if (Object.prototype.hasOwnProperty.call(out, 'rows')) out.data = out.rows;
        else if (Object.prototype.hasOwnProperty.call(out, 'result')) out.data = out.result;
      }
      return out;
    }
    return { success: true, data: result, meta: meta };
  }

  return { success: true, data: result, meta: meta };
}

function _isCriticalReadAction_(action) {
  const key = String(action || '').trim();
  if (!key) return false;
  const criticalReads = {
    getViewerInfo: true,
    getInternalNotes: true,
    getStudentInternalNotes: true,
    getStudent: true,
    getAllStudents: true,
    searchStudents: true,
    getStudentHistory: true,
    getStudentPayments: true,
    getPayments: true,
    getAttendance: true,
    getAttendanceByDate: true,
    getStudentAttendance: true,
    getStudentScores: true,
    getStudentBulletinData: true,
    getStudentFinanceProfile: true,
    getComplexReportData: true,
    getUniversalAnalytics: true,
    getGlobalAuditDashboard: true,
    getAuditLogs: true,
    getStaffAttendance: true,
    getStaffList: true,
    getAllAdminUsers: true,
    getUnifiedDirectory: true
  };
  return !!criticalReads[key];
}

function _isAuthAction_(action) {
  const key = String(action || '').trim();
  if (!key) return false;
  const authActions = {
    attemptSheetLogin: true,
    loginWithIdAndPin: true,
    setupStaffPin: true,
    forcePasswordUpdate: true,
    getViewerInfo: true,
    studentPortalLogin: true,
    parentPortalLogin: true,
    sendEmailVerification: true,
    verifyEmailOTP: true,
    setupInitialPin: true
  };
  return !!authActions[key];
}

function _isInterfaceInitReadAction_(action) {
  const key = String(action || '').trim();
  if (!key) return false;
  const initReads = {
    getViewerInfo: true,
    getSaaSSettings: true,
    getSettings: true,
    getDashboardLiveStats: true,
    getAllStudents: true,
    getAttendance: true,
    getPayments: true,
    getStaffList: true,
    getAllAdminUsers: true,
    getStaffAttendance: true,
    getUnifiedDirectory: true
  };
  return !!initReads[key];
}

function _isWriteAction_(action) {
  const key = String(action || '').trim();
  if (!key) return false;
  const lower = key.toLowerCase();
  return (
    lower.startsWith('add') ||
    lower.startsWith('update') ||
    lower.startsWith('save') ||
    lower.startsWith('record') ||
    lower.startsWith('process') ||
    lower.startsWith('toggle') ||
    lower.startsWith('remove') ||
    lower.startsWith('delete') ||
    lower.startsWith('drop') ||
    lower.startsWith('reenroll') ||
    lower.startsWith('enroll') ||
    lower.startsWith('create') ||
    lower.startsWith('clear') ||
    lower.startsWith('publish') ||
    lower.startsWith('send') ||
    lower.startsWith('approve') ||
    lower.startsWith('handle') ||
    lower.startsWith('rollover') ||
    lower.startsWith('setup') ||
    lower.startsWith('force') ||
    lower.startsWith('upload')
  );
}

function _auditPermLabel_(permSpec) {
  if (Array.isArray(permSpec)) return permSpec.filter(Boolean).join('|');
  return String(permSpec || '');
}

function _auditTargetFromPayload_(action, data, result) {
  const pick = function(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const keys = [
      'studentId','StudentID','id','studentCode','StudentCode','email','target',
      'historyId','receiptId','userId','classId','schoolId','orgId','thread'
    ];
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  };
  const fromData = pick(data);
  if (fromData) return fromData;
  const fromResult = pick(result);
  if (fromResult) return fromResult;
  return String(action || 'SYSTEM');
}

function _auditDebugTraceId_() {
  return 'DBG-' + Utilities.getUuid().substring(0, 8).toUpperCase();
}

function _isSensitiveAuditKey_(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    k.indexOf('password') !== -1 ||
    k === 'pass' ||
    k === 'pin' ||
    k.indexOf('token') !== -1 ||
    k.indexOf('secret') !== -1 ||
    k.indexOf('apikey') !== -1 ||
    k.indexOf('authorization') !== -1
  );
}

function _auditSanitizeValue_(value, depth) {
  const d = Number(depth || 0);
  if (d > 4) return '[max-depth]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(function(v) { return _auditSanitizeValue_(v, d + 1); });
  if (t === 'object') {
    const out = {};
    Object.keys(value).forEach(function(k) {
      if (_isSensitiveAuditKey_(k)) out[k] = '[redacted]';
      else out[k] = _auditSanitizeValue_(value[k], d + 1);
    });
    return out;
  }
  return String(value);
}

function _buildAuditDebugContext_(action, data, result, permSpec, failed, traceId, errObj) {
  const now = new Date();
  let orgId = 'UNKNOWN_ORG';
  try { orgId = String(getOrgId_() || 'UNKNOWN_ORG').trim() || 'UNKNOWN_ORG'; } catch (_e) {}

  const responseObj = (result && typeof result === 'object') ? result : { value: result };
  const debug = {
    traceId: traceId,
    serverTs: now.toISOString(),
    orgId: orgId,
    action: String(action || ''),
    permission: _auditPermLabel_(permSpec || (_isAuthAction_(action) ? 'AUTH' : '')),
    failed: !!failed,
    request: _auditSanitizeValue_(data, 0),
    response: _auditSanitizeValue_({
      success: responseObj.success,
      error: responseObj.error || '',
      message: responseObj.message || ''
    }, 0)
  };

  if (errObj) {
    debug.error = {
      message: String((errObj && errObj.message) || errObj || ''),
      stack: String((errObj && errObj.stack) || '').slice(0, 1800)
    };
  }
  return debug;
}

function _auditApiHubAction_(action, data, result, permSpec) {
  try {
    // UI bootstrap/read hydration should not create audit noise.
    if (_isInterfaceInitReadAction_(action)) return;

    const shouldAudit = _isWriteAction_(action) || _isCriticalReadAction_(action) || _isAuthAction_(action);
    if (!shouldAudit) return;

    const failed = !!(result && typeof result === 'object' && result.success === false);
    const traceId = _auditDebugTraceId_();
    const debug = _buildAuditDebugContext_(action, data, result, permSpec, failed, traceId, failed ? (result && (result.error || result.message || 'Operation failed')) : null);
    const details = _isWriteAction_(action)
      ? {
          traceId: traceId,
          request: (data && typeof data === 'object') ? _auditSanitizeValue_(data, 0) : { value: data },
          response: (result && typeof result === 'object')
            ? { success: result.success, error: result.error || '', message: result.message || '' }
            : { value: result },
          debug: debug
        }
      : (_isAuthAction_(action)
        ? {
            traceId: traceId,
            authFlow: true,
            request: (data && typeof data === 'object') ? _auditSanitizeValue_(data, 0) : { value: data },
            response: (result && typeof result === 'object')
              ? { success: result.success, error: result.error || '', message: result.message || '' }
              : { value: result },
            debug: debug
          }
        : {
            traceId: traceId,
            criticalRead: true,
            query: (data && typeof data === 'object') ? _auditSanitizeValue_(data, 0) : { value: data },
            debug: debug
          });

    writeAuditLog(
      String(action || '').toUpperCase(),
      _auditTargetFromPayload_(action, data, result),
      details,
      _auditPermLabel_(permSpec || (_isAuthAction_(action) ? 'AUTH' : '')),
      failed
    );
  } catch (_auditErr) {}
}

// ============================================================
// EDUHAÏTI — APIHUB COMPLET + TOUS LES PATCHES INTÉGRÉS
// Remplacez la fonction apiHub() existante dans Code.gs
// par cette version complète.
// ============================================================

function apiHub(action, data, auth) {
  try {
    const normalized = normalizeApiHubRequest_(action, data, auth);
    action = normalized.action;
    data   = normalized.data;
    auth   = normalized.auth;

    // Lazy one-time-per-execution sheet bootstrap (idempotent).
    try { _ensureCoreInitSheets_(); } catch(_){}

    const respond = function(result) { return normalizeApiHubResponse_(action, result); };
    const respondAndAudit = function(result, permSpec) {
      _auditApiHubAction_(action, data, result, permSpec);
      return respond(result);
    };

    // ── SECURITY: block direct audit writes from client ────────────────────
    if (action === 'logAudit' || action === 'writeAuditLog' || action === 'writeAuditLog_') {
      return respond({ success: false, error: 'Audit write is backend-managed only.' });
    }

    // ── PUBLIC ROUTES (no token required) ─────────────────────────────────
    // Dans apiHub, après if (action === 'ping') :
if (action === 'getDownloadPageData')
  return respond(getDownloadPageData_());
    if (action === 'ping')
      return respond({ success: true, status: 'online', timestamp: new Date().toISOString() });

    if (action === 'attemptSheetLogin')
      return respondAndAudit(attemptSheetLogin_(
        (data.identifier || data.email || data.userId || data.username), data.password
      ), 'AUTH');

    if (action === 'loginWithIdAndPin')
      return respondAndAudit(loginWithIdAndPin_(data.userId, data.pin), 'AUTH');

    if (action === 'setupStaffPin')
      return respondAndAudit(setupStaffPin_(data, auth), 'AUTH');

    if (action === 'getSaaSSettings' || action === 'getSettings')
      return respond(getSaaSSettings_(auth, data && data.targetYear));

    if (action === 'getAiConfigurationAssistanceContext')
      return respond(getAiConfigurationAssistanceContext_(
        data && data.levelKeys,
        (getSaaSSettings_() || {}).data || {}
      ));

    if (action === 'sendEmailVerification')
      return respondAndAudit(sendEmailVerification_(auth), 'AUTH');

    if (action === 'verifyEmailOTP')
      return respondAndAudit(verifyEmailOTP_(data.otp, auth), 'AUTH');

    if (action === 'forcePasswordUpdate')
      return respondAndAudit(forcePasswordUpdate_(
        (data.identifier || data.email || data.userId || data.username),
        data.oldPass, data.newPass, auth
      ), 'AUTH');

    if (action === 'getViewerInfo')
      return respondAndAudit(getViewerInfo_(auth || data), 'AUTH');

    if (action === 'studentPortalLogin')
      return respondAndAudit(studentPortalLogin_(data), 'AUTH');

    if (action === 'parentPortalLogin')
      return respondAndAudit(parentPortalLogin_(data), 'AUTH');

    if (action === 'verifyStudentByLast4')
      return respond(verifyStudentByLast4_(data.query || data));

    if (action === 'lookupStudentGlobal')
      return respond(lookupStudentGlobal_(typeof data === 'string' ? data : (data && data.id ? data.id : data)));

    if (action === 'setupInitialPin')
      return respondAndAudit(setupInitialPin_(data.fullId || data.id, data.newPin || data.pin), 'AUTH');

    if (action === 'checkAndInitSheets')
      return respond(checkAndInitSheets());

    if (action === 'warmSchoolCaches')
      return respond(warmSchoolCachesOnInit_(auth || {}, data || {}));

    if (action === 'checkCacheHealth')
      return respond(checkCacheHealth_());

    if (action === 'clearAllSchoolCaches')
      return respond(clearAllSchoolCaches_());

    if (action === 'updateSaaSSettings' || action === 'updateLocalSettings')
      return respond(updateSaaSSettings_(data, auth));

    if (action === 'saveAiApiKeys')
      return respondAndAudit(saveAiApiKeys_(data, auth), 'CONFIG');

    if (action === 'purgeExpiredTokens') {
      const _v = getViewerInfo_(auth);
      if (!_v || !_v.success) return respond({ success: false, error: 'Session invalide.' });
      const _isAdm = _v.isMaster || _v.isGodMode || (_v.permissions && (_v.permissions.pa_save_settings || _v.permissions.p_settings));
      if (!_isAdm) return respond({ success: false, error: 'Droits insuffisants.' });
      return respond(purgeExpiredSessionTokens_());
    }

    // ── SHEET INIT (throttled) ─────────────────────────────────────────────
    if (typeof ensureInfraReadyThrottled_ === 'function') {
      ensureInfraReadyThrottled_();
    } else if (typeof checkAndInitSheets === 'function') {
      checkAndInitSheets();
    }

    // ── AUTH CHECK ─────────────────────────────────────────────────────────
    const viewer = getViewerInfo_(auth);
    if (!viewer.success)
      return respond({ success: false, error: 'Session expiree ou token invalide.', code: viewer.error });

    // ── PERMISSION POLICY ──────────────────────────────────────────────────
    const policy = {
      'getViewerInfo':                   '',
      'getSaaSSettings':                 '',
      'getSettings':                     '',
      'updateSaaSSettings':              'pa_save_settings',
      'updateLocalSettings':             'pa_save_settings',
      'saveAiApiKeys':                   'pa_save_settings',
      'uploadLogoToDriveSecure':         'pa_save_settings',
      'clearMeigensConfiguration':       'pa_save_settings',
      'saveUserTheme':                   '',
      'getTimetableData':                ['p_staff','pa_teacher_affectation','p_settings'],
      'saveTimetableData':               'pa_teacher_affectation',
      'updateMyProfilePhoto':            '',
      'getSubjectsByLevel':              '',
      'saveChunkedCurriculum':           'pa_save_settings',
      'getAllAdminUsers':                 ['p_staff','pa_manage_users','pa_add_staff'],
      'getStaffList':                    ['p_staff','pa_manage_users','pa_add_staff','pa_teacher_affectation'],
      'saveStaffAccess':                 'pa_manage_users',
      'updateUserRoleAndPerms':          'pa_manage_users',
      'getStaffManagementData':          ['p_staff','pa_manage_users','pa_add_staff'],
      'toggleUserActiveState':           'pa_manage_users',
      'removeUserAccess':                'pa_manage_users',
      'toggleGodMode':                   'pa_manage_users',
      'getStaffAttendance':              'p_hr_attendance',
      'clockInStaff':                    'p_hr_attendance',
      'getAllStudents':                   ['p_dossier','pa_add_student','pa_edit_student','pt_view_class_list','pt_view_student_profile'],
      'getStudent':                      ['p_dossier','pa_edit_student','pt_view_student_profile'],
      'addNewStudent':                   'pa_add_student',
      'updateStudent':                   'pa_edit_student',
      'lookupStudentGlobal':             ['p_dossier','pa_add_student','pa_edit_student','pt_view_class_list','pt_view_student_profile'],
      'searchStudents':                  ['p_dossier','pa_add_student','pa_edit_student','pt_view_class_list','pt_view_student_profile'],
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
      'approveOnlinePayment':            'p_approve_payments',
      'recordNewPayment':                'pa_record_payment',
      'getStudentFinanceProfile':        ['p_finance','pa_record_payment'],
      'getStudentFinanceSummary':         ['p_finance','pa_record_payment'],
      'processPayrollBatch':             'p_finance',
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
      'getGrades':                       'p_grades',
      'getStudentScores':                'p_grades',
      'saveManualExamGrade':             'p_manual',
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
      'getAiChatConversation':           'p_use_ai',
      'resetAiChatConversation':         'p_use_ai',
      'resetAiTokenSession':             'p_use_ai',
      'getAiChatLibraryStatus':          'p_use_ai',
      'translateMeigensText':            '',
      'getPromotionDecision':            ['p_audit','pa_promote_student'],
      'processPromotionDecision':        'pa_promote_student',
      'getGlobalAuditDashboard':         ['p_audit','p_settings','pa_save_settings'],
      'getAuditLogs':                    ['p_audit','p_settings','pa_save_settings'],
      'getAuditDiagnostics':             [],
      // ── Exam Builder / Runner / Grading ───────────────────────────────────
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
      // ── Media Library ─────────────────────────────────────────────────────
      'listMedia':                       [],
      'saveMedia':                       ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      'deleteMedia':                     ['pt_build_exam','p_manual','pa_save_settings'],
      'uploadMediaFile':                 ['pt_build_exam','p_manual','p_build','pa_save_settings'],
      // ── Homework ──────────────────────────────────────────────────────────
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
      'sendSMSBulk':                     'pa_send_broadcast',
      'testSMSConnection':               'pa_save_settings',
      'checkAndInitSheets':              '',
      'warmSchoolCaches':                '',
      'generateReportDownloadUrl':       ['pa_generate_report','pt_export_data'],
      'getStaffAssignments':             ['p_staff','pa_teacher_affectation'],
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
      'updateStudentPortalUrl':          ['p_settings','pa_save_settings'],
      'createSaaSBackup':                'pa_save_settings',
      'runGlobalBackupTask':             'pa_save_settings',
      'checkAndUpdateAccountStatus':     'pa_save_settings',
      'initAiConfigurationLibrary':      'pa_save_settings',
      'initAiMasterSheets':              'pa_save_settings',
      'ensureAiConfigurationLibrarySheets': 'pa_save_settings',
      'forceInitAiMasterSheets':         'pa_save_settings',
      'getAiChatConversation':          'p_use_ai',
      'getAiChatConversationList':      'p_use_ai',
      'resetAiChatConversation':        'p_use_ai',
      'resetAiTokenSession':            'p_use_ai',
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
      'sendWhatsApp':                    'pa_send_broadcast',
      'getSystemAlerts':                 '',
      'getNotifications':                '',
      'markNotificationRead':            '',
      'markAllNotificationsRead':        '',
      'confirmTeacherAlertStatus':       ['p_attendance','p_staff'],
      'saveKioskWatchCodes':             ['p_attendance','p_settings'],
      'getKioskWatchCodes':              ['p_attendance','p_settings'],
      'DROP_STUDENT':                    'pa_edit_student',
      // ── PATCH: Bulletin authenticity verification ─────────────────────
      'registerBulletinIssue':           [], // any authenticated viewer that can open a bulletin
      'verifyBulletin':                  [], // any authenticated viewer (public-ish lookup)
      // ── PATCH: Sheet bootstrap ─────────────────────────────────────────
      'initSheets':                      [], // safe to call by anyone — idempotent
    };

    if (!(action in policy))
      return respond({ success: false, error: 'Action non reconnue: ' + action });

    if (!viewer.isMaster && !viewer.isGodMode) {
      const perm = policy[action];
      const perms = viewer.permissions || {};
      const requiredPerms = Array.isArray(perm) ? perm.filter(Boolean) : (perm ? [perm] : []);
      if (requiredPerms.length && !requiredPerms.some(k => !!perms[k]))
        return respond({ success: false, error: 'Permission [' + requiredPerms.join(' | ').toUpperCase() + '] manquante.' });
    }

    // ── ACTION SWITCH ──────────────────────────────────────────────────────
    let result;
    switch (action) {

      // ── SETTINGS & IDENTITY ───────────────────────────────────────────────
      case 'getViewerInfo':             result = viewer; break;
      case 'getSaaSSettings':
      case 'getSettings':               result = getSaaSSettings_(auth); break;
      case 'updateSaaSSettings':
      case 'updateLocalSettings':       result = updateSaaSSettings_(data, auth); break;
      case 'getSettingsHealth':         result = getSaaSSettingsHealth_({ cleanup:false }); break;
      case 'cleanupSettingsDuplicates': result = getSaaSSettingsHealth_({ cleanup:true }); break;
      case 'updateStudentPortalUrl':    result = updateStudentPortalUrlInRegister_(data, auth); break;
      case 'uploadLogoToDriveSecure':   result = uploadLogoToDriveSecure_(data, auth); break;
      case 'saveUserTheme':             result = saveUserTheme_(data); break;

      // ── PATCH: updateMyProfilePhoto avec flush + cache invalidation ───────
      case 'updateMyProfilePhoto':      result = updateMyProfilePhoto_PATCHED_(data, auth); break;

      case 'clearMeigensConfiguration': result = clearMeigensConfiguration_(); break;
      case 'getTimetableData':          result = getTimetableData_(); break;
      case 'saveTimetableData':         result = saveTimetableData_(data); break;
      case 'getSubjectsByLevel':        result = getSubjectsByLevel_(data && data.level ? data.level : data); break;
      case 'saveChunkedCurriculum':     result = saveChunkedCurriculum_(data, auth); break;

      // ── STAFF / USERS ─────────────────────────────────────────────────────
      case 'getAllAdminUsers':          result = getAllAdminUsers_(auth); break;
      case 'getStaffList':              result = getStaffList_(); break;
      case 'saveStaffAccess':           result = saveStaffAccess_(data); break;
      case 'updateUserRoleAndPerms':    result = updateUserRoleAndPerms_(data); break;
      case 'getStaffManagementData':    result = getStaffManagementData_(auth); break;
      case 'toggleUserActiveState':     result = toggleUserActiveState_(data.email, data.status); break;
      case 'removeUserAccess':          result = removeUserAccess_(typeof data === 'string' ? data : data.email); break;
      case 'toggleGodMode':             result = toggleGodMode_(data, auth); break;
      case 'getStaffAttendance':        result = getStaffAttendance_(data); break;
      case 'clockInStaff':              result = clockInStaff_(data); break;

      // ── STUDENTS ──────────────────────────────────────────────────────────
      case 'getAllStudents':            result = getAllStudents_(auth); break;
      case 'getStudent':               result = getStudentById_(data, auth); break;
      case 'addNewStudent':             result = addNewStudent_(data); break;
      case 'updateStudent':             result = updateStudent_(data, auth); break;
      case 'lookupStudentGlobal':       result = lookupStudentGlobal_(typeof data === 'string' ? data : data.id || data, auth); break;
      case 'searchStudents':            result = searchStudents_(data, auth); break;
      case 'getStudentFieldsConfig':    result = getStudentFieldsConfig_(); break;

      // ── PATCH: getStudentHistory avec fallback auto-généré ────────────────
      case 'getStudentHistory':         result = getStudentHistory_PATCHED_(data, auth); break;

      case 'getAvailableAcademicYears': result = getAvailableAcademicYears_(); break;
      case 'saveMedicalRecord':         result = saveMedicalRecord_(data, auth); break;
      case 'saveDocumentSignature':     result = saveDocumentSignature_(data, auth); break;
      case 'addInternalNote':           result = addInternalNote_(data, auth); break;
      case 'getInternalNotes':          result = getInternalNotes_(data, auth); break;

      // ── FINANCE ───────────────────────────────────────────────────────────
      case 'getStudentPayments':
      case 'getPayments':               result = getStudentPayments_(data, auth); break;
      case 'approveOnlinePayment':      result = approveOnlinePayment_(data); break;
      case 'recordNewPayment':          result = recordNewPayment_(data, auth); break;

      // ── PATCH: getStudentFinanceProfile avec calcul unifié ────────────────
      case 'getStudentFinanceSummary':
      case 'getStudentFinanceProfile':  result = getStudentFinanceProfile_PATCHED_(
                                          typeof data === 'string' ? data : (data && data.id ? data.id : data), auth
                                        ); break;

      case 'processPayrollBatch':       result = processPayrollBatch_(data); break;

      // ── PATCH: getDashboardLiveStats avec calcul unifié ───────────────────
      case 'getDashboardLiveStats':     result = getDashboardLiveStats_PATCHED_(auth); break;

      // ── ATTENDANCE ────────────────────────────────────────────────────────
      case 'getAttendanceStats':        result = getAttendanceStats_(auth); break;
      case 'recordBulkAttendance':      result = recordBulkAttendance_(data, auth); break;
      case 'getAttendance':             result = getAttendanceForStudent_(data, auth); break;
      case 'getAttendanceByDate':       result = getAttendanceByDate_(data); break;
      case 'recordStudentAttendance':   result = recordStudentAttendance_(data); break;
      case 'recordTransportAttendance': result = recordTransportAttendance_(data, auth); break;
      case 'getStudentAttendance':      result = getStudentAttendance_(
                                          typeof data === 'string' ? data : (data && data.studentId ? data.studentId : data), auth
                                        ); break;
      case 'getStudentAttendanceStats': result = getStudentAttendanceStats_(
                                          typeof data === 'string' ? data : (data && data.studentId ? data.studentId : data), auth
                                        ); break;
      case 'getStudentInternalNotes':   result = getStudentInternalNotes_(
                                          typeof data === 'string' ? data : (data && data.studentId ? data.studentId : data), auth
                                        ); break;
      case 'addStudentInternalNote':    result = addStudentInternalNote_(data, auth); break;
      case 'recordAttendance':          result = recordAttendance_(data, auth); break;

      // ── GRADES / BULLETINS ────────────────────────────────────────────────
      case 'generateFullStudentReport': result = generateFullStudentReport_(data, auth); break;
      case 'getStudentBulletinData':    result = getStudentBulletinData_(data, auth); break;
      case 'getGrades':                 result = getGrades_(data, auth); break;
      case 'getStudentScores':
        result = getStudentScores_(
          typeof data === 'string' ? data : (data && data.id ? data.id : data),
          data && data.targetYear ? data.targetYear : '',
          data && data.historyId ? data.historyId : ''
        );
        break;
      case 'saveManualExamGrade':       result = saveManualExamGrade_(data); break;
      case 'getAvailableExams':         result = getAvailableExams_(); break;
      case 'getExistingGrade':          result = getExistingGrade_(data.studentCode, data.examTitle); break;
      case 'updateGradeSubjects':       result = updateGradeSubjects_(data); break;
      case 'addQuizQuestion':           result = addQuizQuestion_(data); break;
      case 'getQuizQuestions':          result = getQuizQuestions_(
                                          typeof data === 'string' ? data : (data && data.examTitle ? data.examTitle : data)
                                        ); break;
      case 'updateExamSettings':        result = updateExamSettings_(data); break;

      // ── AI / MESSAGING ────────────────────────────────────────────────────
      case 'classifyAiIntent':          result = classifyAiIntent_(data, auth); break;
      case 'processUserMessage':        result = processUserMessage_(data, auth); break;
      case 'getAiTokenStatus':          result = getAiTokenStatus_(data, auth); break;
      case 'getDirectAiKey':            result = getDirectAiKey_(data, auth); break;
      case 'resetAiTokenLog':           result = resetAiTokenLog_(data, auth); break;
      case 'setUserAiApiKey':           result = setUserAiApiKey_(data, auth); break;
      case 'getUserAiApiKeyStatus':     result = getUserAiApiKeyStatus_(data, auth); break;
      case 'verifyUserAiApiKey':        result = verifyUserAiApiKey_(data, auth); break;
      case 'translateMeigensText':      result = translateMeigensText_(data.text, data.lang); break;
      case 'publishAnnouncement':       result = publishAnnouncement_(data, auth); break;
      case 'sendInternalMessage':       result = sendInternalMessage_(data, auth); break;
      case 'sendSMSBulk':               result = sendSMSBulk_(data, auth); break;
      case 'testSMSConnection':         result = testSMSConnection_(data, auth); break;
      case 'sendStudentReportEmail':    result = sendStudentReportEmail_(data, auth); break;

      // ── PATCH: WhatsApp API ───────────────────────────────────────────────
      case 'sendWhatsApp':              result = sendWhatsAppMessage_(data, auth); break;

      // ── PROMOTION ─────────────────────────────────────────────────────────
      case 'getPromotionDecision':      result = getPromotionDecision_(data); break;
      case 'processPromotionDecision':  result = processPromotionDecision_(data); break;

      // ── AUDIT / ANALYTICS ─────────────────────────────────────────────────
      case 'getGlobalAuditDashboard':
      case 'getAuditLogs':              result = getAuditLogs(auth, data || {}); break;
      case 'getAuditDiagnostics':       result = getAuditDiagnostics(); break;
      case 'getImmersiveData':          result = getImmersiveData_(data, auth); break;
      // ── Exam Builder / Runner / Grading ───────────────────────────────────
      case 'saveExam':                  result = examSave_(data, auth); break;
      case 'listExams':                 result = examList_(data, auth); break;
      case 'getExam':                   result = examGet_(data, auth); break;
      case 'deleteExam':                result = examDelete_(data, auth); break;
      case 'publishExam':               result = examPublish_(data, auth); break;
      case 'listExamSubmissions':       result = examListSubmissions_(data, auth); break;
      case 'getExamSubmission':         result = examGetSubmission_(data, auth); break;
      case 'gradeExamSubmission':       result = examGradeSubmission_(data, auth); break;
      case 'listStudentExams':          result = examListForStudent_(data, auth); break;
      case 'startStudentExam':          result = examStartForStudent_(data, auth); break;
      case 'saveExamProgress':          result = examSaveProgress_(data, auth); break;
      case 'submitStudentExam':         result = examSubmitForStudent_(data, auth); break;
      case 'getStudentExamResult':      result = examGetStudentResult_(data, auth); break;
      // ── Media Library ─────────────────────────────────────────────────────
      case 'listMedia':                 result = mediaList_(data, auth); break;
      case 'saveMedia':                 result = mediaSave_(data, auth); break;
      case 'deleteMedia':               result = mediaDelete_(data, auth); break;
      case 'uploadMediaFile':           result = mediaUpload_(data, auth); break;
      // ── Homework ──────────────────────────────────────────────────────────
      case 'listHomework':              result = homeworkList_(data, auth); break;
      case 'saveHomework':              result = homeworkSave_(data, auth); break;
      case 'deleteHomework':            result = homeworkDelete_(data, auth); break;
      case 'gradeHomework':             result = homeworkGrade_(data, auth); break;
      case 'getHomeworkGrades':         result = homeworkGetGrades_(data, auth); break;
      case 'convertHomeworkToExam':     result = homeworkConvertToExam_(data, auth); break;
      case 'listStudentHomework':       result = homeworkListForStudent_(data, auth); break;
      case 'getStudentHomeworkBulletin':result = homeworkStudentBulletin_(data, auth); break;
      case 'getComplexReportData':      result = getComplexReportData_(data, auth); break;
      case 'getUniversalAnalytics':     result = getUniversalAnalytics_(data, auth); break;
      case 'getClassComparisonData':    result = getClassComparisonData_(data, auth); break;
      case 'reportSecurityIncident':    result = reportSecurityIncident_(data, auth); break;
      case 'generateReportDownloadUrl': result = generateReportDownloadUrl_(data, auth); break;

      // ── PATCH: Alertes système ────────────────────────────────────────────
      case 'getSystemAlerts':           result = getSystemAlerts_(auth); break;
      case 'getNotifications':          result = getNotifications_(data, auth); break;
      case 'markNotificationRead':      result = markNotificationRead_(data, auth); break;
      case 'markAllNotificationsRead':  result = markAllNotificationsRead_(data, auth); break;
      case 'confirmTeacherAlertStatus': result = confirmTeacherAlertStatus_(data, auth); break;

      // ── STAFF ASSIGNMENTS / TIMETABLE ─────────────────────────────────────
      case 'getStaffAssignments':       result = getStaffAssignments_(auth); break;
      case 'deleteStaffAssignment':     result = deleteStaffAssignment_(data, auth); break;
      case 'saveStaffAssignment':       result = saveStaffAssignment_(data, auth); break;
      case 'getUnifiedDirectory':       result = getUnifiedDirectory_(); break;
      case 'handleTemplateUpload':      result = handleTemplateUpload_(data); break;
      case 'createSubject':             result = createSubject_(data, auth); break;
      case 'deleteSubject':             result = deleteSubject_(data, auth); break;
      case 'logReportGenerated':        result = logReportGenerated_(data, auth); break;

      // ── AUTH / PIN ────────────────────────────────────────────────────────
      case 'setupInitialPin':           result = setupInitialPin_(data.fullId || data.id, data.newPin || data.pin); break;
      case 'loginWithIdAndPin':         result = loginWithIdAndPin_(data.userId, data.pin); break;
      case 'setupStaffPin':             result = setupStaffPin_(data, auth); break;
      case 'sendEmailVerification':     result = sendEmailVerification_(auth); break;
      case 'verifyEmailOTP':            result = verifyEmailOTP_(data.otp, auth); break;
      case 'studentPortalLogin':        result = studentPortalLogin_(data); break;

      // ── ACADEMIC YEAR ROLLOVER ────────────────────────────────────────────
      case 'rolloverAcademicYear':      result = rolloverAcademicYear_(auth); break;
      case 'getAcademicYearRolloverStatus': result = getAcademicYearRolloverStatus_(auth); break;
      case 'resetAcademicYearRollover': result = resetAcademicYearRollover_(auth); break;

      // ── BACKUP / MAINTENANCE ──────────────────────────────────────────────
      case 'createSaaSBackup':          result = createSaaSBackup_(); break;
      case 'runGlobalBackupTask':       result = runGlobalBackupTask_(); break;
      case 'checkAndInitSheets':        result = checkAndInitSheets(); break;
      case 'initAiConfigurationLibrary':
      case 'ensureAiConfigurationLibrarySheets': result = initAiConfigurationLibrary_(data, auth); break;
      case 'initAiMasterSheets':               result = initAiMasterSheets_(data, auth); break;
      case 'forceInitAiMasterSheets':   result = forceInitAiMasterSheets_(data, auth); break;
      case 'getAiChatConversation':     result = getAiChatConversation_(data, auth); break;
      case 'getAiChatConversationList': result = getAiChatConversationList_(data, auth); break;
      case 'resetAiChatConversation':   result = resetAiChatConversation_(data, auth); break;
      case 'resetAiTokenSession':        result = resetAiTokenSession_(data, auth); break;
      case 'getAiChatLibraryStatus':    result = getAiChatLibraryStatus_(data, auth); break;
      case 'warmSchoolCaches':          result = warmSchoolCachesOnInit_(auth, data || {}); break;
      case 'checkAndUpdateAccountStatus': result = checkAndUpdateAccountStatus_(data, auth); break;

      // ── SCHOOL IDs ────────────────────────────────────────────────────────
      case 'ensureSchoolIdsSheet':
      case 'initSchoolIdsSheet':
      case 'initializeSheetHeaders':    result = ensureSchoolIdsSheet_(data, auth); break;
      case 'getSchoolIds':
      case 'listSchoolIds':
      case 'getSchoolIdsRecords':       result = getSchoolIdsRecords_(data, auth); break;
      case 'saveSchoolIdRecord':
      case 'appendSchoolIdRecord':
      case 'updateSchoolIdRecord':
      case 'upsertSchoolIdRecord':      result = upsertSchoolIdRecord_(data, auth); break;

      // ── ENROLLMENT / HISTORY ──────────────────────────────────────────────
      case 'enrollStudent':             result = enrollStudent_(data, auth); break;
      case 'diagnoseSyncIssue':         result = diagnoseSyncIssue_(data, auth); break;
      case 'runAuditMigration':          result = runAuditMigration_(); break;
      case 'dropStudent':
      case 'DROP_STUDENT':              result = dropStudent_(data, auth); break;
      case 'reEnrollStudent':           result = reEnrollStudent_(data, auth); break;
      case 'getActiveEnrollment':       result = getActiveEnrollment_(
                                          typeof data === 'string' ? data : (data && data.studentId ? data.studentId : data)
                                        ); break;
      case 'updateStudentHistory':      result = updateStudentHistory_(data, auth); break;

      // ── PATCH: Kiosk Watch Codes ──────────────────────────────────────────
      case 'saveKioskWatchCodes':       result = saveKioskWatchCodes_(data, auth); break;
      case 'getKioskWatchCodes':        result = getKioskWatchCodes_(auth); break;

      // ── PATCH: Bulletin authenticity verification ────────────────────────
      case 'registerBulletinIssue':     result = registerBulletinIssue_(data, auth); break;
      case 'verifyBulletin':            result = verifyBulletin_(data, auth); break;
      // ── PATCH: Sheet bootstrap ───────────────────────────────────────────
      case 'initSheets':                result = initCoreSheets_(); break;

      // ── Fix 1c: forcePasswordUpdate double-alias ──────────────────────
      // The alias table remaps 'forcePasswordUpdate_' (with underscore) to
      // 'forcePasswordUpdate', but there was no switch case for the canonical
      // name, so the call always hit the default error branch.
      case 'forcePasswordUpdate':       result = forcePasswordUpdate_(data, auth); break;

      // ── Fix 1b: verifyStudentByLast4 — function existed, case was missing
      case 'verifyStudentByLast4':      result = verifyStudentByLast4_(data); break;

      // ── Fix 7: getEnrollmentsByClass — new handler (see function below) ─
      case 'getEnrollmentsByClass':     result = getEnrollmentsByClass_(data, auth); break;

      // ── Fix 2: notifyLateStaff — was entirely missing (see function below)
      case 'notifyLateStaff':           result = notifyLateStaff_(data, auth); break;

      // ── DEFAULT ───────────────────────────────────────────────────────────
      default:
        result = { success: false, error: 'Action orpheline: ' + action };
    }

    _auditApiHubAction_(action, data, result, policy[action]);
    return respond(result);

  } catch (e) {
    try {
      const traceId = _auditDebugTraceId_();
      const failedResult = { success: false, error: 'Erreur inattendue: ' + e.message };
      const debug = _buildAuditDebugContext_(action, data, failedResult, 'SYSTEM', true, traceId, e);
      writeAuditLog(
        String(action || 'APIHUB').toUpperCase(),
        _auditTargetFromPayload_(action, data, failedResult),
        { traceId: traceId, crash: true, error: e.message, debug: debug },
        'SYSTEM',
        true
      );
    } catch (_auditErr) {}
    return normalizeApiHubResponse_(action, { success: false, error: 'Erreur inattendue: ' + e.message });
  }
}
/**
 * Runs infrastructure checks at a controlled cadence.
 * Avoids re-applying protections and schema checks on each apiHub call.
 */
function ensureInfraReadyThrottled_() {
  try {
    const ss = getSS_();
    const key = 'INFRA_READY_' + ss.getId();
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return;

    checkAndInitSheets();
    // 10 minutes: enough to keep infra healthy without penalizing each action
    _safeCachePut(key, '1', 600);
  } catch (e) {
    // Never block user actions if infra warmup fails
  }
}

function warmSchoolCachesOnInit_(auth, options) {
  try {
    const opts = (options && typeof options === 'object') ? options : {};
    const ss = getSS_();
    const ssId = ss.getId();
    const warmKey = 'SCHOOL_INIT_CACHE_WARM_' + ssId;

    if (opts.force) {
      try {
        const cache = CacheService.getScriptCache();
        cache.remove(warmKey);
        cache.remove('STUDENT_ATTENDANCE_PCT_' + ssId);
        cache.remove('ACTIVE_HISTORY_CACHE_' + ssId);
      } catch (_clearErr) {}
    }

    const already = _safeCacheGetData_(warmKey);
    if (already && already.ok) return already;

    const settings = getSaaSSettings_(auth);
    const students = getAllStudents_(auth);
    const historyMap = _buildActiveHistoryMap(ss);
    const attendancePctMap = _buildStudentAttendancePercentMap_(ss);
    const stats = getDashboardLiveStats_(auth);

    const payload = {
      ok: true,
      at: new Date().toISOString(),
      forced: !!opts.force,
      settingsReady: !!(settings && settings.success),
      studentsLoaded: Array.isArray(students) ? students.length : 0,
      historyLoaded: Object.keys(historyMap || {}).length,
      attendancePercentLoaded: Object.keys(attendancePctMap || {}).length,
      dashboardReady: !!(stats && stats.success)
    };
    _safeCachePut(warmKey, JSON.stringify(payload), 900);
    return payload;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// INIT
// ============================================================
function _initAiMasterSheetsStrict_(force) {
  var lastErr = '';
  var master = null;
  var attempts = 3;
  for (var t = 0; t < attempts; t++) {
    try {
      master = _openMasterAuthSpreadsheet_();
      if (master) break;
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  if (!master) throw new Error('Master auth spreadsheet introuvable: ' + _resolveMasterAuthSpreadsheetId_() + (lastErr ? ' | ' + lastErr : ''));

  // AI config library sheets live in the AI memory spreadsheet.
  var aiSs = null;
  try { aiSs = SpreadsheetApp.openById(AI_MEMORY_SPREADSHEET_ID); } catch (_e) {}
  if (!aiSs) throw new Error('Tableur mémoire-IA introuvable (ID: ' + AI_MEMORY_SPREADSHEET_ID + '). Vérifiez que le script y a accès.');

  var seeded = ensureAiConfigurationLibrarySheets_(aiSs, { force: !!force });
  if (!seeded || seeded.success === false) {
    throw new Error('Initialisation des feuilles AI config echouee.');
  }

  var chatInit = _ensureAiChatLibrarySheet_();
  if (!chatInit || chatInit.success === false) {
    throw new Error((chatInit && chatInit.error) || 'Initialisation de AI_CHAT_LOGS echouee.');
  }

  // Validate AI config sheets in the AI memory spreadsheet.
  var requiredAi = [
    AI_CONFIG_SHEETS.cycles,
    AI_CONFIG_SHEETS.levels,
    AI_CONFIG_SHEETS.subjects,
    AI_CONFIG_SHEETS.branches,
    AI_CONFIG_SHEETS.questions,
    AI_CONFIG_SHEETS.defaults,
    AI_CHAT_LIBRARY_SHEET_NAME
  ];
  var missingAi = requiredAi.filter(function(name) { return !aiSs.getSheetByName(name); });
  if (missingAi.length) {
    throw new Error('Feuilles AI manquantes dans le tableur mémoire-IA: ' + missingAi.join(', '));
  }

  return {
    success: true,
    spreadsheetId: String(aiSs.getId() || ''),
    masterSpreadsheetId: String(master.getId() || ''),
    summary: seeded.summary || {}
  };
}

function checkAndInitSheets() {
  try {
    const ss = getSS_();
    SHEET_DEFS.forEach(def => {
      let sh = ss.getSheetByName(def.name);
      if (!sh) {
        sh = ss.insertSheet(def.name);
        sh.getRange(1,1,1,def.headers.length)
          .setValues([def.headers]).setFontWeight('bold').setBackground('#f3f3f3');
        sh.setFrozenRows(1);
      } else {
        const existing = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0]
                          .map(x => String(x).trim());
        let added = 0;
        def.headers.forEach(h => {
          if (!existing.includes(h)) {
            sh.getRange(1, sh.getLastColumn()+1).setValue(h).setFontWeight('bold').setBackground('#fff2cc');
            added++;
          }
        });
        if (added) Logger.log(def.name + ': ' + added + ' colonnes ajoutees.');
      }
    });
    migrateAdminUsersSheet_(ss);
    ensureInternalGodModeAccount_(ss);
    // Ensure School IDs sheet exists in Auth spreadsheet even before UI requests it.
    try { ensureSchoolIdsSheetInAuth_(SCHOOL_IDS_HEADERS); } catch (_idsErr) {}

    var aiInit = { success: false, error: 'AI_INIT_NOT_RUN' };
    try {
      aiInit = _initAiMasterSheetsStrict_(false);
    } catch (_aiInitErr) {
      aiInit = {
        success: false,
        error: String(_aiInitErr && _aiInitErr.message || _aiInitErr),
        spreadsheetId: String(_resolveMasterAuthSpreadsheetId_() || '')
      };
      Logger.log('AI master init failed: ' + aiInit.error);
      // Don't fail the entire initialization - AI can be initialized later
      aiInit = { success: true, error: 'AI_INIT_DEFERRED', spreadsheetId: aiInit.spreadsheetId };
    }

    applySheetProtections_();
    const cacheWarmup = warmSchoolCachesOnInit_({});
    if (!aiInit.success && aiInit.error !== 'AI_INIT_DEFERRED') {
      return {
        success: false,
        error: 'AI_MASTER_INIT_FAILED',
        message: 'Les feuilles AI ne sont pas creees dans le master auth spreadsheet.',
        resolvedMasterSpreadsheetId: String(_resolveMasterAuthSpreadsheetId_() || ''),
        aiInit: aiInit,
        cacheWarmup: cacheWarmup
      };
    }
    return {
      success: true,
      message: 'Infrastructure synchronisee.',
      resolvedMasterSpreadsheetId: String(_resolveMasterAuthSpreadsheetId_() || ''),
      aiInit: aiInit,
      cacheWarmup: cacheWarmup
    };
  } catch(err) {
    return { success:false, error:err.message };
  }
}

function migrateAdminUsersSheet_(ss) {
  try {
    const oldSh = ss.getSheetByName('Admin_Users');
    const newSh = ss.getSheetByName(USERS_SHEET_NAME);
    if (!oldSh || !newSh) return;
    const oldData = oldSh.getDataRange().getValues();
    const newData = newSh.getDataRange().getValues();
    const nh      = newData[0].map(x => String(x).trim().toLowerCase());
    const iEmail  = nh.findIndex(x => x === 'email');
    const existing= newData.slice(1).map(r => String(r[iEmail]).toLowerCase().trim());
    const oh      = oldData[0].map(x => String(x).trim().toLowerCase());
    const oiEmail = oh.findIndex(x => x === 'email');
    if (oiEmail === -1) return;
    let migrated = 0;
    oldData.slice(1).forEach(row => {
      const em = String(row[oiEmail]).toLowerCase().trim();
      if (em && em.includes('@') && !existing.includes(em)) {
        const newRow = new Array(newData[0].length).fill('');
        USERS_HEADERS.forEach((h, i) => {
          const oi = oh.findIndex(x => x.replace(/[\s_]/g,'') === h.toLowerCase().replace(/[\s_]/g,''));
          if (oi !== -1) newRow[i] = row[oi];
        });
        newSh.appendRow(newRow);
        existing.push(em);
        migrated++;
      }
    });
    if (migrated > 0) {
      Logger.log('Migration Admin_Users -> Users: ' + migrated + ' utilisateurs.');
      oldSh.setName('Admin_Users_MIGRATED_' + new Date().getTime().toString().slice(-6));
    }
  } catch(e) { Logger.log('Migration ignoree: ' + e.message); }
}

// ============================================================
// STUDENTS
// ============================================================

/**
 * PERF: Lightweight throttle for the heavy Generated_IDs sync.
 * Called from doGet on every page load, but the actual sync runs
 * at most once every 10 minutes via CacheService stamp.
 * The sync runs synchronously the first time, then becomes a no-op
 * until the cache stamp expires.
 */
function _scheduleGeneratedIdsSync_() {
  try {
    const cache = CacheService.getScriptCache();
    const stamp = cache.get('SYNC_GENIDS_STAMP');
    if (stamp) return; // ran recently — skip silently
    cache.put('SYNC_GENIDS_STAMP', String(Date.now()), 600); // 10 min
    // Run after a tiny delay so it doesn't block the HTML response.
    // Apps Script has no setTimeout, so we just call it inline but
    // it's now throttled to once per 10 min instead of every load.
    syncAssignedStudentsFromGeneratedIds_({ force: false });
  } catch (err) {
    Logger.log('[_scheduleGeneratedIdsSync_] ' + err.message);
  }
}

function syncAssignedStudentsFromGeneratedIds_(options) {
  const cfg   = options || {};
  const force = !!cfg.force;
  const lock  = LockService.getScriptLock();
  const logs  = [];
  const log   = function(msg) { logs.push(msg); console.log(msg); };

  log('[SYNC_START] force=' + force);
  try {
    lock.waitLock(10000);

    const ss    = getSS_();
    const ssId  = ss.getId();
    const orgId = String(getOrgId_() || '').trim();
    if (!orgId || orgId === 'UNKNOWN_ORG') {
      log('[SYNC_SKIP] ORG_ID not available');
      return { success: true, skipped: true, reason: 'ORG_ID_UNAVAILABLE', logs: logs };
    }

    const cacheKey = 'SYNC_GENERATED_IDS_' + ssId + '_' + orgId;
    if (!force) {
      const cached = _safeCacheGetData_(cacheKey);
      if (cached && cached.done) {
        log('[SYNC_SKIP] Already synced recently (cached)');
        return { success: true, skipped: true, reason: 'SYNC_THROTTLED', meta: cached, logs: logs };
      }
    }

    const master      = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const shGenerated = master.getSheetByName('Generated_IDs');
    if (!shGenerated || shGenerated.getLastRow() < 2) {
      log('[SYNC_SKIP] No students in Generated_IDs sheet');
      _safeCachePut(cacheKey, JSON.stringify({ done: true, imported: 0, updated: 0, orgId: orgId }), 300);
      return { success: true, imported: 0, updated: 0, orgId: orgId, logs: logs };
    }

    const generatedData = shGenerated.getDataRange().getValues();
    log('[SYNC_INFO] Found ' + (generatedData.length - 1) + ' rows in Generated_IDs');

    // Normalize headers: strip accents + all whitespace
    const gHeaders = generatedData[0].map(function(x) {
      return String(x || '').toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    });
    log('[SYNC_DEBUG] Normalized headers: ' + JSON.stringify(gHeaders));

    const giId      = gHeaders.indexOf('ID');
    const giNom     = gHeaders.indexOf('NOM');
    const giPrenom  = gHeaders.indexOf('PRENOM');
    const giPhone   = gHeaders.indexOf('PHONE');
    const giOrg     = gHeaders.indexOf('ORGID');
    const giPhoto   = gHeaders.indexOf('PHOTOURL');
    const giStatus  = gHeaders.indexOf('STATUS');
    const giClasse  = gHeaders.indexOf('CLASSE');
    const giSexe    = gHeaders.indexOf('SEXE');
    const giAdresse = gHeaders.indexOf('ADRESSE');
    // "Date de Naissance" → "DATENAISSANCE"; fallback for old "DATEDENAISSANCE"
    const giBirth   = gHeaders.indexOf('DATENAISSANCE') !== -1
                        ? gHeaders.indexOf('DATENAISSANCE')
                        : gHeaders.indexOf('DATEDENAISSANCE');

    log('[SYNC_DEBUG] Col indices — ID:' + giId + ' ORG:' + giOrg + ' CLASSE:' + giClasse + ' BIRTH:' + giBirth);

    if (giId === -1 || giOrg === -1) {
      lock.releaseLock();
      return { success: false, error: 'Colonnes ID/ORG ID manquantes dans Generated_IDs.', logs: logs };
    }

    const normalizePhotoUrl_ = function(raw) {
      let photo = String(raw || '').trim();
      if (!photo) return '';
      if (photo.indexOf('drive.google.com') !== -1) {
        const m = photo.match(/id=([a-zA-Z0-9_-]+)/) || photo.match(/\/d\/([a-zA-Z0-9_-]+)\//);
        if (m) photo = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400';
      }
      return photo;
    };

    const isInactiveStatus_ = function(rawStatus) {
      const s = String(rawStatus || '').trim().toUpperCase();
      if (!s) return false;
      return /INACTIF|INACTIVE|SUSPENDU|SUSPENDED|BLOCKED|BLOQUE|DISABLED|FALSE|ARCHIVED/.test(s);
    };

    // Collect rows for this org, then release the lock before calling addNewStudent_
    // (addNewStudent_ acquires its own lock — holding both would deadlock)
    const rowsToProcess = [];
    generatedData.slice(1).forEach(function(gRow) {
      const rowOrgId = String(gRow[giOrg] || '').trim();
      if (!rowOrgId || rowOrgId !== orgId) return;
      if (giStatus !== -1 && isInactiveStatus_(gRow[giStatus])) return;
      const code = String(gRow[giId] || '').trim();
      if (!code) return;

      rowsToProcess.push({
        StudentCode:      code,
        LastName:         giNom     !== -1 ? String(gRow[giNom]     || '').trim() : '',
        FirstName:        giPrenom  !== -1 ? String(gRow[giPrenom]  || '').trim() : '',
        Phone:            giPhone   !== -1 ? String(gRow[giPhone]   || '').trim() : '',
        Gender:           giSexe    !== -1 ? String(gRow[giSexe]    || '').trim() : '',
        BirthDate:        giBirth   !== -1 ? gRow[giBirth]                        : '',
        Address:          giAdresse !== -1 ? String(gRow[giAdresse] || '').trim() : '',
        PhotoURL:         giPhoto   !== -1 ? normalizePhotoUrl_(gRow[giPhoto])    : '',
        CurrentLevel:     giClasse  !== -1 ? String(gRow[giClasse]  || '').trim() : '',
        Section:          'A',
        EnrollmentStatus: 'ACTIVE',
        Active:           'TRUE',
        GeneratedSource:  'Generated_IDs',
        GeneratedOrgId:   rowOrgId
      });
    });

    log('[SYNC] ' + rowsToProcess.length + ' row(s) match orgId="' + orgId + '"');

    // Release lock — addNewStudent_ manages its own locking
    lock.releaseLock();

    let imported       = 0;
    let updated        = 0;
    let historyCreated = 0;

    rowsToProcess.forEach(function(formObj) {
      try {
        log('[SYNC] Calling addNewStudent_ for ' + formObj.StudentCode + ' level="' + formObj.CurrentLevel + '"');
        const result = addNewStudent_(formObj);
        if (result.success) {
          if (result.message && result.message.indexOf('mis a jour') !== -1) {
            updated++;
            log('[SYNC] ✓ Updated ' + formObj.StudentCode);
          } else {
            imported++;
            historyCreated++;
            log('[SYNC] ✓ Created ' + formObj.StudentCode + ' → history written');
          }
        } else {
          log('[SYNC] ✗ Failed for ' + formObj.StudentCode + ': ' + (result.error || 'Unknown'));
        }
      } catch(e) {
        log('[SYNC] ✗ Exception for ' + formObj.StudentCode + ': ' + e.message);
      }
    });

    const syncMeta = {
      done: true, imported: imported, updated: updated,
      historyCreated: historyCreated, orgId: orgId,
      at: new Date().toISOString()
    };
    try { _safeCachePut(cacheKey, JSON.stringify(syncMeta), 300); } catch(e) {}

    log('[SYNC_COMPLETE] imported=' + imported + ' updated=' + updated + ' historyCreated=' + historyCreated);
    return Object.assign({ success: true, logs: logs }, syncMeta);

  } catch(e) {
    log('[SYNC_ERROR] ' + e.message);
    return { success: false, error: e.message, logs: logs };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

function getAllStudents_(auth) {
  try {
    syncAssignedStudentsFromGeneratedIds_();
    const viewer = auth ? getViewerInfo_(auth) : null;
    const ss = getSS_();
    const attendancePctMap = _buildStudentAttendancePercentMap_(ss);
    const sh = ss.getSheetByName('students');
    if (!sh || sh.getLastRow() < 2) return [];
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const tz   = Session.getScriptTimeZone();
    const histMap = _buildActiveHistoryMap(ss);
    const rows = data.slice(1).filter(r => r[0]).map(r => {
      const obj = {};
      h.forEach((k,i) => { obj[k] = r[i] instanceof Date ? Utilities.formatDate(r[i],tz,'yyyy-MM-dd') : r[i]; });
      if (typeof obj.CustomFields === 'string' && obj.CustomFields.startsWith('{')) {
        try { obj.CustomFields = JSON.parse(obj.CustomFields); } catch(e) {}
      }
      const hist = histMap[String(r[0]).toUpperCase().trim()];
      obj.CurrentLevel    = hist ? hist.level     : (obj.CurrentLevel || 'Non inscrit');
      obj.Active          = hist ? 'TRUE'         : 'FALSE';
      obj.Section         = hist ? hist.section   : '';
      obj.SchoolYear      = hist ? hist.year       : '';
      obj.ActiveHistoryID = hist ? hist.historyId  : '';
      const canonicalId = String(obj.StudentCode || obj.StudentID || '').trim();
      if (canonicalId) {
        if (!obj.studentId) obj.studentId = canonicalId;
        if (!obj.id) obj.id = canonicalId;
        if (!obj.StudentID) obj.StudentID = canonicalId;
        const pct = Number(attendancePctMap[String(canonicalId).toUpperCase().trim()] || 0);
        obj.attendance = pct;
        obj.Attendance = pct;
      }
      return obj;
    });

    // Enrich each student with paid% using the configured tuition amount
    // so the frontend list shows accurate payment status from first load.
    try {
      const confForPaid = getSaaSSettings_(auth);
      const confPaidData = confForPaid && confForPaid.success && confForPaid.data ? confForPaid.data : {};
      const paidMap = _buildStudentPaidPercentMap_(ss, confPaidData);
      rows.forEach(function(row) {
        const sid = String(row.id || row.StudentCode || '').trim().toUpperCase();
        if (sid && paidMap[sid] !== undefined) {
          row.paid = paidMap[sid] + '%';
        } else if (!row.paid) {
          row.paid = '0%';
        }
      });
    } catch (_paidErr) {
      console.warn('[getAllStudents_] paid% enrichment failed:', _paidErr.message);
    }

    return viewer && viewer.success ? filterStudentsByViewerScope_(rows, viewer) : rows;
  } catch(e) { return []; }
}

function getStudentById_(data, auth) {
  const id = String(typeof data === 'string' ? data : (data && (data.id || data.studentId || data.StudentCode) || '')).trim();
  if (!id) return { success: false, error: 'Identifiant élève manquant.' };
  const all = getAllStudents_(auth);
  const student = all.find(s =>
    String(s.StudentCode || '').trim() === id ||
    String(s.id         || '').trim() === id ||
    String(s.studentId  || '').trim() === id
  );
  if (!student) return { success: false, error: 'Élève introuvable: ' + id };
  return { success: true, data: student };
}

function _getLatestHistoryRow_(data, normHeaders, studentId) {
  const iSid = normHeaders.indexOf('STUDENTID');
  let latest = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iSid]).trim().toUpperCase() === studentId.trim().toUpperCase()) {
      latest = data[i];
    }
  }
  return latest;          // null  ➜  no history at all
}
 
// ── ACTIVE HISTORY MAP (used by attendance, grades, finance) ─
/**
 * Replace the existing _buildActiveHistoryMap.
 * Key change: only marks a student as active when their LATEST
 * row (not just any row) has STATUS = 'ACTIVE'.
 */
function _buildActiveHistoryMap(ss) {
  const cacheKey = 'ACTIVE_HISTORY_CACHE_' + ss.getId();
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed._timestamp && (Date.now() - parsed._timestamp) < 1500000) {
        if (parsed._data) return parsed._data;
        const map = { ...parsed };
        delete map._timestamp;
        return map;
      }
    } catch(e) {}
  }
 
  const map = {};
  try {
    const sh = ss.getSheetByName('studenthistory');
    if (!sh || sh.getLastRow() < 2) return map;
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iId   = h.indexOf('HISTORYID');
    const iSid  = h.indexOf('STUDENTID');
    const iYear = h.indexOf('SCHOOLYEAR');
    const iLvl  = h.indexOf('GRADELEVELID');
    const iSec  = h.indexOf('SECTION');
    const iStat = h.indexOf('STATUS');
 
    // Collect LATEST row per student (last occurrence wins — append-only)
    const latestRows = {};
    data.slice(1).forEach(r => {
      const sid = String(r[iSid]).toUpperCase().trim();
      if (sid) latestRows[sid] = r;
    });
 
    // Only populate the map when the latest row is ACTIVE
    Object.entries(latestRows).forEach(([sid, r]) => {
      if (String(r[iStat]).toUpperCase() === 'ACTIVE') {
        map[sid] = {
          historyId: r[iId],
          level:     r[iLvl],
          section:   r[iSec],
          year:      r[iYear]
        };
      }
    });
  } catch(e) {}
 
  _safeCachePut(cacheKey, JSON.stringify(map), 1800);
  return map;
}

function _normalizeAttendanceStatusToken_(raw) {
  const status = String(raw || '').trim().toUpperCase();
  if (status === 'RETARD' || status === 'LATE' || status === 'R') return 'LATE';
  if (status === 'ABSENT' || status === 'A') return 'ABSENT';
  if (status === 'PRESENT' || status === 'P' || status === 'ON_TIME' || status === 'ONTIME') return 'PRESENT';
  return status || 'PRESENT';
}

/**
 * Builds a map of studentId → paid% based on Finance sheet + configured tuition.
 * Used by getAllStudents_ to enrich the student list with accurate payment status.
 */
function _buildStudentPaidPercentMap_(ssInput, conf) {
  const ss = ssInput || getSS_();
  const map = {};
  try {
    const sh = ss.getSheetByName('Finance');
    if (!sh || sh.getLastRow() < 2) return map;
    const data = sh.getDataRange().getValues();
    const h = data[0].map(function(x){ return String(x||'').trim(); });
    const iSid = h.indexOf('StudentID');
    const iAmt = h.indexOf('Amount');
    const iDue = h.indexOf('AmountDue');
    const iTotDue = h.indexOf('TotalDue');
    if (iSid === -1 || iAmt === -1) return map;

    const paidBySid = {};
    const dueBySid  = {};
    data.slice(1).forEach(function(r) {
      const sid = String(r[iSid] || '').trim().toUpperCase();
      if (!sid) return;
      const amt = parseFloat(r[iAmt] || 0) || 0;
      const rawDue = parseFloat((iDue >= 0 ? r[iDue] : 0) || (iTotDue >= 0 ? r[iTotDue] : 0) || 0);
      const due = rawDue > 0 ? rawDue : 0;
      paidBySid[sid] = (paidBySid[sid] || 0) + amt;
      if (due > (dueBySid[sid] || 0)) dueBySid[sid] = due;
    });

    // Configured tuition takes precedence over per-row AmountDue
    const configuredTuition = parseFloat(
      (conf && (conf.TUITION_AMOUNT_GLOBAL || conf.TUITION_AMOUNT)) || 0
    ) || 0;

    Object.keys(paidBySid).forEach(function(sid) {
      const paid = paidBySid[sid] || 0;
      const due  = configuredTuition > 0 ? configuredTuition
                 : (dueBySid[sid] > 0   ? dueBySid[sid]
                 : paid);
      map[sid] = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
    });
  } catch(_e) {}
  return map;
}

function _buildStudentAttendancePercentMap_(ssInput) {
  const ss = ssInput || getSS_();
  const cacheKey = 'STUDENT_ATTENDANCE_PCT_' + ss.getId();
  const cached = _safeCacheGetData_(cacheKey);
  if (cached && typeof cached === 'object') return cached;

  const map = {};
  try {
    const sh = ss.getSheetByName('attendance');
    if (!sh || sh.getLastRow() < 2) {
      _safeCachePut(cacheKey, JSON.stringify(map), 900);
      return map;
    }

    const data = sh.getDataRange().getValues();
    const headers = data[0].map(function(x) { return String(x || '').trim().toUpperCase(); });
    const iSid = headers.findIndex(function(h) {
      return ['STUDENTID','STUDENTCODE','STUDENT_ID','STUDENT_CODE'].indexOf(h) !== -1;
    });
    const iStatus = headers.findIndex(function(h) { return h === 'STATUS'; });
    if (iSid === -1 || iStatus === -1) {
      _safeCachePut(cacheKey, JSON.stringify(map), 900);
      return map;
    }

    // Filter by current academic year to avoid stale all-time rates
    let currentYear = '';
    try {
      const confForAtt = getSaaSSettings_(null);
      const confData = confForAtt && confForAtt.success && confForAtt.data ? confForAtt.data : {};
      currentYear = String(confData.ACADEMIC_YEAR || confData.CURRENT_ACADEMIC_YEAR || '').trim();
    } catch(_yearErr) {}

    // Find date column index
    const iDate = headers.findIndex(function(h) {
      return ['DATE','ATTENDANCE_DATE','RECORD_DATE'].indexOf(h) !== -1;
    });

    const counts = {};
    data.slice(1).forEach(function(r) {
      const sid = String(r[iSid] || '').trim().toUpperCase();
      if (!sid) return;

      // Year filter: if we know the academic year (e.g. "2026-2027"),
      // only count records whose date falls within that school year range.
      if (currentYear && iDate !== -1) {
        const rawDate = r[iDate];
        let dateStr = '';
        if (rawDate instanceof Date) {
          dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          dateStr = String(rawDate || '').trim().slice(0, 10);
        }
        if (dateStr) {
          // Academic year "2026-2027" covers Aug 2026 – Jul 2027
          const parts = currentYear.split('-');
          if (parts.length === 2) {
            const yearStart = parts[0].trim();
            const yearEnd   = parts[1].trim();
            const dateYear = dateStr.slice(0, 4);
            const dateMonth = parseInt(dateStr.slice(5, 7), 10);
            // School year: Sep(9) of yearStart to Aug(8) of yearEnd
            const inYearStart = dateYear === yearStart && dateMonth >= 8;
            const inYearEnd   = dateYear === yearEnd   && dateMonth <= 8;
            const inMiddle    = parseInt(dateYear, 10) > parseInt(yearStart, 10) &&
                                parseInt(dateYear, 10) < parseInt(yearEnd, 10);
            if (!inYearStart && !inYearEnd && !inMiddle) return;
          }
        }
      }

      const token = _normalizeAttendanceStatusToken_(r[iStatus]);
      if (!counts[sid]) counts[sid] = { presentLike: 0, absent: 0 };
      if (token === 'ABSENT') counts[sid].absent += 1;
      else if (token === 'PRESENT' || token === 'LATE') counts[sid].presentLike += 1;
      // UNKNOWN / EXCUSED → skip (neutral)
    });

    Object.keys(counts).forEach(function(sid) {
      const c = counts[sid] || { presentLike: 0, absent: 0 };
      const total = Number(c.presentLike || 0) + Number(c.absent || 0);
      map[sid] = total > 0 ? Math.round((Number(c.presentLike || 0) / total) * 100) : 0;
    });
  } catch (_err) {}

  _safeCachePut(cacheKey, JSON.stringify(map), 900);
  return map;
}
function addNewStudent_(formObj) {
  const lock = LockService.getScriptLock();
  let studentCode = formObj.StudentCode;
  try {
    lock.waitLock(10000);
    const ss   = getSS_();
    const conf = getSaaSSettings_().data;
    if (conf.SYSTEM_ID_MODE === 'AUTO') {
      studentCode = (conf.SYSTEM_ID_PREFIX || 'MT') + Math.floor(1000 + Math.random()*9000);
      formObj.StudentCode = studentCode;
    }
    if (!studentCode) throw new Error('StudentCode manquant.');
    const sh      = ss.getSheetByName('students');
    const data    = sh.getDataRange().getValues();
    const headers = data[0].map(x => String(x).trim());
    const iCode   = headers.indexOf('StudentCode');
    let   rowIdx  = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iCode]).trim() === String(studentCode).trim()) { rowIdx = i+1; break; }
    }
    const knownKeys = new Set(headers);
    const customFields = {};
    Object.keys(formObj).forEach(k => { if (!knownKeys.has(k) && k !== 'CurrentLevel' && k !== 'Section') customFields[k] = formObj[k]; });
    const identityRow = headers.map(h => {
      if (h === 'CustomFields') return JSON.stringify(customFields);
      if (h === 'UpdatedAt')    return new Date();
      if (h === 'CreatedAt')    return rowIdx !== -1 ? data[rowIdx-1][headers.indexOf('CreatedAt')] : new Date();
      return formObj[h] !== undefined ? formObj[h] : '';
    });
    if (rowIdx !== -1) sh.getRange(rowIdx,1,1,headers.length).setValues([identityRow]);
    else sh.appendRow(identityRow);
    const currentYear = getActiveAcademicYear_();
    if (currentYear !== 'ANNEE_NON_CONFIGUREE') {
      const shHist  = ss.getSheetByName('studenthistory');
      const hData   = shHist.getDataRange().getValues();
      const hH      = hData[0];
      const iSid    = hH.indexOf('StudentID');
      const iYr     = hH.indexOf('SchoolYear');
      const iLvl    = hH.indexOf('GradeLevelID');
      const iStat   = hH.indexOf('Status');
      const iUpd    = hH.indexOf('UpdatedAt');
      const existActive = hData.slice(1).find(r =>
        String(r[iSid]).trim() === String(studentCode).trim() &&
        String(r[iStat]).toUpperCase() === 'ACTIVE'
      );
      if (existActive) {
        // Update the GradeLevelID if different
        const currentLevel = String(existActive[iLvl] || '').trim();
        const newLevel = String(formObj.CurrentLevel || 'N/A').trim();
        if (currentLevel !== newLevel) {
        const rowIndex = hData.indexOf(existActive) + 1;
          // PERF FIX: batch into one setValues() call
          const updHRow = existActive.slice();
          updHRow[iLvl] = newLevel;
          if (iUpd !== -1) updHRow[iUpd] = new Date();
          shHist.getRange(rowIndex, 1, 1, updHRow.length).setValues([updHRow]);
        }
      } else {
        const histID = 'HIS-' + Utilities.getUuid().substring(0,8);
        const histRow = hH.map(hdr => {
          switch(hdr) {
            case 'HistoryID':    return histID;
            case 'StudentID':    return studentCode;
            case 'SchoolYear':   return currentYear;
            case 'GradeLevelID': return formObj.CurrentLevel || 'N/A';
            case 'Section':      return formObj.Section || 'A';
            case 'Status':       return 'ACTIVE';
            case 'Timestamp':
            case 'UpdatedAt':    return new Date();
            default:             return '';
          }
        });
        shHist.appendRow(histRow);
      }
    }
    writeAuditLog_('ADD_STUDENT', studentCode, rowIdx !== -1 ? 'updated' : 'created', 'p_dossier');
    return { success:true, studentId:studentCode, message: rowIdx !== -1 ? 'Profil mis a jour' : 'Inscription complete' };
  } catch(e) {
    return { success:false, error:e.message };
  } finally { lock.releaseLock(); }
}

function updateStudent_(payload, auth) {
  try {
    const studentId = resolveStudentId_(payload);
    const updates   = payload.data || payload;
    if (!studentId) return { success:false, error:'studentId manquant.' };
    const ss      = getSS_();
    const conf    = getSaaSSettings_().data || {};
    const idMode  = String(conf.SYSTEM_ID_MODE || '').toUpperCase();
    const lockIdentity = idMode === 'AUTO' || idMode === 'COMPANY' || idMode === 'COMPANYMODE';
    const sh      = ss.getSheetByName('students');
    const data    = sh.getDataRange().getValues();
    const headers = data[0].map(x => String(x).trim());
    const iCode   = headers.findIndex(h => ['StudentCode','StudentID'].includes(h));
    if (iCode === -1) return { success:false, error:'Colonne StudentCode introuvable.' };
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iCode]).trim() === String(studentId).trim()) { rowIdx = i; break; }
    }
    if (rowIdx === -1) return { success:false, error:'Élève introuvable: ' + studentId };

    const iCurrentLevel = headers.indexOf('CurrentLevel');
    const iSection = headers.indexOf('Section');
    const currentLevel = iCurrentLevel !== -1 ? String(data[rowIdx][iCurrentLevel] || '').trim() : '';
    const currentSection = iSection !== -1 ? String(data[rowIdx][iSection] || '').trim() : '';
    const nextLevelRaw = updates.CurrentLevel !== undefined ? updates.CurrentLevel
      : (updates.currentLevel !== undefined ? updates.currentLevel
      : (updates.GradeLevelID !== undefined ? updates.GradeLevelID : updates.gradeLevelId));
    const nextSectionRaw = updates.Section !== undefined ? updates.Section : updates.section;
    const nextLevel = nextLevelRaw !== undefined ? String(nextLevelRaw || '').trim() : currentLevel;
    const nextSection = nextSectionRaw !== undefined ? String(nextSectionRaw || '').trim() : currentSection;
    const classChanged = nextLevel !== currentLevel || nextSection !== currentSection;

    if (lockIdentity) {
      const iFirst = headers.indexOf('FirstName');
      const iLast = headers.indexOf('LastName');
      const currentFirst = iFirst !== -1 ? String(data[rowIdx][iFirst] || '').trim() : '';
      const currentLast = iLast !== -1 ? String(data[rowIdx][iLast] || '').trim() : '';
      const currentCode = String(data[rowIdx][iCode] || '').trim();

      const idCandidates = [updates.StudentCode, updates.StudentID, updates.id, updates.studentId]
        .filter(v => v !== undefined);
      const hasIdEditIntent = idCandidates.some(v => String(v).trim() !== currentCode);
      const hasNameEditIntent = updates.FirstName !== undefined || updates.LastName !== undefined || updates.firstName !== undefined || updates.lastName !== undefined;
      const nextFirst = updates.FirstName !== undefined ? String(updates.FirstName || '').trim()
        : (updates.firstName !== undefined ? String(updates.firstName || '').trim() : currentFirst);
      const nextLast = updates.LastName !== undefined ? String(updates.LastName || '').trim()
        : (updates.lastName !== undefined ? String(updates.lastName || '').trim() : currentLast);

      if (hasIdEditIntent || (hasNameEditIntent && (nextFirst !== currentFirst || nextLast !== currentLast))) {
        return {
          success:false,
          error:'Modification du nom et de l\'identifiant élève interdite lorsque SYSTEM_ID_MODE est COMPANY/AUTO.'
        };
      }
    }

    // PERF FIX: build the full updated row once and write it in a single
    // setValues() call instead of one setValue() per column. Each setValue()
    // is a separate Sheets API round-trip.
    const updatedStudentRow = data[rowIdx].slice();
    const blockedHeaders = { StudentCode:true, StudentID:true, CreatedAt:true };
    if (lockIdentity) {
      blockedHeaders.FirstName = true;
      blockedHeaders.LastName = true;
    }
    headers.forEach((h, col) => {
      if (updates[h] !== undefined && !blockedHeaders[h])
        updatedStudentRow[col] = updates[h];
    });
    const iUpdated = headers.indexOf('UpdatedAt');
    if (iUpdated !== -1) updatedStudentRow[iUpdated] = new Date();
    if (updates.CustomFields && typeof updates.CustomFields === 'object') {
      const iCF = headers.indexOf('CustomFields');
      if (iCF !== -1) {
        let existing = {};
        try { existing = JSON.parse(data[rowIdx][iCF] || '{}'); } catch(e) {}
        Object.assign(existing, updates.CustomFields);
        updatedStudentRow[iCF] = JSON.stringify(existing);
      }
    }
    sh.getRange(rowIdx + 1, 1, 1, updatedStudentRow.length).setValues([updatedStudentRow]);

    if (classChanged) {
      const shHist = ss.getSheetByName('studenthistory');
      if (shHist && shHist.getLastRow() >= 1) {
        const hData = shHist.getDataRange().getValues();
        const hH = hData[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
        const iHid = hH.indexOf('HISTORYID');
        const iSid = hH.indexOf('STUDENTID');
        const iYr = hH.indexOf('SCHOOLYEAR');
        const iLvl = hH.indexOf('GRADELEVELID');
        const iSec = hH.indexOf('SECTION');
        const iStat = hH.indexOf('STATUS');
        const iUpdHist = hH.indexOf('UPDATEDAT');

        let activeRow = -1;
        for (let i = hData.length - 1; i >= 1; i--) {
          const sameStudent = String(hData[i][iSid] || '').trim() === String(studentId).trim();
          const isActive = String(hData[i][iStat] || '').toUpperCase() === 'ACTIVE';
          if (sameStudent && isActive) { activeRow = i; break; }
        }

        if (activeRow !== -1) {
          // PERF FIX: batch history row updates into one setValues() call.
          const updatedHistRow = hData[activeRow].slice();
          if (iLvl !== -1 && nextLevelRaw !== undefined) updatedHistRow[iLvl] = nextLevel;
          if (iSec !== -1 && nextSectionRaw !== undefined) updatedHistRow[iSec] = nextSection;
          if (iUpdHist !== -1) updatedHistRow[iUpdHist] = new Date();
          shHist.getRange(activeRow + 1, 1, 1, updatedHistRow.length).setValues([updatedHistRow]);
        } else {
          const currentYear = getActiveAcademicYear_();
          const histID = 'HIS-' + Utilities.getUuid().substring(0,8);
          const histRow = hH.map(hdr => {
            switch(hdr) {
              case 'HISTORYID': return histID;
              case 'STUDENTID': return studentId;
              case 'SCHOOLYEAR': return currentYear;
              case 'GRADELEVELID': return nextLevel || 'N/A';
              case 'SECTION': return nextSection || 'A';
              case 'STATUS': return 'ACTIVE';
              case 'TIMESTAMP':
              case 'UPDATEDAT': return new Date();
              default: return '';
            }
          });
          shHist.appendRow(histRow);
        }

        CacheService.getScriptCache().remove('ACTIVE_HISTORY_CACHE_' + ss.getId());
      }
    }

    writeAuditLog_('UPDATE_STUDENT', studentId, Object.keys(updates).join(','), 'p_dossier');
    return { success:true, message:'Dossier mis a jour: ' + studentId };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

function searchStudents_(query, auth) {
  const students = getAllStudents_(auth);
  const term = String(query||'').toLowerCase().trim();
  if (!term) return { success:true, data:students };
  return { success:true, data: students.filter(s =>
    String(s.FirstName||'').toLowerCase().includes(term) ||
    String(s.LastName||'').toLowerCase().includes(term) ||
    String(s.StudentCode||'').toLowerCase().includes(term) ||
    String(s.NISU||'').toLowerCase().includes(term)
  )};
}

// [F8] isCurrent flag added to each row
function getStudentHistory_(studentId, auth) {
  try {
    const cleanId = typeof studentId === 'object' ? studentId.id : studentId;
    if (!cleanId) return [];
    const guard = ensureViewerCanAccessStudentScope_(cleanId, auth);
    if (!guard.success) return { success:false, error:guard.error };
    const ss   = getSS_();
    const sh   = ss.getSheetByName('studenthistory');
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iId  = h.indexOf('STUDENTID');
    const iYr  = h.indexOf('SCHOOLYEAR');
    const iLvl = h.indexOf('GRADELEVELID');
    const iSec = h.indexOf('SECTION');
    const iSt  = h.indexOf('STATUS');
    const iHid = h.indexOf('HISTORYID');
    const iDr  = h.indexOf('DROPREASON');
    const iDd  = h.indexOf('DROPDATE');
    if (iId === -1) return [];
    return data.slice(1)
      .filter(r => String(r[iId]).trim() === String(cleanId).trim())
      .map(r => ({
        historyId:  iHid !== -1 ? r[iHid] : '',
        year:       r[iYr] || '',
        level:      r[iLvl] || '',
        section:    iSec !== -1 ? r[iSec] : '',
        status:     iSt  !== -1 ? r[iSt]  : '',
        dropReason: iDr  !== -1 ? r[iDr]  : '',
        dropDate:   iDd  !== -1 ? r[iDd]  : '',
        isCurrent:  iSt  !== -1 ? String(r[iSt]).toUpperCase() === 'ACTIVE' : false
      }))
      .sort((a,b) => b.year.localeCompare(a.year));
  } catch(e) { return { success:false, error:e.message }; }
}

function lookupStudentGlobal_(studentId, auth) {
  try {
    const target = String(studentId || '').trim().toUpperCase();
    if (!target) return { success:false, found:false, message:'Identifiant manquant.' };

    const normalizeLegacyId_ = (value) => String(value || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    const buildLegacyCandidates_ = (value) => {
      const base = String(value || '').toUpperCase().trim();
      const compact = normalizeLegacyId_(base);
      const set = {};
      [base, compact].forEach(v => { if (v) set[v] = true; });
      if (/^MT[0-9]+$/.test(compact)) set['MT-' + compact.slice(2)] = true;
      if (/^MT-[0-9]+$/.test(base)) set[base.replace('-', '')] = true;
      return Object.keys(set);
    };

    const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
    const candidates = buildLegacyCandidates_(target);
    const cacheKey = 'LOOKUP_ID_' + ssId + '_' + candidates.map(normalizeLegacyId_).join('|');
    const cachedLookup = _safeCacheGetData_(cacheKey);
    if (cachedLookup) {
      if (cachedLookup.success && cachedLookup.found && cachedLookup.student && cachedLookup.student.Student_ID && auth && auth.token) {
        const guardCached = ensureViewerCanAccessStudentScope_(cachedLookup.student.Student_ID, auth);
        if (!guardCached.success) return { success:false, found:false, message:guardCached.error || 'Accès refusé.' };
      }
      return cachedLookup;
    }

    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const sh = master.getSheetByName('Generated_IDs');
    if (!sh) return { success:false, found:false, message:'Generated_IDs introuvable.' };

    const data = sh.getDataRange().getValues();
    const h = data[0].map(x => String(x).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s/g, ''));
    const iId = h.indexOf('ID');
    const iFn = h.indexOf('PRENOM');
    const iLn = h.indexOf('NOM');
    const iPhoto = h.indexOf('PHOTOURL');
    const iOrg = h.indexOf('ORGID');
    const iStatus = h.indexOf('STATUS');
    if (iId === -1) return { success:false, found:false, message:'Colonne ID manquante.' };

    const normalizedCandidates = candidates.map(normalizeLegacyId_).filter(Boolean);
    const row = data.slice(1).find(r => normalizedCandidates.indexOf(normalizeLegacyId_(r[iId])) !== -1);
    if (!row) {
      const miss = { success:false, found:false, message:'Identifiant non certifie pour cet etablissement.' };
      _safeCachePut(cacheKey, JSON.stringify(miss), 120);
      return miss;
    }

    const currentOrgId = String(getOrgId_() || '').trim();
    const rowOrgId = iOrg !== -1 ? String(row[iOrg] || '').trim() : '';
    if (rowOrgId && currentOrgId && currentOrgId !== 'UNKNOWN_ORG' && rowOrgId !== currentOrgId) {
      const denied = {
        success:false,
        found:false,
        denied:true,
        message:'Ce matricule appartient a un autre etablissement.'
      };
      _safeCachePut(cacheKey, JSON.stringify(denied), 120);
      return denied;
    }

    if (iStatus !== -1) {
      const status = String(row[iStatus] || '').trim().toUpperCase();
      if (status && /INACTIF|INACTIVE|SUSPENDU|SUSPENDED|BLOCKED|BLOQUE|DISABLED|FALSE|ARCHIVED/.test(status)) {
        const inactive = { success:false, found:false, message:'Ce matricule n\'est plus actif.' };
        _safeCachePut(cacheKey, JSON.stringify(inactive), 120);
        return inactive;
      }
    }

    let photo = iPhoto !== -1 ? String(row[iPhoto]).trim() : '';
    if (photo.includes('drive.google.com')) {
      const m = photo.match(/id=([a-zA-Z0-9_-]+)/) || photo.match(/\/d\/([a-zA-Z0-9_-]+)\//);
      if (m) photo = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400';
    }

    const firstName = iFn !== -1 ? String(row[iFn] || '').trim() : '';
    const lastName = iLn !== -1 ? String(row[iLn] || '').trim() : '';
    const matchedId = String(row[iId] || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const ok = {
      success:true,
      found:true,
      belongsToSchool:true,
      student:{
        Student_ID: matchedId,
        Student_Name: fullName.toUpperCase(),
        Picture_URL: photo || '',
        ORG_ID: rowOrgId
      },
      data:{
        StudentCode: matchedId,
        FirstName: firstName,
        LastName: lastName,
        PhotoURL: photo,
        OrgId: rowOrgId
      }
    };
    if (auth && auth.token) {
      const guard = ensureViewerCanAccessStudentScope_(ok.student.Student_ID, auth);
      if (!guard.success) return { success:false, found:false, message:guard.error || 'Accès refusé.' };
    }
    _safeCachePut(cacheKey, JSON.stringify(ok), 600);
    return ok;
  } catch(e) { return { success:false, found:false, message:e.message }; }
}

function verifyStudentByLast4_(query) {
  try {
    const term = String(query || '').toLowerCase().trim();
    if (!term) return { found:false };

    const ss   = getSS_();
    const cacheKey = 'VERIFY_INDEX_' + ss.getId();
    let rows = _safeCacheGetData_(cacheKey);

    if (!rows || !Array.isArray(rows)) {
      const sh = ss.getSheetByName('students');
      if (!sh) return { found:false };
      const data = sh.getDataRange().getValues();
      const h    = data[0].map(x => String(x).trim().toUpperCase());
      const iCode= h.indexOf('STUDENTCODE');
      const iFn  = h.indexOf('FIRSTNAME');
      const iLn  = h.indexOf('LASTNAME');
      const iPic = h.indexOf('PHOTOURL');
      const iLvl = h.indexOf('CURRENTLEVEL');
      const iNisu= h.indexOf('NISU');

      rows = data.slice(1).map(r => {
        let photo = iPic !== -1 ? String(r[iPic]).trim() : '';
        if (photo.includes('drive.google.com')) {
          const m = photo.match(/id=([a-zA-Z0-9_-]+)/) || photo.match(/\/d\/([a-zA-Z0-9_-]+)\//);
          if (m) photo = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400';
        }
        return {
          code: String(r[iCode] || ''),
          fn: String(r[iFn] || ''),
          ln: String(r[iLn] || ''),
          nisu: iNisu !== -1 ? String(r[iNisu] || '') : '',
          lvl: iLvl !== -1 ? r[iLvl] : '',
          photo: photo
        };
      });
      _safeCachePut(cacheKey, JSON.stringify(rows), 180);
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const code = String(r.code || '').toLowerCase();
      const fn = String(r.fn || '').toLowerCase();
      const ln = String(r.ln || '').toLowerCase();
      const niso = String(r.nisu || '').toLowerCase();
      if (code.includes(term) || fn.includes(term) || ln.includes(term) || (niso && niso.includes(term))) {
        return { found:true, student:{ Student_ID:r.code, Student_Name:(r.fn + ' ' + r.ln).toUpperCase(), Picture_URL:r.photo || '', CurrentLevel:r.lvl || '' }};
      }
    }
    return { found:false };
  } catch(e) { return { found:false, error:e.message }; }
}

function getStudentFieldsConfig_() {
  const SYSTEM_FIELDS = [
    { id:'StudentCode',      label:'Code Eleve',       type:'text',    isSystem:true },
    { id:'FirstName',        label:'Prenom',           type:'text',    isSystem:true },
    { id:'LastName',         label:'Nom',              type:'text',    isSystem:true },
    { id:'Phone',            label:'Telephone',        type:'tel',     isSystem:true },
    { id:'PhotoURL',         label:'Photo',            type:'text',    isSystem:true },
    { id:'CurrentLevel',     label:'Classe',           type:'select',  isSystem:true },
    { id:'Gender',           label:'Sexe',             type:'select',  options:['Masculin','Féminin'], isSystem:true },
    { id:'Address',          label:'Adresse',          type:'text',    isSystem:true },
    { id:'BirthDate',        label:'Date de naissance',type:'date',    isSystem:true },
    { id:'EnrollmentStatus', label:'Statut',           type:'text',    isSystem:true },
    { id:'Active',           label:'Actif',            type:'text',    isSystem:true }
  ];
  const LOCKED = new Set([
    'StudentCode', 'FirstName', 'LastName', 'Phone', 'PhotoURL',
    'CurrentLevel', 'Gender', 'Address', 'BirthDate', 'EnrollmentStatus', 'Active'
  ]);
  const inferType_ = function(fieldId) {
    const key = String(fieldId || '').toUpperCase();
    if (key.indexOf('DATE') !== -1 || key === 'BIRTHDATE') return 'date';
    if (key.indexOf('EMAIL') !== -1) return 'email';
    if (key.indexOf('PHONE') !== -1 || key.indexOf('TEL') !== -1) return 'tel';
    return 'text';
  };
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('students');
    const headers = sh && sh.getLastRow() >= 1
      ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function(x) { return String(x || '').trim(); }).filter(Boolean)
      : [];

    const scriptProps = PropertiesService.getScriptProperties();
    const docProps = PropertiesService.getDocumentProperties();
    const savedRaw = scriptProps.getProperty('STUDENT_FORM_CONFIG')
      || scriptProps.getProperty('STUDENT_FIELDS_CONFIG')
      || docProps.getProperty('STUDENT_FORM_CONFIG')
      || '[]';
    const saved = JSON.parse(savedRaw);
    const getSavedById_ = function(fieldId) {
      return (saved || []).find(function(x) {
        const sid = String((x && (x.id || x.key)) || '').trim();
        return sid === fieldId;
      });
    };

    const fields = SYSTEM_FIELDS.map(function(sys) {
      const s = getSavedById_(sys.id);
      return Object.assign({}, sys, {
        key: sys.id,
        enabled:  LOCKED.has(sys.id) ? true  : (s ? s.enabled  : true),
        required: LOCKED.has(sys.id) ? true  : (s ? s.required : false),
        isLocked: LOCKED.has(sys.id)
      });
    });

    headers.forEach(function(h) {
      if (!h) return;
      if (fields.some(function(f) { return f.id === h; })) return;
      const s = getSavedById_(h);
      fields.push({
        id: h,
        key: h,
        label: (s && s.label) ? s.label : h,
        type: (s && s.type) ? s.type : inferType_(h),
        enabled: s && s.enabled !== undefined ? !!s.enabled : true,
        required: s && s.required !== undefined ? !!s.required : false,
        isSystem: false,
        isLocked: false
      });
    });

    (saved || []).forEach(function(s) {
      const sid = String((s && (s.id || s.key)) || '').trim();
      if (!sid) return;
      if (fields.some(function(f) { return f.id === sid; })) return;
      fields.push({
        id: sid,
        key: sid,
        label: String(s.label || sid),
        type: String(s.type || inferType_(sid)),
        enabled: s.enabled !== undefined ? !!s.enabled : true,
        required: s.required !== undefined ? !!s.required : false,
        isSystem: false,
        isLocked: false
      });
    });

    return { success:true, data: fields, fields: fields };
  } catch(e) { return { success:false, error:e.message }; }
}

function addInternalNote_(data, auth) {
  try {
    const viewer  = getViewerInfo_(auth);
    const studentId = data && (data.studentId || data.id) ? String(data.studentId || data.id).trim() : '';
    if (studentId) {
      const guard = ensureViewerCanAccessStudentScope_(studentId, viewer);
      if (!guard.success) return { success:false, error:guard.error };
    }
    const ss      = getSS_();
    const sh      = ss.getSheetByName('internal_notes');
    const noteId  = 'NOTE-' + Utilities.getUuid().substring(0,8);
    const meta    = { visibility: data.visibility || 'Admin', historyId: data.historyId || '' };
    sh.appendRow([noteId, studentId, data.content||'', viewer.email||'System', viewer.role||'Admin', new Date(), JSON.stringify(meta)]);
    return { success:true, noteId };
  } catch(e) { return { success:false, error:e.message }; }
}

function getInternalNotes_(params, auth) {
  try {
    const studentId = params && (params.studentId || params.id) ? (params.studentId||params.id) : null;
    if (studentId) {
      const guard = ensureViewerCanAccessStudentScope_(studentId, auth);
      if (!guard.success) return { success:false, error:guard.error };
    }
    const ss   = getSS_();
    const sh   = ss.getSheetByName('internal_notes');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:[] };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    let rows   = data.slice(1);
    if (studentId) {
      const iSid = h.indexOf('StudentID');
      rows = rows.filter(r => String(r[iSid]).trim() === String(studentId).trim());
    }
    return { success:true, data: rows.map(r => {
      const obj = {};
      h.forEach((k,i) => obj[k] = r[i]);
      if (typeof obj.MetaJSON === 'string') { try { obj.MetaJSON = JSON.parse(obj.MetaJSON); } catch(e) {} }
      return obj;
    })};
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// ENROLLMENT MANAGEMENT (blueprint N1-N5)
// ============================================================

// ── [N4] getActiveEnrollment_ ────────────────────────────────
/**
 * Returns the active enrollment for a student by checking
 * whether their LATEST history row is ACTIVE.
 */
function getActiveEnrollment_(studentId) {
  try {
    if (!studentId) return { success: false, error: 'studentId manquant.' };
    const ss = getSS_();
    const sh = ss.getSheetByName('studenthistory');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: null };
 
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iHid  = h.indexOf('HISTORYID');
    const iSid  = h.indexOf('STUDENTID');
    const iYr   = h.indexOf('SCHOOLYEAR');
    const iLvl  = h.indexOf('GRADELEVELID');
    const iSec  = h.indexOf('SECTION');
    const iStat = h.indexOf('STATUS');
 
    const latest = _getLatestHistoryRow_(data, h, studentId);
    if (!latest || String(latest[iStat]).toUpperCase() !== 'ACTIVE') {
      return { success: true, data: null };
    }
 
    return {
      success: true,
      data: {
        historyId:  latest[iHid],
        schoolYear: latest[iYr],
        gradeLevel: latest[iLvl],
        section:    latest[iSec],
        status:     latest[iStat]
      }
    };
  } catch(e) { return { success: false, error: e.message }; }
}
/**
 * Internal enrollment function without lock (for use when lock is already held)
 * @private
 */
function _enrollStudentInternal_(payload, ss, logFn) {
  const log = logFn || function(msg) { Logger.log(msg); };
  try {
    const studentId = payload.studentId;
    if (!studentId) throw new Error('studentId manquant.');

    const ssToUse = ss || getSS_();

    // Safely resolve academic year — getSaaSSettings_() can return {success:false}
    // when called under a lock (cold cache), which would make .data undefined and crash.
    let year = payload.schoolYear || '';
    if (!year) {
      try {
        const sr = getSaaSSettings_();
        if (sr && sr.success && sr.data) year = String(sr.data.ACADEMIC_YEAR || '').trim();
      } catch(e) {
        log('[ENROLL_WARN] getSaaSSettings_ failed: ' + e.message);
      }
    }
    if (!year) year = getActiveAcademicYear_();
    if (!year || year === 'ANNEE_NON_CONFIGUREE')
      throw new Error('Annee scolaire non configuree. Definissez ACADEMIC_YEAR dans Parametres.');

    const shH = ssToUse.getSheetByName('studenthistory');
    if (!shH) {
      log('[ENROLL_ERROR] studenthistory sheet not found!');
      throw new Error('studenthistory sheet not found');
    }

    // A sheet with only a header row is valid — do NOT throw, just skip duplicate check
    if (shH.getLastRow() < 1) {
      log('[ENROLL_ERROR] studenthistory sheet has no headers!');
      throw new Error('studenthistory sheet has no headers');
    }

    const hData = shH.getDataRange().getValues();
    const hH    = hData[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    log('[ENROLL_DEBUG] History headers: ' + JSON.stringify(hH));

    // Only check for duplicates when data rows actually exist
    if (hData.length > 1) {
      const latest = _getLatestHistoryRow_(hData, hH, studentId);
      if (latest) {
        const iStat = hH.indexOf('STATUS');
        const iYr   = hH.indexOf('SCHOOLYEAR');
        if (String(latest[iStat]).toUpperCase() === 'ACTIVE') {
          return {
            success: false,
            error: 'Cet eleve est deja inscrit pour '
              + (iYr !== -1 ? latest[iYr] : 'l\'annee en cours')
              + '. Utilisez reEnrollStudent_ ou dropStudent_ d\'abord.'
          };
        }
      }
    }

    const histID = 'HIS-' + Utilities.getUuid().substring(0,8);
    const newRow = hData[0].map(hdr => {
      const normalized = hdr.toUpperCase().replace(/\s/g,'');
      switch(normalized) {
        case 'HISTORYID':    return histID;
        case 'STUDENTID':    return studentId;
        case 'SCHOOLYEAR':   return year;
        case 'GRADELEVELID': return payload.gradeLevelId || payload.level || 'N/A';
        case 'SECTION':      return payload.section || 'A';
        case 'STATUS':       return 'ACTIVE';
        case 'TIMESTAMP':
        case 'UPDATEDAT':    return new Date();
        default:             return '';
      }
    });

    log('[ENROLL_DEBUG] Appending row for ' + studentId + ': ' + JSON.stringify(newRow));
    shH.appendRow(newRow);
    log('[ENROLL] Student ' + studentId + ' enrolled for ' + year + ' at level ' + (payload.gradeLevelId || payload.level || 'N/A'));

    writeAuditLog_('ENROLL_STUDENT', studentId,
      'year:' + year + ' level:' + (payload.gradeLevelId || 'N/A'), 'p_dossier');
    return {
      success: true,
      historyId: histID,
      message: 'Inscription creee pour ' + studentId + ' — ' + year
    };
  } catch(e) {
    log('[ENROLL_ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function enrollStudent_(payload, auth) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    return _enrollStudentInternal_(payload, null, null);
  } catch(e) { return { success: false, error: e.message }; }
  finally { lock.releaseLock(); }
}

// ── [N2] dropStudent_ ────────────────────────────────────────
/**
 * Appends a new DROPPED row copying the student's current
 * enrollment data.  The original ACTIVE row is NEVER touched.
 */
function dropStudent_(payload, auth) {
  try {
    const studentId = payload.studentId;
    if (!studentId) throw new Error('studentId manquant.');
 
    const ss  = getSS_();
    const shH = ss.getSheetByName('studenthistory');
    if (!shH) throw new Error('studenthistory introuvable.');
 
    const data = shH.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iHid  = h.indexOf('HISTORYID');
    const iSid  = h.indexOf('STUDENTID');
    const iStat = h.indexOf('STATUS');
    const iDr   = h.indexOf('DROPREASON');
    const iDd   = h.indexOf('DROPDATE');
    const iUpd  = h.indexOf('UPDATEDAT');
    const iTs   = h.indexOf('TIMESTAMP');
 
    // Current state must be ACTIVE
    const latest = _getLatestHistoryRow_(data, h, studentId);
    if (!latest || String(latest[iStat]).toUpperCase() !== 'ACTIVE') {
      return { success: false, error: 'Aucun historique ACTIVE trouve pour ' + studentId };
    }
 
    // Clone the latest row and stamp the new state — DO NOT touch the original
    const newRow = latest.slice();                                 // shallow copy
    if (iHid  !== -1) newRow[iHid]  = 'HIS-' + Utilities.getUuid().substring(0,8);
    if (iStat !== -1) newRow[iStat] = 'DROPPED';
    if (iDr   !== -1) newRow[iDr]   = payload.dropReason || '';
    if (iDd   !== -1) newRow[iDd]   = payload.dropDate   || new Date();
    if (iUpd  !== -1) newRow[iUpd]  = new Date();
    if (iTs   !== -1) newRow[iTs]   = new Date();
 
    shH.appendRow(newRow);   // ← append only, nothing mutated above
 
    writeAuditLog_('DROP_STUDENT', studentId, payload.dropReason || 'N/A', 'p_dossier');
    return { success: true, message: 'Eleve marque comme DROPPED: ' + studentId };
  } catch(e) { return { success: false, error: e.message }; }
}
// ── [N3] reEnrollStudent_ ────────────────────────────────────
/**
 * Re-enrolls a student whose LATEST row is DROPPED or ALUMNI.
 * Rejects if the latest row is already ACTIVE.
 * Always delegates to enrollStudent_ which appends a fresh row.
 */
function reEnrollStudent_(payload, auth) {
  try {
    const studentId = payload.studentId;
    if (!studentId) throw new Error('studentId manquant.');
 
    const ss    = getSS_();
    const shH   = ss.getSheetByName('studenthistory');
    if (!shH) throw new Error('studenthistory introuvable.');
 
    const data = shH.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
 
    // Confirm identity exists
    const shS   = ss.getSheetByName('students');
    const sData = shS ? shS.getDataRange().getValues() : [];
    const sH    = sData.length ? sData[0].map(x => String(x).trim()) : [];
    const iCode = sH.indexOf('StudentCode');
    const exists = iCode !== -1 &&
      sData.slice(1).some(r => String(r[iCode]).trim() === studentId);
    if (!exists) return { success: false, error: 'Identite eleve introuvable: ' + studentId };
 
    // Check latest row — must NOT be ACTIVE
    const latest = _getLatestHistoryRow_(data, h, studentId);
    if (latest) {
      const iStat = h.indexOf('STATUS');
      if (String(latest[iStat]).toUpperCase() === 'ACTIVE') {
        return {
          success: false,
          error: 'L\'eleve est deja ACTIVE. Utilisez dropStudent_ avant de re-inscrire.'
        };
      }
    }
 
    // Delegate — enrollStudent_ will append a new ACTIVE row
    return enrollStudent_(payload, auth);
  } catch(e) { return { success: false, error: e.message }; }
}
/**
 * [N5] updateStudentHistory_
 * Patch a specific history row (e.g. change section, fix level).
 * Cannot change StudentID or HistoryID.
 * payload: { historyId, section?, gradeLevelId?, status? }
 */
function getSubjectMaxScore_(subjectId, historyId, ss) {
  try {
    // Get history to get level
    const shHist = ss.getSheetByName('studenthistory');
    const hData = shHist.getDataRange().getValues();
    const hH = hData[0];
    const iId = hH.indexOf('HistoryID');
    const iLvl = hH.indexOf('GradeLevelID');
    let level = '';
    for (let i = 1; i < hData.length; i++) {
      if (String(hData[i][iId]).trim() === historyId) {
        level = String(hData[i][iLvl] || '').trim();
        break;
      }
    }
    if (!level) return 100; // default
    // Get curriculum
    const conf = getSaaSSettings_().data;
    const currKey = 'CURRICULUM_' + level.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const curriculum = conf[currKey];
    if (!curriculum) return 100;
    for (let subj of curriculum) {
      if (subj.subjectId === subjectId) {
        var coef = Number(subj.coef);
        return (isFinite(coef) && coef > 0) ? coef : 100;
      }
    }
    return 100;
  } catch(e) {
    return 100;
  }
}

function updateStudentHistory_(payload, auth) {
  try {
    if (!payload.historyId) throw new Error('historyId manquant.');
    const ss   = getSS_();
    const shH  = ss.getSheetByName('studenthistory');
    if (!shH) throw new Error('studenthistory introuvable.');
    const data = shH.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iHid  = h.indexOf('HISTORYID');
    const iSec  = h.indexOf('SECTION');
    const iLvl  = h.indexOf('GRADELEVELID');
    const iStat = h.indexOf('STATUS');
    const iUpd  = h.indexOf('UPDATEDAT');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iHid]).trim() === String(payload.historyId).trim()) {
        // PERF FIX: batch all field updates into one setValues() call.
        const updHRow = data[i].slice();
        if (payload.section    !== undefined && iSec  !== -1) updHRow[iSec]  = payload.section;
        if (payload.gradeLevelId !== undefined && iLvl !== -1) updHRow[iLvl] = payload.gradeLevelId;
        if (payload.status !== undefined && iStat !== -1) updHRow[iStat] = payload.status;
        if (iUpd !== -1) updHRow[iUpd] = new Date();
        shH.getRange(i + 1, 1, 1, updHRow.length).setValues([updHRow]);
        writeAuditLog_('UPDATE_HISTORY', payload.historyId,
          JSON.stringify({ section:payload.section, level:payload.gradeLevelId }), 'p_dossier');
        return { success:true, message:'Historique mis a jour: ' + payload.historyId };
      }
    }
    return { success:false, error:'HistoryID introuvable: ' + payload.historyId };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// GRADES
// ============================================================
function _clearStudentGradesCache(studentId, ssId) {
  const cacheKey = 'STUDENT_GRADES_' + studentId.toUpperCase() + '_' + ssId;
  CacheService.getScriptCache().remove(cacheKey);
  // Invalider aussi le cache des rapports comparatifs : tout changement de
  // note/présence doit se refléter immédiatement dans le dashboard.
  _bumpClassComparisonCacheVersion_();
}

// Le cache de getClassComparisonData_ utilise des clés base64 non énumérables.
// Pour invalider sans connaître les clés, on publie un compteur de version
// que la fonction de lecture vérifie. Un changement de version invalide
// implicitement toutes les entrées sans avoir à les supprimer une par une.
function _bumpClassComparisonCacheVersion_(){
  try {
    CacheService.getScriptCache().put('CLASS_COMP_VERSION', String(Date.now()), 21600);
  } catch (e) { /* cache plein : la lecture utilisera la version manquante */ }
}
function _getClassComparisonCacheVersion_(){
  try { return String(CacheService.getScriptCache().get('CLASS_COMP_VERSION') || '0'); }
  catch (e) { return '0'; }
}

function _clearAllCachesForSpreadsheet(ssId) {
  const cache = CacheService.getScriptCache();
  try {
    // Clear curriculum cache
    cache.remove('CURRICULUM_CACHE_' + ssId);
    // Clear active history cache
    cache.remove('ACTIVE_HISTORY_CACHE_' + ssId);
    // Note: We can't easily clear all student grade caches for a spreadsheet
    // as we don't have a way to list all cache keys
  } catch(e) {
    // Cache clearing failed, continue
  }
}

function _getCacheInfo() {
  // Google Apps Script doesn't provide direct cache size/count APIs
  // But we can return basic info
  return {
    service: 'ScriptCache',
    maxSize: '100MB',
    maxKeys: '1000',
    maxTTL: '6 hours',
    currentTTL: '30 minutes for our caches'
  };
}

function checkCacheHealth_() {
  try {
    const cache = CacheService.getScriptCache();

    // Try to write a test entry to check if cache is accessible
    const testKey = 'CACHE_HEALTH_TEST_' + Date.now();
    const testValue = JSON.stringify({ test: true, timestamp: Date.now() });

    try {
      cache.put(testKey, testValue, 60); // 1 minute test
      const retrieved = cache.get(testKey);
      cache.remove(testKey); // Clean up test

      const isAccessible = (retrieved === testValue);
      const isFull = !isAccessible; // If we can't even put a small test value, cache is full

      if (isAccessible) {
        return {
          success: true,
          status: 'healthy',
          message: 'Cache is working normally',
          isAccessible: true,
          isFull: false
        };
      } else {
        return {
          success: false,
          status: 'degraded',
          message: 'Cache read/write test failed',
          isAccessible: false,
          isFull: true
        };
      }
    } catch(e) {
      return {
        success: false,
        status: 'full',
        message: 'Cache quota exceeded or unavailable',
        error: e.message,
        isAccessible: false,
        isFull: true
      };
    }
  } catch(e) {
    return {
      success: false,
      status: 'error',
      message: 'Unable to check cache health',
      error: e.message,
      isAccessible: false,
      isFull: true
    };
  }
}

function clearAllSchoolCaches_() {
  try {
    const cache = CacheService.getScriptCache();
    const ss = getSS_();
    const ssId = ss.getId();

    // Clear all cache entries for this school
    const keysToRemove = [
      'CURRICULUM_CACHE_' + ssId,
      'ACTIVE_HISTORY_CACHE_' + ssId
    ];

    // We can't list all keys, but we can try to remove known patterns
    // For student grades, we'll clear them as they're accessed
    keysToRemove.forEach(key => {
      try {
        cache.remove(key);
      } catch(e) {
        // Continue if some keys fail
      }
    });

    // Clear any remaining student grade caches by attempting to remove them
    // This is a best-effort cleanup
    try {
      // We can't enumerate all keys, but we can clear the health test
      cache.remove('CACHE_HEALTH_TEST_' + ssId);
    } catch(e) {}

    return { success: true, message: 'Cache cleared successfully' };
  } catch(e) {
    return { success: false, error: e.message, message: 'Failed to clear cache' };
  }
}

function saveManualExamGrade_(obj) {
  // Invalider l'instantané IA après enregistrement d'une note.
  try { _invalidateAiSystemSnapshot_(); } catch (_) {}
  try {
    const studentCode = obj.studentID || obj.studentCode;
    const historyId   = obj.historyId || '';
    const subjectId   = obj.examTitle || obj.subjectId || obj.examSlug;
    const periodId    = obj.periodId  || obj.period || 'T1';
    const rawScore    = (obj.grade !== undefined && obj.grade !== null && String(obj.grade).trim() !== '')
      ? obj.grade
      : obj.score;
    const score       = parseFloat(rawScore);
    if (!studentCode || !subjectId || isNaN(score))
      throw new Error('Données manquantes (studentCode, subjectId, score).');

    const ss  = getSS_();
    const rawMaxScore = getSubjectMaxScore_(subjectId, historyId, ss);
    const maxScoreNum = Number(rawMaxScore);
    const maxScore = (isFinite(maxScoreNum) && maxScoreNum > 0) ? maxScoreNum : 100;
    if (score > maxScore)
      throw new Error('La note ne peut pas dépasser ' + maxScore + ' pour cette matière.');

    const sh  = ss.getSheetByName('grades');
    const data= sh.getDataRange().getValues();
    const h   = data[0].map(x => String(x).trim());
    const iGid= h.indexOf('GradeID');
    const iHid= h.indexOf('HistoryID');
    const iSid= h.indexOf('StudentID');
    const iSub= h.indexOf('SubjectID');
    const iPer= h.indexOf('PeriodID');
    const iScr= h.indexOf('Score');
    const iJs = h.indexOf('ScoresJSON');
    const iTs = h.indexOf('Timestamp');
    const iUpd= h.indexOf('UpdatedAt');
    const iLvl= h.indexOf('GradeLevelID');
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      const matchSid  = String(data[i][iSid]).trim() === String(studentCode).trim();
      const matchSub  = String(data[i][iSub]).trim() === String(subjectId).trim();
      const matchHist = !historyId || String(data[i][iHid]).trim() === historyId;
      if (matchSid && matchSub && matchHist) { rowIdx = i; break; }
    }
    if (rowIdx !== -1) {
      // PERF FIX: batch the 3 separate setValue() calls (Score, ScoresJSON, UpdatedAt)
      // into one setValues() call. Each setValue() is a separate Sheets API round-trip.
      let sj = {};
      try { sj = JSON.parse(data[rowIdx][iJs] || '{}'); } catch(e) {}
      sj[periodId] = score;
      const updateMap = {};
      updateMap[iScr] = score;
      updateMap[iJs]  = JSON.stringify(sj);
      if (iUpd !== -1) updateMap[iUpd] = new Date();
      const updatedRow = data[rowIdx].slice();
      Object.keys(updateMap).forEach(function(col) { updatedRow[Number(col)] = updateMap[col]; });
      sh.getRange(rowIdx + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
    } else {
      let hid = historyId;
      if (!hid) {
        const histMap = _buildActiveHistoryMap(ss);
        const h2 = histMap[String(studentCode).toUpperCase().trim()];
        hid = h2 ? h2.historyId : '';
      }
      const gradeId = 'GRD-' + Utilities.getUuid().substring(0,8);
      const newRow  = h.map(col => {
        switch(col) {
          case 'GradeID':    return gradeId;
          case 'HistoryID':  return hid;
          case 'StudentID':  return studentCode;
          case 'SubjectID':  return subjectId;
          case 'PeriodID':   return periodId;
          case 'Score':      return score;
          case 'ScoresJSON': return JSON.stringify({ [periodId]: score });
          case 'Timestamp':
          case 'UpdatedAt':  return new Date();
          default:           return obj[col] !== undefined ? obj[col] : '';
        }
      });
      sh.appendRow(newRow);
    }
    writeAuditLog_('GRADE_ENTRY', studentCode, subjectId + ':' + periodId + ':' + score, 'p_manual');
    _clearStudentGradesCache(studentCode, ss.getId());
    return { success:true, message:'Note enregistrée.' };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

// [F4] historyId filter -- grades are now isolated per enrollment period
function getStudentScores_(studentCode, targetYear, historyId) {
  try {
    const ss = getSS_(targetYear || null);
    const sh = ss.getSheetByName('grades');
    if (!sh || sh.getLastRow() < 2) return [];
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const iSid = h.indexOf('StudentID');
    const iHid = h.indexOf('HistoryID');
    const iSub = h.indexOf('SubjectID');
    const iPer = h.indexOf('PeriodID');
    const iScr = h.indexOf('Score');
    const iJs  = h.indexOf('ScoresJSON');
    const bySubject = {};
    data.slice(1).forEach(r => {
      if (String(r[iSid]).trim() !== String(studentCode).trim()) return;
      // [F4] Filter by historyId when provided
      if (historyId && iHid !== -1 && String(r[iHid]).trim() !== String(historyId).trim()) return;
      const sub = String(r[iSub]).trim();
      if (!sub) return;
      if (!bySubject[sub]) bySubject[sub] = { Subject:sub, T1:'', T2:'', T3:'', T4:'', _all:[] };
      if (iJs !== -1 && r[iJs]) {
        let sj = {};
        try { sj = JSON.parse(r[iJs]); } catch(e) {}
        Object.keys(sj).forEach(p => {
          if (['T1','T2','T3','T4'].includes(p)) bySubject[sub][p] = sj[p];
          bySubject[sub]._all.push(sj[p]);
        });
      } else {
        const per   = String(r[iPer]).toUpperCase();
        const score = parseFloat(r[iScr]);
        if (!isNaN(score)) {
          if (['T1','T2','T3','T4'].some(t => per.includes(t.slice(1)))) {
            const key = per.startsWith('T') ? per : 'T' + per.replace(/\D/g,'');
            if (['T1','T2','T3','T4'].includes(key)) bySubject[sub][key] = score;
          } else bySubject[sub].T1 = score;
          bySubject[sub]._all.push(score);
        }
      }
    });
    return Object.values(bySubject).map(item => {
      const vals = item._all.filter(v => !isNaN(parseFloat(v)));
      item.Score = vals.length ? parseFloat((vals.reduce((a,b)=>a+parseFloat(b),0)/vals.length).toFixed(2)) : 0;
      delete item._all;
      return item;
    });
  } catch(e) { return []; }
}

function getGrades_(params, auth) {
  try {
    const p = (params && typeof params === 'object') ? params : {};
    const targetYear = String(p.targetYear || p.year || '').trim();
    const sidFilter = String(p.studentId || p.id || p.studentCode || '').trim();
    const hidFilter = String(p.historyId || '').trim();

    const ss = getSS_(targetYear || null);
    const sh = ss.getSheetByName('grades');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:[] };

    const viewer = auth ? getViewerInfo_(auth) : null;
    let allowedSet = null;
    if (viewer && viewer.success && !viewer.isMaster && !viewer.isGodMode) {
      const scopedStudents = filterStudentsByViewerScope_(getAllStudents_(), viewer);
      const allowedIds = scopedStudents
        .map(function(s){
          return String(s.StudentCode || s.studentCode || s.StudentID || s.studentId || s.id || '').trim();
        })
        .filter(function(v){ return !!v; });
      allowedSet = new Set(allowedIds);
    }

    const data = sh.getDataRange().getValues();
    const headers = data[0].map(function(x){ return String(x).trim(); });
    const tz = Session.getScriptTimeZone();

    const rows = data.slice(1).filter(function(r){
      const obj = {};
      headers.forEach(function(k, i){ obj[k] = r[i]; });
      const sid = String(obj.StudentID || obj.studentId || obj.StudentCode || '').trim();
      const hid = String(obj.HistoryID || '').trim();

      if (sidFilter && sid !== sidFilter) return false;
      if (hidFilter && hid !== hidFilter) return false;
      if (allowedSet && sid && !allowedSet.has(sid)) return false;
      return true;
    }).map(function(r){
      const obj = {};
      headers.forEach(function(k, i){
        obj[k] = r[i] instanceof Date ? Utilities.formatDate(r[i], tz, 'yyyy-MM-dd') : r[i];
      });
      if (typeof obj.ScoresJSON === 'string' && obj.ScoresJSON.trim()) {
        try { obj.ScoresJSON = JSON.parse(obj.ScoresJSON); } catch(e) {}
      }
      return obj;
    });

    return { success:true, data:rows };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

function getExistingGrade_(studentCode, examTitle) {
  try {
    const ss   = getSS_();
    const sh   = ss.getSheetByName('grades');
    if (!sh) return { found:false };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const iSid = h.indexOf('StudentID');
    const iSub = h.indexOf('SubjectID');
    const iScr = h.indexOf('Score');
    const iJs  = h.indexOf('ScoresJSON');
    const row  = data.slice(1).find(r =>
      String(r[iSid]).trim() === String(studentCode).trim() &&
      String(r[iSub]).trim() === String(examTitle).trim()
    );
    if (!row) return { found:false };
    let grades = { found:true, grade: row[iScr] };
    if (iJs !== -1 && row[iJs]) {
      try { grades.scoresJson = JSON.parse(row[iJs]); } catch(e) {}
    }
    return grades;
  } catch(e) { return { found:false, error:e.message }; }
}

function getAvailableExams_() {
  try {
    const ss   = getSS_();
    const sh   = ss.getSheetByName('grades');
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const iSub = h.indexOf('SubjectID');
    const subjects = [...new Set(data.slice(1).map(r => String(r[iSub]).trim()).filter(x => x))];
    return subjects.map(t => ({ title:t }));
  } catch(e) { return []; }
}

function updateGradeSubjects_(data) {
  try { syncSubjectsInSettings_(getSS_(), data); return { success:true }; }
  catch(e) { return { success:false, error:e.message }; }
}

function addQuizQuestion_(q) {
  try {
    const ss = getSS_();
    let sh   = ss.getSheetByName('Exam_Questions');
    if (!sh) {
      sh = ss.insertSheet('Exam_Questions');
      sh.appendRow(['ExamTitle','Question','OptionA','OptionB','OptionC','OptionD','CorrectAnswer','Commentary','MediaType','MediaUrl','Points','Type']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([q.exam, q.text, q.options[0]||'', q.options[1]||'', q.options[2]||'', q.options[3]||'', q.correct,'','','', q.points, q.type]);
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function getQuizQuestions_(examTitle) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('Exam_Questions');
    if (!sh || !examTitle) return [];
    const data = sh.getDataRange().getValues();
    return data.slice(1).filter(r => String(r[0]).trim() === String(examTitle).trim())
      .map(r => ({ text:r[1], options:[r[2],r[3],r[4],r[5]].filter(x=>x!=''), correct:r[6], points:r[10]||5, type:r[11]||'mcq' }));
  } catch(e) { return []; }
}

function updateExamSettings_(payload) {
  return updateSaaSSettings_({ name:'EXAM_SETTINGS_' + (payload.ExamTitle||'').replace(/[^a-z0-9]/gi,'_'), value:payload }, null);
}

// ============================================================
// ATTENDANCE
// ============================================================
function _invalidateAttendanceDerivedCaches_(ssInput) {
  try {
    const ss = ssInput || getSS_();
    const cache = CacheService.getScriptCache();
    const ssId = ss.getId();
    cache.remove('STUDENT_ATTENDANCE_PCT_' + ssId);
    cache.remove('SCHOOL_INIT_CACHE_WARM_' + ssId);
  } catch (_e) {}
}

function recordStudentAttendance_(payload) {
  try {
    const ss        = getSS_();
    const term      = String(payload.shortCode || payload.studentCode || '').trim();
    const veri      = verifyStudentByLast4_(term);
    if (!veri.found) return { success:false, error:'Aucun eleve pour: ' + term };
    const studentId = veri.student.Student_ID;
    const name      = veri.student.Student_Name;
    const tz        = Session.getScriptTimeZone();
    const dateStr   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const timeStr   = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
    const sh        = ss.getSheetByName('attendance');
    if (!sh) throw new Error("Table 'attendance' introuvable.");
    const data    = sh.getDataRange().getValues();
    const h       = data[0].map(x => String(x).toUpperCase().trim());
    const iSid    = h.indexOf('STUDENTID');
    const iDate   = h.indexOf('DATE');
    for (let i = data.length-1; i >= 1; i--) {
      const rowDate = data[i][iDate] instanceof Date
        ? Utilities.formatDate(data[i][iDate], tz, 'yyyy-MM-dd')
        : String(data[i][iDate]);
      if (String(data[i][iSid]).trim() === studentId && rowDate === dateStr) {
        writeAuditLog_('ATTENDANCE_DUPLICATE', studentId, 'status:' + (payload.status||'PRESENT') + ',date:' + dateStr, 'p_attendance', true);
        return { success:false, alreadyScanned:true, studentName:name, message:name + ' déjà pointé aujourd\'hui.' };
      }
    }
    const histMap = _buildActiveHistoryMap(ss);
    const hist    = histMap[studentId.toUpperCase().trim()];
    const meta    = JSON.stringify({ method: payload.method||'KIOSK', time:timeStr });
    sh.appendRow([
      'ATT-' + Utilities.getUuid().substring(0,8),
      hist ? hist.historyId : '',
      studentId,
      hist ? hist.level : '',
      new Date(),
      payload.status || 'PRESENT',
      Session.getActiveUser().getEmail() || 'KIOSK',
      meta
    ]);
    _invalidateAttendanceDerivedCaches_(ss);
    writeAuditLog_('ATTENDANCE', studentId, 'status:' + (payload.status||'PRESENT'), 'p_attendance');
    return { success:true, studentName:name, studentId, time:timeStr, message:'Présence confirmée pour ' + name };
  } catch(e) {
    try { writeAuditLog_('ATTENDANCE_FAIL', String((payload && (payload.studentCode || payload.shortCode)) || '').trim() || 'UNKNOWN', e.message, 'p_attendance', true); } catch (_ae) {}
    return { success:false, error:e.message };
  }
}

function recordBulkAttendance_(records, auth) {
  try {
    const ss  = getSS_();
    const sh  = ss.getSheetByName('attendance');
    const tz  = Session.getScriptTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const histMap = _buildActiveHistoryMap(ss);
    const viewerGuardContext = auth && auth.token ? auth : null;
    const data  = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]];
    const h     = data[0].map(x => String(x).toUpperCase().trim());
    const iSid  = h.indexOf('STUDENTID');
    const iDate = h.indexOf('DATE');
    const existing = new Set();
    data.slice(1).forEach(r => {
      const d = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate],tz,'yyyy-MM-dd') : String(r[iDate]);
      if (d === today) existing.add(String(r[iSid]).trim());
    });
    const newRows = [];
    const appendedRows = [];
    const inputRows = Array.isArray(records) ? records : [];
    inputRows.forEach(rec => {
      const sid = String(rec && rec.id || '').trim();
      if (rec.type === 'STUDENT' && sid && !existing.has(sid)) {
        if (viewerGuardContext) {
          const guard = ensureViewerCanAccessStudentScope_(sid, viewerGuardContext);
          if (!guard.success) return;
        }
        const hist = histMap[String(rec.id).toUpperCase().trim()];
        newRows.push([
          'ATT-' + Utilities.getUuid().substring(0,8),
          hist ? hist.historyId : '',
          sid,
          hist ? hist.level : '',
          new Date(),
          rec.status || 'PRESENT',
          Session.getActiveUser().getEmail() || 'BULK',
          JSON.stringify({ method:'BULK', time:Utilities.formatDate(new Date(),tz,'HH:mm:ss') })
        ]);
        existing.add(sid);
        appendedRows.push({ sid: sid, status: rec.status || 'PRESENT' });
      }
    });
    if (newRows.length > 0) {
      sh.getRange(sh.getLastRow()+1, 1, newRows.length, newRows[0].length).setValues(newRows);
      _invalidateAttendanceDerivedCaches_(ss);
      appendedRows.forEach(function(entry) {
        writeAuditLog_('BULK_ATTENDANCE', entry.sid, 'status:' + String(entry.status || 'PRESENT'), 'p_attendance');
      });
    }
    return { success:true, processed:newRows.length };
  } catch(e) { return { success:false, error:e.message }; }
}

// [F5] historyId filter added
function getAttendanceForStudent_(params, auth) {
  try {
    const studentId = params && (params.studentId||params.id) ? (params.studentId||params.id) : null;
    const historyId = params && params.historyId ? params.historyId : null;
    if (studentId) {
      const guard = ensureViewerCanAccessStudentScope_(studentId, auth);
      if (!guard.success) return { success:false, error:guard.error };
    }
    const ss   = getSS_();
    const sh   = ss.getSheetByName('attendance');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:[] };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const hUpper = h.map(x => x.toUpperCase());
    const tz   = Session.getScriptTimeZone();
    // Case-insensitive column lookup
    const iSid = hUpper.findIndex(x => ['STUDENTID','STUDENTCODE','STUDENT_ID','STUDENT_CODE'].includes(x));
    const iHid = hUpper.findIndex(x => ['HISTORYID','HISTORY_ID'].includes(x));
    let rows   = data.slice(1);
    if (studentId && iSid !== -1)
      rows = rows.filter(r => String(r[iSid]).trim().toUpperCase() === String(studentId).trim().toUpperCase());
    // [F5] Filter by historyId when provided
    if (historyId && iHid !== -1)
      rows = rows.filter(r => String(r[iHid]).trim() === String(historyId).trim());
    return { success:true, data: rows.map(r => {
      const obj = {};
      h.forEach((k,i) => obj[k] = r[i] instanceof Date ? Utilities.formatDate(r[i],tz,'yyyy-MM-dd') : r[i]);
      if (typeof obj.MetaJSON === 'string') { try { obj.MetaJSON = JSON.parse(obj.MetaJSON); } catch(e) {} }
      return obj;
    })};
  } catch(e) { return { success:false, error:e.message }; }
}

function getAttendanceByDate_(params) {
  try {
    const date = params && params.date ? params.date : new Date().toISOString().slice(0,10);
    const ss   = getSS_();
    const sh   = ss.getSheetByName('attendance');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:[] };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim());
    const hUpper = h.map(x => x.toUpperCase());
    const tz   = Session.getScriptTimeZone();
    // Case-insensitive column lookup
    const iDate = hUpper.findIndex(x => ['DATE','ATTENDANCE_DATE'].includes(x));
    if (iDate === -1) return { success:true, data:[] };
    return { success:true, data: data.slice(1)
      .filter(r => {
        const d = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate],tz,'yyyy-MM-dd') : String(r[iDate]).slice(0,10);
        return d === date;
      })
      .map(r => {
        const obj = {};
        h.forEach((k,i) => obj[k] = r[i] instanceof Date ? Utilities.formatDate(r[i],tz,'yyyy-MM-dd') : r[i]);
        if (typeof obj.MetaJSON === 'string') { try { obj.MetaJSON = JSON.parse(obj.MetaJSON); } catch(e) {} }
        return obj;
      })
    };
  } catch(e) { return { success:false, error:e.message }; }
}

function getStudentAttendanceStats_(studentId, auth) {
  try {
    const result = getAttendanceForStudent_({ studentId }, auth);
    if (!result.success) return { success:false, error:result.error };
    let present=0, tardy=0, absent=0;
    result.data.forEach(r => {
      const rawStatus = (r && (r.Status !== undefined ? r.Status : r.STATUS));
      const s = _normalizeAttendanceStatusToken_(rawStatus);
      if (s === 'PRESENT') present++;
      else if (s === 'LATE') tardy++;
      else if (s === 'ABSENT') absent++;
    });
    const total = present + tardy + absent;
    const attendancePct = total > 0 ? Math.round(((present + tardy) / total) * 100) : 0;
    return { success:true, stats:{ present, tardy, absent, total, attendancePct } };
  } catch(e) { return { success:false, error:e.message }; }
}

function getStudentAttendance_(studentId, auth) {
  try {
    let sid = studentId;
    if (typeof studentId === 'object' && studentId !== null) {
      sid = studentId.studentId || studentId.id || studentId;
    }
    if (!sid || sid === 'undefined' || sid === 'null') {
      return { success: false, error: 'studentId manquant.' };
    }
    return getAttendanceForStudent_({ studentId: sid }, auth);
  } catch(e) { return { success: false, error: e.message }; }
}

function getStudentInternalNotes_(studentId, auth) {
  try {
    let sid = studentId;
    if (typeof studentId === 'object' && studentId !== null) {
      sid = studentId.studentId || studentId.id || studentId;
    }
    if (!sid || sid === 'undefined' || sid === 'null') {
      return { success: false, error: 'studentId manquant.' };
    }
    return getInternalNotes_({ studentId: sid }, auth);
  } catch(e) { return { success: false, error: e.message }; }
}

function addStudentInternalNote_(payload, auth) {
  if (!payload) return { success:false, error:'Payload manquant.' };
  const p = typeof payload === 'string' ? { studentId: payload } : payload;
  return addInternalNote_(p, auth);
}

function recordTransportAttendance_(data, auth) {
  try {
    const ss    = getSS_();
    const sh    = ss.getSheetByName('attendance');
    const viewer= getViewerInfo_(auth);
    const recs  = Array.isArray(data) ? data : [data];
    const histMap = _buildActiveHistoryMap(ss);
    const newRows = recs.map(rec => {
      const hist = histMap[String(rec.studentId||'').toUpperCase().trim()];
      return [
        'TRP-' + Utilities.getUuid().substring(0,8),
        hist ? hist.historyId : '',
        rec.studentId || '',
        hist ? hist.level : '',
        new Date(),
        rec.status || 'PRESENT',
        viewer.email || 'System',
        JSON.stringify({ method:'TRANSPORT', route:rec.route||'', direction:rec.direction||'MATIN' })
      ];
    });
    sh.getRange(sh.getLastRow()+1,1,newRows.length,newRows[0].length).setValues(newRows);
    _invalidateAttendanceDerivedCaches_(ss);
    recs.forEach(rec => {
      writeAuditLog_('TRANSPORT_ATTENDANCE', rec.studentId, 'method:TRANSPORT,route:' + (rec.route||'') + ',direction:' + (rec.direction||''), 'p_attendance');
    });
    return { success:true, processed:recs.length };
  } catch(e) { return { success:false, error:e.message }; }
}

function getAttendanceStats_(auth) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('attendance');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:{ present:0, absent:0, late:0, total:0 }};
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().trim());
    const iSt  = h.indexOf('STATUS');
    let present=0, absent=0, late=0;
    data.slice(1).forEach(r => {
      const s = String(r[iSt]).toUpperCase();
      if (s === 'PRESENT') present++;
      else if (s === 'ABSENT') absent++;
      else if (s === 'RETARD'||s === 'LATE') late++;
    });
    return { success:true, data:{ present, absent, late, total:present+absent+late }};
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// FINANCE
// ============================================================

// [F6] historyId filter added; defaults to the active academic year for the
// student when the caller does not pass an explicit historyId. This prevents
// historical years from polluting current-year totals (audit fix #15).
function getStudentPayments_(params, auth) {
  try {
    const studentId = params && (params.studentId||params.id) ? (params.studentId||params.id) : null;
    if (studentId) {
      const guard = ensureViewerCanAccessStudentScope_(studentId, auth);
      if (!guard.success) return { success:false, error:guard.error };
    }
    const ss      = getSS_();
    const sh      = ss.getSheetByName('Finance');
    if (!sh || sh.getLastRow() < 2) return { success:true, data:[] };
    const data    = sh.getDataRange().getValues();
    const headers = data[0].map(x => String(x).trim());
    const headersUpper = headers.map(h => h.toUpperCase());
    const tz      = Session.getScriptTimeZone();
    let historyId = params && params.historyId ? params.historyId : null;
    const includeAllYears = params && (params.allYears === true || params.includeAllYears === true);
    // Case-insensitive column lookup
    const iSid   = headersUpper.findIndex(h => ['STUDENTID','STUDENTCODE','STUDENT_ID','STUDENT_CODE'].includes(h));
    const iHid   = headersUpper.findIndex(h => ['HISTORYID','HISTORY_ID'].includes(h));
    // Default historyId to the student's active academic year when not provided.
    if (!historyId && !includeAllYears && studentId) {
      try {
        const histMap = _buildActiveHistoryMap(ss);
        const hist = histMap[String(studentId).toUpperCase().trim()];
        if (hist && hist.historyId) historyId = hist.historyId;
      } catch (_e) {}
    }
    let rows = data.slice(1);
    if (studentId && iSid !== -1)
      rows = rows.filter(r => String(r[iSid]).trim().toUpperCase() === String(studentId).trim().toUpperCase());
    // [F6] Filter by historyId when provided
    if (historyId && iHid !== -1)
      rows = rows.filter(r => String(r[iHid]).trim() === String(historyId).trim());
    return { success:true, data: rows.map(r => {
      const obj = {};
      headers.forEach((h,i) => obj[h] = r[i] instanceof Date ? Utilities.formatDate(r[i],tz,'yyyy-MM-dd') : r[i]);
      return obj;
    })};
  } catch(e) { return { success:false, error:e.message }; }
}

function getStudentFinanceProfile_(studentId, auth) {
  try {
    // Handle different parameter formats
    let sid = studentId;
    if (typeof studentId === 'object' && studentId !== null) {
      sid = studentId.studentId || studentId.id || studentId;
    }
    if (!sid || sid === 'undefined' || sid === 'null') {
      return { success:true, totalPaid:0, totalDebt:0, transactions:[] };
    }
    const result = getStudentPayments_({ studentId: sid }, auth);
    if (!result.success) return { success:false, error:result.error };
    const confRes = getSaaSSettings_(auth);
    const conf = (confRes && confRes.success && confRes.data && typeof confRes.data === 'object') ? confRes.data : {};
    let totalPaid = 0;
    let lastPaymentDate = '';
    const transactions = result.data.map(r => {
      const amt = parseFloat(r.Amount || 0);
      totalPaid += isNaN(amt) ? 0 : amt;
      const rowDate = r.Date instanceof Date
        ? Utilities.formatDate(r.Date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.Date || '').trim();
      if (rowDate && rowDate > lastPaymentDate) lastPaymentDate = rowDate;
      return { date:r.Date, amount:amt, description:r.Type||'Versement', status:r.Status, type:r.Type };
    });
    // Expected tuition for the active year (the system never accumulates the
    // due across prior partial payments — that's how dashboards used to inflate
    // the total debt).
    const expectedDue = Number(getExpectedTuitionAmountForStudent_(sid, conf) || 0);
    const totalDue = Math.max(expectedDue, totalPaid);
    const totalDebt = Math.max(0, totalDue - totalPaid);
    return {
      success:true,
      totalPaid,
      totalDue,
      totalDebt,
      outstanding: totalDebt,
      financeConfigOk: expectedDue > 0 || totalDue > 0,
      financeConfigWarning: (expectedDue <= 0 && totalDue <= 0)
        ? 'Configuration des frais incomplète pour cet élève.'
        : '',
      lastPaymentDate: lastPaymentDate,
      transactions:transactions.reverse()
    };
  } catch(e) { return { success:false, error:e.message }; }
}

function parseTuitionConfigValue_(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  if ((raw.charAt(0) === '{' && raw.charAt(raw.length - 1) === '}') || (raw.charAt(0) === '[' && raw.charAt(raw.length - 1) === ']')) {
    try { return JSON.parse(raw); } catch(e) { return null; }
  }
  return null;
}

function isTuitionPaymentPayload_(payload) {
  const desc = String(payload && (payload.designation || payload.paymentType || payload.description || '') || '').toLowerCase();
  return /scolar|tuition|mensuel|versement/.test(desc);
}

/**
 * Returns the divisor associated with TUITION_FREQUENCY so an annual amount
 * can be split into per-period expected amounts.
 *   ANNUAL    -> 1
 *   SEMESTER  -> 2
 *   TRIMESTER -> 3
 *   MONTHLY   -> 10  (typical Haitian school year)
 */
function getTuitionFrequencyDivisor_(conf) {
  const f = String((conf && (conf.TUITION_FREQUENCY || conf.tuitionFrequency)) || 'ANNUAL').trim().toUpperCase();
  if (f === 'MONTHLY' || f === 'MENSUEL') return 10;
  if (f === 'TRIMESTER' || f === 'TRIMESTRIEL' || f === 'QUARTERLY') return 3;
  if (f === 'SEMESTER' || f === 'SEMESTRIEL' || f === 'BIANNUAL') return 2;
  return 1;
}

/** Active configured currency; defaults to HTG. */
function getConfiguredCurrency_(conf) {
  const c = String((conf && (conf.CURRENCY || conf.currency)) || 'HTG').trim().toUpperCase();
  return c || 'HTG';
}

/**
 * Sums payments already recorded against a student during the active history
 * (current academic year). Used to derive the outstanding balance server-side.
 */
function _sumPaidThisYear_(ss, studentId, historyId) {
  const sh = ss.getSheetByName('Finance');
  if (!sh || sh.getLastRow() < 2) return 0;
  const data = sh.getDataRange().getValues();
  const headersUpper = data[0].map(h => String(h).toUpperCase().trim());
  const iSid = headersUpper.findIndex(h => ['STUDENTID','STUDENTCODE','STUDENT_ID'].includes(h));
  const iHid = headersUpper.findIndex(h => ['HISTORYID','HISTORY_ID'].includes(h));
  const iAmt = headersUpper.findIndex(h => ['AMOUNT','AMOUNTPAID'].includes(h));
  const iStatus = headersUpper.findIndex(h => ['STATUS','STATUT'].includes(h));
  if (iSid < 0 || iAmt < 0) return 0;
  const sidUp = String(studentId || '').toUpperCase().trim();
  const hidUp = String(historyId || '').toUpperCase().trim();
  let sum = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[iSid]).toUpperCase().trim() !== sidUp) continue;
    if (hidUp && iHid >= 0 && String(r[iHid]).toUpperCase().trim() && String(r[iHid]).toUpperCase().trim() !== hidUp) continue;
    if (iStatus >= 0) {
      const st = String(r[iStatus] || '').toUpperCase().trim();
      if (st === 'CANCELLED' || st === 'ANNULE' || st === 'VOID' || st === 'REFUNDED') continue;
    }
    const n = parseFloat(r[iAmt]);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

/**
 * Computes the outstanding balance (amount due) for a tuition payment using
 * the configured tuition amount, the configured frequency and the payments
 * already recorded for the active academic year. Returns null when tuition
 * is not configured for the student.
 */
function computeStudentOutstanding_(studentId, conf, ss, historyId) {
  const expectedAnnual = Number(getExpectedTuitionAmountForStudent_(studentId, conf) || 0);
  if (!Number.isFinite(expectedAnnual) || expectedAnnual <= 0) return null;
  const divisor = getTuitionFrequencyDivisor_(conf);
  const expectedPerPeriod = expectedAnnual / Math.max(1, divisor);
  // For now we treat the period boundary as the academic year; the per-period
  // amount represents one installment and the outstanding is what is unpaid
  // toward the full annual fee. Schools that prefer strict per-month tracking
  // can layer that on top of this baseline.
  const paidYear = _sumPaidThisYear_(ss, studentId, historyId);
  const fullOutstanding = Math.max(0, expectedAnnual - paidYear);
  // The next installment due cannot exceed the remaining annual balance.
  return {
    expectedAnnual,
    expectedPerPeriod,
    paidYear,
    nextInstallment: Math.min(expectedPerPeriod, fullOutstanding),
    fullOutstanding
  };
}

function getExpectedTuitionAmountForStudent_(studentId, conf) {
  const TAG = '[getExpectedTuitionAmountForStudent_]';
  if (!studentId || !conf) { console.warn(TAG, 'called with missing studentId or conf'); return null; }
  const mode = String(conf.TUITION_MODE || 'GLOBAL').trim().toUpperCase();
  const studentLevel = resolveStudentLevelForScope_(studentId) || '';
  const studentCycle = resolveLevelCycleKey_(studentLevel) || '';
  console.log(TAG, 'studentId=', studentId, '| mode=', mode, '| studentLevel=', studentLevel, '| studentCycle=', studentCycle);

  // ── Modern FIN_PAYMENT_PLANS (try first — takes priority) ────────────────
  var finPlansRaw = conf.FIN_PAYMENT_PLANS;
  if (finPlansRaw) {
    var finPlans = {};
    if (typeof finPlansRaw === 'object') { finPlans = finPlansRaw; }
    else { try { finPlans = JSON.parse(finPlansRaw) || {}; } catch(_pe) {} }

    const getAmountFromPlan = function(plan) {
      if (!plan || typeof plan !== 'object') return null;
      if (Number(plan.instTotal) > 0) return Number(plan.instTotal);
      if (plan.monthly && Number(plan.monthly.amount) > 0) return Number(plan.monthly.amount);
      if (Array.isArray(plan.installments)) {
        const total = plan.installments.reduce(function(s,i){ return s + (Number(i && i.amount) || 0); }, 0);
        if (total > 0) return total;
      }
      return null;
    };

    // Try class-specific plan first
    const classKey = 'class_' + String(studentLevel).replace(/\s+/g,'_').toLowerCase();
    const cyclKey  = 'cycle_' + String(studentCycle).replace(/\s+/g,'_').toLowerCase();
    const classAmt = getAmountFromPlan(finPlans[classKey]);
    const cyclAmt  = getAmountFromPlan(finPlans[cyclKey]);
    const globalAmt= getAmountFromPlan(finPlans['global']);
    console.log(TAG, 'FIN_PAYMENT_PLANS lookup | classKey=', classKey, '→', classAmt, '| cycleKey=', cyclKey, '→', cyclAmt, '| global→', globalAmt);
    if (classAmt !== null) return classAmt;
    if (cyclAmt  !== null) return cyclAmt;
    if (globalAmt !== null) return globalAmt;
    // Fallback: any cycle_ or class_ key matching the level/cycle by substring
    const fallback = Object.keys(finPlans).find(function(k) {
      return (k.indexOf(String(studentLevel).toLowerCase()) >= 0 || k.indexOf(String(studentCycle).toLowerCase()) >= 0)
        && getAmountFromPlan(finPlans[k]) !== null;
    });
    if (fallback) { console.log(TAG, 'FIN_PAYMENT_PLANS fuzzy match key=', fallback); return getAmountFromPlan(finPlans[fallback]); }
  }

  const getClassPlanAmountForLevel = function(levelName) {
    const level = String(levelName || '').trim();
    if (!level) return null;
    const plans = parseTuitionConfigValue_(conf.classPaymentPlans) || {};
    if (!plans || typeof plans !== 'object') return null;
    const direct = plans[level];
    const normLevel = normalizeScopeToken_(level);
    const matchKey = direct ? level : Object.keys(plans).find(function(k) { return normalizeScopeToken_(k) === normLevel; });
    const plan = matchKey ? plans[matchKey] : direct;
    if (!plan || typeof plan !== 'object') return null;
    const directAmount = parseFloat(plan.totalAmount || plan.amount || 0);
    if (Number.isFinite(directAmount) && directAmount > 0) return directAmount;
    const predefined = Array.isArray(plan.predefinedPayments) ? plan.predefinedPayments : [];
    const predefinedTotal = predefined.reduce(function(sum, row) {
      const n = parseFloat((row && row.amount) || 0);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
    if (Number.isFinite(predefinedTotal) && predefinedTotal > 0) return predefinedTotal;
    const legacy = Object.keys(plan).map(function(key) { return parseFloat(plan[key] || 0); }).find(function(v) {
      return Number.isFinite(v) && v > 0;
    });
    return Number.isFinite(legacy) && legacy > 0 ? legacy : null;
  };

  const classPlanAmount = getClassPlanAmountForLevel(studentLevel);
  console.log(TAG, 'Legacy classPaymentPlans amount=', classPlanAmount, '| TUITION_AMOUNT_GLOBAL=', conf.TUITION_AMOUNT_GLOBAL);

  if (mode === 'GLOBAL') {
    return parseFloat(conf.TUITION_AMOUNT_GLOBAL) || classPlanAmount || null;
  }

  if (mode === 'BY_CLASS') {
    const byClass = parseTuitionConfigValue_(conf.TUITION_BY_CLASS) || {};
    const normStudent = normalizeScopeToken_(studentLevel);
    const exactValue = byClass[studentLevel];
    if (exactValue !== undefined) return parseFloat(exactValue) || null;
    const matchKey = Object.keys(byClass).find(k => normalizeScopeToken_(k) === normStudent);
    if (matchKey) return parseFloat(byClass[matchKey]) || null;
    return classPlanAmount || null;
  }

  if (mode === 'BY_CYCLE') {
    const byCycle = parseTuitionConfigValue_(conf.TUITION_BY_CYCLE) || {};
    const normCycle = normalizeScopeToken_(studentCycle);
    const exactValue = byCycle[studentCycle];
    if (exactValue !== undefined) return parseFloat(exactValue) || null;
    const matchKey = Object.keys(byCycle).find(k => normalizeScopeToken_(k) === normCycle);
    if (matchKey) return parseFloat(byCycle[matchKey]) || null;
    return classPlanAmount || null;
  }

  console.warn(TAG, 'No amount resolved for studentId=', studentId, '| mode=', mode);
  return classPlanAmount || null;
}

function getAllowedPaymentMethodsForStudent_(studentId, conf) {
  if (!studentId || !conf || !conf.classPaymentTypes) return null;
  const className = resolveStudentLevelForScope_(studentId) || '';
  if (!className) return null;
  const methodsByClass = parseTuitionConfigValue_(conf.classPaymentTypes);
  if (!methodsByClass || typeof methodsByClass !== 'object') return null;
  if (Array.isArray(methodsByClass[className])) return methodsByClass[className];
  const normClass = normalizeScopeToken_(className);
  const matchKey = Object.keys(methodsByClass).find(k => normalizeScopeToken_(k) === normClass);
  if (matchKey && Array.isArray(methodsByClass[matchKey])) return methodsByClass[matchKey];
  return null;
}

function recordNewPayment_(payload, token) {
  // Invalider l'instantané IA après écriture d'un paiement.
  try { _invalidateAiSystemSnapshot_(); } catch (_) {}
  try {
    const viewer = getViewerInfo_(token);
    const ss     = getSS_();
    const sh     = ss.getSheetByName('Finance');
    const conf   = getSaaSSettings_().data || {};
    const currency = getConfiguredCurrency_(conf);
    const paid   = Number(payload.amountPaid !== undefined && payload.amountPaid !== null ? payload.amountPaid : payload.amount);
    if (!Number.isFinite(paid) || paid <= 0) {
      return { success:false, error:'Montant payé invalide.' };
    }
    const minAmt = parseFloat(conf.PAY_MIN_AMOUNT) || 0;
    if (minAmt > 0 && paid < minAmt) {
      return { success:false, error:'Versement minimum requis: ' + minAmt + ' ' + currency + '.' };
    }

    const isTuition = isTuitionPaymentPayload_(payload);
    const histMapEarly = _buildActiveHistoryMap(ss);
    const histEarly    = histMapEarly[String(payload.studentId||'').toUpperCase().trim()];
    const historyId    = histEarly ? histEarly.historyId : '';

    // The system computes the amount due. For tuition payments we derive it
    // from the configured tuition amount minus what has already been paid this
    // academic year. The frontend's amountDue (if any) is treated as a hint
    // and never overrides the server-side calculation.
    let due = 0;
    let outstandingInfo = null;
    if (isTuition) {
      outstandingInfo = computeStudentOutstanding_(payload.studentId, conf, ss, historyId);
      if (outstandingInfo) {
        due = outstandingInfo.fullOutstanding;
      } else {
        due = Number(payload.amountDue || 0) || paid;
      }
    } else {
      // Non-tuition payments: rely on the explicit due (e.g. exam fee, books).
      const rawDue = Number(payload.amountDue !== undefined && payload.amountDue !== null ? payload.amountDue : payload.amount);
      due = Number.isFinite(rawDue) && rawDue > 0 ? rawDue : paid;
    }

    // Allowed payment methods per class (only enforced when the school has
    // explicitly configured a list for the student's class).
    const allowedMethods = getAllowedPaymentMethodsForStudent_(payload.studentId, conf);
    if (allowedMethods && Array.isArray(allowedMethods) && allowedMethods.length && payload.method) {
      const normalizedMethod = String(payload.method || '').trim().toUpperCase();
      const normalizedAllowed = allowedMethods.map(m => String(m || '').trim().toUpperCase());
      if (!normalizedAllowed.includes(normalizedMethod)) {
        return { success:false, error:'Méthode de paiement non autorisée pour la classe de cet élève.' };
      }
    }

    // Partial payments toggle
    const allowPartialRaw = String(conf.PAY_ALLOW_PARTIAL == null ? 'true' : conf.PAY_ALLOW_PARTIAL).trim().toLowerCase();
    const allowPartial = !(allowPartialRaw === 'false' || allowPartialRaw === '0' || allowPartialRaw === 'no' || allowPartialRaw === 'non');

    let status   = 'PAID';
    let notes    = 'Via ' + (payload.method || 'Caisse');
    let finalAmt = paid;
    let advanceCredit = 0;
    let changeReturned = 0;
    let refundIssued = 0;

    if (paid < due) {
      if (!allowPartial) {
        return { success:false, error:'Les paiements partiels sont désactivés. Montant attendu: ' + due + ' ' + currency + '.' };
      }
      status = 'PARTIAL';
      notes += ' | Solde dû: ' + (due - paid) + ' ' + currency;
    } else if (paid > due && due > 0) {
      const action = String(conf.PAY_OVERPAYMENT_ACTION || 'CREDIT').trim().toUpperCase();
      const surplus = paid - due;
      if (action === 'CHANGE') {
        finalAmt = due;
        changeReturned = surplus;
        notes += ' | Monnaie rendue: ' + surplus + ' ' + currency;
      } else if (action === 'REFUND') {
        finalAmt = due;
        refundIssued = surplus;
        notes += ' | Remboursement à émettre: ' + surplus + ' ' + currency;
      } else {
        // CREDIT (default): keep the surplus on the student's account as advance.
        advanceCredit = surplus;
        notes += ' | Avance créditée: +' + surplus + ' ' + currency;
      }
    }

    // Late-fee / penalty (basic implementation honoring the settings).
    let penaltyApplied = 0;
    if (isTuition && outstandingInfo && Number(conf.FIN_PENALTY_AMOUNT || 0) > 0) {
      const grace = Math.max(0, parseInt(conf.FIN_GRACE_PERIOD || 0, 10) || 0);
      const penaltyType = String(conf.FIN_PENALTY_TYPE || 'FIXED').trim().toUpperCase();
      const recurrence = String(conf.FIN_PENALTY_RECURRENCE || 'ONCE').trim().toUpperCase();
      // Simplified rule: any tuition payment past the grace period of the academic
      // year start incurs the configured penalty (ONCE or per period).
      const today = new Date();
      const yearStart = new Date(today.getFullYear(), 8, 1); // Sept 1 (adjustable via settings later)
      const overdueDays = Math.floor((today - yearStart) / (1000 * 60 * 60 * 24));
      if (overdueDays > grace) {
        const baseAmt = Number(conf.FIN_PENALTY_AMOUNT) || 0;
        if (penaltyType === 'PERCENT' || penaltyType === 'PERCENTAGE') {
          penaltyApplied = Math.round(outstandingInfo.expectedPerPeriod * baseAmt) / 100;
        } else {
          penaltyApplied = baseAmt;
        }
        if (recurrence === 'MONTHLY') {
          const monthsLate = Math.max(1, Math.floor((overdueDays - grace) / 30));
          penaltyApplied = penaltyApplied * monthsLate;
        }
        if (penaltyApplied > 0) {
          notes += ' | Pénalité de retard: ' + penaltyApplied + ' ' + currency;
        }
      }
    }

    // Annotate the recorded note when the entered amount diverges from the
    // expected installment. The reference point is the next installment, not
    // the full annual fee, to avoid noisy "configured vs entered" lines.
    if (isTuition && outstandingInfo && outstandingInfo.expectedPerPeriod > 0) {
      const expectedPeriod = outstandingInfo.expectedPerPeriod;
      if (Math.abs(paid - expectedPeriod) > 0.01 && Math.abs(paid - outstandingInfo.fullOutstanding) > 0.01) {
        notes += ' | Versement attendu/période: ' + expectedPeriod + ' ' + currency;
      }
    }

    // Ensure we have a unique receipt id (longer UUID + collision guard).
    let receiptId = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = 'REC-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
      if (!_receiptIdExists_(sh, candidate)) { receiptId = candidate; break; }
    }
    if (!receiptId) receiptId = 'REC-' + Date.now().toString(36).toUpperCase();

    // Honor designation when present (front sends both designation/description),
    // matching the order used by isTuitionPaymentPayload_.
    // Auto-generate smart label based on frequency and period when designation is generic.
    let description = String(payload.designation || payload.description || 'Paiement').trim();
    if (isTuition && outstandingInfo) {
      const freqKey = String((conf.TUITION_FREQUENCY || conf.tuitionFrequency || 'ANNUAL')).trim().toUpperCase();
      const divisor = getTuitionFrequencyDivisor_(conf);
      const periodsPaid = divisor > 1 && outstandingInfo.expectedPerPeriod > 0
        ? Math.floor((outstandingInfo.paidYear - paid) / outstandingInfo.expectedPerPeriod)
        : 0;
      const currentPeriod = Math.min(Math.max(1, periodsPaid + 1), divisor);
      const isPartial = paid < outstandingInfo.nextInstallment && outstandingInfo.nextInstallment > 0;
      const isGenericLabel = !description || description === 'Paiement' ||
        /^frais de scolar/i.test(description) || description === 'scolarité' || description === 'Frais de scolarité';
      if (isGenericLabel) {
        if (freqKey === 'MONTHLY' || freqKey === 'MENSUEL') {
          description = isPartial
            ? 'Paiement partiel - Mois ' + currentPeriod + '/' + divisor
            : 'Frais mensuel - Mois ' + currentPeriod + '/' + divisor;
        } else if (freqKey === 'TRIMESTER' || freqKey === 'TRIMESTRIEL' || freqKey === 'QUARTERLY') {
          description = isPartial
            ? 'Versement partiel ' + currentPeriod + '/' + divisor
            : 'Versement ' + currentPeriod + '/' + divisor;
        } else if (freqKey === 'SEMESTER' || freqKey === 'SEMESTRIEL' || freqKey === 'BIANNUAL') {
          description = isPartial
            ? 'Versement partiel ' + currentPeriod + '/2'
            : 'Versement ' + currentPeriod + '/2';
        }
      }
    }

    let paymentDateValue = new Date();
    if (payload.paymentDate) {
      const parsed = new Date(payload.paymentDate);
      if (!isNaN(parsed.getTime())) paymentDateValue = parsed;
    }

    // Fix 6: persist the admin-supplied reference (cheque number, transfer ID, etc.)
    // Previously this field was sent by the frontend but silently discarded here.
    var paymentRef = String(payload.reference || payload.ref || payload.chequeNumber || payload.transferId || '').trim();

    sh.appendRow([receiptId, historyId, payload.studentId, payload.studentName, description, finalAmt, viewer.email, status, notes, paymentDateValue, paymentRef]);
    writeAuditLog_('PAYMENT', payload.studentId, JSON.stringify({receipt:receiptId, paid, due, status, advanceCredit, changeReturned, refundIssued, penaltyApplied, reference: paymentRef || undefined}), 'p_finance');

    // Fix 4: invalidate caches that embed payment totals so the dashboard and
    // student finance profile reflect the new payment immediately instead of
    // serving stale data until each cache's TTL expires (up to 5 minutes).
    try {
      var _cacheInv = CacheService.getScriptCache();
      var _ssInvId  = getSS_().getId();
      // Active-history map — embedded in dashboard student/payment counts
      _cacheInv.remove('ACTIVE_HISTORY_CACHE_' + _ssInvId);
      // Per-student grade/score cache (may embed finance state in some views)
      _cacheInv.remove('STUDENT_GRADES_' + String(payload.studentId || '').toUpperCase() + '_' + _ssInvId);
      // Settings cache (dashboard reads tuition config from here for balance calc)
      _cacheInv.remove('SAAS_SETTINGS_' + _ssInvId + '_CURRENT');
    } catch(_cacheErr) { /* non-fatal — stale cache is better than a crashed payment */ }

    return {
      success:true,
      receiptId,
      receiptNumber: receiptId,
      status: status,
      amountPaid: finalAmt,
      amountDue: due,
      currency: currency,
      advanceCredit: advanceCredit,
      changeReturned: changeReturned,
      refundIssued: refundIssued,
      penaltyApplied: penaltyApplied,
      paymentDate: paymentDateValue,
      message: refundIssued > 0
        ? 'Encaissement enregistré. Remboursement à émettre: ' + refundIssued + ' ' + currency + '.'
        : 'Encaissement enregistré.'
    };
  } catch(e) { return { success:false, error:e.message }; }
}

/** Returns true when a ReceiptID already exists in the Finance sheet. */
function _receiptIdExists_(sh, receiptId) {
  try {
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return false;
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === receiptId) return true;
    }
    return false;
  } catch (_e) { return false; }
}

function approveOnlinePayment_(data) {
  return recordNewPayment_({ studentId:data.studentId, studentName:data.studentName, description:data.description||'Paiement en ligne', amountDue:data.amount, amountPaid:data.amount, method:'ONLINE' }, null);
}

function processPayrollBatch_(batch) {
  try {
    const ss    = getSS_();
    let sh      = ss.getSheetByName('Payroll');
    if (!sh) { sh = ss.insertSheet('Payroll'); sh.appendRow(['Date','Mois','Collaborateur','Salaire Base','Retenues','Salaire Net','Statut']); sh.setFrozenRows(1); }
    batch.forEach(item => sh.appendRow([new Date(), item.month, item.name, item.baseSalary, item.deductions, item.netSalary, 'PAYE']));
    return { success:true, count:batch.length };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// AUDIT LOG
// ============================================================
function writeAuditLog_(action, target, details, permUsed, isError) {
  try {
    if (action && typeof action === 'object') {
      const payload = action;
      return writeAuditLog(
        payload.action || payload.name || 'UNKNOWN_ACTION',
        payload.target || payload.user || payload.studentId || 'SYSTEM',
        payload.details || payload,
        payload.permission || payload.permUsed || '',
        !!payload.isError
      );
    }
    return writeAuditLog(action, target, details, permUsed, !!isError);
  } catch(e) {}
}

function _resolveSessionEmailSafe_(fallbackValue) {
  const fallback = String(fallbackValue || '').trim();
  let email = '';
  try {
    email = String((Session.getActiveUser() && Session.getActiveUser().getEmail()) || '').trim();
  } catch (_e1) {}
  if (!email) {
    try {
      email = String((Session.getEffectiveUser() && Session.getEffectiveUser().getEmail()) || '').trim();
    } catch (_e2) {}
  }
  return email || fallback;
}

function _auditNorm_(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function _auditSheetByName_(ss, names) {
  if (!ss) return null;
  const wanted = Array.isArray(names) ? names : [names];
  const wantedNorm = wanted.map(_auditNorm_).filter(Boolean);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const shNameNorm = _auditNorm_(sheets[i].getName());
    if (wantedNorm.indexOf(shNameNorm) !== -1) return sheets[i];
  }
  return null;
}

function _auditCellByAliases_(row, headerMap, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const idx = headerMap[_auditNorm_(aliases[i])];
    if (idx !== undefined && idx !== null && idx >= 0) return row[idx];
  }
  return '';
}

function _normalizeAuditStatus_(rawStatus, rawError) {
  const statusTxt = String(rawStatus || '').toUpperCase();
  const errTxt = String(rawError || '').toUpperCase();
  if (/ECHEC|ERROR|FAIL|FALSE|KO|❌/.test(statusTxt) || /TRUE|ERROR|FAIL|KO|❌/.test(errTxt)) return 'ECHEC';
  if (/REUSSITE|SUCCESS|OK|TRUE|✅/.test(statusTxt) || /FALSE|0/.test(errTxt)) return 'REUSSITE';
  return statusTxt ? statusTxt : 'REUSSITE';
}

function _auditSerializeTimestamp_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }

  if (value === null || value === undefined) return '';
  const txt = String(value).trim();
  if (!txt) return '';

  // Support common DD/MM/YYYY formats when legacy rows were stored as text.
  const fr = txt.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (fr) {
    const d = Number(fr[1]);
    const m = Number(fr[2]) - 1;
    const y = Number(fr[3]);
    const hh = Number(fr[4] || 0);
    const mm = Number(fr[5] || 0);
    const ss = Number(fr[6] || 0);
    const parsed = new Date(y, m, d, hh, mm, ss);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const parsed = new Date(txt);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  return txt;
}

function _formatAuditRowByHeader_(headers, payload) {
  const now = payload.timestamp || new Date();
  const status = payload.status || _normalizeAuditStatus_(payload.status, payload.isError);
  return headers.map(function(h) {
    const key = _auditNorm_(h);
    switch (key) {
      case 'TIMESTAMP':
      case 'DATE':
        return now;
      case 'ACTION':
        return payload.action;
      case 'TARGET':
      case 'POURQUOI':
      case 'CIBLE':
        return payload.target;
      case 'ACTOR':
      case 'UTILISATEUR':
      case 'USER':
        return payload.actor;
      case 'PERMISSION':
      case 'PERMUSED':
      case 'PERM':
        return payload.permission;
      case 'STATUS':
      case 'STATUT':
        return status;
      case 'DETAILS':
      case 'DETAILSJSON':
      case 'JSON':
      case 'METAJSON':
        return payload.json || payload.detailsJson;
      case 'ISERROR':
        return payload.isError ? true : false;
      default:
        return '';
    }
  });
}

function _toAuditEventFromRow_(row, hMap) {
  const timestamp = _auditCellByAliases_(row, hMap, ['Timestamp', 'Date']);
  const rawJson = _auditCellByAliases_(row, hMap, ['Json', 'DetailsJSON', 'Details', 'MetaJSON']);
  const legacyAction = String(_auditCellByAliases_(row, hMap, ['Action']) || '').trim();
  const legacyTarget = String(_auditCellByAliases_(row, hMap, ['Target', 'Pour_Quoi', 'Pour Quoi', 'Cible']) || '').trim();
  const legacyActor = String(_auditCellByAliases_(row, hMap, ['Actor', 'Utilisateur', 'User']) || '').trim();
  const legacyPermission = String(_auditCellByAliases_(row, hMap, ['Permission', 'PermUsed', 'Perm']) || '').trim();
  const legacyStatus = String(_auditCellByAliases_(row, hMap, ['Status', 'Statut']) || '').trim();
  const legacyIsError = _auditCellByAliases_(row, hMap, ['IsError']);

  let parsedJson = null;
  if (typeof rawJson === 'string') {
    const s = rawJson.trim();
    if (s && (s[0] === '{' || s[0] === '[')) {
      try { parsedJson = JSON.parse(s); } catch (_e) {}
    }
  } else if (rawJson && typeof rawJson === 'object') {
    parsedJson = rawJson;
  }

  const action = String((parsedJson && parsedJson.action) || legacyAction || 'UNKNOWN_ACTION').trim() || 'UNKNOWN_ACTION';
  const target = String((parsedJson && parsedJson.target) || legacyTarget || '').trim();
  const actor = String((parsedJson && parsedJson.actor) || legacyActor || '').trim();
  const permission = String((parsedJson && parsedJson.permission) || legacyPermission || '').trim();
  const status = _normalizeAuditStatus_((parsedJson && parsedJson.status) || legacyStatus, (parsedJson && parsedJson.isError) || legacyIsError);
  const details = (parsedJson && Object.prototype.hasOwnProperty.call(parsedJson, 'details'))
    ? parsedJson.details
    : (parsedJson || rawJson);

  let detailsPreview = '';
  try {
    detailsPreview = String(typeof rawJson === 'string' ? rawJson : JSON.stringify(parsedJson || rawJson || {})).slice(0, 220);
  } catch (_e) {
    detailsPreview = String(rawJson || '').slice(0, 220);
  }

  return {
    Timestamp: timestamp,
    Action: action,
    Target: target,
    Actor: actor,
    Permission: permission,
    Status: status,
    Json: parsedJson || rawJson || {},
    DetailsJSON: details,
    DetailsPreview: detailsPreview
  };
}

function _normalizeAuditSheetToCompact_(sheet) {
  if (!sheet) return;
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(x) { return String(x || '').trim(); });
  // Compact = first two headers are Timestamp/Json (extra empty columns are tolerated — don't re-migrate).
  const compactNow = (
    headers.length >= 2 &&
    _auditNorm_(headers[0]) === 'TIMESTAMP' &&
    _auditNorm_(headers[1]) === 'JSON'
  );
  if (compactNow) {
    // Trim any stray extra columns without touching the data rows.
    if (lastCol > 2) {
      try { sheet.deleteColumns(3, lastCol - 2); } catch (_e) {}
    }
    return;
  }

  const rows = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  const migrated = [];
  if (rows.length > 1) {
    const sourceHeaders = rows[0].map(function(x) { return String(x || '').trim(); });
    const hMap = {};
    sourceHeaders.forEach(function(name, idx) { hMap[_auditNorm_(name)] = idx; });
    for (let i = 1; i < rows.length; i++) {
      const ev = _toAuditEventFromRow_(rows[i], hMap);
      let jsonStr = '';
      try {
        jsonStr = JSON.stringify({
          action: ev.Action,
          target: ev.Target,
          actor: ev.Actor,
          permission: ev.Permission,
          status: ev.Status,
          details: ev.DetailsJSON
        });
      } catch (_e) {
        jsonStr = String(ev.DetailsPreview || '');
      }
      if (jsonStr.length > 45000) jsonStr = jsonStr.slice(0, 45000) + '...[truncated]';
      migrated.push([ev.Timestamp || new Date(), jsonStr]);
    }
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([['Timestamp', 'Json']]);
  sheet.setFrozenRows(1);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, 2).setValues(migrated);
  }
  const currentCols = sheet.getMaxColumns();
  if (currentCols > 2) {
    sheet.deleteColumns(3, currentCols - 2);
  }
}

function _removeAuditDebugSheetIfExists_() {
  try {
    const ss = (typeof getSS_ === 'function') ? getSS_() : getActiveSpreadsheetSafe_();
    if (!ss) return;
    const debugSh = _auditSheetByName_(ss, ['Audit_Write_Failures', 'audit_write_failures']);
    if (debugSh) ss.deleteSheet(debugSh);
  } catch (_e) {}
}

/**
 * runAuditMigration_  — run this ONCE from the Apps Script editor (or from the
 * admin setup action) to compact the local audit log to the 2-column
 * {Timestamp, Json} format.  It must NOT be called on every write — it reads
 * and rewrites the entire sheet and costs ~0.5-1 s per invocation.
 * After migration the sheet header starts with "Timestamp","Json", so
 * subsequent calls to this function return immediately without rewriting.
 */
function runAuditMigration_() {
  try {
    const ssLocal = _getOrCreateAuditSpreadsheet_();
    if (!ssLocal) return { success: false, error: 'Audit spreadsheet introuvable.' };
    const sh = _auditSheetByName_(ssLocal, ['auditlog', 'auditlogs', 'AuditLog', 'AuditLogs']);
    if (!sh) return { success: false, error: 'Feuille auditlog introuvable.' };
    _normalizeAuditSheetToCompact_(sh);
    return { success: true, message: 'Migration audit terminée.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getGlobalAuditDashboard_(auth, query) {
  try {
    const params = (query && typeof query === 'object') ? query : {};
    const ss = getSS_();
    const sh = _auditSheetByName_(ss, ['auditlog', 'auditlogs', 'AuditLog', 'AuditLogs']);
    const pageSize = Math.max(10, Math.min(500, Number(params.pageSize || 100)));
    const page = Math.max(1, Number(params.page || 1));

    if (!sh || sh.getLastRow() < 2) {
      return {
        success:true,
        data:[],
        summary:{},
        filters:{ actions:[], actors:[], permissions:[], statuses:['REUSSITE','ECHEC'] },
        total:0,
        filtered:0,
        page:1,
        pageSize:100
      };
    }

    const actionFilter = String(params.action || '').trim().toUpperCase();
    const actorFilter = String(params.actor || '').trim().toUpperCase();
    const permFilter = String(params.permission || '').trim().toUpperCase();
    const statusFilter = String(params.status || '').trim().toUpperCase();
    const targetFilter = String(params.target || '').trim().toUpperCase();
    const search = String(params.search || '').trim().toUpperCase();
    const fromDate = params.from ? new Date(params.from) : null;
    const toDate = params.to ? new Date(params.to) : null;
    if (toDate && !isNaN(toDate.getTime())) toDate.setHours(23, 59, 59, 999);

    const sortBy = String(params.sortBy || 'Timestamp');
    const sortDir = String(params.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const hasStructuredFilters = !!(actionFilter || actorFilter || permFilter || statusFilter || targetFilter || search || (fromDate && !isNaN(fromDate.getTime())) || (toDate && !isNaN(toDate.getTime())));

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(1, sh.getLastColumn());

    let data = [];
    if (!hasStructuredFilters && sortBy === 'Timestamp' && sortDir === -1) {
      // Fast path for dashboard preload: fetch only the latest rows needed for the current page.
      const rowsNeeded = Math.max(page * pageSize + 40, 300);
      const availableRows = Math.max(0, lastRow - 1);
      const readCount = Math.min(availableRows, rowsNeeded);
      const startRow = Math.max(2, lastRow - readCount + 1);
      const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      const rows = readCount > 0 ? sh.getRange(startRow, 1, readCount, lastCol).getValues() : [];
      data = [headers].concat(rows);
    } else {
      data = sh.getDataRange().getValues();
    }

    const h = data[0].map(x => String(x).trim());
    const hMap = {};
    h.forEach((name, idx) => { hMap[_auditNorm_(name)] = idx; });

    const summary = {};
    const normalizedRows = [];
    data.slice(1).forEach(function(r) {
      try {
        const rowObj = _toAuditEventFromRow_(r, hMap);
        rowObj.Timestamp = _auditSerializeTimestamp_(rowObj.Timestamp);
        const act = String(rowObj.Action || 'UNKNOWN_ACTION');
        summary[act] = (summary[act] || 0) + 1;
        normalizedRows.push(rowObj);
      } catch (_rowErr) {
        // Ignore malformed legacy rows so the whole dashboard can still load.
      }
    });

    let rows = normalizedRows.filter(function(row) {
      const act = String(row.Action || '').toUpperCase();
      const actor = String(row.Actor || '').toUpperCase();
      const perm = String(row.Permission || '').toUpperCase();
      const status = String(row.Status || '').toUpperCase();
      const target = String(row.Target || '').toUpperCase();
      const details = String(row.DetailsPreview || '').toUpperCase();
      const ts = row.Timestamp ? new Date(row.Timestamp) : null;

      if (actionFilter && act.indexOf(actionFilter) === -1) return false;
      if (actorFilter && actor.indexOf(actorFilter) === -1) return false;
      if (permFilter && perm.indexOf(permFilter) === -1) return false;
      if (statusFilter && status.indexOf(statusFilter) === -1) return false;
      if (targetFilter && target.indexOf(targetFilter) === -1) return false;
      if (search && [act, actor, perm, status, target, details].join(' ').indexOf(search) === -1) return false;
      if (fromDate && ts && !isNaN(fromDate.getTime()) && ts < fromDate) return false;
      if (toDate && ts && !isNaN(toDate.getTime()) && ts > toDate) return false;
      return true;
    });

    rows.sort(function(a, b) {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (sortBy === 'Timestamp') {
        const da = va ? new Date(va).getTime() : 0;
        const db = vb ? new Date(vb).getTime() : 0;
        return da === db ? 0 : (da > db ? sortDir : -sortDir);
      }
      return String(va || '').localeCompare(String(vb || '')) * sortDir;
    });

    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    const uniq = function(arr) {
      const map = {};
      arr.forEach(function(v) { const k = String(v || '').trim(); if (k) map[k] = true; });
      return Object.keys(map).sort();
    };

    return {
      success:true,
      data:paged,
      summary,
      filters:{
        actions: uniq(normalizedRows.map(r => r.Action)),
        actors: uniq(normalizedRows.map(r => r.Actor)),
        permissions: uniq(normalizedRows.map(r => r.Permission)),
        statuses: uniq(normalizedRows.map(r => r.Status))
      },
      columns:['Timestamp','Action','Target','Actor','Permission','Status','DetailsPreview'],
      total: (!hasStructuredFilters && sortBy === 'Timestamp' && sortDir === -1)
        ? Math.max(0, lastRow - 1)
        : normalizedRows.length,
      filtered: rows.length,
      page: page,
      pageSize: pageSize
    };
  } catch(e) { return { success:false, error:e.message }; }
}

function getAuditLogs(auth, query) {
  try {
    var authArg = auth;
    var queryArg = query;

    // Support legacy/direct calls like getAuditLogs(query)
    if (queryArg === undefined && authArg && typeof authArg === 'object' && !authArg.token) {
      var looksLikeQuery = (
        Object.prototype.hasOwnProperty.call(authArg, 'page') ||
        Object.prototype.hasOwnProperty.call(authArg, 'pageSize') ||
        Object.prototype.hasOwnProperty.call(authArg, 'sortBy') ||
        Object.prototype.hasOwnProperty.call(authArg, 'search')
      );
      if (looksLikeQuery) {
        queryArg = authArg;
        authArg = {};
      }
    }

    var result = getGlobalAuditDashboard_(authArg || {}, queryArg || {});
    if (!result || typeof result !== 'object') {
      return {
        success: true,
        data: [],
        summary: {},
        filters: { actions: [], actors: [], permissions: [], statuses: ['REUSSITE', 'ECHEC'] },
        total: 0,
        filtered: 0,
        page: 1,
        pageSize: 100
      };
    }
    return result;
  } catch (e) {
    return { success: false, error: (e && e.message) ? e.message : String(e) };
  }
}

function getAuditLogs_(auth, query) {
  return getAuditLogs(auth, query);
}

/**
 * Diagnostic helper — returns raw sheet metadata so the frontend can pinpoint
 * why the audit table is empty.  No permission is required (safe: read-only).
 */
function getAuditDiagnostics() {
  try {
    const ss = (typeof getSS_ === 'function') ? (function(){
      try { return getSS_(); } catch(e) { return { _err: e.message }; }
    })() : null;

    if (!ss || ss._err) {
      return { success: false, error: 'getSS_() failed: ' + (ss ? ss._err : 'null returned') };
    }

    const ssId   = ss.getId();
    const sheets = ss.getSheets().map(function(sh) {
      return { name: sh.getName(), lastRow: sh.getLastRow(), lastCol: sh.getLastColumn() };
    });

    const auditSh = _auditSheetByName_(ss, ['auditlog', 'auditlogs', 'AuditLog', 'AuditLogs']);
    var sample = [];
    var headerRow = [];
    if (auditSh && auditSh.getLastRow() >= 1) {
      headerRow = auditSh.getRange(1, 1, 1, Math.max(1, auditSh.getLastColumn())).getValues()[0];
      if (auditSh.getLastRow() >= 2) {
        var readRows = Math.min(3, auditSh.getLastRow() - 1);
        sample = auditSh.getRange(2, 1, readRows, Math.max(1, auditSh.getLastColumn())).getValues().map(function(r) {
          return r.map(function(v) { return (v instanceof Date) ? v.toISOString() : String(v).slice(0, 120); });
        });
      }
    }

    return {
      success: true,
      ssId: ssId,
      sheets: sheets,
      auditSheetFound: !!auditSh,
      auditSheetName: auditSh ? auditSh.getName() : null,
      auditLastRow: auditSh ? auditSh.getLastRow() : 0,
      auditLastCol: auditSh ? auditSh.getLastColumn() : 0,
      headerRow: headerRow,
      sampleRows: sample
    };
  } catch (e) {
    return { success: false, error: (e && e.message) ? e.message : String(e) };
  }
}

// ============================================================
// CURRICULUM / SETTINGS
// ============================================================
function saveChunkedCurriculum_(payload, token) {
  try {
    const ss  = getSS_();
    let sh    = ss.getSheetByName('Settings');
    if (!sh) { sh = ss.insertSheet('Settings'); sh.appendRow(['KEY','VALUE','LAST_UPDATED']); sh.setFrozenRows(1); }
    const data = sh.getDataRange().getValues();
    const now  = new Date();
    for (const levelId in payload) {
      const key     = 'CURRICULUM_' + String(levelId).toUpperCase();
      const jsonStr = JSON.stringify(payload[levelId]);
      let rowIdx = -1;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === key) { rowIdx = i+1; break; }
      }
      if (rowIdx !== -1) sh.getRange(rowIdx, 2, 1, 2).setValues([[jsonStr, now]]);
      else sh.appendRow([key, jsonStr, now]);
    }
    const curriculum = _readFullCurriculum(ss);
    const iCurr = data.findIndex(r => String(r[0]).trim() === 'SCHOOL_CURRICULUM');
    const currStr = JSON.stringify(curriculum);
    if (iCurr > 0) sh.getRange(iCurr+1, 2, 1, 2).setValues([[currStr, now]]);
    else sh.appendRow(['SCHOOL_CURRICULUM', currStr, now]);
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function _readFullCurriculum(ss) {
  const cacheKey = 'CURRICULUM_CACHE_' + (ss ? ss.getId() : 'MAIN');
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Check if cache is still valid (within 25 minutes)
      if (parsed._timestamp && (Date.now() - parsed._timestamp) < 1500000) {
        if (parsed._data) return parsed._data;
        const curriculum = { ...parsed };
        delete curriculum._timestamp;
        return curriculum;
      }
    } catch(e) {}
  }
  const curriculum = {};
  const sh = ss ? ss.getSheetByName('Settings') : getSS_().getSheetByName('Settings');
  if (!sh) return curriculum;
  const data = sh.getDataRange().getValues();
  data.slice(1).forEach(r => {
    const key = String(r[0]).trim();
    if (key.startsWith('CURRICULUM_')) {
      const levelId = key.replace('CURRICULUM_','').toLowerCase();
      try { curriculum[levelId] = JSON.parse(r[1]); } catch(e) {}
    }
  });
  _safeCachePut(cacheKey, JSON.stringify(curriculum), 1800); // 30 min cache
  return curriculum;
}

function syncSubjectsInSettings_(ss, curriculumObj) {
  if (!curriculumObj || typeof curriculumObj !== 'object') return;
  saveChunkedCurriculum_(curriculumObj, null);
}

function getSubjectsByLevel_(level) {
  try {
    const conf = getSaaSSettings_().data;
    const curr = conf.SCHOOL_CURRICULUM || _readFullCurriculum(getSS_());
    const subjects = curr[level] || curr[String(level).toLowerCase()] || [];
    return subjects.map(s => ({ id:s.subjectId||s.id, label:s.label }));
  } catch(e) { return []; }
}

function _extractCurriculumLevelsFromMessage_(messageText) {
  var txt = _normalizeAiPromptToken_(messageText || '');
  var levels = [];
  var add = function(k) { if (levels.indexOf(k) === -1) levels.push(k); };
  if (/maternelle|mat\b|prescol|ps\b|ms\b|gs\b/.test(txt)) add('maternelle');
  if (/fondamental|primaire|af\b/.test(txt)) add('fondamental');
  if (/secondaire|ns1|ns2|ns3|ns4/.test(txt)) add('secondaire');
  return levels;
}

// ============================================================
// PROMOTION ENGINE
// ============================================================
function _toNumberSafe_(value, fallback) {
  const n = Number(value);
  return isNaN(n) ? fallback : n;
}

function _toBooleanSafe_(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return !!fallback;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'oui', 'on', 'active'].includes(s)) return true;
  if (['0', 'false', 'no', 'non', 'off', 'inactive'].includes(s)) return false;
  return !!fallback;
}

function _normalizeGradingPolicy_(conf) {
  const raw = conf && conf.GRADING_POLICY;
  let parsed = null;
  if (raw && typeof raw === 'object') parsed = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  }

  const policy = parsed || {};
  return {
    promotionThreshold: _toNumberSafe_(
      policy.promotionThreshold,
      _toNumberSafe_(conf.PROMOTION_MIN_AVG, _toNumberSafe_(conf.MIN_PASSING_AVG, 60))
    ),
    remedialThreshold: _toNumberSafe_(
      policy.remedialThreshold,
      _toNumberSafe_(conf.MIN_ADJOURN_AVG, 40)
    ),
    minSubjectAvg: _toNumberSafe_(
      policy.minSubjectAvg,
      _toNumberSafe_(conf.MIN_SUBJECT_AVG, 50)
    ),
    maxFailures: Math.max(0, Math.floor(_toNumberSafe_(policy.maxFailures, _toNumberSafe_(conf.MAX_SUBJECT_FAILURES, 0)))),
    allowCompensation: _toBooleanSafe_(policy.allowCompensation, _toBooleanSafe_(conf.ALLOW_COMPENSATION, true)),
    roundingMode: String(policy.roundingMode || conf.ROUNDING_MODE || 'ROUND').toUpperCase(),
    missingPeriodPolicy: String(policy.missingPeriodPolicy || conf.MISSING_PERIOD_POLICY || 'ZERO').toUpperCase()
  };
}

function _applyRoundingMode_(value, roundingMode) {
  const v = _toNumberSafe_(value, 0);
  switch (String(roundingMode || '').toUpperCase()) {
    case 'FLOOR': return Math.floor(v * 100) / 100;
    case 'CEIL': return Math.ceil(v * 100) / 100;
    default: return Math.round(v * 100) / 100;
  }
}

function _decidePromotionByPolicy_(ctx) {
  const yearlyAvg = _toNumberSafe_(ctx.yearlyAvg, 0);
  const failures = Math.max(0, Math.floor(_toNumberSafe_(ctx.failures, 0)));
  const missingPeriods = Math.max(0, Math.floor(_toNumberSafe_(ctx.missingPeriods, 0)));
  const policy = ctx.policy || _normalizeGradingPolicy_({});

  const minRegularFailures = policy.allowCompensation ? policy.maxFailures : 0;
  const canPromote = yearlyAvg >= policy.promotionThreshold && failures <= minRegularFailures;
  const canAdjourn = yearlyAvg >= policy.remedialThreshold;

  let decision = 'REPEATED';
  let aiComment = 'Moyenne insuffisante pour validation.';

  if (canPromote) {
    decision = 'PROMOTED';
    aiComment = failures > 0
      ? 'Promotion validee avec compensation autorisee par la politique.'
      : 'Promotion validee selon les seuils configures.';
  } else if (canAdjourn) {
    decision = 'ADJOURNED';
    aiComment = 'Resultat en zone de rattrapage. Decision ajournee recommandee.';
  }

  if (missingPeriods > 0) {
    if (policy.missingPeriodPolicy === 'REPEAT') {
      decision = 'REPEATED';
      aiComment = 'Periodes manquantes detectees: repetition imposee par la politique.';
    } else if (policy.missingPeriodPolicy === 'ADJOURN' && decision === 'PROMOTED') {
      decision = 'ADJOURNED';
      aiComment = 'Periodes manquantes detectees: decision ajournee par prudence.';
    }
  }

  let riskScore = Math.max(0, Math.min(100, Math.round(100 - yearlyAvg)));
  if (failures > 0) riskScore = Math.min(100, riskScore + failures * 8);
  if (missingPeriods > 0) riskScore = Math.min(100, riskScore + missingPeriods * 6);

  return { decision, aiComment, riskScore };
}

function getPromotionDecision_(payload) {
  try {
    let studentId='', targetYear='';
    if (typeof payload === 'object' && payload !== null) {
      studentId  = String(payload.studentId||'').trim();
      targetYear = String(payload.targetYear||'').trim();
    } else studentId = String(payload||'').trim();
    if (!studentId) throw new Error('Matricule manquant.');
    const conf = getSaaSSettings_(null, targetYear||null).data;
    const ss   = getSS_(targetYear||null);
    const policy = _normalizeGradingPolicy_(conf);
    const totalTerms = Math.max(1, parseInt(conf.TOTAL_TERMS || 4, 10) || 4);
    const curriculum = conf.SCHOOL_CURRICULUM || _readFullCurriculum(ss);
    let level = null;
    const histMap = _buildActiveHistoryMap(ss);
    const hist    = histMap[studentId.toUpperCase().trim()];
    if (hist) level = hist.level;
    if (!level) level = resolveStudentCurrentLevelFromSheet_(studentId, ss);
    if (!level) throw new Error('Classe introuvable pour ' + studentId);
    const levelSubjects = curriculum[level] || curriculum[level.toLowerCase()];
    if (!levelSubjects || !levelSubjects.length)
      return {
        success:true,
        decision:'NO_DATA',
        yearlyAvg:'0.00',
        riskScore:50,
        aiComment:'Programme non defini pour ' + level,
        subjectAnalysis:[],
        summary:[],
        stabilityIndex:0,
        statusColor:'#64748b'
      };
    const coefMap = {};
    // Alias index : permet de retrouver un sujet via son label OU son id,
    // peu importe la casse / accents / espaces. Indispensable car les notes
    // sont enregistrées avec le LIBELLÉ comme SubjectID (cf. dropdown du
    // modal de saisie), alors que la curriculum-config peut utiliser un
    // identifiant technique (uuid, slug, code...).
    const subjectAliasIndex = {};
    const _normSubKey_ = function(v){
      return String(v == null ? '' : v)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
    };
    let totalMaxPts = 0;
    levelSubjects.forEach(s => {
      const sid = s.subjectId||s.id;
      if (!sid) return;
      const pts = _toNumberSafe_(s.points||s.coef, 100);
      const rawMinScore = s.minRequiredScore !== undefined ? s.minRequiredScore : (s.minScore !== undefined ? s.minScore : (s.requiredMin !== undefined ? s.requiredMin : null));
      coefMap[sid] = {
        label:s.label || sid,
        points:pts,
        isCritical: _toBooleanSafe_(s.isCritical, _toBooleanSafe_(s.isMajor, false)),
        minRequiredScore: rawMinScore !== null ? _toNumberSafe_(rawMinScore, null) : null
      };
      // Indexer toutes les clés possibles vers ce sujet
      [s.subjectId, s.id, s.label, s.name, s.subject, s.code].forEach(function(alias){
        const key = _normSubKey_(alias);
        if (key) subjectAliasIndex[key] = sid;
      });
      // Les options du dropdown de saisie utilisent les LABELS de branches
      // quand celles-ci existent ; il faut donc aussi pouvoir les retrouver.
      if (Array.isArray(s.branches)) {
        s.branches.forEach(function(b){
          if (!b) return;
          [b.id, b.label, b.name, b.subject, b.Subject, b.code].forEach(function(alias){
            const key = _normSubKey_(alias);
            if (key && !subjectAliasIndex[key]) subjectAliasIndex[key] = sid;
          });
        });
        // Index merged group labels too (e.g. "Trigonométrie/Géométrie") so a
        // grade entered against the bulletin display label still resolves to
        // the parent subject. Mirrors mergeBranchesByDisplayGroup_ in frontend.
        var _groups = {};
        var _groupOrder = [];
        s.branches.forEach(function(b){
          if (!b) return;
          var g = String(b.group || '').trim();
          if (!g) return;
          if (!_groups[g]) { _groups[g] = []; _groupOrder.push(g); }
          _groups[g].push(String(b.label || b.name || '').trim());
        });
        _groupOrder.forEach(function(g){
          var members = _groups[g].filter(Boolean);
          if (members.length < 2) return;
          var mergedLabel = members.join('/');
          var key = _normSubKey_(mergedLabel);
          if (key && !subjectAliasIndex[key]) subjectAliasIndex[key] = sid;
        });
      }
      totalMaxPts += pts;
    });
    const divisor = totalMaxPts > 0 ? totalMaxPts/100 : 1;
    const shG = ss.getSheetByName('grades');
    const gradeMap = {};
    const cacheKey = 'STUDENT_GRADES_' + studentId.toUpperCase() + '_' + ss.getId();
    const cachedGrades = CacheService.getScriptCache().get(cacheKey);
    if (cachedGrades) {
      try {
        const parsed = JSON.parse(cachedGrades);
        if (parsed._timestamp && (Date.now() - parsed._timestamp) < 1500000) {
          if (parsed._data) Object.assign(gradeMap, parsed._data);
          else {
            Object.assign(gradeMap, parsed);
            delete gradeMap._timestamp;
          }
        }
      } catch(e) {
        // Cache corrupted, rebuild
      }
    }
    if (Object.keys(gradeMap).length === 0 && shG && shG.getLastRow() > 1) {
      const gData = shG.getDataRange().getValues();
      const gH    = gData[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
      const iSid  = gH.indexOf('STUDENTID');
      const iSub  = gH.indexOf('SUBJECTID');
      const iPer  = gH.indexOf('PERIODID');
      const iScr  = gH.indexOf('SCORE');
      const iJs   = gH.indexOf('SCORESJSON');
      for (let i=1;i<gData.length;i++) {
        if (String(gData[i][iSid]||'').trim().toUpperCase() === studentId.toUpperCase()) {
          const r = gData[i];
          const rawSub = String(r[iSub]).trim();
          if (!rawSub) continue;
          // Tolérance : accepter une correspondance par id OU par libellé
          // (insensible à la casse / aux accents) car les notes sont stockées
          // avec le label saisi dans le dropdown du modal de saisie.
          let sub = coefMap[rawSub] ? rawSub : (subjectAliasIndex[_normSubKey_(rawSub)] || '');
          if (!sub || !coefMap[sub]) continue;
          if (!gradeMap[sub]) gradeMap[sub] = {};
          if (iJs !== -1 && r[iJs]) {
            try {
              const sj = JSON.parse(r[iJs]);
              for (let p=0;p<totalTerms;p++) {
                const pKey = 'T'+(p+1);
                if (sj[pKey] !== undefined && sj[pKey] !== null && sj[pKey] !== '') {
                  const parsedScore = parseFloat(sj[pKey]);
                  if (!isNaN(parsedScore)) gradeMap[sub][p] = parsedScore;
                }
              }
            } catch(e) {}
          } else {
            const per = parseInt(String(r[iPer]).replace(/\D/g,'')) - 1;
            const sc  = parseFloat(r[iScr]);
            if (!isNaN(per) && !isNaN(sc) && per >= 0 && per < totalTerms)
              gradeMap[sub][per] = sc;
          }
        }
      }
      _safeCachePut(cacheKey, JSON.stringify(gradeMap), 1800); // 30 min cache
    }
    let studentTotalPts = 0;
    const details = [];
    const termSums = new Array(totalTerms).fill(0);
    const termCounts = new Array(totalTerms).fill(0);
    let totalFailures = 0;
    let missingPeriods = 0;

    levelSubjects.forEach(subObj => {
      const sId  = subObj.subjectId||subObj.id;
      if (!sId || !coefMap[sId]) return;
      const pts  = coefMap[sId] ? coefMap[sId].points : 100;
      const mult = pts/100;
      const timeline = [];
      const terms = {};
      let localSum = 0;
      let localCount = 0;
      for (let p=0;p<totalTerms;p++) {
        const hasScore = gradeMap[sId] && gradeMap[sId][p] !== undefined;
        const raw = hasScore ? _toNumberSafe_(gradeMap[sId][p], 0) : null;
        const resolved = raw === null ? (policy.missingPeriodPolicy === 'ZERO' ? 0 : null) : raw;
        if (raw === null) missingPeriods++;
        terms['T'+(p+1)] = resolved === null ? '' : resolved;
        timeline.push(resolved === null ? 0 : resolved);
        if (resolved !== null) {
          localSum += resolved;
          localCount++;
          termSums[p] += resolved;
          termCounts[p] += 1;
        }
      }
      const subAvg100 = localCount > 0 ? (localSum / localCount) : 0;
      const acquired  = subAvg100 * mult;
      const subjectMinScore = (coefMap[sId].minRequiredScore !== null && coefMap[sId].minRequiredScore !== undefined)
        ? coefMap[sId].minRequiredScore
        : policy.minSubjectAvg;
      const failedSubject = subAvg100 < subjectMinScore;
      if (failedSubject) totalFailures++;
      studentTotalPts += acquired;

      const detailRow = {
        subject:coefMap[sId] ? coefMap[sId].label : sId,
        average:parseFloat(subAvg100.toFixed(2)),
        points:parseFloat(acquired.toFixed(2)),
        max:pts,
        timeline:timeline,
        isCritical: !!coefMap[sId].isCritical,
        minRequiredScore: subjectMinScore,
        failed: failedSubject
      };
      for (let t=0;t<Math.min(4,totalTerms);t++) detailRow['T'+(t+1)] = terms['T'+(t+1)];
      details.push(detailRow);
    });

    const yearlyAvgRaw = (studentTotalPts/divisor);
    const mg = _applyRoundingMode_(yearlyAvgRaw, policy.roundingMode);

    const summary = [];
    const periodAverages = [];
    for (let p=0;p<totalTerms;p++) {
      const avg = termCounts[p] > 0 ? (termSums[p] / termCounts[p]) : 0;
      const avgRounded = _applyRoundingMode_(avg, policy.roundingMode);
      periodAverages.push(avgRounded);
      summary.push({ period:'T'+(p+1), average:avgRounded.toFixed(2) });
    }

    let stabilityIndex = 100;
    if (periodAverages.length > 1) {
      const mean = periodAverages.reduce((a,b)=>a+b,0) / periodAverages.length;
      const variance = periodAverages.reduce((a,b)=>a + Math.pow(b-mean,2), 0) / periodAverages.length;
      const stddev = Math.sqrt(variance);
      stabilityIndex = Math.max(0, Math.min(100, Math.round(100 - stddev * 2.5)));
    }

    const decisionPack = _decidePromotionByPolicy_({
      yearlyAvg: mg,
      failures: totalFailures,
      missingPeriods: missingPeriods,
      policy: policy
    });

    const statusColor = decisionPack.decision === 'PROMOTED'
      ? '#16a34a'
      : (decisionPack.decision === 'ADJOURNED' ? '#d97706' : '#dc2626');

    return {
      success:true,
      decision:decisionPack.decision,
      yearlyAvg:mg.toFixed(2),
      riskScore:decisionPack.riskScore,
      aiComment:decisionPack.aiComment,
      subjectAnalysis:details,
      summary:summary,
      periodAverages:summary.reduce(function(acc, row){ acc[row.period] = row.average; return acc; }, {}),
      stabilityIndex:stabilityIndex,
      statusColor:statusColor,
      failures:totalFailures,
      policySnapshot:policy,
      meta:{ historicClass:level, currentLevel:level, missingPeriods:missingPeriods }
    };
  } catch(e) { return { success:false, error:e.message }; }
}

// ── processPromotionDecision_ ────────────────────────────────
/**
 * Records the promotion outcome by appending a new STATUS row
 * (PROMOTED / REPEATED / ADJOURNED) and, for PROMOTED & REPEATED,
 * immediately appends an ACTIVE row for the next academic year.
 * The existing history rows are NEVER modified.
 */
function processPromotionDecision_(payload) {
  try {
    payload = payload || {};
    const sid = String(payload.studentId || '').trim();
    if (!sid) throw new Error('Matricule manquant.');

    const conf = getSaaSSettings_().data;
    const ss   = getSS_();
    const shH  = ss.getSheetByName('studenthistory');
    if (!shH) throw new Error('studenthistory introuvable.');

    let finalDecision = String(payload.decision || '').trim().toUpperCase();
    if (!['PROMOTED', 'REPEATED', 'ADJOURNED'].includes(finalDecision)) {
      const autoDecision = getPromotionDecision_({ studentId: sid });
      if (!autoDecision || !autoDecision.success) {
        throw new Error((autoDecision && autoDecision.error) || 'Decision automatique indisponible.');
      }
      finalDecision = String(autoDecision.decision || '').trim().toUpperCase();
      if (!['PROMOTED', 'REPEATED', 'ADJOURNED'].includes(finalDecision)) {
        throw new Error('Decision invalide: ' + finalDecision);
      }
    }
 
    const data = shH.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iHid  = h.indexOf('HISTORYID');
    const iSid  = h.indexOf('STUDENTID');
    const iStat = h.indexOf('STATUS');
    const iLvl  = h.indexOf('GRADELEVELID');
    const iSec  = h.indexOf('SECTION');
    const iYear = h.indexOf('SCHOOLYEAR');
    const iTs   = h.indexOf('TIMESTAMP');
    const iUpd  = h.indexOf('UPDATEDAT');
 
    // Find the student's LATEST (current) row — read-only reference
    const currentRow = _getLatestHistoryRow_(data, h, sid);
    if (!currentRow) throw new Error('Historique introuvable pour ' + sid);
 
    const currentLevel = currentRow[iLvl];
    const currentSec   = currentRow[iSec];
 
    // ── Step 1: Append a closure row with the promotion decision ──────────
    const closureRow            = currentRow.slice();
    if (iHid  !== -1) closureRow[iHid]  = 'HIS-' + Utilities.getUuid().substring(0,8);
    if (iStat !== -1) closureRow[iStat] = finalDecision;   // PROMOTED | REPEATED | ADJOURNED
    if (iTs   !== -1) closureRow[iTs]   = new Date();
    if (iUpd  !== -1) closureRow[iUpd]  = new Date();
 
    shH.appendRow(closureRow);  // ← original row untouched
 
    // ── Step 2: For PROMOTED and REPEATED open a fresh ACTIVE enrollment ──
    if (['PROMOTED', 'REPEATED'].includes(finalDecision)) {
      let nextLevel = currentLevel;
 
      if (finalDecision === 'PROMOTED') {
        const levels = Array.isArray(conf.ACTIVE_LEVELS) ? conf.ACTIVE_LEVELS : [];
        const ci     = levels.findIndex(l => l.id === currentLevel);
        nextLevel    = (ci !== -1 && ci + 1 < levels.length)
          ? levels[ci + 1].id
          : 'ALUMNI';
      }
      // REPEATED ➜ stays in the same level (nextLevel = currentLevel already)
 
      const nextYear   = conf.ACADEMIC_YEAR || '';
      const activeRow  = new Array(data[0].length).fill('');
      if (iHid  !== -1) activeRow[iHid]  = 'HIS-' + Utilities.getUuid().substring(0,8);
      if (iSid  !== -1) activeRow[iSid]  = sid;
      if (iYear !== -1) activeRow[iYear] = nextYear;
      if (iLvl  !== -1) activeRow[iLvl]  = nextLevel;
      if (iSec  !== -1) activeRow[iSec]  = currentSec;
      if (iStat !== -1) activeRow[iStat] = 'ACTIVE';
      if (iTs   !== -1) activeRow[iTs]   = new Date();
      if (iUpd  !== -1) activeRow[iUpd]  = new Date();
 
      shH.appendRow(activeRow);
    }
 
    writeAuditLog_('PROMOTION', sid, finalDecision, 'p_audit');
    return { success: true, status: finalDecision, studentId: sid };
  } catch(e) { return { success: false, error: e.message }; }
}
 

// ============================================================
// DASHBOARD & ANALYTICS
// ============================================================
function getDashboardLiveStats_(auth) {
  try {
    const ss = getSS_();
    let totalStudents=0, totalPayments=0, presentToday=0, pendingPayments=0, totalOutstanding=0;
    let financeConfigOk = true;
    let financeConfigWarning = '';
    const settingsRes = getSaaSSettings_(auth);
    const conf = (settingsRes && settingsRes.success && settingsRes.data && typeof settingsRes.data === 'object') ? settingsRes.data : {};

    const toNumber = function(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const hasPositiveValue = function(v) {
      return toNumber(v) > 0;
    };

    const getFinanceConfigDiagnostic = function() {
      try {
        const mode = String(conf.TUITION_MODE || 'GLOBAL').trim().toUpperCase();
        const classPlans = parseTuitionConfigValue_(conf.classPaymentPlans) || {};
        const classPlanConfiguredCount = Object.keys(classPlans || {}).filter(function(k) {
          const item = classPlans[k];
          if (!item || typeof item !== 'object') return false;
          const direct = toNumber(item.totalAmount || item.amount);
          if (direct > 0) return true;
          const predefinedTotal = (Array.isArray(item.predefinedPayments) ? item.predefinedPayments : []).reduce(function(sum, row) {
            return sum + toNumber((row && row.amount) || 0);
          }, 0);
          if (predefinedTotal > 0) return true;
          return Object.keys(item).some(function(key) { return hasPositiveValue(item[key]); });
        }).length;
        const hasClassPlanAmount = classPlanConfiguredCount > 0;

        if (mode === 'BY_CLASS') {
          const byClass = parseTuitionConfigValue_(conf.TUITION_BY_CLASS) || {};
          const keys = Object.keys(byClass || {});
          const configuredCount = keys.filter(function(k) { return hasPositiveValue(byClass[k]); }).length;
          if (!configuredCount && !hasClassPlanAmount) {
            return {
              ok: false,
              warning: 'Configuration des frais incomplète: aucun montant de scolarité par classe n\'est défini.'
            };
          }
          return { ok: true, warning: '' };
        }

        if (mode === 'BY_CYCLE') {
          const byCycle = parseTuitionConfigValue_(conf.TUITION_BY_CYCLE) || {};
          const keys = Object.keys(byCycle || {});
          const configuredCount = keys.filter(function(k) { return hasPositiveValue(byCycle[k]); }).length;
          if (!configuredCount && !hasClassPlanAmount) {
            return {
              ok: false,
              warning: 'Configuration des frais incomplète: aucun montant de scolarité par cycle n\'est défini.'
            };
          }
          return { ok: true, warning: '' };
        }

        if (!hasPositiveValue(conf.TUITION_AMOUNT_GLOBAL) && !hasPositiveValue(conf.TUITION_AMOUNT) && !hasClassPlanAmount) {
          return {
            ok: false,
            warning: 'Configuration des frais incomplète: le montant global de scolarité est manquant.'
          };
        }

        return { ok: true, warning: '' };
      } catch (diagErr) {
        return {
          ok: false,
          warning: 'Configuration des frais indisponible: ' + (diagErr && diagErr.message ? diagErr.message : 'erreur inconnue')
        };
      }
    };

    const financeDiag = getFinanceConfigDiagnostic();
    financeConfigOk = !!(financeDiag && financeDiag.ok);
    financeConfigWarning = financeDiag && financeDiag.warning ? String(financeDiag.warning) : '';

    // FIX: count only students with an ACTIVE history entry for the current year,
    // not all rows in the sheet (which includes inactive/dropped/retired students).
    try {
      const activeHistMap = _buildActiveHistoryMap(ss);
      totalStudents = Object.keys(activeHistMap).length;
    } catch(_countErr) {
      const shS = ss.getSheetByName('students');
      if (shS) totalStudents = Math.max(0, shS.getLastRow() - 1); // fallback
    }
    const paidByStudent = {};
    const dueByStudent = {};
    const shF = ss.getSheetByName('Finance');
    if (shF && shF.getLastRow() > 1) {
      const fData = shF.getDataRange().getValues();
      const fH    = fData[0].map(x => String(x).trim());
      const iAmt  = fH.indexOf('Amount');
      const iAmtPaid = fH.indexOf('AmountPaid');
      const iDue = fH.indexOf('AmountDue');
      const iTotDue = fH.indexOf('TotalDue');
      const iStat = fH.indexOf('Status');
      const iSid = fH.indexOf('StudentID');
      fData.slice(1).forEach(r => {
        const status = String((iStat >= 0 ? r[iStat] : '') || '').toUpperCase().trim();
        const paid = toNumber(iAmt >= 0 ? r[iAmt] : (iAmtPaid >= 0 ? r[iAmtPaid] : 0));
        const dueCandidate = toNumber(iDue >= 0 ? r[iDue] : (iTotDue >= 0 ? r[iTotDue] : paid));
        const due = Math.max(dueCandidate, paid);
        const sid = String(iSid >= 0 ? (r[iSid] || '') : '').trim();

        totalPayments += paid;
        if (status === 'PENDING' || status === 'PARTIAL') {
          pendingPayments++;
        }
        if (sid) {
          paidByStudent[sid] = (paidByStudent[sid] || 0) + paid;
          dueByStudent[sid] = Math.max(Number(dueByStudent[sid] || 0), due);
        }
      });
    }

    const allStudents = getAllStudents_() || [];
    const studentIds = {};
    allStudents.forEach(function(stu) {
      const sid = String(stu.StudentID || stu.StudentCode || stu.studentId || stu.id || '').trim();
      if (sid) studentIds[sid] = true;
    });
    Object.keys(paidByStudent).forEach(function(sid) { studentIds[sid] = true; });
    Object.keys(dueByStudent).forEach(function(sid) { studentIds[sid] = true; });

    pendingPayments = 0;
    totalOutstanding = 0;
    Object.keys(studentIds).forEach(function(sid) {
      const expectedDue = toNumber(getExpectedTuitionAmountForStudent_(sid, conf));
      const dueFromRows = toNumber(dueByStudent[sid] || 0);
      const paid = toNumber(paidByStudent[sid] || 0);
      const due = Math.max(expectedDue, dueFromRows, paid);
      const outstanding = Math.max(0, due - paid);
      if (outstanding > 0.001) pendingPayments++;
      totalOutstanding += outstanding;
    });

    const shA = ss.getSheetByName('attendance');
    if (shA && shA.getLastRow() > 1) {
      const tz    = Session.getScriptTimeZone();
      const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      const aData = shA.getDataRange().getValues();
      const aH    = aData[0].map(x => String(x).toUpperCase());
      const iDate = aH.indexOf('DATE');
      aData.slice(1).forEach(r => {
        const d = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate],tz,'yyyy-MM-dd') : String(r[iDate]);
        if (d === today) presentToday++;
      });
    }
    return {
      success:true,
      data:{
        totalStudents,
        totalPayments: totalPayments.toFixed(2),
        collecte: Number(totalPayments.toFixed(2)),
        presentToday,
        pendingPayments,
        unpaidCount: pendingPayments,
        outstanding: Number(totalOutstanding.toFixed(2)),
        financeConfigOk: financeConfigOk,
        financeConfigWarning: financeConfigWarning
      }
    };
  } catch(e) { return { success:false, error:e.message }; }
}

function getImmersiveData_(params, tokenOrViewer) {
  try {
    const studentId = resolveStudentId_(params);
    if (tokenOrViewer) {
      const guard = ensureViewerCanAccessStudentScope_(studentId, tokenOrViewer);
      if (!guard.success) return { success:false, error:guard.error };
    }
    const ss  = getSS_();
    const sh  = ss.getSheetByName('students');
    if (!sh) return { success:false, error:'students introuvable.' };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iCode= h.indexOf('STUDENTCODE');
    const iFn  = h.indexOf('FIRSTNAME');
    const iLn  = h.indexOf('LASTNAME');
    const iPic = h.indexOf('PHOTOURL');
    const row  = data.slice(1).find(r => String(r[iCode]).trim() === studentId);
    if (!row) return { success:false, error:'Identite introuvable: ' + studentId };
    const name = (row[iFn] + ' ' + row[iLn]).toUpperCase();
    let photo  = row[iPic]||'';
    if (photo.includes('drive.google.com')) {
      const m = photo.match(/id=([a-zA-Z0-9_-]+)/)||photo.match(/\/d\/([a-zA-Z0-9_-]+)\//);
      if (m) photo = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400';
    }
    if (!photo) photo = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=8b5cf6&color=fff';
    const dec = getPromotionDecision_(studentId);
    return { success:true, studentId, studentName:name, studentPhoto:photo, finalYearlyAvg:dec.success?dec.yearlyAvg:'0.00', decision:dec.success?dec.decision:'N/A', riskScore:dec.success?dec.riskScore:0, subjectAnalysis:dec.success?dec.subjectAnalysis:[], aiComment:dec.success?dec.aiComment:'Données insuffisantes.', timestamp:new Date(), meta: dec.success ? dec.meta : {} };
  } catch(e) { return { success:false, error:e.message }; }
}

// [F7] level populated from meta.historicClass
function getStudentBulletinData_(params, token) {
  try {
    const sid = String((params && params.studentId) || '').trim();
    const guard = ensureViewerCanAccessStudentScope_(sid, token);
    if (!guard.success) return { success:false, error:guard.error };
    const immersive = getImmersiveData_({ id:sid }, token);
    if (!immersive.success) return { success:false, error:immersive.error };
    const currentLevel = String(
      (immersive.meta && (immersive.meta.currentLevel || immersive.meta.historicClass))
      || resolveStudentCurrentLevelFromSheet_(sid)
      || ''
    ).trim();

    // ── Mode mono-matière : bâtir le bulletin sur les titres de devoirs ──
    // Chaque devoir noté devient une ligne du bulletin (au lieu des
    // matières classiques). La matière unique configurée sert d'en-tête.
    let scores = immersive.subjectAnalysis;
    let singleSubjectMode = false;
    let singleSubject = null;
    try {
      const cfg = (getSaaSSettings_(token) || {}).data || {};
      if (readBooleanConfigValue_(cfg, 'SINGLE_SUBJECT_MODE', false)) {
        singleSubjectMode = true;
        singleSubject = {
          name: String(cfg.SINGLE_SUBJECT_NAME || 'Cours').trim(),
          code: String(cfg.SINGLE_SUBJECT_CODE || '').trim(),
          coef: Number(cfg.SINGLE_SUBJECT_COEF || 1) || 1
        };
        scores = _buildHomeworkBulletinLines_(sid, currentLevel, singleSubject, token);
      }
    } catch (e) {
      try { console.warn('[BULLETIN] single-subject build failed: ' + e.message); } catch(_){}
    }

    return { success:true, singleSubjectMode, singleSubject, student:{
      id:      sid,
      name:    immersive.studentName,
      photo:   immersive.studentPhoto,
      level:   currentLevel,
      scores:  scores,
      periodAvg:       immersive.finalYearlyAvg,
      decision:        immersive.decision,
      subjectAnalysis: immersive.subjectAnalysis,
      singleSubjectMode: singleSubjectMode,
      singleSubject:    singleSubject,
      meta: immersive.meta || {}
    }};
  } catch(e) { return { success:false, error:e.message }; }
}

// Build bulletin "scores" rows where each homework TITLE becomes a line
// (used in SINGLE_SUBJECT_MODE — vocational / one-course schools).
// Output matches the shape consumed by the frontend bulletin renderer:
//   { subject, score, coeff, periodScores, max, due }
function _buildHomeworkBulletinLines_(studentId, className, singleSubject, token) {
  try {
    const listed = homeworkListForStudent_({ studentId: studentId, className: className }, { token: token });
    const rows = (listed && listed.rows) || [];
    if (!rows.length) return [];
    // How many periods to project each homework note onto.
    let numPeriods = 3;
    try {
      const cfg = (getSaaSSettings_(token) || {}).data || {};
      const n = Number(cfg.NUM_PERIODS || cfg.TOTAL_TERMS || 3);
      if (Number.isFinite(n) && n >= 2 && n <= 5) numPeriods = n;
    } catch(_){}
    const coefDefault = (singleSubject && Number(singleSubject.coef)) || 1;
    return rows
      .filter(function(r){ return r && r.status === 'GRADED' && Number(r.max_score) > 0; })
      .map(function(r){
        const max = Number(r.max_score) || 20;
        const raw = Number(r.score) || 0;
        // Normalise on /20 so the bulletin pipeline (which assumes /20) reads
        // consistent values regardless of the homework's own max scale.
        const on20 = Math.round((raw / max) * 20 * 10) / 10;
        // Spread same value across configured periods so column-by-period
        // renderers don't show empty cells.
        const periodScores = [];
        for (let i = 0; i < numPeriods; i++) periodScores.push(on20);
        return {
          subject: String(r.title || '').trim() || 'Devoir',
          score:   on20,
          coeff:   coefDefault,
          max:     max,
          due:     r.due_date || '',
          periodScores: periodScores,
          // Keep raw values for richer renderers / exports
          rawScore: raw,
          homeworkId: r.id || ''
        };
      });
  } catch(e) {
    try { console.warn('_buildHomeworkBulletinLines_ failed: ' + e.message); } catch(_){}
    return [];
  }
}

function getComplexReportData_(params, token) {
  try {
    const sid = resolveStudentId_(params);
    const guard = ensureViewerCanAccessStudentScope_(sid, token);
    if (!guard.success) return { success:false, error:guard.error };
    const imm = getImmersiveData_({ id:sid }, token);
    if (!imm.success) return { success:false, error:'Élève introuvable.' };
    const result = { success:true, studentId:sid, studentName:imm.studentName, studentPhoto:imm.studentPhoto, sections:params.sections };
    if ((params.sections||[]).includes('ACADEMIC')) result.academic = { avg:imm.finalYearlyAvg, decision:imm.decision };
    if ((params.sections||[]).includes('FINANCE')) { const fp = getStudentFinanceProfile_(sid); result.finance = { totalPaid:fp.totalPaid||0 }; }
    if ((params.sections||[]).includes('ATTENDANCE')) { const as2 = getStudentAttendanceStats_(sid); result.attendance = as2.success ? as2.stats : {}; }
    return result;
  } catch(e) { return { success:false, error:e.message }; }
}

function getUniversalAnalytics_(params, token) {
  try {
    const guard = (params && params.scope === 'STUDENT')
      ? ensureViewerCanAccessStudentScope_(params.targetId, token)
      : { success: true };
    if (!guard.success) return { success:false, error:guard.error };
    const result = { success:true, metadata:params, data:{} };
    if (params.scope === 'STUDENT') { const d = getImmersiveData_({ id:params.targetId }, token); if (d.success) { result.studentName=d.studentName; result.data.base=d; } }
    if ((params.metrics||[]).includes('ACADEMIC')) { const s = getStudentScores_(params.targetId); result.data.academic = { count:s.length, avg:s.length ? (s.reduce((a,b)=>a+(b.Score||0),0)/s.length).toFixed(2) : '0.00' }; }
    return result;
  } catch(e) { return { success:false, error:e.message }; }
}

function getClassComparisonData_(params, token) {
  try {
    const req = params || {};
    const selectedLevel = String(req.level || '').trim();
    const viewer = token ? getViewerInfo_(token) : null;

    // ── Cache 5 min côté serveur (clé = level + scope viewer) ──────────────
    // Avant : recalcul complet à chaque ouverture du dashboard (N appels à
    // getPromotionDecision_ → timeout silencieux). Maintenant : recalcul une
    // fois toutes les 5 min, le reste du temps cache hit instantané.
    const scopeKey = viewer
      ? (viewer.isMaster || viewer.isGodMode ? '__god__' : String(viewer.email || viewer.studentCode || '').toLowerCase())
      : '__anon__';
    const cacheVersion = _getClassComparisonCacheVersion_();
    const cacheKey = 'CLASS_COMP_v2_' + Utilities.base64EncodeWebSafe(selectedLevel + '|' + scopeKey + '|v' + cacheVersion);
    if (!req.force) {
      const cached = _safeCacheGetData_(cacheKey);
      if (cached && cached.success) {
        cached._cached = true;
        return cached;
      }
    }

    const ss = getSS_();
    const students = filterStudentsByViewerScope_(getAllStudents_() || [], viewer);

    const normalizeLevel = function(v) {
      return String(v || '').trim().toUpperCase();
    };
    const resolveLevel = function(s) {
      return String(s.CurrentLevel || s.currentLevel || s.level || s.GradeLevel || '').trim();
    };
    const resolveStudentId = function(s) {
      return String(s.StudentCode || s.studentCode || s.StudentID || s.studentId || s.id || '').trim();
    };

    const byLevel = {};
    const studentLevelById = {};   // sid → level
    students.forEach(function(s) {
      const level = resolveLevel(s);
      const sid = resolveStudentId(s);
      if (!level || !sid) return;
      if (!byLevel[level]) byLevel[level] = [];
      byLevel[level].push({ id: sid, row: s });
      studentLevelById[sid.toUpperCase()] = level;
    });

    const allLevels = Object.keys(byLevel);
    const selectedNorm = normalizeLevel(selectedLevel);

    // ── PASS 1 : lire la feuille `attendance` UNE SEULE FOIS ──────────────
    const shA = ss.getSheetByName('attendance');
    let attendanceRows = [];
    let attIdx = { sid: -1, status: -1, date: -1 };
    if (shA && shA.getLastRow() > 1) {
      attendanceRows = shA.getDataRange().getValues();
      const h = attendanceRows[0].map(function(x) { return String(x).toUpperCase().replace(/\s/g, ''); });
      attIdx.sid = h.indexOf('STUDENTID');
      attIdx.status = h.indexOf('STATUS');
      attIdx.date = h.indexOf('DATE');
    }

    const today = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const dayBuckets = [];
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(today.getTime() - d * dayMs);
      dayBuckets.push(Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    }

    // Pré-calculer les compteurs de présence par classe (1 seul scan)
    const attByLevel = {};
    allLevels.forEach(function(lvl){
      attByLevel[lvl] = {
        trendTotals:  [0,0,0,0,0,0,0],
        trendPresent: [0,0,0,0,0,0,0]
      };
    });
    if (attendanceRows.length > 1 && attIdx.sid !== -1 && attIdx.status !== -1 && attIdx.date !== -1) {
      for (var i = 1; i < attendanceRows.length; i++) {
        var row = attendanceRows[i];
        var sid = String(row[attIdx.sid] || '').trim().toUpperCase();
        var lvl = studentLevelById[sid];
        if (!lvl || !attByLevel[lvl]) continue;
        var rawDate = row[attIdx.date];
        var rowDate = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(rawDate || '').trim();
        var dayIndex = dayBuckets.indexOf(rowDate);
        if (dayIndex === -1) continue;
        var st = String(row[attIdx.status] || '').trim().toUpperCase();
        if (!st) continue;
        if (st === 'EXCUSED' || st === 'EXCUSE' || st === 'JUSTIFIED' || st === 'JUSTIFIE' || st === 'EJ' || st === 'EXC') continue;
        attByLevel[lvl].trendTotals[dayIndex]++;
        if (st === 'PRESENT' || st === 'P' || st === 'PRES' || st === 'ON_TIME'
            || st === 'LATE' || st === 'RETARD' || st === 'TARDY' || st === 'R') {
          attByLevel[lvl].trendPresent[dayIndex]++;
        }
      }
    }

    // ── PASS 2 : lire la feuille `grades` UNE SEULE FOIS ──────────────────
    // Avant : N appels à getPromotionDecision_(sid) → N lectures de la feuille.
    // Maintenant : 1 lecture, agrégation directe par élève → moyenne approchée.
    // Pour les bands de performance, on utilise la moyenne brute (PROMOTED si ≥
    // policy.promotionScore, REPEATED si < passing). C'est un peu moins précis
    // que la décision officielle (qui regarde aussi failures et critical
    // subjects) mais 100x plus rapide pour le dashboard. La page Promotion
    // continue d'appeler getPromotionDecision_ pour la décision exacte.
    const confResp = getSaaSSettings_(null, null);
    const conf = (confResp && confResp.data) || {};
    const policy = _normalizeGradingPolicy_(conf);
    const promotionThreshold = Number(policy.promotionThreshold || 60);
    const passingThreshold = Number(policy.remedialThreshold || policy.minSubjectAvg || 40);

    const shG = ss.getSheetByName('grades');
    const gradeAvgBySid = {};   // sid → { sum, count }  — toujours en pourcentage /100
    if (shG && shG.getLastRow() > 1) {
      const gData = shG.getDataRange().getValues();
      const gH = gData[0].map(function(x){ return String(x).toUpperCase().replace(/\s/g,''); });
      const iSid = gH.indexOf('STUDENTID');
      const iScr = gH.indexOf('SCORE');
      const iJs  = gH.indexOf('SCORESJSON');
      const iSub = gH.indexOf('SUBJECTID');

      // Construire un map subjectId → max score (depuis CURRICULUM_*) pour
      // normaliser les notes en /100. Sans cette étape, une école qui note
      // /20 verrait toutes ses moyennes calculées comme « 12 » au lieu de
      // « 60 » → en dessous du seuil promotionThreshold=60 → 0% partout.
      //
      // ⚠ NE JAMAIS utiliser `coef` comme max : `coef` est le coefficient
      // (poids du sujet, typiquement 1-5). Le confondre avec le max donnerait
      // p.ex. note=2 / coef=2 = 100% → tous les élèves promus → tous les
      // indicateurs à 100%. Ordre de priorité aligné sur le frontend
      // (getSubjectMaxScoreFromCurriculum_) : max → maxScore → points.
      var globalMax = Number((conf && (conf.maxScore || conf.MAXSCORE)) || 0);
      if (!(globalMax > 0)) globalMax = 100;
      const subjectMaxMap = {};
      Object.keys(conf || {}).forEach(function(k){
        if (!/^CURRICULUM_/.test(String(k).toUpperCase())) return;
        var arr = conf[k];
        if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch(_) { arr = null; } }
        if (!Array.isArray(arr)) return;
        arr.forEach(function(s){
          if (!s) return;
          var sId = String((s.subjectId || s.id) || '').trim();
          var maxV = Number((s.max || s.maxScore || s.points) || 0);
          if (sId && maxV > 0) subjectMaxMap[sId.toUpperCase()] = maxV;
          // Branches éventuelles
          if (Array.isArray(s.branches)) {
            s.branches.forEach(function(b){
              if (!b) return;
              var bId = String((b.id || b.label || b.name || b.subject || b.Subject) || '').trim();
              var bMax = Number((b.max || b.maxScore || b.points) || 0);
              if (bId && bMax > 0) subjectMaxMap[bId.toUpperCase()] = bMax;
            });
            // Group merging (e.g. "Trigonométrie/Géométrie" => sum of members)
            var _groups = {};
            var _order = [];
            s.branches.forEach(function(b){
              if (!b) return;
              var g = String(b.group || '').trim();
              if (!g) return;
              if (!_groups[g]) { _groups[g] = { labels:[], max:0 }; _order.push(g); }
              _groups[g].labels.push(String(b.label || b.name || '').trim());
              _groups[g].max += Number((b.max || b.maxScore || b.points) || 0);
            });
            _order.forEach(function(g){
              var info = _groups[g];
              var members = info.labels.filter(Boolean);
              if (members.length < 2) return;
              var lbl = members.join('/');
              if (lbl && info.max > 0) subjectMaxMap[lbl.toUpperCase()] = info.max;
            });
          }
        });
      });
      var pushScore = function(gsid, raw, subjId){
        var v = parseFloat(raw);
        if (isNaN(v)) return;
        var maxV = subjectMaxMap[String(subjId || '').toUpperCase()] || globalMax;
        // Conversion /100 (si max=100, identité)
        var pct = (v / maxV) * 100;
        if (pct < 0) pct = 0; else if (pct > 100) pct = 100;
        if (!gradeAvgBySid[gsid]) gradeAvgBySid[gsid] = { sum: 0, count: 0 };
        gradeAvgBySid[gsid].sum += pct;
        gradeAvgBySid[gsid].count++;
      };
      if (iSid !== -1) {
        for (var gi = 1; gi < gData.length; gi++) {
          var gsid = String(gData[gi][iSid] || '').trim().toUpperCase();
          if (!gsid || !studentLevelById[gsid]) continue;
          var subjId = iSub !== -1 ? String(gData[gi][iSub] || '').trim() : '';
          // Préférer SCORESJSON s'il existe (multi-période), sinon SCORE
          if (iJs !== -1 && gData[gi][iJs]) {
            try {
              var sj = JSON.parse(gData[gi][iJs]);
              Object.keys(sj).forEach(function(pKey){ pushScore(gsid, sj[pKey], subjId); });
            } catch (e) { /* ignore */ }
          } else if (iScr !== -1) {
            pushScore(gsid, gData[gi][iScr], subjId);
          }
        }
      }
    }

    const buildMetrics = function(levelName, members, levelKey) {
      if (!members || !members.length) {
        return {
          className: levelName || 'N/A',
          studentCount: 0,
          average: 0,
          presence: 0,
          progression: 0,
          successRate: 0,
          attendanceTrend: [0,0,0,0,0,0,0],
          performanceBands: { excellent: 0, bien: 0, passable: 0, alerte: 0 }
        };
      }

      var scoreSum = 0;
      var scoreCount = 0;
      var promoted = 0;
      var adjourned = 0;
      var repeated = 0;
      var perf = { excellent: 0, bien: 0, passable: 0, alerte: 0 };

      members.forEach(function(m) {
        var sidU = String(m.id).toUpperCase();
        var stat = gradeAvgBySid[sidU];
        if (!stat || !stat.count) return;
        var avg100 = stat.sum / stat.count;
        if (isNaN(avg100)) return;
        scoreSum += avg100;
        scoreCount++;

        // Bands : seuils paramétrés par la policy (PAS hardcodés)
        if (avg100 >= 80) perf.excellent++;
        else if (avg100 >= promotionThreshold) perf.bien++;
        else if (avg100 >= passingThreshold) perf.passable++;
        else perf.alerte++;

        // Décision approchée pour la progression (moyenne uniquement)
        if (avg100 >= promotionThreshold) promoted++;
        else if (avg100 >= passingThreshold) adjourned++;
        else repeated++;
      });

      var avg = scoreCount ? (scoreSum / scoreCount) : 0;
      var successRate = scoreCount ? (promoted * 100 / scoreCount) : 0;
      var progression = scoreCount ? ((promoted * 100 + adjourned * 60 + repeated * 25) / scoreCount) : 0;

      // Agrégation présence : si levelKey est passé (cas par-classe), on
      // utilise les compteurs précalculés. Sinon (cas global / multi-classes),
      // on agrège tous les niveaux concernés.
      var trendTotals  = [0,0,0,0,0,0,0];
      var trendPresent = [0,0,0,0,0,0,0];
      var levelsToAgg = levelKey ? [levelKey] : Object.keys(attByLevel);
      levelsToAgg.forEach(function(k){
        var src = attByLevel[k];
        if (!src) return;
        for (var d = 0; d < 7; d++) {
          trendTotals[d]  += src.trendTotals[d];
          trendPresent[d] += src.trendPresent[d];
        }
      });

      var trend = trendTotals.map(function(total, idx) {
        if (!total) return 0;
        return Math.round((trendPresent[idx] * 100 / total) * 10) / 10;
      });
      var presence = 0;
      var nonZeroTrend = trend.filter(function(v) { return v > 0; });
      if (nonZeroTrend.length) {
        presence = Math.round((nonZeroTrend.reduce(function(a,b){ return a + b; }, 0) / nonZeroTrend.length) * 10) / 10;
      }

      return {
        className: levelName,
        studentCount: members.length,
        average: Math.round(avg * 10) / 10,
        presence: Math.round(presence * 10) / 10,
        progression: Math.round(progression * 10) / 10,
        successRate: Math.round(successRate * 10) / 10,
        attendanceTrend: trend,
        performanceBands: perf,
        // Stages exposés au frontend (utilisés par _buildPromotionSummary_)
        // Évite la dépendance à window._ENROLLMENTS_CACHE côté client.
        promotionStages: [
          { label: 'Candidates', value: scoreCount, color: 'var(--sky)' },
          { label: 'Éligibles',  value: promoted,   color: 'var(--mint)' },
          { label: 'Révision',   value: adjourned,  color: 'var(--gold)' },
          { label: 'Bloquées',   value: repeated,   color: 'var(--coral)' }
        ]
      };
    };

    const metricsByClass = allLevels.map(function(level) {
      return buildMetrics(level, byLevel[level], level);
    });

    const flattenMembers = function(levels) {
      var items = [];
      levels.forEach(function(level) {
        (byLevel[level] || []).forEach(function(m) { items.push(m); });
      });
      return items;
    };

    const selectedLevels = selectedNorm
      ? allLevels.filter(function(level) { return normalizeLevel(level) === selectedNorm; })
      : allLevels.slice();
    const referenceLevels = selectedNorm
      ? allLevels.filter(function(level) { return normalizeLevel(level) !== selectedNorm; })
      : allLevels.slice();

    const selectedMetrics = buildMetrics(
      selectedLevels.length === 1 ? selectedLevels[0] : 'Toutes les classes',
      flattenMembers(selectedLevels),
      selectedLevels.length === 1 ? selectedLevels[0] : null
    );
    const referenceMetrics = buildMetrics(
      'Référence globale',
      flattenMembers(referenceLevels.length ? referenceLevels : allLevels)
    );

    const result = {
      success: true,
      data: {
        selectedClass: selectedLevels.length === 1 ? selectedLevels[0] : 'Toutes les classes',
        selected: selectedMetrics,
        reference: referenceMetrics,
        classes: metricsByClass,
        areas: [
          { key: 'average', label: 'Moyenne' },
          { key: 'presence', label: 'Presence' },
          { key: 'progression', label: 'Progression' },
          { key: 'successRate', label: 'Taux de reussite' }
        ],
        generatedAt: new Date().toISOString()
      }
    };
    // Cache 5 min — dashboard chart data n'a pas besoin d'être temps réel
    try { _safeCachePut(cacheKey, JSON.stringify(result), 300); } catch (e) { /* ignore */ }
    return result;
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// STAFF / USERS
// ============================================================
function getAllAdminUsers_(token) {
  try {
    const ss = getSS_();
    ensureInternalGodModeAccount_(ss);
    let sh = ensureUsersSheetStructure_(ss);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    const h = data[0].map(x => String(x).trim().toLowerCase());
    const find = (arr) => h.findIndex(x => arr.some(v => x.replace(/[\s_]/g,'') === v.replace(/[\s_]/g,'')));
    const idx = {
      userId:  find(['userid','id']),     name:    find(['name','nom']),
      email:   find(['email']),           role:    find(['role']),
      perms:   find(['permissionsjson','permissions']),
      active:  find(['active']),          isTeacher:find(['isteacher','is_teacher']),
      subjects:find(['assignedsubjects']), photo: find(['photo','photourl','avatarurl','picture'])
    };
    const parseBool = v => String(v).trim().toUpperCase() === 'TRUE';
    return data.slice(1).filter(r => r[idx.email] && String(r[idx.email]).includes('@')).map(r => {
      let parsedAssignments = [];
      if (idx.subjects > -1) {
        try { parsedAssignments = JSON.parse(r[idx.subjects] || '[]'); } catch(_err) { parsedAssignments = []; }
      }
      return {
        permissions:     idx.perms   > -1
          ? (String(r[idx.perms] || '').trim().toUpperCase() === 'GODMODE' ? 'GodMode' : parsePermissionsCell_(r[idx.perms]))
          : {},
        userId:          idx.userId  > -1 ? r[idx.userId]  : '',
        name:            idx.name    > -1 ? r[idx.name]    : '',
        email:           r[idx.email],
        role:            idx.role    > -1 ? r[idx.role]    : 'Staff',
        active:          idx.active  > -1 ? parseBool(r[idx.active]) : true,
        isTeacher:       idx.isTeacher > -1 ? parseBool(r[idx.isTeacher]) : false,
        photo:           idx.photo   > -1 ? String(r[idx.photo] || '').trim() : '',
        assignedSubjects:idx.subjects > -1 ? r[idx.subjects] : '',
        assignments:     parsedAssignments,
        isReadOnly:      idx.perms   > -1 ? isInternalReadOnlyPerms_(parsePermissionsCell_(r[idx.perms])) : false
      };
    });
  } catch(e) { return []; }
}

function getStaffList_() { return getAllAdminUsers_(null); }
function getStaffManagementData_(auth) {
  try {
    const users = getAllAdminUsers_(auth);
    const invalidUsers = getInvalidAdminUsers_();
    return { success:true, users:users, staff:users, invalidUsers:invalidUsers };
  }
  catch(e) { return { success:false, error:e.message }; }
}

function getInvalidAdminUsers_() {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];

    const h = data[0].map(x => String(x).trim().toLowerCase());
    const find = arr => h.findIndex(x => arr.some(v => x.replace(/[\s_]/g,'') === v.replace(/[\s_]/g,'')));
    const idx = {
      userId: find(['userid','id']),
      name:   find(['name','nom']),
      email:  find(['email']),
      role:   find(['role'])
    };
    if (idx.email === -1) return [];

    return data.slice(1)
      .filter(r => {
        const em = String(r[idx.email] || '').trim();
        return !!em && !em.includes('@');
      })
      .map(r => ({
        userId: idx.userId > -1 ? r[idx.userId] : '',
        name:   idx.name   > -1 ? r[idx.name]   : '',
        email:  String(r[idx.email] || '').trim(),
        role:   idx.role   > -1 ? r[idx.role]   : ''
      }));
  } catch(e) {
    return [];
  }
}

function updateUserRoleAndPerms_(data) {
  try {
    const ss = getSS_();
    let sh = ensureUsersSheetStructure_(ss);
 
    const rows = sh.getDataRange().getValues();
    const h    = rows[0].map(x => String(x).trim().toLowerCase());
    const find = arr =>
      h.findIndex(x => arr.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
 
    const idx = {
      id:        find(['userid', 'id']),
      name:      find(['name']),
      email:     find(['email']),
      role:      find(['role']),
      json:      find(['permissionsjson']),
      active:    find(['active']),
      pass:      find(['password']),
      reset:     find(['resetreq']),
      isTeacher: find(['isteacher']),
      subjects:  find(['assignedsubjects']),
      photo:     find(['photo', 'photourl', 'photourl', 'avatarurl', 'picture']),
      created:   find(['createdat'])
    };
 
    if (idx.email === -1) throw new Error('Colonne Email manquante.');
 
    const newEmail    = String(data.email || '').toLowerCase().trim();
    const empIdLookup = String(data.empId || data.userId || data.id || '').trim();

    // Auto-generate staff ID from configured prefix + sequential number when not provided.
    let empId = empIdLookup;
    if (!empId) {
      const conf   = (getSaaSSettings_().data) || {};
      const prefix = String(conf.STAFF_ID_PREFIX || conf.SYSTEM_ID_PREFIX || 'MT');
      let maxNum   = 0;
      if (idx.id !== -1) {
        for (let i = 1; i < rows.length; i++) {
          const existingId = String(rows[i][idx.id] || '').toUpperCase();
          if (existingId.startsWith(prefix.toUpperCase())) {
            const numPart = parseInt(existingId.slice(prefix.length), 10);
            if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
          }
        }
      }
      empId = prefix + String(maxNum + 1).padStart(4, '0'); // e.g. MT0001
    }
    let rowIdx = -1;

    // Lookup by employee ID first (supports email editing by admin).
    if (empIdLookup && idx.id !== -1) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][idx.id]).trim() === empIdLookup) {
          rowIdx = i;
          empId  = String(rows[i][idx.id] || empId);
          break;
        }
      }
    }
    // Fall back to email lookup (new accounts or when empId not sent).
    if (rowIdx === -1) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][idx.email]).toLowerCase().trim() === newEmail) {
          rowIdx = i;
          empId  = String(rows[i][idx.id] || empId);
          break;
        }
      }
    }
    // For new user creation a valid email is mandatory.
    if (rowIdx === -1 && (!newEmail || !newEmail.includes('@'))) {
      return { success: false, error: 'Email invalide. Utilisez une adresse complete (ex: nom@domaine.com).' };
    }
 
    const permsStr   = JSON.stringify(data.perms || {});
    const subjStr    = JSON.stringify(data.assignments || []);
    const teacherStr = data.isTeacher ? 'TRUE' : 'FALSE';
    const passVal    = hashPin_(data.password || '123456');
    const MAX_USER_PHOTO_CHARS = 48000;
    const warnings = [];
    let hasPhotoPayload = data && (
      Object.prototype.hasOwnProperty.call(data, 'photo') ||
      Object.prototype.hasOwnProperty.call(data, 'photoUrl') ||
      Object.prototype.hasOwnProperty.call(data, 'avatarUrl') ||
      Object.prototype.hasOwnProperty.call(data, 'PhotoURL')
    );
    let photoValue = String(data.photo || data.photoUrl || data.avatarUrl || data.PhotoURL || '').trim();
    if (hasPhotoPayload && photoValue && photoValue.length > MAX_USER_PHOTO_CHARS) {
      // Do not fail the whole save when only photo payload is too heavy.
      hasPhotoPayload = false;
      photoValue = '';
      warnings.push('Photo ignorée: taille trop grande pour la sauvegarde utilisateur.');
    }
 
    if (rowIdx !== -1) {
      // ── Mise à jour d'un compte existant ────────────────────────────────
      const row = rows[rowIdx];
      const currentPerms = idx.json > -1 ? parsePermissionsCell_(row[idx.json]) : {};
      const isGodModeAccount = currentPerms && currentPerms.isGodMode;
      const incomingPerms = (data && data.perms && typeof data.perms === 'object') ? data.perms : {};
      
      // Block editing of internal read-only accounts EXCEPT for GodMode (which can edit itself)
      if (isInternalReadOnlyPerms_(currentPerms) && !isGodModeAccount) {
        return { success: false, error: 'Compte interne protégé en lecture seule.' };
      }
      if (idx.id > -1)        row[idx.id]       = empId;
      if (idx.name > -1)      row[idx.name]      = data.name || '';
      // Admin can update the email address (lookup was by empId).
      if (idx.email > -1 && newEmail && newEmail.includes('@')) row[idx.email] = newEmail;
      if (idx.role > -1)      row[idx.role]      = isGodModeAccount ? 'ADMIN' : (data.role || 'Staff');
      if (idx.json > -1) {
        // Never drop internal godmode marker through regular profile edits.
        if (isGodModeAccount && !incomingPerms.isGodMode) row[idx.json] = 'GodMode';
        else row[idx.json] = permsStr;
      }
      if (idx.isTeacher > -1) row[idx.isTeacher] = teacherStr;
      if (idx.subjects > -1)  row[idx.subjects]  = subjStr;
      if (idx.photo > -1 && hasPhotoPayload) row[idx.photo] = photoValue;
 
      // [CORRECTION BUG-1] : Reset_Req = TRUE uniquement si l'admin
      // fournit un nouveau mot de passe explicite pour ce compte.
      if (data.password) {
        if (idx.pass > -1)  row[idx.pass]  = passVal;
        if (idx.reset > -1) row[idx.reset] = 'TRUE';
      }
 
      sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
 
    } else {
      // ── Création d'un nouveau compte ─────────────────────────────────────
      const newRow = new Array(h.length).fill('');
      if (idx.id > -1)        newRow[idx.id]       = empId;
      if (idx.name > -1)      newRow[idx.name]      = data.name || '';
      if (idx.email > -1)     newRow[idx.email]     = newEmail;
      if (idx.role > -1)      newRow[idx.role]      = data.role || 'Staff';
      if (idx.json > -1)      newRow[idx.json]      = permsStr;
      if (idx.active > -1)    newRow[idx.active]    = 'TRUE';
      if (idx.created > -1)   newRow[idx.created]   = new Date();
      if (idx.pass > -1)      newRow[idx.pass]      = passVal;
      // First-login flow must always run for new staff accounts:
      // email verification (via successful email login) + PIN setup.
      if (idx.reset > -1)     newRow[idx.reset]     = 'TRUE';
      if (idx.isTeacher > -1) newRow[idx.isTeacher] = teacherStr;
      if (idx.subjects > -1)  newRow[idx.subjects]  = subjStr;
      if (idx.photo > -1 && photoValue) newRow[idx.photo] = photoValue;
 
      sh.appendRow(newRow);
    }
 
    return {
      success: true,
      message: 'Collaborateur enregistré : ' + empId,
      warning: warnings.length ? warnings.join(' ') : ''
    };
 
  } catch (e) {
    const msg = String((e && e.message) || e || 'Erreur inconnue').trim();
    if (/limit|max|too large|too long|string/i.test(msg)) {
      return { success: false, error: 'Échec sauvegarde: données trop volumineuses (souvent la photo). Réduisez la taille de l\'image puis réessayez.' };
    }
    return { success: false, error: 'Échec sauvegarde utilisateur: ' + msg };
  }
}
 
function saveStaffAccess_(data) { return updateUserRoleAndPerms_(data); }

function updateMyProfilePhoto_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success:false, error:'Session invalide.' };

    const photo = String((data && (data.photo || data.photoUrl || data.avatarUrl || data.PhotoURL)) || '').trim();
    if (!photo) return { success:false, error:'Photo manquante.' };
    if (!/^(data:image\/|https?:\/\/|blob:|\/)/i.test(photo)) {
      return { success:false, error:'Format de photo non valide.' };
    }
    if (photo.length > 48000) {
      return { success:false, error:'Photo trop volumineuse pour la sauvegarde.' };
    }

    const ss = getSS_();
    const sh = ensureUsersSheetStructure_(ss);
    const rows = sh.getDataRange().getValues();
    if (!rows || rows.length < 2) return { success:false, error:'Aucun utilisateur à mettre à jour.' };

    const headers = rows[0].map(x => String(x).trim().toLowerCase());
    const find = arr => headers.findIndex(x => arr.some(v => x.replace(/[\s_]/g,'') === v.replace(/[\s_]/g,'')));
    const iEmail = find(['email']);
    const iUserId = find(['userid','id']);
    const iPhoto = find(['photo','photourl','avatarurl','picture']);
    if (iEmail === -1) return { success:false, error:'Colonne Email manquante.' };
    if (iPhoto === -1) return { success:false, error:'Colonne PhotoURL manquante dans la feuille Users.' };

    const targetEmail = String(viewer.email || '').toLowerCase().trim();
    const targetUserId = String(viewer.userId || '').trim();
    let rowIdx = -1;

    if (targetUserId && iUserId !== -1) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][iUserId] || '').trim() === targetUserId) { rowIdx = i; break; }
      }
    }
    if (rowIdx === -1 && targetEmail) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][iEmail] || '').toLowerCase().trim() === targetEmail) { rowIdx = i; break; }
      }
    }
    if (rowIdx === -1) return { success:false, error:'Compte introuvable pour mise à jour de photo.' };

    sh.getRange(rowIdx + 1, iPhoto + 1).setValue(photo);
    _safeCachePut('VIEWER_' + normalizeAuthToken_(auth), '', 1);
    return { success:true, message:'Photo de profil mise à jour.', photo:photo };
  } catch (e) {
    return { success:false, error:'Échec mise à jour photo: ' + String((e && e.message) || e || 'Erreur inconnue') };
  }
}

// ============================================================
// GODMODE MANAGEMENT
// ============================================================
/**
 * Toggles godmode access for a user (admin only).
 * Godmode allows bypassing all permission checks.
 */
function toggleGodMode_(data, token) {
  try {
    const viewer = getViewerInfo_(token);
    if (!viewer.success) return { success: false, error: 'Session invalide' };
    if (!viewer.isMaster) return { success: false, error: 'Access denied. Admin only.' };

    const targetEmail = String(data.email || '').toLowerCase().trim();
    if (!targetEmail) return { success: false, error: 'Email manquant' };

    const ss = getSS_();
    const sh = ss.getSheetByName(USERS_SHEET_NAME);
    if (!sh) return { success: false, error: 'Users sheet not found' };

    const rows = sh.getDataRange().getValues();
    const h = rows[0].map(x => String(x).trim().toLowerCase());
    
    const iEmail = h.indexOf('email');
    const iJson = h.findIndex(x => x.replace(/\s/g,'') === 'permissionsjson');
    
    if (iEmail === -1 || iJson === -1) return { success: false, error: 'Users sheet structure invalid' };

    // Find user
    let rowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][iEmail]).toLowerCase().trim() === targetEmail) {
        rowIdx = i;
        break;
      }
    }
    
    if (rowIdx === -1) return { success: false, error: 'User not found: ' + targetEmail };

    // Parse permissions
    let perms = parsePermissionsCell_(rows[rowIdx][iJson]);
    if (isInternalReadOnlyPerms_(perms)) {
      return { success: false, error: 'Compte interne protégé en lecture seule.' };
    }

    // Toggle godmode
    const wasEnabled = Boolean(perms.isGodMode);
    const newState = !wasEnabled;
    
    if (newState) {
      perms.isGodMode = true;
    } else {
      delete perms.isGodMode;
    }

    // Update permissions JSON
    rows[rowIdx][iJson] = JSON.stringify(perms);
    sh.getRange(rowIdx + 1, 1, 1, rows[rowIdx].length).setValues([rows[rowIdx]]);

    // Clear viewer cache to force refresh
    CacheService.getScriptCache().remove('VIEWER_' + token);

    // Audit log
    writeAuditLog_({
      action: 'GODMODE_TOGGLED',
      user: viewer.email,
      details: {
        targetEmail: targetEmail,
        newState: newState ? 'ENABLED' : 'DISABLED',
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      message: 'Godmode ' + (newState ? 'enabled' : 'disabled') + ' for ' + targetEmail,
      godmodeEnabled: newState
    };

  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// Email OTP Verification (first-login)
// ============================================================
/**
 * Sends a 6-digit OTP to the authenticated user's email.
 * Should be called immediately after a successful RESET_REQUIRED login.
 */
function sendEmailVerification_(token) {
  try {
    const viewer = getViewerInfo_(token);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide ou expirée.' };

    const otp      = String(Math.floor(100000 + Math.random() * 900000));
    const cacheKey = 'EMAIL_OTP_' + token;
    CacheService.getScriptCache().put(cacheKey, otp, 600); // 10-minute expiry

    const email      = viewer.email;
    const schoolName = viewer.orgName || 'Meigens';
    const name       = viewer.name   || email.split('@')[0];
    try {
      MailApp.sendEmail({
        to:      email,
        subject: '[' + schoolName + '] Code de vérification : ' + otp,
        body:    'Bonjour ' + name + ',\n\n'
               + 'Votre code de vérification pour activer votre accès est :\n\n'
               + '    ' + otp + '\n\n'
               + 'Ce code expire dans 10 minutes.\n\n'
               + 'Si vous n\'avez pas initié cette connexion, contactez immédiatement votre administrateur.\n\n'
               + '— Équipe ' + schoolName
      });
    } catch (e) {
      return { success: false, error: 'Impossible d\'envoyer l\'email : ' + e.message };
    }
    const parts  = email.split('@');
    const masked = parts[0].substring(0, 2) + '***@' + (parts[1] || '');
    return { success: true, maskedEmail: masked };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Verifies the 6-digit OTP issued by sendEmailVerification_.
 * Single-use: OTP is deleted on successful verification.
 */
function verifyEmailOTP_(otp, token) {
  try {
    if (!token) return { success: false, error: 'Session invalide.' };
    const cacheKey = 'EMAIL_OTP_' + token;
    const stored   = CacheService.getScriptCache().get(cacheKey);
    if (!stored)                     return { success: false, error: 'Code expiré. Cliquez sur "Renvoyer le code".' };
    if (String(otp).trim() !== stored) return { success: false, error: 'Code incorrect. Vérifiez et réessayez.' };
    CacheService.getScriptCache().remove(cacheKey); // Single-use
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// Staff PIN-based login (ID + PIN)
// ============================================================
/**
 * Login with employee ID (Matricule) + PIN after PIN has been configured.
 */
function loginWithIdAndPin_(userId, pin) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
    if (!sh) return { success: false, message: 'Feuille Users introuvable.' };

    const data    = sh.getDataRange().getValues();
    const h       = data[0].map(x => String(x).trim().toLowerCase());
    const iId     = h.findIndex(x => x === 'userid' || x === 'id');
    const iPass   = h.findIndex(x => x === 'password');
    const iActive = h.findIndex(x => x === 'active');
    const iReset  = h.findIndex(x => x.replace(/[\s_]/g, '') === 'resetreq');
    const iLastLogin = h.findIndex(x => x.replace(/[\s_]/g, '') === 'lastloginat');

    if (iId === -1 || iPass === -1)
      return { success: false, message: 'Structure Users invalide.' };

    const rawTarget = String(userId || '').trim();
    const rawPin    = String(pin    || '').trim();
    if (!rawTarget || !rawPin)
      return { success: false, message: 'Identifiants incorrects.' };
    if (rawPin.length < 4)
      return { success: false, message: 'PIN trop court (minimum 4 chiffres).' };

    // Build a set of candidate IDs: the user may omit the prefix.
    const conf   = (getSaaSSettings_().data) || {};
    const prefix = String(conf.STAFF_ID_PREFIX || conf.SYSTEM_ID_PREFIX || 'MT').toUpperCase();
    const lookups = new Set([rawTarget.toUpperCase()]);
    if (/^\d+$/.test(rawTarget)) {
      // Pure digits entered — try with prefix, zero-padded or raw
      lookups.add(prefix + rawTarget.padStart(4, '0'));
      lookups.add(prefix + rawTarget);
    }
    // Also try without prefix if user typed the full code
    if (rawTarget.toUpperCase().startsWith(prefix)) {
      lookups.add(rawTarget.slice(prefix.length));
    }

    const hashedPin  = hashPin_(rawPin);
    const candidates = [];
    for (let i = 1; i < data.length; i++) {
      if (lookups.has(String(data[i][iId]).trim().toUpperCase())) candidates.push(i);
    }
    if (!candidates.length)
      return { success: false, message: 'Matricule ou PIN incorrect.' };

    const pinMatch = (idx) => {
      const stored = String(data[idx][iPass] || '').trim();
      return stored.toLowerCase() === hashedPin || stored === rawPin;
    };
    const isActive = (idx) => iActive === -1 || String(data[idx][iActive]).toUpperCase() !== 'FALSE';

    let rowIdx = candidates.find(i => pinMatch(i) && isActive(i));
    if (rowIdx === undefined) rowIdx = candidates.find(i => pinMatch(i));
    if (rowIdx === undefined)
      return { success: false, message: 'Matricule ou PIN incorrect.' };

    const row = data[rowIdx];
    if (iActive !== -1 && String(row[iActive]).toUpperCase() === 'FALSE')
      return { success: false, message: 'Compte suspendu. Contactez votre administrateur.' };

    // If Reset_Req still TRUE, PIN was never set — user must use email+password first.
    if (iReset !== -1 && String(row[iReset]).toUpperCase() === 'TRUE')
      return { success: false, message: 'PIN non encore configuré. Utilisez Email + Mot de passe temporaire pour votre première connexion.' };

    const token = Utilities.getUuid();
    const sessionPayload = buildUserSessionPayload_(sh.getName(), data[0], row);
    storeSessionToken_(token, sessionPayload, 21600);
    if (iLastLogin !== -1) {
      try { sh.getRange(rowIdx + 1, iLastLogin + 1).setValue(new Date()); } catch(e) {}
    }
    return { success: true, status: 'AUTHORIZED', token };
  } catch(e) {
    return { success: false, message: 'Erreur: ' + e.message };
  }
}

/**
 * Store PIN for a staff member during first-login setup.
 * The token must belong to a valid authenticated session (email+pass login).
 * Clears Reset_Req so ID+PIN login becomes available.
 */
function setupStaffPin_(data, token) {
  try {
    const viewer = getViewerInfo_(token);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide ou expirée.' };

    const pin = String(data && data.pin ? data.pin : '').trim();
    if (pin.length < 4) return { success: false, error: 'PIN trop court (minimum 4 chiffres).' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(USERS_SHEET_NAME) || ss.getSheetByName('Admin_Users');
    if (!sh) return { success: false, error: 'Feuille Users introuvable.' };

    const rows   = sh.getDataRange().getValues();
    const h      = rows[0].map(x => String(x).trim().toLowerCase());
    const iEmail = h.indexOf('email');
    const iPass  = h.indexOf('password');
    const iReset = h.findIndex(x => x.replace(/[\s_]/g, '') === 'resetreq');

    if (iEmail === -1 || iPass === -1) return { success: false, error: 'Structure Users invalide.' };

    let rowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][iEmail]).toLowerCase().trim() === viewer.email.toLowerCase().trim()) {
        rowIdx = i; break;
      }
    }
    if (rowIdx === -1) return { success: false, error: 'Utilisateur introuvable.' };

    const hashedPin = hashPin_(pin);
    sh.getRange(rowIdx + 1, iPass  + 1).setValue(hashedPin);
    if (iReset !== -1) sh.getRange(rowIdx + 1, iReset + 1).setValue('FALSE');

    // Invalidate cached viewer so next call re-reads updated row.
    try { CacheService.getScriptCache().remove('VIEWER_' + token); } catch(e) {}

    return { success: true, message: 'PIN activé avec succès.' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function toggleUserActiveState_(email, status) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName(USERS_SHEET_NAME);
    if (!sh) return { success:false, error:'Users introuvable.' };
    const data = sh.getDataRange().getValues();
    const h    = data[0].map(x => String(x).trim().toLowerCase());
    const iE   = h.findIndex(x => x === 'email');
    const iA   = h.findIndex(x => x === 'active');
    const iJson = h.findIndex(x => x.replace(/[\s_]/g,'') === 'permissionsjson');
    if (iE === -1||iA === -1) throw new Error('Structure Users invalide.');
    for (let i=1;i<data.length;i++) {
      if (String(data[i][iE]).toLowerCase().trim() === email.toLowerCase().trim()) {
        const perms = iJson !== -1 ? parsePermissionsCell_(data[i][iJson]) : {};
        if (isInternalReadOnlyPerms_(perms)) return { success:false, error:'Compte interne protégé en lecture seule.' };
        sh.getRange(i+1, iA+1).setValue(status ? 'TRUE' : 'FALSE');
        return { success:true };
      }
    }
    return { success:false, message:'Utilisateur introuvable.' };
  } catch(e) { return { success:false, error:e.message }; }
}

function removeUserAccess_(email) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName(USERS_SHEET_NAME);
    const data= sh.getDataRange().getValues();
    const h   = data[0].map(x => String(x).trim().toLowerCase());
    const iE  = h.findIndex(x => x === 'email');
    const iJson = h.findIndex(x => x.replace(/[\s_]/g,'') === 'permissionsjson');
    for (let i=1;i<data.length;i++) {
      if (String(data[i][iE]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
        const perms = iJson !== -1 ? parsePermissionsCell_(data[i][iJson]) : {};
        if (isInternalReadOnlyPerms_(perms)) return { success:false, error:'Compte interne protégé en lecture seule.' };
        sh.deleteRow(i+1); return { success:true };
      }
    }
    return { success:false, message:'Utilisateur introuvable.' };
  } catch(e) { return { success:false, error:e.message }; }
}

function getStaffAttendance_(params) {
  return getAttendanceForStudent_({ studentId: params&&params.email ? params.email : null });
}

function clockInStaff_(payload) {
  try {
    const email  = payload.email || Session.getActiveUser().getEmail();
    const tz     = Session.getScriptTimeZone();
    const dateStr= Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const timeStr= Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
    const ss     = getSS_();
    const sh     = ss.getSheetByName('attendance');
    const data   = sh.getDataRange().getValues();
    const h      = data[0].map(x => String(x).toUpperCase().trim());
    const iSid   = h.indexOf('STUDENTID');
    const iDate  = h.indexOf('DATE');
    for (let i=data.length-1;i>=1;i--) {
      const rd = data[i][iDate] instanceof Date ? Utilities.formatDate(data[i][iDate],tz,'yyyy-MM-dd') : String(data[i][iDate]);
      if (String(data[i][iSid]).toLowerCase() === email.toLowerCase() && rd === dateStr) {
        const iMeta = h.indexOf('METAJSON');
        let meta = {};
        try { meta = JSON.parse(data[i][iMeta]||'{}'); } catch(e) {}
        meta.checkOut = timeStr;
        sh.getRange(i+1, iMeta+1).setValue(JSON.stringify(meta));
        writeAuditLog_('STAFF_EXIT', email, 'checkOut:' + timeStr, 'p_attendance');
        return { success:true, message:'Sortie validee: ' + timeStr, status:'CHECKED_OUT' };
      }
    }
    const statusToken = String((payload && payload.status) || 'PRESENT').toUpperCase();
    const allowed = { PRESENT:true, LATE:true, ABSENT:true };
    const finalStatus = allowed[statusToken] ? statusToken : 'PRESENT';
    const lateMinutes = Math.max(0, Number((payload && payload.lateMinutes) || 0) || 0);
    const metaObj = {
      type: 'STAFF',
      checkIn: timeStr,
      status: finalStatus,
      lateMinutes: lateMinutes,
      rawLateMinutes: Math.max(0, Number((payload && payload.rawLateMinutes) || lateMinutes) || lateMinutes),
      absentAfterMinutes: Math.max(1, Number((payload && payload.absentAfterMinutes) || 120) || 120)
    };
    sh.appendRow(['ATT-' + Utilities.getUuid().substring(0,8),'',email,'STAFF',new Date(),finalStatus,email, JSON.stringify(metaObj) ]);
    writeAuditLog_('STAFF_ENTRY', email, 'checkIn:' + timeStr + ',status:' + finalStatus + ',late:' + lateMinutes, 'p_attendance');
    return { success:true, message:'Entree validee: ' + timeStr, status:'CHECKED_IN' };
  } catch(e) {
    try { writeAuditLog_('STAFF_ATTENDANCE_FAIL', String((payload && payload.email) || '').trim() || 'UNKNOWN', e.message, 'p_attendance', true); } catch (_ae) {}
    return { success:false, error:e.message };
  }
}

// ============================================================
// ACADEMIC YEAR
// ============================================================
function getActiveAcademicYear_() {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('Settings');
    if (sh) {
      const data = sh.getDataRange().getValues();
      const row  = data.find(r => String(r[0]).trim() === 'ACADEMIC_YEAR' || String(r[0]).trim() === 'currentAcademicYear');
      if (row && row[1]) return String(row[1]).trim();
    }
    return 'ANNEE_NON_CONFIGUREE';
  } catch(e) { return 'ANNEE_NON_CONFIGUREE'; }
}

function getAvailableAcademicYears_() {
  try {
    const ss = getSS_();
    const conf = getSaaSSettings_().data;
    
    // 1. Récupération de l'année ACTIVE (Obligatoire - Politique Zero Fallback)
    const active = conf.ACADEMIC_YEAR ? String(conf.ACADEMIC_YEAR).trim() : '';
    if (!active) {
      throw new Error("Configuration Critique : 'ACADEMIC_YEAR' est manquant dans les paramètres SaaS.");
    }

    const years = new Set();
    years.add(active);

    // 2. Récupération des années ARCHIVÉES (Beaucoup plus léger que 'studenthistory')
    const shArch = ss.getSheetByName('Archives_Annuelles');
    if (shArch && shArch.getLastRow() > 1) {
      // On lit UNIQUEMENT la première colonne (Annee Scolaire) pour économiser la RAM
      const archivedData = shArch.getRange(2, 1, shArch.getLastRow() - 1, 1).getValues();
      archivedData.forEach(r => {
        const y = String(r[0]).trim();
        if (y) years.add(y);
      });
    }

    // 3. Tri et retour
    const finalYears = [...years].sort().reverse();
    
    return { 
      success: true, 
      data: finalYears 
    };

  } catch(e) { 
    // On retourne l'erreur réelle au frontend pour bloquer l'action
    return { success: false, error: "Erreur Système : " + e.message }; 
  }
}

// ============================================================
// REPORTS & BULLETINS
// ============================================================
function generateFullStudentReport_(payload, token) {
  try {
    const studentId = typeof payload === 'string' ? payload : payload.studentId;
    const guard = ensureViewerCanAccessStudentScope_(studentId, token);
    if (!guard.success) return { success:false, error:guard.error };
    const engine    = typeof payload === 'object' ? (payload.engine||'STUDIO') : 'STUDIO';
    const template  = typeof payload === 'object' ? payload.studioTemplate : null;
    let html = '';
    if (engine === 'STANDARD' || !template) {
      const serverReport = buildFullStudentReportHtml_(studentId, token);
      if (!serverReport.success) return serverReport;
      html = serverReport.htmlReport;
    } else {
      const conf = getSaaSSettings_().data || {};
      const reportData = getStudentBulletinData_({ studentId: studentId }, token);
      if (!reportData.success || !reportData.student) {
        return { success:false, error:(reportData && reportData.error) || 'Bulletin indisponible.' };
      }
      const student = reportData.student || {};
      const name = student.name || studentId;
      html = template
        .replace(/{{NOM_COMPLET}}/g, name)
        .replace(/{{MATRICULE}}/g, studentId)
        .replace(/{{ANNEE_SCOLAIRE}}/g, conf.ACADEMIC_YEAR||'')
        .replace(/{{DATE_JOUR}}/g, new Date().toLocaleDateString('fr-FR'));
    }
    // Audit the successful report generation on the backend
    try {
      const _auditActor = _resolveSessionEmailSafe_('Inconnu');
      const _auditSid = typeof studentId === 'string' ? studentId : String((payload && payload.studentId) || '');
      writeAuditLog_('REPORT_GENERATED', 'Bulletin/' + _auditSid,
        { engine: engine, studentId: _auditSid, generatedBy: payload && payload.generatedBy, actor: _auditActor },
        'pa_generate_report', false);
    } catch(_ae) {}
    return { success:true, htmlReport:html };
  } catch(e) { return { success:false, error:e.message }; }
}

function generateReportDownloadUrl_(params, token) {
  try {
    const sid = resolveStudentId_(params);
    const guard = ensureViewerCanAccessStudentScope_(sid, token);
    if (!guard.success) return { success:false, error:guard.error };
    const imm = getImmersiveData_({ id:sid }, token);
    if (!imm.success) return { success:false, error:'Données indisponibles.' };
    const html  = '<html><body><h2>Bilan: ' + imm.studentName + '</h2><p>Moyenne: <b>' + imm.finalYearlyAvg + '/100</b> Decision: <b>' + imm.decision + '</b></p></body></html>';
    const blob  = HtmlService.createHtmlOutput(html).getAs('application/pdf');
    blob.setName('Bilan_' + sid + '.pdf');
    const folder = getOrCreateAssetsFolder_();
    const file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success:true, url:'https://drive.google.com/file/d/' + file.getId() + '/view', fileId:file.getId() };
  } catch(e) { return { success:false, error:e.message }; }
}

function sendStudentReportEmail_(params, token) {
  try {
    const sid = resolveStudentId_(params);
    const guard = ensureViewerCanAccessStudentScope_(sid, token);
    if (!guard.success) return { success:false, error:guard.error };
    const imm = getImmersiveData_({ id:sid }, token);
    if (!imm.success) throw new Error('Données indisponibles.');
    MailApp.sendEmail({ to:params.email||'direction@ecole.com', subject:'Bilan Academique: ' + imm.studentName,
      htmlBody:'<h2>' + imm.studentName + '</h2><p>Moyenne: <b>' + imm.finalYearlyAvg + '/100</b></p><p>Decision: <b>' + imm.decision + '</b></p>' });
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function saveMedicalRecord_(data, auth) {
  try {
    const ss     = getSS_();
    const sh     = ss.getSheetByName('students');
    if (!sh) return { success:false, error:'students introuvable.' };
    const rows   = sh.getDataRange().getValues();
    const h      = rows[0].map(x => String(x).trim());
    const iCode  = h.indexOf('StudentCode');
    const iCF    = h.indexOf('CustomFields');
    for (let i=1;i<rows.length;i++) {
      if (String(rows[i][iCode]).trim() === String(data.studentId).trim()) {
        let cf = {};
        try { cf = JSON.parse(rows[i][iCF]||'{}'); } catch(e) {}
        cf.medical = { bloodType:data.bloodType||'', allergies:data.allergies||'', conditions:data.conditions||'', medications:data.medications||'', notes:data.notes||'', updatedAt:new Date().toISOString() };
        sh.getRange(i+1, iCF+1).setValue(JSON.stringify(cf));
        writeAuditLog_('MEDICAL_RECORD', data.studentId, 'updated', 'p_dossier');
        return { success:true };
      }
    }
    return { success:false, error:'Eleve introuvable.' };
  } catch(e) { return { success:false, error:e.message }; }
}

function saveDocumentSignature_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    const ss     = getSS_();
    let sh       = ss.getSheetByName('document_signatures');
    if (!sh) { sh = ss.insertSheet('document_signatures'); sh.appendRow(['SignatureID','StudentID','DocumentType','SignatureData','SignedAt','SignedBy']); sh.setFrozenRows(1); }
    const sigId  = 'SIG-' + Utilities.getUuid().substring(0,8);
    sh.appendRow([sigId, data.studentId||'', data.documentType||'General', data.signatureData||'', new Date(), viewer.email||'System']);
    return { success:true, signatureId:sigId };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// COMMUNICATIONS
// ============================================================
function publishAnnouncement_(data, auth) {
  try {
    if (!data) return { success: false, error: 'Payload manquant.' };
    writeAuditLog_('ANNOUNCEMENT', data.audience||'ALL', data.message||'', 'p_settings');
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}
function sendInternalMessage_(data, auth) {
  try {
    if (!data) return { success: false, error: 'Payload manquant.' };
    writeAuditLog_('MESSAGE', data.thread||'', data.text||'', '');
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── Fix 7: getEnrollmentsByClass_ ────────────────────────────────────────────
// Returns an array of enrollments filtered to a specific classId/level.
// The frontend calls getEnrollmentsByClass({ classId }) and iterates the result.
// No hardcoded values: classId is required, all data comes from getAllStudents_.
function getEnrollmentsByClass_(data, auth) {
  var classId = data && (data.classId || data.class || data.level || data.niveau);
  if (!classId) return { success: false, error: 'Paramètre classId requis.' };
  try {
    var all = getAllStudents_(auth);
    var students = Array.isArray(all) ? all : (all && all.data ? all.data : []);
    var needle   = String(classId).trim().toLowerCase();
    var filtered = students.filter(function(s) {
      var cls = String(s.level || s.classe || s.classId || s.niveauId || s.niveau || '').trim().toLowerCase();
      return cls === needle;
    });
    return { success: true, data: filtered, count: filtered.length };
  } catch(e) {
    return { success: false, error: 'getEnrollmentsByClass_ erreur: ' + e.message };
  }
}

// ── Fix 2: notifyLateStaff_ ──────────────────────────────────────────────────
// Logs and optionally emails a late-staff notification from the kiosk flow.
// Expected payload: { teacher, email, lateMinutes, at }
// Alert threshold (ATTENDANCE_ADMIN_ALERT_MIN) and email recipient are read
// from getSaaSSettings_ — no hardcoded values. Returns an error if required
// config is missing.
function notifyLateStaff_(data, auth) {
  if (!data || !data.teacher) return { success: false, error: 'Paramètre teacher requis.' };

  var teacher     = String(data.teacher    || '').trim();
  var email       = String(data.email      || '').trim();
  var lateMinutes = Number(data.lateMinutes || 0);
  var at          = data.at || new Date().toISOString();

  // Validate: lateMinutes must be a positive number — caller should not fire
  // this action for on-time staff, but defend here as well.
  if (!Number.isFinite(lateMinutes) || lateMinutes <= 0) {
    return { success: false, error: 'lateMinutes doit être un nombre positif.' };
  }

  // Read alert threshold from config — no hardcoded fallback.
  var confRes = getSaaSSettings_(auth || null);
  if (!confRes || !confRes.success || !confRes.data) {
    return { success: false, error: 'Configuration introuvable. Veuillez configurer les paramètres de l\'école avant d\'utiliser notifyLateStaff.' };
  }
  var conf = confRes.data;

  var alertThreshold = Number(conf.ATTENDANCE_ADMIN_ALERT_MIN);
  if (!Number.isFinite(alertThreshold) || alertThreshold <= 0) {
    return {
      success: false,
      error: 'Paramètre ATTENDANCE_ADMIN_ALERT_MIN manquant ou invalide. Veuillez le configurer dans les Paramètres > Présence.'
    };
  }

  // Only act if the delay actually exceeds the configured threshold.
  if (lateMinutes < alertThreshold) {
    return { success: true, skipped: true, reason: 'Retard (' + lateMinutes + ' min) inférieur au seuil configuré (' + alertThreshold + ' min).' };
  }

  try {
    writeAuditLog_('LATE_STAFF', teacher, { email: email, lateMinutes: lateMinutes, at: at }, 'SYSTEM', false);

    // Send email only if a valid address is available and MailApp exists.
    if (email && email.indexOf('@') > -1 && typeof MailApp !== 'undefined') {
      var schoolName = String(conf.SCHOOL_NAME || conf.schoolName || '').trim();
      if (!schoolName) {
        return { success: false, error: 'Paramètre SCHOOL_NAME manquant. Veuillez configurer le nom de l\'école dans les Paramètres.' };
      }
      try {
        MailApp.sendEmail({
          to:      email,
          subject: '[' + schoolName + '] Retard enregistré — ' + teacher,
          body:    'Bonjour,\n\nUn retard de ' + lateMinutes + ' minute(s) a été enregistré pour ' + teacher + ' à ' + at + '.\n\nCordialement,\n' + schoolName
        });
      } catch(mailErr) {
        // Email failure is non-fatal: the audit entry was already written.
        console.warn('notifyLateStaff_: envoi email échoué — ' + mailErr.message);
      }
    }

    return { success: true, teacher: teacher, lateMinutes: lateMinutes, at: at };
  } catch(e) {
    return { success: false, error: 'notifyLateStaff_ erreur: ' + e.message };
  }
}


function reportSecurityIncident_(data, auth) {
  writeAuditLog_('SECURITY_INCIDENT', data.target||'UNKNOWN', data, 'SECURITY', true);
  return { success:true };
}
function sendSMSBulk_(data, auth) {
  writeAuditLog_('SMS_BULK', 'SMS', { count:(data.recipients||[]).length }, 'p_settings');
  return { success:true, sent:(data.recipients||[]).length };
}
function testSMSConnection_(data, auth) {
  return {
    success:false,
    error:'Test SMS non implemente pour le fournisseur configure.',
    message:'Aucun test de connectivite SMS reel n\'est disponible sur ce backend.'
  };
}

// ============================================================
// AI
// ============================================================
const SERVER_AI_DEFAULT_PROVIDER_ = 'anthropic'; // Gemini used only as 429 fallback
// SPEED: default to Haiku (~3x faster than Sonnet) for the shared/free key.
// Personal-key users can override via Settings.AI_MODEL.
const SERVER_AI_DEFAULT_MODEL_ = 'claude-haiku-4-5-20251001';
const SERVER_AI_ANTHROPIC_FALLBACK_MODELS_ = [
  'claude-3-haiku-20240307',
  'claude-3-5-sonnet-20241022'
];
const SERVER_AI_DEFAULT_API_URL_ = 'https://api.anthropic.com/v1/messages';
const SERVER_AI_OPENAI_DEFAULT_MODEL_ = 'gpt-4.1-mini';
const SERVER_AI_OPENAI_DEFAULT_API_URL_ = 'https://api.openai.com/v1/chat/completions';
const SERVER_AI_GEMINI_DEFAULT_MODEL_ = 'gemini-2.0-flash';
const SERVER_AI_GEMINI_DEFAULT_MODEL_LITE_ = 'gemini-2.0-flash-lite';
const SERVER_AI_ALLOW_FRONTEND_TEST_KEY_ = false;  // never allow client-supplied keys
const SERVER_AI_FRONTEND_TEST_HARDCODED_KEY_ = '';   // removed — do NOT put real keys here
function processUserMessage_(payload, auth) { return handleAiChatProxy_(payload, auth); }

/**
 * Fix 1: classifyAiIntent_ — was called from the frontend but had no backend handler.
 * Accepts { text, intents } and asks the configured AI model to return one intent key.
 * Returns { success:true, intent: <key|null> } or { success:false, error }.
 * Runs entirely server-side (UrlFetchApp) — CORS-safe.
 */
function _viewerHasAnyPermission_(viewer, permSpec) {
  var required = Array.isArray(permSpec) ? permSpec.filter(Boolean) : (permSpec ? [permSpec] : []);
  if (!required.length) return true;
  if (!viewer || !viewer.success) return false;
  if (viewer.isMaster || viewer.isGodMode) return true;
  var perms = viewer.permissions || {};
  for (var i = 0; i < required.length; i++) {
    if (perms[required[i]]) return true;
  }
  return false;
}

function _normalizeIntentCatalogForClassification_(rawIntents, viewer) {
  var rows = [];
  var src = rawIntents;

  if (typeof src === 'string') {
    var txt = String(src || '').trim();
    if (txt) {
      if (/^[\[{]/.test(txt)) {
        try { src = JSON.parse(txt); } catch (_e) { src = txt; }
      }
    }
  }

  if (Array.isArray(src)) {
    for (var i = 0; i < src.length; i++) {
      var item = src[i];
      if (!item) continue;
      if (typeof item === 'string') {
        rows.push({ key: String(item || '').trim(), description: '', permissions: [] });
        continue;
      }
      if (typeof item === 'object') {
        rows.push({
          key: String(item.key || item.intent || item.id || item.name || '').trim(),
          description: String(item.description || item.label || '').trim(),
          permissions: Array.isArray(item.requiredPermissions) ? item.requiredPermissions : (Array.isArray(item.permissions) ? item.permissions : [])
        });
      }
    }
  } else if (src && typeof src === 'object') {
    Object.keys(src).forEach(function(k) {
      var item = src[k];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.push({
          key: String(item.key || item.intent || k || '').trim(),
          description: String(item.description || item.label || item.text || '').trim(),
          permissions: Array.isArray(item.requiredPermissions) ? item.requiredPermissions : (Array.isArray(item.permissions) ? item.permissions : [])
        });
      } else {
        rows.push({ key: String(k || '').trim(), description: String(item || '').trim(), permissions: [] });
      }
    });
  } else if (typeof src === 'string') {
    String(src || '').split(/\r?\n/).forEach(function(line) {
      var clean = String(line || '').trim();
      if (!clean) return;
      var m = clean.match(/^([A-Za-z0-9_\-\.]+)\s*[:\-]\s*(.+)$/);
      if (m) rows.push({ key: String(m[1] || '').trim(), description: String(m[2] || '').trim(), permissions: [] });
      else rows.push({ key: clean.split(/\s+/)[0], description: clean, permissions: [] });
    });
  }

  var dedupe = {};
  var out = [];
  rows.forEach(function(r) {
    var key = String((r && r.key) || '').trim();
    if (!key || dedupe[key]) return;
    dedupe[key] = true;
    var required = Array.isArray(r.permissions) ? r.permissions.filter(Boolean) : [];
    if (!_viewerHasAnyPermission_(viewer, required)) return;
    out.push({ key: key, description: String((r && r.description) || '').trim(), permissions: required });
  });

  return out;
}

function classifyAiIntent_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth || {});
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    if (!_viewerHasAnyPermission_(viewer, ['p_use_ai'])) {
      return { success: false, error: 'Permission p_use_ai requise.' };
    }

    var text = String((data && data.text) || '').slice(0, 800).trim();
    if (!text) return { success: false, error: 'text requis.' };

    var catalog = _normalizeIntentCatalogForClassification_(data && data.intents, viewer);
    if (!catalog.length) {
      return { success: true, intent: null, reason: 'No allowed intents available for this user.' };
    }
    if (catalog.length === 1) {
      return { success: true, intent: catalog[0].key };
    }

    var intentLines = catalog.map(function(it) {
      return '- ' + it.key + ': ' + (it.description || 'No description');
    }).join('\n');

    var conf = _resolveServerAiConfig_();
    if (!conf || !conf.apiKey) return { success: false, error: 'AI_KEY_NOT_CONFIGURED' };

    var prompt =
      'You are an intent classifier. Given this list of allowed intent keys and descriptions:\n' +
      intentLines +
      '\n\nClassify the user message into exactly one intent key from the list above.' +
      ' If none fits, reply with the single word: none.\n' +
      'User message: "' + text + '"\n' +
      'Reply with only the intent key or "none".';

    var apiUrl = conf.apiUrl || 'https://api.anthropic.com/v1/messages';
    var model = conf.model || 'claude-haiku-4-5-20251001';
    var headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (conf.provider === 'anthropic' || !conf.provider) {
      headers['x-api-key'] = conf.apiKey;
    } else {
      headers['Authorization'] = 'Bearer ' + conf.apiKey;
    }

    var resp = UrlFetchApp.fetch(apiUrl, {
      method: 'POST',
      muteHttpExceptions: true,
      headers: headers,
      payload: JSON.stringify({
        model: model,
        max_tokens: 30,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    var body = {};
    try { body = JSON.parse(resp.getContentText()); } catch (_) {}
    var raw = ((body.content || [])[0] || {}).text ||
      (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
    var intent = String(raw).trim().replace(/['".,!?]/g, '').split(/\s+/)[0] || '';
    if (!intent || intent.toLowerCase() === 'none') return { success: true, intent: null };

    var allowed = {};
    catalog.forEach(function(it) { allowed[it.key] = true; });
    if (!allowed[intent]) return { success: true, intent: null };
    return { success: true, intent: intent };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── AI DAILY TOKEN TRACKING ────────────────────────────────────────────────────
function _parsePositiveInt_(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return 0;
  var n = parseInt(raw.replace(/[^0-9\-]/g, ''), 10);
  return (!isNaN(n) && n > 0) ? n : 0;
}

function _toBoolLikeAi_(value) {
  if (typeof value === 'boolean') return value;
  var txt = String(value == null ? '' : value).trim().toLowerCase();
  if (!txt) return false;
  if (txt === 'true' || txt === '1' || txt === 'yes' || txt === 'on' || txt === 'oui' || txt === 'pro') return true;
  if (txt === 'false' || txt === '0' || txt === 'no' || txt === 'off' || txt === 'non') return false;
  return false;
}

function _getAiTokenScope_() {
  var ssId = '';
  try {
    ssId = String((getSS_ && getSS_() && getSS_().getId && getSS_().getId()) || SpreadsheetApp.getActiveSpreadsheet().getId() || '').trim();
  } catch (_) {
    ssId = '';
  }
  var orgId = '';
  try {
    var confRes = getSaaSSettings_(null);
    var conf = confRes && confRes.success && confRes.data ? confRes.data : {};
    orgId = String(conf.ORG_ID || conf.orgId || conf.ORG_REGISTER_ID || conf.SCHOOL_CODE || '').trim();
  } catch (_) {
    orgId = '';
  }
  return { ssId: ssId, orgId: orgId };
}

function _isAiProAccessEnabled_() {
  try {
    var confRes = getSaaSSettings_(null);
    var conf = confRes && confRes.success && confRes.data ? confRes.data : {};
    return _toBoolLikeAi_(conf.AI_PRO_ACCESS || conf.aiProAccess || conf.ai_pro_access);
  } catch (_) {
    return false;
  }
}

const AI_PLAN_QUOTA_SHEET_NAME_ = 'AI_PLAN_QUOTAS';
const AI_PLAN_QUOTA_HEADERS_ = [
  'PLAN',
  'DAILY_TOKEN_LIMIT',
  'SESSION_TOKEN_LIMIT',
  'MONTHLY_TOKEN_LIMIT',
  'RESET_SESSION',
  'IS_ACTIVE',
  'UPDATED_AT'
];

function _normalizeAiPlanKey_(planRaw, isPro) {
  var p = normalizeSubscriptionPlan_(planRaw);
  if (/\bPRO\b|PROFESSIONAL|PREMIUM|ADVANCED/.test(p)) return 'PRO';
  if (/MEDIUM|MOYEN|STANDARD|STD/.test(p)) return 'MEDIUM';
  if (/GRATIS|FREE|GRATUIT|BASIC|STARTER/.test(p)) return 'GRATIS';
  return isPro ? 'PRO' : 'GRATIS';
}

function _normalizePlanCellKey_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function _ensureAiPlanQuotaSheet_() {
  var ss = getSS_();
  var sh = ensureStructuredSheet_(AI_PLAN_QUOTA_SHEET_NAME_, AI_PLAN_QUOTA_HEADERS_, ss);
  if (sh.getLastRow() <= 1) {
    sh.getRange(2, 1, 3, AI_PLAN_QUOTA_HEADERS_.length).setValues([
      ['GRATIS', '', '', '', 'FALSE', 'TRUE', new Date()],
      ['MEDIUM', '', '', '', 'FALSE', 'TRUE', new Date()],
      ['PRO', '', '', '', 'FALSE', 'TRUE', new Date()]
    ]);
  }
  return sh;
}

function _readAiPlanQuotaRow_(planKey) {
  var normalizedPlan = _normalizePlanCellKey_(planKey);
  var sh = _ensureAiPlanQuotaSheet_();
  var lastRow = sh.getLastRow();
  var lastCol = Math.max(1, sh.getLastColumn());
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(x){ return String(x || '').trim(); });
  var idxPlan = hdr.indexOf('PLAN');
  var idxDaily = hdr.indexOf('DAILY_TOKEN_LIMIT');
  var idxSession = hdr.indexOf('SESSION_TOKEN_LIMIT');
  var idxMonthly = hdr.indexOf('MONTHLY_TOKEN_LIMIT');
  var idxReset = hdr.indexOf('RESET_SESSION');
  var idxActive = hdr.indexOf('IS_ACTIVE');
  var idxUpdated = hdr.indexOf('UPDATED_AT');

  if (lastRow < 2 || idxPlan === -1) {
    var rowNum = sh.getLastRow() + 1;
    sh.appendRow([normalizedPlan, '', '', '', 'FALSE', 'TRUE', new Date()]);
    return {
      sh: sh,
      rowNumber: rowNum,
      idxReset: idxReset,
      idxUpdated: idxUpdated,
      active: true,
      resetSession: false,
      daily: 0,
      session: 0,
      monthly: 0
    };
  }

  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var plan = _normalizePlanCellKey_(row[idxPlan]);
    if (plan !== normalizedPlan) continue;
    return {
      sh: sh,
      rowNumber: i + 2,
      idxReset: idxReset,
      idxUpdated: idxUpdated,
      active: idxActive === -1
        ? true
        : !['false', '0', 'no', 'off', 'non'].includes(String(row[idxActive] || 'TRUE').trim().toLowerCase()),
      resetSession: idxReset === -1 ? false : _toBoolLikeAi_(row[idxReset]),
      daily: idxDaily === -1 ? 0 : _parsePositiveInt_(row[idxDaily]),
      session: idxSession === -1 ? 0 : _parsePositiveInt_(row[idxSession]),
      monthly: idxMonthly === -1 ? 0 : _parsePositiveInt_(row[idxMonthly])
    };
  }

  var newRow = sh.getLastRow() + 1;
  sh.appendRow([normalizedPlan, '', '', '', 'FALSE', 'TRUE', new Date()]);
  return {
    sh: sh,
    rowNumber: newRow,
    idxReset: idxReset,
    idxUpdated: idxUpdated,
    active: true,
    resetSession: false,
    daily: 0,
    session: 0,
    monthly: 0
  };
}

function _getAiQuotaLimits_(isPro) {
  try {
    var confRes = getSaaSSettings_(null);
    var conf = confRes && confRes.success && confRes.data ? confRes.data : {};
    var planKey = _normalizeAiPlanKey_(conf.SUBSCRIPTION_PLAN || conf.subscriptionPlan, !!isPro);

    var daily = _parsePositiveInt_(conf.AI_DAILY_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_DAILY_TOKEN_LIMIT_PRO)
      || _parsePositiveInt_(conf.AI_DAILY_TOKEN_LIMIT_FREE)
      || _parsePositiveInt_(conf.AI_FREE_DAILY_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_PRO_DAILY_TOKEN_LIMIT)
      || 0;

    var session = _parsePositiveInt_(conf.AI_SESSION_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_SESSION_TOKEN_LIMIT_PRO)
      || _parsePositiveInt_(conf.AI_SESSION_TOKEN_LIMIT_FREE)
      || _parsePositiveInt_(conf.AI_FREE_SESSION_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_PRO_SESSION_TOKEN_LIMIT)
      || 0;

    var monthly = _parsePositiveInt_(conf.AI_MONTHLY_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_MONTHLY_TOKEN_LIMIT_PRO)
      || _parsePositiveInt_(conf.AI_MONTHLY_TOKEN_LIMIT_FREE)
      || _parsePositiveInt_(conf.AI_FREE_MONTHLY_TOKEN_LIMIT)
      || _parsePositiveInt_(conf.AI_PRO_MONTHLY_TOKEN_LIMIT)
      || 0;

    var source = (daily || session || monthly) ? 'REGISTER' : 'NONE';
    var resetSession = false;

    if (!source && planKey) {
      var rowInfo = _readAiPlanQuotaRow_(planKey);
      daily = Number(rowInfo && rowInfo.daily || 0);
      session = Number(rowInfo && rowInfo.session || 0);
      monthly = Number(rowInfo && rowInfo.monthly || 0);
      resetSession = !!(rowInfo && rowInfo.active && rowInfo.resetSession);
      source = (daily || session || monthly) ? 'AI_PLAN_QUOTAS' : 'NONE';

      if (resetSession && rowInfo && rowInfo.sh && rowInfo.idxReset !== -1) {
        try {
          rowInfo.sh.getRange(rowInfo.rowNumber, rowInfo.idxReset + 1).setValue('FALSE');
          if (rowInfo.idxUpdated !== -1) rowInfo.sh.getRange(rowInfo.rowNumber, rowInfo.idxUpdated + 1).setValue(new Date());
        } catch (_) {}
      }
    }

    return {
      daily: daily,
      session: session,
      monthly: monthly,
      resetSession: resetSession,
      planKey: planKey,
      source: source
    };
  } catch (_) {
    return { daily: 0, session: 0, monthly: 0, resetSession: false, planKey: (isPro ? 'PRO' : 'GRATIS'), source: 'NONE' };
  }
}

// Backward compatibility helper used by existing call sites.
function _getAiDailyTokenLimit_(isPro) {
  var limits = _getAiQuotaLimits_(!!isPro);
  return Number(limits.daily || 0);
}

// Returns cumulative tokens used today (input + output).
// Reads from 'AI_Token_Log' sheet in master auth spreadsheet.
// Cached for 30 s to avoid repeated reads.
function _getAiTodayTokenUsage_(scope) {
  try {
    var tz = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var scoped = scope || _getAiTokenScope_();
    var ssScope = String((scoped && scoped.ssId) || '').trim();
    var orgScope = String((scoped && scoped.orgId) || '').trim();
    var cache = CacheService.getScriptCache();
    var cacheKey = 'AI_TOKEN_USAGE_' + today + '_' + ssScope + '_' + orgScope;
    var cached = cache.get(cacheKey);
    if (cached !== null) return parseInt(cached, 10) || 0;

    var master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    var sh = master && master.getSheetByName('AI_Token_Log');
    if (!sh || sh.getLastRow() < 2) {
      cache.put(cacheKey, '0', 30);
      return 0;
    }

    var lastRow = sh.getLastRow();
    var lastCol = Math.max(1, sh.getLastColumn());
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(x){ return String(x || '').trim(); });
    var idxDate = headers.indexOf('Date');
    var idxIn = headers.indexOf('Input_Tokens');
    var idxOut = headers.indexOf('Output_Tokens');
    var idxSs = headers.indexOf('SpreadsheetId');
    var idxOrg = headers.indexOf('OrgId');
    var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues(); // skip header
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var rowDate = String(rows[i][idxDate >= 0 ? idxDate : 0] || '').trim();
      if (rowDate !== today) continue;
      // School-scoped filter if scope is available and log contains scope columns.
      if (ssScope && idxSs !== -1) {
        var rowSs = String(rows[i][idxSs] || '').trim();
        if (rowSs && rowSs !== ssScope) continue;
      }
      if (orgScope && idxOrg !== -1) {
        var rowOrg = String(rows[i][idxOrg] || '').trim();
        if (rowOrg && rowOrg !== orgScope) continue;
      }
      total += (parseInt(rows[i][idxIn >= 0 ? idxIn : 1], 10) || 0) + (parseInt(rows[i][idxOut >= 0 ? idxOut : 2], 10) || 0);
    }
    cache.put(cacheKey, String(total), 30);
    return total;
  } catch (_) { return 0; }
}

function _getAiMonthTokenUsage_(scope) {
  try {
    var tz = Session.getScriptTimeZone();
    var month = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    var scoped = scope || _getAiTokenScope_();
    var ssScope = String((scoped && scoped.ssId) || '').trim();
    var orgScope = String((scoped && scoped.orgId) || '').trim();
    var cache = CacheService.getScriptCache();
    var cacheKey = 'AI_TOKEN_USAGE_MONTH_' + month + '_' + ssScope + '_' + orgScope;
    var cached = cache.get(cacheKey);
    if (cached !== null) return parseInt(cached, 10) || 0;

    var master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    var sh = master && master.getSheetByName('AI_Token_Log');
    if (!sh || sh.getLastRow() < 2) {
      cache.put(cacheKey, '0', 30);
      return 0;
    }

    var lastRow = sh.getLastRow();
    var lastCol = Math.max(1, sh.getLastColumn());
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(x){ return String(x || '').trim(); });
    var idxDate = headers.indexOf('Date');
    var idxIn = headers.indexOf('Input_Tokens');
    var idxOut = headers.indexOf('Output_Tokens');
    var idxSs = headers.indexOf('SpreadsheetId');
    var idxOrg = headers.indexOf('OrgId');
    var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var rowDate = String(rows[i][idxDate >= 0 ? idxDate : 0] || '').trim();
      if (rowDate.indexOf(month) !== 0) continue;
      if (ssScope && idxSs !== -1) {
        var rowSs = String(rows[i][idxSs] || '').trim();
        if (rowSs && rowSs !== ssScope) continue;
      }
      if (orgScope && idxOrg !== -1) {
        var rowOrg = String(rows[i][idxOrg] || '').trim();
        if (rowOrg && rowOrg !== orgScope) continue;
      }
      total += (parseInt(rows[i][idxIn >= 0 ? idxIn : 1], 10) || 0) + (parseInt(rows[i][idxOut >= 0 ? idxOut : 2], 10) || 0);
    }
    cache.put(cacheKey, String(total), 30);
    return total;
  } catch (_) { return 0; }
}

function _getAiSessionTokenUsage_(email, conversationId) {
  var user = String(email || '').trim().toLowerCase();
  var conv = String(conversationId || '').trim();
  if (!user || !conv) return 0;
  try {
    var ensured = _ensureAiChatLibrarySheet_();
    if (!ensured || ensured.success === false) return 0;
    var sh = ensured.sh;
    var last = sh.getLastRow();
    if (last <= 1) return 0;
    var maxRows = Math.min(Math.max(last - 1, 1), 5000);
    var start = Math.max(2, last - maxRows + 1);
    var data = sh.getRange(start, 1, last - start + 1, AI_CHAT_LIBRARY_HEADERS.length).getValues();
    var total = 0;
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var rowUser = String(row[1] || '').trim().toLowerCase();
      var rowConv = String(row[2] || '').trim();
      if (rowUser !== user || rowConv !== conv) continue;
      total += (parseInt(row[9], 10) || 0) + (parseInt(row[10], 10) || 0);
    }
    return total;
  } catch (_) {
    return 0;
  }
}

// Appends a token-usage row to 'AI_Token_Log' in master auth.
// Creates the sheet + header row if it doesn't exist.
function _recordAiTokenUsage_(inputTokens, outputTokens, model, provider, scope) {
  try {
    var input  = parseInt(inputTokens,  10) || 0;
    var output = parseInt(outputTokens, 10) || 0;
    if (!input && !output) return;
    var scoped = scope || _getAiTokenScope_();
    var ssIdScoped = String((scoped && scoped.ssId) || '').trim();
    var orgIdScoped = String((scoped && scoped.orgId) || '').trim();

    var lock = LockService.getScriptLock();
    lock.tryLock(3000);
    try {
      var tz     = Session.getScriptTimeZone();
      var today  = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      var ts     = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
      var master = SpreadsheetApp.openById(MASTER_AUTH_ID);
      var sh     = master.getSheetByName('AI_Token_Log');
      if (!sh) {
        sh = master.insertSheet('AI_Token_Log');
        sh.getRange(1, 1, 1, 7).setValues([['Date', 'Input_Tokens', 'Output_Tokens', 'Model', 'Provider', 'SpreadsheetId', 'OrgId']]);
        sh.setFrozenRows(1);
      }
      // Backward-compatible schema migration: add scope columns if absent.
      var hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function(x){ return String(x || '').trim(); });
      if (hdr.indexOf('SpreadsheetId') === -1) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue('SpreadsheetId');
      }
      hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function(x){ return String(x || '').trim(); });
      if (hdr.indexOf('OrgId') === -1) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue('OrgId');
      }
      hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function(x){ return String(x || '').trim(); });
      var row = new Array(hdr.length).fill('');
      var idxDate = hdr.indexOf('Date');
      var idxIn = hdr.indexOf('Input_Tokens');
      var idxOut = hdr.indexOf('Output_Tokens');
      var idxModel = hdr.indexOf('Model');
      var idxProvider = hdr.indexOf('Provider');
      var idxSs = hdr.indexOf('SpreadsheetId');
      var idxOrg = hdr.indexOf('OrgId');
      if (idxDate !== -1) row[idxDate] = today;
      if (idxIn !== -1) row[idxIn] = input;
      if (idxOut !== -1) row[idxOut] = output;
      if (idxModel !== -1) row[idxModel] = String(model || '');
      if (idxProvider !== -1) row[idxProvider] = String(provider || '');
      if (idxSs !== -1) row[idxSs] = ssIdScoped;
      if (idxOrg !== -1) row[idxOrg] = orgIdScoped;
      sh.appendRow(row);
      // Bust cache so next status read is fresh
      CacheService.getScriptCache().remove('AI_TOKEN_USAGE_' + today + '_' + ssIdScoped + '_' + orgIdScoped);
      CacheService.getScriptCache().remove('AI_TOKEN_USAGE_MONTH_' + today.slice(0, 7) + '_' + ssIdScoped + '_' + orgIdScoped);
    } finally {
      lock.releaseLock();
    }
  } catch (_) {}
}

// Returns token-usage status for the admin token banner.
// Permission required: isMaster | isGodMode | pa_save_settings
// ─────────────────────────────────────────────────────────────────────────────
// getDirectAiKey_  (ADMIN-ONLY)
// Returns the Anthropic API key so the frontend can call the API directly,
// bypassing the AI_Token_Log quota gate when it is erroneously exhausted.
// Security: only isMaster / isGodMode / pa_save_settings admins may call this.
// ─────────────────────────────────────────────────────────────────────────────
function getDirectAiKey_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth || {});
    if (!viewer || !viewer.success) {
      return { success: false, error: 'SESSION_EXPIREE' };
    }
    var perms = viewer.permissions || {};
    var isAdmin = viewer.isMaster || viewer.isGodMode ||
                  !!(perms.pa_save_settings || perms.p_settings);
    if (!isAdmin) {
      return { success: false, error: 'PERMISSION_REFUSEE',
               message: 'Réservé aux administrateurs.' };
    }

    // Resolve key through the same priority chain used by processUserMessage_
    var key = _getServerAiSecretByAliases_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) ||
              _getServerAiSettingByAliases_(['SYSTEM_ANTHROPIC_API_KEY', 'SYSTEM_CLAUDE_API_KEY'], '') ||
              '';

    if (!key || !_isAnthropicApiKey_(key)) {
      return { success: false, error: 'KEY_NOT_FOUND',
               message: 'Aucune clé Anthropic valide trouvée dans les propriétés ou la feuille Settings.' };
    }

    _audit_safe_('GET_DIRECT_AI_KEY', { admin: viewer.email }, auth);
    return { success: true, key: key, model: 'claude-haiku-4-5-20251001' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resetAiTokenLog_  (ADMIN-ONLY)
// Clears today's rows from AI_Token_Log and busts all related caches so the
// quota gate reopens immediately without waiting for the daily rollover.
// ─────────────────────────────────────────────────────────────────────────────
function resetAiTokenLog_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth || {});
    if (!viewer || !viewer.success) {
      return { success: false, error: 'SESSION_EXPIREE' };
    }
    var perms = viewer.permissions || {};
    var isAdmin = viewer.isMaster || viewer.isGodMode ||
                  !!(perms.pa_save_settings || perms.p_settings);
    if (!isAdmin) {
      return { success: false, error: 'PERMISSION_REFUSEE' };
    }

    var master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    var sh = master && master.getSheetByName('AI_Token_Log');
    var deletedRows = 0;

    if (sh && sh.getLastRow() > 1) {
      var tz = Session.getScriptTimeZone();
      var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      var lastRow = sh.getLastRow();
      var lastCol = Math.max(1, sh.getLastColumn());
      var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
                      .map(function(x){ return String(x || '').trim(); });
      var idxDate = headers.indexOf('Date');
      if (idxDate < 0) idxDate = 0; // fallback to first column

      // Collect rows to delete (iterate bottom-up to keep indices stable)
      var toDelete = [];
      var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        var rowDate = String(rows[i][idxDate] || '').trim();
        if (rowDate === today || rowDate.indexOf(today) === 0) {
          toDelete.push(i + 2); // +2 = 1-indexed + header offset
        }
      }
      toDelete.forEach(function(rowNum) {
        sh.deleteRow(rowNum);
        deletedRows++;
      });
    }

    // Bust all cached token-usage keys for today
    try {
      var cache = CacheService.getScriptCache();
      var tz2 = Session.getScriptTimeZone();
      var todayKey = Utilities.formatDate(new Date(), tz2, 'yyyy-MM-dd');
      var monthKey = Utilities.formatDate(new Date(), tz2, 'yyyy-MM');
      // Purge generic keys (scoped variants expire on their own 30-s TTL)
      cache.remove('AI_TOKEN_USAGE_' + todayKey + '__');
      cache.remove('AI_TOKEN_USAGE_MONTH_' + monthKey + '__');
    } catch (_cacheErr) {}

    _audit_safe_('RESET_AI_TOKEN_LOG', { deletedRows: deletedRows, admin: viewer.email }, auth);
    return { success: true, deletedRows: deletedRows,
             message: deletedRows + ' entrée(s) supprimée(s) du journal. Le quota est réinitialisé.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getAiTokenStatus_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth || {});
    if (!viewer || !viewer.success) return { success: false, error: 'SESSION_EXPIREE' };
    var perms = viewer.permissions || {};
    if (!viewer.isMaster && !viewer.isGodMode && !perms.pa_save_settings && !perms.p_use_ai)
      return { success: false, error: 'PERMISSION_REFUSEE' };

    var scope = _getAiTokenScope_();
    var isPro = _isAiProAccessEnabled_();
    var payload = (data && typeof data === 'object') ? data : {};
    var conversationId = String(payload.conversationId || '').trim();
    var limits = _getAiQuotaLimits_(isPro);
    var limit   = Number(limits.daily || 0);
    var used    = _getAiTodayTokenUsage_(scope);
    var usedMonth = _getAiMonthTokenUsage_(scope);
    var usedSession = conversationId ? _getAiSessionTokenUsage_(viewer.email, conversationId) : 0;
    var quotaConfigured = limit > 0 || Number(limits.session || 0) > 0 || Number(limits.monthly || 0) > 0;
    var pctUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    var pctLeft = 100 - pctUsed;
    var remaining = Math.max(0, limit - used);
    var warning = '';
    if (!quotaConfigured) {
      warning = isPro
        ? 'Quota IA non configuré. Renseignez la feuille AI_PLAN_QUOTAS (plan PRO) : DAILY_TOKEN_LIMIT, SESSION_TOKEN_LIMIT, MONTHLY_TOKEN_LIMIT. Utilisez RESET_SESSION=TRUE pour forcer une nouvelle session.'
        : 'Quota IA non configuré. Renseignez la feuille AI_PLAN_QUOTAS (plan GRATIS/MEDIUM) : DAILY_TOKEN_LIMIT, SESSION_TOKEN_LIMIT, MONTHLY_TOKEN_LIMIT. Utilisez RESET_SESSION=TRUE pour forcer une nouvelle session.';
    }
    return {
      success:   true,
      usedToday: used,
      limit:     limit,
      pctUsed:   pctUsed,
      pctLeft:   pctLeft,
      remaining: remaining,
      usedMonth: usedMonth,
      usedSession: usedSession,
      limits: limits,
      quotaPlan: limits.planKey || '',
      quotaSource: limits.source || '',
      quotaConfigured: quotaConfigured,
      warning: warning,
      message: warning,
      // explicit aliases for frontend compatibility
      percentUsed: pctUsed,
      percentLeft: pctLeft,
      used: used,
      dailyLimit: limit,
      sessionLimit: Number(limits.session || 0),
      monthlyLimit: Number(limits.monthly || 0),
      usagePercent: pctUsed,
      remainingPercent: pctLeft,
      isPro: isPro,
      proAccess: isPro,
      scope: scope,
      data: {
        usedToday: used,
        limit: limit,
        usedSession: usedSession,
        usedMonth: usedMonth,
        limits: limits,
        pctUsed: pctUsed,
        pctLeft: pctLeft,
        remaining: remaining,
        isPro: isPro
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── PER-USER AI CONFIG (stored in UserProperties, private per Google account) ──
// Returns { apiKey, provider, model, apiUrl } or null
function _getUserAiConfig_() {
  try {
    var raw = (PropertiesService.getUserProperties().getProperty('USER_AI_CONFIG') || '').trim();
    if (!raw) return null;
    var cfg = JSON.parse(raw);
    if (!cfg || !cfg.apiKey) return null;
    return cfg;
  } catch(_) { return null; }
}

function setUserAiApiKey_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, message: 'Session expirée.' };
  var perms = viewer.permissions || {};
  if (!perms.p_use_ai && !viewer.isMaster && !viewer.isGodMode)
    return { success: false, message: 'Permission p_use_ai requise.' };

  var key      = String((data && data.apiKey) || '').trim();
  var provider = String((data && data.provider) || 'anthropic').toLowerCase().trim();
  if (provider === 'claude') provider = 'anthropic';
  if (provider === 'gemini') provider = 'google';
  if (!['anthropic','openai','google'].includes(provider)) provider = 'anthropic';

  var model = String((data && data.model) || '').trim();
  if (!model) {
    if (provider === 'openai')  model = SERVER_AI_OPENAI_DEFAULT_MODEL_;
    else if (provider === 'google') model = SERVER_AI_GEMINI_DEFAULT_MODEL_;
    else model = SERVER_AI_DEFAULT_MODEL_;
  }
  var apiUrl = String((data && data.apiUrl) || '').trim();
  if (!apiUrl) {
    if (provider === 'openai')  apiUrl = SERVER_AI_OPENAI_DEFAULT_API_URL_;
    else if (provider === 'google') apiUrl = '';
    else apiUrl = SERVER_AI_DEFAULT_API_URL_;
  }

  if (key) {
    PropertiesService.getUserProperties().setProperty('USER_AI_CONFIG', JSON.stringify({
      apiKey: key, provider: provider, model: model, apiUrl: apiUrl
    }));
  } else {
    PropertiesService.getUserProperties().deleteProperty('USER_AI_CONFIG');
  }
  return { success: true, message: key ? 'Clé enregistrée.' : 'Clé effacée.', provider: provider, model: model };
}

function getUserAiApiKeyStatus_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { configured: false };
  var cfg = _getUserAiConfig_();
  if (!cfg) return { configured: false };
  return { configured: true, provider: cfg.provider || 'anthropic', model: cfg.model || '' };
}

// Verify the stored user key with a minimal real API call
function verifyUserAiApiKey_(data, auth) {
  var viewer = getViewerInfo_(auth || {});
  if (!viewer || !viewer.success) return { success: false, message: 'Session expirée.' };
  var perms = viewer.permissions || {};
  if (!perms.p_use_ai && !viewer.isMaster && !viewer.isGodMode)
    return { success: false, message: 'Permission p_use_ai requise.' };

  var cfg = _getUserAiConfig_();
  if (!cfg || !cfg.apiKey) return { success: false, message: 'Aucune clé configurée.' };

  try {
    var resp, statusCode, body;
    if (cfg.provider === 'openai') {
      resp = UrlFetchApp.fetch(cfg.apiUrl || SERVER_AI_OPENAI_DEFAULT_API_URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        payload: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
        muteHttpExceptions: true
      });
    } else if (cfg.provider === 'google') {
      var gUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(cfg.model) + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
      resp = UrlFetchApp.fetch(gUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ 
          systemInstruction: { parts: [{ text: 'Test ping' }] },
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }], 
          generationConfig: { maxOutputTokens: 5 } 
        }),
        muteHttpExceptions: true
      });
    } else {
      // Anthropic
      resp = UrlFetchApp.fetch(cfg.apiUrl || SERVER_AI_DEFAULT_API_URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({ model: cfg.model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
        muteHttpExceptions: true
      });
    }
    statusCode = Number(resp.getResponseCode() || 0);
    if (statusCode === 200) {
      return { success: true, message: 'Clé valide.', provider: cfg.provider, model: cfg.model };
    }
    body = String(resp.getContentText() || '').substring(0, 200);
    var isQuota = statusCode === 429;
    return {
      success: false,
      message: isQuota ? 'Quota dépassé — clé valide mais limite atteinte.' : 'Clé invalide (HTTP ' + statusCode + ').',
      status: statusCode,
      detail: body,
      quota: isQuota
    };
  } catch(e) {
    return { success: false, message: 'Erreur réseau: ' + e.message };
  }
}

function translateMeigensText_(text, lang) {
  if (!lang || lang === 'fr') return text;
  try { return LanguageApp.translate(text, 'fr', lang); } catch(e) { return text; }
}
function _getHomeworkContextForAi_(maxRows) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('Homework');
    if (!sh || sh.getLastRow() < 2) return '';

    const cap = Math.max(1, Math.min(25, Number(maxRows || 8)));
    const data = sh.getDataRange().getValues();
    const headers = data[0].map(function(h){ return String(h || '').trim(); });
    const upper = headers.map(function(h){ return h.toUpperCase(); });
    const findIdx = function(candidates){
      for (var i = 0; i < candidates.length; i++) {
        var idx = upper.indexOf(candidates[i]);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const iDate = findIdx(['DATE', 'ASSIGNEDDATE', 'CREATEDAT']);
    const iClass = findIdx(['CLASS', 'CLASSNAME', 'LEVEL', 'GRADE']);
    const iSubject = findIdx(['SUBJECT', 'MATIERE']);
    const iTitle = findIdx(['TITLE', 'HOMEWORK', 'DESCRIPTION', 'TASK']);
    const iDue = findIdx(['DUEDATE', 'DEADLINE', 'DUE']);

    const rows = data.slice(1).filter(function(r){
      if (iTitle !== -1 && String(r[iTitle] || '').trim()) return true;
      return r.some(function(v){ return String(v || '').trim(); });
    }).slice(-cap);

    if (!rows.length) return '';
    return rows.map(function(r){
      var dateVal = iDate !== -1 ? r[iDate] : '';
      var dateTxt = '';
      if (dateVal instanceof Date) dateTxt = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      else dateTxt = String(dateVal || '').trim();
      var cls = iClass !== -1 ? String(r[iClass] || '').trim() : '';
      var subj = iSubject !== -1 ? String(r[iSubject] || '').trim() : '';
      var title = iTitle !== -1 ? String(r[iTitle] || '').trim() : '';
      var dueVal = iDue !== -1 ? r[iDue] : '';
      var dueTxt = '';
      if (dueVal instanceof Date) dueTxt = Utilities.formatDate(dueVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      else dueTxt = String(dueVal || '').trim();
      var parts = [];
      if (dateTxt) parts.push('date=' + dateTxt);
      if (cls) parts.push('classe=' + cls);
      if (subj) parts.push('matiere=' + subj);
      if (title) parts.push('devoir=' + title);
      if (dueTxt) parts.push('echeance=' + dueTxt);
      return '- ' + (parts.length ? parts.join(' | ') : JSON.stringify(r));
    }).join('\n');
  } catch (_) {
    return '';
  }
}

// ── LEAN SYSTEM PROMPT ─────────────────────────────────────────────────────
// FIX: replaces _buildAiSystemPrompt_ which read the Homework sheet every call.
// Homework digest is now conditional — only fetched when the question needs it.

var MEIGENS_CONFIG_SCHEMA_BACKEND_ = [
  { id: 'school_name',       label: "Nom de l'établissement",     section: 'Identité',           required: true,  keys: ['SCHOOL_NAME','schoolName','BUSINESS_NAME','ORG_NAME'] },
  { id: 'academic_year',     label: 'Année scolaire',              section: 'Académique',          required: true,  keys: ['ACADEMIC_YEAR','CURRENT_ACADEMIC_YEAR','currentAcademicYear'] },
  { id: 'num_periods',       label: 'Nombre de périodes',          section: 'Académique',          required: true,  keys: ['NUM_PERIODS','TOTAL_TERMS','TERM_COUNT'] },
  { id: 'levels',            label: "Niveaux d'enseignement",      section: 'Structure scolaire',  required: true,  keys: ['LEVELS','ACTIVE_LEVELS','levels','activeLevels','SCHOOL_LEVELS','ACADEMIC_LEVELS','_levelsDetected'] },
  { id: 'curriculum',        label: 'Matières et curriculum',      section: 'Pédagogie',           required: true,  keys: ['SCHOOL_CURRICULUM','_curriculumDetected'] },
  { id: 'grading_format',    label: 'Format de notation',          section: 'Évaluation',          required: true,  keys: ['GRADING_FORMAT','gradingType','grading_format','GRADING_SCALE','maxScore','MAX_SCORE','GRADE_MAX'] },
  { id: 'currency',          label: 'Devise',                      section: 'Finance',             required: true,  keys: ['CURRENCY','currency'] },
  { id: 'grading_scale',     label: 'Barème de notation',          section: 'Évaluation',          required: false, keys: ['GRADING_SCALE','maxScore'] },
  { id: 'pass_mark',         label: 'Note de passage',             section: 'Évaluation',          required: false, keys: ['PASS_MARK','PROMOTION_MIN_AVG','passMark','passingScore'] },
  { id: 'tuition_mode',      label: 'Mode de facturation',         section: 'Finance',             required: false, keys: ['TUITION_MODE'] },
  { id: 'tuition_amount',    label: 'Montant des frais',           section: 'Finance',             required: false, keys: ['TUITION_AMOUNT_GLOBAL','TUITION_AMOUNT'] },
  { id: 'tuition_frequency', label: 'Fréquence de paiement',       section: 'Finance',             required: false, keys: ['TUITION_FREQUENCY'] },
  { id: 'attendance_time',   label: "Heure d'entrée",              section: 'Présence',            required: false, keys: ['ATTENDANCE_ENTRY_TIME'] },
  { id: 'attendance_alert',  label: "Seuil d'alerte présence",     section: 'Présence',            required: false, keys: ['ATTENDANCE_THRESHOLD','ATTENDANCE_ADMIN_ALERT_MIN'] },
  { id: 'school_phone',      label: 'Téléphone',                   section: 'Identité',           required: false, keys: ['SCHOOL_PHONE','PHONE','TRANSACTION_PHONE'] },
  { id: 'school_email',      label: 'Email',                       section: 'Identité',           required: false, keys: ['SCHOOL_EMAIL','EMAIL'] },
  { id: 'bulletin_rules',    label: 'Règles bulletin',             section: 'Évaluation',          required: false, keys: ['BULLETIN_DIVISOR_RULES_JSON'] }
];

/**
 * Build a human-readable config status from the server-side Settings.
 * Returns { configuredLines, missingLines, missingRequired, readinessScore, nextHint }
 */
function _buildMeigensConfigStatus_(conf) {
  var cfg = (conf && typeof conf === 'object') ? conf : {};

  // ── SYNTHESIZE VIRTUAL KEYS from context data ────────────────────────
  // curriculumTotalSubjects / curriculumByLevel come from _buildServerAiContext_
  // and reliably prove curriculum/levels exist even when flat keys are absent.
  if (!cfg._curriculumDetected) {
    var _hasChunkedCurriculum = Object.keys(cfg).some(function(k) {
      return /^CURRICULUM_/i.test(k) && cfg[k];
    });
    if (Number(cfg.curriculumTotalSubjects || 0) > 0 || cfg.curriculumHasSubjects || _hasChunkedCurriculum) {
      cfg = Object.assign({}, cfg, { _curriculumDetected: 'oui' });
    }
  }
  if (!cfg._levelsDetected) {
    var _hasLevels = (Array.isArray(cfg.curriculumByLevel) && cfg.curriculumByLevel.length > 0)
      || (Array.isArray(cfg.curriculumRequestedLevels) && cfg.curriculumRequestedLevels.length > 0);
    if (_hasLevels) {
      cfg = Object.assign({}, cfg, { _levelsDetected: 'oui' });
    }
  }

  // ── COEFFICIENT-BASED GRADING ─────────────────────────────────────────
  // When the curriculum already assigns a coefficient per subject, the school
  // does NOT need a global maximum score or universal passing mark — each
  // subject's coefficient drives weighting. Auto-satisfy those config items so
  // the AI stops asking for /20, /100 or a pass mark in that scenario.
  if (cfg.curriculumUsesCoefficients) {
    var _coeffOverride = {};
    if (!cfg.GRADING_FORMAT && !cfg.gradingType && !cfg.grading_format && !cfg.GRADING_SCALE && !cfg.maxScore && !cfg.MAX_SCORE && !cfg.GRADE_MAX) {
      _coeffOverride.GRADING_FORMAT = 'Coefficient par matière';
    }
    if (!cfg.GRADING_SCALE && !cfg.maxScore) {
      _coeffOverride.GRADING_SCALE = 'Coefficient par matière';
    }
    if (!cfg.PASS_MARK && !cfg.PROMOTION_MIN_AVG && !cfg.passMark && !cfg.passingScore) {
      _coeffOverride.PASS_MARK = 'Coefficient par matière';
    }
    if (Object.keys(_coeffOverride).length) {
      cfg = Object.assign({}, cfg, _coeffOverride);
    }
  }

  function hasVal(keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = cfg[keys[i]];
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'string' && !v.trim()) continue;
      if (typeof v === 'object' && Object.keys(v).length === 0) continue;
      return true;
    }
    return false;
  }

  function getVal(keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = cfg[keys[i]];
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'string' && !v.trim()) continue;
      if (typeof v === 'object') return '[configuré]';
      return String(v).slice(0, 60);
    }
    return '';
  }

  var configured = [];
  var missingRequired = [];
  var missingOptional = [];

  MEIGENS_CONFIG_SCHEMA_BACKEND_.forEach(function(item) {
    if (hasVal(item.keys)) {
      configured.push(item.label + ' : ' + getVal(item.keys));
    } else if (item.required) {
      missingRequired.push(item);
    } else {
      missingOptional.push(item);
    }
  });

  var total = MEIGENS_CONFIG_SCHEMA_BACKEND_.length;
  var score = Math.round((configured.length / total) * 100);

  var nextHint = null;
  if (missingRequired.length > 0) {
    nextHint = missingRequired[0].label + ' — ' + _getMeigensHint_(missingRequired[0].id);
  } else if (missingOptional.length > 0) {
    nextHint = missingOptional[0].label + ' — ' + _getMeigensHint_(missingOptional[0].id);
  }

  return {
    configuredLines: configured,
    missingRequired: missingRequired,
    missingOptional: missingOptional,
    readinessScore: score,
    isOperational: missingRequired.length === 0,
    nextHint: nextHint,
    summary: missingRequired.length === 0
      ? 'Système opérationnel (' + configured.length + '/' + total + ' paramètres)'
      : configured.length + '/' + total + ' paramètres configurés — ' + missingRequired.length + ' requis manquants'
  };
}

/**
 * Human-readable configuration hint for each schema item id.
 */
function _getMeigensHint_(id) {
  var hints = {
    school_name:       "Quel est le nom officiel de l'établissement ?",
    academic_year:     "Quelle est l'année scolaire en cours ? (ex: 2024-2025)",
    num_periods:       "Combien de trimestres / périodes comptez-vous par année ? (ex: 3)",
    levels:            "Quels niveaux proposez-vous ? (Maternelle, Fondamental, Secondaire…)",
    curriculum:        "Les matières n'ont pas encore été définies. Souhaitez-vous que je propose une liste de départ pour chaque niveau ?",
    grading_format:    "Comment notez-vous les élèves ? (ex: /20, /100, Lettres A–F)",
    currency:          "Quelle devise utilisez-vous ? (ex: HTG, USD)",
    grading_scale:     "Quel est le score maximum par devoir ou examen ? (ex: 20)",
    pass_mark:         "Quelle est la note minimale pour valider une période ? (ex: 10/20)",
    tuition_mode:      "Facturez-vous les frais de façon globale, par classe ou par cycle ?",
    tuition_amount:    "Quel est le montant annuel des frais de scolarité ?",
    tuition_frequency: "Les frais sont-ils payés annuellement, trimestriellement, mensuellement ?",
    attendance_time:   "À quelle heure commence la journée scolaire ?",
    attendance_alert:  "À quel taux d'absence souhaitez-vous être alerté ? (ex: 75%)",
    school_phone:      "Quel est le numéro de téléphone principal de l'établissement ?",
    school_email:      "Quelle est l'adresse email de l'établissement ?",
    bulletin_rules:    "Y a-t-il des règles spéciales pour le calcul des bulletins ?"
  };
  return hints[id] || 'Veuillez compléter ce paramètre dans les Paramètres du système.';
}

/* ──────────────────────────────────────────────────────────────────────────
   REPLACEMENT FUNCTION: _buildAiSystemPromptLean_
   Drop this in place of the existing function in school.js.
   ────────────────────────────────────────────────────────────────────────── */
function _buildAiSystemPromptLean_(viewer, payload, includeHomework, maxTokens) {
  var v     = (viewer && viewer.success) ? viewer : { role: 'Staff', permissions: {} };
  var role  = String(v.role || 'Staff').trim();
  var conf  = (payload && payload.context) ? payload.context : {};
  var rawCfg = {};

  // Pull raw config from server — cached 1 hr to avoid repeated Sheets reads
  try {
    var _sCacheKey = 'AI_SETTINGS_' + String(viewer && viewer.email || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
    var _sCache = CacheService.getScriptCache();
    var _sCached = _sCache.get(_sCacheKey);
    if (_sCached) {
      rawCfg = JSON.parse(_sCached);
    } else {
      var sr = getSaaSSettings_(viewer && viewer.email);
      if (sr && sr.success && sr.data) {
        rawCfg = sr.data;
        try {
          var _sSerialized = JSON.stringify(rawCfg);
          if (_sSerialized.length < 90000) _sCache.put(_sCacheKey, _sSerialized, 3600);
        } catch (_) {}
      }
    }
  } catch (_) {}

  var school = String(conf.schoolName || rawCfg.SCHOOL_NAME || rawCfg.schoolName || "l'établissement").trim();
  var toks   = Number(maxTokens) || 220;
  var lengthHint = toks >= 600
    ? "Réponds de façon concise et professionnelle (4 à 6 phrases max)."
    : "Réponds très brièvement (2 à 3 phrases max).";

  var isGod    = !!(conf.isGodMode || v.isGodMode || v.isMaster);
  var isAdmin  = !!(conf.isAdmin) || isGod || /directeur|admin|administrateur/i.test(role);
  var configStatus = _buildMeigensConfigStatus_(Object.assign({}, rawCfg, conf));

  // ── CORE IDENTITY ────────────────────────────────────────────────────
  var lines = [
    'Tu es l\'interface IA de MeigensTech — le lien entre la plateforme Meigens et l\'établissement "' + school + '". Tu facilites l\'utilisation du système de gestion scolaire et accompagnes l\'équipe au quotidien.',
    'Rôle de l\'interlocuteur : ' + role + '.',
    lengthHint,
    '',
    '=== COMPORTEMENT OBLIGATOIRE ===',
    '• Tu parles TOUJOURS au nom de MeigensTech : utilise "Nous chez MeigensTech", "Notre plateforme", "Nous recommandons…".',
    '• Tu NE RÉVÈLES JAMAIS les noms techniques internes (noms de feuilles, clés système, tables, IDs back-end).',
    '• Tu NE DIS JAMAIS "master spreadsheet", "feuille X", "table Y", "onglet Z" ni aucun terme technique interne.',
    '• Si on te demande la source d\'une information, réponds : "Ces données proviennent de la configuration enregistrée de l\'établissement."',
    '• Tu t\'exprimes toujours en langage métier clair : "programme académique", "paramètres de l\'établissement", "bibliothèque de référence Meigens".'
  ];

  // Volatile sections (config snapshot, coefficient notice, data, etc.) are
  // appended AFTER the <<<CACHE_SPLIT>>> sentinel further down so they never
  // invalidate the cached identity/rules prefix above (Anthropic prompt
  // caching ~90% input cost cut + 30-50% lower TTFB on follow-up turns).

  // ── STYLE & GROUPED RESPONSE RULES ─────────────────────────────────
  lines.push('');
  lines.push('=== STYLE DE RÉPONSE ===');
  lines.push('• Réponds en prose naturelle, directe et complète — comme un expert MeigensTech qui connaît le système.');
  lines.push('• N\'utilise PAS de tableaux markdown (|col|col|). Pour les matières, émets un bloc [CURRICULUM_DISPLAY] à la place.');
  lines.push('• N\'impose PAS une question oui/non à la fin de chaque message sauf si vraiment nécessaire.');
  lines.push('• Si l\'utilisateur envoie plusieurs questions ou plusieurs mises à jour dans un seul message (ex: "FRANÇAIS coef 3 / MATH coef 4 / pas de MUSIQUE"), traite-les TOUS dans une seule réponse : liste ce que tu as compris, et demande une confirmation globale avant d\'appliquer.');
  lines.push('• Pour afficher un curriculum, des matières ou des branchements : utilise OBLIGATOIREMENT le format JSON entre balises [CURRICULUM_DISPLAY] et [/CURRICULUM_DISPLAY], avec la structure { "title": "...", "subjects": [{ "label": "...", "coeff": N, "branches": [{ "label": "...", "max": N }] }] }. Ne retourne JAMAIS un tableau markdown plat à la place.');
  lines.push('• Les données de branches (sous-matières) sont disponibles dans le contexte curriculum — inclus-les systématiquement.');
  lines.push('• Si des documents sont joints (PDF, image, Word, Excel, CSV, texte), considère-les comme des sources à analyser: extrais leur structure utile, explique ce que MeigensTech peut reprendre, adapter, importer ou générer à partir de ces pièces, puis propose l\'action suivante la plus concrète.');
  lines.push('• Pour un bulletin personnalisé, une maquette de relevé de notes ou un formulaire externe, indique clairement: 1. ce qui peut être reproduit dans MeigensTech, 2. quelles données peuvent être importées ou ressaisies, 3. ce qui nécessite une validation ou une configuration complémentaire.');
  lines.push('• N\'invente jamais une note, un coefficient, un nom d\'élève ou une structure absente du document. Si l\'extraction est partielle ou ambiguë, signale-le explicitement.');
  lines.push('• INTERDIT: ne dis jamais que le "cache local" est incomplet, que tu n\'as pas les détails, ou que l\'utilisateur doit aller dans "Paramètres" pour continuer. Utilise le contexte disponible et agis directement.');
  lines.push('• Si une modification est demandée (finance, frais, échéance, remise, bourse, devise, année, etc.), ne renvoie pas vers une page: prépare une exécution via [AI_ACTION] ou demande UNIQUEMENT la donnée strictement manquante pour exécuter.');
  lines.push('• Pour les questions finance: réponds avec ce qui est déjà configuré ET termine par une proposition d\'action exécutable immédiatement (ex: mise à jour du mode de facturation, des montants, des plans, de la devise).');
  lines.push('• RÈGLE BRANCHES — deux modes exclusifs :');
  lines.push('    MODE BIBLIOTHÈQUE (défaut) : si l\'utilisateur consulte ou affiche un curriculum existant, utilise EXCLUSIVEMENT les branches présentes dans les données du registre transmis. N\'en ajoute ni n\'en modifie aucune. Si aucune branche n\'est dans les données pour une matière, laisse branches:[].');
  lines.push('    MODE PROPOSITION (sur demande explicite) : si et seulement si l\'utilisateur demande explicitement une proposition, suggestion ou recommandation de branchements (ex : \"propose des branches\", \"quels branchements recommandes-tu\", \"suggère une structure\"), tu peux proposer des branches pertinentes au-delà de la bibliothèque — en précisant clairement qu\'il s\'agit d\'une proposition Meigens, pas du programme enregistré.');

  // ── ROLE-SPECIFIC INSTRUCTIONS ───────────────────────────────────────
  lines.push('');
  lines.push('=== CAPACITÉS ===');
  lines.push('Tu peux exécuter directement toute action que l\'utilisateur a la permission d\'effectuer :');
  lines.push('✓ Configurer les matières, niveaux, coefficients et curriculum');
  lines.push('✓ Mettre à jour les paramètres académiques et financiers');
  lines.push('✓ Analyser les données élèves, présences, notes et paiements');
  lines.push('✓ Analyser des documents envoyés (bulletins personnalisés, relevés de notes, modèles PDF/images/tableurs) et dire précisément ce qui peut être repris dans MeigensTech');
  lines.push('✓ Générer des rapports croisés (académique / présence / finance)');
  lines.push('✓ Affecter des enseignants et gérer les horaires');
  lines.push('✓ Répondre à toute question d\'aide ou d\'orientation sur le système');

  // ── DYNAMIC ACTION PROTOCOL ──────────────────────────────────────────
  lines.push('');
  lines.push('=== PROTOCOLE D\'ACTION DYNAMIQUE ===');
  lines.push('Quand tu dois écrire, modifier ou créer des données, INTÈGRE un bloc [AI_ACTION]...[/AI_ACTION] dans ta réponse.');
  lines.push('Format JSON du bloc (une seule action par bloc, plusieurs blocs possibles) :');
  lines.push('[AI_ACTION]');
  lines.push('{ "api": "NOM_ACTION", "payload": { ... }, "label": "Description lisible", "confirm": true }');
  lines.push('[/AI_ACTION]');
  lines.push('');
  lines.push('Actions disponibles (utilise le bon "api" selon le besoin) :');
  lines.push('  • saveConfig — Sauvegarder des paramètres Settings (SCHOOL_NAME, ACADEMIC_YEAR, CURRENCY, SCHOOL_CURRICULUM_*, etc.)');
  lines.push('    Payload: { "CLÉ": "valeur", "CLÉ2": "valeur2" }');
  lines.push('  • saveChunkedCurriculum — Sauvegarder le curriculum complet avec matières et branches');
  lines.push('    Payload: { "sec_ns1": [...subjects], "sec_ns2": [...], "fond_1": [...], "mat_ps": [...] }');
  lines.push('    Subject shape: { "id": "FRANÇAIS", "label": "FRANÇAIS", "coeff": 300, "branches": [{"label": "Grammaire","max":150}] }');
  lines.push('  • updateSubjectCoeff — Modifier le coefficient d\'une matière (exécuté côté navigateur — action locale)');
  lines.push('    Payload: { "levelId": "fondamental", "subjectLabel": "ÉDUCATION CIVIQUE", "coeff": 100 }');
  lines.push('    NB: "levelId" accepte un identifiant précis (ex: "fond_3af") OU un cycle entier (ex: "fondamental", "secondaire", "maternelle").');
  lines.push('    IMPORTANT: utilise TOUJOURS "levelId" — jamais "cycle", "level" ou "niveauId".');
  lines.push('  • deleteSubjectFromLevel — Supprimer une matière d\'un niveau (exécuté côté navigateur — action locale)');
  lines.push('    Payload: { "levelId": "fond_3af", "subjectLabel": "MUSIQUE" }  (ou "subjectId": "custom_xxx")');
  lines.push('    IMPORTANT: utilise TOUJOURS "levelId" — jamais "cycle", "level" ou "niveauId".');
  lines.push('  • updateStudent — Modifier fiche élève');
  lines.push('    Payload: { "id": "ID_ÉLÈVE", "name": "...", "grade": "...", ... }');
  lines.push('  • addNewStudent — Créer un nouvel élève');
  lines.push('    Payload: { "name": "...", "grade": "NS1", ... }');
  lines.push('  • saveManualExamGrade — Saisir ou mettre à jour la note d\'un élève pour une matière');
  lines.push('    Payload: { "studentCode": "CODE_ELEVE", "examTitle": "NOM_MATIERE", "grade": 85, "periodId": "T1", "historyId": "" }');
  lines.push('    IMPORTANT: utilise saveManualExamGrade (et NON saveConfig) pour toute saisie de note individuelle.');
  lines.push('  • updateGradeSubjects — Mettre à jour matières d\'une classe');
  lines.push('    Payload: { "level": "NS1", "subjects": [...] }');
  lines.push('  • updateExamSettings — Paramètres examen');
  lines.push('    Payload: { "examId": "...", ...settings }');
  lines.push('  • saveTimetableData — Emploi du temps');
  lines.push('    Payload: { "level": "NS1", "timetable": [...] }');
  lines.push('');
  lines.push('Règles du protocole :');
  lines.push('  1. Le bloc [AI_ACTION] s\'ajoute APRÈS ta réponse en prose — explique d\'abord ce que tu vas faire, puis le bloc.');
  lines.push('  2. Si "confirm": true (défaut), l\'utilisateur voit un bouton "Appliquer" avant exécution.');
  lines.push('  3. Génère toujours un payload valide et complet — le frontend exécute exactement ce que tu écris.');
  lines.push('  4. N\'invente pas de clés Settings non documentées — utilise les noms exacts du schéma.');
  lines.push('  5. Si tu ne connais pas l\'ID exact d\'un élève ou d\'une clé, demande avant d\'émettre le bloc.');
  lines.push('  6. Pour saveConfig, les clés de curriculum sont SCHOOL_CURRICULUM (JSON stringifié) ou les chunks CURRICULUM_*.');
  lines.push('  7. Pour les réglages financiers, utilise prioritairement saveConfig avec les clés exactes existantes (ex: CURRENCY, ACADEMIC_YEAR, TUITION_MODE, TUITION_AMOUNT_GLOBAL, TUITION_FREQUENCY, FIN_PAYMENT_PLANS).');
  lines.push('  8. N\'écris jamais "allez dans Paramètres" quand une action est faisable: exécute-la via [AI_ACTION].');
  lines.push('  REGLE NOTES: Pour saisir une note (individuelle ou en masse), utilise TOUJOURS saveManualExamGrade.');
  lines.push('    payload: { "studentCode": "CODE", "examTitle": "NOM_MATIERE", "grade": 85, "periodId": "T1" }');
  lines.push('    - Si l\'utilisateur demande une note pour CHAQUE matière d\'une classe, émets UN bloc [AI_ACTION] saveManualExamGrade PAR MATIÈRE (plusieurs blocs autorisés).');
  lines.push('    - NE JAMAIS utiliser updateGradeSubjects pour saisir des notes — updateGradeSubjects modifie le curriculum dans Settings, PAS les notes.');
  lines.push('    - NE JAMAIS utiliser saveConfig pour des notes — saveConfig écrit dans Settings, pas dans grades.');
  lines.push('    - "contrôle continu" → periodId = "T1" (ou T2/T3 selon le trimestre demandé).');
  lines.push('  9. Cas horaires par cycle (entrée/sortie): si l\'utilisateur demande de configurer les heures par cycle, émet TOUJOURS un bloc [AI_ACTION] saveConfig avec les 6 clés SCHEDULE_MATERNELLE_ENTRY, SCHEDULE_FONDAMENTAL_ENTRY, SCHEDULE_SECONDAIRE_ENTRY, SCHEDULE_MATERNELLE_EXIT, SCHEDULE_FONDAMENTAL_EXIT, SCHEDULE_SECONDAIRE_EXIT. Si une valeur est inconnue, mets "" (vide) pour permettre la saisie dans le formulaire avant application.');

  if (isGod) {
    lines.push('');
    lines.push('MODE ADMINISTRATEUR TOTAL : accès complet à toutes les données. Réponds directement et complètement.');
  } else if (isAdmin) {
    lines.push('');
    lines.push('UTILISATEUR ADMINISTRATEUR : consulte toutes les données du contexte fourni.');
    lines.push('Format de réponse pour les administrateurs (sauf demande contraire) :');
    lines.push('  1. Situation actuelle — ce qui est déjà en place');
    lines.push('  2. Recommandation MeigensTech — quelle décision prendre');
    lines.push('  3. Action immédiate — ce que l\'utilisateur doit faire maintenant');
    lines.push('  4. Suivi proposé — prochaine étape ou contrôle');
  }

  // ── CACHE SPLIT ────────────────────────────────────────────────────
  // Everything ABOVE this sentinel is stable per school/role and is sent in
  // the CACHED Anthropic system block. Everything BELOW changes per call and
  // is sent in a separate, NON-cached block.
  lines.push('');
  lines.push('<<<CACHE_SPLIT>>>');

  // ── ÉTAT DU SYSTÈME (volatile) ────────────────────────────────────
  lines.push('=== ÉTAT DU SYSTÈME ===');
  lines.push('Avancement configuration : ' + configStatus.summary + '.');

  if (configStatus.configuredLines.length) {
    lines.push('Paramètres confirmés : ' + configStatus.configuredLines.slice(0, 8).join(' | ') + '.');
  }

  if (configStatus.missingRequired.length) {
    lines.push('');
    lines.push('⚠ Paramètres requis non encore définis :');
    configStatus.missingRequired.slice(0, 6).forEach(function(item) {
      lines.push('  • ' + item.label + ' (' + item.section + ')');
    });
  }

  if (configStatus.nextHint) {
    lines.push('');
    lines.push('Prochaine configuration à compléter : ' + configStatus.nextHint);
  }

  // ── COEFFICIENT-BASED GRADING NOTICE ───────────────────────────────
  if (conf && conf.curriculumUsesCoefficients) {
    lines.push('');
    lines.push('IMPORTANT — Notation par coefficient :');
    lines.push('  • Cet établissement utilise un système de notation pondéré par coefficient (chaque matière a son propre coefficient).');
    lines.push('  • NE DEMANDE JAMAIS une note maximale globale (/20, /100), un barème universel ou une note de passage unique.');
    lines.push('  • Si l\'utilisateur évoque le barème ou la note de passage, confirme simplement que le système coefficient est déjà en place et passe au paramètre suivant.');
  }

  // ── CONFIGURATION MODE ───────────────────────────────────────────────
  if (conf.configurationMode) {
    lines.push('');
    lines.push('=== MODE CONFIGURATION INTERACTIVE ===');
    lines.push('Règle générale : pose une seule question à la fois SAUF si l\'utilisateur fournit plusieurs réponses groupées dans un message.');
    lines.push('  1. Commence par l\'état actuel (ce qui est déjà enregistré).');
    lines.push('  2. Indique ce qui est configuré et ce qui reste à faire.');
    lines.push('  3. Si l\'utilisateur répond à plusieurs points à la fois, traite-les tous, résume ta compréhension, et demande une confirmation globale.');
    lines.push('  4. Sinon, pose UNE SEULE question claire pour avancer.');
    lines.push('  5. Valide chaque réponse avant de passer à la suivante.');
    lines.push('  6. Ne redemande jamais une information déjà collectée.');

    if (Array.isArray(conf.configurationMissingKeys) && conf.configurationMissingKeys.length) {
      // Map keys to labels using schema
      var missingLabels = conf.configurationMissingKeys.slice(0, 6).map(function(k) {
        var found = MEIGENS_CONFIG_SCHEMA_BACKEND_.find(function(s) {
          return s.keys.indexOf(k) !== -1;
        });
        return found ? found.label : null;
      }).filter(Boolean);
      if (missingLabels.length) {
        lines.push('Points prioritaires à compléter : ' + missingLabels.join(', ') + '.');
      }
    }

    if (conf.configurationMemory && Object.keys(conf.configurationMemory).length) {
      lines.push('');
      lines.push('Réponses déjà enregistrées (ne pas redemander) :');
      Object.keys(conf.configurationMemory).slice(0, 10).forEach(function(k) {
        var found = MEIGENS_CONFIG_SCHEMA_BACKEND_.find(function(s) { return s.keys.indexOf(k) !== -1; });
        var label = found ? found.label : k;
        lines.push('  • ' + label + ' : ' + String(conf.configurationMemory[k] || '').slice(0, 60));
      });
    }
  }

  // ── CURRICULUM GUIDANCE (replaces "master spreadsheet" language) ──────
  if (conf.curriculumQuery) {
    lines.push('');
    lines.push('=== ASSISTANCE CURRICULUM ===');
    lines.push('Pour la configuration et l\'affichage des matières et du programme :');
    lines.push('  1. TOUJOURS retourner les matières dans un bloc [CURRICULUM_DISPLAY]...[/CURRICULUM_DISPLAY] avec JSON structuré :');
    lines.push('     { "title": "Secondaire – NS1", "subjects": [{ "label": "FRANÇAIS", "coeff": 300, "branches": [{"label": "Grammaire","max":150},{"label":"Littérature","max":150}] }, ...] }');
    lines.push('  2. BRANCHES — mode bibliothèque (défaut) : reproduis fidèlement les branches du registre sans en ajouter ni modifier. MODE PROPOSITION : si l\'utilisateur demande explicitement une proposition de branchements, tu peux suggérer des branches pertinentes en précisant qu\'il s\'agit d\'une suggestion Meigens, pas du programme enregistré.');
    lines.push('  3. Ne jamais présenter les matières dans un tableau markdown plat — utilise exclusivement le bloc [CURRICULUM_DISPLAY].');
    lines.push('  4. Si des matières de référence sont disponibles : présente-les comme "notre bibliothèque de référence Meigens" et propose-les pour les niveaux manquants.');
    lines.push('  5. Demande toujours validation avant d\'appliquer une modification.');
    lines.push('  6. Pour Maternelle : utilise le mode Observation (En progression / Acquis / À consolider) — pas de coefficients.');
    lines.push('  7. Pour Fondamental et Secondaire : affiche les coefficients s\'ils sont disponibles dans les données (format: 300 = coeff 3).');

    if (conf.masterAssistanceContext && conf.masterAssistanceContext.data) {
      var mCtx = conf.masterAssistanceContext.data;
      lines.push('');
      lines.push('Matières de référence disponibles (bibliothèque Meigens) :');
      if (Array.isArray(mCtx.missingLevels) && mCtx.missingLevels.length) {
        lines.push('Niveaux à configurer :');
        mCtx.missingLevels.forEach(function(lvl) {
          var libData = mCtx.library && mCtx.library[lvl] ? mCtx.library[lvl] : [];
          if (Array.isArray(libData) && libData.length) {
            var subjectList = libData.slice(0, 5).map(function(s) {
              return s.label + (s.coeff ? ' (coeff ' + s.coeff + ')' : '');
            }).join(' | ');
            lines.push('  • ' + lvl + ' — ' + libData.length + ' matière(s) recommandée(s) : ' + subjectList + (libData.length > 5 ? '…' : ''));
          }
        });
      }
      if (Array.isArray(mCtx.recommendations) && mCtx.recommendations.length) {
        // Sanitize recommendations to remove "master spreadsheet" references
        var cleanRecs = mCtx.recommendations.slice(0, 4).map(function(r) {
          return String(r || '')
            .replace(/master\s*spreadsheet/gi, 'notre bibliothèque de référence')
            .replace(/feuille\s+\w+/gi, 'la configuration')
            .replace(/onglet\s+\w+/gi, 'la section')
            .replace(/table\s+[A-Z]\w+/gi, 'les données');
        });
        lines.push('Recommandations :');
        cleanRecs.forEach(function(r) { lines.push('  • ' + r); });
      }
    }

    if (Array.isArray(conf.curriculumSummary) && conf.curriculumSummary.length) {
      lines.push('Programme actuellement enregistré :');
      conf.curriculumSummary.slice(0, 8).forEach(function(l) { lines.push('  • ' + l); });
    }
  }

  // ── CONTEXT DATA ─────────────────────────────────────────────────────
  if (typeof conf.curriculumTotalSubjects === 'number') {
    lines.push('Matières déployées : ' + conf.curriculumTotalSubjects + '.');
    if (Array.isArray(conf.curriculumByLevel) && conf.curriculumByLevel.length) {
      var byLvl = conf.curriculumByLevel.slice(0, 10).map(function(item) {
        return item.level + ' : ' + item.count;
      }).join(' | ');
      if (byLvl) lines.push('Répartition : ' + byLvl + '.');
    }
  }

  // ── CURRICULUM REGISTRY SNAPSHOT (structured with branches) ─────────
  // When the client sends the full curriculumRegistrySnapshot, inject it so
  // the AI can produce proper [CURRICULUM_DISPLAY] blocks with branches.
  if (conf.curriculumRegistrySnapshot && typeof conf.curriculumRegistrySnapshot === 'object') {
    var snap = conf.curriculumRegistrySnapshot;
    var cycles = Object.keys(snap);
    if (cycles.length) {
      lines.push('');
      lines.push('=== REGISTRE CURRICULUM STRUCTURÉ ===');
      lines.push('Les données suivantes contiennent les matières ET leurs branchements. Utilise-les pour construire le bloc [CURRICULUM_DISPLAY].');
      cycles.forEach(function(cycle) {
        var subjects = Array.isArray(snap[cycle]) ? snap[cycle] : [];
        if (!subjects.length) return;
        lines.push('Cycle ' + cycle + ' (' + subjects.length + ' matières) :');
        subjects.slice(0, 40).forEach(function(subj) {
          var coeffStr = subj.coeff ? ' coeff=' + subj.coeff : '';
          var branchStr = '';
          if (Array.isArray(subj.branches) && subj.branches.length) {
            branchStr = ' [branches: ' + subj.branches.map(function(b){ return b.label + (b.max ? '/' + b.max : ''); }).join(', ') + ']';
          }
          lines.push('  • ' + subj.label + coeffStr + branchStr);
        });
      });
      lines.push('');
      lines.push('Format de sortie obligatoire pour tout affichage de curriculum :');
      lines.push('[CURRICULUM_DISPLAY]');
      lines.push('{ "title": "Nom du niveau", "subjects": [{ "label": "MATIÈRE", "coeff": 300, "branches": [{"label": "Sous-matière", "max": 150}] }] }');
      lines.push('[/CURRICULUM_DISPLAY]');
    }
  }

  if (conf.academicYear) lines.push('Année scolaire : ' + String(conf.academicYear).trim() + '.');
  if (conf.currency)     lines.push('Devise : ' + String(conf.currency).trim() + '.');

  if (conf.counters && typeof conf.counters === 'object') {
    var c = conf.counters;
    lines.push('Effectifs : ' + (c.students || 0) + ' élève(s), ' + (c.classes || 0) + ' classe(s), ' + (c.payments || 0) + ' paiement(s).');
  }

  // ── FINANCE CONFIGURATION SNAPSHOT ──────────────────────────────────────
  // Injected whenever the message concerns finance — reads from rawCfg (full settings)
  // so nothing is lost through the schema-label filter.
  var _financeMsg = String((payload && payload.message) || '').toLowerCase();
  if (/finance|paiement|payment|frais|tuition|devise|currency|factur|scolarit|remise|bourse|penalite|versement|echeance/.test(_financeMsg)) {
    var _finLines = _buildAiFinanceSummary_(rawCfg);
    if (_finLines.length) {
      lines.push('');
      lines.push('=== CONFIGURATION FINANCIÈRE ACTUELLE ===');
      _finLines.forEach(function(l) { lines.push(l); });
      lines.push('');
      lines.push('Utilise ces données pour répondre directement — ne dis pas que l\'information est indisponible.');
      lines.push('Si une modification est demandée, prépare un bloc [AI_ACTION] avec saveConfig et les clés exactes ci-dessus.');
    }
  }

  // ── STUDENT DIRECTORY (admins only) ──────────────────────────────────
  var resolved = Array.isArray(conf.resolvedQuery) ? conf.resolvedQuery : [];
  if (resolved.length) {
    var resLines = resolved.slice(0, 6).map(function(s) {
      var bits = ['• ' + s.id + ' — ' + (s.name || '')];
      if (s.grade)      bits.push('classe ' + s.grade);
      if (s.status)     bits.push('statut ' + s.status);
      if (s.gender)     bits.push('genre ' + s.gender);
      if (s.birthdate)  bits.push('né(e) ' + s.birthdate);
      if (s.parentName) bits.push('parent ' + s.parentName);
      if (s.parentPhone) bits.push('tél ' + s.parentPhone);
      if (Number(s.avg))        bits.push('moy. ' + s.avg);
      if (Number(s.attendance)) bits.push('présence ' + s.attendance + '%');
      if (Number(s.balance))    bits.push('solde dû ' + s.balance);
      return bits.join(' · ');
    });
    lines.push('Données élèves correspondant à la question :\n' + resLines.join('\n'));
  }

  if (isAdmin && Array.isArray(conf.students) && conf.students.length && !resolved.length) {
    var maxRows = isGod ? 120 : 60;
    var dirRows = conf.students.slice(0, maxRows).map(function(s) {
      return s.id + '|' + (s.name || '') + '|' + (s.grade || '');
    });
    var truncNote = (conf.studentDirectoryTruncated || conf.students.length > maxRows)
      ? ' (liste partielle)' : '';
    lines.push('Annuaire élèves [ID|Nom|Classe]' + truncNote + ':\n' + dirRows.join('\n'));
  }

  if (conf.settingsAvailable && conf.settingsData && typeof conf.settingsData === 'object') {
    var skKeys = Object.keys(conf.settingsData);
    if (skKeys.length) {
      lines.push('Paramètres accessibles (snapshot global complet, valeurs compactées) :');
      try {
        lines.push(JSON.stringify(conf.settingsData));
      } catch (_settingsJsonErr) {
        // Fallback line format only if JSON serialization fails.
        var settingsHumanLines = skKeys.slice(0, 220).map(function(k) {
          var found = MEIGENS_CONFIG_SCHEMA_BACKEND_.find(function(s) { return s.keys.indexOf(k) !== -1; });
          var label = found ? found.label : _humanizeAiSettingKey_(k);
          return label + ' = ' + String(conf.settingsData[k] || '');
        }).filter(Boolean);
        if (settingsHumanLines.length) {
          lines.push('Paramètres accessibles :\n' + settingsHumanLines.join('\n'));
        }
      }
    }
  }

  if (Array.isArray(conf.bulletinDivisorSummary) && conf.bulletinDivisorSummary.length) {
    lines.push('Règles bulletin :\n' + conf.bulletinDivisorSummary.map(function(l) { return '  ' + l; }).join('\n'));
  }

  // ── INSTANTANÉ COMPLET DU SYSTÈME (élèves, notes, présences, paiements) ──
  // Toujours disponible — l'IA peut répondre à n'importe quelle question sur les données réelles.
  var snap = conf.systemSnapshot;
  if (snap && typeof snap === 'object') {
    // Config école
    if (snap.config && snap.config.schoolName) {
      var cfgLines = [];
      if (snap.config.academicYear) cfgLines.push('Année scolaire : ' + snap.config.academicYear);
      if (snap.config.currency)     cfgLines.push('Devise : ' + snap.config.currency);
      if (snap.config.tuitionAmount > 0) cfgLines.push('Frais scolarité globaux : ' + snap.config.tuitionAmount + ' ' + snap.config.currency);
      if (snap.config.maxScore > 0) cfgLines.push('Note max : ' + snap.config.maxScore);
      if (cfgLines.length) lines.push('Configuration école : ' + cfgLines.join(' | ') + '.');
    }

    // Annuaire élèves enrichi (si pas déjà fourni côté client)
    if (Array.isArray(snap.students) && snap.students.length) {
      var snapStudents = snap.students;
      var isDataReq = /bulletin|note|grade|score|pr[eé]sence|attendance|paiement|payment|[eé]l[eè]ve|student|liste|rapport/i.test(String(conf._message || ''));
      var studentCap = isGod ? 200 : (isAdmin ? 100 : 40);

      // Build rich directory: ID|Nom|Niveau|Présence%|Payé%|Statut
      var snapDirRows = snapStudents.slice(0, studentCap).map(function(s) {
        var parts = [s.id, s.name || '—', s.level || '—'];
        if (s.attendance > 0 || s.attendance === 0) parts.push('prés.' + s.attendance + '%');
        if (s.paid)                                  parts.push('payé ' + s.paid);
        if (s.status === 'inactif')                  parts.push('INACTIF');
        return parts.join('|');
      });
      var snapTrunc = snapStudents.length > studentCap ? ' (liste partielle – ' + snapStudents.length + ' total)' : '';
      // Only emit if not already covered by conf.students (client-side directory)
      if (!Array.isArray(conf.students) || !conf.students.length) {
        lines.push('');
        lines.push('=== ANNUAIRE ÉLÈVES [ID|Nom|Niveau|Présence|Paiement]' + snapTrunc + ' ===');
        lines.push(snapDirRows.join('\n'));
      }

      // Notes par élève
      if (snap.grades && typeof snap.grades === 'object' && Object.keys(snap.grades).length) {
        lines.push('');
        lines.push('=== NOTES PAR ÉLÈVE ===');
        snapStudents.slice(0, studentCap).forEach(function(s) {
          var sid = String(s.id || '').toUpperCase();
          var gs = snap.grades[sid];
          if (!Array.isArray(gs) || !gs.length) return;
          var gradeLines = gs.slice(0, 15).map(function(g) {
            var base = (g.exam || 'Examen') + ' · ' + (g.subject || 'Matière');
            if (g.scores && typeof g.scores === 'object') {
              var branchParts = Object.keys(g.scores).slice(0, 6).map(function(k) {
                return k + ':' + g.scores[k];
              }).join(', ');
              return base + ' → ' + branchParts;
            }
            if (g.score !== undefined) return base + ' → ' + g.score + (g.max ? '/' + g.max : '');
            if (g.total !== undefined) return base + ' → total:' + g.total;
            if (g.avg   !== undefined) return base + ' → moy:' + g.avg;
            return base;
          });
          lines.push(s.id + ' (' + (s.name || '') + ') :');
          gradeLines.forEach(function(l) { lines.push('  • ' + l); });
        });
      }

      // Présences détaillées
      if (snap.attendance && typeof snap.attendance === 'object' && Object.keys(snap.attendance).length) {
        lines.push('');
        lines.push('=== PRÉSENCES PAR ÉLÈVE (présent/absent/retard) ===');
        snapStudents.slice(0, studentCap).forEach(function(s) {
          var sid = String(s.id || '').toUpperCase();
          var a = snap.attendance[sid];
          if (!a) return;
          var pct = (a.present + a.absent + a.late) > 0
            ? Math.round(a.present / (a.present + a.absent + a.late) * 100)
            : (Number(snap.attendancePct && snap.attendancePct[sid]) || 0);
          lines.push(s.id + ' (' + (s.name || '') + ') : P=' + a.present + ' A=' + a.absent + ' R=' + a.late + ' → ' + pct + '%');
        });
      }

      // Paiements
      if (snap.payments && typeof snap.payments === 'object' && Object.keys(snap.payments).length) {
        lines.push('');
        lines.push('=== PAIEMENTS PAR ÉLÈVE ===');
        snapStudents.slice(0, studentCap).forEach(function(s) {
          var sid = String(s.id || '').toUpperCase();
          var p = snap.payments[sid];
          if (!p) { lines.push(s.id + ' (' + (s.name || '') + ') : Aucun paiement enregistré'); return; }
          var currency = (snap.config && snap.config.currency) || 'HTG';
          lines.push(s.id + ' (' + (s.name || '') + ') : Total payé=' + p.total + ' ' + currency + ' (' + p.count + ' transaction(s))');
          if (Array.isArray(p.transactions) && p.transactions.length) {
            p.transactions.slice(0, 4).forEach(function(t) {
              lines.push('  • ' + (t.date || 'N/A') + ' · ' + t.amount + ' ' + currency + (t.type ? ' · ' + t.type : '') + (t.status ? ' · ' + t.status : ''));
            });
          }
        });
      }
    }
  }

  if (includeHomework && typeof _getHomeworkContextForAi_ === 'function') {
    var hw = _getHomeworkContextForAi_(6);
    if (hw) lines.push('Devoirs récents :\n' + hw);
  }

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────
   PATCH: Replace "master spreadsheet" language in recommendations builder
   Find _buildMasterAssistanceRecommendations_ (or wherever the text is built)
   and apply this sanitizer to all recommendation strings:
   ────────────────────────────────────────────────────────────────────────── */
function _sanitizeMeigensOutput_(text) {
  if (!text) return text;
  var out = String(text);

  // Replace all technical references with business language
  out = out.replace(/\bmaster\s*spreadsheet\b/gi, 'bibliothèque de référence Meigens');
  out = out.replace(/\bAI_(?:LIB|CONFIG|CHAT)_[A-Z0-9_]+\b/gi, 'la configuration du système');
  out = out.replace(/\b(?:feuille|sheet|table|onglet)\s+[A-Z][A-Z0-9_]{2,}\b/gi, 'la configuration');
  out = out.replace(/\bsource(?:s)?\s*:\s*[^\n]+/gi, 'source : paramètres de l\'établissement');
  out = out.replace(/\bfeuilles?\b/gi, 'configuration');
  out = out.replace(/\bonglets?\b/gi, 'section');

  return out.trim();
}

function _stripLeakedSystemPromptArtifacts_(text) {
  var out = String(text || '');
  if (!out) return out;

  // Remove accidental prompt leakage blocks that should never be user-visible.
  out = out.replace(/SYSTEM RULES - SCHOOL CONTEXT \+ PERMISSION BOUNDARIES[\s\S]*?USER MESSAGE:\s*[^\n]*(?:\n|$)/gi, '');
  out = out.replace(/SYSTEM RULES - SCHOOL CONTEXT \+ PERMISSION BOUNDARIES[\s\S]*$/gi, '');
  out = out.replace(/WRITE PROTOCOL:[\s\S]*?Always include\s+"confirm":\s*true[^\n]*(?:\n|$)/gi, '');

  // Collapse repeated identical lines often produced by leaked duplicated prompts.
  var lines = out.split(/\r?\n/);
  var cleaned = [];
  var prevNorm = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var norm = String(line || '').trim().toLowerCase();
    if (norm && norm === prevNorm) continue;
    cleaned.push(line);
    prevNorm = norm || null;
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function _normalizeVisibleChatMessage_(role, text) {
  var raw = String(text || '');
  var r = String(role || '').trim().toLowerCase();
  if (!raw) return '';

  // If the prompt wrapper leaked into the user turn, keep only the actual user message.
  if (r === 'user') {
    var userTail = raw.match(/USER MESSAGE:\s*([\s\S]*)$/i);
    if (userTail && String(userTail[1] || '').trim()) {
      return String(userTail[1] || '').trim();
    }
    var cleanedUser = _stripLeakedSystemPromptArtifacts_(raw);
    return String(cleanedUser || raw).trim();
  }

  // Assistant output should never expose system prompt internals.
  var cleaned = _stripLeakedSystemPromptArtifacts_(raw);
  return String(cleaned || raw).trim();
}


function _sanitizeAiUserFacingReply_(text) {
  var out = _stripLeakedSystemPromptArtifacts_(text);
  if (!out) return out;

  // Hide explicit internal AI sheet/table names.
  out = out.replace(/\bAI_(?:LIB|CONFIG|CHAT)_[A-Z0-9_]+\b/gi, 'la configuration du système');

  // Hide generic technical references to sheets/tables with internal names.
  out = out.replace(/\b(?:feuille|sheet|table|onglet)\s+[A-Z][A-Z0-9_]{2,}\b/gi, 'la configuration du système');

  // Keep wording user-facing.
  out = out.replace(/\bsource(?:s)?\s*:\s*[^\n]+/gi, 'source: configuration du système');
  out = out.replace(/\bfeuilles?\b/gi, 'configuration');
  return out.trim();
}

function _getSettingsCurriculumState_(messageText) {
  function flattenCurriculumMap_(curr) {
    var out = {};
    var src = (curr && typeof curr === 'object') ? curr : {};
    Object.keys(src).forEach(function(key) {
      var node = src[key];
      if (Array.isArray(node)) {
        out[key] = (out[key] || []).concat(node);
        return;
      }
      if (node && typeof node === 'object') {
        Object.keys(node).forEach(function(subKey) {
          var subNode = node[subKey];
          if (Array.isArray(subNode)) {
            out[subKey] = (out[subKey] || []).concat(subNode);
          }
        });
      }
    });
    return out;
  }

  var curriculum = {};
  try {
    var confRes = getSaaSSettings_(null);
    var conf = confRes && confRes.success && confRes.data && typeof confRes.data === 'object' ? confRes.data : {};
    var schoolCurriculum = conf.SCHOOL_CURRICULUM;
    if (schoolCurriculum && typeof schoolCurriculum === 'object') {
      curriculum = schoolCurriculum;
    } else if (typeof schoolCurriculum === 'string' && schoolCurriculum.trim()) {
      try { curriculum = JSON.parse(schoolCurriculum); } catch (_e1) { curriculum = {}; }
    }
  } catch (_e2) {
    curriculum = {};
  }

  if (!curriculum || typeof curriculum !== 'object' || !Object.keys(curriculum).length) {
    try { curriculum = _readFullCurriculum(getSS_()) || {}; } catch (_e3) { curriculum = {}; }
  }

  curriculum = flattenCurriculumMap_(curriculum);

  var requested = _extractCurriculumLevelsFromMessage_(messageText || '');
  var keys = Object.keys(curriculum || {});
  var matchingKeys = keys.filter(function(levelKey) {
    if (!requested.length) return true;
    var norm = _normalizeAiPromptToken_(levelKey);
    if (/maternelle|mat\b/.test(norm)) return requested.indexOf('maternelle') !== -1;
    if (/fondamental|primaire|fond_|prim_/.test(norm)) return requested.indexOf('fondamental') !== -1;
    if (/secondaire|sec_|ns[1-4]/.test(norm)) return requested.indexOf('secondaire') !== -1;
    return requested.some(function(r) { return norm.indexOf(r) !== -1; });
  });
  if (!matchingKeys.length) matchingKeys = keys;

  var totalSubjects = 0;
  var byLevel = [];
  matchingKeys.forEach(function(levelKey) {
    var arr = Array.isArray(curriculum[levelKey]) ? curriculum[levelKey] : [];
    var count = arr.filter(function(item) {
      if (item && typeof item === 'object') return !!String(item.label || item.subjectId || item.id || '').trim();
      return !!String(item || '').trim();
    }).length;
    if (!count) return;
    totalSubjects += count;
    byLevel.push({ level: _formatAiDivisorTargetLabel_(levelKey), count: count });
  });

  // Detect coefficient-based grading: at least one subject carries a coefficient
  var usesCoefficients = false;
  try {
    Object.keys(curriculum || {}).some(function(levelKey) {
      var arr = Array.isArray(curriculum[levelKey]) ? curriculum[levelKey] : [];
      return arr.some(function(item) {
        if (!item || typeof item !== 'object') return false;
        var c = Number(item.coefficient || item.coeff || item.coef || item.weight || 0);
        if (Number.isFinite(c) && c > 0) { usesCoefficients = true; return true; }
        return false;
      });
    });
  } catch (_e4) {}

  return {
    totalSubjects: totalSubjects,
    byLevel: byLevel,
    hasSubjects: totalSubjects > 0,
    levelsCount: byLevel.length,
    usesCoefficients: usesCoefficients
  };
}

function _buildSettingsConfigurationStatus_(viewer) {
  function readFirst_(cfg, aliases) {
    var src = (cfg && typeof cfg === 'object') ? cfg : {};
    var list = Array.isArray(aliases) ? aliases : [];
    for (var i = 0; i < list.length; i++) {
      var key = String(list[i] || '').trim();
      if (!key) continue;
      var val = src[key];
      if (val === undefined || val === null) continue;
      var txt = String(val).trim();
      if (txt) return val;
    }
    return '';
  }

  function parseLevels_(value) {
    var raw = value;
    if (typeof raw === 'string' && raw.trim()) {
      try { raw = JSON.parse(raw); } catch (_e) {}
    }
    if (Array.isArray(raw)) {
      return raw.map(function(item) {
        if (item && typeof item === 'object') return String(item.label || item.id || '').trim();
        return String(item || '').trim();
      }).filter(Boolean);
    }
    if (raw && typeof raw === 'object') {
      return Object.keys(raw).map(function(k) { return String(k || '').trim(); }).filter(Boolean);
    }
    var txt = String(value || '').trim();
    if (!txt) return [];
    return txt.split(/[;,|]+/).map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  }

  var empty = {
    lines: ['Aucune configuration système exploitable n\'a été trouvée pour le moment.'],
    missingKeys: ['ACADEMIC_YEAR', 'LEVELS', 'GRADING_FORMAT', 'CURRENCY']
  };
  try {
    var confRes = getSaaSSettings_(viewer && viewer.email ? viewer.email : null);
    var conf = confRes && confRes.success && confRes.data && typeof confRes.data === 'object' ? confRes.data : null;
    if (!conf) return empty;

    var academicYear = readFirst_(conf, ['ACADEMIC_YEAR', 'CURRENT_ACADEMIC_YEAR', 'currentAcademicYear', 'academicYear', 'SCHOOL_YEAR']);
    var levelsRaw = readFirst_(conf, ['LEVELS', 'ACTIVE_LEVELS', 'levels', 'activeLevels']);
    // Also detect levels from curriculumByLevel (populated by _buildServerAiContext_)
    // when LEVELS/ACTIVE_LEVELS keys aren't in the flat Settings sheet.
    var curriculumState = _getSettingsCurriculumState_('');
    if (!levelsRaw && curriculumState.byLevel && curriculumState.byLevel.length > 0) {
      levelsRaw = curriculumState.byLevel.map(function(b) { return b.level; });
    }
    var levelsList = parseLevels_(levelsRaw);
    var gradingFormat = readFirst_(conf, ['GRADING_FORMAT', 'gradingType', 'grading_format', 'GRADING_SCALE', 'maxScore', 'MAX_SCORE', 'GRADE_MAX']);
    var currency = readFirst_(conf, ['CURRENCY', 'currency']);
    var lines = [
      'Année scolaire: ' + String(academicYear || 'non configurée'),
      'Niveaux: ' + (levelsList.length ? levelsList.join(', ') : 'non configurés'),
      'Format des notes: ' + String(gradingFormat || 'non configuré'),
      'Devise: ' + String(currency || 'non configurée'),
      'Matières déjà déployées: ' + String(curriculumState.totalSubjects || 0)
    ];

    var missing = [];
    if (!String(academicYear || '').trim()) missing.push('ACADEMIC_YEAR');
    if (!levelsList.length) missing.push('LEVELS');
    if (!String(gradingFormat || '').trim()) missing.push('GRADING_FORMAT');
    if (!String(currency || '').trim()) missing.push('CURRENCY');
    if (!curriculumState.totalSubjects) missing.push('CURRICULUM_*');

    return { lines: lines, missingKeys: missing };
  } catch (_err) {
    return empty;
  }
}

function _containsClientAiSecret_(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const secretKeys = ['apiKey', 'aiApiKey', 'AI_API_KEY', 'AI_API_KEY_FALLBACK', 'xApiKey', 'x_api_key'];
  for (var i = 0; i < secretKeys.length; i++) {
    var key = secretKeys[i];
    var raw = p[key];
    if (raw === undefined || raw === null) continue;
    if (String(raw).trim()) return true;
  }
  return false;
}

function _getClientAiSecretFromPayload_(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const secretKeys = ['apiKey', 'aiApiKey', 'AI_API_KEY', 'AI_API_KEY_FALLBACK', 'xApiKey', 'x_api_key'];
  for (var i = 0; i < secretKeys.length; i++) {
    var key = secretKeys[i];
    var raw = p[key];
    if (raw === undefined || raw === null) continue;
    var value = String(raw).trim();
    if (value) return value;
  }
  return '';
}

function _getSettingsSheetValue_(keyCandidates) {
  try {
    const ss = getSS_();
    const sh = ss && ss.getSheetByName('Settings');
    if (!sh || sh.getLastRow() < 2) return '';

    const normalizedWanted = {};
    (keyCandidates || []).forEach(function(key) {
      var normalized = String(key || '').trim().toUpperCase();
      if (normalized) normalizedWanted[normalized] = true;
    });
    if (!Object.keys(normalizedWanted).length) return '';

    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var rowKey = String(rows[i][0] || '').trim().toUpperCase();
      if (!rowKey || !normalizedWanted[rowKey]) continue;
      var value = String(rows[i][1] || '').trim();
      if (value) return value;
    }
  } catch (_err) {}
  return '';
}

function _getServerAiSettingByAliases_(aliases, defaultValue) {
  var fromSettings = _getSettingsSheetValue_(aliases);
  if (String(fromSettings || '').trim()) return String(fromSettings).trim();

  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < (aliases || []).length; i++) {
    var alias = String(aliases[i] || '').trim();
    if (!alias) continue;
    var fromProps = String(props.getProperty(alias) || '').trim();
    if (fromProps) return fromProps;
  }

  return defaultValue === undefined ? '' : String(defaultValue || '').trim();
}

function _getServerAiSecretByAliases_(aliases) {
  var fromAuthSheet = _getAuthSpreadsheetApiKeyByAliases_(aliases);
  if (String(fromAuthSheet || '').trim() && _isSecretCompatibleWithAliases_(fromAuthSheet, aliases)) {
    return String(fromAuthSheet).trim();
  }

  var genericFromAuthSheet = _getAuthSpreadsheetFallbackAiKey_();
  if (String(genericFromAuthSheet || '').trim() && _isSecretCompatibleWithAliases_(genericFromAuthSheet, aliases)) {
    return String(genericFromAuthSheet).trim();
  }

  var fromSettings = _getServerAiSettingByAliases_(aliases, '');
  if (String(fromSettings || '').trim() && _isSecretCompatibleWithAliases_(fromSettings, aliases)) {
    return String(fromSettings).trim();
  }
  return '';
}

function _isGoogleApiKey_(value) {
  var v = String(value || '').trim();
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(v);
}

function _isAnthropicApiKey_(value) {
  var v = String(value || '').trim();
  return /^sk-ant-/i.test(v) || /^sk-[a-z0-9_-]{12,}$/i.test(v);
}

function _isSecretCompatibleWithAliases_(value, aliases) {
  var v = String(value || '').trim();
  if (!v) return false;

  var wantsGoogle = false;
  var wantsAnthropic = false;
  var hasExplicitProviderAlias = false;

  for (var i = 0; i < (aliases || []).length; i++) {
    var alias = String((aliases || [])[i] || '').toUpperCase();
    if (!alias) continue;
    if (alias.indexOf('GEMINI') !== -1 || alias.indexOf('GOOGLE') !== -1) {
      wantsGoogle = true;
      hasExplicitProviderAlias = true;
    }
    if (alias.indexOf('ANTHROPIC') !== -1 || alias.indexOf('CLAUDE') !== -1) {
      wantsAnthropic = true;
      hasExplicitProviderAlias = true;
    }
  }

  if (wantsGoogle && !wantsAnthropic) return _isGoogleApiKey_(v);
  if (wantsAnthropic && !wantsGoogle) return _isAnthropicApiKey_(v);
  if (!hasExplicitProviderAlias) return _looksLikeAiSecret_(v);
  return _looksLikeAiSecret_(v);
}

function _looksLikeAiSecret_(value) {
  var v = String(value || '').trim();
  if (!v) return false;
  if (/^sk-[a-z0-9_-]{12,}$/i.test(v)) return true;
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(v)) return true;
  if (/^ya29\./.test(v)) return true;
  return false;
}

function _getAuthSpreadsheetApiKeyByAliases_(aliases) {
  try {
    const wanted = {};
    (aliases || []).forEach(function(alias) {
      var normalized = String(alias || '').trim().toUpperCase();
      if (normalized) wanted[normalized] = true;
    });
    if (!Object.keys(wanted).length) return '';

    const cache = CacheService.getScriptCache();
    const cacheKey = 'AUTH_SPREADSHEET_AI_KEY_BY_ALIAS_V2_' + Object.keys(wanted).sort().join('|');
    const cached = cache.get(cacheKey);
    if (cached) return String(cached || '').trim();

    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const sh = master && master.getSheetByName('API-Key');
    if (!sh || sh.getLastRow() < 1) return '';

    // Supported formats:
    // 1) A=KEY_NAME,   B=SECRET
    // 2) A=API-Key,    B=SECRET, C=AI_KEY_NAME
    const width = Math.max(2, Math.min(3, sh.getLastColumn()));
    const rows = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    var genericCandidate = '';
    for (var i = 0; i < rows.length; i++) {
      var keyNameA = String(rows[i][0] || '').trim();
      var keyNameC = width >= 3 ? String(rows[i][2] || '').trim() : '';
      var keyValue = width >= 2 ? String(rows[i][1] || '').trim() : '';
      if (!keyNameA && !keyNameC) continue;

      var normalizedKeyNameA = keyNameA.toUpperCase();
      var normalizedKeyNameC = keyNameC.toUpperCase();
      var hasAliasMatch = !!wanted[normalizedKeyNameA] || !!wanted[normalizedKeyNameC];
      var genericApiKeyLabel = /^api[\s_-]*key$/i.test(keyNameA) || /^ai[\s_-]*api[\s_-]*key$/i.test(keyNameA);
      if (!hasAliasMatch && !genericApiKeyLabel) continue;

      // Supports both formats above and legacy secret-in-A fallback.
      var resolved = keyValue || keyNameA;
      if (!resolved) continue;
      if (/^api[\s_-]*key$/i.test(resolved) || /^ai[\s_-]*api[\s_-]*key$/i.test(resolved)) continue;

      // Prefer values that look like actual AI secrets to avoid returning labels.
      if (!_looksLikeAiSecret_(resolved) && !hasAliasMatch) continue;

      // Provider-specific aliases must win over generic API-Key rows.
      if (hasAliasMatch) {
        cache.put(cacheKey, resolved, 300);
        return resolved;
      }

      if (!genericCandidate && genericApiKeyLabel && _looksLikeAiSecret_(resolved)) {
        genericCandidate = resolved;
      }
    }

    if (genericCandidate) {
      cache.put(cacheKey, genericCandidate, 300);
      return genericCandidate;
    }
  } catch (_err) {}
  return '';
}

function _normalizeAnthropicModel_(modelValue) {
  var model = String(modelValue || '').trim();
  if (!model) return SERVER_AI_DEFAULT_MODEL_;
  // Force-upgrade slow/legacy models to the fast default to keep latency low.
  if (model === 'claude-3-5-sonnet-20241022') return SERVER_AI_DEFAULT_MODEL_;
  if (model === 'claude-sonnet-4-5') return SERVER_AI_DEFAULT_MODEL_;
  return model;
}

function _detectUserLanguage_(messageText) {
  var txt = String(messageText || '').toLowerCase();
  var frenchPatterns = /bonjour|salut|coucou|merci|s'il vous plaît|sil vous plait|comment|pourquoi|quoi|où|quel|donne|explique|aide|configure|d[ée]ploie|v[ée]rif|modif|change|mise|jour|oui|non|ouvre|ferme|ajoute|supprime|créer|créé|français|français|garçon|fille|élève|classe|matière|sujet|école|établissement|année|scolaire/;
  var englishPatterns = /hello|hi|please|thank|help|what|why|how|where|which|give|explain|configure|deploy|verify|update|yes|no|open|close|add|remove|create|created|english|boy|girl|student|class|subject|school|year|academic/;
  var spanishPatterns = /hola|por favor|gracias|ayuda|qué|por qué|dónde|cuál|explica|configura|desplega|sí|no|abre|cierra|añade|elimina|crear|español|niño|niña|alumno|clase|asignatura|escuela|año/;
  
  var frenchScore = (txt.match(frenchPatterns) || []).length;
  var englishScore = (txt.match(englishPatterns) || []).length;
  var spanishScore = (txt.match(spanishPatterns) || []).length;
  
  if (frenchScore > Math.max(englishScore, spanishScore)) return 'fr';
  if (englishScore > Math.max(frenchScore, spanishScore)) return 'en';
  if (spanishScore > Math.max(frenchScore, englishScore)) return 'es';
  
  // Default to French for Haitian context
  return 'fr';
}

function _getLanguageInstruction_(langCode) {
  var lang = String(langCode || 'fr').toLowerCase();
  if (lang === 'en') {
    return 'Respond in English. Keep responses concise and professional.';
  } else if (lang === 'es') {
    return 'Responde en español. Mantén las respuestas concisas y profesionales.';
  }
  // Default to French
  return 'Réponds en français. Garde les réponses concises et professionnelles.';
}

function _isAnthropicModelNotFound_(statusCode, rawBody) {
  var body = String(rawBody || '').toLowerCase();
  return Number(statusCode || 0) === 404 || body.indexOf('not_found_error') !== -1;
}

function _getAuthSpreadsheetFallbackAiKey_() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'AUTH_SPREADSHEET_AI_KEY_FALLBACK';
    const cached = cache.get(cacheKey);
    if (cached) return String(cached || '').trim();

    const master = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const sh = master && master.getSheetByName('API-Key');
    if (!sh || sh.getLastRow() < 1) return '';

    const width = Math.max(2, Math.min(3, sh.getLastColumn()));
    const rows = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    for (var i = 0; i < rows.length; i++) {
      const colA = String(rows[i][0] || '').trim();
      const colB = width >= 2 ? String(rows[i][1] || '').trim() : '';
      const colC = width >= 3 ? String(rows[i][2] || '').trim() : '';
      if (!colA && !colB && !colC) continue;

      // Common format: KEY in column A, secret in column B.
      if (colB && (/^api[\s_-]*key$/i.test(colA) || /^ai[\s_-]*api[\s_-]*key$/i.test(colA))) {
        if (_looksLikeAiSecret_(colB)) {
          cache.put(cacheKey, colB, 300);
          return colB;
        }
      }

      // New format: A=API-Key, B=secret, C=AI key name
      if (colB && colC && (/api/i.test(colA) || /ai/i.test(colA))) {
        if (_looksLikeAiSecret_(colB)) {
          cache.put(cacheKey, colB, 300);
          return colB;
        }
      }

      // Legacy formats: raw secret in A or B.
      if (_looksLikeAiSecret_(colA)) {
        cache.put(cacheKey, colA, 300);
        return colA;
      }
      if (_looksLikeAiSecret_(colB)) {
        cache.put(cacheKey, colB, 300);
        return colB;
      }

      // Last-resort legacy behavior: single non-header value in column A.
      if (!colB && colA && !/^api[\s_-]*key$/i.test(colA) && !/^ai[\s_-]*api[\s_-]*key$/i.test(colA)) {
        cache.put(cacheKey, colA, 300);
        return colA;
      }
    }
  } catch (_err) {}
  return '';
}

function _resolveAllAvailableAiModels_() {
  // Fetch all available AI models with their configurations
  // Returns: { anthropic: [...], openai: [], google: [...] }
  
  try {
    var models = {
      anthropic: [],
      openai: [], // kept for backward compatibility, intentionally unused
      google: [],
      available: []
    };

    // ANTHROPIC MODELS — primary provider
    // Model names must match the actual quota pool (haiku-4-5, sonnet-4-5).
    // claude-3-5-haiku-20241022 / claude-3-5-sonnet-20241022 are different quota pools
    // and will 404 when the key is provisioned for the 4-5 generation.
    const anthropicKey = _getServerAiSecretByAliases_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) ||
      _getServerAiSettingByAliases_(['SYSTEM_ANTHROPIC_API_KEY', 'SYSTEM_CLAUDE_API_KEY'], '') ||
      _getAuthSpreadsheetFallbackAiKey_();

    if (anthropicKey) {
      models.anthropic.push({
        provider: 'anthropic',
        apiKey: anthropicKey,
        models: [
          { name: 'claude-haiku-4-5-20251001', cost: 1, speed: 9, reasoning: 3, default: true },
          { name: 'claude-sonnet-4-5',         cost: 4, speed: 7, reasoning: 7, default: false }
        ]
      });
      models.available.push('anthropic');
    }

    // OPENAI intentionally disabled for this deployment (Gemini + Claude only).

    // GOOGLE GEMINI MODELS
    const geminiKey = _getServerAiSecretByAliases_(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) ||
      _getServerAiSettingByAliases_(['SYSTEM_GEMINI_API_KEY', 'SYSTEM_GOOGLE_API_KEY'], '');

    if (geminiKey) {
      models.google.push({
        provider: 'google',
        apiKey: geminiKey,
        models: [
          { name: 'gemini-2.0-flash-lite', cost: 0.2, speed: 10, reasoning: 4, default: true },
          { name: 'gemini-2.0-flash', cost: 0.5, speed: 9, reasoning: 5, default: false },
          { name: 'gemini-1.5-pro', cost: 3, speed: 7, reasoning: 8, default: false }
        ]
      });
      models.available.push('google');
    }

    return models;
  } catch (e) {
    return { anthropic: [], openai: [], google: [], available: [] };
  }
}

function _detectTaskRigor_(userMessage, context) {
  // Detect task complexity/rigor: 0 (simple) to 10 (complex)
  try {
    var msg = String(userMessage || '').toLowerCase();
    var rigor = 3; // default: medium

    // Simple tasks (FAQ, help, basic questions)
    if (/aide|help|bloqué|stuck|c'est quoi|what is|comment faire|how to|menu|liste|list/i.test(msg)) {
      rigor = 2;
    }

    // Configuration tasks (moderate)
    if (/configure|setup|define|défini/i.test(msg)) {
      rigor = 4;
    }

    // Analysis, reasoning, complex logic
    if (/analyse|analyze|reason|compare|why|pourquoi|impact|consequence|strategy|stratégie/i.test(msg)) {
      rigor = 7;
    }

    // Deep reasoning, optimization, prediction
    if (/optimis|prédic|forecast|predict|complex|compliqué|difficult|difficile|edge case/i.test(msg)) {
      rigor = 9;
    }

    // Vision/OCR tasks
    if (/photo|image|upload|extract|ocr|curriculum|notebook/i.test(msg)) {
      rigor = 6; // needs vision capability
    }

    return rigor;
  } catch (e) {
    return 3;
  }
}

function _selectModelForTask_(rigor, availableModels) {
  // Select the best model based on task rigor
  // rigor: 0-10 (0=simple, 10=complex)
  // Policy:
  // - Light tasks: Gemini free tier (flash-lite)
  // - Medium tasks: Claude Haiku
  // - Robust tasks: Claude Sonnet
  // Returns: { provider, apiKey, model, cost, speed, reasoning }

  try {
    if (!availableModels || !availableModels.available || availableModels.available.length === 0) {
      return null; // No models configured
    }

    var selection = null;

    // LOW RIGOR (0-3): Gemini free tier first (flash-lite)
    if (rigor <= 3) {
      // Default: Gemini Flash-Lite (free tier)
      if (availableModels.available.indexOf('google') !== -1) {
        var geminiConfig = availableModels.google[0];
        var flashLite = geminiConfig.models.find(function(m) { return /flash-lite/i.test(m.name); });
        if (flashLite) {
          selection = Object.assign({}, flashLite, { provider: geminiConfig.provider, apiKey: geminiConfig.apiKey });
        }
        if (!selection) {
          var flash = geminiConfig.models.find(function(m) { return /flash/i.test(m.name); });
          if (flash) {
            selection = Object.assign({}, flash, { provider: geminiConfig.provider, apiKey: geminiConfig.apiKey });
          }
        }
      }
      // Fallback: Claude Haiku
      if (!selection && availableModels.available.indexOf('anthropic') !== -1) {
        var anthropicConfig = availableModels.anthropic[0];
        var haiku = anthropicConfig.models.find(function(m) { return /haiku/i.test(m.name); });
        if (haiku) {
          selection = Object.assign({}, haiku, { provider: anthropicConfig.provider, apiKey: anthropicConfig.apiKey });
        }
      }
    }
    // MEDIUM RIGOR (4-6): Claude Haiku by default
    else if (rigor <= 6) {
      // Default: Claude Haiku
      if (availableModels.available.indexOf('anthropic') !== -1) {
        var anthropicConfig = availableModels.anthropic[0];
        var haiku = anthropicConfig.models.find(function(m) { return /haiku/i.test(m.name); });
        if (haiku) {
          selection = Object.assign({}, haiku, { provider: anthropicConfig.provider, apiKey: anthropicConfig.apiKey });
        }
      }
      // Fallback: Gemini Flash
      if (!selection && availableModels.available.indexOf('google') !== -1) {
        var geminiConfig = availableModels.google[0];
        var flash = geminiConfig.models.find(function(m) { return /flash/i.test(m.name); });
        if (flash) {
          selection = Object.assign({}, flash, { provider: geminiConfig.provider, apiKey: geminiConfig.apiKey });
        }
      }
      // Last fallback: Claude Sonnet
      if (!selection && availableModels.available.indexOf('anthropic') !== -1) {
        var anthropicConfig2 = availableModels.anthropic[0];
        var sonnet = anthropicConfig2.models.find(function(m) { return /sonnet/i.test(m.name); });
        if (sonnet) {
          selection = Object.assign({}, sonnet, { provider: anthropicConfig2.provider, apiKey: anthropicConfig2.apiKey });
        }
      }
    }
    // HIGH RIGOR (7+): Claude Sonnet by default (robust)
    else {
      // Default: Claude Sonnet
      if (availableModels.available.indexOf('anthropic') !== -1) {
        var anthropicConfig = availableModels.anthropic[0];
        var sonnet = anthropicConfig.models.find(function(m) { return /sonnet/i.test(m.name); });
        if (sonnet) {
          selection = Object.assign({}, sonnet, { provider: anthropicConfig.provider, apiKey: anthropicConfig.apiKey });
        }
      }
      // Fallback: Claude Haiku
      if (!selection && availableModels.available.indexOf('anthropic') !== -1) {
        var anthropicConfig3 = availableModels.anthropic[0];
        var haiku = anthropicConfig3.models.find(function(m) { return /haiku/i.test(m.name); });
        if (haiku) {
          selection = Object.assign({}, haiku, { provider: anthropicConfig3.provider, apiKey: anthropicConfig3.apiKey });
        }
      }
      // Last fallback: Gemini Pro/Flash if Claude unavailable
      if (!selection && availableModels.available.indexOf('google') !== -1) {
        var geminiConfig2 = availableModels.google[0];
        var pro = geminiConfig2.models.find(function(m) { return /pro/i.test(m.name); });
        if (!pro) pro = geminiConfig2.models.find(function(m) { return /flash/i.test(m.name); });
        if (pro) {
          selection = Object.assign({}, pro, { provider: geminiConfig2.provider, apiKey: geminiConfig2.apiKey });
        }
      }
    }

    // If nothing selected yet, use first available default model
    if (!selection) {
      for (var provider in availableModels) {
        if (provider !== 'available' && availableModels[provider].length > 0) {
          var config = availableModels[provider][0];
          var defaultModel = config.models.find(function(m) { return m.default; });
          if (!defaultModel) defaultModel = config.models[0];
          selection = Object.assign({}, defaultModel, { provider: config.provider, apiKey: config.apiKey });
          break;
        }
      }
    }

    return selection || null;
  } catch (e) {
    return null;
  }
}

function _resolveServerAiConfig_() {
  const explicitProviderRaw = _getServerAiSettingByAliases_(['AI_PROVIDER'], '').toLowerCase();
  const explicitProvider = explicitProviderRaw === 'claude'
    ? 'anthropic'
    : (explicitProviderRaw === 'gemini' ? 'google' : explicitProviderRaw);
  const anthropicKey = _getServerAiSecretByAliases_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  const geminiKey = _getServerAiSecretByAliases_(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  const genericAiKey = _getServerAiSecretByAliases_(['AI_API_KEY']);
  const systemAnthropicKey = _getServerAiSettingByAliases_(['SYSTEM_ANTHROPIC_API_KEY', 'SYSTEM_CLAUDE_API_KEY'], '');
  const systemGeminiKey = _getServerAiSettingByAliases_(['SYSTEM_GEMINI_API_KEY', 'SYSTEM_GOOGLE_API_KEY'], '');
  const systemGenericAiKey = _getServerAiSettingByAliases_(['SYSTEM_AI_API_KEY'], '');
  const authSheetFallbackKey = _getAuthSpreadsheetFallbackAiKey_();

  const resolvedAnthropicKey = anthropicKey
    || ((explicitProvider === 'anthropic' || explicitProvider === 'claude' || !explicitProvider) ? genericAiKey : '')
    || systemAnthropicKey
    || ((explicitProvider === 'anthropic' || explicitProvider === 'claude' || !explicitProvider) ? systemGenericAiKey : '')
    || ((explicitProvider === 'anthropic' || explicitProvider === 'claude' || !explicitProvider) ? authSheetFallbackKey : '');
  const resolvedGeminiKey = geminiKey
    || ((explicitProvider === 'google' || explicitProvider === 'gemini') ? genericAiKey : '')
    || systemGeminiKey
    || ((explicitProvider === 'google' || explicitProvider === 'gemini') ? systemGenericAiKey : '');

  var provider = explicitProvider;
  if (!provider) {
    // Anthropic is primary — Gemini is fallback only (used when Claude 429s).
    // Previously Gemini was preferred here, causing silent failures when the
    // Gemini key was invalid or the response came back empty.
    if (resolvedAnthropicKey) provider = 'anthropic';
    else if (resolvedGeminiKey) provider = 'google';
    else provider = SERVER_AI_DEFAULT_PROVIDER_;
  }

  if (provider === 'anthropic' && resolvedAnthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: resolvedAnthropicKey,
      model: _normalizeAnthropicModel_(_getServerAiSettingByAliases_(['AI_MODEL'], SERVER_AI_DEFAULT_MODEL_)),
      apiUrl: _getServerAiSettingByAliases_(['AI_API_URL'], SERVER_AI_DEFAULT_API_URL_)
    };
  }

  if (provider === 'google' && resolvedGeminiKey) {
    return {
      provider: 'google',
      apiKey: resolvedGeminiKey,
      model: _getServerAiSettingByAliases_(['AI_MODEL'], SERVER_AI_GEMINI_DEFAULT_MODEL_),
      apiUrl: _getServerAiSettingByAliases_(['AI_API_URL'], '')
    };
  }

  if (resolvedGeminiKey) return { provider:'google', apiKey:resolvedGeminiKey, model:SERVER_AI_GEMINI_DEFAULT_MODEL_, apiUrl:'' };
  if (resolvedAnthropicKey) return { provider:'anthropic', apiKey:resolvedAnthropicKey, model:SERVER_AI_DEFAULT_MODEL_, apiUrl:SERVER_AI_DEFAULT_API_URL_ };
  return null;
}

function _normalizeAiPromptToken_(value) {
  var raw = String(value || '').toLowerCase();
  if (!raw) return '';
  try {
    raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_err) {}
  return raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function _viewerHasAnyPermission_(viewer, permissionList) {
  if (!viewer) return false;
  if (viewer.isMaster || viewer.isGodMode) return true;
  var perms = viewer.permissions || {};
  return (permissionList || []).some(function(key) { return !!perms[key]; });
}

function _viewerCanAccessAiSection_(viewer, sectionKey) {
  if (!viewer) return false;
  if (viewer.isMaster || viewer.isGodMode) return true;
  switch (String(sectionKey || '').toLowerCase()) {
    case 'settings':
      return _viewerHasAnyPermission_(viewer, ['p_settings', 'pa_save_settings']);
    case 'students':
      return _viewerHasAnyPermission_(viewer, ['p_dossier', 'pa_add_student', 'pa_edit_student', 'p_name', 'p_pic', 'p_history']);
    case 'finance':
      return _viewerHasAnyPermission_(viewer, ['p_finance', 'pa_record_payment', 'p_approve_payments']);
    case 'attendance':
      return _viewerHasAnyPermission_(viewer, ['p_attendance', 'p_hr_attendance', 'pt_mark_attendance', 'pt_view_attendance']);
    case 'grades':
      return _viewerHasAnyPermission_(viewer, ['p_grades', 'p_manual', 'p_review', 'p_build', 'pt_enter_grades', 'pt_edit_grades', 'pt_view_bulletin']);
    case 'staff':
      return _viewerHasAnyPermission_(viewer, ['p_staff', 'pa_add_staff', 'pa_manage_users', 'pa_teacher_affectation']);
    case 'audit':
      return _viewerHasAnyPermission_(viewer, ['p_audit']);
    case 'communication':
      return _viewerHasAnyPermission_(viewer, ['pa_send_broadcast', 'pt_send_message', 'p_staff']);
    case 'ids':
      return _viewerHasAnyPermission_(viewer, ['p_dossier', 'pa_add_student', 'pa_edit_student', 'p_settings']);
    default:
      return _viewerHasAnyPermission_(viewer, ['p_settings', 'pa_save_settings', 'p_dossier', 'p_staff', 'p_finance', 'p_grades', 'p_attendance', 'p_audit']);
  }
}

function _classifySheetForAi_(sheetName) {
  var name = _normalizeAiPromptToken_(sheetName);
  if (!name) return 'general';
  if (/\bsettings\b|configuration|parametr/.test(name)) return 'settings';
  if (/\busers\b|admin users|teacher assignments|timetable|staff|teacher/.test(name)) return 'staff';
  if (/school ids|\bids\b/.test(name)) return 'ids';
  if (/student|students|history|enrollment|inscription|dossier/.test(name)) return 'students';
  if (/payment|finance|fee|tuition|cash|recouvr/.test(name)) return 'finance';
  if (/attendance|presence|kiosk/.test(name)) return 'attendance';
  if (/grade|bulletin|exam|homework|curriculum|note/.test(name)) return 'grades';
  if (/audit|log/.test(name)) return 'audit';
  if (/message|broadcast|sms|notification/.test(name)) return 'communication';
  return 'general';
}

function _extractAiPromptTokens_(message) {
  var normalized = _normalizeAiPromptToken_(message);
  if (!normalized) return [];
  var tokens = normalized.split(' ').filter(function(token) { return token && token.length >= 3; });
  var seen = {};
  return tokens.filter(function(token) {
    if (seen[token]) return false;
    seen[token] = true;
    return true;
  });
}

function _mapAiSheetRow_(headers, row) {
  var out = {};
  var nonEmpty = 0;
  for (var i = 0; i < headers.length && i < row.length; i++) {
    var key = String(headers[i] || '').trim() || ('COL_' + (i + 1));
    var value = row[i];
    if (value === '' || value === null || value === undefined) continue;
    out[key] = String(value);
    nonEmpty++;
    if (nonEmpty >= 12) break;
  }
  return out;
}

function _buildAiSheetPreview_(sheet, promptTokens, options) {
  var opts = options || {};
  if (!sheet) return null;
  var lastRow = Number(sheet.getLastRow() || 0);
  var lastCol = Number(sheet.getLastColumn() || 0);
  if (lastCol <= 0) {
    return {
      name: sheet.getName(),
      section: _classifySheetForAi_(sheet.getName()),
      rowCount: 0,
      columnCount: 0,
      headers: [],
      matchedRows: [],
      sampleRows: []
    };
  }

  var headerRow = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] || [];
  var headers = headerRow.map(function(value) { return String(value || '').trim(); });
  var dataRowCount = Math.max(0, lastRow - 1);
  var scanLimit = Math.max(0, Math.min(dataRowCount, Number(opts.scanRows || 160)));
  var matchedRows = [];
  var sampleRows = [];
  if (scanLimit > 0) {
    var rows = sheet.getRange(2, 1, scanLimit, lastCol).getDisplayValues();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      var hasValue = row.some(function(cell) { return String(cell || '').trim() !== ''; });
      if (!hasValue) continue;
      if (sampleRows.length < Number(opts.sampleRows || 4)) {
        sampleRows.push(_mapAiSheetRow_(headers, row));
      }
      if (!promptTokens || !promptTokens.length || matchedRows.length >= Number(opts.matchRows || 6)) continue;
      var haystack = _normalizeAiPromptToken_(row.join(' '));
      if (promptTokens.some(function(token) { return token && haystack.indexOf(token) !== -1; })) {
        matchedRows.push(_mapAiSheetRow_(headers, row));
      }
    }
  }

  return {
    name: sheet.getName(),
    section: _classifySheetForAi_(sheet.getName()),
    rowCount: dataRowCount,
    columnCount: lastCol,
    headers: headers.slice(0, 20),
    matchedRows: matchedRows,
    sampleRows: sampleRows
  };
}

/**
 * Build a structured finance configuration summary from raw settings.
 * Returns an array of human-readable lines ready to inject into the system prompt.
 */
function _buildAiFinanceSummary_(rawCfg) {
  var cfg = (rawCfg && typeof rawCfg === 'object') ? rawCfg : {};
  var currency = String(cfg.currency || cfg.CURRENCY || 'HTG');
  var lines = [];

  lines.push('Devise : ' + currency);

  var tuitionMode = String(cfg.TUITION_MODE || '');
  if (tuitionMode) lines.push('Mode de facturation : ' + tuitionMode);

  var tuitionFreq = String(cfg.TUITION_FREQUENCY || '');
  if (tuitionFreq) lines.push('Fréquence de paiement : ' + tuitionFreq);

  var globalAmt = String(cfg.TUITION_AMOUNT_GLOBAL || cfg.TUITION_AMOUNT || '');
  if (globalAmt) lines.push('Montant global : ' + globalAmt + ' ' + currency);

  // Payment methods
  function boolVal(v) { return v === true || String(v || '').toUpperCase() === 'TRUE'; }
  var methods = [];
  if (boolVal(cfg.PAY_METHOD_CASH))     methods.push('Espèces');
  if (boolVal(cfg.PAY_METHOD_MONCASH))  methods.push('MonCash');
  if (boolVal(cfg.PAY_METHOD_CHECK))    methods.push('Chèque');
  if (boolVal(cfg.PAY_METHOD_TRANSFER)) methods.push('Virement');
  if (methods.length) {
    lines.push('Méthodes de paiement activées : ' + methods.join(', '));
  } else {
    lines.push('Méthodes de paiement : aucune activée (PAY_METHOD_CASH / MONCASH / CHECK / TRANSFER sont toutes FALSE)');
  }

  var gracePeriod = Number(cfg.FIN_GRACE_PERIOD || 0);
  if (gracePeriod > 0) lines.push('Délai de grâce : ' + gracePeriod + ' jour(s)');

  var penaltyType = String(cfg.FIN_PENALTY_TYPE || '');
  if (penaltyType) lines.push('Type de pénalité : ' + penaltyType);

  var penaltyRec = String(cfg.FIN_PENALTY_RECURRENCE || '');
  if (penaltyRec) lines.push('Récurrence pénalité : ' + penaltyRec);

  var allowPartial = String(cfg.PAY_ALLOW_PARTIAL || '');
  if (allowPartial) lines.push('Paiement partiel : ' + (boolVal(cfg.PAY_ALLOW_PARTIAL) ? 'Autorisé' : 'Non autorisé'));

  var overpay = String(cfg.PAY_OVERPAYMENT_ACTION || '');
  if (overpay) lines.push('Action surpaiement : ' + overpay);

  var payrollFreq = String(cfg.PAYROLL_FREQUENCY || '');
  if (payrollFreq) lines.push('Fréquence paie personnel : ' + payrollFreq);

  // Fee structure by level
  var feeStructRaw = cfg.feeStructureByLevel;
  if (feeStructRaw && feeStructRaw !== '{}') {
    var feeStruct = null;
    try { feeStruct = typeof feeStructRaw === 'object' ? feeStructRaw : JSON.parse(String(feeStructRaw)); } catch (_) {}
    if (feeStruct && typeof feeStruct === 'object' && Object.keys(feeStruct).length) {
      lines.push('Frais par niveau :');
      Object.keys(feeStruct).slice(0, 12).forEach(function(lk) {
        lines.push('  • ' + lk + ' : ' + JSON.stringify(feeStruct[lk]));
      });
    } else {
      lines.push('Frais par niveau (feeStructureByLevel) : non configuré');
    }
  } else {
    lines.push('Frais par niveau (feeStructureByLevel) : non configuré');
  }

  // Payment plans
  var finPlansRaw = cfg.FIN_PAYMENT_PLANS;
  if (finPlansRaw) {
    var finPlans = null;
    try { finPlans = typeof finPlansRaw === 'object' ? finPlansRaw : JSON.parse(String(finPlansRaw)); } catch (_) {}
    if (finPlans && typeof finPlans === 'object' && Object.keys(finPlans).length) {
      lines.push('Plans de paiement (FIN_PAYMENT_PLANS) :');
      Object.keys(finPlans).forEach(function(planKey) {
        var plan = finPlans[planKey];
        if (!plan || typeof plan !== 'object') return;
        var total = String(plan.instTotal || (plan.monthly && plan.monthly.amount) || '?');
        var mode = String(plan.mode || 'N/A');
        var label = planKey
          .replace(/^cycle_/,  'Cycle ')
          .replace(/^class_/,  'Classe ')
          .replace(/^global$/, 'Global');
        var instDesc = '';
        if (Array.isArray(plan.installments) && plan.installments.length) {
          instDesc = ' → ' + plan.installments.length + ' versements : ' +
            plan.installments.map(function(inst) {
              return (inst.label || 'V') + ' ' + inst.amount + ' ' + currency +
                (inst.dueDate ? ' (' + inst.dueDate + ')' : '');
            }).join(' | ');
        }
        lines.push('  • ' + label + ' — Total: ' + total + ' ' + currency + ' | Mode: ' + mode + instDesc);
      });
    } else {
      lines.push('Plans de paiement (FIN_PAYMENT_PLANS) : non configuré');
    }
  } else {
    lines.push('Plans de paiement (FIN_PAYMENT_PLANS) : non configuré');
  }

  return lines;
}

function _resolveAiSettingsFocusKeys_(settingsData, normalizedMessage) {
  var src = (settingsData && typeof settingsData === 'object') ? settingsData : {};
  var available = {};
  Object.keys(src).forEach(function(key) {
    available[String(key || '').trim().toUpperCase()] = key;
  });
  var msg = String(normalizedMessage || '').trim();
  var picked = [];

  function addKeys(keys) {
    (keys || []).forEach(function(key) {
      var found = available[String(key || '').trim().toUpperCase()];
      if (found && picked.indexOf(found) === -1) picked.push(found);
    });
  }

  if (!msg) return picked;
  if (/annee|year|promotion|rentree|trimestre|periode/.test(msg)) {
    addKeys(['ACADEMIC_YEAR', 'CURRENT_ACADEMIC_YEAR', 'SCHOOL_YEAR_START', 'SCHOOL_YEAR_END', 'TERM_COUNT', 'PERIODS_PER_YEAR']);
  }
  if (/logo|theme|design|couleur|branding|marque|identite|nom.*ecole|ecole.*nom/.test(msg)) {
    addKeys(['SCHOOL_NAME', 'BUSINESS_NAME', 'SCHOOL_LOGO', 'PRIMARY_COLOR', 'SECONDARY_COLOR', 'ACCENT_COLOR', 'ADDRESS', 'SCHOOL_ADDR']);
  }
  if (/telephone|phone|email|contact|adresse|address|portail|portal|url|site/.test(msg)) {
    addKeys(['SCHOOL_PHONE', 'PHONE', 'TRANSACTION_PHONE', 'SCHOOL_EMAIL', 'EMAIL', 'SCHOOL_ADDR', 'ADDRESS', 'STUDENT_PORTAL_URL', 'STAFF_APP_URL', 'SCRIPT_EXEC_URL']);
  }
  if (/finance|paiement|payment|frais|tuition|devise|currency|factur|scolarit|remise|bourse|penalite|versement|echeance/.test(msg)) {
    addKeys([
      'currency', 'CURRENCY', 'PAYMENT_TYPE', 'SUBSCRIPTION_PLAN', 'TUITION_FREQUENCY', 'PAYMENT_TERMS',
      'TUITION_MODE', 'TUITION_AMOUNT_GLOBAL', 'TUITION_AMOUNT',
      'FIN_PAYMENT_PLANS', 'feeStructureByLevel',
      'PAY_ALLOW_PARTIAL', 'PAY_STRICT_VALIDATION', 'PAY_OVERPAYMENT_ACTION',
      'PAY_METHOD_CASH', 'PAY_METHOD_MONCASH', 'PAY_METHOD_CHECK', 'PAY_METHOD_TRANSFER',
      'FIN_PENALTY_TYPE', 'FIN_PENALTY_RECURRENCE', 'FIN_GRACE_PERIOD',
      'PAYROLL_FREQUENCY', 'PAYROLL_SEE_SLIP', 'PAYROLL_SEE_OWN'
    ]);
  }
  if (/presence|attendance|retard|absence|session|jour/.test(msg)) {
    addKeys(['ATTENDANCE_ENTRY_TIME', 'SESSIONS_PER_DAY', 'DAYS_PER_WEEK', 'ATTENDANCE_THRESHOLD']);
  }
  if (/note|grade|bulletin|divis|coeff|coefficient|moyenne|curriculum|matiere|niveau/.test(msg)) {
    addKeys(['BULLETIN_DIVISOR_RULES_JSON', 'GRADING_SCALE', 'GRADING_FORMAT', 'LEVELS', 'SCHOOL_CURRICULUM']);
  }
  if (/sms|whatsapp|notification|api/.test(msg)) {
    addKeys(['SMS_ENABLED', 'SMS_PROVIDER', 'WHATSAPP_ENABLED', 'API_BASE_URL']);
  }
  return picked;
}

function _buildAiSettingsPreview_(settingsData, promptTokens, options) {
  var src = (settingsData && typeof settingsData === 'object') ? settingsData : {};
  var keys = Object.keys(src);
  if (!keys.length) return {};
  var opts = options || {};
  var includeAll = opts.includeAll !== false;

  function _formatValueForAi_(key, value) {
    var val = value;
    if (val === undefined || val === null) return '';
    var txt = '';
    if (typeof val === 'object') {
      try { txt = JSON.stringify(val); } catch (_objErr) { txt = String(val); }
    } else {
      txt = String(val);
    }

    var k = String(key || '').toUpperCase();
    var cap = 260;
    if (/^FIN_PAYMENT_PLANS$|^BULLETIN_DIVISOR_RULES_JSON$|^ACTIVE_LEVELS$|^FEESTRUCTUREBYLEVEL$/i.test(k)) cap = 5000;
    else if (/^CURRICULUM_/i.test(k) || /^CURRICULUM_CUSTOM$/i.test(k)) cap = 1500;
    else if (/^NO_CLASS_RULES_JSON$|^ATTENDANCE_WATCHLIST$/i.test(k)) cap = 1200;

    if (txt.length > cap) {
      return txt.slice(0, cap) + ' …[tronqué ' + (txt.length - cap) + ' caractères]';
    }
    return txt;
  }

  var focusKeys = _resolveAiSettingsFocusKeys_(src, _normalizeAiPromptToken_(opts.message || ''));
  var matched = [];
  var generic = [];
  keys.forEach(function(key) {
    var normalizedKey = _normalizeAiPromptToken_(key);
    if (focusKeys.indexOf(key) !== -1) {
      matched.push(key);
    } else if (promptTokens && promptTokens.length && promptTokens.some(function(token) { return normalizedKey.indexOf(token) !== -1; })) {
      matched.push(key);
    } else if (generic.length < 40) {
      generic.push(key);
    }
  });
  var selectedKeys = includeAll
    ? keys.slice().sort()
    : matched.slice(0, opts.preferSettings ? 240 : 140);
  if (!selectedKeys.length && !includeAll && focusKeys.length) selectedKeys = focusKeys.slice(0, 180);
  if (!selectedKeys.length && !includeAll) selectedKeys = generic.slice(0, opts.preferSettings ? 180 : 90);
  var preview = {};
  selectedKeys.forEach(function(key) {
    preview[key] = _formatValueForAi_(key, src[key]);
  });
  return preview;
}

function _humanizeAiSettingKey_(key) {
  var raw = String(key || '').trim();
  if (!raw) return 'Paramètre';
  return raw
    .replace(/^SP_/i, 'Portail élève ')
    .replace(/^TP_/i, 'Portail enseignant ')
    .replace(/^PAY_/i, 'Paiement ')
    .replace(/^FIN_/i, 'Finance ')
    .replace(/^CURRICULUM_/i, 'Curriculum ')
    .replace(/^NO_CLASS_/i, 'Jours sans classe ')
    .replace(/^ATTENDANCE_/i, 'Présence ')
    .replace(/^GRADING_/i, 'Notation ')
    .replace(/^BULLETIN_/i, 'Bulletin ')
    .replace(/^NUM_/i, 'Nombre ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
}

function _formatAiDivisorTargetLabel_(target) {
  var raw = String(target || '').trim();
  if (!raw) return '';
  var normalized = _normalizeAiPromptToken_(raw);
  var levelMap = {
    'mat': 'Maternelle',
    'mat_ps': 'PS',
    'mat_ms': 'MS',
    'mat_gs': 'GS',
    'fond_1af': '1AF',
    'fond_2af': '2AF',
    'fond_3af': '3AF',
    'fond_4af': '4AF',
    'fond_5af': '5AF',
    'fond_6af': '6AF',
    'sec_ns1': 'NS1',
    'sec_ns2': 'NS2',
    'sec_ns3': 'NS3',
    'sec_ns4': 'NS4',
    'secondaire': 'Secondaire',
    'fondamental': 'Fondamental',
    'maternelle': 'Maternelle'
  };
  return levelMap[normalized] || raw.toUpperCase().replace(/_/g, ' ');
}

function _parseAiDivisorRules_(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object') return rawValue;
  try {
    return JSON.parse(String(rawValue || '').trim());
  } catch (_err) {
    return null;
  }
}

function _buildAiBulletinDivisorSummary_(settingsData, promptTokens) {
  var src = (settingsData && typeof settingsData === 'object') ? settingsData : {};
  var parsed = _parseAiDivisorRules_(src.BULLETIN_DIVISOR_RULES_JSON);
  if (!parsed || typeof parsed !== 'object') return [];

  var normalizedPrompt = (promptTokens || []).join(' ');
  var wantsDivisor = /divis|bulletin|moyenne|periode|period|ns[1-4]|af|secondaire|fondamental/.test(normalizedPrompt);
  if (!wantsDivisor && promptTokens && promptTokens.length) return [];

  var lines = [];
  var meta = (parsed.metadata && parsed.metadata.cycleYearly && typeof parsed.metadata.cycleYearly === 'object')
    ? parsed.metadata.cycleYearly
    : {};
  Object.keys(meta).forEach(function(key) {
    var node = meta[key] || {};
    var divisor = Number(node.divisor || 0);
    if (!Number.isFinite(divisor) || divisor <= 0) return;
    lines.push('Cycle ' + _formatAiDivisorTargetLabel_(key) + ': annuel=' + divisor + (node.details ? ' | details=' + String(node.details) : ''));
  });

  var levels = (parsed.levels && typeof parsed.levels === 'object') ? parsed.levels : {};
  var selectedLevelKeys = Object.keys(levels).filter(function(levelKey) {
    if (!promptTokens || !promptTokens.length) return false;
    var label = _formatAiDivisorTargetLabel_(levelKey);
    var haystack = _normalizeAiPromptToken_(levelKey + ' ' + label);
    return promptTokens.some(function(token) { return haystack.indexOf(token) !== -1; });
  });
  if (!selectedLevelKeys.length && wantsDivisor) {
    selectedLevelKeys = Object.keys(levels).slice(0, 10);
  }
  selectedLevelKeys.forEach(function(levelKey) {
    var node = levels[levelKey] || {};
    var periods = (node.periods && typeof node.periods === 'object') ? node.periods : {};
    var periodParts = Object.keys(periods)
      .sort(function(a, b) { return Number(a) - Number(b); })
      .map(function(periodKey) {
        return 'P' + periodKey + '=' + String(periods[periodKey]);
      });
    lines.push('Niveau ' + _formatAiDivisorTargetLabel_(levelKey) + ': annuel=' + String(node.annual || '') + (periodParts.length ? ' | ' + periodParts.join(' | ') : ''));
  });

  return lines.slice(0, 20);
}

function _buildAiCurriculumSummary_(promptTokens) {
  try {
    function flattenCurriculumMap_(curr) {
      var out = {};
      var src = (curr && typeof curr === 'object') ? curr : {};
      Object.keys(src).forEach(function(key) {
        var node = src[key];
        if (Array.isArray(node)) {
          out[key] = (out[key] || []).concat(node);
          return;
        }
        if (node && typeof node === 'object') {
          Object.keys(node).forEach(function(subKey) {
            var subNode = node[subKey];
            if (Array.isArray(subNode)) {
              out[subKey] = (out[subKey] || []).concat(subNode);
            }
          });
        }
      });
      return out;
    }

    var curr = {};
    try {
      var confRes = getSaaSSettings_(null);
      var conf = confRes && confRes.success && confRes.data && typeof confRes.data === 'object' ? confRes.data : {};
      if (conf.SCHOOL_CURRICULUM && typeof conf.SCHOOL_CURRICULUM === 'object') {
        curr = conf.SCHOOL_CURRICULUM;
      } else if (typeof conf.SCHOOL_CURRICULUM === 'string' && conf.SCHOOL_CURRICULUM.trim()) {
        try { curr = JSON.parse(conf.SCHOOL_CURRICULUM); } catch (_e1) { curr = {}; }
      }
    } catch (_e2) {
      curr = {};
    }
    if (!curr || typeof curr !== 'object' || !Object.keys(curr).length) {
      curr = _readFullCurriculum(getSS_()) || {};
    }
    curr = flattenCurriculumMap_(curr);
    var keys = Object.keys(curr || {});
    if (!keys.length) {
      return { hasSubjects: false, requestedLevels: [], lines: [] };
    }

    var joined = _normalizeAiPromptToken_((promptTokens || []).join(' '));
    var requested = [];
    var addRequested = function(levelKey) {
      if (requested.indexOf(levelKey) === -1) requested.push(levelKey);
    };

    if (/maternelle|mat\b|prescol|ps\b|ms\b|gs\b/.test(joined)) {
      ['maternelle', 'mat', 'mat_ps', 'mat_ms', 'mat_gs'].forEach(addRequested);
    }
    if (/fondamental|primaire|af\b/.test(joined)) {
      ['fondamental', 'primaire', 'fond_1af', 'fond_2af', 'fond_3af', 'fond_4af', 'fond_5af', 'fond_6af'].forEach(addRequested);
    }
    if (/secondaire|ns1|ns2|ns3|ns4/.test(joined)) {
      ['secondaire', 'sec_ns1', 'sec_ns2', 'sec_ns3', 'sec_ns4'].forEach(addRequested);
    }

    var selectedKeys = requested.filter(function(k) { return !!curr[k]; });
    if (!selectedKeys.length) selectedKeys = keys.slice(0, 8);

    var lines = [];
    selectedKeys.forEach(function(levelKey) {
      var arr = Array.isArray(curr[levelKey]) ? curr[levelKey] : [];
      if (!arr.length) return;
      var labels = arr.map(function(item) {
        if (item && typeof item === 'object') {
          return String(item.label || item.subjectId || item.id || '').trim();
        }
        return String(item || '').trim();
      }).filter(function(x) { return !!x; });
      if (!labels.length) return;
      lines.push(_formatAiDivisorTargetLabel_(levelKey) + ': ' + labels.slice(0, 40).join(', '));
    });

    return {
      hasSubjects: lines.length > 0,
      requestedLevels: selectedKeys,
      lines: lines.slice(0, 20)
    };
  } catch (_err) {
    return { hasSubjects: false, requestedLevels: [], lines: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI FULL SYSTEM SNAPSHOT
// Charge un instantané complet de toutes les données du système pour le contexte IA.
// Inclut : élèves, notes, présences, paiements, configuration.
// Mis en cache 5 minutes par école pour éviter les lectures répétées de Sheets.
// ─────────────────────────────────────────────────────────────────────────────
function _buildAiFullSystemSnapshot_(viewer, auth) {
  try {
    var ss = getSS_();
    var ssId = ss.getId();
    var cacheKey = 'AI_SYS_SNAP_V2_' + ssId;

    // Try cache first (TTL 5 min)
    var cached = _safeCacheGetData_(cacheKey);
    if (cached && typeof cached === 'object' && cached._ts && (Date.now() - cached._ts) < 300000) {
      return cached;
    }

    var snapshot = { _ts: Date.now() };

    // ── 1. STUDENTS ──────────────────────────────────────────────────────────
    try {
      var students = getAllStudents_(auth);
      snapshot.students = students.map(function(s) {
        var _snapName = String(s.Name || s.name || s.FullName || s.fullName || '').trim();
        if (!_snapName) {
          var _fn = String(s.FirstName || s.firstName || '').trim();
          var _ln = String(s.LastName  || s.lastName  || '').trim();
          _snapName = [_fn, _ln].filter(Boolean).join(' ');
        }
        return {
          id:          String(s.StudentCode || s.StudentID || s.id || '').trim(),
          name:        _snapName,
          level:       String(s.CurrentLevel || s.Grade || s.grade || '').trim(),
          section:     String(s.Section || '').trim(),
          year:        String(s.SchoolYear || '').trim(),
          gender:      String(s.Gender || s.gender || '').trim(),
          birthdate:   String(s.BirthDate || s.birthdate || '').trim(),
          attendance:  Number(s.attendance || s.Attendance || 0),
          paid:        String(s.paid || '0%'),
          status:      String(s.Active || '').toLowerCase() === 'true' ? 'actif' : 'inactif',
          parentName:  String(s.ParentName || s.parentName || s.FatherName || s.MotherName || '').trim(),
          parentPhone: String(s.ParentPhone || s.parentPhone || s.Phone || '').trim(),
          historyId:   String(s.ActiveHistoryID || '').trim()
        };
      });
    } catch (_sErr) { snapshot.students = []; }

    // ── 2. GRADES ─────────────────────────────────────────────────────────────
    try {
      var gradesRes = getGrades_({}, auth);
      snapshot.grades = {};
      if (gradesRes && gradesRes.success && Array.isArray(gradesRes.data)) {
        gradesRes.data.forEach(function(g) {
          var sid = String(g.StudentID || g.studentId || g.StudentCode || '').trim().toUpperCase();
          if (!sid) return;
          if (!snapshot.grades[sid]) snapshot.grades[sid] = [];
          var entry = {
            exam:    String(g.ExamTitle || g.examTitle || g.Exam || '').trim(),
            subject: String(g.Subject || g.subject || '').trim()
          };
          if (g.ScoresJSON && typeof g.ScoresJSON === 'object') {
            entry.scores = g.ScoresJSON;
          } else {
            if (g.Score !== undefined || g.score !== undefined) entry.score = Number(g.Score || g.score || 0);
            if (g.MaxScore !== undefined || g.maxScore !== undefined) entry.max = Number(g.MaxScore || g.maxScore || 0);
          }
          if (g.Total !== undefined) entry.total = Number(g.Total || 0);
          if (g.Average !== undefined || g.average !== undefined) entry.avg = Number(g.Average || g.average || 0);
          snapshot.grades[sid].push(entry);
        });
      }
    } catch (_gErr) { snapshot.grades = {}; }

    // ── 3. PAYMENTS ───────────────────────────────────────────────────────────
    try {
      snapshot.payments = {};
      var finSh = ss.getSheetByName('Finance');
      if (finSh && finSh.getLastRow() > 1) {
        var finData = finSh.getDataRange().getValues();
        var finH = finData[0].map(function(x) { return String(x).trim().toUpperCase(); });
        var fiSid    = finH.map(function(h,i){ return ['STUDENTID','STUDENTCODE','STUDENT_ID','STUDENT_CODE'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var fiAmt    = finH.map(function(h,i){ return ['AMOUNT','MONTANT'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var fiStatus = finH.map(function(h,i){ return ['STATUS','STATUT'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var fiDate   = finH.map(function(h,i){ return ['DATE','PAYMENT_DATE','PAYMENTDATE'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var fiType   = finH.map(function(h,i){ return ['TYPE','DESIGNATION'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        if (fiSid !== undefined) {
          finData.slice(1).forEach(function(r) {
            var sid = String(r[fiSid] || '').trim().toUpperCase();
            if (!sid) return;
            if (!snapshot.payments[sid]) snapshot.payments[sid] = { total: 0, count: 0, transactions: [] };
            var amt = parseFloat(r[fiAmt !== undefined ? fiAmt : -1] || 0) || 0;
            snapshot.payments[sid].total += amt;
            snapshot.payments[sid].count++;
            if (snapshot.payments[sid].transactions.length < 6) {
              snapshot.payments[sid].transactions.push({
                date:   fiDate   !== undefined ? String(r[fiDate]   || '').slice(0, 10) : '',
                amount: amt,
                status: fiStatus !== undefined ? String(r[fiStatus] || '').trim() : '',
                type:   fiType   !== undefined ? String(r[fiType]   || '').trim() : ''
              });
            }
          });
        }
      }
    } catch (_pErr) { snapshot.payments = {}; }

    // ── 4. ATTENDANCE ─────────────────────────────────────────────────────────
    try {
      var attPctMap = _buildStudentAttendancePercentMap_(ss);
      snapshot.attendancePct = attPctMap;
      snapshot.attendance = {};
      var attSh = ss.getSheetByName('attendance');
      if (attSh && attSh.getLastRow() > 1) {
        var attData = attSh.getDataRange().getValues();
        var attH = attData[0].map(function(x) { return String(x).trim().toUpperCase(); });
        var aiSid    = attH.map(function(h,i){ return ['STUDENTID','STUDENTCODE','STUDENT_ID','STUDENT_CODE'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var aiStatus = attH.map(function(h,i){ return h === 'STATUS' ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var aiSubj   = attH.map(function(h,i){ return ['SUBJECT','MATIERE','COURSE'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        var aiDate   = attH.map(function(h,i){ return ['DATE','ATTENDANCE_DATE','RECORD_DATE'].indexOf(h) !== -1 ? i : -1; }).filter(function(i){ return i !== -1; })[0];
        if (aiSid !== undefined && aiStatus !== undefined) {
          attData.slice(1).forEach(function(r) {
            var sid = String(r[aiSid] || '').trim().toUpperCase();
            if (!sid) return;
            if (!snapshot.attendance[sid]) snapshot.attendance[sid] = { present: 0, absent: 0, late: 0, records: [] };
            var st = String(r[aiStatus] || '').trim().toUpperCase();
            if (st === 'PRESENT' || st === 'P' || st === 'PRÉSENT') snapshot.attendance[sid].present++;
            else if (st === 'ABSENT' || st === 'A')                  snapshot.attendance[sid].absent++;
            else if (st === 'LATE'   || st === 'EN RETARD' || st === 'L') snapshot.attendance[sid].late++;
            if (snapshot.attendance[sid].records.length < 8) {
              snapshot.attendance[sid].records.push({
                date:    aiDate  !== undefined ? String(r[aiDate]  || '').slice(0, 10) : '',
                status:  st,
                subject: aiSubj !== undefined ? String(r[aiSubj]  || '').trim() : ''
              });
            }
          });
        }
      }
    } catch (_aErr) { snapshot.attendance = {}; snapshot.attendancePct = {}; }

    // ── 5. CONFIGURATION CLÉS ────────────────────────────────────────────────
    try {
      var confRes2 = getSaaSSettings_(auth);
      var cData = confRes2 && confRes2.success && confRes2.data ? confRes2.data : {};
      snapshot.config = {
        schoolName:    String(cData.SCHOOL_NAME || '').trim(),
        academicYear:  String(cData.ACADEMIC_YEAR || cData.CURRENT_ACADEMIC_YEAR || '').trim(),
        currency:      String(cData.CURRENCY || 'HTG').trim(),
        tuitionAmount: Number(cData.TUITION_AMOUNT_GLOBAL || cData.TUITION_AMOUNT || 0),
        tuitionMode:   String(cData.TUITION_MODE || '').trim(),
        maxScore:      Number(cData.MAX_SCORE || cData.GRADE_MAX || 0)
      };
    } catch (_cErr) { snapshot.config = {}; }

    // Persist to cache (up to 100 KB)
    try {
      var ser = JSON.stringify(snapshot);
      if (ser.length < 100000) _safeCachePut(cacheKey, ser, 300);
    } catch (_serErr) {}

    return snapshot;
  } catch (e) {
    return null;
  }
}

function _buildServerAiContext_(viewer, payload, auth) {
  try {
    var message = String((payload && payload.message) || '').trim();
    var isSimpleGreeting = /^(bonjour|bonsoir|salut|hi|hello|hey|merci|ok|oui|non|bien|\u00e7a va|alright|parfait|super|cool|bonne nuit|au revoir|bye|d'accord|dacord|good|yes|no|sure)\s*[!?.,]?$/i.test(message);
    if (isSimpleGreeting) return {};
    var tokens = _extractAiPromptTokens_(message);
    var normalizedMessage = _normalizeAiPromptToken_(message);
    var ss = getSS_();
    var sheets = ss ? ss.getSheets() : [];
    var sheetRegistry = [];
    var selectedSheets = [];
    var selectedNames = {};
    var defaultGodSheets = {
      'settings': true,
      'students': true,
      'payments': true,
      'attendance': true,
      'users': true,
      'grades': true,
      'school ids': true,
      'timetable': true,
      'teacher assignments': true,
      'teacher_assignments': true
    };

    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var name = sheet.getName();
      var section = _classifySheetForAi_(name);
      var normalizedName = _normalizeAiPromptToken_(name);
      var allowed = _viewerCanAccessAiSection_(viewer, section) || section === 'general';
      sheetRegistry.push({
        name: name,
        section: section,
        allowed: !!allowed,
        rowCount: Math.max(0, Number(sheet.getLastRow() || 0) - 1),
        columnCount: Number(sheet.getLastColumn() || 0)
      });
      if (!allowed) continue;

      var sectionMatch = tokens.some(function(token) {
        return normalizedName.indexOf(token) !== -1 || _normalizeAiPromptToken_(section).indexOf(token) !== -1;
      });
      var isDefaultGodSheet = !!defaultGodSheets[normalizedName];
      var shouldSelect = sectionMatch || ((viewer.isMaster || viewer.isGodMode) && (!tokens.length ? isDefaultGodSheet : sectionMatch));
      if (section === 'settings' && _viewerCanAccessAiSection_(viewer, 'settings')) {
        shouldSelect = shouldSelect || /settings|config|parametr|api|theme|logo|annee|year|portail|sms|attendance|finance|grade|bulletin|divis|coefficient|curriculum|matiere|niveau|devise|paiement|presence/.test(normalizedMessage);
      }
      if (shouldSelect && !selectedNames[name] && selectedSheets.length < 8) {
        selectedNames[name] = true;
        selectedSheets.push(sheet);
      }
    }

    var settingsQuery = /settings|config|parametr|api|theme|logo|annee|year|portail|sms|attendance|finance|grade|bulletin|divis|coefficient|curriculum|matiere|niveau|devise|paiement|presence/.test(normalizedMessage);
    if (settingsQuery && _viewerCanAccessAiSection_(viewer, 'settings') && ss) {
      var settingsSheet = ss.getSheetByName('Settings');
      if (settingsSheet && !selectedNames.Settings) {
        selectedNames.Settings = true;
        selectedSheets.unshift(settingsSheet);
        if (selectedSheets.length > 8) selectedSheets = selectedSheets.slice(0, 8);
      }
    }

    var isDataIntent = tokens.length > 0;
    if ((viewer.isMaster || viewer.isGodMode) && !selectedSheets.length && isDataIntent) {
      sheets.some(function(sheet) {
        if (selectedSheets.length >= 6) return true;
        var normalizedName = _normalizeAiPromptToken_(sheet.getName());
        if (defaultGodSheets[normalizedName]) selectedSheets.push(sheet);
        return false;
      });
    }

    var settingsPreview = {};
    var settingsFocusKeys = [];
    var bulletinDivisorSummary = [];
    var curriculumSummary = { hasSubjects: false, requestedLevels: [], lines: [] };
    var curriculumState = { totalSubjects: 0, byLevel: [], hasSubjects: false, levelsCount: 0 };
    var masterAssistanceContext = null;
    var curriculumQuery = /curriculum|mati[eè]re|subject|maternelle|fondamental|secondaire|bulletin|divis|coefficient|academicstructure/i
      .test(normalizedMessage);
    if (_viewerCanAccessAiSection_(viewer, 'settings')) {
      var settingsRes = getSaaSSettings_(auth || null);
      var settingsData = settingsRes && settingsRes.success && settingsRes.data && typeof settingsRes.data === 'object'
        ? settingsRes.data
        : {};
      settingsFocusKeys = _resolveAiSettingsFocusKeys_(settingsData, normalizedMessage);
      settingsPreview = _buildAiSettingsPreview_(settingsData, tokens, {
        message: message,
        preferSettings: settingsQuery,
        includeAll: true
      });
      if (settingsData.BULLETIN_DIVISOR_RULES_JSON !== undefined && settingsPreview.BULLETIN_DIVISOR_RULES_JSON === undefined) {
        settingsPreview.BULLETIN_DIVISOR_RULES_JSON = typeof settingsData.BULLETIN_DIVISOR_RULES_JSON === 'string'
          ? settingsData.BULLETIN_DIVISOR_RULES_JSON
          : JSON.stringify(settingsData.BULLETIN_DIVISOR_RULES_JSON);
      }
      bulletinDivisorSummary = _buildAiBulletinDivisorSummary_(settingsData, tokens);
      curriculumState = _getSettingsCurriculumState_(message);
      if (curriculumQuery) {
        curriculumSummary = _buildAiCurriculumSummary_(tokens);
        // Load assistance context from master spreadsheet for configuration guidance
        masterAssistanceContext = getAiConfigurationAssistanceContext_(
          ['sec_ns1', 'sec_ns2', 'sec_ns3', 'sec_ns4'],
          settingsData
        );
      }
    }

    // ── FULL SYSTEM SNAPSHOT (élèves, notes, présences, paiements) ────────────
    // Chargé depuis le cache 5 min — donne à l'IA accès à TOUTES les données.
    var systemSnapshot = null;
    try {
      if (_viewerCanAccessAiSection_(viewer, 'students') || viewer.isMaster || viewer.isGodMode) {
        systemSnapshot = _buildAiFullSystemSnapshot_(viewer, auth);
      }
    } catch (_snapErr) {}

    return {
      accessibleSections: ['settings', 'students', 'finance', 'attendance', 'grades', 'staff', 'audit', 'communication', 'ids']
        .filter(function(section) { return _viewerCanAccessAiSection_(viewer, section); }),
      sheetRegistry: sheetRegistry,
      sheetPreviews: selectedSheets.map(function(sheet) {
        var scanDepth = tokens.length <= 1 ? 40 : tokens.length <= 3 ? 80 : 180;
        return _buildAiSheetPreview_(sheet, tokens, { scanRows: scanDepth, matchRows: 6, sampleRows: 4 });
      }),
      settingsQuery: settingsQuery,
      settingsSource: settingsQuery ? 'Settings' : '',
      settingsFocusKeys: settingsFocusKeys,
      settingsData: settingsPreview,
      settingsAvailable: !!Object.keys(settingsPreview).length,
      bulletinDivisorSummary: bulletinDivisorSummary,
      curriculumQuery: curriculumQuery,
      curriculumTotalSubjects: Number(curriculumState.totalSubjects || 0),
      curriculumByLevel: Array.isArray(curriculumState.byLevel) ? curriculumState.byLevel : [],
      curriculumHasSubjects: !!(curriculumSummary && curriculumSummary.hasSubjects),
      curriculumUsesCoefficients: !!(curriculumState && curriculumState.usesCoefficients),
      curriculumRequestedLevels: curriculumSummary.requestedLevels || [],
      curriculumSummary: curriculumSummary.lines || [],
      masterAssistanceContext: masterAssistanceContext,
      systemSnapshot: systemSnapshot
    };
  } catch (_err) {
    return {};
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AI COMMAND SYSTEM: Parse, validate, and execute structured AI commands
// ────────────────────────────────────────────────────────────────────────────

function _parseAiCommand_(messageText) {
  var txt = String(messageText || '').trim();
  var low = txt.toLowerCase();

  // ── SCORE / GRADE ─────────────────────────────────────────────────────────
  // "ajoute une note de 15 à Jean en Maths" / "add score 85 for STU001 in Physics"
  var scoreMatch = low.match(/(?:ajoute?|add|enregistre?|save|saisir|saisie|mettre?|enter)\s+(?:une?\s+)?(?:note|score|grade|cote)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s+(?:à|pour|for|to|à\s+l'?élève|pour l'élève)?\s*([a-z0-9À-ÿ\s\-_]+?)\s+(?:en|in|pour|for|de|dans)\s+([a-z0-9À-ÿ\s\-_]+?)(?:\s|$)/i);
  if (scoreMatch) {
    return {
      command: 'add_score',
      score: Number(String(scoreMatch[1]).replace(',','.')),
      studentRef: String(scoreMatch[2] || '').trim(),
      subjectRef: String(scoreMatch[3] || '').trim(),
      raw: txt
    };
  }
  // "note 15 Jean Maths" minimal form
  var scoreSimple = low.match(/^(?:note|score)\s+(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.+)$/i);
  if (scoreSimple) {
    return {
      command: 'add_score',
      score: Number(String(scoreSimple[1]).replace(',','.')),
      studentRef: String(scoreSimple[2] || '').trim(),
      subjectRef: String(scoreSimple[3] || '').trim(),
      raw: txt
    };
  }

  // ── BLOCK / UNBLOCK USER/STUDENT ─────────────────────────────────────────
  var blockMatch = low.match(/(?:bloquer?|block|suspendre?|suspend|désactiver?|deactivate|disable)\s+(?:l'?[eé]l[eè]ve\s+|l'?utilisateur\s+|l'?étudiant\s+|le\s+compte\s+)?([a-z0-9À-ÿ\s\-_.@]+?)(?:\s|$)/i);
  if (blockMatch && !/débloquer|unblock|réactiver|reactivate/i.test(low)) {
    return { command: 'block_user', userRef: String(blockMatch[1] || '').trim(), raw: txt };
  }
  var unblockMatch = low.match(/(?:d[ée]bloquer?|unblock|r[eé]activer?|reactivate|enable)\s+(?:l'?[eé]l[eè]ve\s+|l'?utilisateur\s+|le\s+compte\s+)?([a-z0-9À-ÿ\s\-_.@]+?)(?:\s|$)/i);
  if (unblockMatch) {
    return { command: 'unblock_user', userRef: String(unblockMatch[1] || '').trim(), raw: txt };
  }

  // ── TEACHER AFFECTATION ────────────────────────────────────────────────────
  // "affecte Prof Dupont à la classe NS2 pour Maths" / "assign teacher X to class Y subject Z"
  var affectMatch = low.match(/(?:affect[eo]r?|assigne?r?|assign|attribuer?|affecter?)\s+(?:le\s+prof(?:esseur)?\s+|l'enseignant\s+|teacher\s+)?([a-z0-9À-ÿ\s\-_.@]+?)\s+(?:à|to|pour|for)\s+(?:la\s+classe\s+|class\s+)?([a-z0-9\s\-_]+?)\s+(?:(?:pour|for|en|in)\s+([a-z0-9À-ÿ\s\-_]+?))?(?:\s|$)/i);
  if (affectMatch) {
    return {
      command: 'assign_teacher',
      teacherRef: String(affectMatch[1] || '').trim(),
      classRef: String(affectMatch[2] || '').trim(),
      subjectRef: String(affectMatch[3] || '').trim(),
      raw: txt
    };
  }

  // ── ALARM / ALERT ──────────────────────────────────────────────────────────
  // "crée une alarme pour NS2 absence > 3" / "set alarm attendance class NS3"
  var alarmMatch = low.match(/(?:cr[eé]er?|create|add|ajouter?|set|configurer?|d[eé]clencher?)\s+(?:une?\s+)?(?:alarme?|alerte?|alarm|alert|notification)\s+(.+)/i);
  if (alarmMatch) {
    return { command: 'set_alarm', alarmDesc: String(alarmMatch[1] || '').trim(), raw: txt };
  }

  // ── SETUP / UPDATE SUBJECTS ────────────────────────────────────────────────
  // "configure les matières du Fondamental" / "setup subjects for secondaire"
  var subjectSetupMatch = low.match(/(?:configurer?|setup|initialiser?|initialize|d[eé]finir?|define|mettre?\s+[àa]\s+jour|update)\s+(?:les\s+)?(?:mati[eè]res?|subjects?|curriculum)\s+(?:(?:du|de|for|pour)\s+)?([a-z0-9\s]+?)(?:\s|$)/i);
  if (subjectSetupMatch) {
    return {
      command: 'setup_subjects',
      cycleRef: String(subjectSetupMatch[1] || '').trim(),
      raw: txt
    };
  }
  // "ajoute la matière Chimie au Secondaire coeff 400"
  var addSubjectMatch = low.match(/(?:ajouter?|add|cr[eé]er?|create)\s+(?:la\s+)?(?:mati[eè]re?|subject)\s+([a-z0-9À-ÿ\s\-_]+?)\s+(?:au?|to|en|dans)\s+([a-z0-9\s]+?)(?:\s+(?:coeff?(?:icient)?)?\s*(\d+))?(?:\s|$)/i);
  if (addSubjectMatch) {
    return {
      command: 'create_subject',
      subjectName: String(addSubjectMatch[1] || '').trim(),
      cycleRef: String(addSubjectMatch[2] || '').trim(),
      coeff: addSubjectMatch[3] ? Number(addSubjectMatch[3]) : null,
      raw: txt
    };
  }

  // ── DEPLOY/CONFIGURE ──────────────────────────────────────────────────────
  if (/d[ée]ploi(?:e|)|configure|initialize|setup|init(?:\s+le|\s+la)?\s+(?:syst[ée]me|structure|configuration|niveaux|mati[ée]res)/i.test(txt)) {
    var deployMatch = txt.match(/d[ée]ploi(?:e|)|configure|initialize|setup/i);
    if (deployMatch) {
      var what = 'all';
      if (/niveaux|levels|grades?(?:\s|$)/i.test(txt)) what = 'levels';
      else if (/mati[ée]res|subjects|subjects?(?:\s|$)/i.test(txt)) what = 'subjects';
      else if (/divise|divisor/i.test(txt)) what = 'divisors';
      else if (/classe|class/i.test(txt)) what = 'classes';
      else if (/ann[ée]e|year|academic/i.test(txt)) what = 'academic_year';
      return { command: 'deploy_system', what: what, raw: txt };
    }
  }

  // ── OCR CURRICULUM ────────────────────────────────────────────────────────
  if (/photo|image|carnet|notebook|capture|screenshot|extrait|upload|import|from\s+(?:image|photo)/i.test(txt)) {
    if (/mati[ée]re|subject|curriculum|syllabus|extrait|configure|set\s+from/i.test(txt)) {
      var levelMatch = txt.match(/(NS\d|FONDAMENTAL|PRIMAIRE|MAT[EÉ]RNELLE|SECONDAIRE|maternelle|primaire|fondamental)/i);
      return { command: 'extract_curriculum_ocr', level: levelMatch ? (levelMatch[1] || 'unknown') : 'unknown', raw: txt };
    }
  }

  // ── DIVISOR ───────────────────────────────────────────────────────────────
  var divisorMatch = txt.match(/v[ée]rif(?:i|ie)(?:\s+le)?\s+divise(?:ur|)(?:\s+|)(NS\d|FONDAMENTAL|PRIMAIRE|MAT[EÉ]RNELLE|SECONDAIRE)/i);
  if (divisorMatch) return { command: 'verify_divisor', level: (divisorMatch[1] || '').toUpperCase(), raw: txt };

  var updateDiv = txt.match(/(?:modif|chang|update|set)\s+divise(?:ur|)\s+(NS\d|FONDAMENTAL|PRIMAIRE|MAT[EÉ]RNELLE|SECONDAIRE)\s+(?:à|to)\s+(\d+)/i);
  if (updateDiv) return { command: 'update_divisor', level: (updateDiv[1] || '').toUpperCase(), value: Number(updateDiv[2]) || 0, raw: txt };

  if (/v[ée]rif(?:i|ie).*ann[ée]e?\s+scol/i.test(txt)) return { command: 'verify_academic_year', raw: txt };
  if (/v[ée]rif(?:i|ie).*(?:configuration|settings|param[eé]tre)/i.test(txt)) return { command: 'verify_settings', raw: txt };

  return null;
}

function _updateSettingsViaAi_(settingKey, newValue, viewer, payload) {
  try {
    if (!viewer || !viewer.success) {
      return { success: false, error: 'AUTH_FAILED', detail: 'Utilisateur non authentifié.' };
    }
    
    var hasPermission = viewer.isMaster || viewer.isGodMode || 
      (viewer.permissions && (viewer.permissions.pa_save_settings || viewer.permissions.p_settings));
    
    if (!hasPermission) {
      writeAuditLog_('AI_SETTINGS_UPDATE_DENIED', settingKey, 
        'AI attempted Settings update without permission', 'p_use_ai', true);
      return { success: false, error: 'PERMISSION_DENIED', 
        detail: 'Permission pa_save_settings requise.' };
    }
    
    // Get old value
    var conf = getSaaSSettings_(viewer.email, new Date().getFullYear());
    var oldValue = conf && conf[settingKey] ? conf[settingKey] : null;
    
    // Update via standard Settings handler
    var updatePayload = {};
    updatePayload[settingKey] = newValue;
    var result = updateSaaSSettings_(updatePayload, { email: viewer.email });
    
    if (result && result.success) {
      writeAuditLog_('AI_SETTINGS_UPDATED', settingKey, 
        'Changed from [' + String(oldValue || '') + '] to [' + String(newValue || '') + ']', 
        'p_use_ai');
      
      // Clear cache for consistency
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty('SAAS_SETTINGS_CACHE_' + String(viewer.email).toUpperCase());
      
      return {
        success: true,
        key: settingKey,
        oldValue: oldValue,
        newValue: newValue,
        message: settingKey + ' mis à jour avec succès.'
      };
    } else {
      return Object.assign({ success: false, key: settingKey }, result || {});
    }
  } catch (e) {
    writeAuditLog_('AI_SETTINGS_UPDATE_ERROR', settingKey, e.message, 'p_use_ai', true);
    return { success: false, error: e.message, key: settingKey };
  }
}

function _verifyBulletinDivisor_(levelName, viewer, conf) {
  try {
    var level = String(levelName || '').toUpperCase().trim();
    
    // Normalize level name
    var levelMap = {
      'NS4': 'sec_ns4',
      'NS3': 'sec_ns3',
      'NS2': 'sec_ns2',
      'NS1': 'sec_ns1',
      'SECONDAIRE': 'sec_ns4',
      'PRIMAIRE': 'primaire',
      'FONDAMENTAL': 'fondamental',
      'MATERNELLE': 'maternelle'
    };
    
    var lookupKey = levelMap[level] || level.toLowerCase();
    
    // Get divisor config
    var divisorJson = conf && conf['BULLETIN_DIVISOR_RULES_JSON'] 
      ? conf['BULLETIN_DIVISOR_RULES_JSON'] 
      : null;
    
    if (!divisorJson) {
      return {
        success: false,
        level: level,
        message: 'Configuration des diviseurs non trouvée.',
        error: 'CONFIG_NOT_FOUND'
      };
    }
    
    // Parse if JSON string
    var divisorConfig = typeof divisorJson === 'string' 
      ? (function() { try { return JSON.parse(divisorJson); } catch(_) { return null; } })()
      : divisorJson;
    
    if (!divisorConfig || !divisorConfig.levels) {
      return {
        success: false,
        level: level,
        message: 'Structure de configuration invalide.',
        error: 'INVALID_CONFIG'
      };
    }
    
    var levelConfig = divisorConfig.levels[lookupKey];
    if (!levelConfig) {
      return {
        success: false,
        level: level,
        lookupKey: lookupKey,
        message: 'Niveau ' + level + ' non configuré.',
        error: 'LEVEL_NOT_FOUND'
      };
    }
    
    // Build verification report
    var annual = levelConfig.annual || 0;
    var periods = levelConfig.periods || {};
    var periodsList = Object.keys(periods).map(function(pId) {
      return 'P' + pId + '=' + periods[pId];
    }).join(', ');
    
    var status = 'OK ✓';
    var issues = [];
    
    if (annual <= 0) {
      issues.push('Diviseur annuel invalide: ' + annual);
    }
    
    Object.keys(periods).forEach(function(pId) {
      if (periods[pId] <= 0) {
        issues.push('Diviseur période ' + pId + ' invalide: ' + periods[pId]);
      }
    });
    
    if (issues.length) {
      status = 'ATTENTION ⚠';
    }
    
    return {
      success: true,
      level: level,
      status: status,
      annual: annual,
      periods: periodsList,
      message: level + ': diviseur annuel = ' + annual + ' (' + periodsList + ')',
      issues: issues.length ? issues : null,
      fullConfig: levelConfig
    };
  } catch (e) {
    return {
      success: false,
      level: levelName,
      error: e.message,
      message: 'Erreur lors de la vérification: ' + e.message
    };
  }
}

function _verifyAcademicYear_(viewer, conf) {
  try {
    var year = conf && conf['ACADEMIC_YEAR'] ? String(conf['ACADEMIC_YEAR']).trim() : '';
    var startYear = conf && conf['SCHOOL_YEAR_START'] ? String(conf['SCHOOL_YEAR_START']).trim() : '';
    var endYear = conf && conf['SCHOOL_YEAR_END'] ? String(conf['SCHOOL_YEAR_END']).trim() : '';
    
    var issues = [];
    if (!year) issues.push('ACADEMIC_YEAR non définie');
    if (!startYear) issues.push('SCHOOL_YEAR_START non définie');
    if (!endYear) issues.push('SCHOOL_YEAR_END non définie');
    
    var status = issues.length ? 'ATTENTION ⚠' : 'OK ✓';
    
    return {
      success: true,
      status: status,
      academicYear: year,
      schoolYearStart: startYear,
      schoolYearEnd: endYear,
      message: 'Année scolaire ' + year + ' (du ' + startYear + ' au ' + endYear + ')',
      issues: issues.length ? issues : null
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      message: 'Erreur lors de la vérification: ' + e.message
    };
  }
}

function _verifySettings_(viewer, conf) {
  try {
    var settingsCount = conf ? Object.keys(conf).length : 0;
    var criticalSettings = ['ACADEMIC_YEAR', 'BULLETIN_DIVISOR_RULES_JSON', 'CURRENCY'];
    var criticalMissing = [];
    
    criticalSettings.forEach(function(key) {
      if (!conf || !conf[key]) {
        criticalMissing.push(key);
      }
    });
    
    var status = criticalMissing.length > 0 ? 'ATTENTION ⚠' : 'OK ✓';
    
    return {
      success: true,
      status: status,
      totalSettings: settingsCount,
      criticalMissing: criticalMissing.length ? criticalMissing : null,
      message: 'Settings: ' + settingsCount + ' paramètres chargés' + 
        (criticalMissing.length ? ' (' + criticalMissing.length + ' critiques manquants)' : '')
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      message: 'Erreur lors de la vérification: ' + e.message
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AI SESSION MEMORY: Proxy-based storage (no global collision)
// ────────────────────────────────────────────────────────────────────────────

function _getSessionMemory_(proxyContext) {
  // Retrieve memory from proxy context (no global collision)
  try {
    if (!proxyContext || typeof proxyContext !== 'object') {
      return { answers: {}, history: [] };
    }
    return proxyContext._AI_SESSION_MEMORY_ || { answers: {}, history: [] };
  } catch (e) {
    return { answers: {}, history: [] };
  }
}

function _setSessionMemory_(proxyContext, memory) {
  // Store memory in proxy context
  try {
    if (!proxyContext || typeof proxyContext !== 'object') return false;
    proxyContext._AI_SESSION_MEMORY_ = memory;
    return true;
  } catch (e) {
    return false;
  }
}

function _recordInSessionMemory_(proxyContext, questionId, answer) {
  // Record a Q&A pair in session memory (prevents re-asking)
  try {
    var memory = _getSessionMemory_(proxyContext);
    if (!memory.answers) memory.answers = {};
    if (!memory.history) memory.history = [];
    
    memory.answers[questionId] = answer;
    memory.history.push({
      questionId: questionId,
      answer: answer,
      timestamp: new Date().toISOString()
    });
    
    _setSessionMemory_(proxyContext, memory);
    return true;
  } catch (e) {
    return false;
  }
}

function _hasAnsweredQuestion_(proxyContext, questionId) {
  // Check if question was already answered in this session
  try {
    var memory = _getSessionMemory_(proxyContext);
    return !!(memory.answers && memory.answers[questionId]);
  } catch (e) {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURATION SYSTEM: Interactive setup with memory & scope control
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────

function _getDefaultCurriculumForLevel_(levelKey) {
  var level = String(levelKey || '').toLowerCase().trim();
  var fromSheet = _getAiCurriculumForLevelFromSheets_(levelKey);
  if (fromSheet && fromSheet.length) return fromSheet;
  
  // Maternelle curriculum
  if (level === 'maternelle') {
    return [
      { subject: 'Langage', branches: [] },
      { subject: 'Pré-lecture', branches: [] },
      { subject: 'Pré-écriture', branches: [] },
      { subject: 'Pré-calcul', branches: [] },
      { subject: 'Poésie', branches: [] },
      { subject: 'Chant', branches: [] },
      { subject: 'Contes', branches: [] },
      { subject: 'Histoire', branches: [] },
      { subject: 'Rythmes', branches: [] },
      { subject: 'Exercices sensoriels', branches: [] },
      { subject: 'Travaux manuels', branches: [] },
      { subject: 'Coloriage', branches: [] },
      { subject: 'Peinture', branches: [] },
      { subject: 'Dessin', branches: [] },
      { subject: 'Modelage', branches: [] },
      { subject: 'Culture physique', branches: [] },
      { subject: 'Jeux libres', branches: [] },
      { subject: 'Obéissance', branches: [] },
      { subject: 'Respect', branches: [] },
      { subject: 'Discipline', branches: [] },
      { subject: 'Volonté', branches: [] },
      { subject: 'Utilisation du langage', branches: [] },
      { subject: 'Bonne prononciation', branches: [] },
      { subject: 'Calme', branches: [] },
      { subject: 'Attentif', branches: [] },
      { subject: 'Poli(e)', branches: [] },
      { subject: 'Gentil(le)', branches: [] },
      { subject: 'Éducation morale', branches: [] }
    ];
  }
  
  // Fondamental curriculum
  if (level === 'fondamental') {
    return [
      { subject: 'Français', coeff: 200, branches: [] },
      { subject: 'Mathématiques', coeff: 400, branches: [] },
      { subject: 'Sciences', coeff: 200, branches: [] },
      { subject: 'Histoire', coeff: 100, branches: [] },
      { subject: 'Anglais', coeff: 100, branches: [] }
    ];
  }
  
  // Primaire curriculum
  if (level === 'primaire') {
    return [
      { subject: 'Français', coeff: 200, branches: [] },
      { subject: 'Mathématiques', coeff: 400, branches: [] },
      { subject: 'Sciences', coeff: 200, branches: [] },
      { subject: 'Histoire', coeff: 100, branches: [] },
      { subject: 'Anglais', coeff: 100, branches: [] }
    ];
  }
  
  // Secondaire (default for NS4, NS3, NS2, NS1)
  return [
    { subject: 'Français', coeff: 200, branches: [] },
    { subject: 'Mathématiques', coeff: 400, branches: [] },
    { subject: 'Physique', coeff: 200, branches: [] },
    { subject: 'SVT', coeff: 200, branches: [] },
    { subject: 'Histoire', coeff: 100, branches: [] },
    { subject: 'Philosophie', coeff: 100, branches: [] }
  ];
}

function _getDefaultDivisorRules_() {
  return {
    levels: {
      sec_ns4: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      sec_ns3: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      sec_ns2: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      sec_ns1: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      primaire: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      fondamental: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } },
      maternelle: { annual: 20, periods: { '1': 20, '2': 20, '3': 20 } }
    },
    students: {},
    metadata: {
      cycleYearly: {
        SECONDAIRE: { divisor: 20, details: 'Par défaut pour les niveaux secondaires' },
        PRIMAIRE: { divisor: 20, details: 'Par défaut pour le niveau primaire' },
        FONDAMENTAL: { divisor: 20, details: 'Par défaut pour le niveau fondamental' },
        MATERNELLE: { divisor: 20, details: 'Par défaut pour le niveau maternelle' }
      }
    }
  };
}

function _getDefaultClasses_() {
  return {
    // Secondaire
    sec_ns4: ['NS4-A', 'NS4-B', 'NS4-C'],
    sec_ns3: ['NS3-A', 'NS3-B', 'NS3-C'],
    sec_ns2: ['NS2-A', 'NS2-B'],
    sec_ns1: ['NS1-A', 'NS1-B'],
    // Primaire
    primaire: ['6ème-A', '6ème-B', '5ème-A', '5ème-B', '4ème-A', '4ème-B'],
    // Fondamental
    fondamental: ['3ème-A', '3ème-B', '2ème-A', '2ème-B', '1ère-A', '1ère-B'],
    // Maternelle
    maternelle: ['TPS', 'PS', 'MS']
  };
}

function _deploySystemConfiguration_(viewer, options) {
  try {
    if (!viewer || !viewer.success) {
      return { success: false, error: 'AUTH_FAILED', detail: 'Utilisateur non authentifié.' };
    }
    
    var hasPermission = viewer.isMaster || viewer.isGodMode || 
      (viewer.permissions && viewer.permissions.pa_save_settings);
    
    if (!hasPermission) {
      writeAuditLog_('DEPLOY_SYSTEM_DENIED', 'CONFIG', 
        'Deployment attempted without pa_save_settings', 'p_use_ai', true);
      return { success: false, error: 'PERMISSION_DENIED', 
        detail: 'Permission pa_save_settings requise.' };
    }
    
    var opts = options || {};
    var what = String(opts.what || 'all').toLowerCase();
    var deployed = [];
    var errors = [];
    
    // Get current config
    var confRes = getSaaSSettings_(viewer.email, new Date().getFullYear());
    var conf = (confRes && confRes.success && confRes.data) ? confRes.data : (confRes || {});

    // Deploy defaults from AI defaults sheet in one write pass.
    if (what === 'all' || what === 'defaults') {
      try {
        var defaultPayload = _getAiDefaultsMapFromSheets_();
        if (defaultPayload && Object.keys(defaultPayload).length) {
          var defaultsResult = updateSaaSSettings_(defaultPayload, { email: viewer.email });
          if (defaultsResult && defaultsResult.success) {
            Object.keys(defaultPayload).forEach(function(k) { deployed.push(k); });
          } else {
            errors.push('AI_CONFIG_DEFAULTS: ' + (defaultsResult && defaultsResult.error || 'Unknown error'));
          }
        }
      } catch (e) {
        errors.push('AI_CONFIG_DEFAULTS: ' + e.message);
      }
    }
    
    // Deploy levels/subjects (curricula)
    if (what === 'all' || what === 'subjects' || what === 'levels') {
      var levels = _getAiActiveLevelIdsFromSheets_();
      if (!levels.length) levels = ['maternelle', 'fondamental', 'primaire', 'sec_ns4', 'sec_ns3', 'sec_ns2', 'sec_ns1'];
      levels.forEach(function(levelKey) {
        var curriculum = _getDefaultCurriculumForLevel_(levelKey);
        var settingKey = 'CURRICULUM_' + levelKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
        try {
          var updatePayload = {};
          updatePayload[settingKey] = curriculum;
          var result = updateSaaSSettings_(updatePayload, { email: viewer.email });
          if (result && result.success) {
            deployed.push(settingKey);
          } else {
            errors.push(settingKey + ': ' + (result && result.error || 'Unknown error'));
          }
        } catch (e) {
          errors.push(settingKey + ': ' + e.message);
        }
      });
    }
    
    // Deploy divisor rules
    if (what === 'all' || what === 'divisors') {
      try {
        var divisorRules = _getDefaultDivisorRules_();
        var updatePayload = { BULLETIN_DIVISOR_RULES_JSON: divisorRules };
        var result = updateSaaSSettings_(updatePayload, { email: viewer.email });
        if (result && result.success) {
          deployed.push('BULLETIN_DIVISOR_RULES_JSON');
        } else {
          errors.push('BULLETIN_DIVISOR_RULES_JSON: ' + (result && result.error || 'Unknown error'));
        }
      } catch (e) {
        errors.push('BULLETIN_DIVISOR_RULES_JSON: ' + e.message);
      }
    }
    
    // Deploy academic year if needed
    if (what === 'all' || what === 'academic_year') {
      try {
        var currentYear = new Date().getFullYear();
        var nextYear = currentYear + 1;
        var academicYear = currentYear + '-' + nextYear;
        
        if (!conf.ACADEMIC_YEAR) {
          var updatePayload = {
            ACADEMIC_YEAR: academicYear,
            SCHOOL_YEAR_START: currentYear + '-09-01',
            SCHOOL_YEAR_END: nextYear + '-08-31'
          };
          var result = updateSaaSSettings_(updatePayload, { email: viewer.email });
          if (result && result.success) {
            deployed.push('ACADEMIC_YEAR');
            deployed.push('SCHOOL_YEAR_START');
            deployed.push('SCHOOL_YEAR_END');
          } else {
            errors.push('ACADEMIC_YEAR: ' + (result && result.error || 'Unknown error'));
          }
        } else {
          deployed.push('ACADEMIC_YEAR (already configured)');
        }
      } catch (e) {
        errors.push('ACADEMIC_YEAR: ' + e.message);
      }
    }
    
    // Log the deployment
    writeAuditLog_('DEPLOY_SYSTEM', 'CONFIG', 
      'Deployed: ' + deployed.join(', ') + (errors.length ? ' | Errors: ' + errors.join(', ') : ''), 
      'p_use_ai');
    
    // Clear cache for consistency
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty('SAAS_SETTINGS_CACHE_' + String(viewer.email).toUpperCase());
    
    return {
      success: !errors.length,
      deployed: deployed,
      errors: errors.length ? errors : null,
      message: 'Déploiement: ' + deployed.length + ' paramètres configurés' + 
        (errors.length ? ' (' + errors.length + ' erreurs)' : ''),
      what: what
    };
  } catch (e) {
    writeAuditLog_('DEPLOY_SYSTEM_ERROR', 'CONFIG', e.message, 'p_use_ai', true);
    return { success: false, error: e.message, detail: 'Erreur lors du déploiement système' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AI CONFIGURATION SYSTEM: Interactive setup with memory & scope control
// ────────────────────────────────────────────────────────────────────────────

function _getConfigurationQuestions_() {
  var fromSheets = _getAiConfigurationQuestionsFromSheets_();
  if (fromSheets && Object.keys(fromSheets).length) return fromSheets;
  return {
    establishment: {
      title: 'Identification de l\'établissement',
      questions: [
        { id: 'school_name', prompt: 'Quel est le nom officiel de l\'établissement ?', type: 'text', required: true },
        { id: 'school_address', prompt: 'Adresse physique ?', type: 'text', required: false },
        { id: 'school_phone', prompt: 'Numéro de téléphone principal ?', type: 'text', required: false },
        { id: 'school_email', prompt: 'Email de contact ?', type: 'text', required: false },
        { id: 'school_director', prompt: 'Nom du directeur ?', type: 'text', required: false }
      ]
    },
    academic: {
      title: 'Structure académique',
      questions: [
        { id: 'academic_year', prompt: 'Année scolaire (format YYYY-YYYY) ?', type: 'text', required: true },
        { id: 'levels', prompt: 'Quels niveaux d\'enseignement? (ex: Maternelle, Fondamental, Primaire, Secondaire)', type: 'multi', required: true },
        { id: 'grading_scale', prompt: 'Échelle de notation (ex: /20, /100, Lettres A-F) ?', type: 'text', required: true },
        { id: 'grading_format', prompt: 'Format: Numérique, Lettres ou Compétences ?', type: 'select', options: ['Numérique', 'Lettres', 'Compétences'], required: true },
        { id: 'periods_per_year', prompt: 'Nombre de périodes par année ?', type: 'number', required: true }
      ]
    },
    curriculum: {
      title: 'Curriculum par niveau',
      levels: ['maternelle', 'fondamental', 'primaire', 'sec_ns4', 'sec_ns3', 'sec_ns2', 'sec_ns1'],
      questionTemplate: 'Matières pour {{LEVEL}} (séparées par virgule) ? (Les coefficients seront définis après)',
      instructions: 'Pour chaque niveau, listez les matières principales'
    },
    divisors: {
      title: 'Configuration des diviseurs (barème de notation)',
      questions: [
        { id: 'divisor_annual', prompt: 'Diviseur annuel par défaut (ex: 20) ?', type: 'number', required: true },
        { id: 'divisor_p1', prompt: 'Diviseur période 1 ?', type: 'number', required: true },
        { id: 'divisor_p2', prompt: 'Diviseur période 2 ?', type: 'number', required: true },
        { id: 'divisor_p3', prompt: 'Diviseur période 3 ?', type: 'number', required: true }
      ]
    },
    finance: {
      title: 'Configuration financière',
      questions: [
        { id: 'currency', prompt: 'Devise (ex: HTG, USD, EUR) ?', type: 'text', required: true },
        { id: 'tuition_frequency', prompt: 'Fréquence des frais (Mensuel, Trimestriel, Annuel) ?', type: 'select', options: ['Mensuel', 'Trimestriel', 'Annuel'], required: true },
        { id: 'payment_terms', prompt: 'Délai de paiement (Début du trimestre, À la fin, Flexible) ?', type: 'select', options: ['Début du trimestre', 'À la fin', 'Flexible'], required: true }
      ]
    },
    attendance: {
      title: 'Configuration de la présence',
      questions: [
        { id: 'sessions_per_day', prompt: 'Nombre de sessions par jour ?', type: 'number', required: true },
        { id: 'days_per_week', prompt: 'Nombre de jours de classe par semaine ?', type: 'number', required: true },
        { id: 'attendance_threshold', prompt: 'Seuil de présence minimum (%) pour valider un trimestre ?', type: 'number', required: true }
      ]
    }
  };
}

function _createConfigurationSession_(viewer) {
  try {
    if (!viewer || !viewer.success) return null;
    
    var sessionId = Utilities.getUuid();
    var session = {
      id: sessionId,
      userId: viewer.email,
      createdAt: new Date().toISOString(),
      currentSection: 'establishment',
      completedSections: [],
      answers: {},
      memory: {},
      status: 'in_progress'
    };
    
    // Store in script properties
    var props = PropertiesService.getScriptProperties();
    var key = 'AI_CONFIG_SESSION_' + String(viewer.email).toUpperCase();
    props.setProperty(key, JSON.stringify(session));
    
    return session;
  } catch (e) {
    return null;
  }
}

function _getConfigurationSession_(userEmail) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'AI_CONFIG_SESSION_' + String(userEmail || '').toUpperCase();
    var raw = props.getProperty(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function _updateConfigurationSession_(userEmail, updates) {
  try {
    var session = _getConfigurationSession_(userEmail);
    if (!session) return null;
    
    // Merge updates
    Object.keys(updates || {}).forEach(function(key) {
      session[key] = updates[key];
    });
    
    // Persist
    var props = PropertiesService.getScriptProperties();
    var sessionKey = 'AI_CONFIG_SESSION_' + String(userEmail || '').toUpperCase();
    props.setProperty(sessionKey, JSON.stringify(session));
    
    // Also store memory snapshot
    var memoryKey = 'AI_CONFIG_MEMORY_' + String(userEmail || '').toUpperCase();
    props.setProperty(memoryKey, JSON.stringify(session.memory || {}));
    
    return session;
  } catch (e) {
    return null;
  }
}

function _getConfigurationMemory_(userEmail) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'AI_CONFIG_MEMORY_' + String(userEmail || '').toUpperCase();
    var raw = props.getProperty(key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// _isSystemQuestion_: passthrough — all messages allowed; permissions enforced at execution time.
function _isSystemQuestion_(messageText) { return true; }

function _generateConfigurationPrompt_(userEmail) {
  try {
    var session = _getConfigurationSession_(userEmail);
    var memory = _getConfigurationMemory_(userEmail);
    
    if (!session) {
      return 'Démarrage de la configuration du système. Quelle section voulez-vous configurer en premier ? ' +
        'Options: Établissement, Structure académique, Curriculum, Diviseurs, Finance, Présence.';
    }
    
    var questions = _getConfigurationQuestions_();
    var currentSection = questions[session.currentSection];
    
    if (!currentSection) {
      return 'Configuration terminée ! Vos paramètres sont sauvegardés.';
    }
    
    var currentAnswers = session.answers[session.currentSection] || {};
    var answeredCount = Object.keys(currentAnswers).length;
    var totalCount = currentSection.questions ? currentSection.questions.length : 0;
    
    var prompt = 'Section: ' + currentSection.title + ' (' + answeredCount + '/' + totalCount + ' complétée)\n\n';
    
    // Add questions not yet answered
    if (currentSection.questions) {
      for (var i = 0; i < currentSection.questions.length; i++) {
        var q = currentSection.questions[i];
        if (!currentAnswers[q.id]) {
          prompt += 'Q: ' + q.prompt + '\n';
          if (q.options) {
            prompt += 'Options: ' + q.options.join(', ') + '\n';
          }
          break; // Ask one question at a time
        }
      }
    }
    
    // Add memory hint
    if (Object.keys(memory).length > 0) {
      prompt += '\n[Mémoire]: Vous avez déjà répondu: ' + Object.keys(memory).join(', ') + '\n';
    }
    
    prompt += '\n(Répondez simplement, puis passez à la question suivante)';
    
    return prompt;
  } catch (e) {
    return 'Erreur lors de la génération de la configuration.';
  }
}

function _isSystemOnlyResponse_(messageText) {
  var txt = String(messageText || '').toLowerCase();
  
  // Help/blocked questions (system)
  if (/aide|help|bloqué|stuck|comment|how|guide|explique|explain|ne sais pas|i don't know|quoi faire|what to do/i.test(txt)) {
    return true;
  }
  
  // Configuration questions (system)
  if (/configure|setup|deploy|question|parameter|setting/i.test(txt)) {
    return true;
  }
  
  // External questions (not system)
  if (/météo|weather|news|politique|politics|recette|recipe|blague|joke|amour|love|sport external/i.test(txt)) {
    return false;
  }
  
  return true;
}

function _buildAiSystemPromptFull_(viewer, session, memory, conf) {
  var lines = [
    'Tu es Meigens AI, Assistant IA expert en gestion scolaire pour "' + (conf && conf.SCHOOL_NAME || 'l\'établissement') + '".',
    '',
    '=== PORTÉE (SCOPE) ===',
    'Tu NE DOIS répondre QU\'aux questions relatives au système scolaire:',
    '✓ Configuration (établissement, académique, curriculum, finance, présence)',
    '✓ Questions d\'aide si l\'utilisateur est bloqué ("Je ne sais pas comment...")',
    '✓ Questions de guidage ("Comment configurer...?", "Explique-moi...")',
    '✗ REFUSE les questions extérieures (météo, politique, musique, blagues, etc.)',
    '',
    '=== MODE CONFIGURATION ===',
    'L\'utilisateur est actuellement en session de configuration du système.',
    'Ton rôle:',
    '1. Poser des questions claires et pertinentes, UNE SEULE à la fois',
    '2. Valider les réponses (format, plage, cohérence)',
    '3. Mémoriser les réponses pour éviter de reposer les mêmes questions',
    '4. Guider l\'utilisateur d\'une section à l\'autre',
    '5. Générer des configurations cohérentes en JSON quand complété',
    '',
    '=== MÉMOIRE DE SESSION ===',
    'Réponses déjà fournies:',
    _buildMemoryLines_(memory),
    '',
    '=== PARAMÈTRES SYSTÈME ACTUELS ===',
    'Année scolaire: ' + (conf && conf.ACADEMIC_YEAR || '-- à configurer --'),
    'Niveaux: ' + (conf && conf.LEVELS || '-- à configurer --'),
    'Devise: ' + (conf && conf.CURRENCY || 'HTG'),
    'Format notes: ' + (conf && conf.GRADING_FORMAT || '-- à configurer --'),
    '',
    '=== INSTRUCTIONS ===',
    'Réponds en français, de manière professionnelle et pédagogique.',
    'Si l\'utilisateur pose une question externe → Refuse poliment: "Je ne peux répondre qu\'aux questions du système scolaire. Puis-je vous aider avec la configuration ?"',
    'Si l\'utilisateur est bloqué → Offre une aide contextuelle avant de poser la prochaine question.',
    'Pour chaque réponse → Confirme reçu et propose la prochaine étape.',
    'Évite de reposer les mêmes questions (consulte la mémoire d\'abord).'
  ];
  
  return lines.join('\n');
}

function _buildMemoryLines_(memory) {
  if (!memory || Object.keys(memory).length === 0) {
    return '[Aucune réponse pour l\'instant]';
  }
  
  var lines = [];
  Object.keys(memory).forEach(function(key) {
    var value = String(memory[key] || '').substring(0, 80);
    lines.push('• ' + key + ': ' + value);
  });
  
  return lines.join('\n');
}

function _parseConfigurationAnswer_(messageText, currentQuestion) {
  try {
    var txt = String(messageText || '').trim();
    
    if (!currentQuestion) return { success: false, error: 'No question context' };
    
    // Validate based on type
    if (currentQuestion.type === 'number') {
      var num = Number(txt);
      if (isNaN(num)) {
        return { success: false, error: 'Veuillez fournir un nombre', suggestion: 'Exemple: 20' };
      }
      return { success: true, value: num, validated: true };
    }
    
    if (currentQuestion.type === 'select') {
      var options = currentQuestion.options || [];
      var normalized = txt.toLowerCase();
      var match = options.find(function(opt) {
        return String(opt).toLowerCase().indexOf(normalized) !== -1;
      });
      if (!match) {
        return { success: false, error: 'Option invalide', suggestion: 'Choisissez parmi: ' + options.join(', ') };
      }
      return { success: true, value: match, validated: true };
    }
    
    if (currentQuestion.type === 'text' && currentQuestion.required && txt.length < 2) {
      return { success: false, error: 'Réponse trop courte', suggestion: 'Veuillez donner plus de détails' };
    }
    
    return { success: true, value: txt, validated: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OCR-BASED CURRICULUM EXTRACTION: Parse notebook photos for subjects
// ────────────────────────────────────────────────────────────────────────────

function _extractCurriculumFromImage_(imageBase64, levelHint, viewer) {
  try {
    if (!viewer || !viewer.success) {
      return { success: false, error: 'AUTH_FAILED' };
    }
    
    var hasPermission = viewer.isMaster || viewer.isGodMode || 
      (viewer.permissions && viewer.permissions.pa_save_settings);
    
    if (!hasPermission) {
      writeAuditLog_('EXTRACT_CURRICULUM_OCR_DENIED', 'IMAGE', 
        'Extraction attempted without permission', 'p_use_ai', true);
      return { success: false, error: 'PERMISSION_DENIED' };
    }
    
    // Get vision-capable model (Sonnet for images)
    var visionConfig = {
      provider: 'anthropic',
      apiKey: _resolveServerAiConfig_().apiKey,
      model: 'claude-3-5-sonnet-20241022',  // Vision-capable model
      apiUrl: 'https://api.anthropic.com/v1/messages'
    };
    
    if (!visionConfig.apiKey) {
      return { success: false, error: 'AI_KEY_NOT_CONFIGURED' };
    }
    
    var systemPrompt = 'You are an OCR specialist for school curricula. Extract all subject names from the notebook image. ' +
      'Return a JSON list like: {"subjects": [{"subject": "Français", "coeff": 200}, {"subject": "Mathématiques", "coeff": 400}]}. ' +
      'Infer coefficient from subject importance (Français=200, Maths=400, Sciences=200, other=100). ' +
      'Return ONLY valid JSON, no markdown.';
    
    var messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: 'Extract all subjects from this notebook image. Level hint: ' + (levelHint || 'unknown')
        }
      ]
    }];
    
    var payload = {
      model: visionConfig.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    };
    
    var resp = UrlFetchApp.fetch(visionConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': visionConfig.apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    var statusCode = Number(resp.getResponseCode() || 0);
    var rawBody = String(resp.getContentText() || '');
    
    if (statusCode !== 200) {
      writeAuditLog_('EXTRACT_CURRICULUM_OCR_ERROR', 'IMAGE', 
        'Vision API error: ' + statusCode + ' ' + rawBody.substring(0, 100), 'p_use_ai', true);
      return { success: false, error: 'VISION_API_ERROR', detail: statusCode };
    }
    
    var result = JSON.parse(rawBody || '{}');
    var extractedText = result && result.content && result.content[0] 
      ? String(result.content[0].text || '')
      : '';
    
    // Parse JSON response
    var extractedData = null;
    try {
      extractedData = JSON.parse(extractedText);
    } catch (_) {
      // Try to extract JSON from text
      var jsonMatch = extractedText.match(/\{[^{}]*"subjects"[^{}]*\}/);
      if (jsonMatch) {
        try {
          extractedData = JSON.parse(jsonMatch[0]);
        } catch (__) {
          return { success: false, error: 'JSON_PARSE_FAILED', raw: extractedText };
        }
      }
    }
    
    if (!extractedData || !Array.isArray(extractedData.subjects)) {
      return { success: false, error: 'INVALID_EXTRACTION', raw: extractedText };
    }
    
    writeAuditLog_('EXTRACT_CURRICULUM_OCR', 'IMAGE', 
      'Extracted ' + extractedData.subjects.length + ' subjects from image', 'p_use_ai');
    
    return {
      success: true,
      subjects: extractedData.subjects,
      message: 'Extraction réussie: ' + extractedData.subjects.length + ' matières identifiées',
      raw: extractedText
    };
  } catch (e) {
    writeAuditLog_('EXTRACT_CURRICULUM_OCR_ERROR', 'IMAGE', e.message, 'p_use_ai', true);
    return { success: false, error: e.message };
  }
}

function _extractCurriculumFromPdf_(pdfBase64, levelHint, viewer) {
  try {
    if (!viewer || !viewer.success) return { success: false, error: 'AUTH_FAILED' };
    var pdfData = String(pdfBase64 || '').trim();
    if (!pdfData) return { success: false, error: 'PDF_REQUIRED', message: 'Aucun document PDF reçu.' };
    // Keep OCR responsive by rejecting oversized PDFs early.
    if (pdfData.length > 4000000) {
      return {
        success: false,
        error: 'PDF_TOO_LARGE',
        message: 'Le PDF est trop volumineux pour une lecture rapide. Uploadez une photo nette (ou un PDF plus léger) du bulletin.'
      };
    }

    var hasPermission = viewer.isMaster || viewer.isGodMode ||
      (viewer.permissions && viewer.permissions.pa_save_settings);
    if (!hasPermission) {
      writeAuditLog_('EXTRACT_CURRICULUM_OCR_DENIED', 'PDF', 'PDF extraction attempted without permission', 'p_use_ai', true);
      return { success: false, error: 'PERMISSION_DENIED' };
    }

    var visionConfig = {
      provider: 'anthropic',
      apiKey: _resolveServerAiConfig_().apiKey,
      model: 'claude-3-5-sonnet-20241022',
      apiUrl: 'https://api.anthropic.com/v1/messages'
    };
    if (!visionConfig.apiKey) return { success: false, error: 'AI_KEY_NOT_CONFIGURED' };

    var systemPrompt = 'You are an OCR specialist for school report cards in PDF. ' +
      'Extract all subject names and coefficients when present. ' +
      'Return ONLY valid JSON: {"subjects":[{"subject":"Français","coeff":200}]}. ' +
      'If coefficient is missing, infer typical value.';

    var payload = {
      model: visionConfig.model,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfData
            }
          },
          {
            type: 'text',
            text: 'Extract all subjects and coefficients from this school bulletin PDF. Level hint: ' + (levelHint || 'unknown')
          }
        ]
      }]
    };

    var resp = UrlFetchApp.fetch(visionConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': visionConfig.apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var statusCode = Number(resp.getResponseCode() || 0);
    var rawBody = String(resp.getContentText() || '');
    if (statusCode !== 200) {
      writeAuditLog_('EXTRACT_CURRICULUM_OCR_ERROR', 'PDF', 'Vision API error: ' + statusCode + ' ' + rawBody.substring(0, 100), 'p_use_ai', true);
      return { success: false, error: 'VISION_API_ERROR', detail: statusCode };
    }

    var result = JSON.parse(rawBody || '{}');
    var extractedText = result && result.content && result.content[0]
      ? String(result.content[0].text || '')
      : '';

    var extractedData = null;
    try { extractedData = JSON.parse(extractedText); } catch (_) {
      var jsonMatch = extractedText.match(/\{[\s\S]*"subjects"[\s\S]*\}/);
      if (jsonMatch) {
        try { extractedData = JSON.parse(jsonMatch[0]); } catch (__) {}
      }
    }
    if (!extractedData || !Array.isArray(extractedData.subjects)) {
      return { success: false, error: 'INVALID_EXTRACTION', raw: extractedText };
    }

    writeAuditLog_('EXTRACT_CURRICULUM_OCR', 'PDF', 'Extracted ' + extractedData.subjects.length + ' subjects from PDF', 'p_use_ai');
    return {
      success: true,
      subjects: extractedData.subjects,
      message: 'Extraction PDF réussie: ' + extractedData.subjects.length + ' matières identifiées',
      raw: extractedText
    };
  } catch (e) {
    writeAuditLog_('EXTRACT_CURRICULUM_OCR_ERROR', 'PDF', e.message, 'p_use_ai', true);
    return { success: false, error: e.message };
  }
}

function _deployCurriculumFromOcr_(extractedSubjects, level, viewer) {
  try {
    if (!viewer || !viewer.success) {
      return { success: false, error: 'AUTH_FAILED' };
    }
    
    var hasPermission = viewer.isMaster || viewer.isGodMode || 
      (viewer.permissions && viewer.permissions.pa_save_settings);
    
    if (!hasPermission) {
      return { success: false, error: 'PERMISSION_DENIED' };
    }
    
    // Normalize level
    var levelKey = String(level || '').toLowerCase().trim();
    var validLevels = ['maternelle', 'fondamental', 'primaire', 'sec_ns4', 'sec_ns3', 'sec_ns2', 'sec_ns1'];
    
    if (validLevels.indexOf(levelKey) === -1) {
      return { success: false, error: 'INVALID_LEVEL', level: level };
    }
    
    // Build curriculum from extracted subjects
    var curriculum = (Array.isArray(extractedSubjects) ? extractedSubjects : [])
      .filter(function(s) { return s && s.subject; })
      .map(function(s) {
        return {
          subject: String(s.subject || '').trim(),
          coeff: Number(s.coeff || 100),
          branches: Array.isArray(s.branches) ? s.branches : []
        };
      });
    
    if (!curriculum.length) {
      return { success: false, error: 'NO_SUBJECTS', message: 'Aucune matière extraite de l\'image' };
    }
    
    // Save curriculum
    var settingKey = 'CURRICULUM_' + levelKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
    var updatePayload = {};
    updatePayload[settingKey] = curriculum;
    
    var result = updateSaaSSettings_(updatePayload, { email: viewer.email });
    
    if (result && result.success) {
      writeAuditLog_('DEPLOY_CURRICULUM_OCR', levelKey, 
        'Deployed ' + curriculum.length + ' subjects from OCR', 'p_use_ai');
      
      // Clear cache
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty('SAAS_SETTINGS_CACHE_' + String(viewer.email).toUpperCase());
      
      return {
        success: true,
        level: level,
        key: settingKey,
        subjects: curriculum,
        message: 'Curriculum de ' + level + ' configuré: ' + curriculum.length + ' matières'
      };
    } else {
      return { success: false, error: result && result.error || 'UPDATE_FAILED' };
    }
  } catch (e) {
    writeAuditLog_('DEPLOY_CURRICULUM_OCR_ERROR', level, e.message, 'p_use_ai', true);
    return { success: false, error: e.message };
  }
}

function _executeAiCommand_(command, viewer, conf, auth, payload) {
  try {
    if (!command || !command.command) return null;
    var cmd = String(command.command || '').toLowerCase();
    var perms = viewer.permissions || {};

    // ── ADD SCORE ─────────────────────────────────────────────────────────────
    if (cmd === 'add_score') {
      var canGrade = viewer.isMaster || viewer.isGodMode ||
        perms.p_grades || perms.pt_enter_grades || perms.pt_edit_grades || perms.p_manual;
      if (!canGrade) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission p_grades ou pt_enter_grades requise pour ajouter une note.' };

      var studentRef = String(command.studentRef || '').trim();
      var subjectRef = String(command.subjectRef || '').trim();
      var score = Number(command.score) || 0;
      if (!studentRef || !subjectRef) return { success: false, error: 'MISSING_PARAMS', message: 'Élève et matière requis pour ajouter une note.' };

      // Resolve student
      var ss = getSS_();
      var studentsSheet = ss.getSheetByName('students');
      if (!studentsSheet) return { success: false, error: 'SHEET_NOT_FOUND', message: 'Feuille students introuvable.' };
      var studData = studentsSheet.getDataRange().getValues();
      var studHeaders = studData[0].map(function(v) { return String(v).trim(); });
      var iCode = studHeaders.indexOf('StudentCode'); if (iCode === -1) iCode = studHeaders.indexOf('StudentID');
      var iFirst = studHeaders.indexOf('FirstName');
      var iLast = studHeaders.indexOf('LastName');
      var refLow = studentRef.toLowerCase();
      var foundStudent = null;
      for (var r = 1; r < studData.length; r++) {
        var code = String(studData[r][iCode] || '').toLowerCase();
        var fullName = ((String(studData[r][iFirst] || '') + ' ' + String(studData[r][iLast] || '')).trim()).toLowerCase();
        if (code === refLow || fullName.indexOf(refLow) !== -1 || refLow.indexOf(code) !== -1) {
          foundStudent = { code: String(studData[r][iCode] || '').trim(), name: (String(studData[r][iFirst] || '') + ' ' + String(studData[r][iLast] || '')).trim(), rowIdx: r };
          break;
        }
      }
      if (!foundStudent) return { success: false, error: 'STUDENT_NOT_FOUND', message: 'Élève introuvable: ' + studentRef + '. Vérifiez le nom ou le code.' };

      // Save grade via existing function
      var gradeObj = {
        studentCode: foundStudent.code,
        studentId: foundStudent.code,
        subject: subjectRef,
        score: score,
        examTitle: 'Saisie AI — ' + subjectRef,
        note: score,
        type: 'note',
        period: String(conf.currentPeriod || conf.CURRENT_PERIOD || 'T1'),
        auth: auth
      };
      var gradeResult = saveManualExamGrade_(gradeObj);
      writeAuditLog_('AI_ADD_SCORE', foundStudent.code, 'Note ' + score + ' en ' + subjectRef, 'p_grades');
      if (gradeResult && gradeResult.success) {
        return { success: true, message: 'Note ' + score + ' enregistrée pour ' + foundStudent.name + ' en ' + subjectRef + '.' };
      }
      return { success: false, error: 'SAVE_FAILED', message: 'Échec de l\'enregistrement: ' + JSON.stringify(gradeResult) };
    }

    // ── BLOCK USER / STUDENT ──────────────────────────────────────────────────
    if (cmd === 'block_user' || cmd === 'unblock_user') {
      var canBlock = viewer.isMaster || viewer.isGodMode ||
        perms.pa_edit_student || perms.p_staff || perms.pa_save_settings;
      if (!canBlock) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission pa_edit_student requise pour bloquer/débloquer un compte.' };

      var userRef = String(command.userRef || '').trim();
      if (!userRef) return { success: false, error: 'MISSING_PARAMS', message: 'Identifiant utilisateur requis.' };

      var isBlock = cmd === 'block_user';
      var newStatus = isBlock ? 'INACTIVE' : 'ACTIVE';

      // Try students sheet first
      var studSS = getSS_();
      var studSh = studSS.getSheetByName('students');
      var updated = false;
      var targetName = userRef;
      if (studSh) {
        var sData = studSh.getDataRange().getValues();
        var sH = sData[0].map(function(v) { return String(v).trim(); });
        var iSCode = sH.indexOf('StudentCode'); if (iSCode === -1) iSCode = sH.indexOf('StudentID');
        var iSFirst = sH.indexOf('FirstName'); var iSLast = sH.indexOf('LastName');
        var iStatus = sH.findIndex ? sH.findIndex(function(h) { return /status|is_active|isactive/i.test(h); }) : -1;
        if (iStatus === -1) { for (var si=0;si<sH.length;si++) { if (/status|is_active/i.test(sH[si])) { iStatus=si; break; } } }
        var uRefLow = userRef.toLowerCase();
        for (var sr = 1; sr < sData.length; sr++) {
          var sCode = String(sData[sr][iSCode] || '').toLowerCase();
          var sFull = ((String(sData[sr][iSFirst] || '') + ' ' + String(sData[sr][iSLast] || '')).trim()).toLowerCase();
          if (sCode === uRefLow || sFull.indexOf(uRefLow) !== -1) {
            if (iStatus !== -1) { studSh.getRange(sr + 1, iStatus + 1).setValue(newStatus); }
            targetName = (String(sData[sr][iSFirst] || '') + ' ' + String(sData[sr][iSLast] || '')).trim() || userRef;
            updated = true;
            break;
          }
        }
      }
      // Also try users/staff sheet
      if (!updated) {
        var staffSh = studSS.getSheetByName('users') || studSS.getSheetByName('staff');
        if (staffSh) {
          var sfData = staffSh.getDataRange().getValues();
          var sfH = sfData[0].map(function(v) { return String(v).trim(); });
          var iSfEmail = sfH.findIndex ? sfH.findIndex(function(h) { return /email/i.test(h); }) : -1;
          if (iSfEmail === -1) { for (var si=0;si<sfH.length;si++) { if (/email/i.test(sfH[si])) { iSfEmail=si; break; } } }
          var iSfStatus = -1; for (var si=0;si<sfH.length;si++) { if (/status|is_active/i.test(sfH[si])) { iSfStatus=si; break; } }
          var uRL = userRef.toLowerCase();
          for (var sfr = 1; sfr < sfData.length; sfr++) {
            var sfEmail = String(sfData[sfr][iSfEmail] || '').toLowerCase();
            if (sfEmail.indexOf(uRL) !== -1 || uRL.indexOf(sfEmail.split('@')[0] || '') !== -1) {
              if (iSfStatus !== -1) { staffSh.getRange(sfr + 1, iSfStatus + 1).setValue(newStatus); }
              updated = true;
              break;
            }
          }
        }
      }
      writeAuditLog_(isBlock ? 'AI_BLOCK_USER' : 'AI_UNBLOCK_USER', userRef, (isBlock ? 'Bloqué' : 'Débloqué') + ' via AI', 'pa_edit_student');
      if (updated) return { success: true, message: (isBlock ? 'Compte bloqué' : 'Compte débloqué') + ' pour ' + targetName + '.' };
      return { success: false, error: 'USER_NOT_FOUND', message: 'Utilisateur introuvable: ' + userRef };
    }

    // ── ASSIGN TEACHER ────────────────────────────────────────────────────────
    if (cmd === 'assign_teacher') {
      var canAssign = viewer.isMaster || viewer.isGodMode || perms.p_staff || perms.pa_save_settings;
      if (!canAssign) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission p_staff requise pour affecter un enseignant.' };

      var teacherRef = String(command.teacherRef || '').trim();
      var classRef   = String(command.classRef || '').trim();
      var subjectRef = String(command.subjectRef || '').trim();
      if (!teacherRef || !classRef) return { success: false, error: 'MISSING_PARAMS', message: 'Enseignant et classe requis pour l\'affectation.' };

      var entry = {
        teacherEmail: teacherRef,
        teacherName: teacherRef,
        className: classRef,
        subject: subjectRef || '*',
        academicYear: String(conf.ACADEMIC_YEAR || conf.academicYear || new Date().getFullYear()),
        assignedBy: viewer.email,
        assignedAt: new Date().toISOString()
      };
      var assignResult = saveStaffAssignment_(entry, auth);
      writeAuditLog_('AI_ASSIGN_TEACHER', teacherRef, classRef + ' — ' + (subjectRef || 'Toutes matières'), 'p_staff');
      if (assignResult && assignResult.success) {
        return { success: true, message: teacherRef + ' affecté(e) à ' + classRef + (subjectRef ? ' pour ' + subjectRef : '') + '.' };
      }
      return { success: false, error: 'ASSIGN_FAILED', message: 'Échec de l\'affectation: ' + JSON.stringify(assignResult) };
    }

    // ── SET ALARM / ALERT ─────────────────────────────────────────────────────
    if (cmd === 'set_alarm') {
      var canAlarm = viewer.isMaster || viewer.isGodMode || perms.p_attendance || perms.pa_save_settings;
      if (!canAlarm) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission p_attendance requise pour configurer une alarme.' };

      var alarmDesc = String(command.alarmDesc || '').trim();
      // Parse attendance threshold from description
      var threshMatch = alarmDesc.match(/(\d+)/);
      var threshold = threshMatch ? Number(threshMatch[1]) : 3;
      var classMatch = alarmDesc.match(/([A-Z]{2}\d|Maternelle|Fondamental|Secondaire|NS\d|\dAF)/i);
      var targetClass = classMatch ? classMatch[1] : '*';

      // Save alarm config via settings
      var existingAlarms = [];
      try { existingAlarms = JSON.parse(conf.ATTENDANCE_ALARMS_JSON || '[]'); } catch(_) {}
      existingAlarms.push({
        id: Utilities.getUuid(),
        desc: alarmDesc,
        class: targetClass,
        threshold: threshold,
        createdBy: viewer.email,
        createdAt: new Date().toISOString(),
        active: true
      });
      var alarmResult = _updateSettingsViaAi_('ATTENDANCE_ALARMS_JSON', JSON.stringify(existingAlarms), viewer, { auth: auth });
      writeAuditLog_('AI_SET_ALARM', targetClass, alarmDesc, 'p_attendance');
      if (alarmResult && alarmResult.success) {
        return { success: true, message: 'Alarme configurée: ' + alarmDesc + ' (seuil: ' + threshold + ', classe: ' + targetClass + ').' };
      }
      return { success: false, error: 'ALARM_FAILED', message: 'Échec de la configuration de l\'alarme.' };
    }

    // ── SETUP SUBJECTS ────────────────────────────────────────────────────────
    if (cmd === 'setup_subjects') {
      var canSetup = viewer.isMaster || viewer.isGodMode || perms.p_settings || perms.pa_save_settings;
      if (!canSetup) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission p_settings requise pour configurer les matières.' };

      var cycleRef = String(command.cycleRef || '').trim().toLowerCase();
      // Map cycle ref to registry key
      var cycleKeyMap = {
        maternelle:'mat', mat:'mat',
        fondamental:'fond', fond:'fond', primaire:'fond',
        secondaire:'sec', sec:'sec', lycee:'sec',
        'uni_licence':'uni_licence', licence:'uni_licence',
        'uni_master':'uni_master', master:'uni_master',
        'prof_cert':'prof_cert', certificat:'prof_cert',
        'prof_dip':'prof_dip', diplome:'prof_dip'
      };
      var regKey = cycleKeyMap[cycleRef] || null;
      var result = initAiConfigurationLibrary_({ force: false }, auth);
      writeAuditLog_('AI_SETUP_SUBJECTS', cycleRef || 'all', 'Configuration matières via AI', 'pa_save_settings');
      if (result && result.success) {
        var subjectCount = 0;
        if (regKey && FRONTEND_CURRICULUM_.registry[regKey]) {
          subjectCount = Object.keys(FRONTEND_CURRICULUM_.registry[regKey]).length;
        }
        return { success: true, message: 'Matières initialisées depuis le registre frontend' + (cycleRef ? ' pour ' + cycleRef : '') + (subjectCount ? ' (' + subjectCount + ' matières)' : '') + '.' };
      }
      return { success: false, error: 'SETUP_FAILED', message: 'Échec: ' + (result && result.error ? result.error : 'inconnu') };
    }

    // ── CREATE SUBJECT ────────────────────────────────────────────────────────
    if (cmd === 'create_subject') {
      var canCreate = viewer.isMaster || viewer.isGodMode || perms.p_settings || perms.pa_save_settings;
      if (!canCreate) return { success: false, error: 'PERMISSION_DENIED', message: 'Permission p_settings requise pour créer une matière.' };

      var subjName = String(command.subjectName || '').trim();
      var subjCycle = String(command.cycleRef || '').trim();
      var subjCoeff = command.coeff != null ? Number(command.coeff) : 100;
      if (!subjName) return { success: false, error: 'MISSING_PARAMS', message: 'Nom de la matière requis.' };

      var createResult = createSubject_({ name: subjName, label: subjName, cycle: subjCycle, coeff: subjCoeff }, auth);
      writeAuditLog_('AI_CREATE_SUBJECT', subjName, subjCycle + ' coeff=' + subjCoeff, 'pa_save_settings');
      if (createResult && createResult.success) {
        return { success: true, message: 'Matière "' + subjName + '" créée pour ' + (subjCycle || 'cycle non spécifié') + ' (coeff: ' + subjCoeff + ').' };
      }
      return { success: false, error: 'CREATE_FAILED', message: 'Échec création matière: ' + JSON.stringify(createResult) };
    }

    // ── LEGACY COMMANDS ───────────────────────────────────────────────────────
    if (cmd === 'deploy_system') {
      return _deploySystemConfiguration_(viewer, { what: command.what || 'all' });
    }
    if (cmd === 'extract_curriculum_ocr') {
      var files = (payload && Array.isArray(payload.attachmentsData)) ? payload.attachmentsData : [];
      var attachmentNames = (payload && Array.isArray(payload.attachments)) ? payload.attachments : [];
      var file = files.find(function(f) { return f && String(f.dataBase64 || '').trim(); });
      if (!file) {
        var hasNamedAttachment = attachmentNames.some(function(name){ return String(name || '').trim(); });
        return {
          success: false,
          error: 'IMAGE_REQUIRED',
          message: hasNamedAttachment
            ? 'Pièce jointe détectée, mais fichier non exploitable pour OCR. Utilisez une image/PDF du bulletin (max 8 Mo), puis renvoyez.'
            : 'Ajoutez une photo ou un PDF du bulletin avec le bouton + pour extraire les matières automatiquement.',
          command: 'extract_curriculum_ocr'
        };
      }
      var levelHint = String((command && command.level) || 'unknown').trim();
      var mediaType = String(file.mediaType || file.type || '').toLowerCase();
      var base64Data = String(file.dataBase64 || '').trim();
      var extraction = null;
      if (mediaType.indexOf('application/pdf') === 0) {
        extraction = _extractCurriculumFromPdf_(base64Data, levelHint, viewer);
      } else if (mediaType.indexOf('image/') === 0) {
        extraction = _extractCurriculumFromImage_(base64Data, levelHint, viewer);
      } else {
        return { success: false, error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Format non supporté. Utilisez une image ou un PDF pour l\'extraction curriculum.', command: 'extract_curriculum_ocr' };
      }
      if (!extraction || extraction.success === false) {
        return extraction || { success: false, error: 'EXTRACTION_FAILED', message: 'Échec de lecture du document. Essayez une image/PDF plus net.' };
      }
      var subjectLines = (extraction.subjects || []).slice(0, 20).map(function(s) {
        var name = String((s && (s.subject || s.label || s.id)) || '').trim();
        var coeff = Number((s && (s.coeff || s.coefficient || s.weight || s.points)) || 0);
        if (!name) return '';
        return coeff > 0 ? (name + ' (coeff: ' + coeff + ')') : name;
      }).filter(Boolean);
      return {
        success: true,
        command: 'extract_curriculum_ocr',
        extracted: extraction.subjects || [],
        message: subjectLines.length
          ? ('Lecture terminée. Matières détectées: ' + subjectLines.join(', ') + '.')
          : 'Lecture terminée, mais aucune matière exploitable détectée.'
      };
    }
    if (cmd === 'verify_divisor') return _verifyBulletinDivisor_(command.level || '', viewer, conf);
    if (cmd === 'update_divisor') {
      var divisorJson = conf && conf['BULLETIN_DIVISOR_RULES_JSON'] ? conf['BULLETIN_DIVISOR_RULES_JSON'] : '{}';
      var divisorConfig = typeof divisorJson === 'string' ? (function() { try { return JSON.parse(divisorJson); } catch(_) { return {}; } })() : divisorJson;
      if (!divisorConfig.levels) divisorConfig.levels = {};
      var levelMap = { 'NS4':'sec_ns4','NS3':'sec_ns3','NS2':'sec_ns2','NS1':'sec_ns1','SECONDAIRE':'sec_ns4','PRIMAIRE':'primaire','FONDAMENTAL':'fondamental','MATERNELLE':'maternelle' };
      var lookupKey = levelMap[String(command.level || '').toUpperCase()] || String(command.level || '').toLowerCase();
      var oldVal = divisorConfig.levels[lookupKey] ? divisorConfig.levels[lookupKey].annual : null;
      if (!divisorConfig.levels[lookupKey]) divisorConfig.levels[lookupKey] = { annual: 0, periods: {} };
      divisorConfig.levels[lookupKey].annual = command.value || 0;
      var dresult = _updateSettingsViaAi_('BULLETIN_DIVISOR_RULES_JSON', JSON.stringify(divisorConfig), viewer, { auth: auth });
      if (dresult.success) return { success: true, level: command.level, message: command.level + ': diviseur annuel mis à jour de ' + (oldVal || '?') + ' à ' + (command.value || 0), oldValue: oldVal, newValue: command.value };
      return dresult;
    }
    if (cmd === 'verify_academic_year') return _verifyAcademicYear_(viewer, conf);
    if (cmd === 'verify_settings') return _verifySettings_(viewer, conf);

    return null;
  } catch (e) {
    return { success: false, error: e.message, command: command.command, message: 'Erreur lors de l\'exécution de la commande: ' + e.message };
  }
}

function handleAiChatProxy_(payload, auth) {
  try {
    // ── 1. AUTH + PERMISSION CHECK ─────────────────────────────────────────
    const viewer = getViewerInfo_(auth || {});
    if (!viewer || !viewer.success)
      return { success: false, error: 'SESSION_EXPIREE' };
    var perms = viewer.permissions || {};
    if (!perms.p_use_ai && !viewer.isMaster && !viewer.isGodMode)
      return { success: false, error: 'PERMISSION_REFUSEE', message: 'Permission p_use_ai requise.' };

    // ── 2. REJECT CLIENT-SUPPLIED KEYS ────────────────────────────────────
    if (_containsClientAiSecret_(payload)) {
      writeAuditLog_('AI_CLIENT_SECRET_REJECTED', 'IA',
        'Client attempted to send AI key material', 'p_use_ai', true);
      return { success: false, error: 'CLIENT_KEY_FORBIDDEN' };
    }

    // ── INITIALIZE PROXY CONTEXT ──────────────────────────────────────────
    // Proxy context holds session memory (no global collision)
    var proxyContext = (payload && payload._proxyContext) || {};
    var startNewChat = !!(payload && (payload.newChat || payload.resetChat || payload.resetConversation));
    if (startNewChat) proxyContext = {};
    var requestedConversationId = String((payload && payload.conversationId) || (proxyContext && proxyContext.conversationId) || '').trim();
    var conversationId = _resolveAiConversationId_(viewer.email, requestedConversationId, startNewChat);
    proxyContext.conversationId = conversationId;

    // ── SCHOOL QUOTAS (daily / session / monthly) ───────────────────────
    var quotaIsPro = _isAiProAccessEnabled_();
    var quotaLimits = _getAiQuotaLimits_(quotaIsPro);
    if (quotaLimits.resetSession) {
      conversationId = _resolveAiConversationId_(viewer.email, '', true);
      proxyContext.conversationId = conversationId;
    }
    var quotaScope = _getAiTokenScope_();
    var usedTodayBefore = _getAiTodayTokenUsage_(quotaScope);
    var usedMonthBefore = _getAiMonthTokenUsage_(quotaScope);
    var usedSessionBefore = _getAiSessionTokenUsage_(viewer.email, conversationId);
    if (quotaLimits.daily > 0 && usedTodayBefore >= quotaLimits.daily) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED',
        quota: true,
        quotaType: 'DAILY',
        message: 'Quota journalier atteint pour cette école.',
        usage: { daily: usedTodayBefore, session: usedSessionBefore, monthly: usedMonthBefore },
        limits: quotaLimits
      };
    }
    if (quotaLimits.session > 0 && usedSessionBefore >= quotaLimits.session) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED',
        quota: true,
        quotaType: 'SESSION',
        message: 'Quota de session atteint pour cette conversation.',
        usage: { daily: usedTodayBefore, session: usedSessionBefore, monthly: usedMonthBefore },
        limits: quotaLimits
      };
    }
    if (quotaLimits.monthly > 0 && usedMonthBefore >= quotaLimits.monthly) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED',
        quota: true,
        quotaType: 'MONTHLY',
        message: 'Quota mensuel atteint pour cette école.',
        usage: { daily: usedTodayBefore, session: usedSessionBefore, monthly: usedMonthBefore },
        limits: quotaLimits
      };
    }
    
    // ── SYSTEM SCOPE CHECK ────────────────────────────────────────────────
    // All messages are allowed - AI can handle any request the user has permissions for.
    // No external question rejection; permission checks happen at execution time.
    var userMessage = String((payload && payload.message) || '').trim();

    // ── DETECT TASK RIGOR & SELECT MODEL ──────────────────────────────────
    // Intelligently choose model based on task complexity
    var taskRigor = _detectTaskRigor_(userMessage, payload);
    var allModels = _resolveAllAvailableAiModels_();
    var selectedModel = _selectModelForTask_(taskRigor, allModels);
    
    if (!selectedModel || !selectedModel.apiKey) {
      // Fallback to legacy method if no models available
      var runtime = null;
      var isPersonalKey = false;
      var userCfg = _getUserAiConfig_();
      if (userCfg && userCfg.apiKey) {
        runtime = {
          provider: userCfg.provider || 'anthropic',
          apiKey:   userCfg.apiKey,
          model:    userCfg.model || SERVER_AI_DEFAULT_MODEL_,
          apiUrl:   userCfg.apiUrl || SERVER_AI_DEFAULT_API_URL_
        };
        isPersonalKey = true;
      } else {
        runtime = _resolveServerAiConfig_();
      }

      if (!runtime || !runtime.apiKey)
        return { success: false, error: 'CLE_API_SERVEUR_NON_CONFIGUREE' };
    } else {
      // Use the newly selected model
      var runtime = {
        provider: selectedModel.provider,
        apiKey: selectedModel.apiKey,
        model: selectedModel.name,
        apiUrl: selectedModel.provider === 'openai' 
          ? 'https://api.openai.com/v1/chat/completions'
          : (selectedModel.provider === 'google' 
            ? 'https://generativelanguage.googleapis.com/v1beta/models/' + selectedModel.name + ':generateContent'
            : SERVER_AI_DEFAULT_API_URL_),
        cost: selectedModel.cost,
        speed: selectedModel.speed,
        reasoning: selectedModel.reasoning
      };
      var isPersonalKey = false;
    }

    var maxTokens = isPersonalKey ? 600 : 220;
    var ctx = (payload && payload.context) || {};
    var serverContext = _buildServerAiContext_(viewer, payload || {}, auth);
    ctx = Object.assign({}, ctx || {}, serverContext || {});
    // Pass the user message to context so the system prompt can adapt data verbosity
    ctx._message = userMessage;
    if ((ctx.isGodMode || ctx.isAdmin || viewer.isGodMode || viewer.isMaster) && maxTokens < 500) {
      maxTokens = 500;
    }
    // Detect queries that return lists or data — these need more tokens to avoid cut-off answers
    var isDataQuery = /liste|affiche|montre|tous\s+les|toutes\s+les|rapport|récapitulatif|tableau|élèves\s+de|étudiants\s+de|notes\s+de|présences\s+de|paiements\s+de|historique/i.test(userMessage);
    // Bulletin / student detail queries need full data — raise token floor
    var isBulletinQuery = /bulletin|relev[eé]|fiche\s+[eé]l[eè]ve|g[eé]n[eé]r|cr[eé]er.*bulletin|note.*[eé]l[eè]ve|[eé]l[eè]ve.*note|score|moyenne|r[eé]sultat/i.test(userMessage);
    // Curriculum/programme dumps emit a full [CURRICULUM_DISPLAY] JSON block
    // which can run several thousand tokens — never cap them tightly.
    var curriculumKeywordRe = /curriculum|programme|mati[eè]res?|coefficient|branch|secondaire|fondamental|maternelle|NS[0-9]|sec_ns[0-9]|[0-9](?:e|ème)\s*ann[eé]e|subjects?/i;
    var isCurriculumQuery = curriculumKeywordRe.test(userMessage);
    // Follow-up phrasing like "show me", "I'd like to see them", "list them",
    // "déploie-les", "affiche-les", "voir" doesn't carry the keyword — promote
    // it to a curriculum query when the recent history was about curriculum
    // (e.g. AI just listed sec_ns levels or emitted [CURRICULUM_DISPLAY]).
    if (!isCurriculumQuery) {
      var isShowFollowup = /\b(see|show|display|view|list|voir|affiche|montre|d[ée]ploie|deploy|liste)\b/i.test(userMessage)
        || /\bthem\b|\bles\b/i.test(userMessage);
      if (isShowFollowup && Array.isArray(payload && payload.history)) {
        var recent = payload.history.slice(-4);
        for (var __h = 0; __h < recent.length; __h++) {
          var __t = String((recent[__h] && (recent[__h].text || recent[__h].content)) || '');
          if (curriculumKeywordRe.test(__t) || /\[CURRICULUM_DISPLAY\]/i.test(__t)) {
            isCurriculumQuery = true;
            break;
          }
        }
      }
    }
    // Curriculum registry snapshot in payload = client is on the curriculum view
    if (!isCurriculumQuery && payload && payload.curriculumRegistrySnapshot
        && typeof payload.curriculumRegistrySnapshot === 'object'
        && Object.keys(payload.curriculumRegistrySnapshot).length) {
      // Only flag if user message is plausibly about it (avoid false positives
      // on unrelated questions while the curriculum view happens to be open)
      if (/\b(this|that|these|those|ceux|celle|cela|ça|here|ici|above|dessus)\b/i.test(userMessage)
          || userMessage.split(/\s+/).length <= 8) {
        isCurriculumQuery = true;
      }
    }
    var isConversationalQuery = !isDataQuery && !isCurriculumQuery && (taskRigor <= 3 ||
      /^(combien|quel|qui est|c'est quoi|donne.moi|dis.moi|qu'est.ce)/i.test(userMessage));
    if (isConversationalQuery && !deepReasoning && maxTokens > 180) {
      maxTokens = Math.min(maxTokens, 140);
    }
    // Data/list queries get a reasonable token floor so answers don't get cut off
    if (isDataQuery && maxTokens < 400) {
      maxTokens = 400;
    }
    // Bulletin / student detail queries need tokens for full structured response
    if (isBulletinQuery && maxTokens < 600) {
      maxTokens = 600;
    }
    // Curriculum displays need a much higher ceiling — full Secondaire JSON
    // with branches across 4 levels can run 3000+ tokens.
    if (isCurriculumQuery && maxTokens < 3500) {
      maxTokens = 3500;
    }

    // ── DEEP REASONING MODE (optional) ────────────────────────────────────
    var deepReasoning = !!(payload && (payload.deepReasoning || (payload.context && payload.context.deepReasoning)));
    var canUseDeep = isPersonalKey || ctx.isGodMode || ctx.isAdmin || viewer.isGodMode || viewer.isMaster;
    if (deepReasoning && !canUseDeep) deepReasoning = false;
    var thinkingBudget = 0;
    if (deepReasoning && (runtime.provider === 'anthropic' || !runtime.provider)) {
      runtime.model = 'claude-sonnet-4-5';
      thinkingBudget = 2000;
      maxTokens = Math.max(maxTokens, thinkingBudget + 1500);
    }

    var needsHomework = /devoir|homework|exercise|exercice/i.test(userMessage);
    
    // ── CONFIGURATION SESSION ────────────────────────────────────────────
    // Manage interactive configuration with memory
    var configSession = _getConfigurationSession_(viewer.email);
    var configMemory = _getConfigurationMemory_(viewer.email);
    var isDirectPedagogical = /partie.?pedagogique|curriculum|mati[eè]re|coefficient|bulletin|niveau/i.test(userMessage);
    
    // Initialize if needed (on first message or if not in progress)
    if (!configSession || configSession.status !== 'in_progress') {
      configSession = _createConfigurationSession_(viewer);
      configMemory = {};
      
      // Detect direct configuration intent and update session
      if (isDirectPedagogical) {
        configSession.currentSection = 'curriculum';
        _updateConfigurationSession_(viewer.email, { currentSection: 'curriculum' });
      }
    }
    
    // Check if user is in configuration mode
    var isConfigMode = /configure|setup|deploy|initialiser|initialize|help|aide|bloqué|stuck|parametr|configur/i.test(userMessage);

    // Detect direct pedagogical configuration
    if (isDirectPedagogical && !configSession) {
      // Create session with curriculum section
      configSession = _createConfigurationSession_(viewer, userMessage);
      configMemory = {};
      isConfigMode = true;
    }
    
    // If in config mode, enhance context with session memory
    if (isConfigMode && proxyContext) {
      var sessionMemory = _getSessionMemory_(proxyContext);
      var currentStatus = _buildSettingsConfigurationStatus_(viewer);
      if (ctx && typeof ctx === 'object') {
        ctx.configurationMode = true;
        ctx.configurationMemory = sessionMemory.answers || {};
        ctx.configurationCurrentState = currentStatus.lines || [];
        ctx.configurationMissingKeys = currentStatus.missingKeys || [];
        if (isDirectPedagogical) {
          ctx.configurationPrompt = 'Configuration directe du curriculum pédagogique demandée. Commence par poser les questions de base: niveaux scolaires (Maternelle, Fondamental, Secondaire), matières principales, et coefficients.';
        } else if (!ctx.configurationPrompt) {
          ctx.configurationPrompt = 'Donne d\'abord l\'état actuel depuis la configuration du système, puis propose la prochaine question/action de configuration.';
        }
      }
    }
    
    // ── LANGUAGE DETECTION ────────────────────────────────────────────────
    // Detect user's language and respond in the same language
    var preferredLanguage = String(
      (payload && (payload.preferredLanguage || payload.language))
      || (payload && payload.context && payload.context.userLanguage)
      || ''
    ).toLowerCase().trim();
    var detectedLanguage = /^(fr|en|es)$/.test(preferredLanguage)
      ? preferredLanguage
      : _detectUserLanguage_(userMessage);
    var languageInstruction = _getLanguageInstruction_(detectedLanguage);

    // ── AI COMMAND EXECUTION (Structured commands like "vérifie diviseur NS4") ──
    // Parse for structured commands in the user message before sending to AI model
    var aiCommand = _parseAiCommand_(userMessage);
    if (!aiCommand) {
      var attachmentNamesForOcr = (payload && Array.isArray(payload.attachments)) ? payload.attachments : [];
      var hasNamedAttachmentForOcr = attachmentNamesForOcr.some(function(name){ return String(name || '').trim(); });
      var hasAttachmentForOcr = !!(payload && Array.isArray(payload.attachmentsData) && payload.attachmentsData.some(function(f){
        var mt = String((f && (f.mediaType || f.type)) || '').toLowerCase();
        return String((f && f.dataBase64) || '').trim() && (mt.indexOf('image/') === 0 || mt.indexOf('application/pdf') === 0);
      }));
      var ocrIntent = /pi[eè]ce|jointe|upload|import|bulletin|photo|image|pdf|mati[eè]re|curriculum|coeff|coefficient|analyse|extrait/i.test(userMessage);
      if (hasAttachmentForOcr || (hasNamedAttachmentForOcr && ocrIntent)) {
        var levelsForAttachment = _extractCurriculumLevelsFromMessage_(userMessage || '');
        aiCommand = {
          command: 'extract_curriculum_ocr',
          level: (levelsForAttachment && levelsForAttachment[0]) || 'unknown',
          raw: userMessage
        };
      }
    }
    var commandResult = null;
    
    if (aiCommand) {
      // Build config for command execution
      var commandConf = getSaaSSettings_(viewer.email, new Date().getFullYear());
      commandResult = _executeAiCommand_(aiCommand, viewer, commandConf || {}, auth, payload || {});
      
      if (commandResult && commandResult.success) {
        writeAuditLog_('AI_COMMAND_EXECUTED', aiCommand.command, 
          JSON.stringify(commandResult).substring(0, 200), 'p_use_ai');
        var commandReply = _sanitizeMeigensOutput_(_sanitizeAiUserFacingReply_(commandResult.message || ''));
        
        // Return command result directly without calling AI model
        return {
          success: true,
          reply: commandReply,
          commandExecuted: true,
          command: aiCommand.command,
          commandResult: commandResult,
          model: 'COMMAND_HANDLER',
          language: detectedLanguage
        };
      }
      // For OCR path, return immediate actionable feedback on failure
      // instead of falling through to a slower model call.
      if (commandResult && aiCommand.command === 'extract_curriculum_ocr') {
        var ocrReply = _sanitizeAiUserFacingReply_(String(commandResult.message || 'Impossible de lire ce bulletin pour le moment. Essayez une photo/PDF plus net.'));
        return {
          success: true,
          reply: ocrReply,
          commandExecuted: true,
          command: aiCommand.command,
          commandResult: commandResult,
          model: 'COMMAND_HANDLER',
          language: detectedLanguage
        };
      }
    }

    // Merge client-side curriculumRegistrySnapshot (includes branches) into ctx
    // so the system prompt can reference the full structured data.
    var clientCurriculumSnapshot = (payload && payload.curriculumRegistrySnapshot
      && typeof payload.curriculumRegistrySnapshot === 'object')
      ? payload.curriculumRegistrySnapshot : null;
    if (clientCurriculumSnapshot) {
      ctx.curriculumRegistrySnapshot = clientCurriculumSnapshot;
    }

    var payloadForModel = Object.assign({}, payload || {}, { context: ctx });
    const rawSystemPrompt = _buildAiSystemPromptLean_(viewer, payloadForModel, needsHomework, maxTokens);

    // Split on the cache-split sentinel emitted by _buildAiSystemPromptLean_.
    // The stable prefix (identity, rules, style, capabilities, role) is sent
    // as a cached Anthropic system block; the volatile suffix (live config
    // status, data, language hint) is sent as a separate, non-cached block.
    var __splitIdx = rawSystemPrompt.indexOf('<<<CACHE_SPLIT>>>');
    var stableSystemText, volatileSystemText;
    if (__splitIdx >= 0) {
      stableSystemText   = rawSystemPrompt.slice(0, __splitIdx).replace(/\s+$/, '');
      volatileSystemText = rawSystemPrompt.slice(__splitIdx + '<<<CACHE_SPLIT>>>'.length).replace(/^\s+/, '');
    } else {
      stableSystemText   = rawSystemPrompt;
      volatileSystemText = '';
    }
    var volatileWithLang = (volatileSystemText ? volatileSystemText + '\n' : '') + languageInstruction;

    const systemText = stableSystemText + '\n' + volatileWithLang;
    const systemForAnthropic = volatileSystemText
      ? [
          { type: 'text', text: stableSystemText, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: volatileWithLang }
        ]
      : [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
    const system = systemText;

    // ── 4. HISTORY — sliding window + summarization ───────────────────────
    //    Full-history resend was the #1 cost/latency bottleneck (+40s, +60% tokens).
    //    _applyHistorySlidingWindow_ keeps last 4 messages verbatim and collapses
    //    older exchanges into a one-line summary stored in proxyContext.
    //    Result: ~800 tokens per call vs previous 16,000 for a 20-turn conversation.
    const payloadHistory = Array.isArray(payload && payload.history) ? payload.history : [];
    // Normalize client shape ({role,text}) to server shape ({role,content})
    // so _applyHistorySlidingWindow_ and the empty-content filter don't drop everything.
    const normalizedPayloadHistory = payloadHistory.map(function(m) {
      if (!m || typeof m !== 'object') return null;
      var role = String(m.role || 'user');
      var content = String((m.content != null ? m.content : (m.text != null ? m.text : '')) || '');
      return { role: role, content: content };
    }).filter(function(m) { return m && m.content.trim().length > 0; });
    const persistedHistory = normalizedPayloadHistory.length ? [] : _loadAiConversationMessages_(viewer.email, conversationId, 20);
    const rawHistory = normalizedPayloadHistory.length ? normalizedPayloadHistory : persistedHistory;
    const windowedHistory = _applyHistorySlidingWindow_(rawHistory, proxyContext);
    const msgs = windowedHistory
      .filter(function(m) {
        return m && String(m.content || '').trim().length > 0;
      })
      .concat([(function() {
        // Build content blocks for the current user message (include attachments if any)
        var attachFiles = (payload && Array.isArray(payload.attachmentsData)) ? payload.attachmentsData : [];
        var contentBlocks = [];
        attachFiles.forEach(function(f) {
          if (!f || !String(f.dataBase64 || '').trim()) return;
          var mt = String(f.mediaType || f.type || '').toLowerCase();
          if (mt.indexOf('image/') === 0) {
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mt, data: String(f.dataBase64) }
            });
          } else if (mt === 'application/pdf') {
            contentBlocks.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: String(f.dataBase64) }
            });
          } else if (f.textPreview) {
            contentBlocks.push({
              type: 'text',
              text: '[Fichier: ' + String(f.name || 'document') + ']\n' + String(f.textPreview)
            });
          }
        });
        var textBlock = { type: 'text', text: userMessage.slice(0, 800) };
        if (contentBlocks.length > 0) {
          contentBlocks.push(textBlock);
          return { role: 'user', content: contentBlocks };
        }
        return { role: 'user', content: userMessage.slice(0, 800) };
      })()]);

    // ── 5. FETCH WITH EXPLICIT DEADLINE ───────────────────────────────────
    //    FIX: UrlFetchApp has no built-in timeout parameter but we can
    //    control latency by using a cheaper/faster model as default
    //    and keeping max_tokens low for conversational replies.
    var resp;
    var effectiveModel = runtime.model || SERVER_AI_DEFAULT_MODEL_;

    if (runtime.provider === 'anthropic') {
      var anthropicBodyObj = {
        model:      effectiveModel,
        max_tokens: maxTokens,
        system:     systemForAnthropic,
        messages:   msgs
      };
      if (thinkingBudget > 0) {
        anthropicBodyObj.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        anthropicBodyObj.temperature = 1;
      }
      var anthropicPayload = JSON.stringify(anthropicBodyObj);

      resp = UrlFetchApp.fetch(runtime.apiUrl || SERVER_AI_DEFAULT_API_URL_, {
        method:           'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         runtime.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'prompt-caching-2024-07-31'
        },
        payload:           anthropicPayload,
        muteHttpExceptions: true
      });

      var anthropicStatus  = Number(resp.getResponseCode() || 0);
      var anthropicBody    = String(resp.getContentText() || '');

      // Fallback chain on model-not-found ONLY (not on timeout/server errors)
      var fallbackModels = (SERVER_AI_ANTHROPIC_FALLBACK_MODELS_ || [])
        .filter(function(n) { return !!n && n !== effectiveModel; });

      for (var f = 0; f < fallbackModels.length; f++) {
        if (!_isAnthropicModelNotFound_(anthropicStatus, anthropicBody)) break;
        effectiveModel = String(fallbackModels[f] || '').trim();
        if (!effectiveModel) continue;

        var fallbackBodyObj = {
          model:      effectiveModel,
          max_tokens: maxTokens,
          system:     systemForAnthropic,
          messages:   msgs
        };
        if (thinkingBudget > 0 && /sonnet/i.test(effectiveModel)) {
          fallbackBodyObj.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
          fallbackBodyObj.temperature = 1;
        }

        resp = UrlFetchApp.fetch(runtime.apiUrl || SERVER_AI_DEFAULT_API_URL_, {
          method:           'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         runtime.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'prompt-caching-2024-07-31'
          },
          payload: JSON.stringify(fallbackBodyObj),
          muteHttpExceptions: true
        });
        anthropicStatus = Number(resp.getResponseCode() || 0);
        anthropicBody   = String(resp.getContentText() || '');
      }

      // Claude→Gemini 429 fallback
      if (anthropicStatus === 429) {
        var gemini429Key = _getServerAiSecretByAliases_(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) ||
          _getServerAiSettingByAliases_(['SYSTEM_GEMINI_API_KEY', 'SYSTEM_GOOGLE_API_KEY'], '');
        if (gemini429Key) {
          var gemini429Model = SERVER_AI_GEMINI_DEFAULT_MODEL_LITE_;
          var gemini429Url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(gemini429Model) + ':generateContent?key=' + encodeURIComponent(gemini429Key);
          resp = UrlFetchApp.fetch(gemini429Url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            payload: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: msgs.map(function(m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }; }),
              generationConfig: { maxOutputTokens: maxTokens }
            }), muteHttpExceptions: true
          });
          runtime = Object.assign({}, runtime, { provider: 'google', model: gemini429Model, apiKey: gemini429Key });
          effectiveModel = gemini429Model;
        }
      }

    } else if (runtime.provider === 'openai') {
      effectiveModel = runtime.model || SERVER_AI_OPENAI_DEFAULT_MODEL_;
      var openAiMessages = [{ role: 'system', content: system }].concat(
        msgs.map(function(m) {
          return { role: String(m.role || 'user'), content: String(m.content || '') };
        })
      );
      resp = UrlFetchApp.fetch(runtime.apiUrl || SERVER_AI_OPENAI_DEFAULT_API_URL_, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + runtime.apiKey
        },
        payload: JSON.stringify({
          model:       effectiveModel,
          messages:    openAiMessages,
          max_tokens:  maxTokens,
          temperature: 0.3
        }),
        muteHttpExceptions: true
      });

    } else {
      // Google Gemini
      effectiveModel = runtime.model || SERVER_AI_GEMINI_DEFAULT_MODEL_;
      var geminiUrl  = runtime.apiUrl;
      if (!geminiUrl) {
        geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(effectiveModel) + ':generateContent';
      }
      if (geminiUrl.indexOf('key=') === -1) {
        geminiUrl += (geminiUrl.indexOf('?') === -1 ? '?' : '&') +
          'key=' + encodeURIComponent(runtime.apiKey);
      }

      // Convert Anthropic message format to Gemini format
      // Anthropic: { role: "user" | "assistant", content: string }
      // Gemini: { role: "user" | "model", parts: [{ text: string }] }
      var geminiContents = msgs.map(function(m) {
        var role = m.role === 'assistant' ? 'model' : 'user';
        var text = String(m.content || m.text || '').trim();
        return { role: role, parts: [{ text: text }] };
      });

      var geminiPayload = {
        systemInstruction: { parts: [{ text: system }] },
        contents: geminiContents,
        generationConfig: { maxOutputTokens: maxTokens }
      };

      resp = UrlFetchApp.fetch(geminiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify(geminiPayload),
        muteHttpExceptions: true
      });

      // 429 retry with flash-lite
      if (resp.getResponseCode() === 429 &&
          effectiveModel !== SERVER_AI_GEMINI_DEFAULT_MODEL_LITE_) {
        Utilities.sleep(2000);
        effectiveModel = SERVER_AI_GEMINI_DEFAULT_MODEL_LITE_;
        var liteUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(effectiveModel) + ':generateContent?key=' +
          encodeURIComponent(runtime.apiKey);
        
        resp = UrlFetchApp.fetch(liteUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify(geminiPayload),
          muteHttpExceptions: true
        });
      }
    }

    // ── 6. PARSE RESPONSE ─────────────────────────────────────────────────
    var statusCode = Number(resp.getResponseCode() || 0);
    var rawBody    = String(resp.getContentText() || '');

    // Gemini-first policy: if Gemini fails, retry once with Claude.
    if (statusCode !== 200 && runtime.provider === 'google') {
      writeAuditLog_('AI_GEMINI_FALLBACK_TRIGGERED', 'IA',
        'gemini_failed status=' + statusCode + ' model=' + effectiveModel + ' body=' + rawBody.substring(0, 280),
        'p_use_ai', true);
      var claudeFallbackKey = _getServerAiSecretByAliases_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) ||
        _getServerAiSettingByAliases_(['SYSTEM_ANTHROPIC_API_KEY', 'SYSTEM_CLAUDE_API_KEY'], '') ||
        _getAuthSpreadsheetFallbackAiKey_();
      if (claudeFallbackKey) {
        var fallbackModel = _normalizeAnthropicModel_(SERVER_AI_DEFAULT_MODEL_);
        var fallbackResp = UrlFetchApp.fetch(SERVER_AI_DEFAULT_API_URL_, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': claudeFallbackKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'prompt-caching-2024-07-31'
          },
          payload: JSON.stringify({
            model: fallbackModel,
            max_tokens: maxTokens,
            system: systemForAnthropic,
            messages: msgs
          }),
          muteHttpExceptions: true
        });
        var fallbackStatus = Number(fallbackResp.getResponseCode() || 0);
        if (fallbackStatus === 200) {
          runtime.provider = 'anthropic';
          effectiveModel = fallbackModel;
          statusCode = fallbackStatus;
          rawBody = String(fallbackResp.getContentText() || '');
        }
      }
    }

    if (statusCode !== 200) {
      var bodySnippet = rawBody.substring(0, 280);
      var isQuota     = statusCode === 429;
      writeAuditLog_(
        isQuota ? 'AI_QUOTA_EXCEEDED' : 'AI_API_ERROR', 'IA',
        'provider=' + runtime.provider + ' model=' + effectiveModel +
        ' status=' + statusCode + ' body=' + bodySnippet,
        'p_use_ai', true
      );
      return {
        success:  false,
        error:    isQuota ? 'QUOTA_EXCEEDED' : 'API_ERROR_' + statusCode,
        detail:   bodySnippet,
        provider: runtime.provider,
        model:    effectiveModel,
        quota:    isQuota
      };
    }

    var d     = JSON.parse(rawBody || '{}');
    var reply = '';
    var thinkingText = '';
    var tokensIn = 0, tokensOut = 0;

    if (runtime.provider === 'anthropic') {
      // content is an array of blocks: { type: "thinking" | "text", ... }
      if (d && Array.isArray(d.content)) {
        for (var ci = 0; ci < d.content.length; ci++) {
          var block = d.content[ci] || {};
          if (block.type === 'thinking' && block.thinking) {
            thinkingText += String(block.thinking || '') + '\n';
          } else if (block.type === 'text' || (!block.type && block.text)) {
            reply += String(block.text || '');
          }
        }
        reply = reply.trim();
        thinkingText = thinkingText.trim();
      } else {
        reply = d && d.content && d.content[0]
          ? String(d.content[0].text || '')
          : '';
      }
      // Extract Anthropic token usage
      tokensIn  = (d && d.usage && d.usage.input_tokens)  || 0;
      tokensOut = (d && d.usage && d.usage.output_tokens) || 0;
    } else if (runtime.provider === 'openai') {
      reply = d && d.choices && d.choices[0] && d.choices[0].message
        ? String(d.choices[0].message.content || '')
        : '';
      // Extract OpenAI token usage
      tokensIn  = (d && d.usage && d.usage.prompt_tokens)     || 0;
      tokensOut = (d && d.usage && d.usage.completion_tokens) || 0;
    } else {
      reply = d && d.candidates && d.candidates[0] &&
              d.candidates[0].content &&
              d.candidates[0].content.parts &&
              d.candidates[0].content.parts[0]
        ? String(d.candidates[0].content.parts[0].text || '')
        : '';
      // Extract Gemini token usage
      tokensIn  = (d && d.usageMetadata && d.usageMetadata.promptTokenCount)     || 0;
      tokensOut = (d && d.usageMetadata && d.usageMetadata.candidatesTokenCount) || 0;
    }

    // Record token usage to master auth spreadsheet (AI_Token_Log sheet)
    if (tokensIn || tokensOut) {
      _recordAiTokenUsage_(tokensIn, tokensOut, effectiveModel, runtime.provider, _getAiTokenScope_());
    }

    if (!reply) {
      // Empty reply from Gemini often means SAFETY/RECITATION block or empty candidate.
      // Check finishReason and fall through to Claude if possible.
      var finishReason = '';
      try {
        finishReason = String(
          (d && d.candidates && d.candidates[0] && d.candidates[0].finishReason) || ''
        );
      } catch(_) {}
      if (finishReason && finishReason !== 'STOP' && runtime.provider === 'google') {
        // Treat blocked/empty Gemini response as a provider error → try Claude
        var claudeKeyForEmpty = _getServerAiSecretByAliases_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) ||
          _getServerAiSettingByAliases_(['SYSTEM_ANTHROPIC_API_KEY', 'SYSTEM_CLAUDE_API_KEY'], '') ||
          _getAuthSpreadsheetFallbackAiKey_();
        if (claudeKeyForEmpty) {
          var emptyFallbackResp = UrlFetchApp.fetch(SERVER_AI_DEFAULT_API_URL_, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': claudeKeyForEmpty,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31'
            },
            payload: JSON.stringify({
              model: SERVER_AI_DEFAULT_MODEL_,
              max_tokens: maxTokens,
              system: systemForAnthropic,
              messages: msgs
            }),
            muteHttpExceptions: true
          });
          if (Number(emptyFallbackResp.getResponseCode()) === 200) {
            var ed = JSON.parse(String(emptyFallbackResp.getContentText() || '{}'));
            if (ed && Array.isArray(ed.content)) {
              ed.content.forEach(function(b) { if (b.type === 'text') reply += String(b.text || ''); });
              reply = reply.trim();
            }
            runtime.provider = 'anthropic';
          }
        }
      }
      if (!reply) reply = 'Réponse vide reçue du modèle.';
    }
    reply = _sanitizeMeigensOutput_(_sanitizeAiUserFacingReply_(reply));

    // Persist each turn for cross-session chat continuity until reset.
    try {
      var turnId = Utilities.getUuid();
      _appendAiChatLogEntry_({
        userEmail: viewer.email,
        conversationId: conversationId,
        turnId: turnId,
        role: 'user',
        message: userMessage,
        messageJson: { role: 'user', text: userMessage, at: new Date().toISOString() },
        model: '',
        provider: '',
        tokensIn: 0,
        tokensOut: 0,
        meta: { source: 'handleAiChatProxy_', withContext: !!(payload && payload.withContext) }
      });
      _appendAiChatLogEntry_({
        userEmail: viewer.email,
        conversationId: conversationId,
        turnId: turnId,
        role: 'assistant',
        message: reply,
        messageJson: { role: 'assistant', text: reply, thinking: thinkingText || '', at: new Date().toISOString() },
        model: effectiveModel,
        provider: runtime.provider || '',
        tokensIn: tokensIn,
        tokensOut: tokensOut,
        meta: { deepReasoning: !!deepReasoning, language: detectedLanguage }
      });
    } catch (_persistErr) {}

    writeAuditLog_('AI_CHAT', 'IA',
      String(userMessage).substring(0, 80) + (deepReasoning ? ' [deep]' : '') + ' [Model: ' + runtime.provider + ']', 'p_use_ai');

    // ── UPDATE SESSION MEMORY (PROXY CONTEXT) ────────────────────────────
    // Store answer in proxy context to prevent re-asking in same session
    var isConfigMode = /configure|setup|deploy|initialiser|initialize|help|aide|bloqué|stuck/i.test(userMessage);
    if (isConfigMode && proxyContext) {
      // Extract configuration Q&A for memory
      var configQId = 'config_' + String(userMessage).substring(0, 30);
      _recordInSessionMemory_(proxyContext, configQId, userMessage);
    }

    var result = { success: true, reply: reply };
    if (thinkingText) result.thinking = thinkingText;
    if (deepReasoning) result.deepReasoning = true;
    result.model = effectiveModel;
    result.modelCost = runtime.cost || 1;
    result.modelSpeed = runtime.speed || 5;
    result.modelReasoning = runtime.reasoning || 5;
    result.taskRigor = taskRigor;
    result.language = detectedLanguage;
    result.configurationMode = isConfigMode;
    // Token usage for the banner
    result.tokensIn  = tokensIn;
    result.tokensOut = tokensOut;
    result.tokensTotal = tokensIn + tokensOut;
    result.conversationId = conversationId;
    // Return proxy context for next call (session persistence)
    result._proxyContext = proxyContext;
    return result;

  } catch (e) {
    return { success: false, error: e.message };
  }
}

function studentPortalLogin_(data) {
  try {
    const authDebug = true; // Temporary debug instrumentation for student login mismatch analysis.
    const authDebugTrail = [];
    const dbg = function(label, payload) {
      if (authDebug) {
        authDebugTrail.push({
          ts: new Date().toISOString(),
          label: label,
          data: payload || {}
        });
      }
      if (!authDebug) return;
      try {
        console.log('[AUTH_DEBUG][studentPortalLogin_] ' + label + ' ' + JSON.stringify(payload || {}));
      } catch (_) {
        console.log('[AUTH_DEBUG][studentPortalLogin_] ' + label);
      }
    };
    const withAuthDebug = function(result) {
      if (!authDebug) return result;
      const out = Object.assign({}, result || {});
      out.authDebug = authDebugTrail;
      return out;
    };
    const shortHash = function(v) {
      const s = String(v || '');
      return s ? (s.slice(0, 12) + (s.length > 12 ? '...' : '')) : '';
    };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('students');
    if (!sheet) return { success: false, message: 'Table étudiants introuvable.' };

    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const normHeaders = headers.map(function(h){ return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, ''); });

    const idxCode  = normHeaders.findIndex(function(h){ return h === 'studentcode'; });
    const idxAltId = normHeaders.findIndex(function(h){ return h === 'studentid' || h === 'id'; });
    const idxPin   = normHeaders.findIndex(function(h){ return h === 'pinhash' || h === 'pin'; });
    const idxPhone = normHeaders.findIndex(function(h){ return h === 'parentphone'; });
    const idxPhone2 = normHeaders.findIndex(function(h){ return h === 'phone2'; });
    const rawInputCode = String((data && (data.studentCode || data.code || data.fullId || data.id)) || '').trim();
    const inputCode = (function(){
      const m = rawInputCode.match(/\(([^)]+)\)/);
      return String((m && m[1]) || rawInputCode || '').trim();
    })();
    const inputSecret = String((data && (data.pin || data.secret || data.parentPhone || data.password)) || '').trim();
    const normalizedInputCode = normalizeScopeToken_(inputCode);
    const conf = (getSaaSSettings_ && getSaaSSettings_().data) || {};
    const prefix = String(conf.STUDENT_ID_PREFIX || conf.SYSTEM_ID_PREFIX || 'MT').toUpperCase();

    dbg('incoming', {
      rawInputCode: rawInputCode,
      parsedInputCode: inputCode,
      normalizedInputCode: normalizedInputCode,
      inputSecretLen: inputSecret.length,
      inputSecretDigits: inputSecret.replace(/\D/g, ''),
      prefix: prefix,
      totalRows: values.length - 1,
      columns: {
        idxCode: idxCode,
        idxAltId: idxAltId,
        idxPin: idxPin,
        idxPhone: idxPhone,
        idxPhone2: idxPhone2
      }
    });

    if (idxCode === -1 && idxAltId === -1) return withAuthDebug({ success: false, message: 'Structure invalide.' });
    if (!inputCode || !inputSecret) return withAuthDebug({ success: false, message: 'Identifiants incorrects.' });

    const cellStr_ = function(row, idx) {
      if (idx === -1 || !row || idx >= row.length) return '';
      return String(row[idx] || '').trim();
    };

    const lookupCodes = (function(){
      const set = {};
      const add = function(v){
        const s = String(v || '').trim();
        if (!s) return;
        set[s.toUpperCase()] = true;
        set[normalizeScopeToken_(s)] = true;
      };
      add(inputCode);
      const digitsOnly = String(inputCode).replace(/\D/g, '');
      if (digitsOnly) {
        add(digitsOnly);
        add(prefix + digitsOnly);
        add(prefix + digitsOnly.padStart(4, '0'));
      }
      if (String(inputCode).toUpperCase().startsWith(prefix)) {
        add(String(inputCode).slice(prefix.length));
      }
      return set;
    })();

    dbg('lookupCodes', { keys: Object.keys(lookupCodes).slice(0, 20), count: Object.keys(lookupCodes).length });

    const matchesStudentId_ = function(rowValue) {
      const rowCode = String(rowValue || '').trim();
      if (!rowCode) return false;
      if (rowCode === inputCode) return true;
      if (normalizeScopeToken_(rowCode) === normalizedInputCode) return true;
      const rowNorm = String(rowCode).replace(/\s+/g, '').toUpperCase();
      const inputNorm = String(inputCode).replace(/\s+/g, '').toUpperCase();
      if (rowNorm === inputNorm) return true;
      if (lookupCodes[rowNorm] || lookupCodes[normalizeScopeToken_(rowCode)]) return true;
      if (/^\d+$/.test(inputCode) && rowNorm.endsWith(inputNorm)) return true;
      const rowDigits = rowNorm.replace(/\D/g, '');
      const inputDigits = inputNorm.replace(/\D/g, '');
      if (rowDigits && inputDigits && (rowDigits.endsWith(inputDigits) || inputDigits.endsWith(rowDigits))) return true;
      return false;
    };

    let possibleRows = 0;
    for (let i = 1; i < values.length; i++) {
      const rowCode = cellStr_(values[i], idxCode);
      const rowAltId = cellStr_(values[i], idxAltId);
      if (!rowCode && !rowAltId) continue;
      const byCode = matchesStudentId_(rowCode);
      const byAlt = matchesStudentId_(rowAltId);
      if (!byCode && !byAlt) {
        const rowDigitsOnly = String(rowCode || rowAltId || '').replace(/\D/g, '');
        const inputDigitsOnly = String(inputCode || '').replace(/\D/g, '');
        if (inputDigitsOnly && rowDigitsOnly && (rowDigitsOnly.endsWith(inputDigitsOnly) || inputDigitsOnly.endsWith(rowDigitsOnly))) {
          possibleRows++;
          if (possibleRows <= 5) {
            dbg('nearMatchRow', {
              rowIndex: i + 1,
              rowCode: rowCode,
              rowAltId: rowAltId,
              reason: 'digit-tail-near-match-but-id-match-returned-false'
            });
          }
        }
        continue;
      }

      const dbPin   = cellStr_(values[i], idxPin);
      const dbPhone = cellStr_(values[i], idxPhone).replace(/\D/g, '');
      const dbPhone2 = cellStr_(values[i], idxPhone2).replace(/\D/g, '');
      const inputDigits = inputSecret.replace(/\D/g, '');
      const acceptedPhones = [dbPhone, dbPhone2].filter(Boolean);
      const phoneMatches = acceptedPhones.some(function(phone) {
        const tail = phone.slice(-8);
        return inputDigits && (inputDigits === phone || inputDigits === tail);
      });
      const inputSecretHash = hashPin_(inputSecret);

      dbg('matchedRow', {
        rowIndex: i + 1,
        matchedBy: byCode ? 'StudentCode' : 'StudentID',
        rowCode: rowCode,
        rowAltId: rowAltId,
        dbPinPresent: dbPin !== '',
        dbPinShort: shortHash(dbPin),
        inputHashShort: shortHash(inputSecretHash),
        inputEqualsDbPinRaw: inputSecret === dbPin,
        inputHashEqualsDbPin: inputSecretHash === dbPin,
        phonesStored: acceptedPhones,
        phoneMatch: phoneMatches,
        inputSecretDigits: inputDigits
      });

      // CAS A : PIN already set — compare hashes
      if (dbPin !== '') {
        if (inputSecretHash === dbPin || inputSecret === dbPin) {
          // ✅ Correct: generate + cache token
          const token = Utilities.getUuid();
          const canonicalCode = rowCode || rowAltId;
          CacheService.getScriptCache().put(token, canonicalCode, 21600);
          dbg('success', {
            rowIndex: i + 1,
            mode: 'PIN',
            canonicalCode: canonicalCode
          });
          return withAuthDebug({ success: true, firstTime: false, token: token, studentCode: canonicalCode });
        }
        dbg('mismatch', {
          rowIndex: i + 1,
          reason: 'PIN_MISMATCH',
          dbPinShort: shortHash(dbPin),
          inputHashShort: shortHash(inputSecretHash),
          inputEqualsDbPinRaw: inputSecret === dbPin
        });
      }
      // CAS B : First login — validate against parent phone
      else {
        if (phoneMatches) {
          dbg('success', {
            rowIndex: i + 1,
            mode: 'FIRST_LOGIN_PHONE',
            canonicalCode: rowCode || rowAltId
          });
          return withAuthDebug({ success: true, firstTime: true, studentCode: rowCode || rowAltId });
          // Note: no token yet — frontend must call setupInitialPin_ first,
          // then log in again via CAS A
        }
        dbg('mismatch', {
          rowIndex: i + 1,
          reason: 'FIRST_LOGIN_PHONE_MISMATCH',
          phonesStored: acceptedPhones,
          inputSecretDigits: inputDigits
        });
      }

      // Code matched but credentials wrong — stop searching
      dbg('fail', {
        rowIndex: i + 1,
        reason: 'CODE_MATCHED_CREDENTIAL_FAILED'
      });
      return withAuthDebug({ success: false, message: 'Identifiants incorrects.' });
    }

    dbg('fail', {
      reason: 'CODE_NOT_FOUND',
      possibleRowsByDigits: possibleRows
    });
    return withAuthDebug({ success: false, message: 'Code élève introuvable.' });
  } catch (e) {
    try {
      console.log('[AUTH_DEBUG][studentPortalLogin_] exception ' + String(e && e.stack || e && e.message || e));
    } catch (_) {}
    return { success: false, message: 'Erreur serveur : ' + e.message, authDebug: [{ ts: new Date().toISOString(), label: 'exception', data: { message: String(e && e.message || e) } }] };
  }
}
function parentPortalLogin_(data) {
  try {
    const ss   = getSS_();
    const sh   = ss.getSheetByName('students');
    if (!sh) return { success:false, error:'Base introuvable.' };
    const rows = sh.getDataRange().getValues();
    const h    = rows[0].map(x => String(x).toUpperCase().replace(/\s/g,''));
    const iCode  = h.indexOf('STUDENTCODE');
    const iPhone = h.indexOf('PARENTPHONE');
    const iPhone2 = h.indexOf('PHONE2');
    const iFn    = h.indexOf('FIRSTNAME');
    const iLn    = h.indexOf('LASTNAME');
    const rawInputCode = String((data && (data.studentCode || data.code || data.fullId || data.id)) || '').trim();
    const inputCode = (function(){
      const m = rawInputCode.match(/\(([^)]+)\)/);
      return String((m && m[1]) || rawInputCode || '').trim();
    })();
    const inputPhone = String((data && (data.parentPhone || data.secret || data.pin || data.password)) || '').replace(/\D/g, '');
    const matchesCode = function(storedCode){
      const rowCode = String(storedCode || '').trim();
      if (!rowCode) return false;
      if (rowCode === inputCode) return true;
      if (normalizeScopeToken_(rowCode) === normalizeScopeToken_(inputCode)) return true;
      const rowNorm = rowCode.replace(/\s+/g, '').toUpperCase();
      const inputNorm = inputCode.replace(/\s+/g, '').toUpperCase();
      if (rowNorm === inputNorm) return true;
      if (/^\d+$/.test(inputCode) && rowNorm.endsWith(inputNorm)) return true;
      return false;
    };
    const row = rows.slice(1).find(r =>
      matchesCode(r[iCode]) &&
      (function(){
        const phoneA = String(r[iPhone] || '').replace(/\D/g, '');
        const phoneB = iPhone2 !== -1 ? String(r[iPhone2] || '').replace(/\D/g, '') : '';
        return [phoneA, phoneB].filter(Boolean).some(function(phone){
          return inputPhone && (inputPhone === phone || inputPhone === phone.slice(-8));
        });
      })()
    );
    if (!row) return { success:false, error:'Identifiants parents incorrects.' };
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put(token, String(row[iCode] || '').trim(), 21600);
    return { success:true, studentName:row[iFn]+' '+row[iLn], studentCode:row[iCode], token: token };
  } catch(e) { return { success:false, error:e.message }; }
}

function verifyStudentLogin_(code4, pin) {
  const ss   = getSS_();
  const sh   = ss.getSheetByName('students');
  const data = sh.getDataRange().getValues();
  const h    = data[0].map(x => String(x).trim());
  const iCode= h.indexOf('StudentCode');
  const iPin = h.indexOf('PinHash');
  const iFn  = h.indexOf('FirstName');
  const iLn  = h.indexOf('LastName');
  const row  = data.slice(1).find(r => String(r[iCode]).endsWith(String(code4)));
  if (!row) return { success:false, error:'Identifiant introuvable.' };
  if (hashPin_(pin) !== String(row[iPin]).trim())
    return { success:false, error:'Code PIN incorrect.' };
  return { success:true, student:{ Student_ID:row[iCode], Student_Name:row[iFn]+' '+row[iLn] }};
}

//   Fix : après avoir enregistré le PIN, on génère un token de session
//   et on le met en cache (clé = StudentCode), exactement comme le fait
//   studentPortalLogin_ pour les connexions suivantes.
// ============================================================
function setupInitialPin_(fullId, newPin) {
  try {
    const ss    = getSS_();
    const sh    = ss.getSheetByName('students');
    const data  = sh.getDataRange().getValues();
    const h     = data[0].map(x => String(x).trim());
    const iCode = h.indexOf('StudentCode');
    const iPin  = h.indexOf('PinHash');
 
    if (iCode === -1) return { success: false, error: 'Colonne StudentCode introuvable.' };
    if (iPin  === -1) return { success: false, error: 'Colonne PinHash introuvable.' };
 
    const targetRaw = String(fullId || '').trim();
    const targetNorm = normalizeScopeToken_(targetRaw);
    const targetDigits = targetRaw.replace(/\D/g, '');

    for (let i = 1; i < data.length; i++) {
      const rowCode = String(data[i][iCode] || '').trim();
      const rowNorm = normalizeScopeToken_(rowCode);
      const rowDigits = rowCode.replace(/\D/g, '');
      const idMatch = rowCode === targetRaw
        || rowNorm === targetNorm
        || (targetDigits && rowDigits && (rowDigits.endsWith(targetDigits) || targetDigits.endsWith(rowDigits)));
      if (idMatch) {
        // Enregistrement du PIN hashé
        sh.getRange(i + 1, iPin + 1).setValue(hashPin_(newPin));
 
        // [CORRECTION BUG-3] : génération du token de session
        const token = Utilities.getUuid();
        CacheService.getScriptCache().put(token, rowCode || targetRaw, 21600);
 
        writeAuditLog_('PIN_SETUP', rowCode || targetRaw, 'PIN initial défini', '');
 
        return { success: true, token };
      }
    }
 
    return { success: false, error: 'Identifiant introuvable.' };
 
  } catch (e) {
    return { success: false, error: e.message };
  }
}
 
// ============================================================
// ASSETS / LOGO
// ============================================================
function getOrCreateAssetsFolder_() {
  const name = 'Meigens_SaaS_Assets';
  const it   = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  const f = DriveApp.createFolder(name);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f;
}

function uploadLogoToDriveSecure_(payload, token) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    if (!payload || !payload.base64Data) return { success:false, error:'Aucune donnee image.' };
    let raw = payload.base64Data;
    if (raw.includes(',')) raw = raw.split(',')[1];
    const bytes  = Utilities.base64Decode(raw);
    const blob   = Utilities.newBlob(bytes, payload.mimeType||'image/png', (payload.fileName||'logo')+'_'+Date.now());
    const folder = getOrCreateAssetsFolder_();
    const file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
    updateSaaSSettings_({ name:'SCHOOL_LOGO', value:url }, token);
    return { success:true, fileUrl:url, fileId:file.getId() };
  } catch(e) { return { success:false, error:e.message }; }
  finally { lock.releaseLock(); }
}

function saveUserTheme_(themeData) {
  return updateSaaSSettings_({ name:'ThemeJSON', value:themeData }, null);
}

function clearMeigensConfiguration_() {
  try {
    const ss   = getSS_();
    const sh   = ss.getSheetByName('Settings');
    if (!sh) return { success:false, error:'Settings introuvable.' };
    const data = sh.getDataRange().getValues();
    const keys = ['SCHOOL_NAME','SCHOOL_ADDR','ACADEMIC_YEAR','TOTAL_TERMS','MIN_PASSING_AVG',
                  'PROMOTION_MIN_AVG','MIN_ADJOURN_AVG','BOT_SETUP_STATE'];
    for (let i=data.length-1;i>=0;i--) {
      if (keys.includes(String(data[i][0]).trim())) sh.deleteRow(i+1);
    }
    writeAuditLog_('RESET_CONFIG','SYSTEM','Configuration reinit.','p_settings');
    return { success:true, message:'Systeme pret pour nouvelle configuration.' };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// TIMETABLE
// ============================================================
function getTimetableData_() {
  try {
    const sh = ensureTimetableSheetStructure_(getSS_());
    const data = sh.getDataRange().getValues();
    if (!data || data.length < 2) return { success:true, data: [] };
    const headers = data[0].map(h => String(h || '').trim().toUpperCase());
    const idx = {
      id: headers.indexOf('SLOTID'),
      className: headers.indexOf('CLASSNAME'),
      dayIndex: headers.indexOf('DAYINDEX'),
      dayLabel: headers.indexOf('DAYLABEL'),
      startTime: headers.indexOf('STARTTIME'),
      endTime: headers.indexOf('ENDTIME'),
      subject: headers.indexOf('SUBJECT'),
      teacher: headers.indexOf('TEACHER'),
      teacherId: headers.indexOf('TEACHERID'),
      conflict: headers.indexOf('CONFLICT'),
      active: headers.indexOf('ACTIVE'),
      meta: headers.indexOf('METAJSON')
    };
    const rows = data.slice(1)
      .filter(r => idx.active === -1 || String(r[idx.active] || 'TRUE').toUpperCase() !== 'FALSE')
      .map(r => {
        let meta = {};
        try { meta = JSON.parse(r[idx.meta] || '{}'); } catch (_err) { meta = {}; }
        return {
          id: idx.id > -1 ? String(r[idx.id] || '').trim() : '',
          className: idx.className > -1 ? String(r[idx.className] || '').trim() : '',
          dayIndex: idx.dayIndex > -1 ? Number(r[idx.dayIndex] || 0) : 0,
          dayLabel: idx.dayLabel > -1 ? String(r[idx.dayLabel] || '').trim() : '',
          startTime: idx.startTime > -1 ? String(r[idx.startTime] || '').trim() : '',
          endTime: idx.endTime > -1 ? String(r[idx.endTime] || '').trim() : '',
          subject: idx.subject > -1 ? String(r[idx.subject] || '').trim() : '',
          teacher: idx.teacher > -1 ? String(r[idx.teacher] || '').trim() : '',
          teacherId: idx.teacherId > -1 ? String(r[idx.teacherId] || '').trim() : '',
          conflict: idx.conflict > -1 ? String(r[idx.conflict] || '').toUpperCase() === 'TRUE' : false,
          _meta: meta
        };
      });
    return { success:true, data: rows };
  } catch(e) { return { success:false, error:e.message }; }
}

function saveTimetableData_(payload) {
  try {
    const sh = ensureTimetableSheetStructure_(getSS_());
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload && payload.slots) ? payload.slots : []);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (!rows.length) return { success:true, data: [] };
    const values = rows.map(slot => [
      String(slot.id || 'TT-' + Utilities.getUuid().slice(0, 8)).trim(),
      String(slot.className || '').trim(),
      Number(slot.dayIndex || 0),
      String(slot.dayLabel || '').trim(),
      String(slot.startTime || '').trim(),
      String(slot.endTime || '').trim(),
      String(slot.subject || '').trim(),
      String(slot.teacher || '').trim(),
      String(slot.teacherId || '').trim(),
      slot.conflict ? 'TRUE' : 'FALSE',
      'TRUE',
      new Date(),
      new Date(),
      JSON.stringify(slot._meta || {})
    ]);
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
    return { success:true, data: rows };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// SHEET PROTECTIONS
// ============================================================
function applySheetProtections_() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const owner = _resolveSessionEmailSafe_('');
    if (!owner) return { success:false, error:'OWNER_EMAIL_UNAVAILABLE' };
    ['auditlog',USERS_SHEET_NAME,'grades','Finance'].forEach(n => {
      const sh = ss.getSheetByName(n);
      if (!sh) return;
      sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
      const prot = sh.protect().setDescription('Meigens -- ' + n);
      prot.removeEditors(prot.getEditors());
      prot.addEditor(owner);
    });
    ['students','studenthistory','Settings'].forEach(n => {
      const sh = ss.getSheetByName(n);
      if (!sh) return;
      sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
      sh.protect().setDescription('Meigens -- ' + n + ' (via app)').setWarningOnly(true);
    });
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// KIOSK / UNIFIED DIRECTORY
// ============================================================
function recordAttendance_(logEntry, auth) {
  try {
    const ss      = getSS_();
    const sh      = ss.getSheetByName('attendance');
    const tz      = Session.getScriptTimeZone();
    const dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const histMap = _buildActiveHistoryMap(ss);
    const sId     = String(logEntry.studentId || '').trim().toUpperCase();
    if (sId && auth && auth.token) {
      const guard = ensureViewerCanAccessStudentScope_(sId, auth);
      if (!guard.success) return { success:false, error:guard.error || 'Accès refusé pour ce pointage.' };
    }
    const hist    = histMap[sId];
    const data    = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]];
    const h       = data[0].map(x => String(x).toUpperCase().trim());
    const iSid    = h.indexOf('STUDENTID');
    const iDate   = h.indexOf('DATE');
    for (let i = data.length - 1; i >= 1; i--) {
      const d = data[i][iDate] instanceof Date
        ? Utilities.formatDate(data[i][iDate], tz, 'yyyy-MM-dd')
        : String(data[i][iDate]).slice(0, 10);
      if (String(data[i][iSid]).trim().toUpperCase() === sId && d === dateStr) {
        writeAuditLog_('KIOSK_ATTENDANCE_DUPLICATE', logEntry.studentId || sId, 'mode:' + String(logEntry.mode || 'IN').toUpperCase() + ',time:' + String(logEntry.time || ''), 'p_attendance', true);
        return { success: false, duplicate: true, message: logEntry.name + ' déjà pointé aujourd\'hui.' };
      }
    }
    const meta = JSON.stringify({ method: 'KIOSK', mode: logEntry.mode || 'IN', time: logEntry.time || '' });
    sh.appendRow([
      'ATT-' + Utilities.getUuid().substring(0, 8),
      hist ? hist.historyId : '',
      logEntry.studentId || '',
      hist ? hist.level : (logEntry.level || ''),
      new Date(),
      logEntry.mode === 'OUT' ? 'SORTIE' : 'PRESENT',
      Session.getActiveUser().getEmail() || 'KIOSK',
      meta
    ]);
    const kioskMode = String(logEntry.mode || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    const kioskAction = kioskMode === 'OUT' ? 'KIOSK_EXIT' : 'KIOSK_ENTRY';
    writeAuditLog_(kioskAction, logEntry.studentId || sId, 'mode:' + kioskMode + ',time:' + String(logEntry.time || ''), 'p_attendance');
    // Invalider le cache des rapports comparatifs : la nouvelle présence doit
    // se refléter immédiatement dans le dashboard.
    try { _bumpClassComparisonCacheVersion_(); } catch (_) {}
    // Invalider l'instantané IA pour que les présences soient visibles immédiatement.
    try { _invalidateAiSystemSnapshot_(); } catch (_) {}
    return { success: true };
  } catch(e) {
    try {
      writeAuditLog_('KIOSK_ATTENDANCE_FAIL', String((logEntry && (logEntry.studentId || logEntry.id)) || '').trim() || 'UNKNOWN', e.message, 'p_attendance', true);
    } catch (_ae) {}
    return { success: false, error: e.message };
  }
}

function getUnifiedDirectory_() {
  try {
    const ss      = getSS_();
    const tz      = Session.getScriptTimeZone();
    const today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const directory = [];
    const todayState = {};
    const shAtt = ss.getSheetByName('attendance');
    if (shAtt && shAtt.getLastRow() > 1) {
      const aData = shAtt.getDataRange().getValues();
      const aH    = aData[0].map(h => String(h).toUpperCase().trim());
      const iSid  = aH.indexOf('STUDENTID');
      const iDate = aH.indexOf('DATE');
      const iStat = aH.indexOf('STATUS');
      aData.slice(1).forEach(r => {
        const d = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate], tz, 'yyyy-MM-dd') : String(r[iDate]).slice(0, 10);
        if (d === today) {
          const id = String(r[iSid]).trim().toUpperCase();
          if (!todayState[id]) todayState[id] = { in: false, out: false };
          const st = String(r[iStat]).toUpperCase();
          if (st === 'SORTIE') todayState[id].out = true;
          else todayState[id].in = true;
        }
      });
    }
    const shS = ss.getSheetByName('students');
    if (shS && shS.getLastRow() > 1) {
      const sData = shS.getDataRange().getValues();
      const sH    = sData[0].map(h => String(h).toUpperCase().trim());
      const iCode = sH.indexOf('STUDENTCODE');
      const iFn   = sH.indexOf('FIRSTNAME');
      const iLn   = sH.indexOf('LASTNAME');
      const iLvl  = sH.indexOf('CURRENTLEVEL');
      for (let i = 1; i < sData.length; i++) {
        const id = String(sData[i][iCode]);
        if (!id) continue;
        const short = id.replace(/\D/g, '').slice(-4);
        const state = todayState[id.toUpperCase().trim()];
        directory.push({
          id, type: 'STUDENT', shortCode: short,
          name: ((sData[i][iFn] || '') + ' ' + (sData[i][iLn] || '')).trim(),
          level: sData[i][iLvl] || '',
          hasCheckedIn:  state ? state.in  : false,
          hasCheckedOut: state ? state.out : false
        });
      }
    }
    const shU = ss.getSheetByName(USERS_SHEET_NAME);
    if (shU && shU.getLastRow() > 1) {
      const uData = shU.getDataRange().getValues();
      const uH    = uData[0].map(h => String(h).toUpperCase().trim());
      const iEm   = uH.indexOf('EMAIL');
      const iNm   = uH.indexOf('NAME');
      for (let i = 1; i < uData.length; i++) {
        const email = String(uData[i][iEm]);
        if (!email || !email.includes('@')) continue;
        const hash  = Math.abs(email.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0));
        const short = String(hash).slice(-4).padStart(4, '0');
        const state = todayState[email.toUpperCase().trim()];
        directory.push({
          id: email, type: 'STAFF', shortCode: short,
          name: String(uData[i][iNm] || email.split('@')[0]),
          level: 'STAFF',
          hasCheckedIn:  state ? state.in  : false,
          hasCheckedOut: state ? state.out : false
        });
      }
    }
    return { success: true, data: directory };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function handleTemplateUpload_(data) {
  try {
    let base64 = data.base64.indexOf(',') > -1 ? data.base64.split(',')[1] : data.base64;
    const bytes    = Utilities.base64Decode(base64);
    const metadata = { name: (data.name || 'Bulletin_Meigens').replace(/\.[^/.]+$/, ''), mimeType: 'application/vnd.google-apps.document' };
    const boundary = 'MeigensTech';
    const body =
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: ' + (data.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') + '\r\n\r\n' +
      Utilities.newBlob(bytes).getDataAsString() + '\r\n--' + boundary + '--';
    const resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', contentType: 'multipart/related; boundary="' + boundary + '"',
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: body, muteHttpExceptions: true
    });
    const result = JSON.parse(resp.getContentText());
    if (!result.id) throw new Error(resp.getContentText());
    writeAuditLog_('TEMPLATE_UPLOAD', result.id, 'OK', 'p_settings');
    return { success: true, docId: result.id, message: 'Modele cree.' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * Converts a Google Sheets time cell value to "HH:MM" string.
 * Sheets stores pure-time cells as Date objects anchored to 1899-12-30,
 * or as numeric day-fractions (0..1). Plain "HH:MM" strings pass through.
 */
function sheetTimeToHHMM_(val) {
  if (val === '' || val === null || val === undefined) return '';
  if (val instanceof Date) {
    return String(val.getHours()).padStart(2, '0') + ':' + String(val.getMinutes()).padStart(2, '0');
  }
  if (typeof val === 'number') {
    const totalMin = Math.round(val * 24 * 60);
    return String(Math.floor(totalMin / 60) % 24).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0');
  }
  const s = String(val).trim();
  // Already HH:MM or HH:MM:SS
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  // Full Date string (e.g. toString() of a Date object)
  try { const d = new Date(s); if (!isNaN(d.getTime())) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch(_) {}
  return s;
}

function getStaffAssignments_(auth) {
  try {
    const sh = ensureTeacherAssignmentsSheetStructure_(getSS_());
    const data = sh.getDataRange().getValues();
    if (!data || data.length < 2) return { success: true, data: [] };
    const headers = data[0].map(h => String(h || '').trim().toUpperCase());
    const idx = {
      id: headers.indexOf('ASSIGNMENTID'),
      teacher: headers.indexOf('TEACHERNAME'),
      teacherId: headers.indexOf('TEACHERID'),
      className: headers.indexOf('CLASSNAME'),
      classId: headers.indexOf('CLASSID'),
      subject: headers.indexOf('SUBJECT'),
      day: headers.indexOf('DAY'),
      start: headers.indexOf('STARTTIME'),
      end: headers.indexOf('ENDTIME'),
      hours: headers.indexOf('HOURS'),
      rate: headers.indexOf('RATE'),
      salary: headers.indexOf('SALARY'),
      conflict: headers.indexOf('HASCONFLICT'),
      active: headers.indexOf('ACTIVE'),
      meta: headers.indexOf('METAJSON')
    };
    const assignments = data.slice(1)
      .filter(r => idx.active === -1 || String(r[idx.active] || 'TRUE').toUpperCase() !== 'FALSE')
      .map(r => {
        let meta = {};
        try { meta = JSON.parse(r[idx.meta] || '{}'); } catch (_err) { meta = {}; }
        return {
          id: idx.id > -1 ? String(r[idx.id] || '').trim() : '',
          teacher: idx.teacher > -1 ? String(r[idx.teacher] || '').trim() : '',
          teacherId: idx.teacherId > -1 ? String(r[idx.teacherId] || '').trim() : '',
          className: idx.className > -1 ? String(r[idx.className] || '').trim() : '',
          classId: idx.classId > -1 ? String(r[idx.classId] || '').trim() : '',
          subject: idx.subject > -1 ? String(r[idx.subject] || '').trim() : '',
          day: idx.day > -1 ? String(r[idx.day] || '').trim() : '',
          start: idx.start > -1 ? sheetTimeToHHMM_(r[idx.start]) : '',
          end: idx.end > -1 ? sheetTimeToHHMM_(r[idx.end]) : '',
          hours: idx.hours > -1 ? Number(r[idx.hours] || 0) : 0,
          rate: idx.rate > -1 ? Number(r[idx.rate] || 0) : 0,
          salary: idx.salary > -1 ? Number(r[idx.salary] || 0) : 0,
          hasConflict: idx.conflict > -1 ? String(r[idx.conflict] || '').toUpperCase() === 'TRUE' : false,
          _meta: meta,
          _backendId: idx.id > -1 ? String(r[idx.id] || '').trim() : ''
        };
      });
    return { success: true, data: assignments };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function saveStaffAssignment_(entry, auth) {
  try {
    const sh = ensureTeacherAssignmentsSheetStructure_(getSS_());
    const data = sh.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim().toUpperCase());
    const idx = {
      id: headers.indexOf('ASSIGNMENTID'),
      teacher: headers.indexOf('TEACHERNAME'),
      teacherId: headers.indexOf('TEACHERID'),
      className: headers.indexOf('CLASSNAME'),
      classId: headers.indexOf('CLASSID'),
      subject: headers.indexOf('SUBJECT'),
      day: headers.indexOf('DAY'),
      start: headers.indexOf('STARTTIME'),
      end: headers.indexOf('ENDTIME'),
      hours: headers.indexOf('HOURS'),
      rate: headers.indexOf('RATE'),
      salary: headers.indexOf('SALARY'),
      conflict: headers.indexOf('HASCONFLICT'),
      active: headers.indexOf('ACTIVE'),
      created: headers.indexOf('CREATEDAT'),
      updated: headers.indexOf('UPDATEDAT'),
      meta: headers.indexOf('METAJSON')
    };
    const assignmentId = String(entry.id || entry.assignmentId || 'AFC-' + Utilities.getUuid().slice(0, 8)).trim();
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      const sameId = idx.id > -1 && String(data[i][idx.id] || '').trim() === assignmentId;
      const sameComposite = String(data[i][idx.teacher] || '').trim() === String(entry.teacher || '').trim()
        && String(data[i][idx.className] || '').trim() === String(entry.className || '').trim()
        && String(data[i][idx.subject] || '').trim() === String(entry.subject || '').trim()
        && String(data[i][idx.day] || '').trim() === String(entry.day || '').trim()
        && String(data[i][idx.start] || '').trim() === String(entry.start || '').trim();
      if (sameId || sameComposite) {
        rowIdx = i + 1;
        break;
      }
    }
    const row = new Array(headers.length).fill('');
    row[idx.id] = assignmentId;
    row[idx.teacher] = String(entry.teacher || '').trim();
    if (idx.teacherId > -1) row[idx.teacherId] = String(entry.teacherId || entry.teacher || '').trim();
    row[idx.className] = String(entry.className || '').trim();
    if (idx.classId > -1) row[idx.classId] = String(entry.classId || entry.className || '').trim();
    row[idx.subject] = String(entry.subject || '').trim();
    row[idx.day] = String(entry.day || '').trim();
    row[idx.start] = String(entry.start || '').trim();
    row[idx.end] = String(entry.end || '').trim();
    if (idx.hours > -1) row[idx.hours] = Number(entry.hours || 0);
    if (idx.rate > -1) row[idx.rate] = Number(entry.rate || 0);
    if (idx.salary > -1) row[idx.salary] = Number(entry.salary || 0);
    if (idx.conflict > -1) row[idx.conflict] = entry.hasConflict ? 'TRUE' : 'FALSE';
    if (idx.active > -1) row[idx.active] = 'TRUE';
    if (idx.created > -1) {
      const existingRow = rowIdx > 0 ? data[rowIdx - 1] : null;
      row[idx.created] = (existingRow && existingRow[idx.created]) ? existingRow[idx.created] : new Date();
    }
    if (idx.updated > -1) row[idx.updated] = new Date();
    if (idx.meta > -1) row[idx.meta] = JSON.stringify(entry._meta || {});

    if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);

    return { success: true, data: { id: assignmentId } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function deleteStaffAssignment_(entry, auth) {
  try {
    const sh = ensureTeacherAssignmentsSheetStructure_(getSS_());
    const data = sh.getDataRange().getValues();
    if (!data || data.length < 2) return { success: true };
    const headers = data[0].map(h => String(h || '').trim().toUpperCase());
    const idx = {
      id: headers.indexOf('ASSIGNMENTID'),
      teacher: headers.indexOf('TEACHERNAME'),
      className: headers.indexOf('CLASSNAME'),
      subject: headers.indexOf('SUBJECT'),
      active: headers.indexOf('ACTIVE'),
      updated: headers.indexOf('UPDATEDAT')
    };
    const targetId = String((entry && (entry.id || entry.assignmentId)) || '').trim();
    for (let i = 1; i < data.length; i++) {
      const sameId = targetId && idx.id > -1 && String(data[i][idx.id] || '').trim() === targetId;
      const sameComposite = !targetId
        && String(data[i][idx.teacher] || '').trim() === String(entry.teacher || '').trim()
        && String(data[i][idx.className] || '').trim() === String(entry.className || '').trim()
        && String(data[i][idx.subject] || '').trim() === String(entry.subject || '').trim();
      if (!sameId && !sameComposite) continue;
      if (idx.active > -1) sh.getRange(i + 1, idx.active + 1).setValue('FALSE');
      if (idx.updated > -1) sh.getRange(i + 1, idx.updated + 1).setValue(new Date());
      return { success: true };
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function createSubject_(data, auth) {
  try {
    if (!data) return { success: false, error: 'Payload manquant.' };
    return saveStaffAssignment_({
      id: data && (data.code || data.id),
      teacher: data && (data.teacherId || data.teacher || ''),
      teacherId: data && (data.teacherId || data.teacher || ''),
      className: data && (data.classId || data.className || ''),
      classId: data && (data.classId || data.className || ''),
      subject: data && (data.name || data.subject || ''),
      hours: data && (data.hoursPerWeek || data.hours || 0),
      rate: data && (data.rate || 0),
      salary: data && (data.salary || 0),
      day: data && (data.day || ''),
      start: data && (data.startTime || data.start || ''),
      end: data && (data.endTime || data.end || ''),
      hasConflict: !!(data && data.hasConflict)
    }, auth);
  } catch(e) { return { success: false, error: e.message }; }
}

function deleteSubject_(data, auth) {
  try {
    if (!data) return { success: false, error: 'Payload manquant.' };
    return deleteStaffAssignment_(data, auth);
  } catch(e) { return { success: false, error: e.message }; }
}

/**
 * Logs a report generation event to the audit log, including a shareable link.
 * Called from the frontend after every report is generated.
 */
function logReportGenerated_(data, auth) {
  try {
    const title       = String((data && data.title) || 'Rapport').substring(0,80);
    const format      = String((data && data.format) || 'html').toUpperCase();
    const scope       = String((data && data.scope) || '');
    const generatedBy = String((data && data.generatedBy) || (auth && (auth.name || auth.email)) || 'Inconnu');
    const actor       = _resolveSessionEmailSafe_(generatedBy);
    const orgId       = String((typeof getOrgId_ === 'function' ? getOrgId_() : '') || 'UNKNOWN_ORG');
    // Build a shareable audit detail with report metadata
    const reportTs = new Date().toISOString();
    const detail = {
      reportTitle: title,
      format: format,
      scope: scope,
      generatedBy: generatedBy,
      email: actor,
      role: data && data.role ? String(data.role) : '',
      orgId: orgId,
      at: reportTs,
      // Human-readable one-liner for the audit log viewer
      summary: '[' + format + '] "' + title + '" — ' + scope + ' — par ' + generatedBy + ' (' + actor + ') le ' + reportTs.slice(0,10)
    };
    writeAuditLog_('REPORT_GENERATED', title, detail, 'pa_generate_report', false);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// BACKUP & YEAR ARCHIVE
// ============================================================
function getOrCreateBackupFolder_() {
  const name = 'MEIGENS_SaaS_ARCHIVES';
  const it   = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function autoRotateInFolder_(folder, schoolName, limit) {
  const files  = folder.getFiles();
  const prefix = 'BACKUP_' + schoolName;
  const list   = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().startsWith(prefix)) list.push({ id:f.getId(), date:f.getDateCreated() });
  }
  if (list.length >= limit) {
    list.sort((a,b) => a.date - b.date);
    try { DriveApp.getFileById(list[0].id).setTrashed(true); } catch(e) {}
  }
}

function createSaaSBackup_(specificId) {
  try {
    const ss    = specificId ? SpreadsheetApp.openById(specificId) : SpreadsheetApp.getActiveSpreadsheet();
    const name  = ss.getName().replace(/[^a-zA-Z0-9_-]/g,'_').substring(0,30);
    const ts    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    const folder= getOrCreateBackupFolder_();
    autoRotateInFolder_(folder, name, 4);
    DriveApp.getFileById(ss.getId()).makeCopy('BACKUP_' + name + '_' + ts, folder);
    const mirror = 'STANDALONE_MIRROR_' + name;
    const rootIt = DriveApp.getRootFolder().getFilesByName(mirror);
    while (rootIt.hasNext()) { try { rootIt.next().setTrashed(true); } catch(e) {} }
    DriveApp.getFileById(ss.getId()).makeCopy(mirror, DriveApp.getRootFolder());
    writeAuditLog_('BACKUP', ss.getId(), 'OK', 'p_settings');
    return { success:true, message:'Backup: BACKUP_' + name + '_' + ts };
  } catch(e) { return { success:false, error:e.message }; }
}

function runGlobalBackupTask_() {
  try {
    const master  = SpreadsheetApp.openById(MASTER_AUTH_ID);
    const reg     = master.getSheetByName('Register');
    const data    = reg.getDataRange().getValues();
    const h       = data[0].map(x => String(x).toUpperCase().trim());
    const iSheet  = h.indexOf('USER_SPREADSHEET_ID');
    const iActive = h.indexOf('IS_ACTIVE');
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const ssId   = String(data[i][iSheet] || '').trim();
      const active = iActive !== -1 ? String(data[i][iActive]).toUpperCase() : 'TRUE';
      if (ssId && active !== 'FALSE') {
        try { createSaaSBackup_(ssId); count++; Utilities.sleep(800); } catch(e) {}
      }
    }
    return { success:true, schoolsBackedUp:count };
  } catch(e) { return { success:false, error:e.message }; }
}

/**
 * BACKUP TRIGGER — HOW IT WORKS:
 * ─────────────────────────────────────────────────────────────────────────
 * This function installs a weekly time-based trigger that runs
 * runGlobalBackupTask_() every Sunday at 02:00.
 *
 * ⚠ YOU MUST RUN THIS FUNCTION ONCE MANUALLY to activate the trigger.
 * It is called automatically by meigensFullInstall(), so if you ran the
 * full install you do NOT need to run it again — the trigger is already set.
 *
 * To check whether the trigger is active: go to Apps Script → Triggers (clock icon).
 * You should see "runGlobalBackupTask_" listed with "Weekly" recurrence.
 *
 * To install it manually without the full install, run:
 *   installWeeklyBackupTrigger()   (from the Apps Script editor or via the menu)
 * ─────────────────────────────────────────────────────────────────────────
 */
function installWeeklyBackupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists   = triggers.some(t => t.getHandlerFunction() === 'runGlobalBackupTask_');
  if (!exists) {
    ScriptApp.newTrigger('runGlobalBackupTask_')
      .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
    Logger.log('Backup hebdomadaire installe (dimanche 2h).');
    return { installed: true, message: 'Trigger backup installe: chaque dimanche a 02h00.' };
  }
  Logger.log('Backup trigger deja present.');
  return { installed: false, message: 'Trigger backup deja actif — aucune action requise.' };
}

function _computeNextAcademicYear_(yearValue) {
  const curYear = String(yearValue || '').trim();
  if (!curYear) return '';
  let nextYear = curYear;
  if (curYear.indexOf('-') !== -1) {
    const parts = curYear.split('-');
    const y1 = parseInt(String(parts[0] || '').trim(), 10);
    const y2 = parseInt(String(parts[1] || '').trim(), 10);
    if (!isNaN(y1) && !isNaN(y2)) nextYear = String(y1 + 1) + '-' + String(y2 + 1);
  } else {
    const yr = parseInt(curYear, 10);
    if (!isNaN(yr)) nextYear = String(yr + 1);
  }
  return nextYear;
}

function _archiveHeaderToken_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function _findArchiveHeaderIndex_(headers, aliases) {
  const normalized = (headers || []).map(_archiveHeaderToken_);
  const wants = (aliases || []).map(_archiveHeaderToken_);
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    if (wants.indexOf(h) !== -1) return i;
  }
  return -1;
}

function _parseArchiveDate_(value) {
  if (value instanceof Date) return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function _getLatestArchiveEntry_(ss) {
  const sh = ss.getSheetByName('Archives_Annuelles');
  if (!sh || sh.getLastRow() <= 1) return null;

  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idxYear = _findArchiveHeaderIndex_(headers, ['ANNEE SCOLAIRE', 'ANNEE_ACADEMIQUE', 'ACADEMIC_YEAR']);
  const idxLink = _findArchiveHeaderIndex_(headers, ['LIEN DRIVE', 'DRIVE_LINK', 'ARCHIVE_URL']);
  const idxId = _findArchiveHeaderIndex_(headers, ['ARCHIVE_ID', 'ARCHIVEID']);
  const idxSnapshot = _findArchiveHeaderIndex_(headers, ['SETTINGS_SHEET', 'SNAPSHOT_SHEET']);
  const idxClosedAt = _findArchiveHeaderIndex_(headers, ['DATE CLOTURE', 'DATE_CLOTURE', 'CLOSED_AT']);
  const idxClosedBy = _findArchiveHeaderIndex_(headers, ['CLOTURE PAR', 'CLOTURE_PAR', 'CLOSED_BY']);

  for (let r = values.length - 1; r >= 1; r--) {
    const row = values[r] || [];
    const year = idxYear !== -1 ? String(row[idxYear] || '').trim() : '';
    const archiveId = idxId !== -1 ? String(row[idxId] || '').trim() : '';
    if (!year && !archiveId) continue;
    return {
      rowIndex: r + 1,
      year: year,
      archiveUrl: idxLink !== -1 ? String(row[idxLink] || '').trim() : '',
      archiveId: archiveId,
      snapshotSheet: idxSnapshot !== -1 ? String(row[idxSnapshot] || '').trim() : '',
      closedAt: _parseArchiveDate_(idxClosedAt !== -1 ? row[idxClosedAt] : ''),
      closedBy: idxClosedBy !== -1 ? String(row[idxClosedBy] || '').trim() : ''
    };
  }
  return null;
}

function _rolloverWindowMs_() {
  return 3 * 24 * 60 * 60 * 1000;
}

function getAcademicYearRolloverStatus_(token) {
  try {
    const viewer = getViewerInfo_(token);
    if (!viewer.success) return { success: false, error: 'Session invalide.' };
    if (!viewer.isMaster && !(viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings))) {
      throw new Error('Droits insuffisants.');
    }

    const ss = getSS_();
    const confRes = getSaaSSettings_(token);
    const conf = (confRes && confRes.success && confRes.data) ? confRes.data : {};
    const currentYear = String(conf.ACADEMIC_YEAR || conf.currentAcademicYear || '').trim();

    const latest = _getLatestArchiveEntry_(ss);
    if (!latest) {
      return {
        success: true,
        currentYear: currentYear,
        hasRollover: false,
        canReset: false,
        resetWindowDays: 3,
        message: 'Aucune cloture detectee.'
      };
    }

    const closedAtMs = latest.closedAt ? latest.closedAt.getTime() : 0;
    const deadlineMs = closedAtMs ? (closedAtMs + _rolloverWindowMs_()) : 0;
    const nowMs = Date.now();
    const remainingMs = deadlineMs ? Math.max(0, deadlineMs - nowMs) : 0;
    const expectedYear = _computeNextAcademicYear_(latest.year);
    const matchesExpectedTransition = !!(expectedYear && currentYear && expectedYear === currentYear);
    const withinWindow = !!(closedAtMs && nowMs <= deadlineMs);

    return {
      success: true,
      currentYear: currentYear,
      hasRollover: true,
      resetWindowDays: 3,
      canReset: withinWindow && matchesExpectedTransition,
      closedYear: latest.year,
      expectedYearAfterRollover: expectedYear,
      closedAt: latest.closedAt ? latest.closedAt.toISOString() : '',
      resetDeadlineAt: deadlineMs ? new Date(deadlineMs).toISOString() : '',
      millisRemaining: remainingMs,
      closedBy: latest.closedBy,
      archiveId: latest.archiveId,
      archiveUrl: latest.archiveUrl,
      snapshotSheet: latest.snapshotSheet,
      message: withinWindow
        ? (matchesExpectedTransition ? 'Reinitialisation possible pendant 3 jours.' : 'La reinitialisation n\'est plus applicable pour l\'annee active actuelle.')
        : 'La fenetre de reinitialisation (3 jours) est expiree.'
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function _loadSnapshotSettingsRows_(ss, archiveEntry) {
  const snapshotName = String((archiveEntry && archiveEntry.snapshotSheet) || '').trim();
  let snapshotSheet = snapshotName ? ss.getSheetByName(snapshotName) : null;

  if (!snapshotSheet && archiveEntry && archiveEntry.archiveId) {
    try {
      const archivedSS = SpreadsheetApp.openById(String(archiveEntry.archiveId).trim());
      snapshotSheet = archivedSS.getSheetByName('Settings');
    } catch (_archiveOpenErr) {}
  }

  if (!snapshotSheet || snapshotSheet.getLastRow() <= 1) {
    throw new Error('Snapshot des parametres introuvable pour la reinitialisation.');
  }

  const rows = snapshotSheet.getDataRange().getValues();
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    if (!key) continue;
    entries.push({ name: key, value: rows[i][1] });
  }
  return entries;
}

function _restoreOperationalSheetFromArchive_(liveSs, archiveSs, sheetName) {
  const liveSh = liveSs.getSheetByName(sheetName);
  if (!liveSh) return { sheet: sheetName, restoredRows: 0, note: 'sheet absente localement' };

  const archiveSh = archiveSs ? archiveSs.getSheetByName(sheetName) : null;
  if (!archiveSh) {
    if (liveSh.getLastRow() > 1) {
      liveSh.getRange(2, 1, liveSh.getLastRow() - 1, liveSh.getLastColumn()).clearContent();
    }
    return { sheet: sheetName, restoredRows: 0, note: 'sheet absente dans archive' };
  }

  if (liveSh.getLastRow() > 1) {
    liveSh.getRange(2, 1, liveSh.getLastRow() - 1, liveSh.getLastColumn()).clearContent();
  }

  if (archiveSh.getLastRow() <= 1) return { sheet: sheetName, restoredRows: 0 };

  const srcRows = archiveSh.getLastRow() - 1;
  const srcCols = archiveSh.getLastColumn();
  const dstCols = liveSh.getLastColumn();
  const writeCols = Math.max(1, Math.min(srcCols, dstCols));
  const raw = archiveSh.getRange(2, 1, srcRows, srcCols).getValues();
  const writeValues = raw.map(function(r) { return r.slice(0, writeCols); });
  liveSh.getRange(2, 1, writeValues.length, writeCols).setValues(writeValues);

  return { sheet: sheetName, restoredRows: writeValues.length };
}

function resetAcademicYearRollover_(token) {
  try {
    const viewer = getViewerInfo_(token);
    if (!viewer.success) return { success: false, error: 'Session invalide.' };
    if (!viewer.isMaster && !(viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings))) {
      throw new Error('Droits insuffisants.');
    }

    const ss = getSS_();
    const latest = _getLatestArchiveEntry_(ss);
    if (!latest) throw new Error('Aucune cloture annuelle detectee.');
    if (!latest.closedAt) throw new Error('Date de cloture introuvable. Reinitialisation refusee.');

    const nowMs = Date.now();
    const deadlineMs = latest.closedAt.getTime() + _rolloverWindowMs_();
    if (nowMs > deadlineMs) {
      throw new Error('La fenetre de reinitialisation (3 jours) est expiree.');
    }

    const confRes = getSaaSSettings_(token);
    const conf = (confRes && confRes.success && confRes.data) ? confRes.data : {};
    const currentYear = String(conf.ACADEMIC_YEAR || conf.currentAcademicYear || '').trim();
    const expectedCurrent = _computeNextAcademicYear_(latest.year);
    if (!expectedCurrent || currentYear !== expectedCurrent) {
      throw new Error('Reinitialisation refusee: l\'annee active ne correspond pas a la derniere cloture.');
    }

    const snapshotEntries = _loadSnapshotSettingsRows_(ss, latest);
    persistSettingsEntries_(snapshotEntries);

    let archiveSS = null;
    if (latest.archiveId) {
      try { archiveSS = SpreadsheetApp.openById(String(latest.archiveId).trim()); } catch (_archiveErr) {}
    }

    const restoredSheets = ['grades', 'Finance', 'attendance']
      .map(function(name) { return _restoreOperationalSheetFromArchive_(ss, archiveSS, name); });

    updateSaaSSettings_({ name: 'ACADEMIC_YEAR', value: latest.year }, token);

    writeAuditLog_(
      'YEAR_ROLLOVER_RESET',
      latest.year,
      'Reset depuis ' + currentYear + ' vers ' + latest.year
        + ' | archive:' + (latest.archiveId || 'N/A')
        + ' | sheetSnapshot:' + (latest.snapshotSheet || 'N/A')
        + ' | actor:' + (viewer.email || 'UNKNOWN'),
      'p_settings'
    );

    return {
      success: true,
      message: 'Cloture annuelle reinitialisee vers ' + latest.year + '.',
      restoredYear: latest.year,
      previousCurrentYear: currentYear,
      restoredSheets: restoredSheets,
      resetDeadlineAt: new Date(deadlineMs).toISOString()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function rolloverAcademicYear_(token) {
  try {
    const viewer  = getViewerInfo_(token);
    if (!viewer.isMaster && !(viewer.permissions && (viewer.permissions.p_settings || viewer.permissions.pa_save_settings)))
      throw new Error('Droits insuffisants.');

    const ss       = getSS_();
    const conf     = getSaaSSettings_().data;
    const curYear  = String(conf.ACADEMIC_YEAR || '').trim();
    if (!curYear) throw new Error('ACADEMIC_YEAR non configure dans Parametres. Definissez-le avant de cloturer l\'annee.');
    const safeYear = curYear.replace(/[^a-zA-Z0-9]/g, '_');

    const archFolder = getOrCreateBackupFolder_();
    const archName   = 'ARCHIVE_' + curYear + '_' + (conf.SCHOOL_NAME||'Ecole').replace(/\s+/g,'_');
    const archFile   = DriveApp.getFileById(ss.getId()).makeCopy(archName, archFolder);
    archFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const snapshotName = 'Settings_' + safeYear;
    const shSettings   = ss.getSheetByName('Settings');
    let   shSnap       = ss.getSheetByName(snapshotName);
    if (!shSnap) {
      shSnap = ss.insertSheet(snapshotName);
      shSnap.getRange(1,1,1,3).setValues([['KEY','VALUE','ARCHIVED_AT']])
            .setFontWeight('bold').setBackground('#fef9c3');
      shSnap.setFrozenRows(1);
    }
    if (shSettings && shSettings.getLastRow() > 1) {
      const rows = shSettings.getDataRange().getValues();
      const now  = new Date();
      const existing = new Set(
        shSnap.getLastRow() > 1
          ? shSnap.getRange(2,1,shSnap.getLastRow()-1,1).getValues().flat().map(String)
          : []
      );
      const toWrite = rows.slice(1).filter(r => r[0] && !existing.has(String(r[0])));
      if (toWrite.length) {
        shSnap.getRange(shSnap.getLastRow()+1, 1, toWrite.length, 3)
              .setValues(toWrite.map(r => [r[0], r[1], now]));
      }
    }

    let shArch = ss.getSheetByName('Archives_Annuelles');
    if (!shArch) {
      shArch = ss.insertSheet('Archives_Annuelles');
      shArch.appendRow(['Annee Scolaire','Lien Drive','Archive_ID','Settings_Sheet','Date Cloture','Cloture par']);
      shArch.setFrozenRows(1);
    }
    shArch.appendRow([curYear, archFile.getUrl(), archFile.getId(), snapshotName, new Date(), viewer.email]);

    let nextYear = _computeNextAcademicYear_(curYear);
    updateSaaSSettings_({ name:'ACADEMIC_YEAR', value:nextYear }, token);

    ['grades','Finance','attendance'].forEach(n => {
      const sh2 = ss.getSheetByName(n);
      if (sh2 && sh2.getLastRow() > 1)
        sh2.getRange(2,1,sh2.getLastRow()-1,sh2.getLastColumn()).clearContent();
    });

    writeAuditLog_('YEAR_ROLLOVER', curYear,
      'Vers ' + nextYear + ' | archive:' + archFile.getId() + ' | snap:' + snapshotName, 'p_settings');
    return { success:true, message:'Annee ' + curYear + ' archivee. Bienvenue en ' + nextYear + '!',
             archiveUrl:archFile.getUrl(), newYear:nextYear, snapshotSheet:snapshotName };
  } catch(e) { return { success:false, error:e.message }; }
}

// ============================================================
// DIAGNOSTIC
// ============================================================
/**
 * Browser-callable diagnostic for sync/history issues.
 * Add to doPost switch: case 'diagnoseSyncIssue': result = diagnoseSyncIssue_(data, auth); break;
 * Add to permissions:   'diagnoseSyncIssue': 'p_settings'
 */
function diagnoseSyncIssue_(payload, auth) {
  const logs = [];
  const ok   = function(msg) { logs.push('OK  | ' + msg); };
  const warn = function(msg) { logs.push('WARN| ' + msg); };
  const err  = function(msg) { logs.push('ERR | ' + msg); };
  const info = function(msg) { logs.push('--- ' + msg); };

  try {
    info('=== STEP 1: Environment ===');
    const ss   = getSS_();
    const ssId = ss.getId();
    ok('getSS_() → ' + ssId);

    const orgId = String(getOrgId_() || '').trim();
    if (!orgId || orgId === 'UNKNOWN_ORG') err('getOrgId_() → "' + orgId + '" — sync will abort');
    else ok('getOrgId_() → ' + orgId);

    info('=== STEP 2: Academic Year ===');
    const year = getActiveAcademicYear_();
    if (!year || year === 'ANNEE_NON_CONFIGUREE') err('getActiveAcademicYear_() → "' + year + '" — enrollment will be skipped');
    else ok('getActiveAcademicYear_() → ' + year);

    try {
      const sr = getSaaSSettings_();
      if (sr && sr.success && sr.data) ok('getSaaSSettings_().data.ACADEMIC_YEAR → ' + (sr.data.ACADEMIC_YEAR || 'MISSING'));
      else err('getSaaSSettings_() failed: ' + JSON.stringify(sr));
    } catch(e) { err('getSaaSSettings_() threw: ' + e.message); }

    info('=== STEP 3: students sheet ===');
    const shStudents = ss.getSheetByName('students');
    if (!shStudents) { err('students sheet NOT FOUND'); }
    else {
      ok('students sheet found, lastRow=' + shStudents.getLastRow());
      info('students headers: ' + JSON.stringify(shStudents.getRange(1,1,1,shStudents.getLastColumn()).getValues()[0]));
    }

    info('=== STEP 4: studenthistory sheet ===');
    const shHist = ss.getSheetByName('studenthistory');
    if (!shHist) { err('studenthistory sheet NOT FOUND — this is why history is never written'); }
    else {
      ok('studenthistory sheet found, lastRow=' + shHist.getLastRow());
      info('studenthistory headers: ' + JSON.stringify(shHist.getRange(1,1,1,shHist.getLastColumn()).getValues()[0]));
    }

    info('=== STEP 5: Generated_IDs (Master) ===');
    let generatedData = null;
    try {
      const master      = SpreadsheetApp.openById(MASTER_AUTH_ID);
      const shGenerated = master.getSheetByName('Generated_IDs');
      if (!shGenerated) { err('Generated_IDs sheet NOT FOUND in master'); }
      else {
        ok('Generated_IDs found, lastRow=' + shGenerated.getLastRow());
        generatedData = shGenerated.getDataRange().getValues();
        info('Headers (raw): ' + JSON.stringify(generatedData[0]));
        const gH = generatedData[0].map(function(x) {
          return String(x||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');
        });
        info('Headers (normalized): ' + JSON.stringify(gH));
        const giId = gH.indexOf('ID'), giOrg = gH.indexOf('ORGID'), giCl = gH.indexOf('CLASSE');
        if (giId  === -1) err('"ID" column not found');     else ok('"ID" at col ' + giId);
        if (giOrg === -1) err('"ORGID" column not found');  else ok('"ORGID" at col ' + giOrg);
        if (giCl  === -1) warn('"CLASSE" not found — level will default to N/A');
        else ok('"CLASSE" at col ' + giCl);

        if (giOrg !== -1 && orgId && orgId !== 'UNKNOWN_ORG') {
          let matchCount = 0;
          generatedData.slice(1).forEach(function(r){ if (String(r[giOrg]||'').trim()===orgId) matchCount++; });
          if (matchCount === 0) {
            err('0 rows match orgId="' + orgId + '" — ALL rows will be skipped');
            info('Sample ORGID values: ' + generatedData.slice(1,6).map(function(r){return '"'+String(r[giOrg]||'').trim()+'"';}).join(', '));
          } else {
            ok(matchCount + ' row(s) match orgId="' + orgId + '"');
          }
        }
      }
    } catch(e) { err('Error reading Generated_IDs: ' + e.message); }

    info('=== STEP 6: Live test — addNewStudent_ on first matching row ===');
    if (generatedData && orgId && orgId !== 'UNKNOWN_ORG') {
      const gH = generatedData[0].map(function(x) {
        return String(x||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');
      });
      const giId=gH.indexOf('ID'), giNom=gH.indexOf('NOM'), giPrenom=gH.indexOf('PRENOM'),
            giPhone=gH.indexOf('PHONE'), giOrg=gH.indexOf('ORGID'), giPhoto=gH.indexOf('PHOTOURL'),
            giStatus=gH.indexOf('STATUS'), giClasse=gH.indexOf('CLASSE'), giSexe=gH.indexOf('SEXE'),
            giAdresse=gH.indexOf('ADRESSE'),
            giBirth=gH.indexOf('DATENAISSANCE')!==-1?gH.indexOf('DATENAISSANCE'):gH.indexOf('DATEDENAISSANCE');

      let testRow = null;
      for (var i=1; i<generatedData.length; i++) {
        if (String(generatedData[i][giOrg]||'').trim()===orgId) { testRow=generatedData[i]; break; }
      }
      if (!testRow) { warn('No matching row found — cannot run live test'); }
      else {
        const normalizePhoto_ = function(raw) {
          let p=String(raw||'').trim(); if(!p) return '';
          if(p.indexOf('drive.google.com')!==-1){const m=p.match(/id=([a-zA-Z0-9_-]+)/)||p.match(/\/d\/([a-zA-Z0-9_-]+)\//);if(m)p='https://drive.google.com/thumbnail?id='+m[1]+'&sz=w400';}
          return p;
        };
        const formObj = {
          StudentCode:      String(testRow[giId]||'').trim(),
          LastName:         giNom!==-1?String(testRow[giNom]||'').trim():'',
          FirstName:        giPrenom!==-1?String(testRow[giPrenom]||'').trim():'',
          Phone:            giPhone!==-1?String(testRow[giPhone]||'').trim():'',
          Gender:           giSexe!==-1?String(testRow[giSexe]||'').trim():'',
          BirthDate:        giBirth!==-1?testRow[giBirth]:'',
          Address:          giAdresse!==-1?String(testRow[giAdresse]||'').trim():'',
          PhotoURL:         giPhoto!==-1?normalizePhoto_(testRow[giPhoto]):'',
          CurrentLevel:     giClasse!==-1?String(testRow[giClasse]||'').trim():'',
          Section:'A', EnrollmentStatus:'ACTIVE', Active:'TRUE'
        };
        info('formObj: ' + JSON.stringify(formObj));
        if (!formObj.StudentCode) { err('StudentCode is empty — addNewStudent_ will fail'); }
        else {
          try {
            const result = addNewStudent_(formObj);
            if (result.success) ok('addNewStudent_ SUCCESS: ' + result.message);
            else err('addNewStudent_ FAILED: ' + result.error);
          } catch(e) { err('addNewStudent_ threw: ' + e.message); }

          const shH2 = ss.getSheetByName('studenthistory');
          if (shH2 && shH2.getLastRow() > 1) {
            const hd=shH2.getDataRange().getValues(), hh=hd[0];
            const iSid=hh.indexOf('StudentID');
            const found=hd.slice(1).find(function(r){return String(r[iSid]||'').trim()===formObj.StudentCode;});
            if (found) ok('studenthistory row CONFIRMED for ' + formObj.StudentCode + ': ' + JSON.stringify(found));
            else err('studenthistory row NOT FOUND for ' + formObj.StudentCode + ' after addNewStudent_ — check StudentID column header casing');
          } else { err('studenthistory still empty after addNewStudent_ call'); }
        }
      }
    }

    info('=== STEP 7: Cache state ===');
    try {
      const ck = 'SYNC_GENERATED_IDS_' + ssId + '_' + orgId;
      const ca = _safeCacheGetData_(ck);
      if (ca && ca.done) warn('Sync cache ACTIVE (throttled). Last run: '+(ca.at||'unknown')+'. Pass {force:true} to bypass.');
      else ok('Sync cache is clear — next sync will run fully');
    } catch(e) { warn('Could not read sync cache: ' + e.message); }

  } catch(e) {
    logs.push('CRASH: ' + e.message);
  }

  return { success: true, logs: logs, logText: logs.join('\n') };
}

// ============================================================
// INSTALL
// ============================================================
function meigensFullInstall() {
  Logger.log('Installation Meigens Tech v10.1...');
  const r1 = checkAndInitSheets();     Logger.log('Sheets: '      + JSON.stringify(r1));
  const r2 = applySheetProtections_(); Logger.log('Protections: ' + JSON.stringify(r2));
  installWeeklyBackupTrigger();        Logger.log('Backup trigger: OK');
  const r3 = createSaaSBackup_();       Logger.log('Backup: '      + JSON.stringify(r3));
  return { success:true, message:'Meigens Tech v10.1 installe et securise.' };
}
/**
 * Génère l'URL d'un QR Code pour l'authentification du bulletin
 * @param {string} data Le matricule ou lien de vérification
 * @return {string} URL de l'image QR
 */
function addQr(data) {
  if (!data) throw new Error("Donnée QR manquante. Impossible de sécuriser le bulletin.");
  
  // Utilisation de l'API Google Charts pour un rendu instantané
  const qrUrl = "https://chart.googleapis.com/chart?chs=150x150&cht=qr&chl=" + encodeURIComponent(data) + "&choe=UTF-8";
  return qrUrl;
}
// Stub exports for backward compat
function setAnthropicApiKey(k) { PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY',k); }
function getAnthropicApiKey()  { return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')||''; }
function setSystemAnthropicFallbackKey(k) { PropertiesService.getScriptProperties().setProperty('SYSTEM_ANTHROPIC_API_KEY', k); }
function getSystemAnthropicFallbackKey() { return PropertiesService.getScriptProperties().getProperty('SYSTEM_ANTHROPIC_API_KEY') || ''; }
function listAllScriptProperties_() {
  var props = PropertiesService.getScriptProperties().getProperties() || {};
  var keys = Object.keys(props).sort();
  return {
    success: true,
    count: keys.length,
    keys: keys,
    properties: keys.reduce(function(acc, key) {
      var value = String(props[key] || '');
      var masked = /KEY|TOKEN|SECRET|PASSWORD/i.test(key)
        ? (value ? (value.slice(0, 6) + '...' + value.slice(-4)) : '')
        : value;
      acc[key] = masked;
      return acc;
    }, {})
  };
}
function cleanupScriptProperties_(options) {
  var opts = options && typeof options === 'object' ? options : {};
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties() || {};
  var keys = Object.keys(allProps);
  var keepMap = {};
  var removed = [];
  var preserved = [];

  [
    'STUDENT_FORM_CONFIG',
    'STUDENT_FIELDS_CONFIG',
    'SYSTEM_ANTHROPIC_API_KEY',
    'SYSTEM_CLAUDE_API_KEY',
    'SYSTEM_AI_API_KEY',
    'SYSTEM_OPENAI_API_KEY',
    'SYSTEM_GEMINI_API_KEY',
    'SYSTEM_GOOGLE_API_KEY'
  ].concat(Array.isArray(opts.keepKeys) ? opts.keepKeys : []).forEach(function(key) {
    var normalized = String(key || '').trim();
    if (normalized) keepMap[normalized] = true;
  });

  var mirroredSettingsKeys = {};
  try {
    var ss = getSS_();
    var sh = ss && ss.getSheetByName('Settings');
    if (sh && sh.getLastRow() > 1) {
      var rows = sh.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var settingKey = String(rows[i][0] || '').trim();
        if (settingKey) mirroredSettingsKeys[settingKey] = true;
      }
    }
  } catch (_settingsErr) {}

  keys.forEach(function(key) {
    if (keepMap[key]) {
      preserved.push(key);
      return;
    }

    var shouldRemove = false;
    if (String(key).indexOf('SESSION_TOKEN_') === 0) shouldRemove = true;
    if (mirroredSettingsKeys[key]) shouldRemove = true;
    if (Array.isArray(opts.removeKeys) && opts.removeKeys.indexOf(key) !== -1) shouldRemove = true;

    if (shouldRemove) {
      props.deleteProperty(key);
      removed.push(key);
    } else {
      preserved.push(key);
    }
  });

  try {
    var activeSs = getActiveSpreadsheetSafe_();
    if (activeSs) CacheService.getScriptCache().remove('SAAS_SETTINGS_' + activeSs.getId() + '_CURRENT');
  } catch (_cacheErr) {}

  try {
    writeAuditLog_('SCRIPT_PROPERTIES_CLEANUP', 'SYSTEM', {
      removedCount: removed.length,
      removedKeys: removed.slice(0, 50),
      preservedCount: preserved.length
    }, 'p_settings');
  } catch (_auditErr) {}

  return {
    success: true,
    removedCount: removed.length,
    preservedCount: preserved.length,
    removedKeys: removed,
    preservedKeys: preserved,
    note: 'Les données école dans la feuille Settings sont conservées. Seuls les miroirs Script Properties et les sessions persistées sont supprimés.'
  };
}
function cleanupScriptProperties(options) { return cleanupScriptProperties_(options); }
function diagnoseAiConfig_() {
  var props = PropertiesService.getScriptProperties();
  var runtime = _resolveServerAiConfig_();
  var activeSs = getActiveSpreadsheetSafe_();
  var explicitProviderRaw = _getServerAiSettingByAliases_(['AI_PROVIDER'], '').toLowerCase();
  var settingsProvider = _getSettingsSheetValue_(['AI_PROVIDER']);
  var settingsModel = _getSettingsSheetValue_(['AI_MODEL']);
  var settingsApiUrl = _getSettingsSheetValue_(['AI_API_URL']);
  var candidates = [
    { name:'ANTHROPIC_API_KEY', value:String(props.getProperty('ANTHROPIC_API_KEY') || '').trim() },
    { name:'CLAUDE_API_KEY', value:String(props.getProperty('CLAUDE_API_KEY') || '').trim() },
    { name:'AI_API_KEY', value:String(props.getProperty('AI_API_KEY') || '').trim() },
    { name:'SYSTEM_ANTHROPIC_API_KEY', value:String(props.getProperty('SYSTEM_ANTHROPIC_API_KEY') || '').trim() },
    { name:'SYSTEM_CLAUDE_API_KEY', value:String(props.getProperty('SYSTEM_CLAUDE_API_KEY') || '').trim() },
    { name:'SYSTEM_AI_API_KEY', value:String(props.getProperty('SYSTEM_AI_API_KEY') || '').trim() },
    { name:'OPENAI_API_KEY', value:String(props.getProperty('OPENAI_API_KEY') || '').trim() },
    { name:'SYSTEM_OPENAI_API_KEY', value:String(props.getProperty('SYSTEM_OPENAI_API_KEY') || '').trim() },
    { name:'GEMINI_API_KEY', value:String(props.getProperty('GEMINI_API_KEY') || '').trim() },
    { name:'GOOGLE_API_KEY', value:String(props.getProperty('GOOGLE_API_KEY') || '').trim() },
    { name:'SYSTEM_GEMINI_API_KEY', value:String(props.getProperty('SYSTEM_GEMINI_API_KEY') || '').trim() },
    { name:'SYSTEM_GOOGLE_API_KEY', value:String(props.getProperty('SYSTEM_GOOGLE_API_KEY') || '').trim() }
  ];
  var found = candidates.filter(function(item){ return !!item.value; }).map(function(item){ return item.name; });
  return {
    success: true,
    orgId: String(getOrgId_() || '').trim(),
    spreadsheetId: String(activeSs && activeSs.getId ? activeSs.getId() : '').trim(),
    providerRequested: explicitProviderRaw || SERVER_AI_DEFAULT_PROVIDER_,
    providerResolved: runtime && runtime.provider ? runtime.provider : '',
    modelResolved: runtime && runtime.model ? runtime.model : '',
    apiUrlResolved: runtime && runtime.apiUrl ? runtime.apiUrl : '',
    hasUsableKey: !!(runtime && runtime.apiKey),
    detectedKeySources: found,
    settingsSheetProvider: settingsProvider,
    settingsSheetModel: settingsModel,
    settingsSheetApiUrl: settingsApiUrl,
    settingsSheetKeyDetected: !!_getSettingsSheetValue_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'AI_API_KEY'])
  };
}
function diagnoseAiConfig() { return diagnoseAiConfig_(); }
function syncClaudeAiConfigFromSettings_() {
  var key = _getSettingsSheetValue_(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'AI_API_KEY']);
  if (!key) {
    return {
      success: false,
      error: 'Aucune clé Claude détectée dans la feuille Settings.',
      hint: 'Ajoutez une ligne Settings avec KEY=ANTHROPIC_API_KEY et VALUE=votre clé, puis relancez cette fonction.'
    };
  }
  persistSettingsEntries_([
    { name:'ANTHROPIC_API_KEY', value:String(key).trim() },
    { name:'AI_PROVIDER', value:'anthropic' },
    { name:'AI_MODEL', value:_getSettingsSheetValue_(['AI_MODEL']) || SERVER_AI_DEFAULT_MODEL_ },
    { name:'AI_API_URL', value:_getSettingsSheetValue_(['AI_API_URL']) || SERVER_AI_DEFAULT_API_URL_ }
  ]);
  try {
    var ss = getSS_();
    var cache = CacheService.getScriptCache();
    cache.remove('SAAS_SETTINGS_' + ss.getId() + '_CURRENT');
  } catch (_errCache) {}
  try { writeAuditLog_('AI_CONFIG_SYNC', 'IA', 'Claude config synced for current school Settings', 'p_settings'); } catch (_err) {}
  return diagnoseAiConfig_();
}
function syncClaudeAiConfigFromSettings() { return syncClaudeAiConfigFromSettings_(); }
function fixClearSubCache() {
  const cache = CacheService.getScriptCache();
  const ss = getActiveSpreadsheetSafe_();
  if (!ss) {
    Logger.log('Aucun classeur actif; cache local non vidé.');
    return;
  }
  cache.remove('SUB_CHECK_' + ss.getId());
  cache.remove('ORG_NAME_' + ss.getId());
  cache.remove('SAAS_SETTINGS_' + ss.getId() + '_CURRENT');
  Logger.log('Cache vidé pour: ' + ss.getId());
}
/**
 * 🕵️ SYSTÈME D'AUDIT DIFFÉRENCIÉ (Version Souveraine)
 * @param {string} action - Ce qui a été fait (ex: "SAISIE_PAIEMENT").
 * @param {string} target - Sur quoi (ex: "STUDENT_MT1829").
 * @param {any} details - Objet contenant les données sensibles (Local uniquement).
 * @param {string} permUsed - La permission ABAC utilisée (ex: "p_finance").
 * @param {boolean} isError - État de réussite.
 */
// PERF FIX: removed SpreadsheetApp.flush() from the hot path.  flush() forces
// a synchronous Sheets API round-trip (~1 s).  The Google Apps Script runtime
// already batches and flushes pending writes at the end of the execution or
// when you explicitly call flush().  Removing it here saves ~1 s per audit
// append without any data-loss risk — if the script times out the partial
// write is simply lost, the same outcome as before.
function _appendRowSafe_(sheet, rowValues, maxRetries) {
  const retries = Math.max(1, Number(maxRetries || 3));
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(4000);
    acquired = true;
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
      try {
        const nextRow = Math.max(1, sheet.getLastRow() + 1);
        const width = Math.max(1, rowValues.length);
        sheet.getRange(nextRow, 1, 1, width).setValues([rowValues]);
        return { success: true, row: nextRow };
      } catch (e) {
        lastErr = e;
        Utilities.sleep(120 * (i + 1));
      }
    }
    return { success: false, error: String((lastErr && lastErr.message) || lastErr || 'append failed') };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e || 'lock failed') };
  } finally {
    if (acquired) {
      try { lock.releaseLock(); } catch (_e) {}
    }
  }
}

function _logAuditWriteFailure_(scope, errMsg, context) {
  try {
    const msg = '[AUDIT_WRITE_FAIL][' + String(scope || 'UNKNOWN') + '] ' + String(errMsg || '');
    let ctx = '';
    try { ctx = JSON.stringify(context || {}); } catch (_e) { ctx = String(context || ''); }
    console.warn(msg + ' | ' + ctx.slice(0, 1200));
  } catch (_ignore) {}
}

/**
 * Returns (and lazily creates) a dedicated Spreadsheet for audit logs.
 * Its ID is stored in the school Settings sheet under AUDIT_SPREADSHEET_ID.
 * Falls back to the school spreadsheet if Drive is unavailable.
 */
function _getOrCreateAuditSpreadsheet_() {
  try {
    const ss       = (typeof getSS_ === 'function') ? getSS_() : SpreadsheetApp.getActiveSpreadsheet();
    const settSh   = ss && ss.getSheetByName('Settings');
    const KEY      = 'AUDIT_SPREADSHEET_ID';
    let auditId    = '';
    if (settSh && settSh.getLastRow() > 1) {
      const rows = settSh.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === KEY) { auditId = String(rows[i][1] || '').trim(); break; }
      }
    }
    if (auditId) {
      try { return SpreadsheetApp.openById(auditId); } catch(_) { auditId = ''; }
    }
    // Create new dedicated audit spreadsheet
    const schoolName = (ss && ss.getName()) ? ss.getName().substring(0,30) : 'Ecole';
    const auditSS    = SpreadsheetApp.create('AUDIT_' + schoolName);
    auditId          = auditSS.getId();
    // Save in Settings
    if (settSh) {
      const now = new Date();
      const data = settSh.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || '').trim() === KEY) {
          settSh.getRange(i + 1, 2).setValue(auditId);
          settSh.getRange(i + 1, 3).setValue(now);
          found = true; break;
        }
      }
      if (!found) settSh.appendRow([KEY, auditId, now]);
    }
    return auditSS;
  } catch(e) {
    // Fallback: return the school spreadsheet itself
    try { return (typeof getSS_ === 'function') ? getSS_() : SpreadsheetApp.getActiveSpreadsheet(); } catch(_) { return null; }
  }
}

function writeAuditLog(action, target, details, permUsed, isError = false) {
  try {
    const timestamp = new Date();
    const actor = _resolveSessionEmailSafe_('Utilisateur Inconnu');
    const orgId = String((typeof getOrgId_ === 'function' ? getOrgId_() : '') || 'UNKNOWN_ORG').trim() || 'UNKNOWN_ORG';
    const statusLabel = isError ? 'ECHEC' : 'REUSSITE';
    const safeAction = String(action || 'UNKNOWN_ACTION');
    const safeTarget = String(target || 'SYSTEM');
    let fullJson = '';
    try {
      fullJson = typeof details === 'object' ? JSON.stringify(details) : String(details || '');
    } catch (_) {
      fullJson = String(details || '');
    }
    if (fullJson.length > 45000) {
      fullJson = fullJson.slice(0, 45000) + '...[truncated]';
    }

    const compactEvent = {
      timestamp: timestamp.toISOString(),
      action: safeAction,
      target: safeTarget,
      actor: actor,
      permission: String(permUsed || ''),
      status: statusLabel,
      isError: !!isError,
      orgId: orgId,
      details: (function() {
        if (typeof details === 'object' && details !== null) return details;
        return String(details || '');
      })()
    };
    let compactJson = '';
    try { compactJson = JSON.stringify(compactEvent); } catch (_e) { compactJson = fullJson; }
    if (compactJson.length > 45000) compactJson = compactJson.slice(0, 45000) + '...[truncated]';

    // Remove legacy debug sheet once and keep audit storage compact.
    try {
      const ssForFlag = (typeof getSS_ === 'function') ? getSS_() : getActiveSpreadsheetSafe_();
      if (ssForFlag) {
        const cleanupKey = 'AUDIT_DEBUG_SHEET_REMOVED_' + ssForFlag.getId();
        if (!_safeCacheGetData_(cleanupKey)) {
          _removeAuditDebugSheetIfExists_();
          _safeCachePut(cleanupKey, JSON.stringify({ ok: true, at: new Date().toISOString() }), 21600);
        }
      }
    } catch (_cleanupErr) {}

    // --- 📂 A. AUDIT LOCAL (INTIMITÉ TOTALE) ---
    // PERF FIX: _normalizeAuditSheetToCompact_() has been moved OUT of this hot
    // path.  It performed a full getDataRange() + potential clearContents() +
    // setValues() on every single audit call, adding 0.5-1 s per write.  The
    // migration now only runs once during initialisation / setup (see
    // initializeSchool_ / warmSchoolCachesOnInit_).
    try {
      const ssLocal = _getOrCreateAuditSpreadsheet_();
      if (ssLocal) {
        let shLocal = _auditSheetByName_(ssLocal, ['auditlog', 'auditlogs', 'AuditLog', 'AuditLogs']);
        if (!shLocal) {
          shLocal = ssLocal.insertSheet('auditlog');
          shLocal.appendRow(['Timestamp','Json']);
          shLocal.setFrozenRows(1);
        }
        const localHeaders = shLocal.getRange(1, 1, 1, shLocal.getLastColumn()).getValues()[0];
        const localRow = _formatAuditRowByHeader_(localHeaders, {
          timestamp: timestamp,
          action: safeAction,
          target: safeTarget,
          actor: actor,
          permission: String(permUsed || ''),
          status: statusLabel,
          json: compactJson,
          detailsJson: compactJson,
          isError: !!isError
        });
        const writeLocal = _appendRowSafe_(shLocal, localRow, 3);
        if (!writeLocal.success) {
          _logAuditWriteFailure_('LOCAL_AUDIT', writeLocal.error, {
            action: safeAction,
            target: safeTarget,
            permission: String(permUsed || ''),
            status: statusLabel
          });
        }
      }
    } catch(e) {
      _logAuditWriteFailure_('LOCAL_AUDIT_EXCEPTION', (e && e.message) || String(e), {
        action: safeAction,
        target: safeTarget,
        permission: String(permUsed || ''),
        status: statusLabel
      });
      console.warn('Audit local ignoré.');
    }

    // --- 🌐 B. AUDIT MASTER (LOG SIMPLIFIÉ & SOUVERAIN) ---
    // PERF FIX: this branch now runs best-effort with no LockService.
    // Global_Audit_Logs is an append-only admin log; occasional duplicate rows
    // from concurrent writes are acceptable.  The lock was the main cost here
    // (~2-4 s per call) because waitLock(4000) blocks in series with the local
    // audit lock above.
    // On n'envoie PAS l'objet 'details' (pas de montants, pas de notes).
    try {
      const masterSS = SpreadsheetApp.openById(MASTER_AUTH_ID);
      let shMaster = masterSS.getSheetByName('Global_Audit_Logs');
      
      if (!shMaster) {
        shMaster = masterSS.insertSheet('Global_Audit_Logs');
        shMaster.appendRow(['DATE', 'ID_ECOLE', 'ACTION', 'POUR_QUOI', 'UTILISATEUR', 'PERMISSION', 'STATUT']);
        shMaster.setFrozenRows(1);
      }

      const masterHeaders = shMaster.getRange(1, 1, 1, shMaster.getLastColumn()).getValues()[0];
      const masterRow = masterHeaders.map(function(hdr) {
        const key = _auditNorm_(hdr);
        switch (key) {
          case 'DATE': return timestamp;
          case 'IDECOLE': return orgId;
          case 'ACTION': return safeAction;
          case 'POURQUOI':
          case 'CIBLE':
          case 'TARGET': return safeTarget;
          case 'UTILISATEUR':
          case 'ACTOR':
          case 'USER': return actor;
          case 'PERMISSION': return String(permUsed || '');
          case 'STATUT':
          case 'STATUS': return statusLabel;
          default: return '';
        }
      });
      const nextMasterRow = Math.max(1, shMaster.getLastRow() + 1);
      shMaster.getRange(nextMasterRow, 1, 1, masterRow.length).setValues([masterRow]);

    } catch (e) {
      _logAuditWriteFailure_('MASTER_AUDIT_EXCEPTION', (e && e.message) || String(e), {
        action: safeAction,
        target: safeTarget,
        permission: String(permUsed || ''),
        status: statusLabel
      });
      console.error("Erreur Master Audit : " + e.message);
    }

  } catch (criticalErr) {
    _logAuditWriteFailure_('AUDIT_CRITICAL', (criticalErr && criticalErr.message) || String(criticalErr), {
      action: String(action || 'UNKNOWN_ACTION'),
      target: String(target || 'SYSTEM')
    });
    console.error("Échec critique Audit : " + criticalErr.message);
  }
}

/**
 * Calcul unifié du solde impayé pour un élève.
 * Utilisée par getDashboardLiveStats_ ET getStudentFinanceProfile_
 * pour garantir des chiffres identiques.
 */
function _calcUnifiedStudentBalance_(sid, conf, paidByStudent, dueByStudent) {
  const TAG = '[_calcUnifiedStudentBalance_]';
  const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const expectedDue = toNum(getExpectedTuitionAmountForStudent_(sid, conf));
  const dueFromRows = toNum(dueByStudent ? dueByStudent[sid] || 0 : 0);
  const paid = toNum(paidByStudent ? paidByStudent[sid] || 0 : 0);
  // Use configured tuition as reference — avoid the "paid=due → 100%" fallback
  // when AmountDue is missing from Finance sheet rows.
  // If expectedDue is configured, it is the authoritative total.
  // If not configured, use dueFromRows. Never fall back to paid (avoids false 100%).
  const due = expectedDue > 0 ? expectedDue : Math.max(dueFromRows, 0);
  const outstanding = due > 0 ? Math.max(0, due - paid) : 0;
  console.log(TAG, 'sid=', sid, '| expectedDue=', expectedDue, '| dueFromRows=', dueFromRows, '| paid=', paid, '| due=', due, '| outstanding=', outstanding);
  return {
    due: due,
    paid: paid,
    outstanding: outstanding,
    configured: expectedDue > 0,
    financeConfigWarning: expectedDue <= 0 && dueFromRows <= 0
      ? 'Frais scolaires non configurés pour cet élève. Vérifiez la configuration Finance.'
      : ''
  };
}

/**
 * PATCH 2b — getDashboardLiveStats_ corrigé.
 * Remplace la fonction existante (ligne ~7183 du backend).
 * Le calcul des soldes est désormais unifié via _calcUnifiedStudentBalance_.
 */
function getDashboardLiveStats_PATCHED_(auth) {
  try {
    const ss = getSS_();
    let totalStudents = 0, totalPayments = 0, presentToday = 0, classCount = 0;
    let pendingPayments = 0, totalOutstanding = 0;
    let financeConfigOk = true, financeConfigWarning = '';

    const settingsRes = getSaaSSettings_(auth);
    const conf = (settingsRes && settingsRes.success && settingsRes.data) ? settingsRes.data : {};

    const toNumber = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    // Diagnostic config finance
    const financeDiag = _getFinanceConfigDiagnosticBackend_(conf);
    financeConfigOk = !!(financeDiag && financeDiag.ok);
    financeConfigWarning = financeDiag && financeDiag.warning ? String(financeDiag.warning) : '';

    // FIX: count only students with an ACTIVE history entry for the current year,
    // not all rows in the sheet (which includes inactive/dropped/retired students).
    try {
      const activeHistMap = _buildActiveHistoryMap(ss);
      totalStudents = Object.keys(activeHistMap).length;
    } catch(_countErr) {
      const shS = ss.getSheetByName('students');
      if (shS) totalStudents = Math.max(0, shS.getLastRow() - 1); // fallback
    }

    // Comptage classes actives
    try {
      const activeLevels = conf.ACTIVE_LEVELS
        ? (Array.isArray(conf.ACTIVE_LEVELS)
          ? conf.ACTIVE_LEVELS
          : (typeof conf.ACTIVE_LEVELS === 'string' ? JSON.parse(conf.ACTIVE_LEVELS) : []))
        : [];
      if (Array.isArray(activeLevels) && activeLevels.length) {
        classCount = activeLevels.filter(function(level) {
          return level && String(level.id || level.label || level.name || '').trim();
        }).length;
      }
    } catch (_classErr) {
      classCount = 0;
    }

    if (!classCount) {
      const shC = ss.getSheetByName('Classes');
      if (shC) classCount = Math.max(0, shC.getLastRow() - 1);
    }

    // Lecture Finance sheet
    const paidByStudent = {};
    const dueByStudent = {};
    const shF = ss.getSheetByName('Finance');
    if (shF && shF.getLastRow() > 1) {
      const fData = shF.getDataRange().getValues();
      const fH = fData[0].map(x => String(x).trim());
      const iAmt = fH.indexOf('Amount');
      const iAmtPaid = fH.indexOf('AmountPaid');
      const iDue = fH.indexOf('AmountDue');
      const iTotDue = fH.indexOf('TotalDue');
      const iSid = fH.indexOf('StudentID');

      fData.slice(1).forEach(r => {
        const paid = toNumber(iAmt >= 0 ? r[iAmt] : (iAmtPaid >= 0 ? r[iAmtPaid] : 0));
        // Only record AmountDue when it's explicitly set and > 0 (not defaulting to paid)
        const rawDue = toNumber(iDue >= 0 ? r[iDue] : (iTotDue >= 0 ? r[iTotDue] : 0));
        const dueCandidate = rawDue > 0 ? rawDue : 0; // Never fall back to paid here
        const sid = String(iSid >= 0 ? (r[iSid] || '') : '').trim().toUpperCase();
        totalPayments += paid;
        if (sid) {
          paidByStudent[sid] = (paidByStudent[sid] || 0) + paid;
          // Keep max of explicit AmountDue stamps (don't accumulate per-instalment)
          if (dueCandidate > (dueByStudent[sid] || 0)) dueByStudent[sid] = dueCandidate;
        }
      });
    }

    // Calcul des soldes — UNIFIED via _calcUnifiedStudentBalance_
    const allStudents = getAllStudents_() || [];
    const studentIds = {};
    allStudents.forEach(stu => {
      const sid = String(stu.StudentID || stu.StudentCode || stu.studentId || stu.id || '').trim().toUpperCase();
      if (sid) studentIds[sid] = true;
    });
    Object.keys(paidByStudent).forEach(sid => { studentIds[sid] = true; });
    Object.keys(dueByStudent).forEach(sid => { studentIds[sid] = true; });

    pendingPayments = 0;
    totalOutstanding = 0;
    Object.keys(studentIds).forEach(sid => {
      const normalizedSid = String(sid || '').toUpperCase();
      const paidBySidLookup = {};
      const dueBySidLookup = {};
      Object.keys(paidByStudent).forEach(k => { paidBySidLookup[k.toUpperCase()] = paidByStudent[k]; });
      Object.keys(dueByStudent).forEach(k => { dueBySidLookup[k.toUpperCase()] = dueByStudent[k]; });

      const balance = _calcUnifiedStudentBalance_(normalizedSid, conf, paidBySidLookup, dueBySidLookup);
      if (balance.outstanding > 0.001) pendingPayments++;
      totalOutstanding += balance.outstanding;
    });

    // Présences du jour
    const shA = ss.getSheetByName('attendance');
    if (shA && shA.getLastRow() > 1) {
      const tz = Session.getScriptTimeZone();
      const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      const aData = shA.getDataRange().getValues();
      const aH = aData[0].map(x => String(x).toUpperCase());
      const iDate = aH.indexOf('DATE');
      aData.slice(1).forEach(r => {
        const d = r[iDate] instanceof Date
          ? Utilities.formatDate(r[iDate], tz, 'yyyy-MM-dd')
          : String(r[iDate]);
        if (d === today) presentToday++;
      });
    }

    return {
      success: true,
      data: {
        totalStudents,
        classCount,
        totalPayments: totalPayments.toFixed(2),
        collecte: Number(totalPayments.toFixed(2)),
        presentToday,
        pendingPayments,
        unpaidCount: pendingPayments,
        outstanding: Number(totalOutstanding.toFixed(2)),
        financeConfigOk,
        financeConfigWarning
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * PATCH 2c — getStudentFinanceProfile_ corrigé.
 * Utilise _calcUnifiedStudentBalance_ pour cohérence avec le dashboard.
 */
function getStudentFinanceProfile_PATCHED_(studentId, auth) {
  try {
    let sid = studentId;
    if (typeof studentId === 'object' && studentId !== null) {
      sid = studentId.studentId || studentId.id || studentId;
    }
    if (!sid || sid === 'undefined' || sid === 'null') {
      return { success: true, totalPaid: 0, totalDebt: 0, transactions: [] };
    }

    const result = getStudentPayments_({ studentId: sid }, auth);
    if (!result.success) return { success: false, error: result.error };

    const confRes = getSaaSSettings_(auth);
    const conf = (confRes && confRes.success && confRes.data) ? confRes.data : {};

    let totalPaid = 0;
    let dueFromRows = 0;
    let lastPaymentDate = '';

    const paidByStudent = {};
    const dueByStudent = {};

    const transactions = result.data.map(r => {
      const amt = parseFloat(r.Amount || 0);
      const due = parseFloat(r.AmountDue || r.TotalDue || r.Amount || 0);
      const normalizedPaid = isNaN(amt) ? 0 : amt;
      const normalizedDue = isNaN(due) ? normalizedPaid : due;

      totalPaid += normalizedPaid;
      dueFromRows += Math.max(normalizedDue, normalizedPaid);

      const rowDate = r.Date instanceof Date
        ? Utilities.formatDate(r.Date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.Date || '').trim();
      if (rowDate && rowDate > lastPaymentDate) lastPaymentDate = rowDate;

      return {
        date: r.Date,
        amount: normalizedPaid,
        description: r.Type || r.Description || 'Versement',
        status: r.Status,
        type: r.Type
      };
    });

    const sidKey = String(sid).toUpperCase();
    paidByStudent[sidKey] = totalPaid;
    dueByStudent[sidKey] = dueFromRows;

    const balance = _calcUnifiedStudentBalance_(sidKey, conf, paidByStudent, dueByStudent);

    return {
      success: true,
      totalPaid: balance.paid,
      totalDue: balance.due,
      totalDebt: balance.outstanding,
      outstanding: balance.outstanding,
      // Fix 8: getStudentFinanceSummary and getStudentFinanceProfile share this handler.
      // The frontend's getStudentFinanceSummary consumer checks for totalFees / balance / payments.
      // Expose those aliases so both callers get what they expect from a single handler.
      totalFees:  balance.due,
      balance:    balance.outstanding,
      payments:   transactions.slice().reverse(), // same data as transactions, named alias
      financeConfigOk: balance.configured || balance.due > 0,
      financeConfigWarning: balance.financeConfigWarning,
      lastPaymentDate,
      transactions: transactions.reverse()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Alias pour que l'apiHub appelle les versions patchées
function getDashboardLiveStats_(auth) { return getDashboardLiveStats_PATCHED_(auth); }
// Note: getStudentFinanceProfile_ est déjà dans le switch — remplacer son appel
// en changeant la ligne case 'getStudentFinanceProfile': dans apiHub par :
// result = getStudentFinanceProfile_PATCHED_(...);

// ────────────────────────────────────────────────────────────
// PATCH 3 — DIAGNOSTIC FINANCE (helper partagé)
// ────────────────────────────────────────────────────────────
function _getFinanceConfigDiagnosticBackend_(conf) {
  try {
    const TAG = '[_getFinanceConfigDiagnosticBackend_]';
    const toNumber = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const hasPositive = v => toNumber(v) > 0;
    const mode = String(conf.TUITION_MODE || 'GLOBAL').trim().toUpperCase();
    console.log(TAG, 'TUITION_MODE=', mode, '| FIN_PAYMENT_PLANS present=', !!(conf.FIN_PAYMENT_PLANS));

    // ── Modern FIN_PAYMENT_PLANS check (primary config path) ──────────────
    var finPlansRaw = conf.FIN_PAYMENT_PLANS;
    var finPlans = {};
    if (finPlansRaw) {
      if (typeof finPlansRaw === 'object') { finPlans = finPlansRaw; }
      else { try { finPlans = JSON.parse(finPlansRaw) || {}; } catch(_pe) { console.warn(TAG, 'FIN_PAYMENT_PLANS parse error', _pe.message); } }
    }
    const finPlanHasAmount = function(plan) {
      if (!plan || typeof plan !== 'object') return false;
      if (toNumber(plan.instTotal) > 0) return true;
      if (plan.monthly && toNumber(plan.monthly.amount) > 0) return true;
      if (Array.isArray(plan.installments)) {
        return plan.installments.some(function(i){ return toNumber(i && i.amount) > 0; });
      }
      return false;
    };
    const finKeys = Object.keys(finPlans);
    const hasCyclePlan    = finKeys.some(function(k){ return /^cycle_/.test(k) && finPlanHasAmount(finPlans[k]); });
    const hasClassPlanFin = finKeys.some(function(k){ return /^class_/.test(k) && finPlanHasAmount(finPlans[k]); });
    const hasGlobalPlanFin = finPlanHasAmount(finPlans['global']);
    const hasAnyFinPlan = hasCyclePlan || hasClassPlanFin || hasGlobalPlanFin;
    console.log(TAG, 'FIN_PAYMENT_PLANS keys=', finKeys.length, '| hasCyclePlan=', hasCyclePlan, '| hasClassPlanFin=', hasClassPlanFin, '| hasGlobalPlanFin=', hasGlobalPlanFin);

    // ── Legacy classPaymentPlans ──────────────────────────────────────────
    const classPlans = parseTuitionConfigValue_(conf.classPaymentPlans) || {};
    const classPlanConfiguredCount = Object.keys(classPlans).filter(k => {
      const entry = classPlans[k];
      if (!entry || typeof entry !== 'object') return false;
      if (toNumber(entry.totalAmount || entry.amount) > 0) return true;
      const predTotal = (Array.isArray(entry.predefinedPayments) ? entry.predefinedPayments : [])
        .reduce((s, r) => s + toNumber((r && r.amount) || 0), 0);
      return predTotal > 0;
    }).length;
    const hasClassPlanAmount = classPlanConfiguredCount > 0 || hasAnyFinPlan;
    console.log(TAG, 'classPaymentPlans configured count=', classPlanConfiguredCount, '| hasClassPlanAmount=', hasClassPlanAmount);

    // ── If FIN_PAYMENT_PLANS has any valid plan → immediately OK ──────────
    if (hasAnyFinPlan) {
      console.log(TAG, '→ FIN_PAYMENT_PLANS has valid amounts → ok:true');
      return { ok: true, warning: '' };
    }

    if (mode === 'BY_CLASS') {
      const byClass = parseTuitionConfigValue_(conf.TUITION_BY_CLASS) || {};
      const configured = Object.keys(byClass).filter(k => hasPositive(byClass[k])).length;
      console.log(TAG, 'BY_CLASS mode: TUITION_BY_CLASS configured count=', configured);
      if (!configured && !hasClassPlanAmount) {
        return { ok: false, warning: 'Configuration frais incomplète: aucun montant par classe défini.' };
      }
      return { ok: true, warning: '' };
    }
    if (mode === 'BY_CYCLE') {
      const byCycle = parseTuitionConfigValue_(conf.TUITION_BY_CYCLE) || {};
      const configured = Object.keys(byCycle).filter(k => hasPositive(byCycle[k])).length;
      console.log(TAG, 'BY_CYCLE mode: TUITION_BY_CYCLE configured count=', configured, '| hasCyclePlan=', hasCyclePlan);
      if (!configured && !hasCyclePlan && !hasClassPlanAmount) {
        return { ok: false, warning: 'Configuration frais incomplète: aucun montant par cycle défini.' };
      }
      return { ok: true, warning: '' };
    }
    // GLOBAL
    const globalOk = hasPositive(conf.TUITION_AMOUNT_GLOBAL) || hasPositive(conf.TUITION_AMOUNT) || hasClassPlanAmount;
    console.log(TAG, 'GLOBAL mode: TUITION_AMOUNT_GLOBAL=', conf.TUITION_AMOUNT_GLOBAL, '| TUITION_AMOUNT=', conf.TUITION_AMOUNT, '| globalOk=', globalOk);
    if (!globalOk) {
      return { ok: false, warning: 'Configuration frais incomplète: montant global de scolarité manquant.' };
    }
    return { ok: true, warning: '' };
  } catch (e) {
    console.error('[_getFinanceConfigDiagnosticBackend_] threw:', e.message);
    return { ok: false, warning: 'Configuration frais indisponible: ' + (e.message || 'erreur inconnue') };
  }
}

// ────────────────────────────────────────────────────────────
// PATCH 4 — WHATSAPP API : Envoi de messages
// Ajouter 'sendWhatsApp' dans le switch de l'apiHub
// ────────────────────────────────────────────────────────────
function sendWhatsAppMessage_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    if (!viewer.permissions || !viewer.permissions.pa_send_broadcast) {
      return { success: false, error: 'Permission manquante: pa_send_broadcast.' };
    }

    const provider = String(data.provider || '').toLowerCase().trim();
    const phone = String(data.phone || '').replace(/\D/g, '');
    const message = String(data.message || '').trim();
    const apiKey = String(data.apiKey || '').trim();
    const instanceId = String(data.instanceId || '').trim();

    if (!phone || !message) return { success: false, error: 'Numéro et message requis.' };
    if (!provider) return { success: false, error: 'Provider WhatsApp non configuré.' };
    if (!apiKey) return { success: false, error: 'Clé API WhatsApp manquante.' };

    let resp;

    if (provider === 'callmebot') {
      const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone)
        + '&text=' + encodeURIComponent(message) + '&apikey=' + encodeURIComponent(apiKey);
      resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const ok = resp.getResponseCode() === 200;
      writeAuditLog_('WHATSAPP_SENT', phone, provider + ':' + (ok ? 'OK' : 'FAIL'), 'pa_send_broadcast', !ok);
      return { success: ok, message: ok ? 'Envoyé via CallMeBot.' : 'Échec CallMeBot: ' + resp.getContentText().slice(0, 120) };
    }

    if (provider === 'ultramsg') {
      if (!instanceId) return { success: false, error: 'instanceId requis pour UltraMsg.' };
      resp = UrlFetchApp.fetch('https://api.ultramsg.com/' + instanceId + '/messages/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        payload: 'token=' + encodeURIComponent(apiKey) + '&to=' + encodeURIComponent(phone) + '&body=' + encodeURIComponent(message),
        muteHttpExceptions: true
      });
      const r = JSON.parse(resp.getContentText() || '{}');
      const ok = !!(r.sent || (r.message && !r.error));
      writeAuditLog_('WHATSAPP_SENT', phone, provider + ':' + (ok ? 'OK' : 'FAIL'), 'pa_send_broadcast', !ok);
      return { success: ok, message: r.message || (ok ? 'Envoyé.' : 'Échec.') };
    }

    if (provider === 'wati') {
      if (!instanceId) return { success: false, error: 'instanceId (URL WATI) requis.' };
      resp = UrlFetchApp.fetch(instanceId + '/api/v1/sendMessage/' + encodeURIComponent(phone), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        payload: JSON.stringify({ messageText: message }),
        muteHttpExceptions: true
      });
      const ok = resp.getResponseCode() < 300;
      writeAuditLog_('WHATSAPP_SENT', phone, provider + ':' + (ok ? 'OK' : resp.getResponseCode()), 'pa_send_broadcast', !ok);
      return { success: ok, message: ok ? 'Envoyé via WATI.' : 'Échec WATI: ' + resp.getResponseCode() };
    }

    if (provider === '360dialog') {
      resp = UrlFetchApp.fetch('https://waba.360dialog.io/v1/messages', {
        method: 'POST',
        headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { body: message }
        }),
        muteHttpExceptions: true
      });
      const ok = resp.getResponseCode() === 201 || resp.getResponseCode() === 200;
      writeAuditLog_('WHATSAPP_SENT', phone, provider + ':' + (ok ? 'OK' : resp.getResponseCode()), 'pa_send_broadcast', !ok);
      return { success: ok, message: ok ? 'Envoyé via 360dialog.' : 'Échec: ' + resp.getResponseCode() };
    }

    return { success: false, error: 'Provider non supporté: ' + provider + '. Supportés: callmebot, ultramsg, wati, 360dialog.' };
  } catch (e) {
    return { success: false, error: 'Erreur WhatsApp: ' + e.message };
  }
}

// INSTRUCTION : Dans le switch de apiHub_, ajouter AVANT le default:
// case 'sendWhatsApp': result = sendWhatsAppMessage_(data, auth); break;

// ────────────────────────────────────────────────────────────
// PATCH 5 — PHOTO UTILISATEUR : Flush forcé + invalidation cache
// Remplace updateMyProfilePhoto_ existante
// ────────────────────────────────────────────────────────────
function updateMyProfilePhoto_PATCHED_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

    const photo = String((data && (data.photo || data.photoUrl || data.avatarUrl || data.PhotoURL)) || '').trim();
    if (!photo) return { success: false, error: 'Photo manquante.' };
    if (!/^(data:image\/|https?:\/\/|blob:|\/)/i.test(photo)) {
      return { success: false, error: 'Format de photo non valide (requis: data:image/, http, ou URL).' };
    }

    const MAX_CHARS = 48000;
    if (photo.length > MAX_CHARS) {
      return {
        success: false,
        error: 'Photo trop volumineuse (' + Math.round(photo.length / 1024) + ' Ko). Maximum: ' + Math.round(MAX_CHARS / 1024) + ' Ko. Compressez l\'image avant d\'envoyer.'
      };
    }

    const ss = getSS_();
    const sh = ensureUsersSheetStructure_(ss);
    const rows = sh.getDataRange().getValues();
    if (!rows || rows.length < 2) return { success: false, error: 'Aucun utilisateur à mettre à jour.' };

    const headers = rows[0].map(x => String(x).trim().toLowerCase());
    const find = arr => headers.findIndex(x => arr.some(v => x.replace(/[\s_]/g, '') === v.replace(/[\s_]/g, '')));
    const iEmail = find(['email']);
    const iUserId = find(['userid', 'id']);
    const iPhoto = find(['photo', 'photourl', 'avatarurl', 'picture']);

    if (iEmail === -1) return { success: false, error: 'Colonne Email manquante dans la feuille Users.' };
    if (iPhoto === -1) return { success: false, error: 'Colonne PhotoURL manquante dans la feuille Users. Ajoutez-la et réessayez.' };

    const targetEmail = String(viewer.email || '').toLowerCase().trim();
    const targetUserId = String(viewer.userId || '').trim();
    let rowIdx = -1;

    if (targetUserId && iUserId !== -1) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][iUserId] || '').trim() === targetUserId) { rowIdx = i; break; }
      }
    }
    if (rowIdx === -1 && targetEmail) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][iEmail] || '').toLowerCase().trim() === targetEmail) { rowIdx = i; break; }
      }
    }
    if (rowIdx === -1) return { success: false, error: 'Compte introuvable pour mise à jour de photo.' };

    // Écriture + flush forcé
    sh.getRange(rowIdx + 1, iPhoto + 1).setValue(photo);
    SpreadsheetApp.flush(); // ← CRITIQUE: forcer l'écriture immédiate

    // Invalider TOUS les caches liés à ce viewer
    const tokenStr = normalizeAuthToken_(auth && (auth.token || auth));
    const cacheService = CacheService.getScriptCache();
    const keysToInvalidate = [];
    if (tokenStr && tokenStr.length > 4) keysToInvalidate.push('VIEWER_' + tokenStr);
    if (targetEmail) keysToInvalidate.push('VIEWER_' + targetEmail);

    keysToInvalidate.forEach(key => {
      try { cacheService.remove(key); } catch (_) {}
    });

    writeAuditLog_('PHOTO_UPDATE', targetEmail, 'Photo mise à jour (' + Math.round(photo.length / 1024) + ' Ko)', 'p_pic');

    return { success: true, message: 'Photo de profil mise à jour avec succès.', photo: photo };
  } catch (e) {
    const msg = String((e && e.message) || e || 'Erreur inconnue');
    if (/limit|max|too large|too long|string/i.test(msg)) {
      return { success: false, error: 'Photo trop volumineuse. Réduisez sa taille (< 48 Ko) et réessayez.' };
    }
    return { success: false, error: 'Échec mise à jour photo: ' + msg };
  }
}

// Alias: remplace la version existante automatiquement
// INSTRUCTION: Dans le switch de apiHub_, remplacer:
// case 'updateMyProfilePhoto': result = updateMyProfilePhoto_(data, auth); break;
// par:
// case 'updateMyProfilePhoto': result = updateMyProfilePhoto_PATCHED_(data, auth); break;

// ────────────────────────────────────────────────────────────
// PATCH 6 — TIMELINE ÉLÈVE : Jamais vide
// Garantit qu'un élève existant a toujours au moins son inscription
// ────────────────────────────────────────────────────────────
function getStudentHistory_PATCHED_(data, auth) {
  try {
    const sid = String(typeof data === 'string' ? data : (data && (data.studentId || data.id) || '')).trim();
    if (!sid) return { success: false, error: 'Identifiant élève manquant.' };

    const viewer = auth ? getViewerInfo_(auth) : null;
    if (viewer && !viewer.success) return { success: false, error: viewer.error };

    const ss = getSS_();
    const sh = ss.getSheetByName('studenthistory');
    let history = [];

    if (sh && sh.getLastRow() > 1) {
      const rawData = sh.getDataRange().getValues();
      const h = rawData[0].map(x => String(x).trim());
      const iSid = h.indexOf('StudentID');
      if (iSid !== -1) {
        history = rawData.slice(1)
          .filter(r => String(r[iSid] || '').trim().toUpperCase() === sid.toUpperCase())
          .map(r => {
            const obj = {};
            h.forEach((key, i) => {
              obj[key] = r[i] instanceof Date
                ? Utilities.formatDate(r[i], Session.getScriptTimeZone(), 'yyyy-MM-dd')
                : r[i];
            });
            return obj;
          });
      }
    }

    // PATCH: Si l'historique est vide, construire depuis les données élève
    if (!history.length) {
      const studentData = getStudentById_({ id: sid }, auth);
      if (studentData && studentData.success && studentData.data) {
        const stu = studentData.data;
        const conf = getSaaSSettings_().data || {};
        history = [{
          HistoryID: 'HIST-AUTO-' + sid,
          StudentID: sid,
          GradeLevelID: stu.CurrentLevel || stu.grade || stu.currentLevel || 'Non renseigné',
          SchoolYear: conf.ACADEMIC_YEAR || stu.SchoolYear || new Date().getFullYear() + '-' + (new Date().getFullYear() + 1),
          Section: stu.Section || 'A',
          Status: 'ACTIVE',
          Timestamp: stu.CreatedAt || stu.createdAt || new Date().toISOString(),
          level: stu.CurrentLevel || stu.grade || stu.currentLevel || '',
          section: stu.Section || 'A',
          year: conf.ACADEMIC_YEAR || stu.SchoolYear || '',
          historyId: 'HIST-AUTO-' + sid,
          _autoGenerated: true
        }];
      }
    }

    // Normalisation + enrichissement avec moyenne annuelle calculée depuis grades
    const normalized = history.map(h => {
      const histId = String(h.HistoryID || h.historyId || '').trim();
      let avg = null;
      if (histId && !histId.startsWith('HIST-AUTO-')) {
        try {
          const scores = getStudentScores_(sid, '', histId);
          if (scores && scores.length) {
            const nums = scores.map(s => Number(s.Score || 0)).filter(n => !isNaN(n) && n > 0);
            if (nums.length) avg = parseFloat((nums.reduce((a,b) => a+b, 0) / nums.length).toFixed(2));
          }
        } catch(_) {}
      }
      return {
        ...h,
        level: h.GradeLevelID || h.level || h.currentLevel || '',
        section: h.Section || h.section || 'A',
        year: h.SchoolYear || h.year || '',
        historyId: histId,
        status: h.Status || h.status || 'ACTIVE',
        Avg: avg,
        avg: avg,
        Average: avg
      };
    });

    return { success: true, data: normalized };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────
// PATCH 7 — ALERTES SYSTÈMES : Endpoint pour les alertes enseignants
// ────────────────────────────────────────────────────────────
function _notificationReadMapKey_(email) {
  return 'NOTIF_READ_' + String(email || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function _getUserNotificationReadMap_(email) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = String(props.getProperty(_notificationReadMapKey_(email)) || '').trim();
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function _setUserNotificationReadMap_(email, mapObj) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(_notificationReadMapKey_(email), JSON.stringify(mapObj || {}));
  } catch (_e) {}
}

function _buildAiIncidentAlerts_(ss, conf, now, tz) {
  var alerts = [];

  // 1) Missing critical configuration
  try {
    var curriculum = _readFullCurriculum(ss) || {};
    var currKeys = Object.keys(curriculum || {});
    var hasCurriculum = currKeys.some(function(k) {
      return Array.isArray(curriculum[k]) && curriculum[k].length > 0;
    });
    var hasAcademicYear = !!String((conf && (conf.ACADEMIC_YEAR || conf.currentAcademicYear || conf.academicYear)) || '').trim();
    var hasTuition = Number(conf && (conf.TUITION_AMOUNT_GLOBAL || conf.TUITION_AMOUNT || 0)) > 0;

    if (!hasAcademicYear || !hasCurriculum || !hasTuition) {
      var missing = [];
      if (!hasAcademicYear) missing.push('année scolaire');
      if (!hasCurriculum) missing.push('curriculum');
      if (!hasTuition) missing.push('frais de scolarité');
      alerts.push({
        id: 'ai-missing-config',
        type: 'ALERT',
        severity: 'HIGH',
        icon: '⚙️',
        category: 'CONFIG',
        title: 'Configuration incomplète détectée',
        detail: 'Éléments manquants: ' + missing.join(', ') + '. Action requise pour sécuriser l\'exploitation.',
        actionLabel: 'Ouvrir configuration',
        actionTarget: 'settings',
        timestamp: now.toISOString()
      });
    }
  } catch (_cfgErr) {}

  // 2) Students at pedagogical risk from grades
  try {
    var gsh = ss.getSheetByName('grades');
    if (gsh && gsh.getLastRow() > 1) {
      var gData = gsh.getDataRange().getValues();
      var gH = gData[0].map(function(x) { return String(x || '').trim().toUpperCase(); });
      var iSid = gH.indexOf('STUDENTID');
      var iScore = gH.indexOf('SCORE');
      if (iSid !== -1 && iScore !== -1) {
        var buckets = {};
        for (var i = 1; i < gData.length; i++) {
          var sid = String(gData[i][iSid] || '').trim();
          var sc = Number(gData[i][iScore] || 0);
          if (!sid || !Number.isFinite(sc)) continue;
          if (!buckets[sid]) buckets[sid] = { sum: 0, n: 0, max: 0 };
          buckets[sid].sum += sc;
          buckets[sid].n += 1;
          if (sc > buckets[sid].max) buckets[sid].max = sc;
        }

        var riskIds = [];
        Object.keys(buckets).forEach(function(sid) {
          var b = buckets[sid];
          if (!b || !b.n) return;
          var avg = b.sum / b.n;
          // Auto-handle either /20 or /100 scoring scales.
          var isScale20 = b.max <= 20;
          var threshold = isScale20 ? 10 : 50;
          if (b.n >= 3 && avg < threshold) {
            riskIds.push(sid + ' (' + avg.toFixed(1) + (isScale20 ? '/20' : '/100') + ')');
          }
        });

        if (riskIds.length) {
          alerts.push({
            id: 'ai-pedagogic-risk-' + Utilities.formatDate(now, tz, 'yyyyMMdd'),
            type: 'ALERT',
            severity: 'HIGH',
            icon: '📉',
            category: 'ACADEMIC',
            title: 'Élèves à risque pédagogique',
            detail: riskIds.length + ' élève(s) sous le seuil académique: ' + riskIds.slice(0, 8).join(', ') + (riskIds.length > 8 ? ' ...' : ''),
            actionLabel: 'Analyser les dossiers',
            actionTarget: 'reports',
            timestamp: now.toISOString()
          });
        }
      }
    }
  } catch (_gradeErr) {}

  // 3) Students with outstanding balances
  try {
    var fsh = ss.getSheetByName('Finance');
    if (fsh && fsh.getLastRow() > 1) {
      var fData = fsh.getDataRange().getValues();
      var fH = fData[0].map(function(x) { return String(x || '').trim().toUpperCase(); });
      var iFSid = fH.findIndex(function(h) { return ['STUDENTID', 'STUDENTCODE', 'STUDENT_ID'].indexOf(h) !== -1; });
      var iAmt = fH.findIndex(function(h) { return ['AMOUNT', 'AMOUNTPAID'].indexOf(h) !== -1; });
      var iDue = fH.findIndex(function(h) { return ['AMOUNTDUE', 'TOTALDUE', 'EXPECTEDAMOUNT'].indexOf(h) !== -1; });
      var iStatus = fH.findIndex(function(h) { return ['STATUS', 'STATUT'].indexOf(h) !== -1; });
      if (iFSid !== -1 && iAmt !== -1) {
        var balances = {};
        for (var j = 1; j < fData.length; j++) {
          var fsid = String(fData[j][iFSid] || '').trim();
          if (!fsid) continue;
          var paid = Number(fData[j][iAmt] || 0);
          var due = iDue !== -1 ? Number(fData[j][iDue] || paid) : paid;
          var st = iStatus !== -1 ? String(fData[j][iStatus] || '').toUpperCase().trim() : '';
          var delta = Number.isFinite(due - paid) ? Math.max(0, due - paid) : 0;
          if (/PENDING|PARTIAL|UNPAID|IMPAYE|EN\s*ATTENTE/.test(st) || delta > 0) {
            balances[fsid] = (balances[fsid] || 0) + delta;
          }
        }
        var debtIds = Object.keys(balances).filter(function(k) { return balances[k] > 0; });
        if (debtIds.length) {
          var totalDebt = debtIds.reduce(function(sum, sid) { return sum + Number(balances[sid] || 0); }, 0);
          alerts.push({
            id: 'ai-finance-balance-' + Utilities.formatDate(now, tz, 'yyyyMMdd'),
            type: 'WARNING',
            severity: 'MEDIUM',
            icon: '💰',
            category: 'FINANCE',
            title: 'Élèves avec balances en souffrance',
            detail: debtIds.length + ' élève(s) ont un solde dû. Total estimé: ' + totalDebt.toFixed(2) + '. Exemples: ' + debtIds.slice(0, 8).join(', ') + (debtIds.length > 8 ? ' ...' : ''),
            actionLabel: 'Ouvrir finance',
            actionTarget: 'finance',
            timestamp: now.toISOString()
          });
        }
      }
    }
  } catch (_finErr) {}

  return alerts;
}

function _canViewerSeeAlertCategory_(viewer, category) {
  var cat = String(category || '').toUpperCase();
  if (viewer && (viewer.isMaster || viewer.isGodMode)) return true;
  if (cat === 'STAFF') return _viewerCanAccessAiSection_(viewer, 'staff');
  if (cat === 'ATTENDANCE') return _viewerCanAccessAiSection_(viewer, 'attendance');
  if (cat === 'ACADEMIC') return _viewerCanAccessAiSection_(viewer, 'grades') || _viewerCanAccessAiSection_(viewer, 'students');
  if (cat === 'FINANCE') return _viewerCanAccessAiSection_(viewer, 'finance');
  if (cat === 'CONFIG') return _viewerCanAccessAiSection_(viewer, 'settings');
  return true;
}

function _filterAlertsForViewer_(viewer, alerts) {
  var input = Array.isArray(alerts) ? alerts : [];
  return input.filter(function(a) {
    if (!a || typeof a !== 'object') return false;
    return _canViewerSeeAlertCategory_(viewer, a.category);
  });
}

function getSystemAlerts_(auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

    const ss = getSS_();
    const conf = getSaaSSettings_().data || {};
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const hour = parseInt(Utilities.formatDate(now, tz, 'HH'));
    const isSchoolHours = hour >= 7 && hour <= 17;
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const alerts = [];

    // 1. Vérifier les classes/salles sans enseignant
    const activeLevels = conf.ACTIVE_LEVELS
      ? (Array.isArray(conf.ACTIVE_LEVELS) ? conf.ACTIVE_LEVELS : (typeof conf.ACTIVE_LEVELS === 'string' ? JSON.parse(conf.ACTIVE_LEVELS) : []))
      : [];
    const classesFromSheet = [];
    try {
      var classSheet = ss.getSheetByName('Classes') || ss.getSheetByName('classes');
      if (classSheet && classSheet.getLastRow() > 1) {
        var cData = classSheet.getDataRange().getValues();
        var cH = cData[0].map(function(x) { return String(x || '').trim().toUpperCase(); });
        var iClassName = cH.findIndex(function(h) { return ['CLASSNAME', 'NAME', 'CLASS', 'GRADELEVELID'].indexOf(h) !== -1; });
        if (iClassName !== -1) {
          cData.slice(1).forEach(function(r) {
            var cls = String(r[iClassName] || '').trim();
            if (cls) classesFromSheet.push(cls);
          });
        }
      }
    } catch (_classErr) {}

    const classesToCheck = [];
    activeLevels.forEach(function(level) {
      var levelId = String(level.id || level.label || level || '').trim();
      if (levelId && classesToCheck.indexOf(levelId) === -1) classesToCheck.push(levelId);
    });
    classesFromSheet.forEach(function(cls) {
      if (cls && classesToCheck.indexOf(cls) === -1) classesToCheck.push(cls);
    });
    const taSheet = ss.getSheetByName(TEACHER_ASSIGNMENTS_SHEET_NAME);
    const assignments = [];
    if (taSheet && taSheet.getLastRow() > 1) {
      const taData = taSheet.getDataRange().getValues();
      const taH = taData[0].map(x => String(x).trim());
      const iCls = taH.indexOf('ClassName');
      const iTeacher = taH.indexOf('TeacherName');
      const iDay = taH.indexOf('Day');
      const iActive = taH.indexOf('Active');
      taData.slice(1).forEach(r => {
        if (iActive !== -1 && String(r[iActive] || 'TRUE').toUpperCase() === 'FALSE') return;
        assignments.push({
          className: iCls !== -1 ? String(r[iCls] || '') : '',
          teacher: iTeacher !== -1 ? String(r[iTeacher] || '') : '',
          day: iDay !== -1 ? String(r[iDay] || '') : '',
          startTime: taH.indexOf('StartTime') !== -1 ? String(r[taH.indexOf('StartTime')] || '') : ''
        });
      });
    }

    // ── SCHOOL-DAY GUARD — skip teacher alerts on weekends / no-class days ──
    const dayOfWeek = now.getDay(); // 0=Sunday, 6=Saturday
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    // Parse configured no-class weekdays (stored as comma-separated French names or date strings)
    const noClassWeekdaysList = String(conf.NO_CLASS_WEEKDAYS || '').split(',')
      .map(function(s) { return String(s || '').trim().toLowerCase(); }).filter(Boolean);
    const noClassDatesList = String(conf.NO_CLASS_DATES || '').split(',')
      .map(function(s) { return String(s || '').trim().slice(0, 10); }).filter(Boolean);
    let noClassFromJson = [];
    try {
      var _ncRules = typeof conf.NO_CLASS_RULES_JSON === 'string' ? JSON.parse(conf.NO_CLASS_RULES_JSON || '[]') : (conf.NO_CLASS_RULES_JSON || []);
      if (Array.isArray(_ncRules)) noClassFromJson = _ncRules.map(function(r) { return String((r && r.date) || '').slice(0, 10); }).filter(Boolean);
    } catch (_) {}
    const frWeekdays = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const todayFrWeekday = frWeekdays[dayOfWeek] || '';
    const isNoClassWeekday = noClassWeekdaysList.some(function(w) { return w === todayFrWeekday || w.startsWith(todayFrWeekday.slice(0, 3)); });
    const isNoClassDate = noClassDatesList.includes(today) || noClassFromJson.includes(today);
    const autoWeekend = String(conf.NO_CLASS_WEEKDAYS_AUTO || '1') !== '0';
    const isSchoolDay = !(autoWeekend && isWeekend) && !isNoClassWeekday && !isNoClassDate;

    // Helper: convert a level ID (fond_1af, sec_ns1, mat_k1 …) to a display label
    const _levelDisplayName_ = (function() {
      const MAP = {
        'mat_k1':'K1','mat_k2':'K2','mat_k3':'K3',
        'fond_1af':'1re AF','fond_2af':'2me AF','fond_3af':'3me AF','fond_4af':'4me AF',
        'fond_5af':'5me AF','fond_6af':'6me AF','fond_7af':'7me AF','fond_8af':'8me AF','fond_9af':'9me AF',
        'sec_ns1':'NS1','sec_ns2':'NS2','sec_ns3':'NS3','sec_ns4':'NS4',
        'sec_rheto':'Rhéto','sec_philo':'Philo','sec_term':'Terminale'
      };
      // Also try to read from AI_LIB_LEVELS rows cached in memory if available
      try {
        var lvlRows = _getAiLevelRows_ && _getAiLevelRows_();
        if (Array.isArray(lvlRows)) {
          lvlRows.forEach(function(r) {
            if (r && r[0] && r[1]) MAP[String(r[0]).toLowerCase()] = String(r[1]);
          });
        }
      } catch (_) {}
      return function(id) {
        var key = String(id || '').toLowerCase().trim();
        return MAP[key] || id; // fallback to raw id if not found
      };
    })();

    if (isSchoolDay) {
      classesToCheck.forEach(levelId => {
        const hasTeacher = assignments.some(a => String(a.className || '').trim() === levelId);
        if (!hasTeacher) {
          const displayName = _levelDisplayName_(levelId);
          alerts.push({
            id: 'no-teacher-' + levelId,
            type: 'WARNING',
            severity: 'HIGH',
            icon: '⚠️',
            category: 'STAFF',
            title: 'Classe sans professeur : ' + displayName,
            detail: 'Aucun professeur n\'est affecté à la classe ' + displayName + ' dans l\'emploi du temps.',
            actionLabel: 'Affecter un enseignant',
            actionTarget: 'teacher-affectation',
            timestamp: now.toISOString()
          });
        }
      });
    }

    // 2. Enseignants potentiellement en retard (heures de cours uniquement)
    if (isSchoolHours) {
      const lateThreshold = parseInt(conf.ATTENDANCE_ADMIN_ALERT_MIN || '10');
      const staffAttSheet = ss.getSheetByName('staff_attendance') || ss.getSheetByName('StaffAttendance');
      const clockedToday = new Set();

      if (staffAttSheet && staffAttSheet.getLastRow() > 1) {
        const saData = staffAttSheet.getDataRange().getValues();
        const saH = saData[0].map(x => String(x).trim().toUpperCase());
        const iEmail = saH.indexOf('EMAIL');
        const iDate = saH.indexOf('DATE');
        saData.slice(1).forEach(r => {
          const rowDate = r[iDate] instanceof Date
            ? Utilities.formatDate(r[iDate], tz, 'yyyy-MM-dd')
            : String(r[iDate] || '').slice(0, 10);
          if (rowDate === today && iEmail !== -1) {
            clockedToday.add(String(r[iEmail] || '').toLowerCase().trim());
          }
        });
      }

      const todayDayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][now.getDay()];
      assignments.forEach(a => {
        if (!a.teacher || !a.startTime) return;
        const dayMatch = !a.day || a.day.toLowerCase() === todayDayName.toLowerCase()
          || a.day.toLowerCase().startsWith(todayDayName.toLowerCase().slice(0, 3));
        if (!dayMatch) return;

        const [h, m] = (a.startTime || '08:00').split(':').map(Number);
        const scheduledStart = new Date(now);
        scheduledStart.setHours(h || 8, m || 0, 0, 0);
        const diffMin = (now - scheduledStart) / 60000;

        if (diffMin > lateThreshold && diffMin < 240) {
          const teacherEmail = (function() {
            const sh = ss.getSheetByName(USERS_SHEET_NAME);
            if (!sh) return '';
            const rows = sh.getDataRange().getValues();
            const hdr = rows[0].map(x => String(x).trim().toLowerCase());
            const iName = hdr.findIndex(x => x === 'name' || x === 'nom');
            const iMail = hdr.indexOf('email');
            if (iName === -1 || iMail === -1) return '';
            const row = rows.slice(1).find(r => String(r[iName] || '').trim().toLowerCase() === a.teacher.toLowerCase());
            return row ? String(row[iMail] || '').toLowerCase().trim() : '';
          })();

          const hasClockedIn = teacherEmail ? clockedToday.has(teacherEmail) : false;
          if (!hasClockedIn) {
            alerts.push({
              id: 'late-teacher-' + a.teacher.replace(/\s+/g, '-'),
              type: 'ALERT',
              severity: 'MEDIUM',
              icon: '⏰',
              category: 'ATTENDANCE',
              title: a.teacher + ' — retard probable',
              detail: 'Devait être en classe ' + a.className + ' à ' + a.startTime + '. Aucun pointage aujourd\'hui. Retard estimé: ' + Math.round(diffMin) + ' min.',
              requiresConfirmation: true,
              confirmQuestion: a.teacher + ' était-il/elle en retard ou absent(e) ?',
              confirmOptions: ['Retard confirmé', 'Absent(e)', 'Erreur — était présent(e)'],
              teacherEmail: teacherEmail,
              className: a.className,
              timestamp: now.toISOString()
            });
          }
        }
      });
    }

    // 3. Élèves avec absences récurrentes
    const absenceThreshold = parseInt(conf.ATTENDANCE_ALERT_THRESHOLD || '3');
    const shAtt = ss.getSheetByName('attendance');
    if (shAtt && shAtt.getLastRow() > 1 && absenceThreshold > 0) {
      const attData = shAtt.getDataRange().getValues();
      const attH = attData[0].map(x => String(x).trim().toUpperCase());
      const iSid = attH.indexOf('STUDENTID');
      const iStatus = attH.indexOf('STATUS');
      const iDate = attH.indexOf('DATE');
      if (iSid !== -1 && iStatus !== -1) {
        const absentCounts = {};
        const absentToday = {};
        attData.slice(1).forEach(r => {
          const status = String(r[iStatus] || '').toUpperCase();
          if (status === 'ABSENT') {
            const sid = String(r[iSid] || '').trim();
            if (sid) absentCounts[sid] = (absentCounts[sid] || 0) + 1;
            if (sid && iDate !== -1) {
              var rowDate = r[iDate] instanceof Date
                ? Utilities.formatDate(r[iDate], tz, 'yyyy-MM-dd')
                : String(r[iDate] || '').slice(0, 10);
              if (rowDate === today) absentToday[sid] = true;
            }
          }
        });

        var todayIds = Object.keys(absentToday);
        if (todayIds.length) {
          alerts.push({
            id: 'absent-today-' + Utilities.formatDate(now, tz, 'yyyyMMdd'),
            type: 'ALERT',
            severity: 'HIGH',
            icon: '🚫',
            category: 'ATTENDANCE',
            title: 'Élèves absents aujourd\'hui',
            detail: todayIds.length + ' élève(s) absent(s): ' + todayIds.slice(0, 12).join(', ') + (todayIds.length > 12 ? ' ...' : ''),
            actionLabel: 'Voir présences',
            actionTarget: 'attendance',
            timestamp: now.toISOString()
          });
        }

        Object.keys(absentCounts).forEach(sid => {
          if (absentCounts[sid] >= absenceThreshold) {
            alerts.push({
              id: 'recurrent-absent-' + sid,
              type: 'INFO',
              severity: 'LOW',
              icon: '📋',
              category: 'ATTENDANCE',
              title: 'Absences récurrentes: ' + sid,
              detail: absentCounts[sid] + ' absence(s) enregistrée(s). Seuil d\'alerte: ' + absenceThreshold + '.',
              studentId: sid,
              actionLabel: 'Voir dossier',
              actionTarget: 'student-profile:' + sid,
              timestamp: now.toISOString()
            });
          }
        });
      }
    }

    // 4. AI incidents: pedagogical risk, balances, missing config
    try {
      var aiIncidents = _buildAiIncidentAlerts_(ss, conf, now, tz);
      if (Array.isArray(aiIncidents) && aiIncidents.length) {
        aiIncidents.forEach(function(a) { alerts.push(a); });
      }
    } catch (_aiIncidentErr) {}

    var scopedAlerts = _filterAlertsForViewer_(viewer, alerts);

    return {
      success: true,
      alerts: scopedAlerts,
      count: scopedAlerts.length,
      isSchoolHours: isSchoolHours,
      timestamp: now.toISOString()
    };
  } catch (e) {
    return { success: false, error: e.message, alerts: [] };
  }
}

function getNotifications_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.', data: [] };

    var sys = getSystemAlerts_(auth);
    var alerts = (sys && sys.success && Array.isArray(sys.alerts)) ? sys.alerts : [];
    var readMap = _getUserNotificationReadMap_(viewer.email);

    var dataRows = alerts.map(function(a) {
      var id = String((a && a.id) || Utilities.getUuid()).trim();
      var ts = String((a && a.timestamp) || new Date().toISOString());
      return {
        id: id,
        title: String((a && a.title) || 'Alerte système'),
        message: String((a && a.detail) || ''),
        category: String((a && a.category) || 'SYSTEM'),
        severity: String((a && a.severity) || 'LOW'),
        createdAt: ts,
        read: !!readMap[id]
      };
    }).sort(function(x, y) {
      return String(y.createdAt || '').localeCompare(String(x.createdAt || ''));
    });

    // Fix 9: deduplication — if the client sent a lastSeenId or since timestamp,
    // return only notifications newer than the cursor. If nothing is new, return
    // an empty data array so the client skips re-rendering (no-op poll).
    var lastSeenId = String((data && data.lastSeenId) || '').trim();
    var sinceRaw   = String((data && data.since) || '').trim();
    var sinceTs    = sinceRaw ? new Date(sinceRaw).getTime() : 0;

    if (lastSeenId || sinceTs) {
      var filtered = dataRows.filter(function(n) {
        if (n.id === lastSeenId) return false; // exact cursor hit — exclude and stop
        if (sinceTs && n.createdAt) {
          var nTs = new Date(n.createdAt).getTime();
          return nTs > sinceTs;
        }
        return true;
      });
      // If nothing is newer, signal no-op to the client (empty list, forceRender:false)
      if (filtered.length === 0) {
        return { success: true, data: [], count: 0, forceRender: false };
      }
      return { success: true, data: filtered.slice(0, 50), count: filtered.length, forceRender: true };
    }

    // No cursor — first load or full refresh: return full list
    return { success: true, data: dataRows.slice(0, 50), count: dataRows.length, forceRender: true };
  } catch (e) {
    return { success: false, error: e.message, data: [] };
  }
}

function markNotificationRead_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    var id = String((data && data.id) || '').trim();
    if (!id) return { success: false, error: 'Notification ID manquant.' };

    var readMap = _getUserNotificationReadMap_(viewer.email);
    readMap[id] = true;
    _setUserNotificationReadMap_(viewer.email, readMap);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function markAllNotificationsRead_(data, auth) {
  try {
    var viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    var feed = getNotifications_({}, auth);
    var rows = (feed && feed.success && Array.isArray(feed.data)) ? feed.data : [];
    var readMap = _getUserNotificationReadMap_(viewer.email);
    rows.forEach(function(n) {
      if (!n || !n.id) return;
      readMap[String(n.id)] = true;
    });
    _setUserNotificationReadMap_(viewer.email, readMap);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Alertes confirmées par l'admin (enseignant retardataire/absent)
function confirmTeacherAlertStatus_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };

    const teacherEmail = String(data.teacherEmail || '').trim();
    const status = String(data.status || '').toUpperCase(); // 'LATE' | 'ABSENT' | 'PRESENT'
    const className = String(data.className || '').trim();

    if (!teacherEmail || !status) return { success: false, error: 'Données manquantes.' };

    // Si l'admin confirme absent ou en retard, enregistrer dans staff_attendance
    if (['LATE', 'ABSENT'].includes(status)) {
      const ss = getSS_();
      let sh = ss.getSheetByName('staff_attendance');
      if (!sh) {
        sh = ss.insertSheet('staff_attendance');
        sh.appendRow(['Date', 'Email', 'Name', 'Status', 'LateMinutes', 'Class', 'ConfirmedBy', 'Timestamp']);
        sh.setFrozenRows(1);
      }
      sh.appendRow([
        new Date(),
        teacherEmail,
        data.teacherName || '',
        status,
        Number(data.lateMinutes || 0),
        className,
        viewer.email || 'System',
        new Date().toISOString()
      ]);
      SpreadsheetApp.flush();
    }

    writeAuditLog_('ALERT_TEACHER_CONFIRMED', teacherEmail,
      'status=' + status + ' class=' + className + ' confirmedBy=' + viewer.email, 'p_attendance');

    return { success: true, message: 'Statut enseignant confirmé: ' + status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// INSTRUCTION : Ajouter dans le switch de apiHub_ :
// case 'getSystemAlerts': result = getSystemAlerts_(auth); break;
// case 'confirmTeacherAlertStatus': result = confirmTeacherAlertStatus_(data, auth); break;

// ────────────────────────────────────────────────────────────
// PATCH 8 — ANNÉE SCOLAIRE : Normalisation dans getSaaSSettings_
// Ajouter après le chargement de la config, avant le return
// ────────────────────────────────────────────────────────────
function normalizeSaaSSettingsAcademicYear_(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  // Normaliser l'année scolaire dans toutes ses variantes
  const year = cfg.ACADEMIC_YEAR || cfg.academicYear || cfg.CURRENT_ACADEMIC_YEAR
    || cfg.currentAcademicYear || cfg.SCHOOL_YEAR || cfg.schoolYear
    || cfg.annee_scolaire || cfg.ANNEE_SCOLAIRE || '';
  if (year) {
    cfg.ACADEMIC_YEAR = String(year).trim();
    cfg.academicYear = cfg.ACADEMIC_YEAR;
    cfg.currentAcademicYear = cfg.ACADEMIC_YEAR;
  }
  const rawPeriods = cfg.NUM_PERIODS || cfg.TOTAL_TERMS || cfg.numPeriods || cfg.totalTerms || 4;
  const parsedPeriods = parseInt(rawPeriods, 10);
  const periodCount = Math.max(1, Math.min(5, isNaN(parsedPeriods) ? 4 : parsedPeriods));
  cfg.NUM_PERIODS = periodCount;
  cfg.numPeriods = periodCount;
  cfg.TOTAL_TERMS = periodCount;
  cfg.totalTerms = periodCount;
  return cfg;
}

function resolveStudentCurrentLevelFromSheet_(studentId, ssInput) {
  const sid = String(studentId || '').trim().toUpperCase();
  if (!sid) return '';
  const ss = ssInput || getSS_();
  const shBio = ss.getSheetByName('students');
  if (!shBio || shBio.getLastRow() < 2) return '';
  const bData = shBio.getDataRange().getValues();
  const bH = bData[0].map(function(x) { return String(x || '').toUpperCase().replace(/\s/g, ''); });
  const bIdIdx = bH.indexOf('STUDENTCODE');
  const bLvIdx = bH.indexOf('CURRENTLEVEL');
  if (bIdIdx === -1 || bLvIdx === -1) return '';
  for (let i = 1; i < bData.length; i++) {
    if (String(bData[i][bIdIdx] || '').trim().toUpperCase() === sid) {
      return String(bData[i][bLvIdx] || '').trim();
    }
  }
  return '';
}

function escapeHtmlForReport_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFullStudentReportHtml_(studentId, token) {
  try {
    const reportData = getStudentBulletinData_({ studentId: studentId }, token);
    if (!reportData.success || !reportData.student) {
      return { success:false, error:(reportData && reportData.error) || 'Bulletin indisponible.' };
    }
    const conf = (getSaaSSettings_(token).data) || {};
    const student = reportData.student || {};
    const subjects = Array.isArray(student.subjectAnalysis) ? student.subjectAnalysis : [];
    const periodCount = Math.max(1, Math.min(5, parseInt(conf.NUM_PERIODS || conf.TOTAL_TERMS || 4, 10) || 4));
    const periodHeaders = [];
    for (let i = 0; i < periodCount; i++) periodHeaders.push('T' + (i + 1));
    const summary = subjects.length ? subjects.map(function(row) {
      const timeline = Array.isArray(row.timeline) ? row.timeline.slice(0, periodCount) : [];
      while (timeline.length < periodCount) timeline.push('');
      return '<tr>'
        + '<td>' + escapeHtmlForReport_(row.subject) + '</td>'
        + periodHeaders.map(function(_header, idx) {
            const value = timeline[idx] !== undefined && timeline[idx] !== null && timeline[idx] !== '' ? Number(timeline[idx]).toFixed(1) : '—';
            return '<td style="text-align:center;">' + escapeHtmlForReport_(value) + '</td>';
          }).join('')
        + '<td style="text-align:center;">' + escapeHtmlForReport_(row.average) + '</td>'
        + '<td style="text-align:center;">' + escapeHtmlForReport_(row.max) + '</td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="' + (periodHeaders.length + 3) + '" style="text-align:center;color:#64748b;">Aucune note disponible.</td></tr>';

    const photoHtml = student.photo
      ? '<img src="' + escapeHtmlForReport_(student.photo) + '" alt="Photo élève" style="width:84px;height:84px;border-radius:16px;object-fit:cover;border:1px solid #cbd5e1;"/>'
      : '<div style="width:84px;height:84px;border-radius:16px;border:1px dashed #cbd5e1;background:#f8fafc;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;">Photo</div>';

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Bulletin</title></head><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">'
      + '<div style="max-width:960px;margin:0 auto;padding:32px;">'
      + '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:28px 32px;box-shadow:0 12px 30px rgba(15,23,42,.08);">'
      + '<div style="display:flex;justify-content:space-between;gap:24px;align-items:flex-start;">'
      + '<div>'
      + '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;">Bulletin académique</div>'
      + '<h1 style="margin:8px 0 6px;font-size:28px;line-height:1.2;">' + escapeHtmlForReport_(conf.SCHOOL_NAME || 'Établissement') + '</h1>'
      + '<div style="font-size:14px;color:#475569;">' + escapeHtmlForReport_(conf.SCHOOL_ADDR || '') + '</div>'
      + '<div style="margin-top:6px;font-size:13px;color:#64748b;">Année scolaire: ' + escapeHtmlForReport_(conf.ACADEMIC_YEAR || '') + '</div>'
      + '</div>'
      + (conf.SCHOOL_LOGO ? '<img src="' + escapeHtmlForReport_(conf.SCHOOL_LOGO) + '" alt="Logo" style="width:72px;height:72px;object-fit:contain;"/>' : '')
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;gap:24px;align-items:center;margin-top:26px;padding:18px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;">'
      + '<div style="display:flex;gap:16px;align-items:center;">'
      + photoHtml
      + '<div>'
      + '<div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Élève</div>'
      + '<div style="font-size:24px;font-weight:700;">' + escapeHtmlForReport_(student.name || studentId) + '</div>'
      + '<div style="font-size:14px;color:#475569;">Matricule: ' + escapeHtmlForReport_(student.id || studentId) + ' • Classe: ' + escapeHtmlForReport_(student.level || '') + '</div>'
      + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;">'
      + '<div style="min-width:120px;padding:12px 14px;border-radius:14px;background:#ffffff;border:1px solid #dbeafe;"><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Moyenne</div><div style="font-size:24px;font-weight:700;">' + escapeHtmlForReport_(student.periodAvg || '0.00') + '</div></div>'
      + '<div style="min-width:120px;padding:12px 14px;border-radius:14px;background:#ffffff;border:1px solid #dcfce7;"><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Décision</div><div style="font-size:18px;font-weight:700;">' + escapeHtmlForReport_(student.decision || 'N/A') + '</div></div>'
      + '</div>'
      + '</div>'
      + '<div style="margin-top:26px;overflow:hidden;border:1px solid #e2e8f0;border-radius:18px;">'
      + '<table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="background:#0f172a;color:#ffffff;">'
      + '<th style="padding:12px 14px;text-align:left;">Matière</th>'
      + periodHeaders.map(function(header) { return '<th style="padding:12px 8px;">' + header + '</th>'; }).join('')
      + '<th style="padding:12px 8px;">Moyenne</th>'
      + '<th style="padding:12px 8px;">Coeff.</th>'
      + '</tr></thead>'
      + '<tbody>' + summary + '</tbody>'
      + '</table>'
      + '</div>'
      + '<div style="margin-top:18px;font-size:12px;color:#64748b;">Généré le ' + escapeHtmlForReport_(new Date().toLocaleDateString('fr-FR')) + '</div>'
      + '</div></div></body></html>';

    return { success:true, htmlReport:html };
  } catch (e) {
    return { success:false, error:e.message };
  }
}

// INSTRUCTION: Dans getSaaSSettings_, après avoir construit l'objet 'out',
// ajouter: out = normalizeSaaSSettingsAcademicYear_(out);

// ────────────────────────────────────────────────────────────
// PATCH 9 — KIOSK WATCH CODES : Alerte scan personnalisée
// ────────────────────────────────────────────────────────────
function saveKioskWatchCodes_(data, auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    if (!viewer.isMaster && !viewer.isGodMode && !(viewer.permissions && viewer.permissions.p_attendance)) {
      return { success: false, error: 'Permission insuffisante.' };
    }
    const codes = Array.isArray(data.codes) ? data.codes : [];
    const ss = getSS_();
    let sh = ss.getSheetByName('Settings');
    if (!sh) { sh = ss.insertSheet('Settings'); sh.appendRow(['KEY', 'VALUE', 'LAST_UPDATED']); sh.setFrozenRows(1); }
    const rows = sh.getDataRange().getValues();
    const keyRow = rows.findIndex((r, i) => i > 0 && String(r[0]).trim() === 'KIOSK_WATCH_CODES');
    const val = JSON.stringify(codes);
    if (keyRow > 0) sh.getRange(keyRow + 1, 2, 1, 2).setValues([[val, new Date()]]);
    else sh.appendRow(['KIOSK_WATCH_CODES', val, new Date()]);
    SpreadsheetApp.flush();
    return { success: true, message: codes.length + ' code(s) de surveillance sauvegardés.' };
  } catch (e) { return { success: false, error: e.message }; }
}

function getKioskWatchCodes_(auth) {
  try {
    const viewer = getViewerInfo_(auth);
    if (!viewer || !viewer.success) return { success: false, error: 'Session invalide.' };
    const val = _getSettingsSheetValue_(['KIOSK_WATCH_CODES']);
    const codes = val ? JSON.parse(val) : [];
    return { success: true, codes: Array.isArray(codes) ? codes : [] };
  } catch (e) { return { success: false, error: e.message, codes: [] }; }
}

// INSTRUCTION : Ajouter dans le switch de apiHub_ :
// case 'saveKioskWatchCodes': result = saveKioskWatchCodes_(data, auth); break;
// case 'getKioskWatchCodes': result = getKioskWatchCodes_(auth); break;

// ────────────────────────────────────────────────────────────
// PATCH 10 — LOGIQUE PROMOTION : Correction niveaux manquants
// ────────────────────────────────────────────────────────────
function getNextAcademicLevel_(currentLevel, conf) {
  const levels = Array.isArray(conf.ACTIVE_LEVELS) ? conf.ACTIVE_LEVELS : [];
  if (!levels.length || !currentLevel) return null;

  // Normaliser pour comparaison
  const normalize = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalCurrent = normalize(currentLevel);

  const idx = levels.findIndex(l => {
    const lid = normalize(l.id || l.label || l.name || '');
    const llabel = normalize(l.label || l.name || l.id || '');
    return lid === normalCurrent || llabel === normalCurrent;
  });

  if (idx === -1) return null;
  if (idx + 1 >= levels.length) return 'ALUMNI';
  return String(levels[idx + 1].id || levels[idx + 1].label || '').trim();
}

// ════════════════════════════════════════════════════════════════════════
// BULLETIN AUTHENTICITY VERIFICATION
// Sheet: BulletinVerification — registry of every bulletin issued, with a
// short verifyId encoded into a QR on the printed report. Public lookup
// returns minimal fields needed to confirm authenticity.
// ════════════════════════════════════════════════════════════════════════
const BULLETIN_VERIFICATION_SHEET_ = 'BulletinVerification';
const BULLETIN_VERIFICATION_HEADERS_ = [
  'verifyId', 'studentId', 'studentName', 'className',
  'year', 'period', 'cycleKey', 'engine',
  'issuedAt', 'issuedBy', 'verifyUrl', 'lastVerifiedAt', 'verifyCount'
];

function _getBulletinVerificationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BULLETIN_VERIFICATION_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(BULLETIN_VERIFICATION_SHEET_);
    sh.getRange(1, 1, 1, BULLETIN_VERIFICATION_HEADERS_.length)
      .setValues([BULLETIN_VERIFICATION_HEADERS_])
      .setFontWeight('bold')
      .setBackground('#1e3a8a')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, BULLETIN_VERIFICATION_HEADERS_.length);
  }
  return sh;
}

function _findBulletinVerificationRow_(sh, verifyId) {
  if (!verifyId) return -1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(verifyId)) return i + 2;
  }
  return -1;
}

function registerBulletinIssue_(data, auth) {
  try {
    const p = data || {};
    const verifyId = String(p.verifyId || '').trim();
    if (!verifyId) return { success: false, error: 'verifyId requis' };
    const sh = _getBulletinVerificationSheet_();
    const issuedBy = (auth && (auth.email || auth.user)) || (Session.getActiveUser && Session.getActiveUser().getEmail()) || '';
    const row = [
      verifyId,
      String(p.studentId   || ''),
      String(p.studentName || ''),
      String(p.className   || ''),
      String(p.year        || ''),
      String(p.period      || ''),
      String(p.cycleKey    || ''),
      String(p.engine      || 'TRADITIONNEL'),
      String(p.issuedAt    || new Date().toISOString()),
      String(issuedBy      || ''),
      String(p.verifyUrl   || ''),
      '', // lastVerifiedAt
      0   // verifyCount
    ];
    const existing = _findBulletinVerificationRow_(sh, verifyId);
    if (existing > 0) {
      // Already registered — keep first issue date, just refresh issuer/url.
      sh.getRange(existing, 10).setValue(issuedBy || sh.getRange(existing, 10).getValue());
      sh.getRange(existing, 11).setValue(row[10] || sh.getRange(existing, 11).getValue());
      return { success: true, verifyId: verifyId, registered: false, updated: true };
    }
    sh.appendRow(row);
    return { success: true, verifyId: verifyId, registered: true };
  } catch (e) {
    return { success: false, error: 'registerBulletinIssue: ' + (e && e.message || e) };
  }
}

function verifyBulletin_(data, auth) {
  try {
    const verifyId = String(
      typeof data === 'string' ? data : (data && (data.verifyId || data.id) || '')
    ).trim();
    if (!verifyId) return { success: false, verified: false, error: 'verifyId requis' };
    const sh = _getBulletinVerificationSheet_();
    const rowIdx = _findBulletinVerificationRow_(sh, verifyId);
    if (rowIdx < 0) {
      return { success: true, verified: false, verifyId: verifyId };
    }
    const values = sh.getRange(rowIdx, 1, 1, BULLETIN_VERIFICATION_HEADERS_.length).getValues()[0];
    const rec = {};
    BULLETIN_VERIFICATION_HEADERS_.forEach(function(h, i){ rec[h] = values[i]; });
    // Increment verify counter + timestamp.
    try {
      const newCount = (Number(rec.verifyCount) || 0) + 1;
      sh.getRange(rowIdx, 12).setValue(new Date().toISOString());
      sh.getRange(rowIdx, 13).setValue(newCount);
      rec.verifyCount   = newCount;
      rec.lastVerifiedAt = new Date().toISOString();
    } catch (_) { /* non-fatal */ }
    // Pull school identity for the public verification view.
    let schoolName = '', schoolLogo = '';
    try {
      const conf = (typeof getSaaSSettings_ === 'function') ? (getSaaSSettings_().data || {}) : {};
      schoolName = String(conf.SCHOOL_NAME || conf.schoolName || '');
      schoolLogo = String(conf.SCHOOL_LOGO || conf.schoolLogo || '');
    } catch(_){}
    return {
      success:  true,
      verified: true,
      verifyId: rec.verifyId,
      schoolName: schoolName,
      schoolLogo: schoolLogo,
      record: {
        studentId:      rec.studentId,
        studentName:    rec.studentName,
        className:      rec.className,
        year:           rec.year,
        period:         rec.period,
        cycleKey:       rec.cycleKey,
        engine:         rec.engine,
        issuedAt:       rec.issuedAt,
        issuedBy:       rec.issuedBy,
        lastVerifiedAt: rec.lastVerifiedAt,
        verifyCount:    rec.verifyCount
      }
    };
  } catch (e) {
    return { success: false, verified: false, error: 'verifyBulletin: ' + (e && e.message || e) };
  }
}

// ════════════════════════════════════════════════════════════════════════
// ATTENDANCE ALARMS SHEET
// Mirrors the ATTENDANCE_WATCHLIST config blob to a real spreadsheet so
// admins can browse / audit configured alarms outside the SPA.
// ════════════════════════════════════════════════════════════════════════
const ATTENDANCE_ALARMS_SHEET_ = 'AttendanceAlarms';
const ATTENDANCE_ALARMS_HEADERS_ = [
  'id', 'enabled', 'targetType', 'targetId',
  'label', 'message', 'sound', 'events', 'updatedAt'
];

function _ensureAttendanceAlarmsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ATTENDANCE_ALARMS_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(ATTENDANCE_ALARMS_SHEET_);
    sh.getRange(1, 1, 1, ATTENDANCE_ALARMS_HEADERS_.length)
      .setValues([ATTENDANCE_ALARMS_HEADERS_])
      .setFontWeight('bold')
      .setBackground('#d97706')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, ATTENDANCE_ALARMS_HEADERS_.length);
  }
  return sh;
}

function _mirrorAttendanceWatchlistToSheet_(rawValue) {
  try {
    let arr = rawValue;
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch(_) { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    const sh = _ensureAttendanceAlarmsSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, ATTENDANCE_ALARMS_HEADERS_.length).clearContent();
    if (!arr.length) return { success: true, count: 0 };
    const now = new Date().toISOString();
    const rows = arr.map(function(e){
      e = e || {};
      const events = Array.isArray(e.events) ? e.events.join(',') : String(e.events || '');
      return [
        String(e.id         || ''),
        e.enabled !== false,
        String(e.targetType || 'ANY'),
        String(e.targetId   || ''),
        String(e.label      || ''),
        String(e.message    || ''),
        String(e.sound      || 'bell'),
        events,
        now
      ];
    });
    sh.getRange(2, 1, rows.length, ATTENDANCE_ALARMS_HEADERS_.length).setValues(rows);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, error: 'mirrorAttendanceWatchlist: ' + (e && e.message || e) };
  }
}

// ════════════════════════════════════════════════════════════════════════
// CORE SHEET BOOTSTRAP
// Idempotent helpers that guarantee the BulletinVerification and
// AttendanceAlarms sheets exist. Called automatically on the first apiHub
// invocation per execution and exposed via the `initSheets` action so it
// can be triggered explicitly from the SPA / Apps Script editor.
// ════════════════════════════════════════════════════════════════════════
let __CORE_INIT_SHEETS_DONE_ = false;
let __AI_MASTER_INIT_DONE_ = false;
function _ensureCoreInitSheets_() {
  if (__CORE_INIT_SHEETS_DONE_ && __AI_MASTER_INIT_DONE_) return;
  try { _getBulletinVerificationSheet_();   } catch(_){}
  try {
    _ensureAttendanceAlarmsSheet_();
    // Seed sheet from existing config so the very first init isn't empty.
    try {
      const conf = (typeof getSaaSSettings_ === 'function') ? (getSaaSSettings_().data || {}) : {};
      if (conf.ATTENDANCE_WATCHLIST) _mirrorAttendanceWatchlistToSheet_(conf.ATTENDANCE_WATCHLIST);
    } catch(_){}
  } catch(_){}
  try {
    _initAiMasterSheetsStrict_(false);
    __AI_MASTER_INIT_DONE_ = true;
  } catch (e) {
    __AI_MASTER_INIT_DONE_ = false;
    Logger.log('Core init: AI master sheets still not ready: ' + String(e && e.message || e));
  }
  __CORE_INIT_SHEETS_DONE_ = true;
}
function initCoreSheets_() {
  __CORE_INIT_SHEETS_DONE_ = false; // force a real run regardless of cache
  __AI_MASTER_INIT_DONE_ = false;
  try {
    _ensureCoreInitSheets_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return {
      success: true,
      sheets: {
        BulletinVerification: !!ss.getSheetByName(BULLETIN_VERIFICATION_SHEET_),
        AttendanceAlarms:     !!ss.getSheetByName(ATTENDANCE_ALARMS_SHEET_)
      }
    };
  } catch (e) {
    return { success: false, error: 'initCoreSheets: ' + (e && e.message || e) };
  }
}


/* ============================================================
 * EXAM BUILDER / RUNNER / GRADING — BACKEND (v1.0)
 * Sheets: Exams, Exam_Submissions
 * ============================================================ */

var EXAM_SHEET_NAME_           = 'Exams';
var EXAM_SUB_SHEET_NAME_       = 'Exam_Submissions';
var EXAM_HEADERS_              = ['id','title','subject','description','status','cycle','classes_csv','students_csv','settings_json','questions_json','created_by','created_at','updated_at'];
var EXAM_SUB_HEADERS_          = ['id','exam_id','student_id','student_name','attempt','started_at','submitted_at','status','answers_json','grades_json','auto_score','manual_score','score','max_score','feedback'];

function _examSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EXAM_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(EXAM_SHEET_NAME_);
    sh.appendRow(EXAM_HEADERS_);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(EXAM_HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _examSubSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EXAM_SUB_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(EXAM_SUB_SHEET_NAME_);
    sh.appendRow(EXAM_SUB_HEADERS_);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(EXAM_SUB_HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _examShortId_() {
  return 'EX_' + (new Date().getTime()).toString(36).toUpperCase()
       + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function _examSubId_() {
  return 'ESB_' + (new Date().getTime()).toString(36).toUpperCase()
       + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function _examReadAll_() {
  var sh = _examSheet_();
  var lr = sh.getLastRow(); if (lr < 2) return [];
  var values = sh.getRange(2, 1, lr - 1, EXAM_HEADERS_.length).getValues();
  return values.map(function(row) { return _examRowToObj_(row); }).filter(function(x){ return x && x.id; });
}

function _examRowToObj_(row) {
  if (!row) return null;
  var o = {};
  EXAM_HEADERS_.forEach(function(h, i) { o[h] = row[i]; });
  var settings = {}; try { settings = o.settings_json ? JSON.parse(o.settings_json) : {}; } catch(_e) { settings = {}; }
  var questions = []; try { questions = o.questions_json ? JSON.parse(o.questions_json) : []; } catch(_e) { questions = []; }
  return {
    id: String(o.id || ''),
    title: String(o.title || ''),
    subject: String(o.subject || ''),
    subject_branch: String((settings && settings.subject_branch) || ''),
    period: String((settings && settings.period) || ''),
    weight: Number((settings && settings.weight) || 1) || 1,
    description: String(o.description || ''),
    status: String(o.status || 'DRAFT').toUpperCase(),
    cycle: String(o.cycle || ''),
    classes: String(o.classes_csv || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
    students: String(o.students_csv || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
    settings: settings,
    questions: questions,
    createdBy: String(o.created_by || ''),
    createdAt: o.created_at ? new Date(o.created_at).toISOString() : '',
    updatedAt: o.updated_at ? new Date(o.updated_at).toISOString() : ''
  };
}

function _examFindRowIndex_(examId) {
  var sh = _examSheet_();
  var lr = sh.getLastRow(); if (lr < 2) return -1;
  var ids = sh.getRange(2, 1, lr - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(examId)) return i + 2;
  return -1;
}

function _examWriteRow_(sh, rowIdx, obj) {
  var row = [
    obj.id, obj.title || '', obj.subject || '', obj.description || '',
    String(obj.status || 'DRAFT').toUpperCase(), obj.cycle || '',
    (obj.classes || []).join(','), (obj.students || (obj.settings && obj.settings.students) || []).join(','),
    JSON.stringify(obj.settings || {}), JSON.stringify(obj.questions || []),
    obj.createdBy || '', obj.createdAt ? new Date(obj.createdAt) : new Date(),
    new Date()
  ];
  sh.getRange(rowIdx, 1, 1, EXAM_HEADERS_.length).setValues([row]);
}

function examSave_(data, auth) {
  var ex = data && data.exam; if (!ex || typeof ex !== 'object') return { success: false, error: 'Exam payload missing.' };
  if (!ex.title || !String(ex.title).trim()) return { success: false, error: 'Title required.' };
  if (!Array.isArray(ex.questions) || !ex.questions.length) return { success: false, error: 'At least 1 question required.' };
  var sh = _examSheet_();
  if (!ex.id) ex.id = _examShortId_();
  var idx = _examFindRowIndex_(ex.id);
  ex.createdBy = ex.createdBy || (auth && (auth.id || auth.userId)) || '';
  if (idx === -1) {
    ex.createdAt = new Date().toISOString();
    sh.appendRow([
      ex.id, ex.title, ex.subject || '', ex.description || '',
      String(ex.status || 'DRAFT').toUpperCase(), ex.cycle || '',
      (ex.classes || []).join(','), ((ex.settings && ex.settings.students) || []).join(','),
      JSON.stringify(ex.settings || {}), JSON.stringify(ex.questions || []),
      ex.createdBy, new Date(), new Date()
    ]);
  } else {
    _examWriteRow_(sh, idx, ex);
  }
  try { _audit_safe_('saveExam', { examId: ex.id, status: ex.status, qcount: ex.questions.length }, auth); } catch(_e) {}
  var saved = _examReadAll_().filter(function(x){ return x.id === ex.id; })[0];
  return { success: true, exam: saved || ex };
}

function examList_(data, auth) {
  var rows = _examReadAll_();
  var subSh = _examSubSheet_();
  var subCounts = {};
  try {
    var slr = subSh.getLastRow();
    if (slr > 1) {
      var subRows = subSh.getRange(2, 2, slr - 1, 1).getValues();
      subRows.forEach(function(r) { var eid = String(r[0]); if (eid) subCounts[eid] = (subCounts[eid] || 0) + 1; });
    }
  } catch(_e) {}
  rows.forEach(function(r) { r.submissionsCount = subCounts[r.id] || 0; });
  rows.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  return { success: true, data: rows, exams: rows };
}

function examGet_(data, auth) {
  try {
    var id = data && data.examId; if (!id) return { success: false, error: 'examId required.' };
    var ex = _examReadAll_().filter(function(x){ return x.id === id; })[0];
    if (!ex) return { success: false, error: 'Not found.' };
    return { success: true, exam: ex };
  } catch(e) { return { success: false, error: e.message }; }
}

function examDelete_(data, auth) {
  var id = data && data.examId; if (!id) return { success: false, error: 'examId required.' };
  var sh = _examSheet_();
  var idx = _examFindRowIndex_(id); if (idx === -1) return { success: false, error: 'Not found.' };
  sh.deleteRow(idx);
  try { _audit_safe_('deleteExam', { examId: id }, auth); } catch(_e) {}
  return { success: true };
}

function examPublish_(data, auth) {
  var id = data && data.examId; if (!id) return { success: false, error: 'examId required.' };
  var status = String(data.status || 'PUBLISHED').toUpperCase();
  if (['DRAFT', 'PUBLISHED', 'CLOSED'].indexOf(status) === -1) status = 'PUBLISHED';
  var sh = _examSheet_(); var idx = _examFindRowIndex_(id);
  if (idx === -1) return { success: false, error: 'Not found.' };
  // PERF FIX: batch status + updatedAt into one setValues() call.
  var examRow = sh.getRange(idx, 1, 1, EXAM_HEADERS_.length).getValues()[0];
  examRow[4] = status;                          // column 5 = status (0-indexed: 4)
  examRow[EXAM_HEADERS_.length - 1] = new Date(); // last column = updatedAt
  sh.getRange(idx, 1, 1, EXAM_HEADERS_.length).setValues([examRow]);
  try { _audit_safe_('publishExam', { examId: id, status: status }, auth); } catch(_e) {}
  return { success: true, status: status };
}

function _examSubReadAll_() {
  var sh = _examSubSheet_();
  var lr = sh.getLastRow(); if (lr < 2) return [];
  var values = sh.getRange(2, 1, lr - 1, EXAM_SUB_HEADERS_.length).getValues();
  return values.map(function(r) { return _examSubRowToObj_(r); }).filter(function(x){ return x && x.id; });
}

function _examSubRowToObj_(row) {
  var o = {}; EXAM_SUB_HEADERS_.forEach(function(h, i) { o[h] = row[i]; });
  var answers = []; try { answers = o.answers_json ? JSON.parse(o.answers_json) : []; } catch(_e) {}
  var grades  = {}; try { grades  = o.grades_json  ? JSON.parse(o.grades_json)  : {}; } catch(_e) {}
  return {
    id: String(o.id || ''), examId: String(o.exam_id || ''), studentId: String(o.student_id || ''),
    studentName: String(o.student_name || ''), attempt: Number(o.attempt) || 1,
    startedAt: o.started_at ? new Date(o.started_at).toISOString() : '',
    submittedAt: o.submitted_at ? new Date(o.submitted_at).toISOString() : '',
    status: String(o.status || ''), answers: answers, grades: grades,
    autoScore: o.auto_score !== '' ? Number(o.auto_score) : null,
    manualScore: o.manual_score !== '' ? Number(o.manual_score) : null,
    score: o.score !== '' ? Number(o.score) : null,
    maxScore: o.max_score !== '' ? Number(o.max_score) : null,
    feedback: String(o.feedback || '')
  };
}

function _examSubFindRowIndex_(subId) {
  var sh = _examSubSheet_(); var lr = sh.getLastRow(); if (lr < 2) return -1;
  var ids = sh.getRange(2, 1, lr - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(subId)) return i + 2;
  return -1;
}

function _examSubWriteRow_(sh, idx, obj) {
  var row = [
    obj.id, obj.examId, obj.studentId, obj.studentName || '', obj.attempt || 1,
    obj.startedAt ? new Date(obj.startedAt) : new Date(),
    obj.submittedAt ? new Date(obj.submittedAt) : '',
    String(obj.status || 'IN_PROGRESS').toUpperCase(),
    JSON.stringify(obj.answers || []),
    JSON.stringify(obj.grades || {}),
    obj.autoScore != null ? obj.autoScore : '',
    obj.manualScore != null ? obj.manualScore : '',
    obj.score != null ? obj.score : '',
    obj.maxScore != null ? obj.maxScore : '',
    obj.feedback || ''
  ];
  sh.getRange(idx, 1, 1, EXAM_SUB_HEADERS_.length).setValues([row]);
}

function examListSubmissions_(data, auth) {
  try {
    var examId = data && data.examId; if (!examId) return { success: false, error: 'examId required.' };
    var rows = _examSubReadAll_().filter(function(s){ return s.examId === examId; });
    rows.sort(function(a, b) { return (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt); });
    return { success: true, rows: rows, submissions: rows };
  } catch(e) { return { success: false, error: e.message }; }
}

function examGetSubmission_(data, auth) {
  var subId = data && data.submissionId; if (!subId) return { success: false, error: 'submissionId required.' };
  var sub = _examSubReadAll_().filter(function(s){ return s.id === subId; })[0];
  if (!sub) return { success: false, error: 'Not found.' };
  var ex = _examReadAll_().filter(function(x){ return x.id === sub.examId; })[0];
  return { success: true, data: { exam: ex, submission: sub, answers: sub.answers } };
}

function examGradeSubmission_(data, auth) {
  var subId = data && data.submissionId; if (!subId) return { success: false, error: 'submissionId required.' };
  var grades = (data && data.grades) || [];
  var sh = _examSubSheet_(); var idx = _examSubFindRowIndex_(subId);
  if (idx === -1) return { success: false, error: 'Not found.' };
  var sub = _examSubReadAll_().filter(function(s){ return s.id === subId; })[0];
  var ex = _examReadAll_().filter(function(x){ return x.id === sub.examId; })[0];
  if (!ex) return { success: false, error: 'Exam not found.' };
  sub.grades = sub.grades || {};
  grades.forEach(function(g){
    if (!g || !g.questionId) return;
    sub.grades[g.questionId] = sub.grades[g.questionId] || {};
    if (g.manualScore != null) sub.grades[g.questionId].manualScore = Number(g.manualScore) || 0;
    if (g.feedback != null)    sub.grades[g.questionId].feedback = String(g.feedback || '');
  });
  var totals = _examComputeTotals_(ex, sub);
  sub.autoScore = totals.autoScore;
  sub.manualScore = totals.manualScore;
  sub.score = totals.score;
  sub.maxScore = totals.maxScore;
  sub.status = 'GRADED';
  _examSubWriteRow_(sh, idx, sub);
  try { _audit_safe_('gradeExam', { submissionId: subId, score: sub.score }, auth); } catch(_e) {}
  // Bridge into grades sheet
  try {
    _writeAssessmentGrade_({
      studentId: sub.studentId,
      subjectId: ex.subject || ex.title,
      periodId: ex.period || (ex.settings && ex.settings.period) || 'P1',
      score: sub.score,
      maxScore: sub.maxScore,
      gradeId: 'EXAM-' + ex.id + '-' + sub.studentId,
      sourceTag: 'EXAM'
    });
  } catch(_e){}
  return { success: true, score: sub.score, maxScore: sub.maxScore };
}

function _examAutoGradeQuestion_(q, answer) {
  var pts = Number(q.points) || 0;
  if (answer == null || answer === '') return { score: 0, max: pts, manual: false };
  if (q.type === 'single' || q.type === 'image') {
    var correct = (q.options || []).filter(function(o){ return o.correct; })[0];
    return { score: (correct && String(correct.id) === String(answer)) ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'multi') {
    var ans = Array.isArray(answer) ? answer.map(String) : [];
    var corr = (q.options || []).filter(function(o){ return o.correct; }).map(function(o){ return String(o.id); });
    if (!corr.length) return { score: 0, max: pts, manual: false };
    var sortedA = ans.slice().sort().join('|'); var sortedC = corr.slice().sort().join('|');
    return { score: (sortedA === sortedC) ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'boolean') {
    return { score: (q.correct === answer || String(q.correct) === String(answer)) ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'short') {
    var alts = String(q.acceptedAnswers || '').split('|').map(function(s){ return s.trim(); }).filter(Boolean);
    if (!alts.length) return { score: 0, max: pts, manual: false };
    var a = String(answer);
    var match = alts.some(function(x){ return q.caseSensitive ? x === a : x.toLowerCase() === a.toLowerCase(); });
    return { score: match ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'numeric') {
    var v = Number(answer); var exp = Number(q.expected); var tol = Number(q.tolerance) || 0;
    if (isNaN(v)) return { score: 0, max: pts, manual: false };
    return { score: (Math.abs(v - exp) <= tol) ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'fill') {
    var blanks = (String(q.template || '').match(/\[([^\]]+)\]/g) || []).map(function(b){ return b.slice(1, -1); });
    var arr = Array.isArray(answer) ? answer : [];
    if (!blanks.length) return { score: 0, max: pts, manual: false };
    var perBlank = pts / blanks.length;
    var got = 0;
    blanks.forEach(function(spec, i) {
      var alts2 = spec.split('|').map(function(s){ return s.trim(); });
      var a2 = String(arr[i] || '');
      var hit = alts2.some(function(x){ return q.caseSensitive ? x === a2 : x.toLowerCase() === a2.toLowerCase(); });
      if (hit) got += perBlank;
    });
    return { score: Math.round(got * 100) / 100, max: pts, manual: false };
  }
  if (q.type === 'matching') {
    var pairs = q.pairs || []; if (!pairs.length) return { score: 0, max: pts, manual: false };
    var map = (typeof answer === 'object' && answer) ? answer : {};
    var per = pts / pairs.length; var s = 0;
    pairs.forEach(function(p) { if (String(map[p.id]) === String(p.id)) s += per; });
    return { score: Math.round(s * 100) / 100, max: pts, manual: false };
  }
  if (q.type === 'ordering') {
    var items = q.items || []; var ord = Array.isArray(answer) ? answer : [];
    if (!items.length) return { score: 0, max: pts, manual: false };
    var ok = items.length === ord.length && items.every(function(it, i) { return String(it.id) === String(ord[i]); });
    return { score: ok ? pts : 0, max: pts, manual: false };
  }
  if (q.type === 'essay' || q.type === 'upload') {
    return { score: 0, max: pts, manual: true };
  }
  return { score: 0, max: pts, manual: true };
}

function _examComputeTotals_(ex, sub) {
  var auto = 0, manual = 0, max = 0;
  var grades = sub.grades || {};
  (ex.questions || []).forEach(function(q) {
    var pts = Number(q.points) || 0; max += pts;
    var a = (sub.answers || []).filter(function(x){ return x.questionId === q.id; })[0];
    var ans = a ? a.answer : null;
    var g = _examAutoGradeQuestion_(q, ans);
    if (!g.manual) auto += g.score;
    var m = grades[q.id] && grades[q.id].manualScore;
    if (m != null && !isNaN(Number(m))) manual += Number(m);
  });
  return { autoScore: Math.round(auto * 100) / 100, manualScore: Math.round(manual * 100) / 100, score: Math.round((auto + manual) * 100) / 100, maxScore: max };
}

function _examNeedsManual_(ex) {
  return (ex.questions || []).some(function(q){ return q.type === 'essay' || q.type === 'upload'; });
}

function _examStudentInfoFromAuth_(auth) {
  var sid = (auth && (auth.studentId || auth.id || auth.userId)) || '';
  var name = (auth && (auth.fullName || auth.displayName || auth.name || '')) || '';
  var classRoom = (auth && (auth.classRoom || auth.class || auth.classroom)) || '';
  return { studentId: String(sid), studentName: String(name), classRoom: String(classRoom) };
}

function _examIsAvailableForStudent_(ex, info) {
  if (ex.status !== 'PUBLISHED') return false;
  var s = ex.settings || {};
  var now = new Date();
  if (s.openAt) { var op = new Date(s.openAt); if (!isNaN(op.getTime()) && now < op) return false; }
  if (s.dueAt) {
    var du = new Date(s.dueAt);
    if (!isNaN(du.getTime()) && now > du) {
      if (s.latePolicy === 'STRICT') return false;
    }
  }
  if (Array.isArray(ex.classes) && ex.classes.length && info.classRoom) {
    if (ex.classes.indexOf(info.classRoom) === -1) {
      var students = (s.students || []);
      if (!(students.length && students.indexOf(info.studentId) !== -1)) return false;
    }
  }
  return true;
}

function examListForStudent_(data, auth) {
  var viewer = getViewerInfo_(auth);
  var perms = (viewer && viewer.success && viewer.permissions) ? viewer.permissions : {};
  if (viewer && viewer.success && String(viewer.role || '').toUpperCase() === 'STUDENT') {
    var canViewStudentExams = !!(perms.pt_view_exam_calendar || perms.sp_view_exams || perms.p_grades);
    if (!canViewStudentExams) return { success: true, exams: [] };
  }
  var info = _examStudentInfoFromAuth_(auth);
  if ((!info.classRoom || !String(info.classRoom).trim()) && viewer && viewer.success) {
    info.classRoom = String(viewer.level || '').trim();
  }
  var all = _examReadAll_().filter(function(ex){ return _examIsAvailableForStudent_(ex, info); });
  var subs = _examSubReadAll_().filter(function(s){ return s.studentId === info.studentId; });
  var byExam = {}; subs.forEach(function(s){ (byExam[s.examId] = byExam[s.examId] || []).push(s); });
  var out = all.map(function(ex) {
    var mySubs = byExam[ex.id] || [];
    var lastSub = mySubs.sort(function(a,b){ return (b.submittedAt||'').localeCompare(a.submittedAt||''); })[0];
    var attempts = mySubs.length;
    var max = (ex.settings && ex.settings.retakeMax) || 0;
    var canTake = (max === 0) || (attempts < max);
    return {
      id: ex.id, title: ex.title, subject: ex.subject, cycle: ex.cycle,
      settings: { dueAt: ex.settings && ex.settings.dueAt, timeLimitMin: ex.settings && ex.settings.timeLimitMin },
      canTake: canTake, attemptsUsed: attempts, attemptsMax: max,
      lastSubmissionStatus: lastSub ? ('Dernière tentative : ' + (lastSub.status || '') + (lastSub.score != null ? ' (' + lastSub.score + '/' + lastSub.maxScore + ')' : '')) : ''
    };
  });
  return { success: true, exams: out };
}

function examStartForStudent_(data, auth) {
  try {
    var examId = data && data.examId; if (!examId) return { success: false, error: 'examId required.' };
    var info = _examStudentInfoFromAuth_(auth);
    if (!info.studentId) return { success: false, error: 'Auth required.' };
    var ex = _examReadAll_().filter(function(x){ return x.id === examId; })[0];
    if (!ex) return { success: false, error: 'Not found.' };
    if (!_examIsAvailableForStudent_(ex, info)) return { success: false, error: 'Examen non disponible.' };
    var subs = _examSubReadAll_().filter(function(s){ return s.examId === examId && s.studentId === info.studentId; });
    var inProgress = subs.filter(function(s){ return s.status === 'IN_PROGRESS'; })[0];
    if (inProgress && ex.settings && ex.settings.allowResume !== false) {
      var savedAns = {}; (inProgress.answers || []).forEach(function(a){ savedAns[a.questionId] = a.answer; });
      var remaining = null;
      if (ex.settings.timeLimitMin > 0) {
        var elapsedMs = (new Date().getTime()) - new Date(inProgress.startedAt).getTime();
        remaining = Math.max(0, Math.floor(ex.settings.timeLimitMin * 60 - elapsedMs / 1000));
      }
      return { success: true, data: { exam: _examSanitizeForStudent_(ex), submissionId: inProgress.id, savedAnswers: savedAns, startedAt: inProgress.startedAt, remainingSec: remaining } };
    }
    var max = (ex.settings && ex.settings.retakeMax) || 0;
    if (max > 0 && subs.filter(function(s){ return s.status !== 'IN_PROGRESS'; }).length >= max) {
      return { success: false, error: 'Nombre de tentatives atteint.' };
    }
    var sub = {
      id: _examSubId_(), examId: examId, studentId: info.studentId, studentName: info.studentName,
      attempt: subs.length + 1, startedAt: new Date().toISOString(), status: 'IN_PROGRESS',
      answers: [], grades: {}
    };
    var sh = _examSubSheet_();
    sh.appendRow([
      sub.id, sub.examId, sub.studentId, sub.studentName, sub.attempt,
      new Date(sub.startedAt), '', sub.status, '[]', '{}', '', '', '', '', ''
    ]);
    return { success: true, data: { exam: _examSanitizeForStudent_(ex), submissionId: sub.id, savedAnswers: {}, startedAt: sub.startedAt, remainingSec: ex.settings && ex.settings.timeLimitMin ? ex.settings.timeLimitMin * 60 : null } };
  } catch(e) { return { success: false, error: e.message }; }
}

function _examSanitizeForStudent_(ex) {
  var out = JSON.parse(JSON.stringify(ex));
  (out.questions || []).forEach(function(q) {
    if (q.options) q.options.forEach(function(o){ delete o.correct; });
    if (q.type === 'boolean') delete q.correct;
    if (q.type === 'short') delete q.acceptedAnswers;
    if (q.type === 'numeric') { delete q.expected; delete q.tolerance; }
    if (q.type === 'ordering') { (q.items || []).sort(function(){ return Math.random() - 0.5; }); }
    delete q.explanation;
  });
  if (out.settings) delete out.settings.password;
  return out;
}

function examSaveProgress_(data, auth) {
  var subId = data && data.submissionId; if (!subId) return { success: false, error: 'submissionId required.' };
  var info = _examStudentInfoFromAuth_(auth);
  var sh = _examSubSheet_(); var idx = _examSubFindRowIndex_(subId);
  if (idx === -1) return { success: false, error: 'Not found.' };
  var sub = _examSubReadAll_().filter(function(s){ return s.id === subId; })[0];
  if (sub.studentId !== info.studentId) return { success: false, error: 'Forbidden.' };
  var ansMap = data.answers || {};
  sub.answers = Object.keys(ansMap).map(function(qid){ return { questionId: qid, answer: ansMap[qid] }; });
  _examSubWriteRow_(sh, idx, sub);
  return { success: true };
}

function examSubmitForStudent_(data, auth) {
  var subId = data && data.submissionId; if (!subId) return { success: false, error: 'submissionId required.' };
  var info = _examStudentInfoFromAuth_(auth);
  var sh = _examSubSheet_(); var idx = _examSubFindRowIndex_(subId);
  if (idx === -1) return { success: false, error: 'Not found.' };
  var sub = _examSubReadAll_().filter(function(s){ return s.id === subId; })[0];
  if (sub.studentId !== info.studentId) return { success: false, error: 'Forbidden.' };
  var ex = _examReadAll_().filter(function(x){ return x.id === sub.examId; })[0];
  if (!ex) return { success: false, error: 'Exam not found.' };
  var ansMap = data.answers || {};
  sub.answers = Object.keys(ansMap).map(function(qid){ return { questionId: qid, answer: ansMap[qid] }; });
  sub.submittedAt = new Date().toISOString();
  var s = ex.settings || {}; var penalty = 0;
  if (s.dueAt) {
    var due = new Date(s.dueAt);
    if (!isNaN(due.getTime()) && new Date(sub.submittedAt) > due) {
      var graceOk = (s.latePolicy === 'GRACE_24' && (new Date(sub.submittedAt) - due) <= 24 * 3600 * 1000);
      if (!graceOk && s.latePolicy !== 'STRICT') {
        var daysLate = Math.ceil((new Date(sub.submittedAt) - due) / (24 * 3600 * 1000));
        penalty = Math.min(100, daysLate * (Number(s.latePenaltyPct) || 0));
      }
    }
  }
  var totals = _examComputeTotals_(ex, sub);
  sub.autoScore = totals.autoScore; sub.maxScore = totals.maxScore;
  var rawScore = totals.score;
  if (penalty > 0) rawScore = Math.max(0, rawScore * (1 - penalty / 100));
  sub.score = Math.round(rawScore * 100) / 100;
  sub.status = _examNeedsManual_(ex) ? 'PENDING_REVIEW' : 'GRADED';
  if (penalty > 0) sub.feedback = 'Pénalité de retard appliquée : -' + penalty + '%';
  _examSubWriteRow_(sh, idx, sub);
  try { _audit_safe_('submitExam', { examId: ex.id, submissionId: subId, score: sub.score, maxScore: sub.maxScore }, auth); } catch(_e) {}
  // Bridge into grades sheet only if fully auto-graded (no pending review)
  if (sub.status === 'GRADED') {
    try {
      _writeAssessmentGrade_({
        studentId: sub.studentId,
        subjectId: ex.subject || ex.title,
        periodId: ex.period || s.period || 'P1',
        score: sub.score,
        maxScore: sub.maxScore,
        gradeId: 'EXAM-' + ex.id + '-' + sub.studentId,
        sourceTag: 'EXAM'
      });
    } catch(_e){}
  }
  var passMark = Number(s.passMark) || 0;
  var pct = sub.maxScore > 0 ? (sub.score / sub.maxScore * 100) : 0;
  var passed = pct >= passMark;
  var showScore = (s.scoreVisibility === 'IMMEDIATE') && (s.showScore !== false);
  return { success: true, data: {
    examTitle: ex.title, status: sub.status, passed: passed,
    score: showScore ? sub.score : null, maxScore: showScore ? sub.maxScore : null,
    showScore: showScore, feedback: sub.feedback || ''
  }};
}

function examGetStudentResult_(data, auth) {
  var examId = data && data.examId; if (!examId) return { success: false, error: 'examId required.' };
  var info = _examStudentInfoFromAuth_(auth);
  var subs = _examSubReadAll_().filter(function(s){ return s.examId === examId && s.studentId === info.studentId; });
  if (!subs.length) return { success: false, error: 'Aucune tentative.' };
  var ex = _examReadAll_().filter(function(x){ return x.id === examId; })[0];
  var policy = (ex && ex.settings && ex.settings.retakePolicy) || 'BEST';
  var done = subs.filter(function(s){ return s.status !== 'IN_PROGRESS'; });
  if (!done.length) return { success: false, error: 'Aucune tentative finalisée.' };
  var picked;
  if (policy === 'BEST') picked = done.slice().sort(function(a,b){ return (b.score||0) - (a.score||0); })[0];
  else if (policy === 'LAST') picked = done.slice().sort(function(a,b){ return (b.submittedAt||'').localeCompare(a.submittedAt||''); })[0];
  else if (policy === 'FIRST') picked = done.slice().sort(function(a,b){ return (a.submittedAt||'').localeCompare(b.submittedAt||''); })[0];
  else if (policy === 'AVG') {
    var avg = done.reduce(function(s,r){ return s + (r.score||0); }, 0) / done.length;
    picked = Object.assign({}, done[0], { score: Math.round(avg * 100) / 100 });
  } else picked = done[0];
  var sset = ex.settings || {};
  var canShow = true;
  if (sset.scoreVisibility === 'AFTER_DUE') canShow = (sset.dueAt && new Date() > new Date(sset.dueAt));
  else if (sset.scoreVisibility === 'NEVER') canShow = false;
  else if (sset.scoreVisibility === 'MANUAL') canShow = (picked.status === 'GRADED');
  var passMark = Number(sset.passMark) || 0;
  var pct = picked.maxScore > 0 ? (picked.score / picked.maxScore * 100) : 0;
  return { success: true, data: {
    examTitle: ex.title, status: picked.status, passed: pct >= passMark,
    score: canShow ? picked.score : null, maxScore: canShow ? picked.maxScore : null,
    showScore: canShow, feedback: picked.feedback || ''
  }};
}

function _audit_safe_(action, payload, auth) {
  try {
    if (typeof audit_ === 'function') return audit_(action, payload, auth);
    if (typeof _audit_ === 'function') return _audit_(action, payload, auth);
  } catch(_e) {}
}

/* =========================================================================
 *  MEDIA LIBRARY  +  HOMEWORK  BACKEND MODULE
 *  Appended to school.js — provides mediaList_/Save_/Delete_/Upload_,
 *  homeworkList_/Save_/Delete_/Grade_/GetGrades_/ConvertToExam_/
 *  ListForStudent_/StudentBulletin_
 * =======================================================================*/

var MEDIA_HEADERS_ = ['id','title','type','source','url','file_id','mime','size_bytes','thumbnail','cycle','level','classes_csv','subject','description','tags_csv','uploaded_by','created_at','updated_at'];
var HOMEWORK_HEADERS_ = ['id','title','subject','subject_branch','period','cycle','classes_csv','description','due_date','max_score','weight','status','created_by','created_at','updated_at'];
var HOMEWORK_GRADES_HEADERS_ = ['id','homework_id','student_id','student_name','class_name','score','max_score','comment','submitted_at','graded_by','graded_at'];

function _mediaSheet_(){
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Media_Library');
  if(!sh){
    sh = ss.insertSheet('Media_Library');
    sh.getRange(1,1,1,MEDIA_HEADERS_.length).setValues([MEDIA_HEADERS_]).setFontWeight('bold').setBackground('#7c3aed').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _homeworkSheet_(){
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Homeworks');
  if(!sh){
    sh = ss.insertSheet('Homeworks');
    sh.getRange(1,1,1,HOMEWORK_HEADERS_.length).setValues([HOMEWORK_HEADERS_]).setFontWeight('bold').setBackground('#0369a1').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    // Schema migration: add any missing columns at the end
    try {
      var existing = sh.getRange(1,1,1,Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
      HOMEWORK_HEADERS_.forEach(function(col){
        if (existing.indexOf(col) < 0) {
          sh.getRange(1, sh.getLastColumn()+1).setValue(col).setFontWeight('bold').setBackground('#fff2cc');
        }
      });
    } catch(_e){}
  }
  return sh;
}
function _homeworkGradesSheet_(){
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Homework_Grades');
  if(!sh){
    sh = ss.insertSheet('Homework_Grades');
    sh.getRange(1,1,1,HOMEWORK_GRADES_HEADERS_.length).setValues([HOMEWORK_GRADES_HEADERS_]).setFontWeight('bold').setBackground('#059669').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _mhId_(prefix){
  return (prefix||'X_')+Utilities.getUuid().replace(/-/g,'').substring(0,12).toUpperCase();
}
function _mhRowToObj_(headers, row){
  var o = {}; for(var i=0;i<headers.length;i++){ o[headers[i]] = row[i]; } return o;
}
function _mhFindRowById_(sh, id){
  var lr = sh.getLastRow(); if(lr<2) return -1;
  var ids = sh.getRange(2,1,lr-1,1).getValues();
  for(var i=0;i<ids.length;i++){ if(String(ids[i][0])===String(id)) return i+2; }
  return -1;
}
function _mhIso_(d){
  if(!d) return '';
  if(d instanceof Date) return d.toISOString();
  return String(d);
}

/* ============================ MEDIA LIBRARY ============================ */
function mediaSave_(data, auth){
  var sh = _mediaSheet_();
  var now = new Date().toISOString();
  var rec = data && data.media || data || {};
  var id = String(rec.id||'').trim() || _mhId_('MED_');
  var row = [
    id,
    String(rec.title||'').trim(),
    String(rec.type||'DOC').toUpperCase(),     // DOC / VIDEO / IMAGE / AUDIO
    String(rec.source||'URL').toUpperCase(),    // URL / DRIVE / YOUTUBE / VIMEO
    String(rec.url||'').trim(),
    String(rec.file_id||rec.fileId||'').trim(),
    String(rec.mime||'').trim(),
    Number(rec.size_bytes||rec.sizeBytes||0)||0,
    String(rec.thumbnail||'').trim(),
    String(rec.cycle||'').trim(),
    String(rec.level||'').trim(),
    (Array.isArray(rec.classes)?rec.classes.join(','):String(rec.classes_csv||rec.classes||'')),
    String(rec.subject||'').trim(),
    String(rec.description||''),
    (Array.isArray(rec.tags)?rec.tags.join(','):String(rec.tags_csv||rec.tags||'')),
    String((auth&&(auth.email||auth.userId))||rec.uploaded_by||''),
    rec.created_at || now,
    now
  ];
  var existing = _mhFindRowById_(sh, id);
  if(existing>0){
    row[16] = sh.getRange(existing, 17).getValue() || row[16]; // keep created_at
    sh.getRange(existing,1,1,row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  _audit_safe_('MEDIA_SAVED', { id:id, title:row[1], type:row[2] }, auth);
  return { ok:true, id:id };
}

function mediaList_(data, auth){
  var viewer = getViewerInfo_(auth);
  var perms = (viewer && viewer.success && viewer.permissions) ? viewer.permissions : {};
  var isStudentViewer = !!(viewer && viewer.success && String(viewer.role || '').toUpperCase() === 'STUDENT');
  if (isStudentViewer) {
    var canViewStudentDocs = !!(perms.sp_view_documents || perms.pt_view_bulletin);
    if (!canViewStudentDocs) return { rows: [] };
  }
  var sh = _mediaSheet_();
  var lr = sh.getLastRow(); if(lr<2) return { rows:[] };
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  var values = sh.getRange(2,1,lr-1,headers.length).getValues();
  var filterCycle = data && data.cycle ? String(data.cycle).toLowerCase() : '';
  var filterClass = data && data.className ? String(data.className).toLowerCase() : '';
  if (!filterClass && isStudentViewer) {
    filterClass = String((viewer && viewer.level) || '').toLowerCase();
  }
  var filterType  = data && data.type ? String(data.type).toUpperCase() : '';
  var rows = values.map(function(r){ return _mhRowToObj_(headers, r); }).filter(function(o){
    if(filterCycle && String(o.cycle||'').toLowerCase()!==filterCycle) return false;
    if(filterType && String(o.type||'').toUpperCase()!==filterType) return false;
    if(filterClass){
      var cls = String(o.classes_csv||'').toLowerCase();
      if(cls && cls.indexOf(filterClass)<0) return false;
    }
    return true;
  }).map(function(o){
    o.created_at = _mhIso_(o.created_at);
    o.updated_at = _mhIso_(o.updated_at);
    o.classes = String(o.classes_csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    o.tags = String(o.tags_csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    return o;
  });
  rows.sort(function(a,b){ return String(b.created_at).localeCompare(String(a.created_at)); });
  return { rows: rows };
}

function mediaDelete_(data, auth){
  var sh = _mediaSheet_();
  var id = data && data.id; if(!id) throw new Error('id requis');
  var r = _mhFindRowById_(sh, id); if(r<0) throw new Error('Média introuvable');
  sh.deleteRow(r);
  _audit_safe_('MEDIA_DELETED', { id:id }, auth);
  return { ok:true };
}

function mediaUpload_(data, auth){
  // data = { name, mimeType, contentBase64, folderName? }
  if(!data || !data.contentBase64) throw new Error('contentBase64 requis');
  var name = String(data.name||'document');
  var mime = String(data.mimeType||'application/octet-stream');
  var bytes = Utilities.base64Decode(String(data.contentBase64));
  var blob = Utilities.newBlob(bytes, mime, name);
  // Folder: school media root
  var folderName = String(data.folderName||'School_Media');
  var folder;
  var it = DriveApp.getFoldersByName(folderName);
  folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_e){}
  var fileId = file.getId();
  var url = 'https://drive.google.com/file/d/'+fileId+'/preview';
  _audit_safe_('MEDIA_UPLOADED', { name:name, fileId:fileId, mime:mime }, auth);
  return { ok:true, fileId:fileId, url:url, viewUrl:'https://drive.google.com/file/d/'+fileId+'/view', size: bytes.length };
}

/* ============================ HOMEWORK ============================ */
function homeworkSave_(data, auth){
  var sh = _homeworkSheet_();
  var now = new Date().toISOString();
  var rec = data && data.homework || data || {};
  var id = String(rec.id||'').trim() || _mhId_('HW_');
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  var valuesMap = {
    id: id,
    title: String(rec.title||'').trim(),
    subject: String(rec.subject||'').trim(),
    subject_branch: String(rec.subject_branch||rec.subjectBranch||'').trim(),
    period: String(rec.period||'').trim(),
    cycle: String(rec.cycle||'').trim(),
    classes_csv: (Array.isArray(rec.classes)?rec.classes.join(','):String(rec.classes_csv||rec.classes||'')),
    description: String(rec.description||''),
    due_date: _mhIso_(rec.due_date||rec.dueDate||''),
    max_score: Number(rec.max_score||rec.maxScore||0)||_getConfigMaxScore_({})||0,
    weight: Number(rec.weight||1)||1,
    status: String(rec.status||'ACTIVE').toUpperCase(),
    created_by: String((auth&&(auth.email||auth.userId))||rec.created_by||''),
    created_at: rec.created_at || now,
    updated_at: now
  };
  var row = headers.map(function(h){ return valuesMap.hasOwnProperty(h) ? valuesMap[h] : ''; });
  var existing = _mhFindRowById_(sh, id);
  if(existing>0){
    var iCreated = headers.indexOf('created_at');
    if (iCreated >= 0) {
      var prev = sh.getRange(existing, iCreated+1).getValue();
      if (prev) row[iCreated] = prev;
    }
    sh.getRange(existing,1,1,row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  _audit_safe_('HOMEWORK_SAVED', { id:id, title:valuesMap.title }, auth);
  return { ok:true, id:id };
}

function homeworkList_(data, auth){
  var sh = _homeworkSheet_();
  var lr = sh.getLastRow(); if(lr<2) return { rows:[] };
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  var values = sh.getRange(2,1,lr-1,headers.length).getValues();
  var rows = values.map(function(r){ return _mhRowToObj_(headers, r); }).map(function(o){
    o.due_date = _mhIso_(o.due_date);
    o.created_at = _mhIso_(o.created_at);
    o.updated_at = _mhIso_(o.updated_at);
    o.classes = String(o.classes_csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    return o;
  });
  rows.sort(function(a,b){ return String(b.created_at).localeCompare(String(a.created_at)); });
  return { rows: rows };
}

function homeworkDelete_(data, auth){
  var sh = _homeworkSheet_();
  var id = data && data.id; if(!id) throw new Error('id requis');
  var r = _mhFindRowById_(sh, id); if(r<0) throw new Error('Devoir introuvable');
  sh.deleteRow(r);
  _audit_safe_('HOMEWORK_DELETED', { id:id }, auth);
  return { ok:true };
}

function homeworkGrade_(data, auth){
  // data = { homeworkId, grades: [{studentId, studentName, className, score, comment}] }
  if(!data || !data.homeworkId) throw new Error('homeworkId requis');
  var grades = Array.isArray(data.grades) ? data.grades : [];
  if(!grades.length) throw new Error('Aucune note à enregistrer');
  var hwSh = _homeworkSheet_();
  var hwRow = _mhFindRowById_(hwSh, data.homeworkId);
  if(hwRow<0) throw new Error('Devoir introuvable');
  var hwHeaders = hwSh.getRange(1,1,1,hwSh.getLastColumn()).getValues()[0].map(String);
  var hwData = _mhRowToObj_(hwHeaders, hwSh.getRange(hwRow,1,1,hwHeaders.length).getValues()[0]);
  var maxScore = Number(hwData.max_score||0) || _getConfigMaxScore_({});
  if (!maxScore) throw new Error('max_score manquant pour ce devoir et MAX_SCORE non configuré dans les paramètres.');
  var sh = _homeworkGradesSheet_();
  var lr = sh.getLastRow();
  var existingMap = {};
  if(lr>=2){
    var allHeaders = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    var allRows = sh.getRange(2,1,lr-1,allHeaders.length).getValues();
    for(var i=0;i<allRows.length;i++){
      var o = _mhRowToObj_(allHeaders, allRows[i]);
      if(String(o.homework_id)===String(data.homeworkId)){
        existingMap[String(o.student_id)] = i+2;
      }
    }
  }
  var now = new Date().toISOString();
  var grader = String((auth&&(auth.email||auth.userId))||'');
  var saved = 0;
  grades.forEach(function(g){
    if(!g.studentId) return;
    var row = [
      _mhId_('HWG_'),
      data.homeworkId,
      String(g.studentId),
      String(g.studentName||''),
      String(g.className||''),
      Number(g.score||0)||0,
      maxScore,
      String(g.comment||''),
      now,
      grader,
      now
    ];
    var ex = existingMap[String(g.studentId)];
    if(ex){
      row[0] = sh.getRange(ex,1).getValue();
      sh.getRange(ex,1,1,row.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    saved++;
    // Bridge into grades sheet
    try {
      _writeAssessmentGrade_({
        studentId: String(g.studentId),
        subjectId: String(hwData.subject || hwData.title || 'Devoir'),
        periodId: String(hwData.period || 'P1'),
        score: Number(g.score||0)||0,
        maxScore: maxScore,
        gradeId: 'HW-' + data.homeworkId + '-' + String(g.studentId),
        sourceTag: 'HOMEWORK'
      });
    } catch(_e){}
  });
  _audit_safe_('HOMEWORK_GRADED', { homeworkId:data.homeworkId, count:saved }, auth);
  return { ok:true, saved:saved };
}

function homeworkGetGrades_(data, auth){
  if(!data || !data.homeworkId) throw new Error('homeworkId requis');
  var sh = _homeworkGradesSheet_();
  var lr = sh.getLastRow(); if(lr<2) return { rows:[] };
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  var values = sh.getRange(2,1,lr-1,headers.length).getValues();
  var rows = values.map(function(r){ return _mhRowToObj_(headers, r); })
    .filter(function(o){ return String(o.homework_id)===String(data.homeworkId); })
    .map(function(o){ o.submitted_at=_mhIso_(o.submitted_at); o.graded_at=_mhIso_(o.graded_at); return o; });
  return { rows: rows };
}

function homeworkConvertToExam_(data, auth){
  // Promote a HOMEWORK row into an EXAM (essay-only single question), preserves grades
  if(!data || !data.homeworkId) throw new Error('homeworkId requis');
  var hwSh = _homeworkSheet_();
  var hwRow = _mhFindRowById_(hwSh, data.homeworkId);
  if(hwRow<0) throw new Error('Devoir introuvable');
  var hwHeaders = hwSh.getRange(1,1,1,hwSh.getLastColumn()).getValues()[0].map(String);
  var hw = _mhRowToObj_(hwHeaders, hwSh.getRange(hwRow,1,1,hwHeaders.length).getValues()[0]);
  // Build minimal Exam
  if(typeof examSave_ !== 'function') throw new Error('Module examen indisponible');

  // Fix 4: Read pass mark from config — no hardcoded value.
  // passingScore is a required setting key; error if absent so the admin is
  // prompted to configure it rather than silently using a wrong threshold.
  var confRes = getSaaSSettings_(auth || null);
  if (!confRes || !confRes.success || !confRes.data) {
    throw new Error('Configuration introuvable. Veuillez configurer les paramètres de l\'école avant de convertir un devoir.');
  }
  var conf = confRes.data;
  var configuredPassMark = Number(conf.passingScore || conf.PASSING_SCORE || conf.PERIOD_PASSING_AVG);
  if (!Number.isFinite(configuredPassMark) || configuredPassMark <= 0) {
    throw new Error(
      'Paramètre passingScore (note de passage) manquant dans la configuration. ' +
      'Veuillez le définir dans Paramètres > Évaluation avant de convertir un devoir en examen.'
    );
  }

  var maxScore = Number(hw.max_score||0) || Number(conf.maxScore || conf.MAX_SCORE || 0);
  if (!maxScore || maxScore <= 0) {
    throw new Error(
      'Score maximum introuvable pour ce devoir et paramètre maxScore absent de la configuration. ' +
      'Veuillez définir maxScore dans Paramètres > Évaluation.'
    );
  }

  var examPayload = {
    exam: {
      id: '',
      title: '[Devoir converti] ' + (hw.title||''),
      subject: hw.subject||'',
      description: hw.description||'',
      status: 'PUBLISHED',
      cycle: hw.cycle||'',
      classes: String(hw.classes_csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean),
      settings: {
        cycle: hw.cycle||'',
        classes: String(hw.classes_csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean),
        dueAt: _mhIso_(hw.due_date||''),
        passMark: configuredPassMark,
        retakeMax: 0,
        scoreVisibility: 'MANUAL',
        showScore: false
      },
      questions: [
        { id:_mhId_('Q_'), type:'essay', prompt: hw.description||hw.title||'Travail à rendre', points: maxScore, minWords:0, maxWords:0 }
      ]
    }
  };
  var res = examSave_(examPayload, auth);
  // Mark homework converted
  var statusCol = hwHeaders.indexOf('status')+1;
  if(statusCol>0) hwSh.getRange(hwRow, statusCol).setValue('CONVERTED');
  _audit_safe_('HOMEWORK_CONVERTED_TO_EXAM', { homeworkId:data.homeworkId, examId:res && res.id }, auth);
  return { ok:true, examId: res && res.id, homeworkId: data.homeworkId };
}

function homeworkListForStudent_(data, auth){
  var viewer = getViewerInfo_(auth);
  var perms = (viewer && viewer.success && viewer.permissions) ? viewer.permissions : {};
  if (viewer && viewer.success && String(viewer.role || '').toUpperCase() === 'STUDENT') {
    var canViewStudentHomework = !!(perms.sp_view_homework || perms.pt_view_exam_calendar || perms.p_grades);
    if (!canViewStudentHomework) return { rows: [] };
  }
  // returns list of homework + grade for this student
  var studentId = String((data&&data.studentId) || (auth&&auth.studentId) || (auth&&auth.userId) || '').trim();
  if(!studentId) throw new Error('Élève non identifié');
  var hwSh = _homeworkSheet_();
  var lr = hwSh.getLastRow(); if(lr<2) return { rows:[] };
  var headers = hwSh.getRange(1,1,1,hwSh.getLastColumn()).getValues()[0].map(String);
  var values = hwSh.getRange(2,1,lr-1,headers.length).getValues();
  var hwList = values.map(function(r){ return _mhRowToObj_(headers, r); });
  // grades
  var gSh = _homeworkGradesSheet_();
  var gMap = {};
  var glr = gSh.getLastRow();
  if(glr>=2){
    var gh = gSh.getRange(1,1,1,gSh.getLastColumn()).getValues()[0].map(String);
    var gv = gSh.getRange(2,1,glr-1,gh.length).getValues();
    gv.forEach(function(r){
      var o = _mhRowToObj_(gh, r);
      if(String(o.student_id)===studentId) gMap[String(o.homework_id)] = o;
    });
  }
  // student class filter
  var studentClass = String(
    (data && data.className)
    || (auth && (auth.className || auth.classRoom || auth.class || auth.classroom || auth.level))
    || ((viewer && viewer.success) ? (viewer.level || '') : '')
    || ''
  ).toLowerCase();
  var rows = hwList.filter(function(h){
    var st = String(h.status||'').toUpperCase();
    if(st==='ARCHIVED' || st==='DRAFT') return false;
    if(!studentClass) return true;
    var classes = String(h.classes_csv||'').toLowerCase();
    return !classes || classes.indexOf(studentClass)>=0;
  }).map(function(h){
    var g = gMap[String(h.id)] || null;
    return {
      id: h.id, title: h.title, subject: h.subject,
      due_date: _mhIso_(h.due_date),
      max_score: Number(h.max_score) || _getConfigMaxScore_({}) || 0,
      score: g ? Number(g.score||0) : null,
      comment: g ? String(g.comment||'') : '',
      graded_at: g ? _mhIso_(g.graded_at) : '',
      status: g ? 'GRADED' : 'PENDING'
    };
  });
  rows.sort(function(a,b){ return String(b.due_date).localeCompare(String(a.due_date)); });
  return { rows: rows };
}

function homeworkStudentBulletin_(data, auth){
  // Simplified bulletin: list of all graded homework + average
  var studentId = String((data&&data.studentId) || (auth&&auth.studentId) || (auth&&auth.userId) || '').trim();
  if(!studentId) throw new Error('Élève non identifié');
  var period = data && data.period || 'all'; // all | T1 | T2 | T3 | year
  var listed = homeworkListForStudent_({ studentId: studentId, className: data && data.className }, auth);
  var rows = (listed.rows||[]).filter(function(r){ return r.status==='GRADED'; });
  var totalScore = 0, totalMax = 0;
  rows.forEach(function(r){ totalScore += Number(r.score||0); totalMax += Number(r.max_score||0); });
  var configMax = _getConfigMaxScore_({}) || (totalMax > 0 ? (totalMax / rows.length) : 100);
  var avg = totalMax>0 ? Math.round((totalScore/totalMax)*configMax*10)/10 : 0; // configurable scale
  return {
    studentId: studentId,
    period: period,
    rows: rows,
    totals: { count: rows.length, sumScore: totalScore, sumMax: totalMax, averageOnScale: avg, configMax: configMax },
    generatedAt: new Date().toISOString()
  };
}

/* ============================================================
 *  ASSESSMENT -> GRADES BRIDGE
 *  Pushes scores from online exams and homework into the canonical
 *  'grades' sheet so they appear in bulletins/averages alongside
 *  manually entered grades. Idempotent via deterministic GradeID.
 * ============================================================*/
function _writeAssessmentGrade_(opts) {
  try {
    if (!opts || !opts.studentId || !opts.subjectId) return { ok:false, error:'missing studentId/subjectId' };
    if (opts.score == null || isNaN(Number(opts.score))) return { ok:false, error:'invalid score' };
    var ss = getSS_();
    var sh = ss.getSheetByName('grades');
    if (!sh) return { ok:false, error:'grades sheet missing' };
    var data = sh.getDataRange().getValues();
    var h = data[0].map(function(x){ return String(x).trim(); });
    var iGid = h.indexOf('GradeID');
    var iHid = h.indexOf('HistoryID');
    var iSid = h.indexOf('StudentID');
    var iSub = h.indexOf('SubjectID');
    var iPer = h.indexOf('PeriodID');
    var iScr = h.indexOf('Score');
    var iJs  = h.indexOf('ScoresJSON');
    var iTs  = h.indexOf('Timestamp');
    var iUpd = h.indexOf('UpdatedAt');
    if (iGid<0 || iSid<0 || iSub<0 || iScr<0) return { ok:false, error:'grades schema mismatch' };

    // Normalise score onto /20 scale if maxScore provided and != 20
    var rawScore = Number(opts.score);
    var rawMax = Number(opts.maxScore || 0);
    var scaled = rawScore;
    if (rawMax > 0 && rawMax !== 20) scaled = Math.round((rawScore / rawMax) * 20 * 100) / 100;

    // Resolve HistoryID via active enrollment if not provided
    var hid = String(opts.historyId || '').trim();
    if (!hid) {
      try {
        var histMap = _buildActiveHistoryMap(ss);
        var hh = histMap[String(opts.studentId).toUpperCase().trim()];
        if (hh) hid = hh.historyId;
      } catch(_e){}
    }

    var periodId = String(opts.periodId || 'P1').trim();
    var subjectId = String(opts.subjectId).trim();
    var sourceTag = String(opts.sourceTag || 'ASSESS').trim().toUpperCase();
    var gradeId = String(opts.gradeId || (sourceTag + '-' + Utilities.getUuid().substring(0,8))).trim();

    // Find existing row by GradeID (idempotent)
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][iGid]).trim() === gradeId) { rowIdx = i; break; }
    }
    if (rowIdx !== -1) {
      // PERF FIX: batch Score, ScoresJSON, UpdatedAt into one setValues() call.
      var sj = {};
      try { sj = JSON.parse(data[rowIdx][iJs] || '{}'); } catch(_e){}
      sj[periodId] = scaled;
      sj.__source = sourceTag;
      if (rawMax) sj.__max = rawMax;
      var updRow = data[rowIdx].slice();
      updRow[iScr] = scaled;
      if (iJs !== -1) updRow[iJs] = JSON.stringify(sj);
      if (iUpd !== -1) updRow[iUpd] = new Date();
      sh.getRange(rowIdx+1, 1, 1, updRow.length).setValues([updRow]);
    } else {
      var newRow = h.map(function(col){
        switch (col) {
          case 'GradeID':    return gradeId;
          case 'HistoryID':  return hid;
          case 'StudentID':  return String(opts.studentId);
          case 'SubjectID':  return subjectId;
          case 'PeriodID':   return periodId;
          case 'Score':      return scaled;
          case 'ScoresJSON': return JSON.stringify({ __source:sourceTag, __max:rawMax||configuredMax, [periodId]: scaled });
          case 'Timestamp':
          case 'UpdatedAt':  return new Date();
          default:           return '';
        }
      });
      sh.appendRow(newRow);
    }
    try { _clearStudentGradesCache(opts.studentId, ss.getId()); } catch(_e){}
    return { ok:true, gradeId: gradeId, scaled: scaled };
  } catch(e) {
    try { console.warn('_writeAssessmentGrade_ failed: ' + e.message); } catch(_e){}
    return { ok:false, error:e.message };
  }
}