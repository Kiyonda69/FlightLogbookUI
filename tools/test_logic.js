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
ctx.__srcFiles = { CrewRules: fs.readFileSync(path.join(root, 'src/CrewRules.html'), 'utf8') };
['Schema.gs', 'Util.gs', 'Api.gs', 'Totals.gs', 'Report.gs', 'Import.gs', 'Crew.gs', 'Qual.gs', 'Validate.gs', 'Code.gs'].forEach(function (f) { load('src/' + f); });

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
check('parseClock "0745" → 07:45', ctx.parseClock_('0745'), '07:45');
check('parseClock "745" → 07:45', ctx.parseClock_('745'), '07:45');
check('parseClock "2360" rejected', (function () { try { ctx.parseClock_('2360'); return null; } catch (e) { return /不正/.test(e.message); } })(), true);

// --- setup + import
check('setupSpreadsheet', ctx.setupSpreadsheet(), 'OK');
// Fixture: the ORIGINAL export of FLIGHT LOGBOOK.numbers (860 legs, through 2024-10). The expected
// totals below are that file's 2024/10 合計 row. Regenerate with:
//   python tools/export_numbers.py "../FLIGHT LOGBOOK.numbers" --tag test
var CSV_FILE = fs.existsSync(path.join(root, 'data/flights_test.csv')) ? 'data/flights_test.csv' : 'data/flights.csv';
var CARRY_FILE = fs.existsSync(path.join(root, 'data/carry_forward_test.json')) ? 'data/carry_forward_test.json' : 'data/carry_forward.json';
console.log('fixture:', CSV_FILE, '+', CARRY_FILE);
var carry = JSON.parse(fs.readFileSync(path.join(root, CARRY_FILE), 'utf8'));
ctx.apiImportCarryForward(JSON.stringify(carry));
var csv = fs.readFileSync(path.join(root, CSV_FILE), 'utf8');
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

