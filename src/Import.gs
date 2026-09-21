/**
 * Import.gs — bulk import of flight rows from CSV text (data/flights.csv produced by
 * tools/export_numbers.py) and carry-forward totals (data/carry_forward.json).
 *
 * CSV header must contain the Flights column keys (any order); unknown columns are ignored.
 * Durations may be integer minutes or "H:MM". Rows are appended; duplicates are detected on
 * (date, dep_time, flight_no, registration) and skipped unless `replace` is true.
 */

/** @param {string} csvText  @param {{replace?:boolean, source?:string}} opts */
function apiImportCsv(csvText, opts) {
  opts = opts || {};
  var rows = Utilities.parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV にデータ行がありません');
  var header = rows[0].map(function (h) { return String(h).trim().replace(/^﻿/, ''); });
  var known = {};
  FLIGHT_COLUMNS.forEach(function (c) { known[c.key] = true; });
  var idx = {};
  header.forEach(function (h, i) { if (known[h]) idx[h] = i; });
  if (idx.date === undefined || idx.registration === undefined) throw new Error('CSV ヘッダーに date / registration が必要です');

  var existing = readAllFlights_();
  var seen = {};
  existing.forEach(function (f) { seen[dupKey_(f)] = f; });

  var toAppend = [], updated = 0, skipped = 0, errors = [];
  var now = nowIso_();
  for (var r = 1; r < rows.length; r++) {
    var raw = rows[r];
    if (raw.join('').trim() === '') continue;
    var obj = {};
    Object.keys(idx).forEach(function (k) { obj[k] = raw[idx[k]]; });
    try {
      var f = normalizeFlight_(obj);
      var key = dupKey_(f);
      f.source = obj.source || opts.source || 'csv';
      if (seen[key]) {
        if (opts.replace) {
          var ex = seen[key];
          f.id = ex.id; f.created_at = ex.created_at; f.updated_at = now;
          writeFlightRows_(ss_().getSheetByName(SHEET_FLIGHTS), ex._row, [flightToRow_(f)]);
          updated++;
        } else skipped++;
        continue;
      }
      f.id = Utilities.getUuid(); f.created_at = now; f.updated_at = now;
      seen[key] = f;
      toAppend.push(flightToRow_(f));
    } catch (e) {
      errors.push('行 ' + (r + 1) + ': ' + e.message);
    }
  }
  if (toAppend.length) {
    var sh = ss_().getSheetByName(SHEET_FLIGHTS);
    writeFlightRows_(sh, sh.getLastRow() + 1, toAppend);
    upsertMasters_(toAppend.map(rowToFlight_));
  }
  var refreshed = (toAppend.length || updated) ? refreshYearSheets_(null) : [];
  return { inserted: toAppend.length, updated: updated, skipped: skipped, errors: errors, refreshed: refreshed };
}

/**
 * Menu / editor: repair the Flights sheet after Sheets auto-converted text cells (e.g. a remark
 * "1:30" stored as a time). Re-applies text format to the text columns and rewrites every row
 * through the normal path, then rebuilds all year sheets. Returns the number of rows rewritten.
 */
function repairFlightsSheetFormats() {
  var sh = ss_().getSheetByName(SHEET_FLIGHTS);
  if (!sh) throw new Error('Flights シートがありません');
  var flights = readAllFlights_(); // rowToFlight_ already converts Date / day-fraction back to text
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Whole-column text format so future manual edits are safe too.
    sh.getRange(2, colIndex_('date') + 1, sh.getMaxRows() - 1, colIndex_('flight_no') - colIndex_('date') + 1).setNumberFormat('@');
    sh.getRange(2, colIndex_('remarks') + 1, sh.getMaxRows() - 1, FLIGHT_COLUMNS.length - colIndex_('remarks')).setNumberFormat('@');
    flights.forEach(function (f) { writeFlightRows_(sh, f._row, [flightToRow_(f)]); });
    refreshYearSheets_(null, sortFlights_(flights), true);
  } finally { lock.releaseLock(); }
  Logger.log('Flights シートを修復しました: ' + flights.length + ' 行');
  return flights.length;
}

function dupKey_(f) {
  return [f.date, f.dep_time, f.flight_no, f.registration].join('|');
}

/** Import carry-forward totals from JSON text: { "block": 516817, "takeoffs": 1579, ... } */
function apiImportCarryForward(jsonText) {
  var obj;
  try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('JSON を解釈できません: ' + e.message); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSON はオブジェクト { "block": 分, ... } である必要があります');
  var unknown = Object.keys(obj).filter(function (k) { return TOTAL_KEYS.indexOf(k) < 0; });
  if (unknown.length) throw new Error('不明なキー: ' + unknown.join(', '));
  return apiSaveSettings({ carry_forward: obj });
}

function carrySummary_(settings) {
  var c = settings.carry_forward;
  return '飛行時間 ' + fmtMinutes_(c.block) + ' / 機長 ' + fmtMinutes_(c.pic) + ' / 副操縦士 ' + fmtMinutes_(c.sic) +
    ' / 離陸 ' + c.takeoffs + ' / 着陸 ' + c.landings;
}

/**
 * No-argument version runnable from the Apps Script editor ("実行" button):
 * upload data/carry_forward.json to Google Drive (any folder), then run this.
 * The first file named carry_forward.json is used; the result is written to the log.
 */
function importCarryForwardFromDrive() {
  var files = DriveApp.getFilesByName('carry_forward.json');
  if (!files.hasNext()) throw new Error('Google ドライブに carry_forward.json がありません。data/carry_forward.json をアップロードしてください');
  var file = files.next();
  var settings = apiImportCarryForward(file.getBlob().getDataAsString('UTF-8'));
  Logger.log('繰越合計を取込みました (' + file.getName() + '): ' + carrySummary_(settings));
  return settings.carry_forward;
}

/** Spreadsheet menu action: paste the JSON into a dialog. */
function importCarryForwardPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('繰越合計の取込', 'data/carry_forward.json の内容をそのまま貼り付けてください', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var settings = apiImportCarryForward(res.getResponseText());
  ui.alert('繰越合計を取込みました', carrySummary_(settings), ui.ButtonSet.OK);
}
