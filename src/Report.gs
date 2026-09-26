/**
 * Report.gs — JCAB 飛行日誌 year sheets ("飛行日誌_YYYY"), kept up to date automatically.
 *
 * Layout (like a Numbers year sheet): 12 month blocks stacked vertically, each block =
 *   title row  : "M月"
 *   2 rows     : two-row header (REPORT_HEADER_TOP / REPORT_HEADER_BOTTOM)
 *   rows       : one per flight leg, padded to REPORT_MIN_ROWS like the paper form
 *   3 rows     : 項小計 / 前項までの合計 / 合計 (cells A..G of these rows merged into one blank cell)
 *
 * Design (matches the original Numbers table):
 *   - thin grid, medium outer frame, medium line under the header and above the totals
 *   - medium vertical lines at the group boundaries (I, K, L, Q, U, W, Z, AB), dotted line 離陸|着陸
 *   - alternate row shading (light grey-green) continuing through the total rows
 *   - everything centred, regular weight, Noto Sans JP 10pt; header rows taller for 2-line labels
 *
 * Regeneration is triggered by Api.gs / Import.gs after every write via refreshYearSheets_(fromYear):
 * the affected year and every later year that has flights or a sheet (their 前項までの合計 change).
 *
 * Performance: the whole sheet is written with ONE setValues; every style/border is applied with
 * RangeList across all 12 blocks (a fixed number of calls per year). Merges, column widths and row
 * heights are only rebuilt when the layout (block start rows) or REPORT_DESIGN_VERSION changed
 * since the last build (remembered in Script Properties).
 *
 * Text-like values (月日 "5.30", clocks "23:40") go into cells whose number format is set to text
 * ('@') BEFORE the values are written; otherwise Sheets converts "5.30" into the number 5.3.
 * The 離陸 / 着陸 columns are text for the same reason: a SIM leg's counts are written in parentheses
 * ("(1)") and Sheets would read "(1)" as the number -1. Total rows carry the real counts only
 * (SIM counts are never part of 項小計 / 前項までの合計 / 合計).
 */

var REPORT_MIN_ROWS = 15;      // blank rows to pad each month block to
var REPORT_BLOCK_GAP = 2;      // empty rows between month blocks
var REPORT_NCOL = 29;          // A..AC
var REPORT_LAYOUT_KEY = 'report_layout_'; // Script Properties: report_layout_<sheetName>
var REPORT_DESIGN_VERSION = 3; // bump when formats / merges / widths / heights change, forcing a relayout

var REPORT_FONT = 'Noto Sans JP';
var REPORT_FONT_SIZE = 10;
var REPORT_SHADE = '#eef3f2';
var REPORT_LINE = '#000000';
var REPORT_GROUP_COLS = [9, 11, 12, 17, 21, 23, 26, 28]; // medium line on the LEFT of these columns
var REPORT_HEADER_ROW_HEIGHT = 34;
var REPORT_ROW_HEIGHT = 21;
var REPORT_COL_WIDTHS = [
  42, 44, 60, 46, 46, 52, 52, 84,   // 月日 型式 登録記号 出発地 到着地 出発時刻 到着時刻 飛行内容
  68, 68, 76,                       // 離陸 着陸 飛行時間
  66, 150, 118, 66, 66,             // 機長 単独・副機長 PUS 野外 夜間
  66, 66, 66, 66,                   // 副操縦士 同乗教育 野外 夜間
  66, 100,                          // フード 計器飛行
  74, 74, 56, 66, 96,               // 模擬 FTD 操縦教員 航空機関士 その他
  62, 46                            // 自由欄 (INST) / 自由欄 2
];

/* ---------- public entry points ---------- */

/** Rebuild the sheet for one year. Returns { sheetName, url, count }. */
function apiRebuildYearReport(year) {
  year = String(year || '');
  if (!/^\d{4}$/.test(year)) throw new Error('年の指定が不正です: ' + year);
  var all = sortFlights_(readAllFlights_());
  return rebuildYearSheet_(year, all);
}

/** Spreadsheet menu: full rebuild of every year sheet, including styles (e.g. after pasting new code). */
function rebuildAllYearReports() {
  var all = sortFlights_(readAllFlights_());
  var names = reportYears_(all, null).map(function (y) { return rebuildYearSheet_(y, all, true).sheetName; });
  Logger.log('再生成: ' + names.join(', '));
  return names;
}

/**
 * Called after any write. Rebuilds the sheets of `fromYear` and all later years that have flights
 * or an existing sheet. `fromYear` null = every year. `force` = full rebuild with styles even when
 * the layout is unchanged. Returns the sheet names refreshed.
 */
