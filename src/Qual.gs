/**
 * Qual.gs — 資格要件チェックリスト sheet: an exact reproduction of the CAP checklist
 * (資格_要件チェックリスト_20260621.xlsx, sheet "CAP", A1:J27) whose entries are filled from the
 * logbook and Settings and refreshed after every write (refreshYearSheets_) and settings change.
 *
 * Data sources
 *   所属 / 社員番号 / 氏名          Settings department / employee_no / pilot_name
 *   基準月 (row 3)                 Settings base_skill (技能基準月, CACK+M12), base_skill+6 (M21/M22),
 *                                  base_route, base_dit; PE/PEA: month of the expiry dates
 *   実施日 (rows 5-10)             M12 / M21 / M22: flights whose 飛行内容 starts with the code
 *                                  CACK: 飛行内容 "CACK" or "M11" + Settings dates_cack
 *                                  ROUTE CHK: legs flagged QPR (qpr column) + 飛行内容 "ROUTE…" + Settings dates_route
 *                                  DIT / 63歳付加訓練 / PE / PEA: Settings dates_* (comma lists)
 *   有効期限 (rows 5-10, 12-15)     Settings exp_pe, exp_pea, exp_english (≤2), exp_competency (≤5),
 *                                  exp_passport, exp_visa
 *   row 5 = 前回実施日 (latest), rows 6-10 = 年度 (FY-1 .. FY+3, April-March) 実施日
 *
 * Layout: values are written with ONE setValues; styles/merges/widths only when the sheet is new,
 * forced, or QUAL_DESIGN_VERSION changed (remembered in Script Properties).
 */

var QUAL_SHEET = '資格要件チェックリスト';
var QUAL_DESIGN_VERSION = 3;   // 3: QPR moved into the ROUTE CHK column (extra block removed)
var QUAL_LAYOUT_KEY = 'qual_layout';
var QUAL_ROWS = 27, QUAL_COLS = 10;      // the CAP form itself (A1:J27)
var QUAL_GREY = '#c0c0c0';
var QUAL_FONT = 'Noto Sans JP';
var QUAL_DATE_BLANK = '        年       月       日';
var QUAL_EXP_BLANK = '有効期限　　 　年　　 月　 　日\n実施日　　　 　 年　 　月　 　日';

// Excel column widths (chars) → px, row heights (pt) → px
var QUAL_COL_PX = [231, 148, 96, 96, 96, 96, 96, 184, 213, 96];
var QUAL_ROW_PX = [50, 47, 36, 36, 43, 43, 38, 43, 44, 41, 36, 29, 29, 29, 29, 52, 28, 28, 28, 28, 89, 55, 28, 28, 28, 63, 77];

