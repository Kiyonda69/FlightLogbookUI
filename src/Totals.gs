/**
 * Totals.gs — JCAB-style totals.
 *
 * For a month M the 飛行日誌 page carries three total rows:
 *   項小計       (subtotal)      = Σ flights in M
 *   前項までの合計 (carried)      = carry_forward (Settings) + Σ flights before M
 *   合計         (grand total)   = carried + subtotal
 * All values: takeoffs/landings = counts, everything else = minutes.
 */

function zeroTotals_() {
  var t = {};
  TOTAL_KEYS.forEach(function (k) { t[k] = 0; });
  return t;
}

function addTotals_(acc, f) {
  TOTAL_KEYS.forEach(function (k) { acc[k] += Number(f[k]) || 0; });
  return acc;
}

function sumTotals_(a, b) {
  var t = {};
  TOTAL_KEYS.forEach(function (k) { t[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0); });
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
