/**
 * Schema.gs — sheet names, column definitions, and one-time setup.
 *
 * All durations are stored as INTEGER MINUTES in the Flights sheet.
 * They are rendered as H:MM only in the UI and in generated report sheets.
 */

var SHEET_FLIGHTS = 'Flights';
var SHEET_AIRCRAFT = 'Aircraft';
var SHEET_AIRPORTS = 'Airports';
var SHEET_SETTINGS = 'Settings';
var REPORT_PREFIX = '飛行日誌_'; // e.g. 飛行日誌_2024-10

/**
 * Flights sheet columns, in order. `kind` drives parsing/validation:
 *  text | date | time | int | min (duration minutes) | meta
 */
var FLIGHT_COLUMNS = [
  { key: 'id',              kind: 'meta', label: 'ID' },
  { key: 'date',            kind: 'date', label: '月日' },
  { key: 'aircraft_type',   kind: 'text', label: '航空機の型式' },
  { key: 'registration',    kind: 'text', label: '登録記号' },
  { key: 'dep',             kind: 'text', label: '出発地' },
  { key: 'arr',             kind: 'text', label: '到着地' },
  { key: 'dep_time',        kind: 'time', label: '出発時刻' },
  { key: 'arr_time',        kind: 'time', label: '到着時刻' },
  { key: 'flight_no',       kind: 'text', label: '飛行内容' },
  { key: 'takeoffs',        kind: 'int',  label: '離陸' },
  { key: 'landings',        kind: 'int',  label: '着陸' },
  { key: 'block',           kind: 'min',  label: '飛行時間' },
  { key: 'pic',             kind: 'min',  label: '機長 (PIC)' },
  { key: 'solo_sic',        kind: 'min',  label: '単独・副機長 (SOLO or SIC)' },
  { key: 'pus',             kind: 'min',  label: '機長見習業務 (PUS)' },
  { key: 'pic_xc',          kind: 'min',  label: '野外飛行 (機長)' },
  { key: 'pic_night',       kind: 'min',  label: '夜間飛行 (機長)' },
  { key: 'sic',             kind: 'min',  label: '副操縦士' },
  { key: 'dual',            kind: 'min',  label: '同乗教育' },
  { key: 'sic_xc',          kind: 'min',  label: '野外飛行 (副操縦士)' },
  { key: 'sic_night',       kind: 'min',  label: '夜間飛行 (副操縦士)' },
  { key: 'hood',            kind: 'min',  label: 'フード' },
  { key: 'ifr',             kind: 'min',  label: '計器飛行' },
  { key: 'sim',             kind: 'min',  label: '模擬飛行装置' },
  { key: 'ftd',             kind: 'min',  label: '飛行訓練装置' },
  { key: 'instructor',      kind: 'min',  label: '操縦教員' },
  { key: 'flight_engineer', kind: 'min',  label: '航空機関士' },
  { key: 'other',           kind: 'min',  label: 'その他の飛行時間' },
  { key: 'remarks',         kind: 'text', label: '自由欄' },
  { key: 'source',          kind: 'meta', label: 'Source' },
  { key: 'created_at',      kind: 'meta', label: 'Created' },
  { key: 'updated_at',      kind: 'meta', label: 'Updated' }
];

/** Keys that are summed for 項小計 / 前項までの合計 / 合計. Order = report column order. */
var TOTAL_KEYS = [
  'takeoffs', 'landings', 'block',
  'pic', 'solo_sic', 'pus', 'pic_xc', 'pic_night',
  'sic', 'dual', 'sic_xc', 'sic_night',
  'hood', 'ifr', 'sim', 'ftd', 'instructor', 'flight_engineer', 'other'
];

