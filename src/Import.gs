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
          ss_().getSheetByName(SHEET_FLIGHTS).getRange(ex._row, 1, 1, FLIGHT_COLUMNS.length).setValues([flightToRow_(f)]);
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
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, FLIGHT_COLUMNS.length).setValues(toAppend);
    upsertMasters_(toAppend.map(rowToFlight_));
  }
  return { inserted: toAppend.length, updated: updated, skipped: skipped, errors: errors };
}

function dupKey_(f) {
  return [f.date, f.dep_time, f.flight_no, f.registration].join('|');
}

/** Import carry-forward totals from JSON text: { "block": 516817, "takeoffs": 1579, ... } */
function apiImportCarryForward(jsonText) {
  var obj = JSON.parse(jsonText);
  return apiSaveSettings({ carry_forward: obj });
}
