/** Util.gs — parsing / formatting helpers shared by server code. */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** "H:MM" | "HH:MM:SS" | number(minutes) | "" -> integer minutes. */
function parseMinutes_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  var s = String(v).trim();
  if (s === '') return 0;
  var m = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  throw new Error('時間の形式が不正です (H:MM で入力): ' + s);
}

/** integer minutes -> "H:MM" ("" for 0 when blankZero). */
function fmtMinutes_(min, blankZero) {
  min = Number(min) || 0;
  if (!min && blankZero) return '';
  var sign = min < 0 ? '-' : '';
  min = Math.abs(min);
  return sign + Math.floor(min / 60) + ':' + pad2_(min % 60);
}

/** "HH:MM" | Date | "" -> "HH:MM" text (or ""). */
function parseClock_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) throw new Error('時刻の形式が不正です (HH:MM): ' + s);
  var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) throw new Error('時刻の値が不正です: ' + s);
  return pad2_(h) + ':' + pad2_(mi);
}

/** Date | "yyyy-mm-dd" -> "yyyy-mm-dd" */
function parseDateStr_(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) throw new Error('日付の形式が不正です (YYYY-MM-DD): ' + s);
  return m[1] + '-' + pad2_(parseInt(m[2], 10)) + '-' + pad2_(parseInt(m[3], 10));
}

/** Block time from two "HH:MM" clocks, wrapping past midnight (same as the Numbers formula G+(F>G)-F). */
function blockMinutes_(depTime, arrTime) {
  if (!depTime || !arrTime) return 0;
  var d = parseMinutes_(depTime), a = parseMinutes_(arrTime);
  return a >= d ? a - d : a + 24 * 60 - d;
}

function nowIso_() { return new Date().toISOString(); }

/**
 * Text cell -> string. Defensive: if Sheets has auto-converted a text like "1:30" into a
 * time (Date) or a day fraction (0.0625), turn it back into "H:MM".
 */
function cellText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
  if (typeof v === 'number' && v > 0 && v < 1) return fmtMinutes_(Math.round(v * 1440));
  return String(v);
}

/** Convert a sheet row (array) to a flight object with normalized types. */
function rowToFlight_(row) {
  var o = {};
  FLIGHT_COLUMNS.forEach(function (c, i) {
    var v = row[i];
    switch (c.kind) {
      case 'date': o[c.key] = v ? parseDateStr_(v) : ''; break;
      case 'time': o[c.key] = v ? parseClock_(v) : ''; break;
      case 'int':  o[c.key] = Number(v) || 0; break;
      case 'min':  o[c.key] = parseMinutes_(v); break;
      default:     o[c.key] = cellText_(v);
    }
  });
  return o;
}

/** Convert a flight object to a sheet row (array in FLIGHT_COLUMNS order). */
function flightToRow_(f) {
  return FLIGHT_COLUMNS.map(function (c) {
    var v = f[c.key];
    switch (c.kind) {
      case 'int':  return Number(v) || 0;
      case 'min':  return parseMinutes_(v);
      case 'date': return v ? parseDateStr_(v) : '';
      case 'time': return v ? parseClock_(v) : '';
      default:     return v === null || v === undefined ? '' : String(v);
    }
  });
}

/** Validate + normalize a flight coming from the UI or CSV. Throws on error. */
function normalizeFlight_(input) {
  var f = {};
  FLIGHT_COLUMNS.forEach(function (c) { f[c.key] = input[c.key]; });
  f.date = parseDateStr_(f.date);
  f.aircraft_type = String(f.aircraft_type || '').trim().toUpperCase();
  f.registration = String(f.registration || '').trim().toUpperCase();
  f.dep = String(f.dep || '').trim().toUpperCase();
  f.arr = String(f.arr || '').trim().toUpperCase();
  f.flight_no = String(f.flight_no || '').trim();
  f.remarks = String(f.remarks || '').trim();
  f.dep_time = parseClock_(f.dep_time);
  f.arr_time = parseClock_(f.arr_time);
  f.takeoffs = Number(f.takeoffs) || 0;
  f.landings = Number(f.landings) || 0;
  TOTAL_KEYS.forEach(function (k) { if (k !== 'takeoffs' && k !== 'landings') f[k] = parseMinutes_(f[k]); });
  var isDevice = (f.sim > 0 || f.ftd > 0) && !f.block; // simulator / FTD session, not a flight
  if (!f.aircraft_type) throw new Error('航空機の型式は必須です');
  if (!f.registration && !isDevice) throw new Error('登録記号は必須です (SIM/FTD の場合は模擬飛行装置/飛行訓練装置の時間を入力)');
  if (!f.dep || !f.arr) throw new Error('出発地・到着地は必須です');
  // Block defaults from clocks when not given explicitly (not for sim/FTD sessions).
  if (!f.block && f.dep_time && f.arr_time && !isDevice) f.block = blockMinutes_(f.dep_time, f.arr_time);
  // Sanity: role / condition hours cannot exceed block time.
  ['pic', 'solo_sic', 'pus', 'sic', 'dual', 'pic_xc', 'pic_night', 'sic_xc', 'sic_night', 'ifr', 'hood']
    .forEach(function (k) {
      if (f.block && f[k] > f.block) throw new Error(labelOf_(k) + ' が飛行時間を超えています');
    });
  return f;
}
