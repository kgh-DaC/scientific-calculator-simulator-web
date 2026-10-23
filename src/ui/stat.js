/*
 * 공학용계산기 시뮬레이터 - STAT mode (MODE 3) UI: type menu, statistics editor, SHIFT 1 menus.
 * Extends FX.Calculator (src/ui/calculator.js must be loaded first). DOM-free.
 * Spec: 카시오 한글 매뉴얼(2019판) "통계 계산(STAT)", fx-570ESPLUS_991ESPLUS_KO.pdf 45~53쪽.
 *
 * this.stat = { sub: 'menu'|'edit'|'calc', type, rows:[{x,y,f}], sel:{r,c}, rowStart, editing, page, freq, prev }
 *   cell = { value: engine Value | null, cache }
 * Screens: 'menu' (type menu) and 'edit' (data editor) use calculator.screen === 'stat';
 *          'calc' is the ordinary input/result screen with settings.mode === 'STAT' (SHIFT 1 menus insert
 *          statistics atoms: st:<name> values, sp:<name> estimate commands, sf:<name>( normal-distribution functions).
 * Statistics are computed by the engine (CalcEngine.statAnalyze) from the editor rows each time an
 * expression is evaluated; the UI never computes any statistic itself.
 *
 * Manual-confirmed (2019판 46~47쪽): calculation-screen SHIFT 1 menu 1 Type 2 Data 3 Sum 4 Var 5 Distr|Reg 6 MinMax;
 *   editor SHIFT 1 menu has 3 Edit (Edit: 1 Ins 2 Del-A); DEL on a cell (not editing) deletes the row.
 *   STAT entry switches to LineIO (calculator.js, 12쪽 주의); X entry fills Y with 0 (46쪽 예 1); cells ignore Fix (51쪽 예 3).
 * [미확인]: editor menu items after 3:Edit; restoring the display format when leaving STAT (restored);
 *   Sci in cells and the bottom-line format (treated like Fix: not applied).
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var Calculator = FX.Calculator;
  if (!Calculator) return;
  var Editor = FX.Editor;

  var TYPES = ['var1', 'lin', 'quad', 'log', 'exp', 'ab', 'pow', 'inv'];
  var TYPE_LABEL = ['1-VAR', 'A+BX', '_+CX²', 'ln X', 'e^X', 'A•B^X', 'A•X^B', '1/X'];
  var TYPE_PAGES = [['1:1-VAR', '2:A+BX', '3:_+CX²', '4:ln X'], ['5:e^X', '6:A•B^X', '7:A•X^B', '8:1/X']];
  var VISIBLE_ROWS = 3;
  var HEADS = { x: 'X', y: 'Y', f: 'FREQ' };

  /* ---------------- atom labels ---------------- */
  var LABEL = {
    'st:n': 'n', 'st:sumx': 'Σx', 'st:sumx2': 'Σx²', 'st:sumy': 'Σy', 'st:sumy2': 'Σy²', 'st:sumxy': 'Σxy',
    'st:sumx3': 'Σx³', 'st:sumx2y': 'Σx²y', 'st:sumx4': 'Σx⁴',
    'st:meanx': 'x̄', 'st:sigx': 'σx', 'st:sx': 'sx', 'st:meany': 'ȳ', 'st:sigy': 'σy', 'st:sy': 'sy',
    'st:A': 'A', 'st:B': 'B', 'st:C': 'C', 'st:r': 'r',
    'st:minx': 'minX', 'st:maxx': 'maxX', 'st:miny': 'minY', 'st:maxy': 'maxY',
    'sp:xhat': 'x̂', 'sp:xhat1': 'x̂1', 'sp:xhat2': 'x̂2', 'sp:yhat': 'ŷ', 'sp:tnorm': '▸t',
    'sf:normP(': 'P(', 'sf:normQ(': 'Q(', 'sf:normR(': 'R('
  };
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  FX.StatLabels = {
    text: function (id) { return LABEL[id] || id; },
    html: function (id) { return '<span class="stl">' + escH(LABEL[id] || id) + '</span>'; },
    ids: LABEL
  };

  /* ---------------- menus (SHIFT 1) ---------------- */
  var SUM1 = [['Σx²', 'st:sumx2'], ['Σx', 'st:sumx']];
  var SUM2 = [['Σx²', 'st:sumx2'], ['Σx', 'st:sumx'], ['Σy²', 'st:sumy2'], ['Σy', 'st:sumy'], ['Σxy', 'st:sumxy'],
    ['Σx³', 'st:sumx3'], ['Σx²y', 'st:sumx2y'], ['Σx⁴', 'st:sumx4']];
  var VAR1 = [['n', 'st:n'], ['x̄', 'st:meanx'], ['σx', 'st:sigx'], ['sx', 'st:sx']];
  var VAR2 = VAR1.concat([['ȳ', 'st:meany'], ['σy', 'st:sigy'], ['sy', 'st:sy']]);
  var DISTR = [['P(', 'sf:normP('], ['Q(', 'sf:normQ('], ['R(', 'sf:normR('], ['▸t', 'sp:tnorm']];
  var REG = [['A', 'st:A'], ['B', 'st:B'], ['r', 'st:r'], ['x̂', 'sp:xhat'], ['ŷ', 'sp:yhat']];
  var REGQ = [['A', 'st:A'], ['B', 'st:B'], ['C', 'st:C'], ['x̂1', 'sp:xhat1'], ['x̂2', 'sp:xhat2'], ['ŷ', 'sp:yhat']];
  var MINMAX1 = [['minX', 'st:minx'], ['maxX', 'st:maxx']];
  var MINMAX2 = MINMAX1.concat([['minY', 'st:miny'], ['maxY', 'st:maxy']]);

  function numbered(list) { return list.map(function (it, i) { return (i + 1) + ':' + it[0]; }); }

  Calculator.prototype._statTwo = function () { return this.stat.type !== 'var1'; };

  // item list of the submenu `id` for the current type
  Calculator.prototype._statSubItems = function (id) {
    var two = this._statTwo();
    switch (id) {
      case 'stm:sum': return two ? SUM2 : SUM1;
      case 'stm:var': return two ? VAR2 : VAR1;
      case 'stm:distr': return DISTR;
      case 'stm:reg': return this.stat.type === 'quad' ? REGQ : REG;
      case 'stm:minmax': return two ? MINMAX2 : MINMAX1;
    }
    return [];
  };

  /* ---------------- session ---------------- */
  var MAX_ROWS = { x: 80, xf: 40, xy: 40, xyf: 26 };

  Calculator.prototype._statCols = function () {
    var cols = this._statTwo() ? ['x', 'y'] : ['x'];
    if (this.settings.statFreq) cols.push('f');
    return cols;
  };
  Calculator.prototype._statMaxRows = function () {
    var c = this._statCols();
    return MAX_ROWS[(c.indexOf('y') >= 0 ? 'xy' : 'x') + (c.indexOf('f') >= 0 ? 'f' : '')];
  };

  // MODE 3: type menu. prev = the session being replaced (kept if the same type is chosen again)
  Calculator.prototype._statEnter = function (prev) {
    this.stat = { sub: 'menu', type: null, rows: [], sel: { r: 0, c: 0 }, rowStart: 0, editing: false, page: 0,
      freq: this.settings.statFreq, prev: prev && prev.type ? prev : null };
    if (this.stat.prev) this.stat.prev.prev = null;
    this.ed.clear();
    this.screen = 'stat';
  };

  Calculator.prototype._statSelectType = function (idx) {
    var st = this.stat, type = TYPES[idx];
    var prev = st.prev;
    // 1-var <-> 2-var deletes the data (manual); between 2-variable types the data stay
    var keep = prev && (prev.type === 'var1') === (type === 'var1') ? prev.rows : [];
    st.type = type; st.rows = keep; st.sub = 'edit'; st.editing = false; st.sel = { r: 0, c: 0 }; st.rowStart = 0;
    st.prev = null; st.freq = this.settings.statFreq;
    this.ed.clear();
    this.screen = 'stat';
  };

  // a changed Stat format (SETUP ▼ 4) deletes the data (manual: 중요!)
  Calculator.prototype._statSync = function () {
    var st = this.stat;
    if (!st) return;
    if (st.freq !== this.settings.statFreq) {
      st.freq = this.settings.statFreq;
      st.rows = []; st.sel = { r: 0, c: 0 }; st.rowStart = 0; st.editing = false;
      if (this.screen === 'stat') this.ed.clear();
    }
  };
  Calculator.prototype._statAfterSetup = function () {
    this._statSync();
    var st = this.stat;
    if (st && st.sub === 'edit' && st.editing && this.ed.lineMode !== (this.settings.io === 'LineIO')) this._statCancelEdit();
  };

  Calculator.prototype._statToCalc = function () {
    var st = this.stat;
    this._statCancelEdit();
    st.sub = 'calc';
    this.ed.clear();
    this._toInput();
  };

  Calculator.prototype._statCancelEdit = function () {
    if (this.stat) this.stat.editing = false;
    this.ed.clear();
  };

  /* ---------------- keys on the 'stat' screen ---------------- */
  Calculator.prototype._statKey = function (name, action) {
    var st = this.stat;
    if (!st) { this.screen = 'input'; this._editKey(name, action); return; }
    this._statSync();
    if (!action) return;
    if (action === 'off') { this.powerOff(); return; }
    if (action === 'mode') { this._openMenu('mode'); return; }
    if (action === 'setup') { this._openMenu('setup'); return; }
    if (st.sub === 'menu') {
      var d = /^[0-9]$/.test(name) ? parseInt(name, 10) : null;
      if (d >= 1 && d <= 8) { this._statSelectType(d - 1); return; }
      if (name === '▼') { st.page = Math.min(1, st.page + 1); return; }
      if (name === '▲') { st.page = Math.max(0, st.page - 1); return; }
      // AC on the type menu: back to the data being edited before MODE 3 / SHIFT 1 1 [미확인]
      if (action === 'ac' && st.prev) {
        var p = st.prev, back = st.back;
        p.sub = back === 'calc' ? 'calc' : 'edit'; p.editing = false; p.page = 0;
        this.stat = p;
        this.ed.clear();
        if (p.sub === 'calc') this._toInput();
      }
      return;
    }
    this._statEditKey(name, action);
  };

  Calculator.prototype._statEditKey = function (name, action) {
    var st = this.stat, ed = this.ed;
    if (action === 'modeOnly:STAT') { this._statEditorMenuOpen(); return; }
    if (action.indexOf('a:') === 0 || action.indexOf('t:') === 0 || action.indexOf('v:') === 0) {
      this._statInsert(action);
      return;
    }
    switch (action) {
      case 'dms': this._statInsert('a:dms'); return;
      case 'left':
      case 'right':
        if (st.editing) { if (action === 'left') ed.left(); else ed.right(); }
        else this._statMove(0, action === 'left' ? -1 : 1);
        return;
      case 'up':
      case 'down':
        if (st.editing && !ed.lineMode && ed.vertical(action === 'up' ? -1 : 1)) return;
        if (st.editing) this._statCancelEdit();
        this._statMove(action === 'up' ? -1 : 1, 0);
        return;
      case 'del':
        if (st.editing) ed.del();
        else this._statDeleteRow();
        return;
      case 'ac':
        this._statToCalc();                    // the statistics calculation screen
        return;
      case 'exe':
      case 'exeDec':
        this._statCommit();
        return;
    }
    // M+, STO, RCL, CALC, SOLVE, hyp, DRG, CONST, CONV, ...: not supported in the editor (manual)
  };

  Calculator.prototype._statInsert = function (action) {
    var st = this.stat;
    if (!st || st.sub !== 'edit' || !action) return;
    var kind = action.slice(0, 2), id = action.slice(2);
    if (id === 'Pol(' || id === 'Rec(' || id === ':' || /^(st|sp|sf):/.test(id)) return;   // manual: cannot be entered
    if (!st.editing) { this.ed.clear(); st.editing = true; }
    if (kind === 'a:' && id === ')' && this.ed.closeTemplate()) return;
    if (kind === 't:') this.ed.insertTemplate(id); else this.ed.insertAtom(id);
  };

  Calculator.prototype._statMove = function (dr, dc) {
    var st = this.stat, cols = this._statCols();
    var limit = Math.min(this._statMaxRows() - 1, st.rows.length);   // one blank row below the data
    st.sel.r = Math.max(0, Math.min(limit, st.sel.r + dr));
    st.sel.c = Math.max(0, Math.min(cols.length - 1, st.sel.c + dc));
    this._statScroll();
  };
  Calculator.prototype._statScroll = function () {
    var st = this.stat;
    if (st.sel.r < st.rowStart) st.rowStart = st.sel.r;
    if (st.sel.r >= st.rowStart + VISIBLE_ROWS) st.rowStart = st.sel.r - VISIBLE_ROWS + 1;
    st.rowStart = Math.max(0, st.rowStart);
  };

  function blankRow() { return { x: null, y: null, f: null }; }
  function oneValue() { return G.CalcEngine && G.CalcEngine.fromInput ? G.CalcEngine.fromInput('1') : 1; }
  function zeroValue() { return G.CalcEngine && G.CalcEngine.fromInput ? G.CalcEngine.fromInput('0') : 0; }

  Calculator.prototype._statCell = function (r, c) {
    var row = this.stat.rows[r];
    return row ? row[this._statCols()[c]] : null;
  };

  // `=` with an entry: evaluate the cell (engine evalCoeff), store, move to the next row (same column)
  Calculator.prototype._statCommit = function () {
    var A = FX.Adapter, st = this.stat;
    var cols = this._statCols(), key = cols[st.sel.c];
    if (st.editing && !this.ed.isEmpty()) {
      var expr = this.ed.snapshot();
      var comp = A.compile(expr, this.engineSettings());
      var r = comp.error ? { ok: false, error: comp.error, errorPos: null }
        : A.evalCoeff(comp.tokens, this.engineSettings(), this.memory);
      if (!r.ok) {
        r.srcMap = comp.srcMap;
        this._showError(r, expr, 0);
        this.error.stat = true;
        return;
      }
      while (st.rows.length <= st.sel.r) st.rows.push(blankRow());
      var row = st.rows[st.sel.r];
      row[key] = { value: r.value, cache: null };
      // a new X fills the same row: Y with 0 (manual 46쪽 예 1 둘째 화면), FREQ with 1
      if (key === 'x' && cols.indexOf('y') >= 0 && !row.y) row.y = { value: zeroValue(), cache: null };
      if (key === 'x' && cols.indexOf('f') >= 0 && !row.f) row.f = { value: oneValue(), cache: null };
    }
    this._statCancelEdit();
    var limit = Math.min(this._statMaxRows() - 1, st.rows.length);
    if (st.sel.r < limit) { st.sel.r++; this._statScroll(); }
  };

  Calculator.prototype._statDeleteRow = function () {
    var st = this.stat;
    if (st.sel.r < st.rows.length) st.rows.splice(st.sel.r, 1);
    var limit = Math.min(this._statMaxRows() - 1, st.rows.length);
    st.sel.r = Math.min(st.sel.r, limit);
    this._statScroll();
  };

  Calculator.prototype._statErrorKey = function (action) {
    var err = this.error;
    if (action === 'off') { this.error = null; this.powerOff(); return; }
    if (action !== 'ac' && action !== 'left' && action !== 'right') return;
    this.error = null;
    this.screen = 'stat';
    this._statCancelEdit();
    if (action !== 'ac') {
      this.ed.load(err.expr, false);
      if (err.loc) {
        try { this.ed.rowAt(err.loc.path); this.ed.setCursor(err.loc.path, err.loc.pos); } catch (x) { this.ed.end(); }
      }
      this.stat.editing = true;
    }
  };

  /* ---------------- SHIFT 1 menus ---------------- */
  // from the statistics calculation screen
  Calculator.prototype._statMenuOpen = function () {
    var two = this._statTwo();
    var items = ['1:Type', '2:Data', '3:Sum', '4:Var', two ? '5:Reg' : '5:Distr', '6:MinMax'];
    this._openMenu('stm:main', { itemPages: [items] });
  };
  // from the data editor
  // manual 46쪽: Ins = SHIFT 1 3(Edit) 1, Del-A = SHIFT 1 3(Edit) 2; 1 Type / 2 Data as on the calculation
  // screen menu (47쪽). Items after 3 (Sum, Var, ... on the real unit?) are not shown in the manual [미확인].
  Calculator.prototype._statEditorMenuOpen = function () {
    this._openMenu('stm:ed', { itemPages: [['1:Type', '2:Data', '3:Edit']] });
  };

  Calculator.prototype._statMenuKey = function (name, action, d) {
    var m = this.menu, st = this.stat;
    if (d === null) return;
    switch (m.id) {
      case 'stm:main':
        if (d === 1) { this._statGoType('calc'); return; }
        if (d === 2) { this._closeMenu(false); this._statGoEdit(); return; }
        var sub = { 3: 'stm:sum', 4: 'stm:var', 5: this._statTwo() ? 'stm:reg' : 'stm:distr', 6: 'stm:minmax' }[d];
        if (!sub) return;
        var items = this._statSubItems(sub);
        this._openMenu(sub, { itemPages: [numbered(items)], items: items });
        return;
      case 'stm:ed':
        if (d === 1) { this._statGoType('edit'); return; }
        if (d === 2) { this._closeMenu(false); this._statGoEdit(); return; }
        if (d === 3) { this._openMenu('stm:edit', { itemPages: [['1:Ins', '2:Del-A']] }); return; }
        return;
      case 'stm:edit':
        if (d === 1 || d === 2) {
          this._closeMenu(false);
          this._statCancelEdit();
          if (d === 1) { if (st.rows.length < this._statMaxRows() && st.sel.r <= st.rows.length) st.rows.splice(st.sel.r, 0, blankRow()); }
          else { st.rows = []; st.sel = { r: 0, c: 0 }; st.rowStart = 0; }
        }
        return;
      default:
        // value submenus: insert the statistics atom
        if (m.items && d >= 1 && d <= m.items.length) {
          var atom = m.items[d - 1][1];
          this._closeMenu(false);
          this._insert('a:' + atom, this.screen === 'result');
        }
    }
  };

  // SHIFT 1 1 (Type): the type menu; the data stay if the chosen type has the same number of variables
  Calculator.prototype._statGoType = function (back) {
    var st = this.stat;
    this.menu = null;
    this._statCancelEdit();
    this.stat = { sub: 'menu', type: st.type, rows: st.rows, sel: st.sel, rowStart: st.rowStart, editing: false, page: 0,
      freq: st.freq, prev: st, back: back };
    this.stat.prev.prev = null;
    this.screen = 'stat';
  };

  Calculator.prototype._statGoEdit = function () {
    var st = this.stat;
    st.sub = 'edit'; st.editing = false;
    this.ed.clear();
    this.screen = 'stat';
  };

  /* ---------------- engine call ---------------- */
  Calculator.prototype._statAnalysis = function () {
    this._statSync();
    var st = this.stat, cols = this._statCols();
    var rows = st.rows.map(function (r) {
      return { x: r.x ? r.x.value : null, y: r.y ? r.y.value : null, f: cols.indexOf('f') >= 0 && r.f ? r.f.value : null };
    });
    return FX.Adapter.statAnalyze(st.type, rows);
  };

  /* ---------------- display ---------------- */
  Calculator.prototype._statCellNode = function (cell) {
    if (!cell) return { node: { type: 'text', value: '' }, text: '' };
    // editor cells ignore Fix (manual 51쪽 예 3: FIX on, cells 200 / 8800). Sci is treated the same and the
    // bottom line (selected cell value) uses the same form [미확인]. Norm 1/2 stay as set.
    var es = this.engineSettings();
    if (es.format.type === 'fix' || es.format.type === 'sci') es.format = { type: 'norm1', digits: null };
    var key = JSON.stringify(es);
    if (!cell.cache || cell.cache.key !== key) {
      var f = FX.Adapter.formatValue(cell.value, es);
      cell.cache = { key: key, node: f ? f.display : { type: 'text', value: '?' }, text: f ? f.text : '?' };
    }
    return cell.cache;
  };

  Calculator.prototype._statIndicators = function (ind) {
    var st = this.stat;
    if (st.sub === 'menu') { ind.down = st.page < 1; ind.up = st.page > 0; return; }
    var total = Math.min(this._statMaxRows(), st.rows.length + 1);
    ind.up = st.rowStart > 0;
    ind.down = st.rowStart + VISIBLE_ROWS < total;
  };

  Calculator.prototype._statLines = function () {
    var st = this.stat;
    if (!st) return [];
    this._statSync();
    if (st.sub === 'menu') {
      var items = TYPE_PAGES[st.page], menu = [];
      for (var i = 0; i < items.length; i += 2) menu.push((items[i] + '          ').slice(0, 10) + (items[i + 1] || ''));
      return menu;
    }
    var cols = this._statCols(), self = this;
    var lines = ['  ' + cols.map(function (c) { return HEADS[c]; }).join(' ')];
    for (var r = st.rowStart; r < Math.min(st.rowStart + VISIBLE_ROWS, this._statMaxRows()); r++) {
      var cells = cols.map(function (c, ci) {
        var t = self._statCellNode(self._statCell(r, ci)).text;
        return r === st.sel.r && ci === st.sel.c ? '[' + t + ']' : t;
      });
      lines.push((r + 1) + ' ' + cells.join(' '));
    }
    lines.push(st.editing ? FX.rowText(this.ed.root) : this._statCellNode(this._statCell(st.sel.r, st.sel.c)).text);
    return lines;
  };

  Calculator.prototype._statState = function () {
    var st = this.stat;
    this._statSync();
    var out = { sub: st.sub, type: st.type, typeLabel: st.type ? TYPE_LABEL[TYPES.indexOf(st.type)] : null,
      rowCount: st.rows.length, editing: st.editing };
    if (st.type && st.sub !== 'menu') {
      var self = this, cols = this._statCols();
      out.cols = cols.map(function (c) { return HEADS[c]; });
      out.sel = { r: st.sel.r, c: st.sel.c };
      out.rows = st.rows.map(function (r) {
        return cols.map(function (c) { return self._statCellNode(r[c]).text; });
      });
    }
    return out;
  };

  // structure for render.js (same shape as the EQN coefficient grid)
  Calculator.prototype._statScreen = function () {
    var st = this.stat;
    if (!st || st.sub === 'menu') return { sub: 'menu' };
    this._statSync();
    var cols = this._statCols(), self = this, rows = [];
    for (var r = st.rowStart; r < Math.min(st.rowStart + VISIBLE_ROWS, this._statMaxRows()); r++) {
      var cells = cols.map(function (c, ci) {
        return { node: self._statCellNode(self._statCell(r, ci)).node, sel: r === st.sel.r && ci === st.sel.c };
      });
      rows.push({ num: r + 1, cells: cells });
    }
    var bottom = st.editing
      ? { expr: this.ed.root, cursor: { path: this.ed.cur.path, pos: this.ed.cur.pos, style: this.ed.cursorStyle() } }
      : { node: this._statCellNode(this._statCell(st.sel.r, st.sel.c)).node };
    return { sub: 'edit', heads: cols.map(function (c) { return HEADS[c]; }), rows: rows, bottom: bottom,
      moreLeft: false, moreRight: false };
  };

  Calculator.STAT_TYPES = TYPES;
  Calculator.STAT_TYPE_LABEL = TYPE_LABEL;
})(typeof window !== 'undefined' ? window : globalThis);
