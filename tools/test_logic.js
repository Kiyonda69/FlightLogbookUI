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
try { simNoReg = ctx.apiAddFlight({ date: '2025-02-01', aircraft_type: 'B772', registration: '', dep: 'RJTT', arr: 'RJTT', flight_no: 'M11', sim: '4:00' }).flight; } catch (e) { simNoReg = e.message; }
check('sim session without registration accepted', simNoReg && simNoReg.sim, 240);
if (simNoReg && simNoReg.id) ctx.apiDeleteFlight(simNoReg.id);
ctx.__mockSpreadsheet.deleteSheet(ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2025')); // created by the probe above

// 2017-12 subtotal must equal Numbers 項小計 of both 12月 pages combined: 25 legs
var d17 = ctx.apiGetMonth('2017-12');
check('2017-12 legs', d17.flights.length, 27);
check('2017-12 前項までの合計 takeoffs', d17.totals.carried.takeoffs, 1669);
check('2017-12 合計 block', ctx.fmtMinutes_(d17.totals.total.block), '8876:54'); // 369 days 20:54

// --- year sheets are created by the import (all years present in the data)
var sheetNames = function () { return ctx.__mockSpreadsheet.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return n.indexOf('飛行日誌_') === 0; }).sort(); };
check('import created one sheet per year', sheetNames(), ['飛行日誌_2017', '飛行日誌_2018', '飛行日誌_2019', '飛行日誌_2020', '飛行日誌_2021', '飛行日誌_2022', '飛行日誌_2023', '飛行日誌_2024']);
check('import result lists refreshed sheets', res.refreshed.length, 8);
check('duplicate re-import refreshes nothing', res2.refreshed, []);

// --- CRUD (each write refreshes the year sheets from that year onward)
var addRes = ctx.apiAddFlight({ date: '2025-01-05', aircraft_type: 'b77w', registration: 'ja742j', dep: 'rjtt', arr: 'klax',
  dep_time: '23:40', arr_time: '08:55', flight_no: 'JL62', takeoffs: 1, landings: 1, pic: '9:15', pic_xc: 555, pic_night: '4:00', ifr: '1:00' });
var added = addRes.flight;
check('add: block auto from clocks', added.block, 555);
check('add: uppercase codes', [added.aircraft_type, added.registration, added.dep], ['B77W', 'JA742J', 'RJTT']);
check('add: first leg of a new year creates its sheet', addRes.refreshed, ['飛行日誌_2025']);
check('add: sheet exists', sheetNames().indexOf('飛行日誌_2025') >= 0, true);
var s25 = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2025');
check('2025 sheet: leg row with text date', s25.rows.some(function (r) { return r[0] === '1.05' && r[7] === 'JL62'; }), true);
check('2025 sheet: Jan 前項までの合計 == 2024 cumulative', Math.round(s25.rows.filter(function (r) { return r[7] === '前項までの合計'; })[0][10] * 1440), expected.block);
var updRes = ctx.apiUpdateFlight(Object.assign({}, added, { ifr: '2:00' }));
check('update ifr', updRes.flight.ifr, 120);
check('update refreshes 2025 only', updRes.refreshed, ['飛行日誌_2025']);
check('2025 sheet reflects update (Jan 項小計 ifr 2:00)', Math.round(s25.rows.filter(function (r) { return r[7] === '項 小 計'; })[0][29 - 8] * 1440), 120);
var thrown = null;
try { ctx.apiAddFlight({ date: '2025-01-06', aircraft_type: 'B772', registration: 'JA010D', dep: 'RJTT', arr: 'RJOO', dep_time: '01:00', arr_time: '02:00', pic: '3:00' }); } catch (e) { thrown = e.message; }
check('reject pic > block', /飛行時間を超えて/.test(thrown || ''), true);
// editing an old year cascades to later years (their 前項までの合計 change)
var old = ctx.apiGetMonth('2024-10').flights[0];
var oldUpd = ctx.apiUpdateFlight(Object.assign({}, old, { remarks: 'cascade test' }));
check('editing 2024 refreshes 2024 and 2025', oldUpd.refreshed, ['飛行日誌_2024', '飛行日誌_2025']);
ctx.apiUpdateFlight(Object.assign({}, old));
var delRes = ctx.apiDeleteFlight(added.id);
check('delete', delRes.deleted, added.id);
check('delete refreshes from its year', delRes.refreshed, ['飛行日誌_2025']);
check('cumulative restored after delete', ctx.apiBootstrap().cumulative, expected);
check('2025 sheet still exists after deleting its only leg (empty blocks)', sheetNames().indexOf('飛行日誌_2025') >= 0, true);