/** JCAB 飛行日誌 two-row header used by the report sheet (29 columns, A..AC). */
var REPORT_HEADER_TOP = [
  '月日', '航空機の型式', '登録記号', '出発地', '到着地', '出発時刻', '到着時刻', '飛行内容',
  '離着陸回数', '', '飛行時間',
  '機長・単独・副機長または機長見習業務の時間', '', '', '', '',
  '副操縦士または教官同乗教育の時間', '', '', '',
  '計器飛行時間', '',
  '模擬飛行装置', '飛行訓練装置', '操縦教員', '航空機関士', 'その他の飛行時間', '自由欄', ''
];
var REPORT_HEADER_BOTTOM = [
  '', '', '', '', '', '', '', '',
  '離陸', '着陸', '',
  '機長 (PIC)', '単独・副機長 (SOLO or SIC)', '機長見習業務 (PUS)', '野外飛行', '夜間飛行',
  '副操縦士', '同乗教育', '野外飛行', '夜間飛行',
  'フード', '計器飛行',
  '', '', '', '', '', '', ''
];
/** Flight-record keys in report column order (A..AB). AC (自由欄 2nd col) stays blank. */
var REPORT_KEYS = [
  'date', 'aircraft_type', 'registration', 'dep', 'arr', 'dep_time', 'arr_time', 'flight_no',
  'takeoffs', 'landings', 'block',
  'pic', 'solo_sic', 'pus', 'pic_xc', 'pic_night',
  'sic', 'dual', 'sic_xc', 'sic_night',
  'hood', 'ifr', 'sim', 'ftd', 'instructor', 'flight_engineer', 'other', 'remarks'
];

var SETTINGS_DEFAULTS = {
  pilot_name: '',
  licence_no: '',
  time_basis: 'UTC',
  default_aircraft_type: 'B77W',
  default_takeoffs: 1,
  default_landings: 1
};

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function colIndex_(key) {
  for (var i = 0; i < FLIGHT_COLUMNS.length; i++) if (FLIGHT_COLUMNS[i].key === key) return i;
  throw new Error('Unknown column: ' + key);
}

function labelOf_(key) { return FLIGHT_COLUMNS[colIndex_(key)].label; }

function getOrCreateSheet_(name) {
  var ss = ss_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/**
 * Create all sheets with headers, formats and validation. Safe to re-run:
 * existing data is never deleted, only missing sheets/headers are added.
 * Run this once from the Apps Script editor (or the 飛行日誌 menu) after creating the project.
 */
function setupSpreadsheet() {
  var ss = ss_();

  // Flights
  var f = getOrCreateSheet_(SHEET_FLIGHTS);
  if (f.getLastRow() === 0) {
    f.appendRow(FLIGHT_COLUMNS.map(function (c) { return c.key; }));
    f.setFrozenRows(1);
    f.getRange(1, 1, 1, FLIGHT_COLUMNS.length).setFontWeight('bold').setBackground('#e8eaed');
    // Keep dates / clocks as plain text so Sheets never re-interprets them.
    f.getRange(2, colIndex_('date') + 1, f.getMaxRows() - 1, 1).setNumberFormat('@');
    f.getRange(2, colIndex_('dep_time') + 1, f.getMaxRows() - 1, 2).setNumberFormat('@');
  }

  // Aircraft master
  var a = getOrCreateSheet_(SHEET_AIRCRAFT);
  if (a.getLastRow() === 0) {
    a.appendRow(['aircraft_type', 'registration', 'note']);
    a.setFrozenRows(1);
    a.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eaed');
  }

  // Airports master
  var p = getOrCreateSheet_(SHEET_AIRPORTS);
  if (p.getLastRow() === 0) {
    p.appendRow(['icao', 'iata', 'name', 'note']);
    p.setFrozenRows(1);
    p.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e8eaed');
  }

  // Settings (key / value). carry_forward_<key> rows hold pre-system totals.
  var s = getOrCreateSheet_(SHEET_SETTINGS);
  if (s.getLastRow() === 0) {
    s.appendRow(['key', 'value', 'description']);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eaed');
    Object.keys(SETTINGS_DEFAULTS).forEach(function (k) {
      s.appendRow([k, SETTINGS_DEFAULTS[k], '']);
    });
    TOTAL_KEYS.forEach(function (k) {
      var unit = (k === 'takeoffs' || k === 'landings') ? '回' : '分';
      s.appendRow(['carry_forward_' + k, 0, 'システム導入前の累計 ' + labelOf_(k) + ' (' + unit + ')']);
    });
  }

  // Remove the default empty sheet if it is still there and untouched.
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  return 'OK';
}

/** Adds a custom menu when the spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('飛行日誌')
    .addItem('初期セットアップ', 'setupSpreadsheet')
    .addItem('今月の帳票を生成', 'generateCurrentMonthReport')
    .addItem('マスター再構築 (Flights から)', 'rebuildMastersFromFlights')
    .addToUi();
}
