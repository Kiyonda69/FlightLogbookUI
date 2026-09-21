#!/usr/bin/env node
/**
 * test_logic.js — runs the real src/*.gs server code on top of dev/mock_gas.js,
 * imports data/flights.csv + data/carry_forward.json and checks that the JCAB totals
 * reproduce the figures recorded in the legacy Numbers file (2024/10 合計 row).
 *
 *   node tools/test_logic.js
 */
var fs = require('fs'), path = require('path'), vm = require('vm');
var root = path.join(__dirname, '..');
var ctx = vm.createContext({ console: console, Math: Math, Date: Date, JSON: JSON, Error: Error, String: String, Number: Number, Array: Array, Object: Object, RegExp: RegExp, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN });
function load(file) { vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file }); }
load('dev/mock_gas.js');
['Schema.gs', 'Util.gs', 'Api.gs', 'Totals.gs', 'Report.gs', 'Import.gs', 'Code.gs'].forEach(function (f) { load('src/' + f); });

var failures = 0;
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected)));
}

// --- unit: helpers
check('parseMinutes "1:10"', ctx.parseMinutes_('1:10'), 70);
check('parseMinutes "13:00:00"', ctx.parseMinutes_('13:00:00'), 780);
check('parseMinutes 90', ctx.parseMinutes_(90), 90);
check('fmtMinutes 772533', ctx.fmtMinutes_(772533), '12875:33');
check('block wraps midnight', ctx.blockMinutes_('23:38', '00:39'), 61);
check('block same day', ctx.blockMinutes_('01:31', '02:44'), 73);
check('parseDateStr', ctx.parseDateStr_('2024/6/3'), '2024-06-03');

// --- setup + import
check('setupSpreadsheet', ctx.setupSpreadsheet(), 'OK');
var carry = JSON.parse(fs.readFileSync(path.join(root, 'data/carry_forward.json'), 'utf8'));
ctx.apiImportCarryForward(JSON.stringify(carry));
var csv = fs.readFileSync(path.join(root, 'data/flights.csv'), 'utf8');
var res = ctx.apiImportCsv(csv, { source: 'test' });
check('import errors', res.errors, []);
check('import inserted 860', res.inserted, 860);
var res2 = ctx.apiImportCsv(csv, {});
check('re-import skips duplicates', [res2.inserted, res2.skipped], [0, 860]);

// --- totals vs Numbers (2024/10 合計 row, values in minutes / counts)
var expected = {
  takeoffs: 2043, landings: 2049, block: 772533, pic: 175593, solo_sic: 6965, pus: 103511,
  pic_xc: 280447, pic_night: 93530, sic: 457449, dual: 21594, sic_xc: 471807, sic_night: 180337,
  hood: 4010, ifr: 133315, sim: 31475, ftd: 0, instructor: 0, flight_engineer: 0, other: 7421
};
var m = ctx.apiGetMonth('2024-10');
check('2024-10 leg count', m.flights.length, 7);
check('2024-10 合計 matches Numbers', m.totals.total, expected);
var boot = ctx.apiBootstrap();
check('cumulative == 2024-10 合計 (no later flights)', boot.cumulative, expected);
check('months list head', boot.months.slice(0, 2), ['2024-10', '2024-09']);
check('aircraft master has 42 regs (incl. SIM1/SIM3)', boot.aircraft.length, 42);
var simNoReg = null;
try { simNoReg = ctx.apiAddFlight({ date: '2025-02-01', aircraft_type: 'B772', registration: '', dep: 'RJTT', arr: 'RJTT', flight_no: 'M11', sim: '4:00' }); } catch (e) { simNoReg = e.message; }
check('sim session without registration accepted', simNoReg && simNoReg.sim, 240);
if (simNoReg && simNoReg.id) ctx.apiDeleteFlight(simNoReg.id);

// 2017-12 subtotal must equal Numbers 項小計 of both 12月 pages combined: 25 legs
var d17 = ctx.apiGetMonth('2017-12');
check('2017-12 legs', d17.flights.length, 27);
check('2017-12 前項までの合計 takeoffs', d17.totals.carried.takeoffs, 1669);
check('2017-12 合計 block', ctx.fmtMinutes_(d17.totals.total.block), '8876:54'); // 369 days 20:54

// --- CRUD
var added = ctx.apiAddFlight({ date: '2025-01-05', aircraft_type: 'b77w', registration: 'ja742j', dep: 'rjtt', arr: 'klax',
  dep_time: '23:40', arr_time: '08:55', flight_no: 'JL62', takeoffs: 1, landings: 1, pic: '9:15', pic_xc: 555, pic_night: '4:00', ifr: '1:00' });
check('add: block auto from clocks', added.block, 555);
check('add: uppercase codes', [added.aircraft_type, added.registration, added.dep], ['B77W', 'JA742J', 'RJTT']);
var upd = ctx.apiUpdateFlight(Object.assign({}, added, { ifr: '2:00' }));
check('update ifr', upd.ifr, 120);
var thrown = null;
try { ctx.apiAddFlight({ date: '2025-01-06', aircraft_type: 'B772', registration: 'JA010D', dep: 'RJTT', arr: 'RJOO', dep_time: '01:00', arr_time: '02:00', pic: '3:00' }); } catch (e) { thrown = e.message; }
check('reject pic > block', /飛行時間を超えて/.test(thrown || ''), true);
check('delete', ctx.apiDeleteFlight(added.id), { deleted: added.id });
check('cumulative restored after delete', ctx.apiBootstrap().cumulative, expected);

// --- report
var rep = ctx.apiGenerateReport('2024-10');
check('report sheet name', rep.sheetName, '飛行日誌_2024-10');
var sh = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2024-10');
var rows = sh.rows;
check('report header row 1', rows[0][0] + '|' + rows[0][11], '月日|機長・単独・副機長または機長見習業務の時間');
check('report first flight date "10.x"', /^10\.\d+$/.test(rows[2][0]), true);
var totalRow = rows.filter(function (r) { return r[7] === '合  計'; })[0];
check('report 合計 block (days)', Math.round(totalRow[10] * 1440), expected.block);
check('report 合計 takeoffs', totalRow[8], expected.takeoffs);

// --- year summary / recency
var ys = ctx.apiYearSummary('2018');
check('2018 legs', ys.months.reduce(function (a, x) { return a + x.count; }, 0), 173);
check('recency shape', typeof ctx.apiRecency(90).count, 'number');

// --- JSON API (doPost) used by the GitHub Pages front-end
function post(obj) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent()); }
check('doPost without token configured', post({ fn: 'apiPing' }).ok, false);
var token = ctx.generateApiToken();
check('generateApiToken length', token.length, 64);
check('doPost wrong token rejected', /認証エラー/.test(post({ token: 'x', fn: 'apiPing' }).error), true);
check('doPost ping ok', post({ token: token, fn: 'apiPing' }).ok, true);
check('doPost non-api function blocked', post({ token: token, fn: 'setupSpreadsheet' }).ok, false);
check('doPost private function blocked', post({ token: token, fn: 'readAllFlights_' }).ok, false);
check('doPost apiGetMonth args', post({ token: token, fn: 'apiGetMonth', args: ['2024-10'] }).result.flights.length, 7);
check('doPost error surfaces message', /月の指定/.test(post({ token: token, fn: 'apiGetMonth', args: ['bad'] }).error), true);
check('doPost bad JSON body', JSON.parse(ctx.doPost({ postData: { contents: '{not json' } }).getContent()).ok, false);

console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL PASSED');
process.exit(failures ? 1 : 0);
