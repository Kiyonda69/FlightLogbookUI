/**
 * Totals.gs — JCAB-style totals.
 *
 * For a month M the 飛行日誌 page carries three total rows:
 *   項小計       (subtotal)      = Σ flights in M
 *   前項までの合計 (carried)      = carry_forward (Settings) + Σ flights before M
 *   合計         (grand total)   = carried + subtotal
 * All values: takeoffs/landings = counts, everything else = minutes.
 * Totals objects also carry sim_takeoffs / sim_landings (SIM_COUNT_KEYS), summed on their own:
 * simulator counts are never added into takeoffs / landings and have no carry-forward.
 */

// built on first use: Apps Script does not guarantee that Schema.gs is evaluated before this file
var summedKeysCache_ = null;
function summedKeys_() { return summedKeysCache_ || (summedKeysCache_ = TOTAL_KEYS.concat(SIM_COUNT_KEYS)); }

function zeroTotals_() {
  var t = {};
  summedKeys_().forEach(function (k) { t[k] = 0; });
  return t;
}

function addTotals_(acc, f) {
  summedKeys_().forEach(function (k) { acc[k] += Number(f[k]) || 0; });
  return acc;
}

function sumTotals_(a, b) {
  var t = {};
  summedKeys_().forEach(function (k) { t[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0); });
  return t;
}

/** Cumulative totals up to and including `untilDate` ("yyyy-mm-dd") or all if null. */
function computeCumulative_(flights, untilDate) {
  var acc = zeroTotals_();
  var carry = getSettings_().carry_forward;
  TOTAL_KEYS.forEach(function (k) { acc[k] = Number(carry[k]) || 0; });
  flights.forEach(function (f) {
    if (untilDate && f.date > untilDate) return;
    addTotals_(acc, f);
  });
  return acc;
}

/** { subtotal, carried, total, count } for month "YYYY-MM". */
function computeMonthTotals_(allFlights, ym) {
  var carried = zeroTotals_();
  var carry = getSettings_().carry_forward;
  TOTAL_KEYS.forEach(function (k) { carried[k] = Number(carry[k]) || 0; });
  var subtotal = zeroTotals_();
  var count = 0;
  allFlights.forEach(function (f) {
    var fym = f.date.substring(0, 7);
    if (fym < ym) addTotals_(carried, f);
    else if (fym === ym) { addTotals_(subtotal, f); count++; }
  });
  return { subtotal: subtotal, carried: carried, total: sumTotals_(carried, subtotal), count: count };
}

/** Year summary used by the 集計 tab: per-month block/PIC/SIC/night/IFR + per-type hours. */
function apiYearSummary(year) {
  year = String(year);
  if (!/^\d{4}$/.test(year)) throw new Error('年の指定が不正です');
  var all = sortFlights_(readAllFlights_());
  var months = [];
  for (var m = 1; m <= 12; m++) {
    var ym = year + '-' + pad2_(m);
    var t = zeroTotals_(), n = 0;
    all.forEach(function (f) { if (f.date.substring(0, 7) === ym) { addTotals_(t, f); n++; } });
    t.ym = ym; t.count = n;
    months.push(t);
  }
  var yearTotal = zeroTotals_();
  months.forEach(function (t) { addTotals_(yearTotal, t); });
  var byType = {};
  all.forEach(function (f) {
    if (f.date.substring(0, 4) !== year) return;
    if (!byType[f.aircraft_type]) byType[f.aircraft_type] = { block: 0, legs: 0 };
    byType[f.aircraft_type].block += f.block; byType[f.aircraft_type].legs++;
  });
  var years = {};
  all.forEach(function (f) { years[f.date.substring(0, 4)] = true; });
  return { year: year, months: months, yearTotal: yearTotal, byType: byType, years: Object.keys(years).sort() };
}

/* ---------- 資格要件 (qualification) ---------- */

