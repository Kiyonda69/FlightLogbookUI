/**
 * mock_gas.js — minimal in-memory stand-ins for the Apps Script globals used by src/*.gs
 * (SpreadsheetApp, Utilities, LockService, HtmlService, ScriptApp triggers). Used by tools/test_logic.js (Node)
 * and dev/serve.py (browser preview). NOT deployed to Apps Script.
 */
(function (g) {
  function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.nr; i++) {
      var row = this.s.rows[this.r - 1 + i] || [];
      var line = [];
      for (var j = 0; j < this.nc; j++) line.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(line);
    }
    return out;
  };
  // Simulates Sheets' automatic type conversion: a string that looks like a number or a clock
  // written into a cell whose number format is not text ('@') becomes a Number.
  function coerce(sheet, r, c, v) {
    if (typeof v !== 'string') return v;
    var fmt = sheet.formats[r + ',' + c];
    if (fmt === '@') return v;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    var neg = v.match(/^\((\d+(\.\d+)?)\)$/);               // accounting style: "(1)" → -1
    if (neg) return -Number(neg[1]);
    var m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return (Number(m[1]) * 60 + Number(m[2])) / 1440;
    var d = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);          // "2027-04-07" → Date (local midnight), as Sheets does
    if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
    return v;
  }
  Range.prototype.setValues = function (vals) {
    for (var i = 0; i < vals.length; i++) {
      while (this.s.rows.length < this.r + i) this.s.rows.push([]);
      var row = this.s.rows[this.r - 1 + i];
      for (var j = 0; j < vals[i].length; j++) row[this.c - 1 + j] = coerce(this.s, this.r + i, this.c + j, vals[i][j]);
    }
    return this;
  };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.getSheet = function () { return this.s; };
  Range.prototype.getRow = function () { return this.r; };
  Range.prototype.getColumn = function () { return this.c; };
  Range.prototype.getNumRows = function () { return this.nr; };
  Range.prototype.getNumColumns = function () { return this.nc; };
  // Backgrounds / notes are stored per cell so tests can assert onEdit marks (null bg = default).
  Range.prototype.setBackgrounds = function (bgs) {
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s.backgrounds[(this.r + i) + ',' + (this.c + j)] = bgs[i][j];
    return this;
  };
  Range.prototype.setNotes = function (notes) {
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s.notes[(this.r + i) + ',' + (this.c + j)] = notes[i][j];
    return this;
  };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  Range.prototype.setNumberFormat = function (fmt) {
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s.formats[(this.r + i) + ',' + (this.c + j)] = fmt;
    return this;
  };
  ['setFontWeight', 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment',
    'setWrap', 'setFontFamily', 'setFontSize', 'setFontColor'].forEach(function (m) { Range.prototype[m] = function () { return this; }; });
  // Borders are counted per call so tests can assert the design was applied.
  Range.prototype.setBorder = function () { this.s.borderCalls.push([this.r, this.c, this.nr, this.nc].concat(Array.prototype.slice.call(arguments))); return this; };
  // Merges are recorded so tests can check that header merges are (re)built.
  Range.prototype.merge = function () { this.s.merges.push([this.r, this.c, this.nr, this.nc]); return this; };
  Range.prototype.mergeVertically = function () { for (var j = 0; j < this.nc; j++) this.s.merges.push([this.r, this.c + j, this.nr, 1]); return this; };
  Range.prototype.breakApart = function () { this.s.merges = []; return this; };

  // A1 "B3:AC20" -> Range
  function a1ToRange(sheet, a1) {
    var m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) throw new Error('bad A1: ' + a1);
    var col = function (s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; };
    var c1 = col(m[1]), r1 = Number(m[2]), c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
    return new Range(sheet, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }
  function RangeList(ranges) { this.ranges = ranges; }
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment', 'setWrap', 'setBorder',
    'setFontFamily', 'setFontSize', 'setFontColor']
    .forEach(function (m) { RangeList.prototype[m] = function () { var a = arguments; this.ranges.forEach(function (r) { r[m].apply(r, a); }); return this; }; });
  RangeList.prototype.getRanges = function () { return this.ranges; };

  var sheetIdSeq = 100;
  function Sheet(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.formats = {}; this.merges = []; this.borderCalls = []; this.rowHeights = {}; this.colWidths = {}; this.backgrounds = {}; this.notes = {}; this.maxRows = 1000; this.maxCols = 26; this.id = sheetIdSeq++; }
  Sheet.prototype.getRangeList = function (a1s) { var s = this; return new RangeList(a1s.map(function (a) { return a1ToRange(s, a); })); };
  Sheet.prototype.insertRowsAfter = function (after, n) { this.maxRows += n; return this; };
  Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; return this; };
  Sheet.prototype.setRowHeights = function (r, n, h) { for (var i = 0; i < n; i++) this.rowHeights[r + i] = h; return this; };
  Sheet.prototype.setRowHeight = function (r, h) { this.rowHeights[r] = h; return this; };
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getSheetId = function () { return this.id; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
    return 0;
  };
  Sheet.prototype.getMaxRows = function () { return Math.max(this.maxRows, this.rows.length); };
  Sheet.prototype.getLastColumn = function () {
    var n = 0;
    this.rows.forEach(function (r) { for (var j = r.length - 1; j >= 0; j--) { if (r[j] !== '' && r[j] !== undefined && r[j] !== null) { n = Math.max(n, j + 1); break; } } });
    return n;
  };
  Sheet.prototype.appendRow = function (r) { this.rows.push(r.slice()); return this; };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); return this; };
  Sheet.prototype.clear = function () { this.rows = []; this.formats = {}; this.borderCalls = []; return this; }; // merges survive clear(), as in Sheets
  ['setFrozenRows', 'hideColumns'].forEach(function (m) { Sheet.prototype[m] = function () { return this; }; });
  Sheet.prototype.setColumnWidth = function (c, w) { this.colWidths[c] = w; return this; };
  Sheet.prototype.setColumnWidths = function (c, n, w) { for (var i = 0; i < n; i++) this.colWidths[c + i] = w; return this; };

  function Spreadsheet() { this.sheets = []; }
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  Spreadsheet.prototype.insertSheet = function (n) { var s = new Sheet(this, n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/MOCK'; };

  var active = new Spreadsheet();
  // Ui mock: prompt() answers with g.__mockPromptText (OK) or cancels when it is null.
  g.__mockPromptText = null; g.__mockAlerts = [];
  g.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return active; },
    flush: function () {},
    BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK', DOTTED: 'DOTTED', DASHED: 'DASHED', DOUBLE: 'DOUBLE' },
    getUi: function () {
      var m = { addItem: function () { return m; }, addToUi: function () {} };
      return {
        Button: { OK: 'OK', CANCEL: 'CANCEL' }, ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
        createMenu: function () { return m; },
        prompt: function () {
          var t = g.__mockPromptText;
          return { getSelectedButton: function () { return t === null ? 'CANCEL' : 'OK'; }, getResponseText: function () { return t || ''; } };
        },
        alert: function () { g.__mockAlerts.push(Array.prototype.slice.call(arguments)); }
      };
    }
  };
  // DriveApp mock: g.__mockDriveFiles = { 'name.json': 'contents' }
  g.__mockDriveFiles = {};
  g.DriveApp = {
    getFilesByName: function (name) {
      var list = g.__mockDriveFiles.hasOwnProperty(name) ? [name] : [];
      return {
        hasNext: function () { return list.length > 0; },
        next: function () { var n = list.shift(); return { getName: function () { return n; }, getBlob: function () { return { getDataAsString: function () { return g.__mockDriveFiles[n]; } }; } }; }
      };
    }
  };
  g.__mockSpreadsheet = active;

  g.Utilities = {
    getUuid: function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
    },
    parseCsv: function (text) {
      var rows = [], row = [], field = '', q = false;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (q) {
          if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
          else field += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      return rows;
    }
  };
  g.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  var props = {};
  g.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return props.hasOwnProperty(k) ? props[k] : null; },
        setProperty: function (k, v) { props[k] = String(v); return this; },
        deleteProperty: function (k) { delete props[k]; return this; }
      };
    }
  };
  var cache = {};
  g.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { var e = cache[k]; if (!e) return null; if (e.exp < Date.now()) { delete cache[k]; return null; } return e.v; },
        put: function (k, v, sec) { cache[k] = { v: String(v), exp: Date.now() + (sec || 600) * 1000 }; },
        remove: function (k) { delete cache[k]; }
      };
    }
  };
  g.ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: function (text) {
      var o = { _text: text, _mime: 'text/plain' };
      o.setMimeType = function (m) { o._mime = m; return o; };
      o.getContent = function () { return o._text; };
      return o;
    }
  };
  // ScriptApp mock: installable triggers are kept in g.__mockTriggers (handler + time spec).
  g.__mockTriggers = [];
  g.ScriptApp = {
    getProjectTriggers: function () { return g.__mockTriggers.slice(); },
    deleteTrigger: function (t) { g.__mockTriggers = g.__mockTriggers.filter(function (x) { return x !== t; }); },
    newTrigger: function (fn) {
      var spec = { handler: fn };
      var b = {
        timeBased: function () { return b; },
        everyDays: function (n) { spec.everyDays = n; return b; },
        atHour: function (h) { spec.atHour = h; return b; },
        create: function () { var t = { spec: spec, getHandlerFunction: function () { return fn; } }; g.__mockTriggers.push(t); return t; }
      };
      return b;
    }
  };
  g.Logger = { log: function () { if (g.console) g.console.log.apply(g.console, arguments); } };
  Spreadsheet.prototype.getName = function () { return 'MOCK 飛行日誌'; };
  g.HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: function () { return { evaluate: function () { var o = { setTitle: function () { return o; }, addMetaTag: function () { return o; }, setXFrameOptionsMode: function () { return o; } }; return o; } }; },
    // Node hosts set g.__srcFiles = { CrewRules: '<script>...</script>' } so server code can read HTML files.
    createHtmlOutputFromFile: function (name) { return { getContent: function () { return (g.__srcFiles || {})[name] || ''; } }; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