function refreshYearSheets_(fromYear, allSorted, force) {
  var all = allSorted || sortFlights_(readAllFlights_());
  var names = reportYears_(all, fromYear).map(function (y) { return rebuildYearSheet_(y, all, force).sheetName; });
  rebuildQualSheet_(all, force);   // 資格要件チェックリスト follows the logbook too
  return names;
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

function rebuildYearSheet_(year, all, force) {
  var ss = ss_();
  var name = REPORT_PREFIX + year;
  var sh = ss.getSheetByName(name);
  var isNew = !sh;
  if (isNew) sh = ss.insertSheet(name);

  var plan = planYear_(year, all);
  var nrows = plan.grid.length;
  if (sh.getMaxRows() < nrows) sh.insertRowsAfter(sh.getMaxRows(), nrows - sh.getMaxRows());
  if (sh.getMaxColumns() < REPORT_NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), REPORT_NCOL - sh.getMaxColumns());

  // Layout (block start rows + design version) decides whether merges/widths/heights must be rebuilt.
  var props = PropertiesService.getScriptProperties();
  var layoutKey = REPORT_LAYOUT_KEY + name;
  var layout = JSON.stringify({ v: REPORT_DESIGN_VERSION, starts: plan.blocks.map(function (b) { return b.start + ':' + b.nBody; }) });
  var relayout = isNew || !!force || props.getProperty(layoutKey) !== layout;

  if (!relayout) {
    // Fast path (routine save): the block layout is unchanged, so number formats, styles, borders,
    // merges, widths and heights are all still valid — only the values need rewriting.
    sh.getRange(1, 1, nrows, REPORT_NCOL).setValues(plan.grid);
    SpreadsheetApp.flush();
    return { sheetName: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), count: plan.count, relayout: false };
  }

  sh.clear();
  if (!isNew) sh.getRange(1, 1, sh.getMaxRows(), REPORT_NCOL).breakApart();

  // Column number formats over the used rows — BEFORE writing values (text columns must be '@').
  sh.getRange(1, 1, nrows, 8).setNumberFormat('@');           // 月日..飛行内容 (incl. clocks)
  sh.getRange(1, 9, nrows, 2).setNumberFormat('@');           // 離陸 / 着陸 (text: "(1)" = SIM count)
  sh.getRange(1, 11, nrows, 17).setNumberFormat('[h]:mm');    // 飛行時間..その他 (K..AA)
  sh.getRange(1, 28, nrows, 2).setNumberFormat('@');          // 自由欄

  sh.getRange(1, 1, nrows, REPORT_NCOL).setValues(plan.grid);

  // ----- typography & alignment (whole used area, then per-part tweaks) -----
  sh.getRange(1, 1, nrows, REPORT_NCOL).setFontFamily(REPORT_FONT).setFontSize(REPORT_FONT_SIZE)
    .setVerticalAlignment('middle').setHorizontalAlignment('center').setFontWeight('normal');
  sh.getRangeList(plan.titleRanges).setHorizontalAlignment('left');
  sh.getRangeList(plan.headerRanges).setWrap(true);
  sh.getRangeList(plan.shadeRanges).setBackground(REPORT_SHADE);

  // ----- borders -----
  var S = SpreadsheetApp.BorderStyle;
  var tables = sh.getRangeList(plan.tableRanges);
  tables.setBorder(true, true, true, true, true, true, REPORT_LINE, S.SOLID);              // thin grid
  tables.setBorder(true, true, true, true, null, null, REPORT_LINE, S.SOLID_MEDIUM);       // outer frame
  sh.getRangeList(plan.headerRanges).setBorder(null, null, true, null, null, null, REPORT_LINE, S.SOLID_MEDIUM);
  sh.getRangeList(plan.totalRanges).setBorder(true, null, null, null, null, null, REPORT_LINE, S.SOLID_MEDIUM);
  REPORT_GROUP_COLS.forEach(function (c) {
    sh.getRangeList(plan.blocks.map(function (b) { return a1_(b.h1, c, b.lastRow - b.h1 + 1, 1); }))
      .setBorder(null, true, null, null, null, null, REPORT_LINE, S.SOLID_MEDIUM);
  });
  sh.getRangeList(plan.blocks.map(function (b) { return a1_(b.h2, 9, b.lastRow - b.h2 + 1, 1); }))
    .setBorder(null, null, null, true, null, null, REPORT_LINE, S.DOTTED);                 // 離陸 ┊ 着陸

  // ----- structure (merges, heights, widths) -----
  plan.blocks.forEach(function (b) {
    var h1 = b.h1;
    sh.getRange(h1, 1, 2, 8).mergeVertically();    // 月日..飛行内容
    sh.getRange(h1, 9, 1, 2).merge();              // 離着陸回数
    sh.getRange(h1, 11, 2, 1).mergeVertically();   // 飛行時間
    sh.getRange(h1, 12, 1, 5).merge();             // 機長・単独・副機長…
    sh.getRange(h1, 17, 1, 4).merge();             // 副操縦士または教官同乗教育…
    sh.getRange(h1, 21, 1, 2).merge();             // 計器飛行時間
    sh.getRange(h1, 23, 2, 5).mergeVertically();   // 模擬飛行装置..その他
    sh.getRange(h1, 28, 1, 2).merge();             // 自由欄 (INST / blank below)
    sh.getRange(b.totalRow, 1, 3, 7).merge();      // blank area left of the total labels
  });
  sh.setRowHeights(1, nrows, REPORT_ROW_HEIGHT);
  plan.blocks.forEach(function (b) { sh.setRowHeights(b.h1, 2, REPORT_HEADER_ROW_HEIGHT); });
  REPORT_COL_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(0);
  props.setProperty(layoutKey, layout);
  SpreadsheetApp.flush();
  return { sheetName: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), count: plan.count, relayout: true };
}

