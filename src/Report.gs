/**
 * Report.gs — JCAB 飛行日誌 year sheets ("飛行日誌_YYYY"), kept up to date automatically.
 *
 * Layout (like a Numbers year sheet): 12 month blocks stacked vertically, each block =
 *   title row  : "YYYY年M月"
 *   2 rows     : two-row header (REPORT_HEADER_TOP / REPORT_HEADER_BOTTOM)
 *   rows       : one per flight leg, padded to REPORT_MIN_ROWS like the paper form
 *   3 rows     : 項小計 / 前項までの合計 / 合計
 *
 * Regeneration is triggered by Api.gs / Import.gs after every write via refreshYearSheets_(fromYear):
 * the affected year and every later year that has flights or a sheet (their 前項までの合計 change).
 *
 * Performance: the whole sheet is written with ONE setValues; formats/styles use RangeList; the
 * header merges are only rebuilt when the block layout changed since the last build (layout is
 * remembered in Script Properties), so a routine save costs roughly a dozen Sheets calls.
 *
 * Text-like values (月日 "5.30", clocks "23:40") go into cells whose number format is set to text
 * ('@') BEFORE the values are written; otherwise Sheets converts "5.30" into the number 5.3.
 */

var REPORT_MIN_ROWS = 15;      // blank rows to pad each month block to
var REPORT_BLOCK_GAP = 2;      // empty rows between month blocks
var REPORT_NCOL = 29;          // A..AC
var REPORT_LAYOUT_KEY = 'report_layout_'; // Script Properties: report_layout_<sheetName> = JSON block starts

/* ---------- public entry points ---------- */

/** Rebuild the sheet for one year. Returns { sheetName, url, count }. */
function apiRebuildYearReport(year) {
  year = String(year || '');
  if (!/^\d{4}$/.test(year)) throw new Error('年の指定が不正です: ' + year);
  var all = sortFlights_(readAllFlights_());
  return rebuildYearSheet_(year, all);
}

/** Spreadsheet menu: rebuild every year sheet (e.g. after pasting new code). */
function rebuildAllYearReports() {
  var all = sortFlights_(readAllFlights_());
  var names = reportYears_(all, null).map(function (y) { return rebuildYearSheet_(y, all).sheetName; });
  Logger.log('再生成: ' + names.join(', '));
  return names;
}

/**
 * Called after any write. Rebuilds the sheets of `fromYear` and all later years that have flights
 * or an existing sheet. `fromYear` null = every year. Returns the sheet names refreshed.
 */
function refreshYearSheets_(fromYear, allSorted) {
  var all = allSorted || sortFlights_(readAllFlights_());
  return reportYears_(all, fromYear).map(function (y) { return rebuildYearSheet_(y, all).sheetName; });
}

/** Years (strings) that have flights or an existing year sheet, >= fromYear when given. */
function reportYears_(all, fromYear) {
  var years = {};
  all.forEach(function (f) { years[f.date.substring(0, 4)] = true; });
  ss_().getSheets().forEach(function (s) {
    var m = s.getName().match(new RegExp('^' + REPORT_PREFIX + '(\\d{4})$'));
    if (m) years[m[1]] = true;
  });
  return Object.keys(years).filter(function (y) { return !fromYear || y >= String(fromYear); }).sort();
}

/* ---------- builder ---------- */

function rebuildYearSheet_(year, all) {
  var ss = ss_();
  var name = REPORT_PREFIX + year;
  var sh = ss.getSheetByName(name);
  var isNew = !sh;
  if (isNew) sh = ss.insertSheet(name);

  var plan = planYear_(year, all);
  var nrows = plan.grid.length;
  if (sh.getMaxRows() < nrows) sh.insertRowsAfter(sh.getMaxRows(), nrows - sh.getMaxRows());

  // Layout (block start rows) decides whether merges must be rebuilt.
  var props = PropertiesService.getScriptProperties();
  var layoutKey = REPORT_LAYOUT_KEY + name;
  var layout = JSON.stringify(plan.blockStarts);
  var relayout = isNew || props.getProperty(layoutKey) !== layout;

  sh.clear();
  if (relayout && !isNew) sh.getRange(1, 1, sh.getMaxRows(), REPORT_NCOL).breakApart();

  // Column number formats over the used rows — BEFORE writing values (text columns must be '@').
  sh.getRange(1, 1, nrows, 8).setNumberFormat('@');           // 月日..飛行内容 (incl. clocks)
  sh.getRange(1, 9, nrows, 2).setNumberFormat('0');           // 離陸 / 着陸
  sh.getRange(1, 11, nrows, 17).setNumberFormat('[h]:mm');    // 飛行時間..その他 (K..AA)
  sh.getRange(1, 28, nrows, 2).setNumberFormat('@');          // 自由欄

  sh.getRange(1, 1, nrows, REPORT_NCOL).setValues(plan.grid);

  // Styles, batched with RangeList.
  sh.getRangeList(plan.titleRanges).setFontWeight('bold');
  sh.getRangeList(plan.headerRanges).setFontWeight('bold').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrap(true).setBackground('#f1f3f4');
  sh.getRangeList(plan.totalRanges).setFontWeight('bold').setBackground('#fef7e0');
  sh.getRangeList(plan.dataRanges).setHorizontalAlignment('center');
  sh.getRangeList(plan.tableRanges).setBorder(true, true, true, true, true, true);

  if (relayout) {
    plan.blockStarts.forEach(function (start) {
      var h1 = start + 1;
      sh.getRange(h1, 1, 2, 8).mergeVertically();    // 月日..飛行内容
      sh.getRange(h1, 9, 1, 2).merge();              // 離着陸回数
      sh.getRange(h1, 11, 2, 1).mergeVertically();   // 飛行時間
      sh.getRange(h1, 12, 1, 5).merge();             // 機長・単独・副機長…
      sh.getRange(h1, 17, 1, 4).merge();             // 副操縦士または教官同乗教育…
      sh.getRange(h1, 21, 1, 2).merge();             // 計器飛行時間
      sh.getRange(h1, 23, 2, 5).mergeVertically();   // 模擬飛行装置..その他
      sh.getRange(h1, 28, 2, 2).merge();             // 自由欄
    });
    props.setProperty(layoutKey, layout);
  }
  if (isNew) {
    sh.setColumnWidths(1, REPORT_NCOL, 62);
    sh.setColumnWidth(8, 80);
    sh.setColumnWidth(28, 110);
    sh.setFrozenRows(0);
  }
  SpreadsheetApp.flush();
  return { sheetName: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), count: plan.count };
}