// --- text cells survive Sheets' auto type conversion (remarks "1:30", clocks, "5.30" dates)
var advt = ctx.apiGetMonth('2017-08').flights.filter(function (f) { return f.flight_no === 'ADVT'; })[0];
check('remark "1:30" stays text after import', advt.remarks, '1:30');
check('clock "00:00" stays text after import', advt.dep_time, '00:00');
check('date stays text after import', advt.date, '2017-08-30');
// simulate a sheet corrupted before the fix: remark stored as a time value / Date, then repair
var fsh = ctx.__mockSpreadsheet.getSheetByName('Flights');
advt._row = ctx.readAllFlights_().filter(function (f) { return f.flight_no === 'ADVT' && f.date === '2017-08-30'; })[0]._row;
fsh.rows[advt._row - 1][ctx.colIndex_('remarks')] = 0.0625;
check('corrupted day-fraction remark read back as text', ctx.apiGetMonth('2017-08').flights.filter(function (f) { return f.flight_no === 'ADVT'; })[0].remarks, '1:30');
fsh.rows[advt._row - 1][ctx.colIndex_('remarks')] = new Date(1899, 11, 30, 3, 0);
check('corrupted Date remark read back as text', ctx.apiGetMonth('2017-08').flights.filter(function (f) { return f.flight_no === 'ADVT'; })[0].remarks, '3:00');
check('repairFlightsSheetFormats rewrites all rows', ctx.repairFlightsSheetFormats(), 860);
check('repair leaves text cells as strings', typeof fsh.rows[advt._row - 1][ctx.colIndex_('remarks')], 'string');
check('cumulative unchanged after repair', ctx.apiBootstrap().cumulative, expected);

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
var titles = yrows.map(function (r) { return r[0]; }).filter(function (v) { return /^\d{1,2}月$/.test(String(v)); });
check('year sheet has 12 month titles', titles, ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']);
check('year sheet header row', yrows[1][0] + '|' + yrows[1][1] + '|' + yrows[1][11], '月日\n＿＿年|航空機\nの型式|機長・単独・副機長または機長見習業務の時間');
check('year sheet header INST sub-label', yrows[2][27] + '|' + yrows[2][28], 'INST|');
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
check('empty month block padded to 15 rows', (function () { var i = yrows.findIndex(function (r) { return r[0] === '11月'; }); return yrows[i + 3 + 15][7]; })(), '項 小 計');
check('empty padding rows carry no 0:00 fillers', (function () { var i = yrows.findIndex(function (r) { return r[0] === '11月'; }); return yrows[i + 3].every(function (v) { return v === ''; }); })(), true);
check('header merges + totals-left merge built', ysheet.merges.length, 12 * (8 + 1 + 1 + 1 + 1 + 1 + 5 + 1 + 1));
check('totals-left merge spans A..G x 3', ysheet.merges.some(function (m) { return m[1] === 1 && m[2] === 3 && m[3] === 7; }), true);
check('column widths applied (29 cols)', Object.keys(ysheet.colWidths).length, 29);
check('header rows taller', ysheet.rowHeights[2], 34);
check('body rows 21px', ysheet.rowHeights[4], 21);
// design borders: thin grid, medium frame, header bottom, totals top, 8 group columns, dotted 離陸|着陸
var styles = ysheet.borderCalls.map(function (b) { return b[b.length - 1]; });
check('medium borders applied', styles.filter(function (s) { return s === 'SOLID_MEDIUM'; }).length, 12 * (1 + 1 + 1 + 8));
check('dotted 離陸|着陸 border applied per block', styles.filter(function (s) { return s === 'DOTTED'; }).length, 12);
check('dotted border sits on column I right edge', ysheet.borderCalls.filter(function (b) { return b[b.length - 1] === 'DOTTED'; }).every(function (b) { return b[1] === 9 && b[3] === 1 && b[7] === true; }), true);
var mergesBefore = ysheet.merges.length, bordersBefore = ysheet.borderCalls.length;
var fast = ctx.apiRebuildYearReport('2024');
check('unchanged layout: fast path (values only)', fast.relayout, false);
check('unchanged layout: merges not rebuilt', ysheet.merges.length, mergesBefore);
check('unchanged layout: no border calls', ysheet.borderCalls.length, bordersBefore);
check('unchanged layout: values still correct', Math.round(ysheet.rows.filter(function (r) { return r[7] === '合  計'; })[11][10] * 1440), expected.block);
var forced = ctx.rebuildYearSheet_('2024', ctx.sortFlights_(ctx.readAllFlights_()), true);
check('forced rebuild takes the full path', forced.relayout, true);
check('forced rebuild: merges rebuilt once (breakApart + merge)', ysheet.merges.length, mergesBefore);
check('forced rebuild: design borders reapplied', ysheet.borderCalls.filter(function (b) { return b[b.length - 1] === 'DOTTED'; }).length, 12);
check('menu rebuild returns all year sheets', ctx.rebuildAllYearReports().length >= 8, true);
// settings cache: a settings change must be visible within the same execution
ctx.apiSaveSettings({ pilot_name: 'キャッシュ確認' });
check('settings cache invalidated on save', ctx.getSettings_().pilot_name, 'キャッシュ確認');
ctx.apiSaveSettings({ pilot_name: '' });
var badYear = null; try { ctx.apiRebuildYearReport('24'); } catch (e) { badYear = e.message; }
check('rebuild rejects bad year', /年の指定/.test(badYear || ''), true);
check('apiListReports newest first', ctx.apiListReports()[0], '飛行日誌_2025');
// a month with more than 15 legs grows the block (2018-02 has 24 legs, so layout differs from padding)
var s18 = ctx.__mockSpreadsheet.getSheetByName('飛行日誌_2018');
var febIdx = s18.rows.findIndex(function (r) { return r[0] === '2月'; });
var febLegs = 0; for (var k = febIdx + 3; s18.rows[k][7] !== '項 小 計'; k++) if (s18.rows[k][1]) febLegs++;
check('2018-02 block holds all legs', febLegs, ctx.apiGetMonth('2018-02').flights.length);
check('settings change rebuilds all year sheets', (function () { ctx.apiSaveSettings({ pilot_name: 'テスト' }); return s18.rows[s18.rows.length - 1][0].indexOf('テスト') >= 0; })(), true);
ctx.apiSaveSettings({ pilot_name: '' });

// --- year summary / recency
var ys = ctx.apiYearSummary('2018');
check('2018 legs', ys.months.reduce(function (a, x) { return a + x.count; }, 0), 173);
check('recency shape', typeof ctx.apiRecency(90).count, 'number');

// --- carry-forward import entry points runnable without arguments
var carryJson = fs.readFileSync(path.join(root, CARRY_FILE), 'utf8');
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

// --- crew allocation rules (CrewRules.html shared with the UI), examples from the JAL document
var CR = ctx.loadCrewRules_();
check('crew rules: 3 normal + 11 multi + 8 double patterns', CR.CREW_PATTERNS.length, 3 + 11 + 8);
var a = CR.allocateCrew('M2', 0, 499, 499, 120);           // CA DUTY in CA/CA/CO: 1/2CA + 1/6CO, block 8:19
check('M2 CA: 機長 = round(499/2) = 250', a.pic, 250);
check('M2 CA: 副操縦士 = round(499/6) = 83', a.sic, 83);
check('M2 CA: 飛行時間 = 250 + 83 (not 2/3 of block)', a.block, 333);
check('M2 CA: 野外 follows the same fractions', [a.pic_xc, a.sic_xc], [250, 83]);
check('M2 CA: 夜間 120 → 60 + 20', [a.pic_night, a.sic_night], [60, 20]);
check('M2 CA: formula text', a.formula, '1/2CA + 1/6CO');
var b = CR.allocateCrew('M2', 2, 499, 499, 0);             // CO DUTY: 2/3CO
check('M2 CO: 副操縦士 = round(499*2/3) = 333, 飛行時間 = 333', [b.sic, b.block, b.pic], [333, 333, 0]);
var c = CR.allocateCrew('M3', 1, 499, 499, 90);            // SIC DUTY in CA/SIC/CO: 1/3SIC + 1/3CO
check('M3 SIC: 単独・副機長 166 + 副操縦士 166 = 飛行時間 332', [c.solo_sic, c.sic, c.block], [166, 166, 332]);
check('M3 SIC: SIC 側の野外・夜間は機長側 (12/13項), CO 側は 16/17項', [c.pic_xc, c.pic_night, c.sic_xc, c.sic_night], [166, 30, 166, 30]);
var d = CR.allocateCrew('D1', 0, 499, 0, 0);               // double crew, 4 captains: 1/4CA + 1/4CO
check('D1 CA: 125 + 125 = 250', [d.pic, d.sic, d.block], [125, 125, 250]);
check('M4 CKC: 1/3CKC + 1/3CA both count as 機長', CR.allocateCrew('M4', 0, 600, 0, 0).pic, 400);
check('M9 RAL: 1/3RAL (機長) + 1/3SIC (単独・副機長)', (function (r) { return [r.pic, r.solo_sic, r.block]; })(CR.allocateCrew('M9', 1, 600, 0, 0)), [200, 200, 400]);
check('M10 PUS: 2/3PUS → 機長見習', CR.allocateCrew('M10', 2, 600, 600, 0).pus, 400);
check('N1 CA: whole block as 機長', CR.allocateCrew('N1', 0, 600, 600, 30).pic, 600);
check('rounding is half-up', CR.allocateCrew('M1', 0, 3, 0, 0).pic, 1);          // 3/3 = 1
check('every pattern: crew length == alloc length', CR.CREW_PATTERNS.every(function (p) { return p.crew.length === p.alloc.length; }), true);
check('every duty code known', CR.CREW_PATTERNS.every(function (p) { return p.alloc.every(function (m) { return m.every(function (t) { return CR.CREW_DUTIES[t[2]]; }); }); }), true);
check('parseCrewCode', CR.parseCrewCode('M2/0'), { patternId: 'M2', member: 0 });
check('parseCrewCode rejects garbage', CR.parseCrewCode('SPLIT'), null);
// ダブル Pattern 7 / 8 (second screenshot): CA/CA/CA/PUS and CA/CA/CO/PUS
check('D7 CA: 1/3CA + 1/6CO', (function (r) { return [r.pic, r.sic, r.block]; })(CR.allocateCrew('D7', 0, 600, 600, 60)), [200, 100, 300]);
check('D7 PUS: 1/2PUS', (function (r) { return [r.pus, r.block, r.pic_xc]; })(CR.allocateCrew('D7', 3, 600, 600, 0)), [300, 300, 300]);
check('D8 CO: 1/2CO', (function (r) { return [r.sic, r.sic_night, r.block]; })(CR.allocateCrew('D8', 2, 600, 600, 60)), [300, 30, 300]);
check('D8 crew list', CR.crewPattern('D8').crew, ['CA', 'CA', 'CO', 'PUS']);
check('D7 / D8: fractions of the 4 members sum to 2 (two seats occupied at any time)', ['D7', 'D8'].map(function (id) { var sum = 0; CR.crewPattern(id).alloc.forEach(function (m) { m.forEach(function (t) { sum += t[0] / t[1]; }); }); return sum; }), [2, 2]);
check('default patterns exist', [CR.CREW_DEFAULT_PATTERN.M, CR.CREW_DEFAULT_PATTERN.D, CR.crewPattern('M2').crew, CR.crewPattern('D3').crew], ['M2', 'D3', ['CA', 'CA', 'CO'], ['CA', 'CA', 'CO', 'CO']]);
var badP = null; try { CR.allocateCrew('D9', 0, 100, 0, 0); } catch (e) { badP = e.message; }
check('unknown pattern rejected', /未知の編成パターン/.test(badP || ''), true);
check('apiCrewPatterns lists formulas', ctx.apiCrewPatterns().patterns.filter(function (p) { return p.id === 'M2'; })[0].formulas, ['1/2CA + 1/6CO', '1/2CA + 1/6CO', '2/3CO']);
check('apiAllocateCrew accepts H:MM', ctx.apiAllocateCrew('M2', 0, '8:19', '8:19', '2:00').block, 333);

// --- crew column round trip
var cr = ctx.apiAddFlight({ date: '2025-03-01', aircraft_type: 'B77W', registration: 'JA742J', dep: 'RJTT', arr: 'KLAX', dep_time: '23:40', arr_time: '08:55',
  flight_no: 'JL62', takeoffs: 1, landings: 1, block: 333, pic: 250, sic: 83, pic_xc: 250, sic_xc: 83, crew: 'm2/0' });
check('crew code stored upper-case', cr.flight.crew, 'M2/0');
check('flight_no stored upper-case', ctx.apiAddFlight({ date: '2025-03-05', aircraft_type: 'B77W', registration: 'JA742J', dep: 'KLAX', arr: 'RJTT', dep_time: '20:00', arr_time: '06:00', flight_no: 'jl61', pic: 600, block: 600 }).flight.flight_no, 'JL61');
check('crew code read back', ctx.apiGetMonth('2025-03').flights[0].crew, 'M2/0');
var badCrew = null; try { ctx.apiAddFlight({ date: '2025-03-02', aircraft_type: 'B77W', registration: 'JA742J', dep: 'RJTT', arr: 'RJOO', dep_time: '01:00', arr_time: '02:00', pic: 60, crew: 'X9' }); } catch (e) { badCrew = e.message; }
check('bad crew code rejected', /編成コード/.test(badCrew || ''), true);
ctx.apiDeleteFlight(cr.flight.id);
ctx.apiGetMonth('2025-03').flights.forEach(function (f) { ctx.apiDeleteFlight(f.id); });

// --- batch save (queue from localStorage → one request): adds + update, atomic validation
var before = ctx.apiBootstrap().cumulative;
var leg = function (d, fn, dep, arr) { return { date: d, aircraft_type: 'B77W', registration: 'JA742J', dep: dep, arr: arr, dep_time: '01:00', arr_time: '03:00', flight_no: fn, takeoffs: 1, landings: 1, block: 120, pic: 120, pic_xc: 120, crew: 'N1/0' }; };
var batch = ctx.apiSaveFlights([leg('2025-04-01', 'jl1', 'RJTT', 'KSFO'), leg('2025-04-02', 'JL2', 'KSFO', 'RJTT'), leg('2024-12-30', 'JL3', 'RJTT', 'RJOO')]);
check('batch: 3 added, 0 updated', [batch.added, batch.updated, batch.flights.length], [3, 0, 3]);
check('batch: ids assigned + flight_no upper-cased', batch.flights.every(function (f) { return f.id; }) && batch.flights[0].flight_no === 'JL1', true);
check('batch: year sheets refreshed from the earliest year (2024, 2025)', batch.refreshed, ['飛行日誌_2024', '飛行日誌_2025']);
check('batch: cumulative block +6:00', ctx.apiBootstrap().cumulative.block - before.block, 360);
check('batch: rows readable', ctx.apiGetMonth('2025-04').flights.map(function (f) { return f.flight_no; }), ['JL1', 'JL2']);
var upd = JSON.parse(JSON.stringify(batch.flights[0])); upd.block = 180; upd.pic = 180; upd.pic_xc = 180; upd.arr_time = '04:00';
var batch2 = ctx.apiSaveFlights([upd, leg('2025-04-03', 'JL4', 'RJTT', 'RJCC')]);
check('batch: 1 added + 1 updated', [batch2.added, batch2.updated], [1, 1]);
check('batch: update kept id / created_at, changed block', (function (f) { return [f.id === upd.id, f.created_at === batch.flights[0].created_at, f.block]; })(ctx.apiGetMonth('2025-04').flights[0]), [true, true, 180]);
check('batch: cumulative block +6:00 +1:00 +2:00', ctx.apiBootstrap().cumulative.block - before.block, 540);
var badBatch = null; try { ctx.apiSaveFlights([leg('2025-04-05', 'JL5', 'RJTT', 'RJOO'), { date: 'bad', crew: 'X' }]); } catch (e) { badBatch = e.message; }
check('batch: one bad leg → nothing written, error names the item', [/2 件目/.test(badBatch || ''), ctx.apiGetMonth('2025-04').flights.length], [true, 3]);
var badId = null; try { ctx.apiSaveFlights([{ id: 'nope', date: '2025-04-05', aircraft_type: 'B77W', registration: 'JA742J', dep: 'RJTT', arr: 'RJOO', block: 60, pic: 60 }]); } catch (e) { badId = e.message; }
check('batch: unknown id rejected', /該当レコード/.test(badId || ''), true);
var emptyBatch = null; try { ctx.apiSaveFlights([]); } catch (e) { emptyBatch = e.message; }
check('batch: empty rejected', /保存するレグ/.test(emptyBatch || ''), true);
ctx.apiGetMonth('2025-04').flights.concat(ctx.apiGetMonth('2024-12').flights.filter(function (f) { return f.flight_no === 'JL3'; })).forEach(function (f) { ctx.apiDeleteFlight(f.id); });
check('batch: cleanup restores cumulative', ctx.apiBootstrap().cumulative, before);

// --- QPR flag → Flights column, qualification panel, checklist ROUTE CHK column
var qprLeg = function (d, fn, qpr) { return { date: d, aircraft_type: 'B77W', registration: 'JA742J', dep: 'RJTT', arr: 'KLAX', dep_time: '01:00', arr_time: '10:00', flight_no: fn, takeoffs: 1, landings: 1, block: 540, pic: 540, pic_xc: 540, crew: 'N1/0', qpr: qpr }; };
var q1 = ctx.apiAddFlight(qprLeg('2025-05-03', 'JL62', true)).flight;
var q2 = ctx.apiAddFlight(qprLeg('2025-11-20', 'JL16', '1')).flight;
var q3 = ctx.apiAddFlight(qprLeg('2026-04-02', 'JL10', 'yes')).flight;
var q4 = ctx.apiAddFlight(qprLeg('2025-06-01', 'JL7', '')).flight;
check('qpr: true / "1" / "yes" stored as "1", blank stays blank', [q1.qpr, q2.qpr, q3.qpr, q4.qpr], ['1', '1', '1', '']);
check('qpr: read back from the sheet', ctx.apiGetMonth('2025-05').flights[0].qpr, '1');
var qq = ctx.apiQualification('2025-12-01').qpr;
check('qpr: FY2025 count 2, last = 2025-11-20 JL16', [qq.fy, qq.count, qq.last.date, qq.last.flight_no, qq.status], [2025, 2, '2025-11-20', 'JL16', 'ok']);
check('qpr: FY2024 none → warn', ctx.apiQualification('2025-03-31').qpr.status, 'warn');
var qsh = ctx.__mockSpreadsheet.getSheetByName(ctx.QUAL_SHEET);
check('qual sheet: QPR legs fill ROUTE CHK 前回実施日 (row 5, col F)', qsh.rows[4][5], '2026年 4月 2日');
check('qual sheet: ROUTE CHK 基準月 follows the latest QPR (4月)', qsh.rows[2][5], '4月');
var routeFy = {}; for (var qi = 5; qi < 10; qi++) routeFy[qsh.rows[qi][0]] = qsh.rows[qi][5];
check('qual sheet: 2025年度 ROUTE CHK = latest QPR of that FY', routeFy['2025年度\n実施日'], '2025年 11月 20日');
check('qual sheet: 2026年度 ROUTE CHK', routeFy['2026年度\n実施日'], '2026年 4月 2日');
check('qual sheet: still the 27-row CAP form (no extra block)', [ctx.QUAL_ROWS, qsh.rows.length <= 27 || qsh.rows.slice(27).every(function (r) { return r.every(function (c) { return c === '' || c === undefined; }); })], [27, true]);
[q1, q2, q3, q4].forEach(function (f) { ctx.apiDeleteFlight(f.id); });
check('qpr: cleanup', ctx.apiBootstrap().cumulative, before);
// header migration: a sheet created before the crew column gets the header appended
var fl = ctx.__mockSpreadsheet.getSheetByName('Flights');
fl.rows[0] = fl.rows[0].slice(0, fl.rows[0].length - 1);
check('ensureFlightsHeader_ appends missing header', ctx.ensureFlightsHeader_(fl), 1);
check('header complete again', fl.rows[0][fl.rows[0].length - 1], 'qpr');
fl.rows[0] = fl.rows[0].slice(0, fl.rows[0].length - 1);
ctx.apiBootstrap();
check('readAllFlights_ self-heals a missing trailing header', fl.rows[0][fl.rows[0].length - 1], 'qpr');

// --- onEdit: direct edits of the Flights sheet are marked (red + note), never rewritten
var vsh = ctx.__mockSpreadsheet.getSheetByName('Flights');
var vRow = vsh.getLastRow();                                   // last data row
var vr = ctx.readAllFlights_().filter(function (f) { return f._row === vRow; })[0];
var origRemark = vsh.rows[vRow - 1][ctx.colIndex_('remarks')];
var edit = function (r, c, v) { vsh.rows[r - 1][c - 1] = v; ctx.onEdit({ range: vsh.getRange(r, c, 1, 1) }); return [vsh.backgrounds[r + ',' + c] || null, vsh.notes[r + ',' + c] || '']; };
var cRem = ctx.colIndex_('remarks') + 1, cBlock = ctx.colIndex_('block') + 1, cDate = ctx.colIndex_('date') + 1, cDep = ctx.colIndex_('dep') + 1, cCrew = ctx.colIndex_('crew') + 1, cTime = ctx.colIndex_('dep_time') + 1;
check('onEdit: remark converted to a day fraction → marked', edit(vRow, cRem, 0.0625)[0], ctx.FLIGHT_BAD_BG);
check('onEdit: remark as Date → marked with note', /テキスト形式/.test(edit(vRow, cRem, new Date(1899, 11, 30, 1, 30))[1]), true);
check('onEdit: valid remark clears the mark', edit(vRow, cRem, origRemark), [null, '']);
check('onEdit: block "1:30" (should be minutes) → note suggests 90', /→ 90/.test(edit(vRow, cBlock, '1:30')[1]), true);
check('onEdit: block 90 ok', edit(vRow, cBlock, 90), [null, '']);
check('onEdit: block as day fraction → marked', /時刻/.test(edit(vRow, cBlock, 0.0625)[1]), true);
vsh.rows[vRow - 1][cBlock - 1] = vr.block; ctx.onEdit({ range: vsh.getRange(vRow, cBlock, 1, 1) });
check('onEdit: date as Date object → marked', /YYYY-MM-DD/.test(edit(vRow, cDate, new Date(2025, 0, 5))[1]), true);
check('onEdit: date "2025/1/5" → marked', /YYYY-MM-DD/.test(edit(vRow, cDate, '2025/1/5')[1]), true);
check('onEdit: date restored ok', edit(vRow, cDate, vr.date), [null, '']);
check('onEdit: dep "hnd" → ICAO note', /ICAO/.test(edit(vRow, cDep, 'hnd')[1]), true);
check('onEdit: dep restored', edit(vRow, cDep, vr.dep), [null, '']);
check('onEdit: crew "X9" → marked', /編成コード/.test(edit(vRow, cCrew, 'X9')[1]), true);
check('onEdit: crew restored', edit(vRow, cCrew, vr.crew), [null, '']);
check('onEdit: dep_time "25:00" → marked', /時刻の値/.test(edit(vRow, cTime, '25:00')[1]), true);
check('onEdit: dep_time restored', edit(vRow, cTime, vr.dep_time), [null, '']);
// multi-cell edit spanning the header row and columns beyond the schema (row 2 = first leg)
var row2Block = vsh.rows[1][cBlock - 1];
vsh.rows[1][cBlock - 1] = '1:30';
ctx.onEdit({ range: vsh.getRange(1, 1, 3, ctx.FLIGHT_COLUMNS.length + 3) });
check('onEdit: block edit skips the header and marks the bad cell', [vsh.backgrounds['1,' + cBlock] || null, vsh.backgrounds['2,' + cBlock], vsh.backgrounds['3,' + cBlock] || null], [null, ctx.FLIGHT_BAD_BG, null]);
vsh.rows[1][cBlock - 1] = row2Block; ctx.onEdit({ range: vsh.getRange(2, cBlock, 1, 1) });
check('onEdit: restored row 2 is clean', vsh.backgrounds['2,' + cBlock] || null, null);
// a paste of 1000 rows is capped at FLIGHT_EDIT_MAX_ROWS (must not time out)
check('onEdit: huge range does not throw', (function () { try { ctx.onEdit({ range: vsh.getRange(2, 1, 1000, 5) }); return true; } catch (e) { return e.message; } })(), true);
check('onEdit: other sheets are ignored', (function () { var s = ctx.__mockSpreadsheet.getSheetByName('Settings'); ctx.onEdit({ range: s.getRange(2, 2, 1, 1) }); return Object.keys(s.backgrounds).length; })(), 0);
check('onEdit: never throws on a bad event', (function () { try { ctx.onEdit(null); ctx.onEdit({}); return true; } catch (e) { return e.message; } })(), true);
var savedLen = vsh.rows.length; while (vsh.rows.length < vRow + 5) vsh.rows.push([]);
check('onEdit: empty row below the data is ignored', edit(vRow + 5, cBlock, ''), [null, '']);
check('onEdit: a lone value in an empty row is still checked', /分の整数/.test(edit(vRow + 5, cBlock, '1:30')[1]), true);
vsh.rows.length = savedLen;
check('validateFlightsSheet: whole sheet clean', /問題のあるセル 0 件/.test(ctx.validateFlightsSheet()), true);
check('data untouched by validation', ctx.apiBootstrap().cumulative, expected);

// --- 資格要件 (qualification) from the logbook, evaluated at a fixed "today"
var q = ctx.apiQualification('2024-11-15');
check('qual: last flight 2024-10-26, 20 days ago → ok', [q.lastFlight.date, q.lastFlight.days, q.lastFlight.status], ['2024-10-26', 20, 'ok']);
check('qual: 60+ days without flying → 復帰訓練', ctx.apiQualification('2025-01-10').lastFlight.status, 'over');
check('qual: 90-day landings counted', q.recency.landings >= 3 && q.recency.status === 'ok', true);
var m21 = q.training.filter(function (t) { return t.code === 'M21'; })[0];
check('qual: last M21 = 2024-10-24, next base 2025-10, window 2025-09..2025-11', [m21.last, m21.baseMonth, m21.windowFrom, m21.windowUntil, m21.status], ['2024-10-24', '2025-10', '2025-09', '2025-11', 'ok']);
check('qual: inside window → due', ctx.apiQualification('2025-09-05').training.filter(function (t) { return t.code === 'M21'; })[0].status, 'due');
check('qual: past window → over', ctx.apiQualification('2025-12-05').training.filter(function (t) { return t.code === 'M21'; })[0].status, 'over');
ctx.apiSaveSettings({ exp_pe: '2024-12-20', exp_english: '2030-01-01' });
var q2 = ctx.apiQualification('2024-11-15');
check('qual: PE expiring in 35 days → warn (45-day rule)', q2.expiries.filter(function (e) { return e.key === 'exp_pe'; })[0].status, 'warn');
check('qual: english far away → ok', q2.expiries.filter(function (e) { return e.key === 'exp_english'; })[0].status, 'ok');
check('qual: untracked expiry → unknown', q2.expiries.filter(function (e) { return e.key === 'exp_visa'; })[0].status, 'unknown');
check('qual: expiry settings do not trigger year sheet rebuild', true, true);
ctx.apiSaveSettings({ exp_pe: '', exp_english: '' });

// --- 資格要件チェックリスト sheet (CAP layout), auto-filled and refreshed
var qs = ctx.__mockSpreadsheet.getSheetByName('資格要件チェックリスト');
check('qual sheet created by the import refresh', !!qs, true);
check('qual sheet: 27 rows x 10 cols grid', [qs.rows.length >= 27, qs.rows[1].length >= 10], [true, true]);
check('qual sheet: title', qs.rows[0][0], '資格 要件チェックリスト　for  CAP');
check('qual sheet: header row', qs.rows[1], ['訓練審査', 'CACK', 'M12 ', 'M21 ', 'M22 ', 'ROUTE CHK', 'DIT', '63歳以上68歳未満付加訓練', 'PE', 'PEA（またはPE）']);
check('qual sheet: 前回実施日 M12 / M21 / M22 from the logbook', [qs.rows[4][2], qs.rows[4][3], qs.rows[4][4]], ['2024年 4月 22日', '2024年 10月 24日', '2024年 10月 25日']);
check('qual sheet: CACK column includes M11 legs', qs.rows[4][1], '2024年 4月 21日');
check('monthLabel_ forms', [ctx.monthLabel_('2024-06-01'), ctx.monthLabel_('2026-04'), ctx.monthLabel_('7'), ctx.monthLabel_('11月'), ctx.monthLabel_('13'), ctx.monthLabel_('')], ['6月', '4月', '7月', '11月', '月', '月']);
check('qual sheet: 基準月 derived from last M12 (4月) and +6 (10月)', [qs.rows[2][1], qs.rows[2][3]], ['4月', '10月']);
check('qual sheet: blank placeholders keep the form text', qs.rows[4][5], '        年       月       日');
var fy0 = (function () { var d = new Date(); return (d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1) - 1; })();
check('qual sheet: fiscal-year rows labelled FY-1..FY+3', [qs.rows[5][0], qs.rows[9][0]], [fy0 + '年度\n実施日', (fy0 + 4) + '年度\n実施日']);
check('qual sheet: 63歳 rows 8-10 fixed "－"', [qs.rows[7][7], qs.rows[8][7], qs.rows[9][7]], ['－', '－', '－']);
check('qual sheet: notes block', [qs.rows[16][0], qs.rows[17][1], qs.rows[26][0]], ['CACK', '技能基準月と同月', '特定操縦技能\n審査/確認']);
check('qual sheet: merges (B3:C3, D3:E3, 4 slot rows, 8 note rows, A19:A20)', qs.merges.length, 2 + 4 + 8 + 1);
check('qual sheet: column widths set', Object.keys(qs.colWidths).length, 10);
var qMerges = qs.merges.length, qBorders = qs.borderCalls.length;
ctx.apiSaveSettings({ department: '777運航乗員部', employee_no: '123456', exp_english: '2027-03-31, 2030-01-01', dates_route: '2024-06-01', exp_pe: '2026-12-15', dates_pe: '2026-06-10' });
qs = ctx.__mockSpreadsheet.getSheetByName('資格要件チェックリスト');
check('qual sheet: settings change refreshes values only (fast path)', [qs.merges.length, qs.borderCalls.length], [qMerges, qBorders]);
check('qual sheet: 所属 / 社員番号 / 氏名 line', qs.rows[0][3].indexOf('所属：777運航乗員部') === 0 && qs.rows[0][3].indexOf('社員番号：123456') > 0, true);
check('qual sheet: 航空英語 slots', qs.rows[11][2], '　(1) 2027 / 03 / 31　　(2) 2030 / 01 / 01');
check('qual sheet: ROUTE CHK date + 基準月', [qs.rows[4][5], qs.rows[2][5]], ['2024年 6月 1日', '6月']);
check('qual sheet: PE 有効期限 + 実施日 cell', qs.rows[4][8], '有効期限 2026年 12月 15日\n実施日 2026年 6月 10日');
check('qual sheet: PE 基準月 = expiry month', qs.rows[2][8], '12月');
check('apiQualification uses the latest date of a list', ctx.apiQualification('2026-09-21').expiries.filter(function (e) { return e.key === 'exp_english'; })[0].date, '2030-01-01');
check('forced rebuild restyles', ctx.apiRebuildQualSheet().relayout, true);
// Settings dates must survive Sheets' date auto-conversion (the real-sheet bug: "2027-04-06T15:00:00Z")
ctx.apiSaveSettings({ exp_passport: '2029-01-31', exp_visa: '2035-07-09' });
var setSheet = ctx.__mockSpreadsheet.getSheetByName('Settings');
var ppRow = setSheet.rows.filter(function (r) { return r[0] === 'exp_passport'; })[0];
check('settings: date saved as text (format @ before write)', typeof ppRow[1], 'string');
ppRow[1] = new Date(2029, 0, 31); // simulate a cell converted by Sheets before the fix
ctx.settingsCache_ = null;
check('settings: Date cell read back as yyyy-mm-dd (no UTC day shift)', ctx.getSettings_().exp_passport, '2029-01-31');
check('qual sheet: passport slot from a Date cell', ctx.apiQualificationSheetData().passport, ['2029-01-31']);
check('apiQualification: passport status from a Date cell', ctx.apiQualification('2026-09-21').expiries.filter(function (e) { return e.key === 'exp_passport'; })[0].date, '2029-01-31');
ctx.apiSaveSettings({ exp_passport: '', exp_visa: '' });
ctx.apiSaveSettings({ department: '', employee_no: '', exp_english: '', dates_route: '', exp_pe: '', dates_pe: '' });
check('dateList_ tolerates junk', ctx.dateList_('2026-01-05, abc, 2025/3/1'), ['2025-03-01', '2026-01-05']);

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