/**
 * Compute the full grid for a year plus the A1 ranges used for styling.
 * Pure function of (year, all flights, settings) — no Sheets calls except getSettings_.
 */
function planYear_(year, all) {
  var settings = getSettings_();
  var ncol = REPORT_NCOL;
  var grid = [], blocks = [], titleRanges = [], headerRanges = [], totalRanges = [], tableRanges = [], shadeRanges = [];
  var count = 0;
  var label = { subtotal: '項 小 計', carried: '前項までの合計', total: '合  計' };

  for (var m = 1; m <= 12; m++) {
    var ym = year + '-' + pad2_(m);
    var flights = all.filter(function (f) { return f.date.substring(0, 7) === ym; });
    var totals = computeMonthTotals_(all, ym);
    count += flights.length;

    if (m > 1) for (var g = 0; g < REPORT_BLOCK_GAP; g++) grid.push(blankRow_(ncol));
    var start = grid.length + 1;                 // 1-based sheet row of the title

    var title = blankRow_(ncol); title[0] = m + '月';
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
        row[8 + idx] = SIM_COUNT_OF[key] ? String(v) : v / 1440;   // counts: text column, real only
      });
      grid.push(row);
    });

    var h1 = start + 1, h2 = start + 2, firstBody = start + 3, totalRow = firstBody + nBody, lastRow = totalRow + 2;
    blocks.push({ start: start, h1: h1, h2: h2, firstBody: firstBody, nBody: nBody, totalRow: totalRow, lastRow: lastRow });
    titleRanges.push(a1_(start, 1, 1, 1));
    headerRanges.push(a1_(h1, 1, 2, ncol));
    totalRanges.push(a1_(totalRow, 1, 3, ncol));
    tableRanges.push(a1_(h1, 1, lastRow - h1 + 1, ncol));
    // alternate shading: 2nd, 4th, ... row of the body, continuing through the total rows
    for (var r = firstBody + 1; r <= lastRow; r += 2) shadeRanges.push(a1_(r, 1, 1, ncol));
  }

  // footer note
  grid.push(blankRow_(ncol));
  var note = blankRow_(ncol);
  note[0] = year + '年　' + (settings.pilot_name ? settings.pilot_name + '　' : '') +
    (settings.licence_no ? '技能証明番号 ' + settings.licence_no + '　' : '') +
    '時刻基準: ' + settings.time_basis + '　更新: ' + parseDateStr_(new Date());
  grid.push(note);
  titleRanges.push(a1_(grid.length, 1, 1, 1));

  return { grid: grid, blocks: blocks, count: count, titleRanges: titleRanges, headerRanges: headerRanges,
    totalRanges: totalRanges, tableRanges: tableRanges, shadeRanges: shadeRanges };
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
  if (SIM_COUNT_OF[key]) return countText_(f[key], f[SIM_COUNT_OF[key]]);
  if (col.kind === 'int') return f[key];
  return f[key] || '';
}

/** 離陸 / 着陸 cell text of one leg: the real count, or the SIM count in parentheses on a SIM leg ("(1)"). */
function countText_(n, sim) {
  n = Number(n) || 0; sim = Number(sim) || 0;
  if (!sim) return String(n);
  return (n ? n + ' ' : '') + '(' + sim + ')';
}

/** Existing year sheets, newest first. */
function apiListReports() {
  return ss_().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return n.indexOf(REPORT_PREFIX) === 0; })
    .sort().reverse();
}
