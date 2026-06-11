/**
 * ============================================================
 * GOOGLE APPS SCRIPT — Agenda Leider Tisnado Mego
 * ============================================================
 * PASO 1 — Pega el ID de tu Google Sheet existente:
 *   Abre tu Sheet → URL: .../spreadsheets/d/ESTE_ID/edit
 *
 * PASO 2 — Despliega como Web App:
 *   Deploy → New deployment → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * PASO 3 — Copia la URL /exec y pégala en index.html en SHEET_URL
 *
 * PASO 4 — Configura el resumen semanal automático:
 *   Selecciona la función setupWeeklyTrigger y presiona ▶ Ejecutar
 *   (solo una vez — crea un trigger que corre cada lunes a las 8am)
 * ============================================================
 */

const SPREADSHEET_ID      = '';  // Ej: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
const SHEET_NAME_NOTES    = 'Notas';
const SHEET_NAME_CONTACTS = 'Contactos';

// ── Configuración de Brevo (envío de emails) ────────────────
// 1) Crea una cuenta gratis en https://www.brevo.com
// 2) Genera una API Key en: Configuración → SMTP & API → API Keys
// 3) Verifica un remitente (email) en: Configuración → Senders & IP
// 4) Pega aquí tu API Key y el email remitente verificado
const BREVO_API_KEY     = ''; // Ej: 'xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const BREVO_SENDER_EMAIL = ''; // Email remitente verificado en Brevo
const BREVO_SENDER_NAME  = 'Agenda de Salud Personal';

// ── Envía un email — usa Brevo si está configurado, si no MailApp ──
function sendEmail(opts) {
  var props       = PropertiesService.getScriptProperties();
  var apiKey      = BREVO_API_KEY      || props.getProperty('BREVO_API_KEY');
  var senderEmail = BREVO_SENDER_EMAIL || props.getProperty('BREVO_SENDER_EMAIL');
  var senderName  = BREVO_SENDER_NAME  || props.getProperty('BREVO_SENDER_NAME') || 'Agenda de Salud Personal';

  if (!apiKey || !senderEmail) {
    MailApp.sendEmail({ to: opts.to, subject: opts.subject, htmlBody: opts.htmlBody });
    return;
  }

  var response = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'api-key': apiKey, 'accept': 'application/json' },
    payload: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.htmlBody
    }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Brevo error ' + code + ': ' + response.getContentText());
  }
}

// ── Obtiene el spreadsheet ──────────────────────────────────
function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  if (SPREADSHEET_ID) {
    var ss1 = SpreadsheetApp.openById(SPREADSHEET_ID);
    props.setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
    return ss1;
  }
  var storedId = props.getProperty('SPREADSHEET_ID');
  if (storedId) {
    try {
      var ss2 = SpreadsheetApp.openById(storedId);
      if (ss2.getSheetByName(SHEET_NAME_NOTES) && ss2.getSheetByName(SHEET_NAME_CONTACTS)) return ss2;
    } catch (e) {}
  }
  var files = DriveApp.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    var file = files.next();
    try {
      var ss3 = SpreadsheetApp.openById(file.getId());
      if (ss3.getSheetByName(SHEET_NAME_NOTES) && ss3.getSheetByName(SHEET_NAME_CONTACTS)) {
        props.setProperty('SPREADSHEET_ID', file.getId());
        return ss3;
      }
    } catch (e) {}
  }
  var newSs = SpreadsheetApp.create('Agenda — Leider Tisnado Mego');
  props.setProperty('SPREADSHEET_ID', newSs.getId());
  return newSs;
}

// ── Diagnóstico ─────────────────────────────────────────────
function diagnostico() {
  try {
    var ss = getSpreadsheet();
    Logger.log('✅ Spreadsheet: ' + ss.getName() + ' | ' + ss.getId());
    var notas     = ss.getSheetByName(SHEET_NAME_NOTES);
    var contactos = ss.getSheetByName(SHEET_NAME_CONTACTS);
    Logger.log('   Notas: '     + (notas     ? (notas.getLastRow()-1)     + ' filas' : '❌ NO'));
    Logger.log('   Contactos: ' + (contactos ? (contactos.getLastRow()-1) + ' filas' : '❌ NO'));
  } catch(err) { Logger.log('❌ ' + err.message); }
}

