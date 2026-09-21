/**
 * Report.gs — generate a printable JCAB 飛行日誌 page for one month
 * as a dedicated sheet ("飛行日誌_YYYY-MM"), laid out like the legacy Numbers tables:
 *
 *   row 1-2 : two-row header (REPORT_HEADER_TOP / REPORT_HEADER_BOTTOM)
 *   row 3.. : one row per flight leg
 *   then    : 項小計 / 前項までの合計 / 合計
 *
 * Durations are written as fractions of a day with number format [h]:mm so they
 * display as H:MM and can still be summed in Sheets.
 */

var REPORT_MIN_ROWS = 15; // pad with blank rows like the paper form

function generateCurrentMonthReport() {
  var d = new Date();
  return apiGenerateReport(d.getFullYear() + '-' + pad2_(d.getMonth() + 1));
}

/** Build/replace the report sheet for "YYYY-MM". Returns { sheetName, url }. */
function apiGenerateReport(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('月の指定が不正です: ' + ym);
  var all = sortFlights_(readAllFlights_());
  var flights = all.filter(function (f) { return f.date.substring(0, 7) === ym; });
  var totals = computeMonthTotals_(all, ym);
  var settings = getSettings_();

  var ss = ss_();
  var name = REPORT_PREFIX + ym;
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  var ncol = REPORT_HEADER_TOP.length;

  // ----- header -----
  sh.getRange(1, 1, 1, ncol).setValues([REPORT_HEADER_TOP]);
  sh.getRange(2, 1, 1, ncol).setValues([REPORT_HEADER_BOTTOM]);
  var merges = [[1, 1, 2, 1], [1, 2, 2, 1], [1, 3, 2, 1], [1, 4, 2, 1], [1, 5, 2, 1], [1, 6, 2, 1],
    [1, 7, 2, 1], [1, 8, 2, 1], [1, 9, 1, 2], [1, 11, 2, 1], [1, 12, 1, 5], [1, 17, 1, 4], [1, 21, 1, 2],
    [1, 23, 2, 1], [1, 24, 2, 1], [1, 25, 2, 1], [1, 26, 2, 1], [1, 27, 2, 1], [1, 28, 2, 2]];
  merges.forEach(function (m) { sh.getRange(m[0], m[1], m[2], m[3]).merge(); });
  sh.getRange(1, 1, 2, ncol).setFontWeight('bold').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrap(true).setBackground('#f1f3f4');

  // ----- flight rows -----
  var body = [];
  flights.forEach(function (f) {
    var row = REPORT_KEYS.map(function (k) { return reportCell_(f, k); });
    row.push('');
    body.push(row);
  });
  while (body.length < REPORT_MIN_ROWS) body.push(new Array(ncol).fill(''));
  var firstBody = 3, lastBody = firstBody + body.length - 1;
  sh.getRange(firstBody, 1, body.length, ncol).setValues(body);

  // ----- total rows -----
  var label = { subtotal: '項 小 計', carried: '前項までの合計', total: '合  計' };
  var totalRows = ['subtotal', 'carried', 'total'].map(function (k) {
    var row = new Array(ncol).fill('');
    row[7] = label[k];
    TOTAL_KEYS.forEach(function (key, i) {
      var v = totals[k][key];
      row[8 + i] = (key === 'takeoffs' || key === 'landings') ? v : v / 1440;
    });
    return row;
  });
  var tr = lastBody + 1;
  sh.getRange(tr, 1, 3, ncol).setValues(totalRows).setFontWeight('bold').setBackground('#fef7e0');

  // ----- formats -----
  var durCols = { first: 11, count: 17 }; // K..AA (block .. other)
  sh.getRange(firstBody, durCols.first, tr + 2 - firstBody + 1, durCols.count).setNumberFormat('[h]:mm');
  sh.getRange(firstBody, 9, tr + 2 - firstBody + 1, 2).setNumberFormat('0');
  sh.getRange(firstBody, 1, body.length, 1).setNumberFormat('@');
  sh.getRange(firstBody, 6, body.length, 2).setNumberFormat('@');
  sh.getRange(1, 1, tr + 2, ncol).setBorder(true, true, true, true, true, true);
  sh.getRange(firstBody, 1, tr + 2 - firstBody + 1, ncol).setHorizontalAlignment('center');
  sh.setFrozenRows(2);
  sh.setColumnWidths(1, ncol, 62);
  sh.setColumnWidth(8, 80);
  sh.setColumnWidth(28, 110);

  // ----- footer note -----
  var note = ym.replace('-', '年') + '月　' + (settings.pilot_name ? settings.pilot_name + '　' : '') +
    (settings.licence_no ? '技能証明番号 ' + settings.licence_no + '　' : '') +
    '時刻基準: ' + settings.time_basis + '　生成: ' + parseDateStr_(new Date());
  sh.getRange(tr + 4, 1).setValue(note);

  return { sheetName: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), count: flights.length };
}

function reportCell_(f, key) {
  var col = FLIGHT_COLUMNS[colIndex_(key)];
  if (key === 'date') { var p = f.date.split('-'); return parseInt(p[1], 10) + '.' + parseInt(p[2], 10); }
  if (col.kind === 'min') return f[key] ? f[key] / 1440 : '';
  if (col.kind === 'int') return f[key];
  return f[key] || '';
}

/** List existing report sheets (for the UI). */
function apiListReports() {
  return ss_().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return n.indexOf(REPORT_PREFIX) === 0; })
    .sort().reverse();
}
