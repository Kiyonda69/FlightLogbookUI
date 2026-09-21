/**
 * Validate.gs — light validation for DIRECT edits of the Flights sheet (simple trigger `onEdit`).
 *
 * The system assumes legs are entered through the UI; editing Flights by hand is tolerated but not
 * encouraged. This trigger only DETECTS values that would break the logbook and marks the cell:
 *   red background (FLIGHT_BAD_BG) + a cell note explaining the problem.
 * It never rewrites values and never touches the year sheets / checklist (those are refreshed on the
 * next save from the UI). A cell that is edited back to a valid value gets its mark cleared.
 *
 * Simple triggers run with limited authorization: only SpreadsheetApp on this spreadsheet is used
 * here (no PropertiesService / Utilities / LockService), and the work is capped at 200 rows.
 */

var FLIGHT_BAD_BG = '#f4c7c3';
var FLIGHT_EDIT_MAX_ROWS = 200;

function onEdit(e) {
  try {
    var range = e && e.range;
    if (!range) return;
    var sh = range.getSheet();
    if (sh.getName() !== SHEET_FLIGHTS) return;
    var r0 = range.getRow(), c0 = range.getColumn(), nr = range.getNumRows(), nc = range.getNumColumns();
    var startRow = Math.max(r0, 2);                       // never touch the header row
    var rows = Math.min(nr - (startRow - r0), FLIGHT_EDIT_MAX_ROWS);
    var cols = Math.min(nc, FLIGHT_COLUMNS.length - c0 + 1); // ignore columns beyond the schema
    if (rows < 1 || cols < 1) return;
    markFlightCells_(sh, startRow, c0, rows, cols);
  } catch (err) {
    // a validation failure must never block the user's edit
  }
}

/** Check a block of Flights cells and set/clear the red mark + note on each. Returns #problems. */
function markFlightCells_(sh, startRow, startCol, rows, cols) {
  var rng = sh.getRange(startRow, startCol, rows, cols);
  var vals = rng.getValues();
  var ids = sh.getRange(startRow, colIndex_('id') + 1, rows, 1).getValues();
  var dates = sh.getRange(startRow, colIndex_('date') + 1, rows, 1).getValues();
  var bgs = [], notes = [], bad = 0;
  for (var i = 0; i < rows; i++) {
    var bgRow = [], noteRow = [];
    var rowHasData = String(dates[i][0] || '') !== '' || String(ids[i][0] || '') !== '';
    for (var j = 0; j < cols; j++) {
      var col = FLIGHT_COLUMNS[startCol - 1 + j];
      var msg = rowHasData || vals[i][j] !== '' ? flightCellProblem_(col, vals[i][j], ids[i][0]) : '';
      if (msg) bad++;
      bgRow.push(msg ? FLIGHT_BAD_BG : null);
      noteRow.push(msg || '');
    }
    bgs.push(bgRow); notes.push(noteRow);
  }
  rng.setBackgrounds(bgs).setNotes(notes);
  return bad;
}

/** '' when the value is acceptable for the column, otherwise a short Japanese explanation. */
function flightCellProblem_(col, v, id) {
  if (!col) return '';
  var isDate = v instanceof Date, isNum = typeof v === 'number';
  var s = isDate || isNum ? '' : String(v === null || v === undefined ? '' : v).trim();
  switch (col.kind) {
    case 'meta':
      return '';
    case 'date':
      if (isDate) return '日付が Date 型に変換されています。セルをテキスト形式にして YYYY-MM-DD で入力してください';
      if (isNum) return '日付は YYYY-MM-DD の文字列で入力してください';
      if (!s) return id ? '月日が空です' : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '日付は YYYY-MM-DD 形式で入力してください: ' + s;
      if (isNaN(Date.parse(s + 'T00:00:00Z'))) return '存在しない日付です: ' + s;
      return '';
    case 'time':
      if (isDate || isNum) return '時刻が時刻型に変換されています。セルをテキスト形式にして HH:MM で入力してください';
      if (!s) return '';
      var m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return '時刻は HH:MM で入力してください: ' + s;
      if (Number(m[1]) > 23 || Number(m[2]) > 59) return '時刻の値が不正です: ' + s;
      return '';
    case 'int':
      if (isDate) return '回数に時刻が入っています';
      if (isNum) return v >= 0 && v === Math.floor(v) ? '' : '回数は 0 以上の整数で入力してください: ' + v;
      if (!s) return '';
      return /^\d+$/.test(s) ? '' : '回数は 0 以上の整数で入力してください: ' + s;
    case 'min':
      if (isDate) return '時間が時刻型に変換されています。分の整数（例 1:30 → 90）で入力してください';
      if (isNum) {
        if (v > 0 && v < 1) return '時間が「時刻」として保存されています（' + v + '）。分の整数（例 1:30 → 90）で入力してください';
        return v >= 0 && v === Math.floor(v) ? '' : '時間は分の整数で入力してください: ' + v;
      }
      if (!s) return '';
      if (/^\d+$/.test(s)) return '';
      if (/^\d+:\d{2}$/.test(s)) return '時間は H:MM ではなく分の整数で入力してください（' + s + ' → ' + parseMinutes_(s) + '）';
      return '時間は分の整数で入力してください: ' + s;
    default: // text
      if (isDate) return 'テキストが時刻/日付型に変換されています。セルをテキスト形式にして入力し直してください';
      if (isNum && col.key !== 'remarks' && col.key !== 'flight_no' && col.key !== 'qpr') return 'テキストが数値に変換されています: ' + v;
      if (isNum && v > 0 && v < 1) return 'テキストが時刻に変換されています（' + v + '）。セルをテキスト形式にして入力し直してください';
      if (col.key === 'dep' || col.key === 'arr') return !s || /^[A-Z0-9]{4}$/.test(s) ? '' : 'ICAO 4 文字（大文字）で入力してください: ' + s;
      if (col.key === 'crew') return !s || /^([NMD]\d+\/\d+|SPLIT|SIM)$/.test(s) ? '' : '編成コードは M2/0, SPLIT, SIM のいずれかです: ' + s;
      if (col.key === 'qpr') return s === '' || s === '1' || v === 1 ? '' : 'QPR は 1 か空欄です: ' + s;
      if ((col.key === 'aircraft_type' || col.key === 'registration') && s && s !== s.toUpperCase()) return '大文字で入力してください: ' + s;
      return '';
  }
}

/** Menu / manual helper: re-check the whole Flights sheet (chunks of FLIGHT_EDIT_MAX_ROWS). */
function validateFlightsSheet() {
  var sh = ss_().getSheetByName(SHEET_FLIGHTS);
  if (!sh) throw new Error('Flights シートがありません');
  var last = sh.getLastRow(), bad = 0;
  for (var r = 2; r <= last; r += FLIGHT_EDIT_MAX_ROWS) {
    bad += markFlightCells_(sh, r, 1, Math.min(FLIGHT_EDIT_MAX_ROWS, last - r + 1), FLIGHT_COLUMNS.length);
  }
  var msg = 'Flights シートを検査しました: 問題のあるセル ' + bad + ' 件（赤色 + メモ）';
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg); } catch (e) {}
  return msg;
}