// --- year sheet content (12 blocks like the Numbers year sheet)
var yr = ctx.apiRebuildYearReport('2024');
check('year sheet name', yr.sheetName, '飛行日誌_2024');
check('year sheet leg count', yr.count, 68);
var ysheet = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2024');
var yrows = ysheet.rows;
var titles = yrows.map(function (r) { return r[0]; }).filter(function (v) { return /^2024年\d{1,2}月$/.test(String(v)); });
check('year sheet has 12 month titles', titles, ['2024年1月', '2024年2月', '2024年3月', '2024年4月', '2024年5月', '2024年6月', '2024年7月', '2024年8月', '2024年9月', '2024年10月', '2024年11月', '2024年12月']);
check('year sheet header row', yrows[1][0] + '|' + yrows[1][11], '月日|機長・単独・副機長または機長見習業務の時間');
var grand = yrows.filter(function (r) { return r[7] === '合  計'; });
check('year sheet has 12 合計 rows', grand.length, 12);
check('year sheet last 合計 == cumulative', Math.round(grand[11][10] * 1440), expected.block);
check('year sheet 合計 takeoffs', grand[11][8], expected.takeoffs);
check('year sheet Dec 前項までの合計 == Oct 合計 (no Nov/Dec flights)', Math.round(yrows.filter(function (r) { return r[7] === '前項までの合計'; })[11][10] * 1440), expected.block);
// the "5.30 → 5.3" regression: 2024-05-30 must stay the text "5.30"; clocks stay text too
check('2024-05-30 written as text "5.30"', yrows.some(function (r) { return r[0] === '5.30'; }), true);
check('no numeric 5.3 in 月日 column', yrows.some(function (r) { return r[0] === 5.3; }), false);
var legRow = yrows.filter(function (r) { return r[7] === 'JL10'; })[0];
check('clocks stay text', typeof legRow[5] === 'string' && /^\d{2}:\d{2}$/.test(legRow[5]), true);
check('empty month block padded to 15 rows', (function () { var i = yrows.findIndex(function (r) { return r[0] === '2024年11月'; }); return yrows[i + 3 + 15][7]; })(), '項 小 計');
check('header merges built', ysheet.merges.length, 12 * (8 + 1 + 1 + 1 + 1 + 1 + 5 + 1));
var mergesBefore = ysheet.merges.length;
ctx.apiRebuildYearReport('2024');
check('unchanged layout: merges not rebuilt', ysheet.merges.length, mergesBefore);
var badYear = null; try { ctx.apiRebuildYearReport('24'); } catch (e) { badYear = e.message; }
check('rebuild rejects bad year', /年の指定/.test(badYear || ''), true);
check('apiListReports newest first', ctx.apiListReports()[0], '飛行日誌_2025');
// a month with more than 15 legs grows the block (2018-02 has 24 legs, so layout differs from padding)
var s18 = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2018');
var febIdx = s18.rows.findIndex(function (r) { return r[0] === '2018年2月'; });
var febLegs = 0; for (var k = febIdx + 3; s18.rows[k][7] !== '項 小 計'; k++) if (s18.rows[k][1]) febLegs++;
check('2018-02 block holds all legs', febLegs, ctx.apiGetMonth('2018-02').flights.length);
check('settings change rebuilds all year sheets', (function () { ctx.apiSaveSettings({ pilot_name: 'テスト' }); return s18.rows[s18.rows.length - 1][0].indexOf('テスト') >= 0; })(), true);
ctx.apiSaveSettings({ pilot_name: '' });

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
