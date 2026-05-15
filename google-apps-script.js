/**
 * ============================================================
 * GOOGLE APPS SCRIPT — Agenda Leider Tisnado Mego
 * ============================================================
 * PASO 1 — Pega el ID de tu Google Sheet existente:
 *   Abre tu Sheet → URL: .../spreadsheets/d/ESTE_ID/edit
 *   Copia el ID y pégalo abajo en SPREADSHEET_ID.
 *
 * PASO 2 — Despliega como Web App:
 *   Deploy → New deployment → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * PASO 3 — Copia la URL /exec y pégala en index.html en SHEET_URL
 * ============================================================
 */

// ⚠️ OBLIGATORIO: Pega aquí el ID de tu Google Sheet
const SPREADSHEET_ID = '';  // Ej: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'

const SHEET_NAME_NOTES    = 'Notas';
const SHEET_NAME_CONTACTS = 'Contactos';

// ── Obtiene el spreadsheet (nunca crea uno nuevo) ──────────
function getSpreadsheet() {
  // 1. Usar ID hardcodeado si está definido
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  // 2. Buscar en script properties (del deploy anterior)
  var props = PropertiesService.getScriptProperties();
  var storedId = props.getProperty('SPREADSHEET_ID');
  if (storedId) {
    try { return SpreadsheetApp.openById(storedId); } catch (e) {}
  }

  // 3. Buscar por nombre en Drive (encuentra el sheet existente)
  var files = DriveApp.getFilesByName('Agenda — Leider Tisnado Mego');
  if (files.hasNext()) {
    var file = files.next();
    var ss = SpreadsheetApp.openById(file.getId());
    props.setProperty('SPREADSHEET_ID', file.getId());
    return ss;
  }

  // 4. Último recurso: crear uno nuevo (solo si no existe ninguno)
  var newSs = SpreadsheetApp.create('Agenda — Leider Tisnado Mego');
  props.setProperty('SPREADSHEET_ID', newSs.getId());
  return newSs;
}

// ── Función de diagnóstico (ejecútala manualmente para ver cuál sheet usa) ──
function diagnostico() {
  var ss = getSpreadsheet();
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('ID: ' + ss.getId());
  Logger.log('URL: ' + ss.getUrl());
  var notas = ss.getSheetByName(SHEET_NAME_NOTES);
  var contactos = ss.getSheetByName(SHEET_NAME_CONTACTS);
  Logger.log('Hoja Notas: ' + (notas ? notas.getLastRow() - 1 + ' filas' : 'NO ENCONTRADA'));
  Logger.log('Hoja Contactos: ' + (contactos ? contactos.getLastRow() - 1 + ' filas' : 'NO ENCONTRADA'));
}

// ── Punto de entrada GET (JSONP) ────────────────────────────
function doGet(e) {
  var params   = e.parameter || {};
  var action   = params.action || 'getAll';
  var callback = params.callback;

  var result;
  try {
    if (action === 'getAll')       result = getAllData();
    else if (action === 'saveAll') result = saveAll(params);
    else                           result = { success: false, error: 'Acción desconocida: ' + action };
  } catch (err) {
    result = { success: false, error: err.message };
  }

  var json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Punto de entrada POST (payloads grandes) ────────────────
function doPost(e) {
  var params;
  try   { params = JSON.parse(e.postData.contents); }
  catch (_) { params = e.parameter || {}; }

  var result;
  try {
    if ((params.action || 'saveAll') === 'saveAll') result = saveAll(params);
    else result = { success: false, error: 'Acción desconocida' };
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Lee todos los datos ─────────────────────────────────────
function getAllData() {
  var ss       = getSpreadsheet();
  var notes    = readSheet(ss, SHEET_NAME_NOTES);
  var contacts = readSheet(ss, SHEET_NAME_CONTACTS);
  return { success: true, notes: notes, contacts: contacts };
}

function readSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data   = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data.map(function(row) {
    var obj = {};
    header.forEach(function(key, i) {
      var val = row[i];
      // Convertir fechas de Google Sheets a string ISO
      if (val instanceof Date) {
        obj[key] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        obj[key] = val;
      }
    });
    return obj;
  });
}

// ── Guarda todos los datos ──────────────────────────────────
function saveAll(params) {
  var ss = getSpreadsheet();
  var notesArr, contactsArr;

  try {
    notesArr    = JSON.parse(decodeURIComponent(params.notes    || '[]'));
    contactsArr = JSON.parse(decodeURIComponent(params.contacts || '[]'));
  } catch (_) {
    notesArr    = Array.isArray(params.notes)    ? params.notes    : [];
    contactsArr = Array.isArray(params.contacts) ? params.contacts : [];
  }

  if (Array.isArray(notesArr))    writeNotes(ss, notesArr);
  if (Array.isArray(contactsArr)) writeContacts(ss, contactsArr);

  return { success: true, saved: { notes: notesArr.length, contacts: contactsArr.length } };
}

// ── Escribe notas ───────────────────────────────────────────
function writeNotes(ss, notes) {
  var sheet   = getOrCreateSheet(ss, SHEET_NAME_NOTES);
  var headers = ['id','title','desc','date','priority','type','metricType',
                 'completed','isRecurring','people'];
  sheet.clearContents();
  sheet.appendRow(headers);
  notes.forEach(function(n) {
    sheet.appendRow([
      n.id         || '',
      n.title      || '',
      n.desc       || '',
      n.date       || '',
      n.priority   || '',
      n.type       || '',
      n.metricType || 'peso',
      n.completed  ? 'true' : 'false',
      n.isRecurring ? 'true' : 'false',
      JSON.stringify(n.people || [])
    ]);
  });
  styleHeader(sheet, headers.length);
}

// ── Escribe contactos ───────────────────────────────────────
function writeContacts(ss, contacts) {
  var sheet   = getOrCreateSheet(ss, SHEET_NAME_CONTACTS);
  var headers = ['id','name','phone','email','category','height','weightHistory'];
  sheet.clearContents();
  sheet.appendRow(headers);
  contacts.forEach(function(c) {
    sheet.appendRow([
      c.id       || '',
      c.name     || '',
      c.phone    || '',
      c.email    || '',
      c.category || '',
      c.height   != null ? c.height : '',
      JSON.stringify(c.weightHistory || [])
    ]);
  });
  styleHeader(sheet, headers.length);
}

// ── Obtiene o crea una hoja ─────────────────────────────────
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── Estilo de cabecera ──────────────────────────────────────
function styleHeader(sheet, numCols) {
  var range = sheet.getRange(1, 1, 1, numCols);
  range.setBackground('#1e3c72');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}
