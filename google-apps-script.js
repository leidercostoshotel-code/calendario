/**
 * ============================================================
 * GOOGLE APPS SCRIPT — Agenda Leider Tisnado Mego
 * ============================================================
 * INSTRUCCIONES DE INSTALACIÓN:
 * 1. Ve a https://script.google.com y crea un nuevo proyecto.
 * 2. Pega TODO este código reemplazando el contenido existente.
 * 3. Menú Extensions > Apps Script > Deploy > New deployment.
 *    - Tipo: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copia la URL generada (termina en /exec).
 * 5. Pégala en index.html en la variable: const SHEET_URL = 'TU_URL';
 * ============================================================
 */

const SPREADSHEET_ID = ''; // Opcional: ID de tu Google Sheet específico
                             // Si lo dejas vacío, se crea uno automáticamente.
const SHEET_NAME_NOTES    = 'Notas';
const SHEET_NAME_CONTACTS = 'Contactos';

// ── Punto de entrada GET (usado por JSONP) ──────────────────
function doGet(e) {
  const params  = e.parameter || {};
  const action  = params.action || 'getAll';
  const callback = params.callback; // JSONP callback name

  let result;
  try {
    switch (action) {
      case 'getAll':
        result = getAllData();
        break;
      case 'saveAll':
        result = saveAll(params);
        break;
      default:
        result = { success: false, error: 'Acción desconocida: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  const json = JSON.stringify(result);

  // Si viene con callback → respuesta JSONP
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // Si no → JSON plano (útil para pruebas en el navegador)
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Punto de entrada POST (fallback para payloads grandes) ──
function doPost(e) {
  let params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch (_) {
    params = e.parameter || {};
  }

  let result;
  try {
    const action = params.action || 'saveAll';
    if (action === 'saveAll') {
      result = saveAll(params);
    } else {
      result = { success: false, error: 'Acción POST desconocida: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Obtiene o crea el spreadsheet ──────────────────────────
function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (_) {}
  }
  // Crear uno nuevo
  const ss = SpreadsheetApp.create('Agenda — Leider Tisnado Mego');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

// ── Obtiene o crea una hoja por nombre ─────────────────────
function getSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── Lee todos los datos ────────────────────────────────────
function getAllData() {
  const ss       = getSpreadsheet();
  const notes    = readSheet(ss, SHEET_NAME_NOTES);
  const contacts = readSheet(ss, SHEET_NAME_CONTACTS);
  return { success: true, notes: notes, contacts: contacts };
}

function readSheet(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return data.map(function(row) {
    const obj = {};
    header.forEach(function(key, i) { obj[key] = row[i]; });
    return obj;
  });
}

// ── Guarda todos los datos ─────────────────────────────────
function saveAll(params) {
  const ss = getSpreadsheet();

  let notesArr, contactsArr;
  try {
    notesArr    = JSON.parse(decodeURIComponent(params.notes    || '[]'));
    contactsArr = JSON.parse(decodeURIComponent(params.contacts || '[]'));
  } catch (_) {
    // Si ya vienen como objetos (POST JSON)
    notesArr    = params.notes    || [];
    contactsArr = params.contacts || [];
  }

  writeNotes(ss, notesArr);
  writeContacts(ss, contactsArr);

  return { success: true, saved: { notes: notesArr.length, contacts: contactsArr.length } };
}

// ── Escribe notas ──────────────────────────────────────────
function writeNotes(ss, notes) {
  const sheet = getSheet(ss, SHEET_NAME_NOTES);
  sheet.clearContents();

  const headers = ['id','title','desc','date','priority','type','metricType',
                   'completed','isRecurring','people'];
  sheet.appendRow(headers);

  notes.forEach(function(n) {
    sheet.appendRow([
      n.id        || '',
      n.title     || '',
      n.desc      || '',
      n.date      || '',
      n.priority  || '',
      n.type      || '',
      n.metricType|| 'peso',
      n.completed ? 'true' : 'false',
      n.isRecurring ? 'true' : 'false',
      JSON.stringify(n.people || [])
    ]);
  });

  // Formato cabecera
  styleHeader(sheet, headers.length);
}

// ── Escribe contactos ──────────────────────────────────────
function writeContacts(ss, contacts) {
  const sheet = getSheet(ss, SHEET_NAME_CONTACTS);
  sheet.clearContents();

  const headers = ['id','name','phone','email','category','height','weightHistory'];
  sheet.appendRow(headers);

  contacts.forEach(function(c) {
    sheet.appendRow([
      c.id       || '',
      c.name     || '',
      c.phone    || '',
      c.email    || '',
      c.category || '',
      c.height   || '',
      JSON.stringify(c.weightHistory || [])
    ]);
  });

  styleHeader(sheet, headers.length);
}

// ── Estilo visual para cabecera ────────────────────────────
function styleHeader(sheet, numCols) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#1e3c72');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}
