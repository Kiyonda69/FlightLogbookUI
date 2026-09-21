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
 *                           only by the password stored in Script Properties (API_PASSWORD).
 *                           Set it from the spreadsheet menu (飛行日誌 > API パスワードを設定) or in
 *                           Project Settings > Script Properties.
 */

var API_PASSWORD_KEY = 'API_PASSWORD';
var AUTH_MAX_FAILURES = 20;   // consecutive wrong passwords before a temporary lock
var AUTH_LOCK_MINUTES = 10;   // lock duration (applies to everyone — there is no client IP in Apps Script)
var AUTH_FAIL_CACHE_KEY = 'auth_failures';

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
 *   { "password": "<API_PASSWORD>", "fn": "apiGetMonth", "args": ["2024-10"] }
 * Response: { "ok": true, "result": ... } | { "ok": false, "error": "..." }
 * Only functions whose name starts with "api" are callable.
 */
function doPost(e) {
  var out;
  try {
    var body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    checkPassword_(body.password);
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

/** Throws on wrong/missing password. Locks the API after AUTH_MAX_FAILURES consecutive failures. */
function checkPassword_(given) {
  var expected = PropertiesService.getScriptProperties().getProperty(API_PASSWORD_KEY);
  if (!expected) throw new Error('API_PASSWORD が未設定です。スプレッドシートのメニュー「飛行日誌 > API パスワードを設定」で設定してください');
  var cache = CacheService.getScriptCache();
  var failures = Number(cache.get(AUTH_FAIL_CACHE_KEY)) || 0;
  if (failures >= AUTH_MAX_FAILURES) {
    throw new Error('認証エラー: 失敗回数が多いため ' + AUTH_LOCK_MINUTES + ' 分間ロックされています');
  }
  if (typeof given !== 'string' || given.trim() !== expected) {
    cache.put(AUTH_FAIL_CACHE_KEY, String(failures + 1), AUTH_LOCK_MINUTES * 60);
    throw new Error('認証エラー: パスワードが一致しません');
  }
  if (failures) cache.remove(AUTH_FAIL_CACHE_KEY);
}

/** Health check for the static UI's connection panel. */
function apiPing() {
  return { ok: true, time: nowIso_(), spreadsheet: ss_().getName ? ss_().getName() : '' };
}

/** Spreadsheet menu: set / change the API password (stored in Script Properties). */
function setApiPasswordPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('API パスワードの設定',
    'GitHub Pages 版 UI で使うパスワードを入力してください（4 文字以上。変更すると全端末で再入力が必要）',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  setApiPassword_(res.getResponseText());
  ui.alert('API パスワードを保存しました。');
}

function setApiPassword_(password) {
  password = String(password || '').trim();
  if (password.length < 4) throw new Error('パスワードは 4 文字以上にしてください');
  PropertiesService.getScriptProperties().setProperty(API_PASSWORD_KEY, password);
  CacheService.getScriptCache().remove(AUTH_FAIL_CACHE_KEY);
  return true;
}

/** Editor-runnable: clears a lock caused by too many wrong passwords. */
function resetAuthLock() {
  CacheService.getScriptCache().remove(AUTH_FAIL_CACHE_KEY);
  Logger.log('認証ロックを解除しました');
}