function addMonths_(dateStr, n) {
  var p = dateStr.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1 + n, 1);
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1);
}
function daysBetween_(a, b) { // b - a in days, both "yyyy-mm-dd"
  var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/**
 * Qualification status derived from the logbook (+ expiry dates in Settings):
 *  - last flight date / days since (復帰訓練 if >= QUAL_RETRAIN_DAYS)
 *  - takeoffs & landings in the last QUAL_RECENCY_DAYS days
 *  - last date of each recurrent training code (M11/M12/M21/M22 in 飛行内容) and the next window
 *  - tracked expiries with days remaining
 * `today` (optional "yyyy-mm-dd") makes the result testable.
 */
function apiQualification(today) {
  today = today ? parseDateStr_(today) : parseDateStr_(new Date());
  var all = sortFlights_(readAllFlights_());
  var settings = getSettings_();
  var out = { today: today, items: [] };

  // last actual flight (block > 0 or a landing) — simulator sessions don't count
  var last = null;
  all.forEach(function (f) { if ((f.block > 0 || f.landings > 0) && f.date <= today && (!last || f.date > last)) last = f.date; });
  var since = last ? daysBetween_(last, today) : null;
  out.lastFlight = { date: last, days: since, limit: QUAL_RETRAIN_DAYS,
    status: since === null ? 'unknown' : (since >= QUAL_RETRAIN_DAYS ? 'over' : (since >= QUAL_RETRAIN_DAYS - 14 ? 'warn' : 'ok')) };

  // 90-day recency
  var cut = new Date(); cut.setTime(Date.parse(today + 'T00:00:00Z') - QUAL_RECENCY_DAYS * 86400000);
  var cutStr = cut.getUTCFullYear() + '-' + pad2_(cut.getUTCMonth() + 1) + '-' + pad2_(cut.getUTCDate());
  var to = 0, ld = 0;
  all.forEach(function (f) { if (f.date > cutStr && f.date <= today) { to += f.takeoffs; ld += f.landings; } });
  out.recency = { days: QUAL_RECENCY_DAYS, since: cutStr, takeoffs: to, landings: ld, required: QUAL_RECENCY_LANDINGS,
    status: ld >= QUAL_RECENCY_LANDINGS && to >= QUAL_RECENCY_LANDINGS ? 'ok' : 'over' };

  // recurrent training codes
  var tm = today.substring(0, 7);
  out.training = QUAL_TRAINING.map(function (t) {
    var lastDate = null;
    all.forEach(function (f) { if (f.flight_no.toUpperCase().indexOf(t.code) === 0 && (!lastDate || f.date > lastDate)) lastDate = f.date; });
    if (!lastDate) return { code: t.code, label: t.label, last: null, status: 'unknown' };
    var base = addMonths_(lastDate, t.months);              // next base month
    var from = addMonths_(base + '-01', -QUAL_WINDOW_MONTHS), until = addMonths_(base + '-01', QUAL_WINDOW_MONTHS);
    var status = tm > until ? 'over' : (tm >= from ? 'due' : 'ok');
    return { code: t.code, label: t.label, last: lastDate, baseMonth: base, windowFrom: from, windowUntil: until, status: status };
  });

  // QPR flights (leg flag) = ROUTE CHK entries — this fiscal year (April-March) and the latest one
  var fy = fyOf_(today);
  var qprAll = all.filter(function (f) { return f.qpr === '1' && f.date <= today; });
  var qprFy = qprAll.filter(function (f) { return fyOf_(f.date) === fy; });
  var qprPick = function (f) { return { date: f.date, flight_no: f.flight_no, dep: f.dep, arr: f.arr }; };
  out.qpr = { fy: fy, count: qprFy.length, flights: qprFy.map(qprPick), last: qprAll.length ? qprPick(qprAll[qprAll.length - 1]) : null,
    status: qprFy.length ? 'ok' : 'warn' };

  // expiries from settings (list fields: the LATEST date is the one in force)
  out.expiries = QUAL_EXPIRIES.map(function (e) {
    var v = String(settings[e.key] || '').trim();
    if (!v) return { key: e.key, label: e.label, date: '', status: 'unknown' };
    var list = dateList_(v);
    if (!list.length) return { key: e.key, label: e.label, date: v, status: 'invalid' };
    var d = list[list.length - 1];
    var left = daysBetween_(today, d);
    return { key: e.key, label: e.label, date: d, daysLeft: left, warnDays: e.warnDays,
      status: left < 0 ? 'over' : (left <= e.warnDays ? 'warn' : 'ok') };
  });
  return out;
}

/**
 * Recency check used by the UI header: hours/landings in the trailing N days.
 * (e.g. 90-day landings for passenger-carrying currency).
 */
function apiRecency(days) {
  days = Number(days) || 90;
  var all = readAllFlights_();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  var cut = parseDateStr_(cutoff);
  var t = zeroTotals_(), n = 0;
  all.forEach(function (f) { if (f.date >= cut) { addTotals_(t, f); n++; } });
  t.count = n; t.since = cut; t.days = days;
  return t;
}