/**
 * Compute the full grid for a year plus the A1 ranges used for styling.
 * Pure function of (year, all flights, settings) — no Sheets calls except getSettings_.
 */
function planYear_(year, all) {
  var settings = getSettings_();
  var ncol = REPORT_NCOL;
  var grid = [], blockStarts = [], titleRanges = [], headerRanges = [], totalRanges = [], dataRanges = [], tableRanges = [];
  var count = 0;
  var label = { subtotal: '項 小 計', carried: '前項までの合計', total: '合  計' };

  for (var m = 1; m <= 12; m++) {
    var ym = year + '-' + pad2_(m);
    var flights = all.filter(function (f) { return f.date.substring(0, 7) === ym; });
    var totals = computeMonthTotals_(all, ym);
    count += flights.length;

    if (m > 1) for (var g = 0; g < REPORT_BLOCK_GAP; g++) grid.push(blankRow_(ncol));
    var start = grid.length + 1;                 // 1-based sheet row of the title
    blockStarts.push(start);

    var title = blankRow_(ncol); title[0] = year + '年' + m + '月';
    grid.push(title);
    grid.push(REPORT_HEADER_TOP.slice());
    grid.push(REPORT_HEADER_BOTTOM.slice());

    var nBody = Math.max(flights.length, REPORT_MIN_ROWS);
    flights.forEach(function (f) {
      var row = REPORT_KEYS.map(function (k) { return reportCell_(f, k); });
      row.push('');
      grid.push(row);
    });
    for (var i = flights.length; i < nBody; i++) grid.push(blankRow_(ncol));

    ['subtotal', 'carried', 'total'].forEach(function (k) {
      var row = blankRow_(ncol);
      row[7] = label[k];
      TOTAL_KEYS.forEach(function (key, idx) {
        var v = totals[k][key];
        row[8 + idx] = (key === 'takeoffs' || key === 'landings') ? v : v / 1440;
      });
      grid.push(row);
    });

    var h1 = start + 1, firstBody = start + 3, totalRow = firstBody + nBody, lastRow = totalRow + 2;
    titleRanges.push(a1_(start, 1, 1, ncol));
    headerRanges.push(a1_(h1, 1, 2, ncol));
    totalRanges.push(a1_(totalRow, 1, 3, ncol));
    dataRanges.push(a1_(firstBody, 1, lastRow - firstBody + 1, ncol));
    tableRanges.push(a1_(h1, 1, lastRow - h1 + 1, ncol));
  }

  // footer note
  grid.push(blankRow_(ncol));
  var note = blankRow_(ncol);
  note[0] = year + '年　' + (settings.pilot_name ? settings.pilot_name + '　' : '') +
    (settings.licence_no ? '技能証明番号 ' + settings.licence_no + '　' : '') +
    '時刻基準: ' + settings.time_basis + '　更新: ' + parseDateStr_(new Date());
  grid.push(note);

  return { grid: grid, blockStarts: blockStarts, count: count, titleRanges: titleRanges, headerRanges: headerRanges,
    totalRanges: totalRanges, dataRanges: dataRanges, tableRanges: tableRanges };
}

/* ---------- helpers ---------- */

function blankRow_(n) {
  var r = [];
  for (var i = 0; i < n; i++) r.push('');
  return r;
}

/** A1 notation for (row, col, numRows, numCols), 1-based. */
function a1_(r, c, nr, nc) {
  return colLetter_(c) + r + ':' + colLetter_(c + nc - 1) + (r + nr - 1);
}

function colLetter_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26; }
  return s;
}

/** Cell value for the report. 月日 is written as "M.DD" text (e.g. "5.30"), like the Numbers logbook. */
function reportCell_(f, key) {
  var col = FLIGHT_COLUMNS[colIndex_(key)];
  if (key === 'date') { var p = f.date.split('-'); return parseInt(p[1], 10) + '.' + p[2]; }
  if (col.kind === 'min') return f[key] ? f[key] / 1440 : '';
  if (col.kind === 'int') return f[key];
  return f[key] || '';
}

/** Existing year sheets, newest first. */
function apiListReports() {
  return ss_().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return n.indexOf(REPORT_PREFIX) === 0; })
    .sort().reverse();
}