// ── GET ─────────────────────────────────────────────────────
function doGet(e) {
  var params = e.parameter || {}, action = params.action || 'getAll', callback = params.callback;
  var result;
  try {
    if (action === 'getAll')         result = getAllData();
    else if (action === 'saveAll')   result = saveAll(params);
    else if (action === 'sendNote')  result = sendNoteEmail(params);
    else                             result = { success: false, error: 'Acción desconocida: ' + action };
  } catch (err) { result = { success: false, error: err.message }; }
  var json = JSON.stringify(result);
  if (callback) return ContentService.createTextOutput(callback+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ── POST ────────────────────────────────────────────────────
function doPost(e) {
  var params;
  try   { params = JSON.parse(e.postData.contents); }
  catch (_) { params = e.parameter || {}; }
  var result;
  try {
    if ((params.action || 'saveAll') === 'saveAll') result = saveAll(params);
    else result = { success: false, error: 'Acción desconocida' };
  } catch (err) { result = { success: false, error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ── Lee todos los datos ─────────────────────────────────────
function getAllData() {
  var ss = getSpreadsheet();
  return { success: true, notes: readSheet(ss, SHEET_NAME_NOTES), contacts: readSheet(ss, SHEET_NAME_CONTACTS) };
}

function readSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var header = sheet.getRange(1,1,1,lastCol).getValues()[0];
  var data   = sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  return data.map(function(row) {
    var obj = {};
    header.forEach(function(key,i) {
      var val = row[i];
      obj[key] = (val instanceof Date) ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd') : val;
    });
    return obj;
  });
}

// ── Guarda todos los datos + dispara emails ─────────────────
function saveAll(params) {
  // LockService evita ejecuciones simultáneas que causarían duplicados en la hoja
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { success: false, error: 'Servidor ocupado, reintenta' }; }

  try {
    var ss = getSpreadsheet();
    var notesArr, contactsArr;
    try { notesArr    = JSON.parse(params.notes    || '[]'); } catch(_) { notesArr    = []; }
    try { contactsArr = JSON.parse(params.contacts || '[]'); } catch(_) { contactsArr = []; }
    if (!Array.isArray(notesArr))    notesArr    = [];
    if (!Array.isArray(contactsArr)) contactsArr = [];
    writeNotes(ss, notesArr);
    writeContacts(ss, contactsArr);

    // Envío automático: detecta notas de peso nuevas de hoy
    try { sendTodayReports(notesArr, contactsArr); } catch(e) { Logger.log('Email err: ' + e.message); }

    return { success: true, saved: { notes: notesArr.length, contacts: contactsArr.length } };
  } finally {
    lock.releaseLock();
  }
}

// ── Parsea el campo people (string JSON o array) ───────────
function parsePeople(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  var s = String(raw).trim();
  if (!s || s === '[]') return [];
  try { return JSON.parse(s); } catch(_) {}
  // Formato "[123,456]" sin comillas
  var nums = s.replace(/[\[\]\s]/g,'').split(',').filter(Boolean);
  return nums.map(function(x){ return isNaN(x) ? x : Number(x); });
}

// ── Envía resumen si hay nota de peso de hoy ────────────────
function sendTodayReports(notesArr, contactsArr) {
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();

  Logger.log('sendTodayReports: today=' + today + ', notes=' + notesArr.length + ', contacts=' + contactsArr.length);

  // Encuentra notas de peso de hoy
  var byContact = {};
  notesArr.forEach(function(n) {
    var mt   = String(n.metricType || '').trim();
    var date = String(n.date || '').trim().substring(0, 10);
    Logger.log('  nota: metricType=' + mt + ' date=' + date + ' people=' + JSON.stringify(n.people));
    if (mt !== 'peso') return;
    // Acepta hoy o ayer (por diferencias de zona horaria)
    var yesterday = Utilities.formatDate(new Date(new Date().getTime() - 86400000), tz, 'yyyy-MM-dd');
    if (date !== today && date !== yesterday) return;
    var people = parsePeople(n.people);
    people.forEach(function(pid) {
      var key = String(pid);
      if (!byContact[key]) byContact[key] = [];
      byContact[key].push(n);
    });
  });

  Logger.log('Contactos con nota hoy: ' + Object.keys(byContact).join(', '));

  Object.keys(byContact).forEach(function(pid) {
    var contact = null;
    contactsArr.forEach(function(c) { if (String(c.id) === pid) contact = c; });
    if (!contact) { Logger.log('Contacto no encontrado: ' + pid); return; }
    if (!contact.email) { Logger.log('Sin email: ' + contact.name); return; }

    // Evita duplicado — pero si mismo día no envió, fuerza reenvío
    var lastKey  = 'email_sent_' + pid;
    var lastSent = props.getProperty(lastKey);
    if (lastSent === today) { Logger.log('Ya enviado hoy a ' + contact.email); return; }

    try {
      var note = byContact[pid][0];
      // weightHistory puede llegar como array o como string JSON
      if (!Array.isArray(contact.weightHistory)) {
        try { contact.weightHistory = JSON.parse(contact.weightHistory || '[]'); } catch(_) { contact.weightHistory = []; }
      }
      var html = buildEmailHtml(contact, note, false);
      sendEmail({ to: contact.email, subject: '\ud83d\udcca Resumen de salud \u2014 ' + contact.name + ' \u00b7 ' + formatDateES(today), htmlBody: html });
      props.setProperty(lastKey, today);
      Logger.log('\ud83d\udce7 Email enviado a ' + contact.email);
    } catch(emailErr) {
      Logger.log('Error enviando a ' + contact.email + ': ' + emailErr.message);
    }
  });

  // \u2500\u2500 Cumplea\u00f1os / aniversarios recurrentes de hoy \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  var todayMD = today.substring(5); // MM-DD
  notesArr.forEach(function(n) {
    var isBday = n.isRecurring === true || n.isRecurring === 'true' || n.type === 'cumplea\u00f1os';
    if (!isBday) return;
    var date = String(n.date || '').trim().substring(0, 10);
    if (date.length < 10 || date.substring(5) !== todayMD) return;

    var people = parsePeople(n.people);
    people.forEach(function(pid) {
      var contact = null;
      contactsArr.forEach(function(c) { if (String(c.id) === String(pid)) contact = c; });
      if (!contact) { Logger.log('Cumplea\u00f1os: contacto no encontrado ' + pid); return; }
      if (!contact.email) { Logger.log('Cumplea\u00f1os: sin email ' + contact.name); return; }

      var bdayKey = 'bday_sent_' + pid + '_' + n.id + '_' + today;
      if (props.getProperty(bdayKey) === today) { Logger.log('Cumplea\u00f1os ya enviado hoy a ' + contact.email); return; }

      try {
        var html = buildBirthdayEmailHtml(contact, n);
        sendEmail({ to: contact.email, subject: '\ud83c\udf89\ud83c\udf82 \u00a1Feliz Cumplea\u00f1os! \u2014 ' + contact.name, htmlBody: html });
        props.setProperty(bdayKey, today);
        Logger.log('\ud83c\udf82 Email cumplea\u00f1os enviado a ' + contact.email);
      } catch(e) {
        Logger.log('Error enviando cumplea\u00f1os a ' + contact.email + ': ' + e.message);
      }
    });
  });
}

// ── Envía una nota específica por email al instante ─────────
function sendNoteEmail(params) {
  var note, contacts;
  try { note     = JSON.parse(params.note     || '{}'); } catch(_) { return { success: false, error: 'Parámetros inválidos: note' }; }
  try { contacts = JSON.parse(params.contacts || '[]'); } catch(_) { return { success: false, error: 'Parámetros inválidos: contacts' }; }
  if (!note || !note.id) return { success: false, error: 'Nota no válida' };

  var people = parsePeople(note.people);
  if (!people.length) return { success: false, error: 'La nota no tiene contactos asignados' };

  var isBday = note.isRecurring === true || note.isRecurring === 'true' || note.type === 'cumpleaños';

  var sent = [], noEmail = [], errors = [];
  people.forEach(function(pid) {
    var contact = null;
    contacts.forEach(function(c) { if (String(c.id) === String(pid)) contact = c; });
    if (!contact) return;
    if (!contact.email) { noEmail.push(contact.name); return; }
    try {
      if (isBday) {
        var html = buildBirthdayEmailHtml(contact, note);
        sendEmail({
          to: contact.email,
          subject: '🎉🎂 ¡Feliz Cumpleaños! — ' + contact.name,
          htmlBody: html
        });
      } else {
        var html = buildEmailHtml(contact, note, false);
        var metricLabels = {peso:'Peso',presion:'Presión',glucosa:'Glucosa',entrenamiento:'Entrenamiento',otro:'Nota'};
        var label = metricLabels[note.metricType||'otro'] || 'Nota';
        sendEmail({
          to: contact.email,
          subject: '📋 ' + label + ' — ' + contact.name + ' · ' + (note.date || ''),
          htmlBody: html
        });
      }
      sent.push(contact.name);
    } catch(err) {
      errors.push(contact.name + ': ' + err.message);
    }
  });

  if (errors.length) return { success: false, error: errors.join('; '), sent: sent };
  if (!sent.length && noEmail.length) return { success: false, error: 'Ningún contacto tiene email registrado: ' + noEmail.join(', ') };
  return { success: true, sent: sent, noEmail: noEmail };
}

// ── Diagnóstico de email (ejecutar manualmente para probar) ─
function diagnosticoEmail() {
  var ss       = getSpreadsheet();
  var contacts = readSheet(ss, SHEET_NAME_CONTACTS);
  var notes    = readSheet(ss, SHEET_NAME_NOTES);
  var tz       = Session.getScriptTimeZone();
  var today    = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  Logger.log('=== DIAGNÓSTICO EMAIL ===');
  Logger.log('Zona horaria: ' + tz);
  Logger.log('Hoy: ' + today);
  Logger.log('Contactos: ' + contacts.length);
  Logger.log('Notas: ' + notes.length);

  contacts.forEach(function(c) {
    Logger.log('\nContacto: ' + c.name + ' | email: ' + (c.email||'NO TIENE') + ' | id: ' + c.id);
  });

  Logger.log('\nNotas de tipo peso:');
  notes.forEach(function(n) {
    if (String(n.metricType||'').trim() === 'peso') {
      Logger.log('  "' + n.title + '" fecha=' + n.date + ' people=' + JSON.stringify(n.people));
    }
  });

  // Intenta enviar email de prueba al primer contacto con email
  var target = null;
  contacts.forEach(function(c){ if (!target && c.email) target = c; });
  if (target) {
    Logger.log('\nEnviando email de prueba a: ' + target.email);
    try {
      var hist = [];
      try { hist = JSON.parse(target.weightHistory || '[]'); } catch(_) {}
      target.weightHistory = hist;
      var html = buildEmailHtml(target, null, false);
      sendEmail({ to: target.email, subject: 'TEST \ud83d\udcca Diagnóstico email — Agenda Salud', htmlBody: html });
      Logger.log('\u2705 Email de prueba enviado!');
    } catch(e) { Logger.log('\u274c Error: ' + e.message); }
  } else {
    Logger.log('\u274c Ningún contacto tiene email registrado');
  }
}

// ── Resumen semanal (trigger automático) ────────────────────
function sendWeeklySummary() {
  var ss = getSpreadsheet();
  var contacts = readSheet(ss, SHEET_NAME_CONTACTS);
  var notes    = readSheet(ss, SHEET_NAME_NOTES);

  contacts.forEach(function(contact) {
    if (!contact.email || !contact.height) return;
    var hist = [];
    try { hist = JSON.parse(contact.weightHistory || '[]'); } catch(_) {}
    if (!hist.length) return;

    var html = buildEmailHtml(contact, null, true);
    sendEmail({
      to: contact.email,
      subject: '📅 Resumen semanal de salud — ' + contact.name,
      htmlBody: html
    });
    Logger.log('📧 Semanal enviado a ' + contact.email);
  });
}

// ── Configura el trigger semanal (ejecutar una sola vez) ────
function setupWeeklyTrigger() {
  // Elimina triggers existentes de esta función
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendWeeklySummary') ScriptApp.deleteTrigger(t);
  });
  // Crea trigger: cada lunes a las 8:00am
  ScriptApp.newTrigger('sendWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
  Logger.log('✅ Trigger semanal configurado: cada lunes 8am');
}

// ── Construye el HTML del email ─────────────────────────────
function buildEmailHtml(contact, latestNote, isWeekly) {
  // weightHistory puede llegar como array (desde la app) o string JSON (desde la hoja)
  var hist = [];
  if (Array.isArray(contact.weightHistory)) hist = contact.weightHistory;
  else { try { hist = JSON.parse(contact.weightHistory || '[]'); } catch(_) {} }

  // Peso a usar
  var weightKg = null;
  if (latestNote) {
    var nw = parseFloat(String(latestNote.title).replace(',','.'));
    if (!isNaN(nw) && nw >= 20 && nw <= 400) weightKg = nw;
  }
  if (!weightKg && hist.length) weightKg = hist[hist.length-1].weight;

  var heightM = parseFloat(contact.height) || 0;
  var bmi     = (weightKg && heightM) ? weightKg / (heightM * heightM) : null;
  var bmiInfo = bmi ? getBmiInfoGAS(bmi) : null;
  var age     = parseInt(contact.age) || 0;
  var sex     = contact.sex || '';

  // Métricas avanzadas
  var tmb = null, tdee = null, bodyFat = null, macros = null;
  if (weightKg && heightM && age && sex) {
    var h = heightM * 100;
    tmb = sex === 'm' ? (10*weightKg + 6.25*h - 5*age + 5) : (10*weightKg + 6.25*h - 5*age - 161);
    var actFactor = {sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9};
    tdee = Math.round(tmb * (actFactor[contact.activity] || 1.2));
    bodyFat = Math.max(3, Math.min(60, 1.20*bmi + 0.23*age - 10.8*(sex==='m'?1:0) - 5.4));
    var goalDir = (bmi > 25) ? 'perder' : (bmi < 18.5) ? 'ganar' : 'mantener';
    var targetCals = goalDir === 'perder' ? tdee - 500 : goalDir === 'ganar' ? tdee + 300 : tdee;
    var protein = Math.round(weightKg * (goalDir === 'perder' ? 2.0 : goalDir === 'ganar' ? 2.2 : 1.8));
    var fat  = Math.round(targetCals * 0.30 / 9);
    var carbs = Math.round(Math.max(0, targetCals - protein*4 - fat*9) / 4);
    macros = { targetCals: targetCals, protein: protein, fat: fat, carbs: carbs };
  }

  // Agua
  var waterL = weightKg ? (weightKg * 35 / 1000).toFixed(1) : null;
  var glasses = weightKg ? Math.round(weightKg * 35 / 250) : null;

  // Tendencia
  var trend = '', trendColor = '#666';
  if (hist.length >= 2) {
    var delta = hist[hist.length-1].weight - hist[hist.length-2].weight;
    var abs = Math.abs(delta).toFixed(1);
    if (delta > 0.05)       { trend = '▲ +' + abs + ' kg'; trendColor = '#e74c3c'; }
    else if (delta < -0.05) { trend = '▼ −' + abs + ' kg'; trendColor = '#27ae60'; }
    else                    { trend = '→ Sin cambio';       trendColor = '#7f8c8d'; }
  }

  // Historial (últimas 8 semanas)
  var histRows = hist.slice(-8).map(function(h) {
    return '<tr><td style="padding:6px 14px;border-bottom:1px solid #f0f0f0;color:#555;">' + h.date + '</td>' +
           '<td style="padding:6px 14px;border-bottom:1px solid #f0f0f0;font-weight:700;color:#1e3c72;">' + h.weight + ' kg</td></tr>';
  }).join('');

  // Ideal
  var idealMin = heightM ? Math.round(18.5 * heightM * heightM * 10) / 10 : null;
  var idealMax = heightM ? Math.round(25.0 * heightM * heightM * 10) / 10 : null;
  var goalKg   = (bmi && bmi > 25 && heightM) ? Math.round((weightKg - idealMax) * 10) / 10 : null;

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var statusColor = bmiInfo ? bmiInfo.color : '#1e3c72';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6fb;font-family:\'Segoe UI\',Arial,sans-serif;">' +
  '<div style="max-width:580px;margin:0 auto;padding:20px;">' +

  // Header
  '<div style="background:linear-gradient(135deg,#1e3c72,#2a5298);border-radius:16px 16px 0 0;padding:32px 28px;text-align:center;">' +
  '<div style="font-size:2.5em;margin-bottom:8px;">📊</div>' +
  '<h1 style="color:#fff;margin:0;font-size:1.5em;font-weight:800;">' + (isWeekly ? 'Resumen Semanal de Salud' : 'Nuevo Registro de Peso') + '</h1>' +
  '<p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:0.9em;">' + contact.name + ' · ' + today + '</p>' +
  '</div>' +

  // Peso principal
  (weightKg ? '<div style="background:#fff;padding:24px 28px;border-left:4px solid ' + statusColor + ';">' +
  '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">' +
  '<div><div style="font-size:0.75em;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Peso actual</div>' +
  '<div style="font-size:2.8em;font-weight:800;color:#1e3c72;">' + weightKg + '<span style="font-size:0.45em;color:#555;">kg</span></div>' +
  (trend ? '<div style="font-size:0.85em;color:' + trendColor + ';font-weight:600;margin-top:4px;">' + trend + ' vs. registro anterior</div>' : '') +
  '</div>' +
  (bmiInfo ? '<div style="text-align:center;background:' + statusColor + ';color:#fff;padding:12px 20px;border-radius:12px;">' +
  '<div style="font-size:1.6em;font-weight:800;">' + bmi.toFixed(1) + '</div>' +
  '<div style="font-size:0.72em;font-weight:700;letter-spacing:0.5px;">IMC</div>' +
  '<div style="font-size:0.82em;margin-top:4px;font-weight:600;">' + bmiInfo.level + '</div>' +
  '</div>' : '') +
  '</div></div>' : '') +

  // Métricas avanzadas (grid 2 cols)
  (tmb ? '<div style="background:#f8f9ff;padding:20px 28px;display:grid;gap:0;">' +
  '<div style="font-size:0.72em;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:12px;">📈 Métricas avanzadas</div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +

  '<div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #eee;">' +
  '<div style="font-size:0.72em;color:#888;margin-bottom:4px;">🔥 Metabolismo Basal</div>' +
  '<div style="font-weight:800;color:#1e3c72;font-size:1.1em;">' + Math.round(tmb) + ' kcal</div>' +
  '<div style="font-size:0.78em;color:#555;">TDEE: ' + tdee + ' kcal/día</div>' +
  '</div>' +

  '<div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #eee;">' +
  '<div style="font-size:0.72em;color:#888;margin-bottom:4px;">⚖️ % Grasa corporal</div>' +
  '<div style="font-weight:800;color:#1e3c72;font-size:1.1em;">' + bodyFat.toFixed(1) + '%</div>' +
  '<div style="font-size:0.78em;color:#555;">' + getBodyFatLabelGAS(bodyFat, sex) + '</div>' +
  '</div>' +

  '</div></div>' : '') +

  // Macros
  (macros ? '<div style="background:#fff;padding:20px 28px;">' +
  '<div style="font-size:0.72em;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:12px;">🍽️ Macros diarios recomendados · ' + macros.targetCals + ' kcal/día</div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
  '<div style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.2em;">🥩</div><div style="font-weight:800;font-size:1.1em;color:#1d4ed8;">' + macros.protein + 'g</div><div style="font-size:0.72em;color:#555;">Proteína</div></div>' +
  '<div style="background:#fffbeb;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.2em;">🍞</div><div style="font-weight:800;font-size:1.1em;color:#d97706;">' + macros.carbs + 'g</div><div style="font-size:0.72em;color:#555;">Carbohidratos</div></div>' +
  '<div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.2em;">🥑</div><div style="font-weight:800;font-size:1.1em;color:#15803d;">' + macros.fat + 'g</div><div style="font-size:0.72em;color:#555;">Grasas</div></div>' +
  '</div></div>' : '') +

  // Agua + meta
  '<div style="background:' + (macros ? '#f8f9ff' : '#fff') + ';padding:20px 28px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
  (waterL ? '<div style="background:#eff9ff;border-radius:10px;padding:14px;border:1px solid #bae6fd;">' +
  '<div style="font-size:0.72em;color:#0369a1;font-weight:700;margin-bottom:4px;">💧 Hidratación diaria</div>' +
  '<div style="font-weight:800;font-size:1.2em;color:#0c4a6e;">' + waterL + ' L/día</div>' +
  '<div style="font-size:0.78em;color:#075985;">' + glasses + ' vasos de 250 ml</div>' +
  '</div>' : '<div></div>') +
  (goalKg && goalKg > 0 ? '<div style="background:#fef9ec;border-radius:10px;padding:14px;border:1px solid #fde68a;">' +
  '<div style="font-size:0.72em;color:#92400e;font-weight:700;margin-bottom:4px;">🎯 Meta peso saludable</div>' +
  '<div style="font-weight:800;font-size:1.2em;color:#78350f;">Bajar ' + goalKg + ' kg</div>' +
  '<div style="font-size:0.78em;color:#92400e;">Rango ideal: ' + idealMin + '–' + idealMax + ' kg</div>' +
  '</div>' : '<div style="background:#f0fdf4;border-radius:10px;padding:14px;border:1px solid #bbf7d0;">' +
  '<div style="font-size:0.72em;color:#166534;font-weight:700;margin-bottom:4px;">✅ Estado peso</div>' +
  '<div style="font-weight:800;font-size:1.1em;color:#14532d;">Peso saludable OMS</div>' +
  '</div>') +
  '</div>' +

  // Historial
  (histRows ? '<div style="background:#fff;padding:20px 28px;">' +
  '<div style="font-size:0.72em;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:12px;">📅 Historial reciente</div>' +
  '<table style="width:100%;border-collapse:collapse;">' +
  '<thead><tr><th style="padding:8px 14px;background:#f0f4ff;color:#1e3c72;font-size:0.8em;text-align:left;border-radius:4px 0 0 4px;">Fecha</th>' +
  '<th style="padding:8px 14px;background:#f0f4ff;color:#1e3c72;font-size:0.8em;text-align:left;border-radius:0 4px 4px 0;">Peso</th></tr></thead>' +
  '<tbody>' + histRows + '</tbody></table></div>' : '') +

  // Recomendaciones OMS
  (bmiInfo ? '<div style="background:#f8f9ff;padding:20px 28px;">' +
  '<div style="font-size:0.72em;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:10px;">🏥 Recomendaciones OMS</div>' +
  bmiInfo.tips.slice(0,3).map(function(t){ return '<div style="padding:8px 12px;background:#fff;border-left:3px solid '+statusColor+';border-radius:0 8px 8px 0;margin-bottom:8px;font-size:0.85em;color:#333;line-height:1.5;">'+t+'</div>'; }).join('') +
  '</div>' : '') +

  // Footer
  '<div style="background:#1e3c72;border-radius:0 0 16px 16px;padding:20px 28px;text-align:center;">' +
  '<p style="color:rgba(255,255,255,0.6);font-size:0.78em;margin:0;">Generado automáticamente por tu Agenda de Salud Personal</p>' +
  '<p style="color:rgba(255,255,255,0.4);font-size:0.72em;margin:6px 0 0;">Para dejar de recibir estos correos, elimina el email del contacto</p>' +
  '</div>' +

  '</div></body></html>';
}

// ── Construye el HTML del email de cumpleaños/aniversario ──
function buildBirthdayEmailHtml(contact, note) {
  var nombre  = contact.name || '';
  var titulo  = note.title || '¡Feliz Cumpleaños!';
  var mensaje = (note.desc || '').toString().trim();

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:linear-gradient(135deg,#fdf0ff,#fff4e6);font-family:\'Segoe UI\',Arial,sans-serif;">' +
  '<div style="max-width:580px;margin:0 auto;padding:24px;">' +

  // Header festivo
  '<div style="background:linear-gradient(135deg,#ff6b9d,#ffa36b,#ffd166);border-radius:24px 24px 0 0;padding:40px 28px;text-align:center;position:relative;">' +
  '<div style="font-size:4em;line-height:1;margin-bottom:8px;">🎉🎂🎈</div>' +
  '<h1 style="color:#fff;margin:0;font-size:1.8em;font-weight:900;text-shadow:0 2px 6px rgba(0,0,0,0.15);">¡Feliz Cumpleaños!</h1>' +
  '<p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:1.3em;font-weight:700;">🥳 ' + nombre + ' 🥳</p>' +
  '</div>' +

  // Título de la nota
  '<div style="background:#fff;padding:24px 28px;text-align:center;border-left:4px solid #ff6b9d;border-right:4px solid #ffd166;">' +
  '<div style="font-size:0.75em;color:#aa6;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:8px;">🎁 ' + titulo + ' 🎁</div>' +

  // Mensaje personalizado (Observaciones)
  (mensaje ?
    '<div style="background:linear-gradient(135deg,#fff0f6,#fff8ec);border-radius:16px;padding:22px;margin-top:14px;border:2px dashed #ffb3c6;">' +
    '<div style="font-size:2.2em;margin-bottom:10px;">💌</div>' +
    '<p style="color:#553344;font-size:1.05em;line-height:1.7;margin:0;white-space:pre-wrap;font-weight:600;">' + mensaje + '</p>' +
    '</div>'
  : '') +
  '</div>' +

  // Sección de íconos festivos 3D
  '<div style="background:#fff;padding:18px 28px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center;">' +
  '<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:14px;padding:14px 6px;font-size:2em;">🎂</div>' +
  '<div style="background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-radius:14px;padding:14px 6px;font-size:2em;">🎈</div>' +
  '<div style="background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-radius:14px;padding:14px 6px;font-size:2em;">🎁</div>' +
  '<div style="background:linear-gradient(135deg,#dcfce7,#bbf7d0);border-radius:14px;padding:14px 6px;font-size:2em;">🎊</div>' +
  '</div>' +

  // Mensaje final
  '<div style="background:linear-gradient(135deg,#ff6b9d,#ffa36b);padding:24px 28px;text-align:center;">' +
  '<p style="color:#fff;font-size:1.1em;font-weight:800;margin:0;">🌟 ¡Que tengas un día increíble! 🌟</p>' +
  '<p style="color:rgba(255,255,255,0.9);font-size:0.9em;margin:8px 0 0;">Con cariño, tu Agenda Personal 💖</p>' +
  '</div>' +

  // Footer
  '<div style="background:#1e3c72;border-radius:0 0 16px 16px;padding:18px 28px;text-align:center;">' +
  '<p style="color:rgba(255,255,255,0.6);font-size:0.78em;margin:0;">Generado automáticamente por tu Agenda de Salud Personal 🎉</p>' +
  '</div>' +

  '</div></body></html>';
}

// ── Helpers de métricas para GAS ────────────────────────────
function getBmiInfoGAS(bmi) {
  if (bmi < 16)   return { level:'Delgadez Severa',   color:'#8B0000', tips:['Busca atención médica urgente.','Evaluación nutricional clínica inmediata.','Rehabilitación nutricional bajo supervisión.'] };
  if (bmi < 17)   return { level:'Delgadez Moderada', color:'#c0392b', tips:['Consulta médico y nutricionista.','Aumenta ingesta calórica con alimentos densos.','Incluye proteína de calidad en cada comida.'] };
  if (bmi < 18.5) return { level:'Delgadez Leve',     color:'#d35400', tips:['Aumenta 300-500 kcal/día adicionales.','Prioriza proteínas y carbohidratos complejos.','Entrena fuerza 3 días/semana.'] };
  if (bmi < 25)   return { level:'Peso Normal',        color:'#1a7a3d', tips:['Mantén dieta equilibrada y variada.','Al menos 150 min/semana de actividad aeróbica.','Controla el peso mensualmente.'] };
  if (bmi < 30)   return { level:'Sobrepeso',          color:'#b7770d', tips:['Déficit calórico moderado 300-500 kcal/día.','Prioriza proteínas y fibra para saciedad.','Apunta a 8.000-10.000 pasos diarios.'] };
  if (bmi < 35)   return { level:'Obesidad Clase I',   color:'#c0392b', tips:['Consulta médico y nutricionista.','Plan de ejercicio progresivo supervisado.','Reducir azúcares y ultraprocesados.'] };
  if (bmi < 40)   return { level:'Obesidad Clase II',  color:'#8e1010', tips:['Seguimiento médico regular obligatorio.','Considera programa multidisciplinario.','Evaluación de comorbilidades.'] };
  return             { level:'Obesidad Clase III',  color:'#4a148c', tips:['Atención médica especializada urgente.','Evaluación para tratamiento intensivo.','Apoyo psicológico y nutricional.'] };
}

function getBodyFatLabelGAS(pct, sex) {
  if (sex === 'm') {
    if (pct < 6)  return 'Grasa esencial';
    if (pct < 14) return 'Atlético';
    if (pct < 18) return 'En forma';
    if (pct < 25) return 'Normal';
    if (pct < 32) return 'Sobrepeso';
    return 'Obeso';
  } else {
    if (pct < 14) return 'Grasa esencial';
    if (pct < 21) return 'Atlética';
    if (pct < 25) return 'En forma';
    if (pct < 32) return 'Normal';
    if (pct < 39) return 'Sobrepeso';
    return 'Obesa';
  }
}

function formatDateES(isoDate) {
  var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  var parts = isoDate.split('-');
  return parseInt(parts[2]) + ' de ' + months[parseInt(parts[1])-1] + ' ' + parts[0];
}

// ── Escribe notas ───────────────────────────────────────────
function writeNotes(ss, notes) {
  var sheet = getOrCreateSheet(ss, SHEET_NAME_NOTES);
  var headers = ['id','title','desc','date','priority','type','metricType','completed','isRecurring','people'];
  sheet.clearContents();
  sheet.appendRow(headers);
  notes.forEach(function(n) {
    sheet.appendRow([n.id||'',n.title||'',n.desc||'',n.date||'',n.priority||'',n.type||'',n.metricType||'peso',
      n.completed?'true':'false', n.isRecurring?'true':'false', JSON.stringify(n.people||[])]);
  });
  styleHeader(sheet, headers.length);
}

// ── Escribe contactos ───────────────────────────────────────
function writeContacts(ss, contacts) {
  var sheet = getOrCreateSheet(ss, SHEET_NAME_CONTACTS);
  var headers = ['id','name','phone','email','category','height','weightHistory','avatar','age','sex','activity','waist'];
  sheet.clearContents();
  sheet.appendRow(headers);
  contacts.forEach(function(c) {
    sheet.appendRow([c.id||'',c.name||'',c.phone||'',c.email||'',c.category||'',
      c.height!=null?c.height:'', JSON.stringify(c.weightHistory||[]),
      c.avatar||'', c.age||'', c.sex||'', c.activity||'', c.waist!=null?c.waist:'']);
  });
  styleHeader(sheet, headers.length);
}

function getOrCreateSheet(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function styleHeader(sheet, numCols) {
  var range = sheet.getRange(1,1,1,numCols);
  range.setBackground('#1e3c72');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}
