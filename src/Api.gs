/**
 * Api.gs — functions called from the web UI via google.script.run.
 * Every public function returns plain JSON-serialisable data and throws Error on failure.
 */

/* ---------- Flights ---------- */

function readAllFlights_() {
  var sh = ss_().getSheetByName(SHEET_FLIGHTS);
  if (!sh) throw new Error('Flights シートがありません。setupSpreadsheet を実行してください。');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, FLIGHT_COLUMNS.length).getValues();
  var out = [];
  rows.forEach(function (r, i) {
    if (!r[colIndex_('id')]) return;
    var f = rowToFlight_(r);
    f._row = i + 2; // sheet row number, server-side only
    out.push(f);
  });
  return out;
}

/**
 * Write flight rows into the Flights sheet, forcing text format on the text/date/time columns
 * FIRST so Sheets never auto-converts "5.30", "23:40" or a remark like "1:30" into numbers/times.
 * Text columns are the contiguous groups B..I (date..flight_no) and AC..AF (remarks..updated_at).
 */
function writeFlightRows_(sh, startRow, rows) {
  var n = rows.length;
  if (!n) return;
  sh.getRange(startRow, colIndex_('date') + 1, n, colIndex_('flight_no') - colIndex_('date') + 1).setNumberFormat('@');
  sh.getRange(startRow, colIndex_('remarks') + 1, n, FLIGHT_COLUMNS.length - colIndex_('remarks')).setNumberFormat('@');
  sh.getRange(startRow, 1, n, FLIGHT_COLUMNS.length).setValues(rows);
}

function sortFlights_(list) {
  return list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.dep_time !== b.dep_time) return a.dep_time < b.dep_time ? -1 : 1;
    return 0;
  });
}

function stripInternal_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = f[k]; });
  return o;
}

/** Initial payload for the UI: settings, masters, months present, cumulative totals. */
function apiBootstrap() {
  var flights = sortFlights_(readAllFlights_());
  var months = {};
  flights.forEach(function (f) { months[f.date.substring(0, 7)] = true; });
  var today = parseDateStr_(new Date());
  return {
    settings: getSettings_(),
    aircraft: getAircraftMaster_(),
    airports: getAirportMaster_(),
    months: Object.keys(months).sort().reverse(),
    today: today,
    cumulative: computeCumulative_(flights, null),
    recent: flights.slice(-15).reverse().map(stripInternal_),
    columns: FLIGHT_COLUMNS.map(function (c) { return { key: c.key, kind: c.kind, label: c.label }; }),
    totalKeys: TOTAL_KEYS
  };
}

/** Flights of one month ("YYYY-MM") plus the JCAB totals block for that month. */
function apiGetMonth(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('月の指定が不正です: ' + ym);
  var all = sortFlights_(readAllFlights_());
  var list = all.filter(function (f) { return f.date.substring(0, 7) === ym; });
  return {
    ym: ym,
    flights: list.map(stripInternal_),
    totals: computeMonthTotals_(all, ym)
  };
}

/**
 * Insert one flight. Returns { flight, refreshed } where `refreshed` lists the year sheets
 * (飛行日誌_YYYY) rebuilt as a consequence — the flight's year and all later years.
 */
function apiAddFlight(input) {
  var f = normalizeFlight_(input);
  f.id = Utilities.getUuid();
  f.source = 'ui';
  f.created_at = nowIso_();
  f.updated_at = f.created_at;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var refreshed;
  try {
    var sh = ss_().getSheetByName(SHEET_FLIGHTS);
    writeFlightRows_(sh, sh.getLastRow() + 1, [flightToRow_(f)]);
    upsertMasters_([f]);
    refreshed = refreshYearSheets_(f.date.substring(0, 4));
  } finally { lock.releaseLock(); }
  return { flight: f, refreshed: refreshed };
}

/** Update an existing flight by id. Returns { flight, refreshed }. */
function apiUpdateFlight(input) {
  if (!input || !input.id) throw new Error('id がありません');
  var existing = readAllFlights_().filter(function (x) { return x.id === input.id; })[0];
  if (!existing) throw new Error('該当レコードが見つかりません: ' + input.id);
  var f = normalizeFlight_(input);
  f.id = existing.id;
  f.source = existing.source || 'ui';
  f.created_at = existing.created_at;
  f.updated_at = nowIso_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var refreshed;
  try {
    writeFlightRows_(ss_().getSheetByName(SHEET_FLIGHTS), existing._row, [flightToRow_(f)]);
    upsertMasters_([f]);
    var fromYear = existing.date < f.date ? existing.date.substring(0, 4) : f.date.substring(0, 4);
    refreshed = refreshYearSheets_(fromYear);
  } finally { lock.releaseLock(); }
  return { flight: f, refreshed: refreshed };
}

