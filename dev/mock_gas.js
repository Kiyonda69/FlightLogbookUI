/**
 * mock_gas.js — minimal in-memory stand-ins for the Apps Script globals used by src/*.gs
 * (SpreadsheetApp, Utilities, LockService, HtmlService). Used by tools/test_logic.js (Node)
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
  Range.prototype.setValues = function (vals) {
    for (var i = 0; i < vals.length; i++) {
      while (this.s.rows.length < this.r + i) this.s.rows.push([]);
      var row = this.s.rows[this.r - 1 + i];
      for (var j = 0; j < vals[i].length; j++) row[this.c - 1 + j] = vals[i][j];
    }
    return this;
  };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment',
    'setWrap', 'merge', 'setBorder'].forEach(function (m) { Range.prototype[m] = function () { return this; }; });

  var sheetIdSeq = 100;
  function Sheet(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.id = sheetIdSeq++; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getSheetId = function () { return this.id; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
    return 0;
  };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.appendRow = function (r) { this.rows.push(r.slice()); return this; };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); return this; };
  Sheet.prototype.clear = function () { this.rows = []; return this; };
  ['setFrozenRows', 'hideColumns', 'setColumnWidths', 'setColumnWidth'].forEach(function (m) { Sheet.prototype[m] = function () { return this; }; });

  function Spreadsheet() { this.sheets = []; }
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  Spreadsheet.prototype.insertSheet = function (n) { var s = new Sheet(this, n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/MOCK'; };

  var active = new Spreadsheet();
  g.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return active; },
    getUi: function () { var m = { addItem: function () { return m; }, addToUi: function () {} }; return { createMenu: function () { return m; } }; }
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
  g.ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: function (text) {
      var o = { _text: text, _mime: 'text/plain' };
      o.setMimeType = function (m) { o._mime = m; return o; };
      o.getContent = function () { return o._text; };
      return o;
    }
  };
  g.Logger = { log: function () { if (g.console) g.console.log.apply(g.console, arguments); } };
  Spreadsheet.prototype.getName = function () { return 'MOCK 飛行日誌'; };
  g.HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: function () { return { evaluate: function () { var o = { setTitle: function () { return o; }, addMetaTag: function () { return o; }, setXFrameOptionsMode: function () { return o; } }; return o; } }; },
    createHtmlOutputFromFile: function () { return { getContent: function () { return ''; } }; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
