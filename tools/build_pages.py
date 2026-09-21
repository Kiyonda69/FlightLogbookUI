#!/usr/bin/env python
"""build_pages.py — build the static front-end (GitHub Pages) from src/.

Produces docs/index.html: Index.html with Style.html + Script.html inlined and a shim that
replaces google.script.run with fetch() calls to the Apps Script JSON API (doPost in Code.gs).

Connection settings:
  * API URL   — baked into the page from pages.config.json ({"apiUrl": ".../exec"}) or --api-url.
                It can still be overridden in the page's connection panel.
  * password  — never baked in. Entered once per device (kept in localStorage), or passed once via
                the URL fragment  https://<pages>/#password=<API_PASSWORD>  (stored, then removed).

  python tools/build_pages.py [--api-url URL]     # writes docs/index.html + docs/.nojekyll
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DOCS = ROOT / "docs"
CONFIG = ROOT / "pages.config.json"

CONN_BAR = """
<div id="connBar" class="conn" style="display:none">
  <form id="connForm" onsubmit="return false;">
    <b>接続設定</b>
    <input id="connUrl" placeholder="Apps Script ウェブアプリ URL (…/exec)" autocomplete="off">
    <input id="connPassword" placeholder="パスワード" autocomplete="current-password" type="password">
    <button class="btn primary" id="connSave" type="submit">接続</button>
    <button class="btn" id="connShare" type="button" title="この端末の接続設定を含むリンクをコピー（他の端末で 1 回開くと設定が保存されます）">共有リンクをコピー</button>
    <button class="btn" id="connClose" type="button">閉じる</button>
    <span class="hint" id="connStatus"></span>
  </form>
