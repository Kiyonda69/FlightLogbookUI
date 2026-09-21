#!/usr/bin/env node
/**
 * api_server.js — local stand-in for the Apps Script JSON API (doPost in src/Code.gs).
 * Runs the real src/*.gs on dev/mock_gas.js, seeds data/flights.csv + carry_forward.json,
 * and answers POST /api exactly like the deployed web app (password = "dev-pass").
 *
 *   node dev/api_server.js [port]     # default 8766  →  http://localhost:8766/api
 *
 * Pair with the static front-end: python dev/serve.py → http://localhost:8765/docs/
 * and enter URL http://localhost:8766/api, password dev-pass in the connection panel.
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http');
var root = path.join(__dirname, '..');
var port = Number(process.argv[2]) || 8766;

var ctx = vm.createContext({ console: console, Math: Math, Date: Date, JSON: JSON, Error: Error, String: String, Number: Number, Array: Array, Object: Object, RegExp: RegExp, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN });
function load(f) { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }); }
load('dev/mock_gas.js');
ctx.__srcFiles = { CrewRules: fs.readFileSync(path.join(root, 'src/CrewRules.html'), 'utf8') };
['Schema.gs', 'Util.gs', 'Api.gs', 'Totals.gs', 'Report.gs', 'Import.gs', 'Crew.gs', 'Code.gs'].forEach(function (f) { load('src/' + f); });

ctx.setupSpreadsheet();
ctx.PropertiesService.getScriptProperties().setProperty('API_PASSWORD', 'dev-pass');
try { ctx.apiImportCarryForward(fs.readFileSync(path.join(root, 'data/carry_forward.json'), 'utf8')); } catch (e) { console.warn('no carry_forward.json'); }
try { console.log('seeded', ctx.apiImportCsv(fs.readFileSync(path.join(root, 'data/flights.csv'), 'utf8'), { source: 'dev' })); } catch (e) { console.warn('no flights.csv'); }

http.createServer(function (req, res) {
  var cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  var body = '';
  req.on('data', function (c) { body += c; });
  req.on('end', function () {
    var out = ctx.doPost({ postData: { contents: body } });
    var text = out.getContent();
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
    res.end(text);
    try { var b = JSON.parse(body || '{}'); console.log(req.method, req.url, b.fn, JSON.stringify(b.args || []).slice(0, 60), text.length + 'B'); } catch (e) { console.log(req.method, req.url); }
  });
}).listen(port, '127.0.0.1', function () { console.log('API mock listening on http://localhost:' + port + '/api  (password: dev-pass)'); });