var QUAL_NOTES = [
  ['CACK', '昇格技能審査、型式移行技能審査、復帰技能審査に合格した日の属する月。'],
  ['M12', '技能基準月と同月'],
  ['M21', '技能基準月から6ヶ月後'],
  ['M22', ''],
  ['ROUTE CHK', '機長昇格、復帰・型式移行路線審査で、運航審査官による審査を受けた場合は、機長認定通知書(航空局からの認定通知書が発行された日)が属する月（原則、通知書は7日以内に発行される。月末に受審し、当初は翌月の発行日の予定だったが、当月内に発行された場合は、別途乗員部からその旨、連絡する）。\n上記以外の社内で実施する機長昇格、復帰・型式移行審査(777→787型式移行は除く)については、合格した日の属する月。'],
  ['DIT', '原則として基準月の前1ヶ月から後1ヶ月の範囲内において実施するが、病気、使用施設の関係等で実施困難と機種別運航乗員部長が判断する場合には基準月の前2ヶ月から後2ヶ月の範囲内において実施することが可能。但し、訓練内容は年度ごとに設定されるため、前年度の繰り上げ、次年度への繰り下げは行わない。基準月については初期訓練実施後、乗務開始前に客室乗務員との合同訓練を目的として訓練を実施し、その後１年以内の誕生日月または指示する月に実施後、基準月とする。'],
  ['63歳以上68歳未満付加訓練', '初期訓練は、63 歳の誕生日前1 ヶ月以内に実施する。定期訓練は、初期訓練を終了後、年1回実施する。'],
  ['PE またはPEA', '航空身体検査証明審査会の国土交通大臣判定において、PEライセンスの有効期間が6ヶ月に短縮されている場合は年2回航空身体検査を受検するためPEAの受診はなし。'],
  ['復帰訓練', '理由を問わず（健康上以外の理由も含む）、連続60日以上乗務中断した場合には復帰訓練が必要となる。各自でFLT LOG,MFTR等により至近の乗務を要確認。'],
  ['航空英語試験', '有効期間の起算日は試験受験日ではなく、試験に合格と判定された日。\n但し、継続で現に有する航空英語能力証明の有効期間が満了する日の3ヶ月前から期間が満了する日までの間に試験に合格した場合には、当該期間が満了した翌日となる。なお、有効期間がﾚﾍﾞﾙ4は3年、レベル5は6年、ﾚﾍﾞﾙ6は無期限。'],
  ['特定操縦技能\n審査/確認', '昇格、限定変更などで技能証明書が発行された場合は、審査日、審査結果、操縦等可能期間満了日、所属が記されていること（2021年の様式変更に伴う一斉交換時のものは未記入）、および CERT. NO. が技能証明書と相違ないことを確認する。このライセンスは書き込み式のため、ラミネート加工等のコーティングはしないこと。']
];

/* ---------- helpers ---------- */

/** "a, b" → ['yyyy-mm-dd', ...] (invalid entries dropped), sorted ascending. */
function dateList_(v) {
  return String(v || '').split(/[,\s、]+/).map(function (s) { return s.trim(); }).filter(Boolean)
    .map(function (s) { try { return parseDateStr_(s); } catch (e) { return null; } })
    .filter(Boolean).sort();
}
function jpDate_(d) { // 'yyyy-mm-dd' → '2026年 4月 15日'
  if (!d) return QUAL_DATE_BLANK;
  var p = d.split('-'); return p[0] + '年 ' + parseInt(p[1], 10) + '月 ' + parseInt(p[2], 10) + '日';
}
function slashDate_(d) { var p = d.split('-'); return p[0] + ' / ' + p[1] + ' / ' + p[2]; }
function monthLabel_(v) { // 'yyyy-mm' | 'yyyy-mm-dd' | 'mm' | 'm月' → 'M月' ('月' when blank/invalid)
  var s = String(v || '').trim(), m, n;
  if ((m = s.match(/^(\d{4})[-\/](\d{1,2})/))) n = Number(m[2]);
  else if ((m = s.match(/^(\d{1,2})\s*月?$/))) n = Number(m[1]);
  return n >= 1 && n <= 12 ? n + '月' : '月';
}
function monthPlus_(v, n) { // 'M月' + n → 'M月'
  var m = String(v).match(/(\d{1,2})月/);
  if (!m) return '月';
  return (((Number(m[1]) - 1 + n) % 12 + 12) % 12 + 1) + '月';
}
function fyOf_(d) { var y = Number(d.substring(0, 4)), m = Number(d.substring(5, 7)); return m >= 4 ? y : y - 1; }
function latest_(list) { return list.length ? list[list.length - 1] : ''; }
function inFy_(list, fy) { return list.filter(function (d) { return fyOf_(d) === fy; }); }
function slots_(list, n) { // '(1) 2026 / 03 / 31 　 (2)    /    /   '
  var out = [];
  for (var i = 0; i < n; i++) out.push('(' + (i + 1) + ') ' + (list[i] ? slashDate_(list[i]) : '     /     /     '));
  return '　' + out.join('　　');
}

