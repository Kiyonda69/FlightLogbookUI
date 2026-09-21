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

// --- report (month)
var rep = ctx.apiGenerateReport('2024-10');
check('report sheet name', rep.sheetName, '飛行日誌_2024-10');
var sh = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2024-10');
var rows = sh.rows;
check('report title', rows[0][0], '2024年10月');
check('report header row 1', rows[1][0] + '|' + rows[1][11], '月日|機長・単独・副機長または機長見習業務の時間');
check('report first flight date "10.x" text', /^10\.\d{2}$/.test(rows[3][0]) && typeof rows[3][0] === 'string', true);
check('report clocks stay text', typeof rows[3][5] === 'string' && /^\d{2}:\d{2}$/.test(rows[3][5]), true);
var totalRow = rows.filter(function (r) { return r[7] === '合  計'; })[0];
check('report 合計 block (days)', Math.round(totalRow[10] * 1440), expected.block);
check('report 合計 takeoffs', totalRow[8], expected.takeoffs);
// the "5.30 → 5.3" regression: 2024-05-30 must stay the text "5.30"
var may = ctx.apiGenerateReport('2024-05');
var mayRows = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2024-05').rows;
var d30 = mayRows.filter(function (r) { return r[0] === '5.30'; });
check('2024-05-30 written as text "5.30"', d30.length > 0, true);
check('no numeric 5.3 in 月日 column', mayRows.some(function (r) { return r[0] === 5.3; }), false);
check('empty month block still padded', ctx.apiGenerateReport('2020-02').count >= 0 && ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2020-02').rows.length >= 3 + 15 + 3, true);

// --- report (year, 12 blocks like the Numbers year sheet)
var yr = ctx.apiGenerateYearReport('2024');
check('year report sheet name', yr.sheetName, '飛行日誌_2024');
check('year report leg count', yr.count, 68);
var yrows = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2024').rows;
var titles = yrows.map(function (r) { return r[0]; }).filter(function (v) { return /^2024年\d{1,2}月$/.test(String(v)); });
check('year report has 12 month titles', titles, ['2024年1月', '2024年2月', '2024年3月', '2024年4月', '2024年5月', '2024年6月', '2024年7月', '2024年8月', '2024年9月', '2024年10月', '2024年11月', '2024年12月']);
var grand = yrows.filter(function (r) { return r[7] === '合  計'; });
check('year report has 12 合計 rows', grand.length, 12);
check('year report last 合計 == cumulative', Math.round(grand[11][10] * 1440), expected.block);
check('year report Dec 前項までの合計 == Oct 合計 (no Nov/Dec flights)', Math.round(yrows.filter(function (r) { return r[7] === '前項までの合計'; })[11][10] * 1440), expected.block);
check('year report 5.30 text', yrows.some(function (r) { return r[0] === '5.30'; }), true);
var badYear = null; try { ctx.apiGenerateYearReport('24'); } catch (e) { badYear = e.message; }
check('year report rejects bad year', /年の指定/.test(badYear || ''), true);
check('apiListReports includes year sheet', ctx.apiListReports().indexOf('飛行日誌_2024') >= 0, true);

// --- year summary / recency
var ys = ctx.apiYearSummary('2018');
check('2018 legs', ys.months.reduce(function (a, x) { return a + x.count; }, 0), 173);
check('recency shape', typeof ctx.apiRecency(90).count, 'number');

// --- carry-forward import entry points runnable without arguments
var carryJson = fs.readFileSync(path.join(root, 'data/carry_forward.json'), 'utf8');
ctx.apiSaveSettings({ carry_forward: { block: 0, takeoffs: 0 } });
check('carry zeroed', ctx.apiBootstrap().cumulative.block, expected.block - carry.block);
var drvErr = null; try { ctx.importCarryForwardFromDrive(); } catch (e) { drvErr = e.message; }
check('drive import: missing file error', /carry_forward\.json がありません/.test(drvErr || ''), true);
ctx.__mockDriveFiles['carry_forward.json'] = carryJson;
check('drive import restores carry', ctx.importCarryForwardFromDrive().block, carry.block);
check('cumulative restored via drive import', ctx.apiBootstrap().cumulative, expected);
ctx.apiSaveSettings({ carry_forward: { block: 0 } });
ctx.__mockPromptText = null; ctx.importCarryForwardPrompt();
check('prompt cancel leaves carry untouched', ctx.getSettings_().carry_forward.block, 0);
ctx.__mockPromptText = carryJson; ctx.importCarryForwardPrompt();
check('prompt import restores carry', ctx.getSettings_().carry_forward.block, carry.block);
check('prompt import shows alert', ctx.__mockAlerts.length, 1);
var badErr = null; try { ctx.apiImportCarryForward('{"blok": 1}'); } catch (e) { badErr = e.message; }
check('unknown key rejected', /不明なキー: blok/.test(badErr || ''), true);
var badJson = null; try { ctx.apiImportCarryForward('nope'); } catch (e) { badJson = e.message; }
check('invalid json rejected', /JSON を解釈できません/.test(badJson || ''), true);
check('cumulative still correct', ctx.apiBootstrap().cumulative, expected);

// --- JSON API (doPost) used by the GitHub Pages front-end
function post(obj) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent()); }
check('doPost without password configured', /API_PASSWORD が未設定/.test(post({ fn: 'apiPing' }).error), true);
var shortErr = null; try { ctx.setApiPassword_('abc'); } catch (e) { shortErr = e.message; }
check('password shorter than 4 rejected', /4 文字以上/.test(shortErr || ''), true);
ctx.__mockPromptText = ' hikouki2026 '; ctx.setApiPasswordPrompt();
check('password set via menu prompt (trimmed)', ctx.PropertiesService.getScriptProperties().getProperty('API_PASSWORD'), 'hikouki2026');
var pw = 'hikouki2026';
check('doPost wrong password rejected', /パスワードが一致しません/.test(post({ password: 'x', fn: 'apiPing' }).error), true);
check('doPost missing password rejected', post({ fn: 'apiPing' }).ok, false);
check('doPost ping ok', post({ password: pw, fn: 'apiPing' }).ok, true);
check('doPost password with surrounding spaces ok', post({ password: ' ' + pw + ' ', fn: 'apiPing' }).ok, true);
check('doPost non-api function blocked', post({ password: pw, fn: 'setupSpreadsheet' }).ok, false);
check('doPost private function blocked', post({ password: pw, fn: 'readAllFlights_' }).ok, false);
check('doPost checkPassword_ not callable', post({ password: pw, fn: 'checkPassword_' }).ok, false);
check('doPost apiGetMonth args', post({ password: pw, fn: 'apiGetMonth', args: ['2024-10'] }).result.flights.length, 7);
check('doPost error surfaces message', /月の指定/.test(post({ password: pw, fn: 'apiGetMonth', args: ['bad'] }).error), true);
check('doPost bad JSON body', JSON.parse(ctx.doPost({ postData: { contents: '{not json' } }).getContent()).ok, false);
// lockout after AUTH_MAX_FAILURES consecutive failures; success resets the counter
for (var i = 0; i < ctx.AUTH_MAX_FAILURES; i++) post({ password: 'wrong' + i, fn: 'apiPing' });
check('locked after max failures (even with right password)', /ロックされています/.test(post({ password: pw, fn: 'apiPing' }).error), true);
ctx.resetAuthLock();
check('resetAuthLock unlocks', post({ password: pw, fn: 'apiPing' }).ok, true);
for (var j = 0; j < ctx.AUTH_MAX_FAILURES - 1; j++) post({ password: 'wrong', fn: 'apiPing' });
check('success before lock resets counter', post({ password: pw, fn: 'apiPing' }).ok, true);
check('counter reset: one more failure does not lock', /パスワードが一致しません/.test(post({ password: 'wrong', fn: 'apiPing' }).error), true);
check('still usable', post({ password: pw, fn: 'apiPing' }).ok, true);

console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL PASSED');
process.exit(failures ? 1 : 0);