/** Delete a flight by id. Returns { deleted, refreshed }. */
function apiDeleteFlight(id) {
  var existing = readAllFlights_().filter(function (x) { return x.id === id; })[0];
  if (!existing) throw new Error('該当レコードが見つかりません: ' + id);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var refreshed;
  try {
    ss_().getSheetByName(SHEET_FLIGHTS).deleteRow(existing._row);
    refreshed = refreshYearSheets_(existing.date.substring(0, 4));
  } finally { lock.releaseLock(); }
  return { deleted: id, refreshed: refreshed };
}

/* ---------- Settings ---------- */

var settingsCache_ = null; // per-execution cache (Apps Script starts a fresh VM per request)

function getSettings_() {
  if (settingsCache_) return settingsCache_;
  settingsCache_ = readSettings_();
  return settingsCache_;
}

function readSettings_() {
  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  var out = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(function (k) { out[k] = SETTINGS_DEFAULTS[k]; });
  out.carry_forward = {};
  TOTAL_KEYS.forEach(function (k) { out.carry_forward[k] = 0; });
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (!k) return;
    if (k.indexOf('carry_forward_') === 0) out.carry_forward[k.substring(14)] = Number(r[1]) || 0;
    else out[k] = r[1];
  });
  return out;
}

/** Save settings from UI: { pilot_name, licence_no, ..., carry_forward: {key: minutes|count} } */
function apiSaveSettings(obj) {
  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  if (!sh) throw new Error('Settings シートがありません');
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  var index = {};
  rows.forEach(function (r, i) { index[String(r[0]).trim()] = i + 2; });
  function put(key, value, desc) {
    if (index[key]) sh.getRange(index[key], 2).setValue(value);
    else { sh.appendRow([key, value, desc || '']); index[key] = sh.getLastRow(); }
  }
  Object.keys(SETTINGS_DEFAULTS).forEach(function (k) {
    if (obj[k] !== undefined) put(k, obj[k]);
  });
  var touchedTotals = false;
  if (obj.carry_forward) {
    TOTAL_KEYS.forEach(function (k) {
      if (obj.carry_forward[k] === undefined) return;
      var v = (k === 'takeoffs' || k === 'landings') ? Number(obj.carry_forward[k]) || 0 : parseMinutes_(obj.carry_forward[k]);
      put('carry_forward_' + k, v, 'システム導入前の累計 ' + labelOf_(k));
      touchedTotals = true;
    });
  }
  settingsCache_ = null;
  // Carry-forward, pilot name and licence number all appear on the year sheets → rebuild them all
  // (which also refreshes the checklist); any other change refreshes the checklist only.
  if (touchedTotals || obj.pilot_name !== undefined || obj.licence_no !== undefined || obj.time_basis !== undefined) {
    refreshYearSheets_(null);
  } else {
    rebuildQualSheet_(null, false);
  }
  return getSettings_();
}

/* ---------- Masters ---------- */

function getAircraftMaster_() {
  var sh = ss_().getSheetByName(SHEET_AIRCRAFT);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return r[1]; })
    .map(function (r) { return { aircraft_type: String(r[0]), registration: String(r[1]), note: String(r[2] || '') }; });
}

function getAirportMaster_() {
  var sh = ss_().getSheetByName(SHEET_AIRPORTS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { icao: String(r[0]), iata: String(r[1] || ''), name: String(r[2] || ''), note: String(r[3] || '') }; });
}

/** Add unknown registrations / airports found in the given flights to the master sheets. */
function upsertMasters_(flights) {
  var ss = ss_();
  var ac = ss.getSheetByName(SHEET_AIRCRAFT), ap = ss.getSheetByName(SHEET_AIRPORTS);
  if (!ac || !ap) return;
  var regs = {}, apts = {};
  getAircraftMaster_().forEach(function (a) { regs[a.registration] = true; });
  getAirportMaster_().forEach(function (a) { apts[a.icao] = true; });
  var newRegs = [], newApts = [];
  flights.forEach(function (f) {
    if (f.registration && !regs[f.registration]) { regs[f.registration] = true; newRegs.push([f.aircraft_type, f.registration, '']); }
    [f.dep, f.arr].forEach(function (code) {
      if (code && !apts[code]) { apts[code] = true; newApts.push([code, '', '', '']); }
    });
  });
  if (newRegs.length) ac.getRange(ac.getLastRow() + 1, 1, newRegs.length, 3).setValues(newRegs);
  if (newApts.length) ap.getRange(ap.getLastRow() + 1, 1, newApts.length, 4).setValues(newApts);
}

/** Menu action: rebuild master sheets from everything in Flights. */
function rebuildMastersFromFlights() {
  upsertMasters_(readAllFlights_());
  return 'OK';
}