/** Dates of legs flagged QPR (the QPR checkbox) — they are ROUTE CHK entries on the checklist. */
function qprDates_(all) { return all.filter(function (f) { return f.qpr === '1'; }).map(function (f) { return f.date; }).sort(); }

/** Dates of training / check events found in the logbook (飛行内容 starting with a code). */
function logbookEventDates_(all, codes) {
  var out = [];
  all.forEach(function (f) {
    var no = f.flight_no.toUpperCase();
    if (codes.some(function (c) { return no.indexOf(c) === 0; })) out.push(f.date);
  });
  return out.sort();
}

/** All the data the checklist needs, also returned by apiQualificationSheetData for the UI. */
function qualSheetData_(all, today) {
  var st = getSettings_();
  all = all || sortFlights_(readAllFlights_());
  today = today || parseDateStr_(new Date());
  var fy = fyOf_(today);
  var cols = [
    { key: 'cack', dates: dateList_(st.dates_cack).concat(logbookEventDates_(all, ['CACK', 'M11'])).sort() },
    { key: 'm12', dates: logbookEventDates_(all, ['M12']) },
    { key: 'm21', dates: logbookEventDates_(all, ['M21']) },
    { key: 'm22', dates: logbookEventDates_(all, ['M22']) },
    { key: 'route', dates: dateList_(st.dates_route).concat(logbookEventDates_(all, ['ROUTE']), qprDates_(all)).sort() },   // QPR = ROUTE CHK
    { key: 'dit', dates: dateList_(st.dates_dit).concat(logbookEventDates_(all, ['DIT'])).sort() },
    { key: 'age63', dates: dateList_(st.dates_age63) },
    { key: 'pe', dates: dateList_(st.dates_pe), exp: dateList_(st.exp_pe) },
    { key: 'pea', dates: dateList_(st.dates_pea), exp: dateList_(st.exp_pea) }
  ];
  var baseSkill = monthLabel_(st.base_skill) !== '月' ? monthLabel_(st.base_skill) : monthLabel_(latest_(cols[1].dates) || latest_(cols[0].dates));
  return {
    today: today, fy: fy, fiscalYears: [fy - 1, fy, fy + 1, fy + 2, fy + 3],
    department: st.department || '', employee_no: st.employee_no || '', pilot_name: st.pilot_name || '',
    base: { skill: baseSkill, m21: monthPlus_(baseSkill, 6),
      route: monthLabel_(st.base_route) !== '月' ? monthLabel_(st.base_route) : monthLabel_(latest_(cols[4].dates)),
      dit: monthLabel_(st.base_dit) !== '月' ? monthLabel_(st.base_dit) : monthLabel_(latest_(cols[5].dates)),
      pe: monthLabel_(latest_(cols[7].exp)), pea: monthLabel_(latest_(cols[8].exp)) },
    cols: cols,
    english: dateList_(st.exp_english), competency: dateList_(st.exp_competency),
    passport: dateList_(st.exp_passport), visa: dateList_(st.exp_visa)
  };
}

function apiQualificationSheetData() { return qualSheetData_(); }

/* ---------- grid ---------- */

