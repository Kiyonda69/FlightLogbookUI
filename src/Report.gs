/**
 * Report.gs — printable JCAB 飛行日誌 sheets, laid out like the legacy Numbers tables.
 *
 * One "month block" =
 *   title row  : "YYYY年M月"
 *   row +1/+2  : two-row header (REPORT_HEADER_TOP / REPORT_HEADER_BOTTOM)
 *   rows       : one per flight leg (padded to REPORT_MIN_ROWS like the paper form)
 *   3 rows     : 項小計 / 前項までの合計 / 合計
 *
 *   apiGenerateReport('YYYY-MM')  → sheet 飛行日誌_YYYY-MM with one block
 *   apiGenerateYearReport('YYYY') → sheet 飛行日誌_YYYY with 12 blocks (1月..12月), like a Numbers year sheet
 *
 * Text-like values (月日 "5.30", clocks "23:40") are written into cells whose number format is set
 * to text ('@') BEFORE the values are written; otherwise Sheets converts "5.30" into the number 5.3.
 * Durations are written as fractions of a day with number format [h]:mm.
 */

var REPORT_MIN_ROWS = 15;      // blank rows to pad each month block to
var REPORT_BLOCK_GAP = 2;      // empty rows between month blocks in a year sheet
var REPORT_NCOL = 29;          // A..AC

function generateCurrentMonthReport() {
  var d = new Date();
  return apiGenerateReport(d.getFullYear() + '-' + pad2_(d.getMonth() + 1));
}

/** Build/replace the report sheet for "YYYY-MM". Returns { sheetName, url, count }. */
function apiGenerateReport(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('月の指定が不正です: ' + ym);
  var all = sortFlights_(readAllFlights_());
  var sh = freshReportSheet_(REPORT_PREFIX + ym);
  var end = writeMonthBlock_(sh, 1, ym, all);
  finishReportSheet_(sh, end.nextRow, ym.replace('-', '年') + '月');
  return { sheetName: sh.getName(), url: ss_().getUrl() + '#gid=' + sh.getSheetId(), count: end.count };
}

/** Build/replace the year sheet "飛行日誌_YYYY" with one block per month (1月..12月). */
function apiGenerateYearReport(year) {
  year = String(year || '');
  if (!/^\d{4}$/.test(year)) throw new Error('年の指定が不正です: ' + year);
  var all = sortFlights_(readAllFlights_());
  var sh = freshReportSheet_(REPORT_PREFIX + year);
  var row = 1, count = 0;
  for (var m = 1; m <= 12; m++) {
    var end = writeMonthBlock_(sh, row, year + '-' + pad2_(m), all);
    count += end.count;
    row = end.nextRow + REPORT_BLOCK_GAP;
  }
  finishReportSheet_(sh, row - REPORT_BLOCK_GAP, year + '年');
  return { sheetName: sh.getName(), url: ss_().getUrl() + '#gid=' + sh.getSheetId(), count: count };
}

function freshReportSheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (sh) { sh.clear(); sh.getRange(1, 1, sh.getMaxRows(), REPORT_NCOL).setNumberFormat('General'); }
  else sh = ss.insertSheet(name);
  return sh;
}

/**
 * Write one month block starting at `startRow`. `all` = every flight (sorted) — needed for the
 * carried-forward totals. Returns { nextRow, count }.
 */