</div>
"""

CONN_CSS = """
<style>
  .conn { background: #fff8e1; border-bottom: 1px solid #f0d78c; padding: 8px 16px; }
  .conn form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .conn input { flex: 1 1 240px; }
  header .connlink { margin-left: auto; color: #9aa0a6; font-size: 12px; cursor: pointer; text-decoration: underline; }
</style>
"""

SHIM = r"""
<script>
/* ---- google.script.run shim: fetch() to the Apps Script JSON API (doPost) ---- */
var LOGBOOK_DEFAULT_API_URL = __DEFAULT_API_URL__;
(function () {
  var KEY_URL = 'logbook.apiUrl', KEY_PW = 'logbook.password';
  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function apiUrl() { return get(KEY_URL) || LOGBOOK_DEFAULT_API_URL || ''; }
  function password() { return get(KEY_PW); }

  // One-time setup via URL fragment: #password=...  (optionally &api=...). Stored, then removed from the URL.
  (function readFragment() {
    var h = location.hash.replace(/^#/, '');
    if (!/(^|&)(password|api)=/.test(h)) return;
    var q = {};
    h.split('&').forEach(function (p) { var i = p.indexOf('='); if (i > 0) q[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
    if (q.api) set(KEY_URL, q.api.trim());
    if (q.password) set(KEY_PW, q.password.trim());
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  })();

  function ConnError(msg) { this.message = msg; this.conn = true; }

  function callApi(fn, args) {
    var url = apiUrl(), pw = password();
    if (!url) return Promise.reject(new ConnError('API URL が未設定です'));
    if (!pw) return Promise.reject(new ConnError('パスワードが未設定です'));
    return fetch(url, { method: 'POST', body: JSON.stringify({ password: pw, fn: fn, args: args }), redirect: 'follow' })
      .catch(function (e) { throw new ConnError('接続できません: ' + e.message); })
      .then(function (r) {
        if (!r.ok) throw new ConnError('HTTP ' + r.status);
        return r.json().catch(function () { throw new ConnError('API の応答が JSON ではありません（デプロイ設定「アクセス: 全員」と URL を確認）'); });
      })
      .then(function (j) {
        if (j.ok) return j.result;
        var msg = j.error || 'API error';
        if (/^認証エラー|API_PASSWORD が未設定/.test(msg)) throw new ConnError(msg);
        throw new Error(msg);
      });
  }

  function runner() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var p = new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
      if (name === 'withFailureHandler') return function (f) { fail = f; return p; };
      if (name === 'withUserObject') return function () { return p; };
      return function () {
        callApi(String(name), Array.prototype.slice.call(arguments))
          .then(ok, function (e) { fail({ message: e.message }); if (e.conn) showBar(e.message); });
      };
    }});
    return p;
  }
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });

  function $(id) { return document.getElementById(id); }
  function showBar(msg) {
    var bar = $('connBar'); if (!bar) return;
    bar.style.display = '';
    $('connUrl').value = apiUrl();
    $('connPassword').value = password();
    $('connStatus').textContent = msg || '';
  }
  function shareLink() {
    var base = location.origin + location.pathname;
    var parts = ['password=' + encodeURIComponent(password())];
    if (get(KEY_URL) && get(KEY_URL) !== LOGBOOK_DEFAULT_API_URL) parts.push('api=' + encodeURIComponent(get(KEY_URL)));
    return base + '#' + parts.join('&');
  }
  window.addEventListener('DOMContentLoaded', function () {
    var link = document.createElement('span');
    link.className = 'connlink'; link.textContent = '接続設定';
    link.addEventListener('click', function () { showBar(''); });
    document.querySelector('header').appendChild(link);
    $('connClose').addEventListener('click', function () { $('connBar').style.display = 'none'; });
    $('connShare').addEventListener('click', function () {
      if (!password()) { $('connStatus').textContent = '先にパスワードを保存してください'; return; }
      var url = shareLink();
      var done = function () { $('connStatus').textContent = '共有リンクをコピーしました（パスワードを含むので取り扱い注意）'; };
      var manual = function () { $('connStatus').textContent = '共有リンク: ' + url; window.prompt('コピーしてください（パスワードを含みます）', url); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, manual);
      else manual();
    });
    $('connSave').addEventListener('click', function () {
      var u = $('connUrl').value.trim();
      set(KEY_URL, u && u !== LOGBOOK_DEFAULT_API_URL ? u : '');
      set(KEY_PW, $('connPassword').value.trim());
      var st = $('connStatus'); st.textContent = '接続確認中…';
      callApi('apiPing', []).then(function (r) {
        st.textContent = '接続 OK (' + (r.spreadsheet || '') + ')';
        setTimeout(function () { location.reload(); }, 600);
      }, function (e) { st.textContent = '失敗: ' + e.message; });
    });
    if (!apiUrl() || !password()) showBar(!apiUrl() ? 'Apps Script の URL とパスワードを入力してください' : 'パスワードを入力してください（この端末に保存されます）');
  });
})();
</script>
"""


def default_api_url(cli_value):
    if cli_value:
        return cli_value
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text(encoding="utf-8")).get("apiUrl", "") or ""
        except ValueError as e:
            raise SystemExit("pages.config.json is not valid JSON: %s" % e)
    return ""


def build(api_url=""):
    html = (SRC / "Index.html").read_text(encoding="utf-8")
    style = (SRC / "Style.html").read_text(encoding="utf-8")
    script = (SRC / "Script.html").read_text(encoding="utf-8")
    shim = SHIM.replace("__DEFAULT_API_URL__", json.dumps(api_url))
    html = html.replace("<?!= include('Style'); ?>", style + CONN_CSS)
    html = html.replace("<?!= include('Script'); ?>", shim + script)
    # any other <?!= include('X'); ?> → contents of src/X.html (CrewRules, ...)
    html = re.sub(r"<\?!= include\('(\w+)'\); \?>", lambda m: (SRC / (m.group(1) + ".html")).read_text(encoding="utf-8"), html)
    html = html.replace("<nav>", CONN_BAR + "<nav>", 1)
    html = html.replace('<base target="_top">', '')
    html = html.replace("<head>", "<head>\n  <!-- generated by tools/build_pages.py — do not edit; edit src/ and rebuild -->", 1)
    if "<title>" not in html:
        html = html.replace("</head>", "  <title>飛行日誌 - Flight Logbook</title>\n</head>", 1)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    return DOCS / "index.html"


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api-url", default="", help="Apps Script web app URL (.../exec); overrides pages.config.json")
    args = ap.parse_args()
    url = default_api_url(args.api_url)
    out = build(url)
    print("wrote", out, "(%d bytes)" % out.stat().st_size)
    print("default API URL:", url or "(none — must be entered in the page)")