function planQualSheet_(data) {
  var g = [];
  for (var r = 0; r < QUAL_ROWS; r++) g.push(blankRow_(QUAL_COLS));
  var pad = function (s, n) { while (s.length < n) s += '　'; return s; };
  g[0][0] = '資格 要件チェックリスト　for  CAP';
  g[0][3] = '所属：' + pad(data.department, 10) + '社員番号：' + pad(data.employee_no, 14) + '氏名：' + data.pilot_name;
  g[0][9] = '2026.06.21RVS  ';
  g[1] = ['訓練審査', 'CACK', 'M12 ', 'M21 ', 'M22 ', 'ROUTE CHK', 'DIT', '63歳以上68歳未満付加訓練', 'PE', 'PEA（またはPE）'];
  g[2] = ['基準月', data.base.skill, '', data.base.m21, '', data.base.route, data.base.dit, '', data.base.pe, data.base.pea];
  g[3] = ['実施月', '-1 ～ + 1 月', '-1 ～ + 1 月', '-1 ～ + 1 月', '-1 ～ + 1 月', '-1 ～ + 1 月', '-1 ～ + 1 月',
    '初期：63歳誕生日前1ヶ月内\n定期：初期訓練後年1回', '有効期限の45 日～30 日前', 'PEAはPE受検月の6ヶ月後\nPEは有効期限の45日～30日前'];

  var expCell = function (col, dates, fyOrNull) {
    var exp = fyOrNull === null ? latest_(col.exp) : (inFy_(col.dates, fyOrNull).length ? latest_(col.exp) : '');
    var did = fyOrNull === null ? latest_(col.dates) : latest_(inFy_(col.dates, fyOrNull));
    if (!exp && !did) return QUAL_EXP_BLANK;
    return '有効期限 ' + (exp ? jpDate_(exp) : '　年　月　日') + '\n実施日 ' + (did ? jpDate_(did) : '　年　月　日');
  };
  // row 5: 前回実施日 (latest)
  g[4][0] = '前回実施日';
  for (var c = 0; c < 7; c++) g[4][c + 1] = jpDate_(latest_(data.cols[c].dates));
  g[4][8] = expCell(data.cols[7], null, null);
  g[4][9] = expCell(data.cols[8], null, null);
  // rows 6-10: fiscal years
  data.fiscalYears.forEach(function (fy, i) {
    var r = 5 + i;
    g[r][0] = fy + '年度\n実施日';
    for (var c = 0; c < 7; c++) g[r][c + 1] = jpDate_(latest_(inFy_(data.cols[c].dates, fy)));
    if (i >= 2) g[r][7] = '－';          // 63歳: rows 8-10 are fixed "－" in the form
    g[r][8] = expCell(data.cols[7], null, fy);
    g[r][9] = expCell(data.cols[8], null, fy);
  });
  // rows 12-15
  g[11][0] = '航空英語能力証明書　有効期限';         g[11][2] = slots_(data.english, 2);
  g[12][0] = '特定操縦技能審査/確認 期間満了日';    g[12][2] = slots_(data.competency, 5);
  g[13][0] = 'PASSPORT有効期限';                    g[13][2] = slots_(data.passport, 1);
  g[14][0] = 'VISA有効期限';                        g[14][2] = slots_(data.visa, 1);
  // row 16 + notes 17-27
  g[15][0] = '各訓練・審査の基準月設定、および　その他の注意事項';
  QUAL_NOTES.forEach(function (n, i) { g[16 + i][0] = n[0]; g[16 + i][1] = n[1]; });
  return g;
}

/* ---------- builder ---------- */

function apiRebuildQualSheet() { return rebuildQualSheet_(null, true); }

