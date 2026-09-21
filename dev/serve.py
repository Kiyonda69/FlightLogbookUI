#!/usr/bin/env python
"""dev/serve.py — local preview of the web UI without Google Apps Script.

Serves Index.html with Style/Script inlined, loads dev/mock_gas.js + src/*.gs into the page,
shims google.script.run to call those functions directly, and seeds the in-memory
spreadsheet from data/flights.csv and data/carry_forward.json.

  python dev/serve.py [port]   ->  http://localhost:8765/
"""
import http.server, re, sys, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
GS_ORDER = ["Schema.gs", "Util.gs", "Api.gs", "Totals.gs", "Report.gs", "Import.gs", "Crew.gs", "Qual.gs", "Validate.gs", "Code.gs"]

SHIM = """
<script>
window.google = { script: { run: null } };
(function () {
  function runner() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var p = new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
      if (name === 'withFailureHandler') return function (f) { fail = f; return p; };
      return function () {
        var args = arguments;
        setTimeout(function () {
          try { ok(JSON.parse(JSON.stringify(window[name].apply(null, args)))); }
          catch (e) { fail({ message: e.message }); }
        }, 30);
      };
    }});
    return p;
  }
  Object.defineProperty(window.google.script, 'run', { get: runner });
})();
</script>
<script src="/dev/mock_gas.js"></script>
%s
<script>
// Seed the mock spreadsheet before the UI boots (Script.html waits for DOMContentLoaded).
(function () {
  var xhr = function (u) { var r = new XMLHttpRequest(); r.open('GET', u, false); r.send(); return r.responseText; };
  setupSpreadsheet();
  try { apiImportCarryForward(xhr('/data/carry_forward.json')); } catch (e) { console.warn('no carry_forward.json', e); }
  try { var r = apiImportCsv(xhr('/data/flights.csv'), { source: 'dev' }); console.log('seeded', r); } catch (e) { console.warn('no flights.csv', e); }
})();
</script>
"""


def build_index():
    html = (SRC / "Index.html").read_text(encoding="utf-8")
    # ?v=<mtime> so the browser never reuses a cached copy of an edited .gs file
    scripts = "\n".join('<script src="/src/%s?v=%d"></script>' % (f, int((SRC / f).stat().st_mtime)) for f in GS_ORDER)
    html = html.replace("<?!= include('Script'); ?>", (SHIM % scripts) + (SRC / "Script.html").read_text(encoding="utf-8"))
    # any other <?!= include('X'); ?> → contents of src/X.html (Style, CrewRules, ...)
    html = re.sub(r"<\?!= include\('(\w+)'\); \?>", lambda m: (SRC / (m.group(1) + ".html")).read_text(encoding="utf-8"), html)
    return html


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            body = build_index().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def guess_type(self, path):
        if path.endswith(".gs"):
            return "application/javascript"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8765))
    print("serving http://localhost:%d/  (root=%s)" % (port, ROOT))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