function writeMonthBlock_(sh, startRow, ym, all) {
  var flights = all.filter(function (f) { return f.date.substring(0, 7) === ym; });
  var totals = computeMonthTotals_(all, ym);
  var ncol = REPORT_NCOL;

  // ----- title -----
  sh.getRange(startRow, 1).setValue(ym.substring(0, 4) + '年' + parseInt(ym.substring(5, 7), 10) + '月');
  sh.getRange(startRow, 1, 1, ncol).setFontWeight('bold');

  // ----- header (2 rows) -----
  var h1 = startRow + 1, h2 = startRow + 2;
  sh.getRange(h1, 1, 1, ncol).setValues([REPORT_HEADER_TOP]);
  sh.getRange(h2, 1, 1, ncol).setValues([REPORT_HEADER_BOTTOM]);
  var merges = [[1, 2, 1], [2, 2, 1], [3, 2, 1], [4, 2, 1], [5, 2, 1], [6, 2, 1], [7, 2, 1], [8, 2, 1],
    [9, 1, 2], [11, 2, 1], [12, 1, 5], [17, 1, 4], [21, 1, 2],
    [23, 2, 1], [24, 2, 1], [25, 2, 1], [26, 2, 1], [27, 2, 1], [28, 2, 2]];
  merges.forEach(function (m) { sh.getRange(h1, m[0], m[1], m[2]).merge(); });
  sh.getRange(h1, 1, 2, ncol).setFontWeight('bold').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrap(true).setBackground('#f1f3f4');

  // ----- body: formats FIRST (text columns), then values -----
  var firstBody = h2 + 1;
  var nBody = Math.max(flights.length, REPORT_MIN_ROWS);
  var lastBody = firstBody + nBody - 1;
  var totalRow = lastBody + 1;                 // 項小計, 前項までの合計, 合計 = totalRow .. totalRow+2
  var allRows = totalRow + 2 - firstBody + 1;  // body + 3 total rows

  sh.getRange(firstBody, 1, nBody, 1).setNumberFormat('@');          // 月日 "5.30"
  sh.getRange(firstBody, 2, nBody, 7).setNumberFormat('@');          // 型式..飛行内容 (incl. clocks "23:40")
  sh.getRange(firstBody, 9, allRows, 2).setNumberFormat('0');        // 離陸 / 着陸
  sh.getRange(firstBody, 11, allRows, 17).setNumberFormat('[h]:mm'); // 飛行時間 .. その他 (K..AA)
  sh.getRange(firstBody, 28, nBody, 2).setNumberFormat('@');         // 自由欄

  var body = [];
  flights.forEach(function (f) {
    var row = REPORT_KEYS.map(function (k) { return reportCell_(f, k); });
    row.push('');
    body.push(row);
  });
  while (body.length < nBody) body.push(blankRow_(ncol));
  sh.getRange(firstBody, 1, nBody, ncol).setValues(body);

  // ----- total rows -----
  var label = { subtotal: '項 小 計', carried: '前項までの合計', total: '合  計' };
  var totalRows = ['subtotal', 'carried', 'total'].map(function (k) {
    var row = blankRow_(ncol);
    row[7] = label[k];
    TOTAL_KEYS.forEach(function (key, i) {
      var v = totals[k][key];
      row[8 + i] = (key === 'takeoffs' || key === 'landings') ? v : v / 1440;
    });
    return row;
  });
  sh.getRange(totalRow, 1, 3, ncol).setValues(totalRows).setFontWeight('bold').setBackground('#fef7e0');

  // ----- borders / alignment -----
  sh.getRange(h1, 1, totalRow + 2 - h1 + 1, ncol).setBorder(true, true, true, true, true, true);
  sh.getRange(firstBody, 1, allRows, ncol).setHorizontalAlignment('center');

  return { nextRow: totalRow + 3, count: flights.length };
}

function finishReportSheet_(sh, nextRow, periodLabel) {
  var settings = getSettings_();
  var note = periodLabel + '　' + (settings.pilot_name ? settings.pilot_name + '　' : '') +
    (settings.licence_no ? '技能証明番号 ' + settings.licence_no + '　' : '') +
    '時刻基準: ' + settings.time_basis + '　生成: ' + parseDateStr_(new Date());
  sh.getRange(nextRow + 1, 1).setValue(note);
  sh.setColumnWidths(1, REPORT_NCOL, 62);
  sh.setColumnWidth(8, 80);
  sh.setColumnWidth(28, 110);
}

function blankRow_(n) {
  var r = [];
  for (var i = 0; i < n; i++) r.push('');
  return r;
}

/** Cell value for the report. 月日 is written as "M.D" text (e.g. "5.30"), like the Numbers logbook. */
function reportCell_(f, key) {
  var col = FLIGHT_COLUMNS[colIndex_(key)];
  if (key === 'date') { var p = f.date.split('-'); return parseInt(p[1], 10) + '.' + p[2]; }
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