function rebuildQualSheet_(all, force) {
  var ss = ss_();
  var sh = ss.getSheetByName(QUAL_SHEET);
  var isNew = !sh;
  if (isNew) sh = ss.insertSheet(QUAL_SHEET);
  var data = qualSheetData_(all);
  var grid = planQualSheet_(data);
  var props = PropertiesService.getScriptProperties();
  var stamp = 'v' + QUAL_DESIGN_VERSION;
  var relayout = isNew || !!force || props.getProperty(QUAL_LAYOUT_KEY) !== stamp;

  if (!relayout) {
    sh.getRange(1, 1, QUAL_ROWS, QUAL_COLS).setValues(grid);
    sh.getRange(1, 12).setValue('更新 ' + data.today);
    SpreadsheetApp.flush();
    return { sheetName: QUAL_SHEET, relayout: false };
  }

  if (sh.getMaxColumns() < 12) sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  sh.clear();
  if (!isNew) sh.getRange(1, 1, sh.getMaxRows(), QUAL_COLS).breakApart();
  sh.getRange(1, 1, QUAL_ROWS, QUAL_COLS).setNumberFormat('@').setValues(grid);
  var S = SpreadsheetApp.BorderStyle;

  // typography
  sh.getRange(1, 1, QUAL_ROWS, QUAL_COLS).setFontFamily(QUAL_FONT).setFontSize(11).setVerticalAlignment('middle');
  sh.getRange(1, 1).setFontSize(12).setFontWeight('bold');
  sh.getRange(1, 4).setFontWeight('bold');
  sh.getRange(1, 10).setHorizontalAlignment('right');
  sh.getRange(2, 1, 1, QUAL_COLS).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sh.getRange(3, 1, 8, 1).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sh.getRange(2, 1, 1, 8).setBackground(QUAL_GREY);
  sh.getRange(3, 1, 8, 1).setBackground(QUAL_GREY);
  sh.getRange(3, 2, 1, 9).setHorizontalAlignment('right');
  sh.getRange(4, 2, 1, 9).setHorizontalAlignment('center').setWrap(true);
  sh.getRange(4, 8).setFontSize(8).setHorizontalAlignment('left');
  sh.getRange(5, 2, 6, 7).setHorizontalAlignment('right').setWrap(true);
  sh.getRange(5, 9, 6, 2).setHorizontalAlignment('center').setWrap(true);
  sh.getRange(12, 1, 4, 1).setFontWeight('bold');
  sh.getRange(16, 1).setFontWeight('bold');
  sh.getRange(17, 1, 11, 1).setHorizontalAlignment('center').setWrap(true);
  sh.getRange(17, 2, 11, 1).setFontSize(10).setHorizontalAlignment('left').setWrap(true);

  // borders: table (rows 2-10) thin grid + medium frame; rows 12-16 medium horizontals; notes medium grid
  sh.getRange(2, 1, 9, QUAL_COLS).setBorder(true, true, true, true, true, true, '#000000', S.SOLID);
  sh.getRange(2, 1, 9, QUAL_COLS).setBorder(true, true, true, true, null, null, '#000000', S.SOLID_MEDIUM);
  sh.getRange(12, 1, 4, QUAL_COLS).setBorder(true, true, true, true, null, true, '#000000', S.SOLID_MEDIUM);
  sh.getRange(16, 1, 1, QUAL_COLS).setBorder(true, null, true, null, null, null, '#000000', S.SOLID_MEDIUM);
  sh.getRange(17, 1, 11, QUAL_COLS).setBorder(true, true, true, true, null, true, '#000000', S.SOLID_MEDIUM);
  sh.getRange(17, 1, 11, 1).setBorder(null, null, null, true, null, null, '#000000', S.SOLID_MEDIUM);

  // merges (as in the xlsx)
  sh.getRange(3, 2, 1, 2).merge();   // B3:C3
  sh.getRange(3, 4, 1, 2).merge();   // D3:E3
  [12, 13, 14, 15].forEach(function (r) { sh.getRange(r, 3, 1, 8).merge(); });   // C..J slots
  [17, 18, 21, 22, 23, 26, 27].forEach(function (r) { sh.getRange(r, 2, 1, 9).merge(); });
  sh.getRange(19, 2, 2, 9).merge();  // B19:J20
  sh.getRange(19, 1, 2, 1).merge();  // A19:A20 (M21 / M22 share the note)

  // sizes
  QUAL_COL_PX.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  QUAL_ROW_PX.forEach(function (h, i) { sh.setRowHeight(i + 1, h); });
  sh.getRange(1, 12).setValue('更新 ' + data.today).setFontSize(8).setFontColor('#9aa0a6');
  sh.setFrozenRows(0);
  props.setProperty(QUAL_LAYOUT_KEY, stamp);
  SpreadsheetApp.flush();
  return { sheetName: QUAL_SHEET, relayout: true };
}
