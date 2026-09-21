/**
 * Code.gs — web app entry points.
 *
 * Two front-ends share the same server code:
 *  1. HtmlService UI  : doGet() serves Index.html; the page calls functions via google.script.run.
 *  2. Static UI       : docs/index.html (GitHub Pages) calls doPost() as a JSON API over fetch.
 *
 * Deploy: Apps Script editor → Deploy → New deployment → Web app
 *   - HtmlService UI only : Execute as Me / Access "Only myself"
 *   - GitHub Pages UI     : Execute as Me / Access "Anyone" (anonymous). The API is then protected
 *                           by the token in Script Properties (API_TOKEN) — run generateApiToken() once.
 */

var API_TOKEN_KEY = 'API_TOKEN';

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('飛行日誌 - Flight Logbook')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used by Index.html to inline Style.html / Script.html. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * JSON API for the static front-end.
 * Request body (sent as text/plain so the browser makes no CORS preflight):
 *   { "token": "<API_TOKEN>", "fn": "apiGetMonth", "args": ["2024-10"] }
 * Response: { "ok": true, "result": ... } | { "ok": false, "error": "..." }
 * Only functions whose name starts with "api" are callable.
 */
function doPost(e) {
  var out;
  try {
    var body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    var expected = PropertiesService.getScriptProperties().getProperty(API_TOKEN_KEY);
    if (!expected) throw new Error('API_TOKEN が未設定です。Apps Script エディタで generateApiToken() を実行してください');
    if (!body.token || body.token !== expected) throw new Error('認証エラー: token が一致しません');
    var fn = String(body.fn || '');
    var g = typeof globalThis !== 'undefined' ? globalThis : this;
    if (!/^api[A-Z]\w*$/.test(fn) || typeof g[fn] !== 'function') throw new Error('不明な関数: ' + fn);
    var result = g[fn].apply(null, Array.isArray(body.args) ? body.args : []);
    out = { ok: true, result: result === undefined ? null : result };
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Health check for the static UI's connection panel. */
function apiPing() {
  return { ok: true, time: nowIso_(), spreadsheet: ss_().getName ? ss_().getName() : '' };
}

/**
 * Run once from the editor: creates a random API token, stores it in Script Properties and
 * logs it (View → Logs). Paste it into the static UI's connection panel.
 * Running it again replaces the token (old front-end sessions stop working).
 */
function generateApiToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(API_TOKEN_KEY, token);
  Logger.log('API_TOKEN = ' + token);
  return token;
}
