/*
 * 공학용계산기 시뮬레이터 - TABLE mode (MODE 7) UI: f(X)= entry, Start?/End?/Step? prompts, X / F(X) table.
 * Extends FX.Calculator (src/ui/calculator.js must be loaded first). DOM-free.
 * Spec: _workspace/01_spec_table.md (한글 매뉴얼 2019판 62~63쪽, 오류표 68쪽).
 * Engine: FX.Adapter.tableCheck / tableParam / tableGenerate (src/engine/table.js). The UI never computes X
 * values or f(X); the cells are the engine's decimal nodes (xNode / fxNode).
 *
 * this.table = { sub: 'fx'|'start'|'end'|'step'|'table', fx: editor row (stored f(X)), io,
 *                start, end, step: engine values (initial 1, 5, 1), pe: Editor of the prompt entry,
 *                rows: engine rows, sel: {r, c}, rowStart, settingsKey }
 * screen === 'table' for every sub. While sub === 'fx', this.ed holds f(X) (same editor as COMP, so MathO
 * templates, INS, DEL, CONST, hyp and DRG menus work; CONV can be keyed in but `=` gives Syntax ERROR, manual p.42).
 *
 * Manual-confirmed: MODE 7 = TABLE; f(X)= entry; Start 1 / End 5 / Step 1 initial values; 2 columns X, F(X);
 *   3 rows visible; selected cell value on the bottom line; AC on the table -> f(X)= with the function kept;
 *   more than 30 X values -> Insufficient MEM; mode change and MathIO<->LineIO change delete f(X); table
 *   generation changes variable X.
 * [가정] (spec 7 미확인): prompts show the last used value and `=` on an empty entry keeps it; AC on a prompt
 *   goes back to f(X)=; ▲▼ move the selected row, ◀▶ the column, no wrap; after a generation error AC / ◀▶
 *   go back to f(X)=; X keeps the last X value (engine lastX); f(X) kept over OFF/ON; display setting
 *   changes while the table is shown regenerate it.
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var Calculator = FX.Calculator;
  if (!Calculator) return;
  var Editor = FX.Editor;

  var VISIBLE_ROWS = 3;
  var HEADS = ['X', 'F(X)'];
  var PROMPTS = { start: 'Start?', end: 'End?', step: 'Step?' };
  var NEXT = { start: 'end', end: 'step' };

  Calculator.prototype._inTable = function () { return this.settings.mode === 'TABLE' && !!this.table; };

  // MODE 7 (fx = f(X) to keep, e.g. after OFF/ON)
  Calculator.prototype._tableEnter = function (fx) {
    var d = FX.Adapter.tableDefaults();
    this.table = { sub: 'fx', fx: fx ? Editor.cloneRow(fx) : [], io: this.settings.io,
      start: d.start, end: d.end, step: d.step, pe: null, rows: null, sel: { r: 0, c: 0 }, rowStart: 0, settingsKey: null };
    this.ed.clear();
    if (fx && fx.length) this.ed.load(Editor.cloneRow(fx), false);
    this.screen = 'table';
  };

  Calculator.prototype._tableToFx = function () {
    var t = this.table;
    t.sub = 'fx'; t.pe = null; t.rows = null;
    this.ed.clear();
    if (t.fx.length) this.ed.load(Editor.cloneRow(t.fx), false);
    this.screen = 'table';
  };

  Calculator.prototype._tableToPrompt = function (sub) {
    var t = this.table;
    t.sub = sub;
    t.pe = new Editor();
    t.pe.lineMode = this.settings.io === 'LineIO';
    this.screen = 'table';
  };

  /* ---------------- keys ---------------- */
  Calculator.prototype._tableKey = function (name, action) {
    var t = this.table;
    if (!t) { this.screen = 'input'; this._editKey(name, action); return; }
    if (!action) return;
    if (action === 'off') { this.powerOff(); return; }
    if (action === 'mode') { this._openMenu('mode'); return; }
    if (action === 'setup') { this._openMenu('setup'); return; }
    if (t.sub === 'table') { this._tableGridKey(action); return; }
    var ed = t.sub === 'fx' ? this.ed : t.pe;
    if (action.indexOf('a:') === 0 || action.indexOf('t:') === 0 || action.indexOf('v:') === 0) {
      this._tableInsert(action);
      return;
    }
    switch (action) {
      case 'dms': this._tableInsert('a:dms'); return;
      case 'left': ed.left(); return;
      case 'right': ed.right(); return;
      case 'up':
      case 'down':
        if (!ed.lineMode) ed.vertical(action === 'up' ? -1 : 1);
        return;
      case 'del': ed.del(); return;
      case 'ins':
        if (ed.lineMode) ed.overwrite = !ed.overwrite; else ed.insWrap = !ed.insWrap;
        return;
      case 'ac':
        if (t.sub === 'fx') this.ed.clear();
        else this._tableToFx();
        return;
      case 'exe':
      case 'exeDec':
        if (t.sub === 'fx') this._tableFxDone(); else this._tablePromptDone();
        return;
      case 'hyp':
      case 'drg':
      case 'clr':
        this._openMenu(action);
        return;
      case 'const':
      case 'conv':
        // CONST is usable in TABLE (manual p.40). CONV is not (manual p.42 "BASE-N과 TABLE 모드 이외"):
        // the key still opens its prompt and inserts the command, and `=` on f(X)= / Start? / End? / Step?
        // gives Syntax ERROR (engine tableCheck / tableParam reject conv tokens). [가정] key not blocked.
        this._openPrompt(action);
        return;
    }
    // CALC, SOLVE, STO, RCL, M+, S⇔D, ENG, SHIFT 1~5 menus: not used in TABLE (ignored)
  };

  // value keys into f(X) or the prompt entry
  Calculator.prototype._tableInsert = function (action) {
    var t = this.table;
    if (!t || t.sub === 'table' || !action) return;
    var ed = t.sub === 'fx' ? this.ed : t.pe;
    var kind = action.slice(0, 2), id = action.slice(2);
    if (kind === 'v:') kind = 'a:';
    if (kind === 'a:' && id === ')' && ed.closeTemplate && ed.closeTemplate()) return;
    if (kind === 't:') ed.insertTemplate(id); else ed.insertAtom(id);
  };

  // `=` on f(X)=: engine check (Pol, Rec, ∫, d/dx, Σ, CONV, empty -> Syntax ERROR), then Start?
  Calculator.prototype._tableFxDone = function () {
    var A = FX.Adapter, t = this.table;
    var expr = this.ed.snapshot();
    var comp = A.compile(expr, this.engineSettings());
    var r = comp.error ? { ok: false, error: comp.error, errorPos: null } : A.tableCheck(comp.tokens);
    if (!r.ok) {
      this._showError({ ok: false, error: r.error || 'Syntax ERROR', errorPos: r.errorPos, srcMap: comp.srcMap }, expr, 0);
      this.error.table = { back: 'fx' };
      return;
    }
    t.fx = Editor.cloneRow(expr);
    t.io = this.settings.io;
    this._tableToPrompt('start');
  };

  // `=` on Start?/End?/Step?: an empty entry keeps the shown value [가정]
  Calculator.prototype._tablePromptDone = function () {
    var A = FX.Adapter, t = this.table, sub = t.sub;
    if (!t.pe.isEmpty()) {
      var expr = t.pe.snapshot();
      var comp = A.compile(expr, this.engineSettings());
      var r = comp.error ? { ok: false, error: comp.error, errorPos: null } : A.tableParam(comp.tokens, this.engineSettings(), this.memory);
      if (!r.ok) {
        this._showError({ ok: false, error: r.error || 'Syntax ERROR', errorPos: r.errorPos, srcMap: comp.srcMap }, expr, 0);
        this.error.table = { back: sub };
        return;
      }
      t[sub] = r.value;
    }
    if (NEXT[sub]) { this._tableToPrompt(NEXT[sub]); return; }
    this._tableGenerate();
  };

  Calculator.prototype._tableGenerate = function () {
    var A = FX.Adapter, t = this.table;
    var comp = A.compile(t.fx, this.engineSettings());
    if (comp.error) {
      this._showError({ ok: false, error: comp.error, errorPos: null }, t.fx, 0);
      this.error.table = { back: 'fx' };
      return;
    }
    var r = A.tableGenerate(comp.tokens, t.start, t.end, t.step, this.engineSettings(), this.memory);
    if (!r.ok && r.missing) {
      this._showMessage(['TABLE engine', 'is not loaded', '(src/engine/table.js)', '[AC]:Back'], { back: 'table' });
      this._tableToFx();
      this.screen = 'message';
      return;
    }
    if (!r.ok) {
      // Insufficient MEM (more than 30 X values), End < Start, Step <= 0 ... : back to f(X)= [가정]
      this._showError({ ok: false, error: r.error || 'Math ERROR', errorPos: r.stage === 'f' ? r.errorPos : null,
        srcMap: comp.srcMap }, t.fx, 0);
      this.error.table = { back: 'fx' };
      return;
    }
    if (r.lastX != null) this.memory.X = r.lastX;      // manual: generating a table changes X
    t.rows = r.rows || [];
    t.sub = 'table';
    t.pe = null;
    t.sel = { r: 0, c: 0 };
    t.rowStart = 0;
    t.settingsKey = JSON.stringify(this.settings);
    this.screen = 'table';
  };

  Calculator.prototype._tableGridKey = function (action) {
    var t = this.table;
    switch (action) {
      case 'up': this._tableMove(-1, 0); return;
      case 'down': this._tableMove(1, 0); return;
      case 'left': this._tableMove(0, -1); return;
      case 'right': this._tableMove(0, 1); return;
      case 'ac': this._tableToFx(); return;
    }
    // the table is view only (manual 63쪽): other keys ignored
    return t;
  };

  Calculator.prototype._tableMove = function (dr, dc) {
    var t = this.table, n = t.rows.length;
    t.sel.r = Math.max(0, Math.min(n - 1, t.sel.r + dr));
    t.sel.c = Math.max(0, Math.min(1, t.sel.c + dc));
    if (t.sel.r < t.rowStart) t.rowStart = t.sel.r;
    if (t.sel.r >= t.rowStart + VISIBLE_ROWS) t.rowStart = t.sel.r - VISIBLE_ROWS + 1;
    t.rowStart = Math.max(0, t.rowStart);
  };

  Calculator.prototype._tableErrorKey = function (action) {
    var err = this.error, t = this.table;
    if (action === 'off') { this.error = null; this.powerOff(); return; }
    if (action !== 'ac' && action !== 'left' && action !== 'right') return;
    this.error = null;
    var back = err.table.back;
    if (back === 'fx') {
      // f(X)= again with the expression that caused the error (AC: cursor at the end, ◀▶: at the error)
      this._tableToFx();
      this.ed.load(Editor.cloneRow(err.expr), false);
      if (action !== 'ac' && err.loc) {
        try { this.ed.rowAt(err.loc.path); this.ed.setCursor(err.loc.path, err.loc.pos); } catch (x) { this.ed.end(); }
      }
      return;
    }
    // Start?/End?/Step? entry error: AC = empty entry, ◀▶ = the entry with the cursor at the error
    this._tableToPrompt(back);
    if (action !== 'ac') {
      t.pe.load(err.expr, false);
      if (err.loc) {
        try { t.pe.rowAt(err.loc.path); t.pe.setCursor(err.loc.path, err.loc.pos); } catch (x2) { t.pe.end(); }
      }
    }
  };

  // after SETUP / CLR / a message closed back onto the TABLE screen
  Calculator.prototype._tableAfterSetup = function () {
    var t = this.table;
    if (!t) return;
    if (t.io !== this.settings.io && (t.io === 'LineIO') !== (this.settings.io === 'LineIO')) {
      // manual 63쪽 중요: changing between natural and linear display deletes f(X)
      t.fx = [];
      t.io = this.settings.io;
      this._tableToFx();
      return;
    }
    t.io = this.settings.io;
    if (t.sub === 'table' && t.settingsKey !== JSON.stringify(this.settings)) {
      var sel = t.sel, rs = t.rowStart;
      this._tableGenerate();                 // cells follow the new display format
      if (this.screen === 'table' && t.sub === 'table') { t.sel = sel; t.rowStart = rs; }
    }
  };

  /* ---------------- display ---------------- */
  function rowCell(row, c) {
    if (!row) return { node: { type: 'text', value: '' }, text: '' };
    var node = c === 0 ? row.xNode : row.fxNode;
    var text = c === 0 ? row.xText : row.fxText;
    if (node == null) node = { type: 'text', value: text != null ? String(text) : '' };
    if (text == null) text = FX.displayText(node);
    return { node: node, text: String(text) };
  }

  Calculator.prototype._tableIndicators = function (ind) {
    var t = this.table;
    if (!t || t.sub !== 'table') return;
    ind.up = t.rowStart > 0;
    ind.down = t.rowStart + VISIBLE_ROWS < t.rows.length;
  };

  Calculator.prototype._tablePromptValue = function () {
    var t = this.table;
    var f = FX.Adapter.formatValue(t[t.sub], this.engineSettings());
    return f ? f : { display: { type: 'text', value: '?' }, text: '?' };
  };

  Calculator.prototype._tableLines = function () {
    var t = this.table;
    if (!t) return [];
    if (t.sub === 'fx') return ['f(X)=' + FX.rowText(this.ed.root)];
    if (PROMPTS[t.sub]) return [PROMPTS[t.sub], t.pe.isEmpty() ? this._tablePromptValue().text : FX.rowText(t.pe.root)];
    var lines = ['  ' + HEADS.join(' ')];
    for (var r = t.rowStart; r < Math.min(t.rowStart + VISIBLE_ROWS, t.rows.length); r++) {
      var cells = [0, 1].map(function (c) {
        var x = rowCell(t.rows[r], c).text;
        return r === t.sel.r && c === t.sel.c ? '[' + x + ']' : x;
      });
      lines.push((r + 1) + ' ' + cells.join(' '));
    }
    lines.push(rowCell(t.rows[t.sel.r], t.sel.c).text);
    return lines;
  };

  Calculator.prototype._tableState = function () {
    var t = this.table;
    var out = { sub: t.sub, fx: FX.rowText(t.fx), rowCount: t.rows ? t.rows.length : 0 };
    var A = FX.Adapter, es = this.engineSettings();
    ['start', 'end', 'step'].forEach(function (k) {
      var f = A.formatValue(t[k], es);
      out[k] = f ? f.text : null;
    });
    if (t.sub === 'table') {
      out.cols = HEADS.slice();
      out.sel = { r: t.sel.r, c: t.sel.c };
      out.rowStart = t.rowStart;
      out.rows = t.rows.map(function (row) { return [rowCell(row, 0).text, rowCell(row, 1).text]; });
    }
    return out;
  };

  // structure for render.js
  Calculator.prototype._tableScreen = function () {
    var t = this.table;
    if (t.sub === 'fx') {
      return { sub: 'fx', label: 'f(X)=', expr: this.ed.root,
        cursor: { path: this.ed.cur.path, pos: this.ed.cur.pos, style: this.ed.cursorStyle() } };
    }
    if (PROMPTS[t.sub]) {
      var pe = t.pe;
      return { sub: 'prompt', label: PROMPTS[t.sub], value: pe.isEmpty() ? this._tablePromptValue().display : null,
        expr: pe.root, cursor: { path: pe.cur.path, pos: pe.cur.pos, style: pe.cursorStyle() } };
    }
    var rows = [];
    for (var r = t.rowStart; r < Math.min(t.rowStart + VISIBLE_ROWS, t.rows.length); r++) {
      rows.push({ num: r + 1, cells: [0, 1].map(function (c) {
        return { node: rowCell(t.rows[r], c).node, sel: r === t.sel.r && c === t.sel.c };
      }) });
    }
    return { sub: 'edit', heads: HEADS.slice(), rows: rows, bottom: { node: rowCell(t.rows[t.sel.r], t.sel.c).node },
      moreLeft: false, moreRight: false };
  };

  Calculator.TABLE_VISIBLE_ROWS = VISIBLE_ROWS;
})(typeof window !== 'undefined' ? window : globalThis);
