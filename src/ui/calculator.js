/*
 * 공학용계산기 시뮬레이터 - calculator state machine (DOM-free).
 *
 * Single entry point: FX.calc.handleKey(keyName)  (also window.handleKey)
 *   keyName = key name from the spec key table (src/ui/keys.js), e.g. 'SHIFT', 'sin', 'a b/c', '▶', '='.
 *
 * Modifier state (state.mod): normal | shift | alpha | shiftAlpha | sto | rcl
 * Screen (state.screen):      input | result | error | menu | prompt | message | off
 * Public state name (getState().state) is one of
 *   normal | shift | alpha | shiftAlpha | sto | rcl | modeMenu | setupMenu
 * Indicators are derived from state (deriveIndicators), never stored.
 *
 * All engine access goes through FX.Adapter (src/ui/adapter.js).
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var Editor = FX.Editor;
  var Keys = FX.Keys;

  var MODES = { 1: 'COMP', 2: 'CMPLX', 3: 'STAT', 5: 'EQN', 7: 'TABLE' }; // MODE menu digit -> mode (numbers kept as on the fx-570ES PLUS; 4, 6, 8 are not offered and ignored)
  var HYP_FNS = ['sinh(', 'cosh(', 'tanh(', 'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹('];
  var CMPLX_MENU_ATOMS = ['arg(', 'Conjg(', '▶r∠θ', '▶a+bi'];
  var HISTORY_BYTES = 200;

  // atoms that, typed right after a result, start the new expression with "Ans"
  var ANS_PREFIX_ATOMS = { '+': 1, '−': 1, '×': 1, '÷': 1, '²': 1, '³': 1, '⁻¹': 1, '!': 1, '%': 1,
    'nPr': 1, 'nCr': 1, 'drgD': 1, 'drgR': 1, 'drgG': 1, '^(': 1, 'ˣ√(': 1, '⌟': 1,
    '∠': 1, '▶r∠θ': 1, '▶a+bi': 1,
    'sp:xhat': 1, 'sp:xhat1': 1, 'sp:xhat2': 1, 'sp:yhat': 1, 'sp:tnorm': 1 };   // STAT estimate commands   // CMPLX: binary ∠ and the result-format commands also take Ans
  var ANS_PREFIX_TPL = { pow: 1, frac: 1, nroot: 1 };

  function defaultSettings() {
    return {
      mode: 'COMP',
      io: 'MathO',                 // 'MathO' | 'LineO' | 'LineIO'
      angle: 'deg',                // 'deg' | 'rad' | 'gra'
      format: { type: 'norm1', digits: null },  // norm1 | norm2 | fix | sci
      fraction: 'd/c',             // 'ab/c' | 'd/c'
      cmplxFormat: 'a+bi',         // 'a+bi' | 'r∠θ'  (SETUP ▼ 3, CMPLX result format)
      statFreq: false,
      disp: 'dot',                 // 'dot' | 'comma'
      contrast: 5                  // 0..10 (UI only)
    };
  }

  function Calculator() {
    this.listeners = [];
    this.memory = null;
    this.settings = defaultSettings();
    this._statIoBack = null;    // display format before MODE 3 (restored when leaving STAT)
    this.reset(true);
  }

  Calculator.prototype.reset = function (full) {
    var A = FX.Adapter;
    if (full || !this.memory) this.memory = A.freshMemory();
    this.ed = new Editor();
    this.ed.lineMode = this.settings.io === 'LineIO';
    this.power = true;
    this.mod = 'normal';
    this.screen = 'input';
    this.menu = null;
    this.prompt = null;
    this.message = null;
    this.error = null;
    this.res = null;            // result view
    this.lastExpr = null;       // expression of the shown result (replay source)
    this.shownExpr = null;      // expression row shown on line 1 in result screen
    this.history = [];
    this.histIdx = -1;          // index of history entry being shown, -1 = latest/none
    this.multi = null;          // multi-statement execution {stmts, idx, expr}
    this.calc = null;           // CALC / SOLVE session
    this.dispFlag = false;      // Disp indicator
    this.prevScreen = null;
    this.lastKey = null;
    this.eqn = null;            // EQN (MODE 5) session, see "EQN" section below
    this.stat = null;           // STAT (MODE 3) session, see src/ui/stat.js
    this.table = null;          // TABLE (MODE 7) session, see src/ui/table.js
  };

  /* ---------------- events ---------------- */
  Calculator.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Calculator.prototype._emit = function () {
    var self = this;
    this.listeners.forEach(function (fn) { try { fn(self); } catch (e) { if (G.console) console.error(e); } });
  };

  /* ---------------- settings helpers ---------------- */
  Calculator.prototype.engineSettings = function (extra) {
    var s = this.settings;
    var out = {
      mode: s.mode, io: s.io, angle: s.angle,
      format: { type: s.format.type, digits: s.format.digits },
      fraction: s.fraction, cmplxFormat: s.cmplxFormat, disp: s.disp,
      mathio: s.io !== 'LineIO', lineOutput: s.io !== 'MathO'
    };
    if (extra) for (var k in extra) out[k] = extra[k];
    return out;
  };

  Calculator.prototype._setIO = function (io) {
    var changed = this.settings.io !== io;
    this.settings.io = io;
    this.ed.lineMode = io === 'LineIO';
    if (io !== 'LineIO') this.ed.overwrite = false;   // MathIO always insert mode
    if (changed) { this.history = []; this.histIdx = -1; }
  };

  /* ---------------- public state ---------------- */
  Calculator.prototype.getState = function () {
    var st = this.mod;
    if (this.screen === 'menu' && this.menu) {
      if (this.menu.id === 'mode') st = 'modeMenu';
      else if (this.menu.id.indexOf('setup') === 0 || this.menu.id === 'contrast') st = 'setupMenu';
    }
    return {
      state: st,
      mod: this.mod,
      screen: this.power ? this.screen : 'off',
      menu: this.menu ? this.menu.id : null,
      menuPage: this.menu ? (this.menu.page || 0) : null,
      prompt: this.prompt ? this.prompt.kind : null,
      settings: JSON.parse(JSON.stringify(this.settings)),
      indicators: this.deriveIndicators(),
      expr: this.exprText(),
      result: this.resultText(),
      resultLines: this._resultRowsText(),
      error: this.error ? this.error.message : null,
      lines: this.screenLines(),
      insertMode: this.ed.overwrite ? 'overwrite' : (this.ed.insWrap ? 'insWrap' : 'insert'),
      cursor: { path: this.ed.cur.path.map(function (p) { return p.slice(); }), pos: this.ed.cur.pos },
      historyLength: this.history.length,
      eqn: this.screen === 'eqn' || (this.screen === 'error' && this.eqn) ? this._eqnState() : null,
      stat: this.settings.mode === 'STAT' && this.stat ? this._statState() : null,
      table: this.settings.mode === 'TABLE' && this.table ? this._tableState() : null
    };
  };

  Calculator.prototype.deriveIndicators = function () {
    var s = this.settings;
    var mod = this.mod;
    var A = FX.Adapter;
    var ind = {
      S: mod === 'shift' || mod === 'shiftAlpha',
      A: mod === 'alpha' || mod === 'shiftAlpha',
      M: !A.isZero(this.memory.M),
      STO: mod === 'sto',
      RCL: mod === 'rcl',
      STAT: s.mode === 'STAT', CMPLX: s.mode === 'CMPLX',
      D: s.angle === 'deg', R: s.angle === 'rad', G: s.angle === 'gra',
      FIX: s.format.type === 'fix', SCI: s.format.type === 'sci',
      Math: s.io !== 'LineIO',
      up: false, down: false,
      Disp: this.dispFlag
    };
    if (this.screen === 'menu' && this.menu) {
      var pages = this.menu.pages || 1;
      ind.down = (this.menu.page || 0) < pages - 1;
      ind.up = (this.menu.page || 0) > 0;
    } else if (this.screen === 'result' || (this.screen === 'input' && this.ed.isEmpty())) {
      var n = this.history.length;
      if (n > 0) {
        if (this.screen === 'input') ind.up = true;
        else {
          var idx = this.histIdx < 0 ? n - 1 : this.histIdx;
          ind.up = idx > 0;
          ind.down = idx < n - 1;
        }
      }
    }
    if (this.screen === 'eqn' && this.eqn && this.eqn.sub === 'sol') {
      // EQN solution screen: ▲▼ tell that there are more solutions above / below (spec G-2.4)
      ind.up = this.eqn.solIdx > 0;
      ind.down = this.eqn.solIdx < this.eqn.sols.length - 1;
    }
    if (this.screen === 'stat' && this.stat) this._statIndicators(ind);
    if (this.screen === 'table' && this.table) this._tableIndicators(ind);
    if (!this.power) for (var k in ind) ind[k] = false;
    return ind;
  };

  /* ---------------- text serialisation (for qa / tests) ---------------- */
  var ATOM_TEXT = {
    'neg': '-', 'dms': '°', 'drgD': '°', 'drgR': 'ʳ', 'drgG': 'ᵍ', 'x10': '×₁₀', 'nPr': 'P', 'nCr': 'C'
  };
  function atomText(id) {
    if (ATOM_TEXT[id] !== undefined) return ATOM_TEXT[id];
    if (id.indexOf('const:') === 0) return FX.Tables ? FX.Tables.constSymbol(id.slice(6)) : id;
    if (id.indexOf('conv:') === 0) return FX.Tables ? FX.Tables.convLabel(id.slice(5)) : id;
    if (id.indexOf('lbl:') === 0) return id.slice(4);
    if (/^(st|sp|sf):/.test(id) && FX.StatLabels) return FX.StatLabels.text(id);
    return id;
  }
  function rowText(row) {
    return row.map(function (n) {
      if (n.k === 'atom') return atomText(n.id);
      var s = n.slots.map(rowText);
      switch (n.type) {
        case 'frac': return '(' + s[0] + ')/(' + s[1] + ')';
        case 'mixed': return s[0] + '⌟' + s[1] + '⌟' + s[2];
        case 'sqrt': return '√(' + s[0] + ')';
        case 'cbrt': return '³√(' + s[0] + ')';
        case 'nroot': return '(' + s[0] + ')ˣ√(' + s[1] + ')';
        case 'pow': return '^(' + s[0] + ')';
        case 'pow10': return '10^(' + s[0] + ')';
        case 'powe': return 'e^(' + s[0] + ')';
        case 'logb': return 'log_(' + s[0] + ')(' + s[1] + ')';
        case 'abs': return 'Abs(' + s[0] + ')';
        case 'integ': return '∫(' + s[0] + ',' + s[1] + ',' + s[2] + ')';
        case 'deriv': return 'd/dx(' + s[0] + ',' + s[1] + ')';
        case 'sum': return 'Σ(' + s[0] + ',' + s[1] + ',' + s[2] + ')';
      }
      return '?';
    }).join('');
  }
  FX.rowText = rowText;
  FX.atomText = atomText;

  function displayText(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(displayText).join('');
    var t = node.type;
    var ch = node.children || node.items;
    if (t === 'frac') return displayText(node.num) + '/' + displayText(node.den);
    if (t === 'mixed') return displayText(node.int || node.whole) + '⌟' + displayText(node.num) + '⌟' + displayText(node.den);
    if (t === 'sqrt') return '√' + wrapTxt(displayText(node.arg !== undefined ? node.arg : (node.radicand !== undefined ? node.radicand : ch)));
    if (t === 'pow' || t === 'sup') return displayText(node.base) + '^' + wrapTxt(displayText(node.exp !== undefined ? node.exp : ch));
    if (t === 'sci' || t === 'exp10') return displayText(node.mantissa) + '×10^' + displayText(node.exp);
    if (node.value !== undefined) return String(node.value);
    if (node.text !== undefined) return String(node.text);
    if (ch) return displayText(ch);
    return '';
  }
  function wrapTxt(s) { return s.length > 1 ? '(' + s + ')' : s; }
  FX.displayText = displayText;

  Calculator.prototype.exprText = function () {
    if (this.screen === 'result' && this.shownExpr) return rowText(this.shownExpr);
    if (this.screen === 'prompt' && this.prompt && this.prompt.editor) return rowText(this.prompt.editor.root);
    return rowText(this.ed.root);
  };
  // CMPLX result in LineIO/LineO: a and bi (or r and ∠θ) on separate rows (manual cmplx note 3).
  // Rows come from the engine (adapter complexLines); null = show the one-row form.
  Calculator.prototype._resultRows = function () {
    var res = this.res;
    if (this.screen !== 'result' || !res || !res.cmplx || !res.lines || this.settings.io === 'MathO') return null;
    var key = res.form === 'decimal' ? 'decimal' : res.form === 'alt' ? 'alt' : 'natural';
    var rows = res.lines[key];
    return rows && rows.length ? rows : null;
  };
  Calculator.prototype._resultRowsText = function () {
    var rows = this._resultRows();
    return rows ? rows.map(displayText) : null;
  };

  Calculator.prototype.resultText = function () {
    if (this.screen === 'eqn' && this.eqn && this.eqn.sub === 'sol') return displayText(this._eqnShown().node);
    if (this.screen === 'result' && this.res) return displayText(this.res.shown);
    if (this.screen === 'message' && this.message && this.message.result) return displayText(this.message.result);
    return null;
  };

  /* ---------------- modifier resolution ---------------- */
  function resolveAction(key, mod, calcMode) {
    var act = key.act;
    var a;
    if (mod === 'shift') a = act[1] || act[0];
    else if (mod === 'alpha') a = act[2] || act[0];
    else if (mod === 'shiftAlpha') a = act[2] || act[1] || act[0];
    else a = (calcMode === 'CMPLX' && key.cxAct) ? key.cxAct : act[0];   // CMPLX: ENG -> i
    // 'cx:<action>' exists only in CMPLX mode (SHIFT (−) = ∠, SHIFT 2 = CMPLX menu); elsewhere no-op
    if (a && a.indexOf('cx:') === 0) a = calcMode === 'CMPLX' ? a.slice(3) : null;
    return a;
  }
  FX.resolveAction = resolveAction;

  /* ---------------- main entry ---------------- */
  Calculator.prototype.handleKey = function (rawName) {
    var name = Keys.canonical(rawName);
    if (!name) return false;
    var key = Keys.BY_NAME[name];
    this.lastKey = name;

    if (!this.power) {
      if (name === 'ON') this.powerOn();
      this._emit();
      return true;
    }
    if (name === 'ON') { this.powerOn(); this._emit(); return true; }

    if (name === 'SHIFT') {
      if (this.mod === 'shift') this.mod = 'normal';
      else if (this.mod === 'alpha') this.mod = 'shiftAlpha';
      else if (this.mod === 'shiftAlpha') this.mod = 'alpha';
      else this.mod = 'shift';          // normal / sto / rcl -> shift
      this._emit();
      return true;
    }
    if (name === 'ALPHA') {
      if (this.mod === 'alpha') this.mod = 'normal';
      else if (this.mod === 'shift') this.mod = 'shiftAlpha';
      else if (this.mod === 'shiftAlpha') this.mod = 'shift';
      else this.mod = 'alpha';
      this._emit();
      return true;
    }

    var mod = this.mod;
    if (mod === 'sto' || mod === 'rcl') {
      this.mod = 'normal';
      this._varWait(mod, name);
      this._emit();
      return true;
    }

    var action = resolveAction(key, mod, this.settings.mode);
    this.mod = 'normal';

    switch (this.screen) {
      case 'menu': this._menuKey(name, action); break;
      case 'prompt': this._promptKey(name, action); break;
      case 'error': this._errorKey(name, action); break;
      case 'message': this._messageKey(name, action); break;
      case 'eqn': this._eqnKey(name, action); break;
      case 'stat': this._statKey(name, action); break;
      case 'table': this._tableKey(name, action); break;
      default: this._editKey(name, action);
    }
    this._emit();
    return true;
  };

  // convenience: run a sequence (array or space separated string of key names)
  Calculator.prototype.pressKeys = function (seq) {
    var list = Array.isArray(seq) ? seq : tokenizeKeySeq(seq);
    var self = this;
    list.forEach(function (k) { self.handleKey(k); });
    return this.getState();
  };

  function tokenizeKeySeq(str) {
    // longest-match against known key names, separated by spaces
    var names = Object.keys(Keys.BY_NAME).sort(function (a, b) { return b.length - a.length; });
    var out = [];
    var s = String(str);
    var i = 0;
    while (i < s.length) {
      if (s[i] === ' ') { i++; continue; }
      var hit = null;
      for (var j = 0; j < names.length; j++) {
        var n = names[j];
        if (s.substr(i, n.length) === n) {
          // multi-char names must end at a boundary
          var nxt = s.charAt(i + n.length);
          if (n.length === 1 || nxt === '' || nxt === ' ' || /[0-9]/.test(n)) { hit = n; break; }
        }
      }
      if (!hit) {
        var aliasEnd = s.indexOf(' ', i);
        var word = s.slice(i, aliasEnd < 0 ? s.length : aliasEnd);
        hit = Keys.canonical(word) ? word : s[i];
        i += hit.length;
        out.push(hit);
        continue;
      }
      out.push(hit);
      i += hit.length;
    }
    return out;
  }
  FX.tokenizeKeySeq = tokenizeKeySeq;

  /* ---------------- power ---------------- */
  Calculator.prototype.powerOn = function () {
    var mem = this.memory;
    var settings = this.settings;
    var tableFx = this.table ? this.table.fx : null;   // f(X) kept over OFF/ON [미확인]
    this.reset(false);
    this.memory = mem;
    this.settings = settings;
    this.ed.lineMode = settings.io === 'LineIO';
    // ON in EQN: coefficients are not kept, the equation type menu comes back [미확인]
    if (settings.mode === 'EQN') this._eqnEnter();
    if (settings.mode === 'STAT') this._statEnter(null);
    if (settings.mode === 'TABLE') this._tableEnter(tableFx);
  };

  Calculator.prototype.powerOff = function () {
    this.power = false;
    this.mod = 'normal';
  };

  /* ---------------- editing / result screens ---------------- */
  Calculator.prototype._toInput = function () {
    this.screen = 'input';
    this.res = null;
    this.dispFlag = false;
    this.histIdx = -1;
    this.multi = null;
    this.calc = null;
  };

  Calculator.prototype._startNew = function (withAns) {
    this.ed.clear();
    this._toInput();
    if (withAns) this.ed.insertAtom('Ans');
  };

  Calculator.prototype._editKey = function (name, action) {
    if (!action) return;
    var inResult = this.screen === 'result';

    // ---- insertion ----
    if (action.indexOf('a:') === 0 || action.indexOf('t:') === 0 || action.indexOf('v:') === 0) {
      this._insert(action, inResult);
      return;
    }
    switch (action) {
      case 'left':
      case 'right':
        if (inResult) {
          this._replay(action === 'right');
        } else if (this.screen === 'input') {
          if (action === 'left') this.ed.left(); else this.ed.right();
        }
        return;
      case 'up':
      case 'down':
        this._vertical(action === 'up' ? -1 : 1);
        return;
      case 'del':
        if (inResult) { this._replay(false); return; }   // DEL on a result: edit the expression (cursor at end)
        this.ed.del();
        return;
      case 'ins':
        if (inResult) this._replay(false);
        if (this.ed.lineMode) this.ed.overwrite = !this.ed.overwrite;
        else this.ed.insWrap = !this.ed.insWrap;
        return;
      case 'ac':
        this.ed.clear();
        this._toInput();
        return;
      case 'off':
        this.powerOff();
        return;
      case 'exe':
        this._execute(false);
        return;
      case 'exeDec':
        this._execute(true);
        return;
      case 'mode':
        this._openMenu('mode');
        return;
      case 'setup':
        this._openMenu('setup');
        return;
      case 'hyp':
        this._openMenu('hyp');
        return;
      case 'drg':
        this._openMenu('drg');
        return;
      case 'clr':
        this._openMenu('clr');
        return;
      case 'const':
        this._openPrompt('const');
        return;
      case 'conv':
        this._openPrompt('conv');
        return;
      case 'rcl':
        this.mod = 'rcl';
        return;
      case 'sto':
        this.mod = 'sto';
        return;
      case 'mplus':
      case 'mminus':
        this._memPlus(action === 'mminus');
        return;
      case 'sd':
        if (inResult) this._toggleSD();
        return;
      case 'sdMixed':
        if (inResult) this._toggleMixed();
        return;
      case 'eng':
      case 'engL':
        if (inResult) this._eng(action === 'eng' ? 1 : -1);
        return;
      case 'dms':
        if (inResult && this._lastWasPureResult()) { this._toggleDMS(); return; }
        this._insert('a:dms', inResult);
        return;
      case 'calc':
        this._startCalc(false);
        return;
      case 'solve':
        // SOLVE is a COMP-only function (manual using_SOLVE). Outside COMP it goes straight to the
        // engine (CalcEngine.solve), which reports Syntax ERROR, like ∫ and d/dx in CMPLX [가정].
        if (this.settings.mode !== 'COMP') { this._solveUnsupported(); return; }
        this._startCalc(true);
        return;
      case 'cmplxMenu':
        this._openMenu('cmplx');
        return;
    }
    if (action === 'modeOnly:STAT') { if (this.settings.mode === 'STAT' && this.stat && this.stat.sub === 'calc') this._statMenuOpen(); return; }
    if (action.indexOf('modeOnly:') === 0) return; // SHIFT 1~5 menus: other modes only
  };

  Calculator.prototype._lastWasPureResult = function () { return !!this.res; };

  Calculator.prototype._insert = function (action, inResult) {
    if (this.screen === 'eqn') { this._eqnInsert(action); return; }   // EQN coefficient cell
    if (this.screen === 'stat') { this._statInsert(action); return; }  // STAT data cell
    if (this.screen === 'table') { this._tableInsert(action); return; }  // TABLE f(X) / Start / End / Step
    var kind = action.slice(0, 2);
    var id = action.slice(2);
    if (kind === 'v:') { kind = 'a:'; }
    if (inResult) {
      var ans = (kind === 'a:' && ANS_PREFIX_ATOMS[id]) ||
                (kind === 't:' && (ANS_PREFIX_TPL[id] || (this.ed.lineMode && ANS_PREFIX_ATOMS[Editor.LINE_EQUIV[id]]))) ||
                (kind === 'a:' && id.indexOf('conv:') === 0);
      this._startNew(!!ans);
    } else if (this.screen !== 'input') {
      this._startNew(false);
    }
    if (kind === 'a:') this.ed.insertAtom(id);
    else this.ed.insertTemplate(id);
  };

  Calculator.prototype._replay = function (atStart) {
    var expr = this.lastExpr;
    if (this.histIdx >= 0 && this.history[this.histIdx]) expr = this.history[this.histIdx].expr;
    this.ed.load(expr || [], atStart);
    this._toInput();
  };

  Calculator.prototype._vertical = function (dir) {
    if (this.screen === 'input' && !this.ed.isEmpty()) {
      this.ed.vertical(dir);   // fraction/integral slots (MathIO) or start/end (LineIO)
      return;
    }
    // history browsing
    var n = this.history.length;
    if (!n) return;
    var idx;
    if (this.screen === 'input') {
      if (dir > 0) return;
      idx = n - 1;
    } else {
      idx = this.histIdx < 0 ? n - 1 : this.histIdx;
      idx += dir;
      if (idx < 0 || idx > n - 1) return;
    }
    this._showHistory(idx);
  };

  Calculator.prototype._showHistory = function (idx) {
    var h = this.history[idx];
    this.histIdx = idx;
    this.screen = 'result';
    this.lastExpr = h.expr;
    this.shownExpr = h.shown || h.expr;
    this.res = cloneRes(h.res);
    this.dispFlag = false;
    this.multi = null;
  };

  function cloneRes(r) {
    if (!r) return r;
    var c = {};
    for (var k in r) c[k] = r[k];
    return c;
  }

  /* ---------------- execution ---------------- */
  // split root row at top-level ':' into statements
  function splitStatements(row) {
    var out = [[]];
    row.forEach(function (n) {
      if (n.k === 'atom' && n.id === ':') out.push([]);
      else out[out.length - 1].push(n);
    });
    return out;
  }

  Calculator.prototype._evalRow = function (row, extra, memOverride) {
    var A = FX.Adapter;
    var comp = A.compile(row, this.engineSettings());
    if (comp.error) return { ok: false, error: comp.error, errorPos: null, srcMap: comp.srcMap };
    var memUse = memOverride || this.memory;
    if (this.settings.mode === 'STAT' && this.stat) memUse.stat = this._statAnalysis();
    var r = A.run(comp.tokens, this.engineSettings(extra), memUse);
    r.srcMap = comp.srcMap;
    r.tokens = comp.tokens;
    return r;
  };

  Calculator.prototype._execute = function (decimal) {
    // re-execute after a result: same expression again (Ans updated) / continue multi-statement
    var expr;
    if (this.screen === 'result') {
      if (this.calc) { this._startCalc(this.calc.solve, this.calc.expr); return; }
      if (this.multi && this.multi.idx < this.multi.stmts.length - 1) {
        this._runStatement(this.multi.idx + 1, decimal);
        return;
      }
      expr = this.lastExpr;
      if (this.histIdx >= 0 && this.history[this.histIdx]) expr = this.history[this.histIdx].expr;
      if (!expr || !expr.length) return;
    } else {
      if (this.ed.isEmpty()) return;
      expr = this.ed.snapshot();
    }
    var stmts = splitStatements(expr);
    this.multi = { stmts: stmts, idx: -1, expr: expr, decimal: decimal };
    this.lastExpr = expr;
    this._runStatement(0, decimal);
  };

  Calculator.prototype._runStatement = function (i, decimal) {
    var m = this.multi;
    var stmt = m.stmts[i];
    m.idx = i;
    var r = this._evalRow(stmt, decimal ? { decimalOutput: true } : null);
    if (!r.ok) {
      this._showError(r, m.expr, i);
      return;
    }
    // Pol/Rec with SHIFT =: the engine's decimalOutput multi result has no exact form (display, alt and
    // multi[i].toggled are all decimal), so S⇔D could not return to e.g. r=√2. Evaluate the same
    // statement in natural form (memory not yet changed: assign is applied below) and show its
    // decimalNode first; natural = its display. Both values stay together.
    if (decimal && r.view === 'multi') {
      var rn = this._evalRow(stmt, null);
      if (rn.ok && rn.view === 'multi') r = rn;
    }
    this.memory.Ans = r.value;
    this._applyAssign(r);
    this.res = makeRes(r, decimal);
    this.screen = 'result';
    this.shownExpr = m.expr;
    this.histIdx = -1;
    var last = i === m.stmts.length - 1;
    this.dispFlag = !last;
    if (last) this._pushHistory(m.expr, this.shownExpr, this.res);
  };

  // r.decimal is a string, r.decimalNode the DisplayNode (engine contract). Keep the node for rendering.
  function makeRes(r, decimal) {
    var natural = r.display;
    var dec = r.decimalNode != null ? r.decimalNode : (r.decimal != null ? r.decimal : r.display);
    var A = FX.Adapter;
    var cx = A.isComplexResult(r);
    return {
      cmplx: cx,
      // LineIO/LineO two-row forms per view (engine fields lines / decimalLines / altLines)
      lines: cx ? { natural: A.complexLines(r, 'natural'), decimal: A.complexLines(r, 'decimal'), alt: A.complexLines(r, 'alt') } : null,
      value: r.value,
      natural: natural,
      decimal: dec,
      decimalText: r.decimal != null ? String(r.decimal) : null,
      alt: r.alt != null ? r.alt : null,
      shown: decimal ? dec : natural,
      form: decimal ? 'decimal' : 'natural',
      view: r.view || null,
      engExp: r.engExp != null ? r.engExp : null,
      eng: null, dms: !!r.dms && !decimal, natDms: !!r.dms, mixed: false
    };
  }

  // Pol/Rec (and "Y=expr") results carry r.assign = {X: v, Y: v}: store into memory.
  Calculator.prototype._applyAssign = function (r) {
    if (!r || !r.assign) return;
    for (var k in r.assign) {
      if (Object.prototype.hasOwnProperty.call(this.memory, k) && k !== 'Ans') this.memory[k] = r.assign[k];
    }
  };

  Calculator.prototype._pushHistory = function (expr, shown, res) {
    this.history.push({ expr: Editor.cloneRow(expr), shown: Editor.cloneRow(shown), res: cloneRes(res) });
    var total = 0;
    for (var i = this.history.length - 1; i >= 0; i--) {
      total += Editor.rowBytes(this.history[i].expr) + 4;
      if (total > HISTORY_BYTES && i < this.history.length - 1) { this.history.splice(0, i + 1); break; }
    }
  };

  Calculator.prototype._showError = function (r, expr, stmtIndex) {
    var msg = r.error || 'Syntax ERROR';
    // map engine token position to an editor cursor location
    var loc = null;
    if (r.errorPos != null && r.srcMap && r.srcMap[r.errorPos]) loc = r.srcMap[r.errorPos];
    // statement offset in the root row for multi statements
    var offset = 0;
    if (stmtIndex) {
      var count = 0;
      for (var i = 0; i < expr.length; i++) {
        if (expr[i].k === 'atom' && expr[i].id === ':') { count++; if (count === stmtIndex) { offset = i + 1; break; } }
      }
    }
    if (loc && offset) {
      if (loc.path.length) loc = { path: [[loc.path[0][0] + offset, loc.path[0][1]]].concat(loc.path.slice(1)), pos: loc.pos };
      else loc = { path: [], pos: loc.pos + offset };
    }
    this.error = { message: msg, expr: Editor.cloneRow(expr), loc: loc };
    this.screen = 'error';
    this.dispFlag = false;
    this.multi = null;
  };

  Calculator.prototype._errorKey = function (name, action) {
    if (this.error && this.error.eqn && this._inEqn()) { this._eqnErrorKey(action); return; }
    if (this.error && this.error.stat && this.stat) { this._statErrorKey(action); return; }
    if (this.error && this.error.table && this._inTable()) { this._tableErrorKey(action); return; }
    if (action === 'ac') {
      this.error = null;
      this.ed.clear();
      this._toInput();
      return;
    }
    if (action === 'left' || action === 'right') {
      var e = this.error;
      this.error = null;
      this.ed.load(e.expr, false);
      if (e.loc) {
        try { this.ed.rowAt(e.loc.path); this.ed.setCursor(e.loc.path, e.loc.pos); } catch (x) { this.ed.end(); }
      }
      this._toInput();
      return;
    }
    if (action === 'off') this.powerOff();
  };

  /* ---------------- result view toggles ---------------- */
  Calculator.prototype._redisplay = function (extra) {
    var A = FX.Adapter;
    var mem = A.withAns(this.memory, this.res.value);
    var r = A.run(A.ansTokens(), this.engineSettings(extra), mem);
    return r.ok ? r : null;
  };

  // Pol/Rec results (view 'multi') hold two values. Toggles that go through Ans re-evaluation
  // (_redisplay) would keep only the first value, so they must not be used on multi results.
  // CMPLX results are treated the same way: Ans re-evaluation would drop a ▶r∠θ / ▶a+bi command, and
  // ENG / °′″ / a b/c⇔d/c on complex values are not described in the manual [명세 공백] -> ignored.
  function isMulti(res) { return !!res && (res.view === 'multi' || !!res.cmplx); }

  // S⇔D on a multi result: natural <-> decimal (r.decimalNode) or natural <-> alt (r.alt), both
  // values formatted by the engine. No Ans re-evaluation.
  Calculator.prototype._toggleSDMulti = function (res) {
    if (res.form === 'natural') {
      if (FX.displayText(res.natural) !== FX.displayText(res.decimal)) { res.shown = res.decimal; res.form = 'decimal'; }
      else if (res.alt != null && FX.displayText(res.alt) !== FX.displayText(res.natural)) { res.shown = res.alt; res.form = 'alt'; }
      // otherwise nothing to toggle (e.g. Pol(3,4)): keep both values as shown
    } else {
      res.shown = res.natural; res.form = 'natural';
    }
  };

  Calculator.prototype._toggleSD = function () {
    var res = this.res;
    if (!res) return;
    if (isMulti(res)) { this._toggleSDMulti(res); return; }
    res.eng = null; res.dms = false;
    var same = FX.displayText(res.natural) === FX.displayText(res.decimal);
    if (res.form === 'natural') {
      if (!same) { res.shown = res.decimal; res.form = 'decimal'; }
      else if (res.alt != null) { res.shown = res.alt; res.form = 'alt'; }
      else {
        var r = this._redisplay({ sdToggle: true });
        if (r && FX.displayText(r.display) !== FX.displayText(res.shown)) { res.alt = r.display; res.shown = r.display; res.form = 'alt'; }
      }
    } else {
      res.shown = res.natural;
      res.form = 'natural';
    }
    res.dms = res.form === 'natural' && !!res.natDms;
  };

  Calculator.prototype._toggleMixed = function () {
    var res = this.res;
    if (!res || isMulti(res)) return;   // multi (Pol/Rec): ignored
    if (res.mixed) {
      // back to the view shown before the a b/c <-> d/c toggle
      res.mixed = false;
      var pm = res.preMixed || { shown: res.natural, form: 'natural' };
      res.shown = pm.shown; res.form = pm.form;
      return;
    }
    var frac = this.settings.fraction === 'd/c' ? 'ab/c' : 'd/c';
    var r = this._redisplay({ fraction: frac });
    if (!r) return;
    // Redisplay goes through Ans, which loses the "fraction input" flag (LineIO: 7⌟6 comes back as a
    // decimal with the fraction in r.alt). Show the fraction form when a fraction was on screen.
    var wasFrac = res.form === 'alt' || (res.form === 'natural' && res.view === 'frac');
    var node = r.view === 'frac' ? r.display : (wasFrac && r.alt != null ? r.alt : null);
    if (!node) return;   // no fraction form (e.g. irrational): key ignored
    res.preMixed = { shown: res.shown, form: res.form };
    res.mixed = true;
    res.shown = node; res.form = 'mixed';
  };

  Calculator.prototype._eng = function (dir) {
    var res = this.res;
    if (!res || isMulti(res)) return;   // multi (Pol/Rec): ignored
    var A = FX.Adapter;
    var e;
    if (res.eng == null) {
      var std = A.engStdExponent(res);
      e = dir > 0 ? std : std + 3;
    } else {
      e = res.eng + (dir > 0 ? -3 : 3);
    }
    var r = this._redisplay({ eng: e });
    if (r) { res.eng = e; res.dms = false; res.shown = r.display; res.form = 'eng'; }
  };

  // °′″ on a result: sexagesimal <-> decimal (C-D02~D04). res.dms = currently showing sexagesimal.
  Calculator.prototype._toggleDMS = function () {
    var res = this.res;
    if (!res || isMulti(res)) return;   // multi (Pol/Rec): ignored
    res.eng = null;
    if (res.dms) {
      res.dms = false;
      res.shown = res.decimal; res.form = 'decimal';
      return;
    }
    if (res.natDms) {
      res.dms = true;
      res.shown = res.natural; res.form = 'natural';
      return;
    }
    var r = this._redisplay({ dmsOutput: true });
    if (r && r.dms) { res.dms = true; res.shown = r.display; res.form = 'dms'; }
  };

  /* ---------------- memory ---------------- */
  Calculator.prototype._exprForMemOp = function () {
    if (this.screen === 'result') return [Editor.atom('Ans')];
    if (this.ed.isEmpty()) return null;
    return this.ed.snapshot();
  };

  Calculator.prototype._memPlus = function (minus) {
    var A = FX.Adapter;
    var expr = this._exprForMemOp();
    if (!expr) return;
    var r = this._evalRow(expr);
    if (!r.ok) { this._showError(r, expr, 0); return; }
    var mem = A.withAns(this.memory, r.value);
    var sum = A.run(A.memOpTokens('M', minus ? '−' : '+'), this.engineSettings(), mem);
    if (!sum.ok) { this._showError(sum, expr, 0); return; }
    this.memory.M = sum.value;
    this.memory.Ans = r.value;
    this.lastExpr = expr;
    this.shownExpr = expr.concat([Editor.atom(minus ? 'M−' : 'M+')]);
    this.res = makeRes(r, false);
    this.screen = 'result';
    this.histIdx = -1;
    this.multi = null;
    this.dispFlag = false;
  };

  Calculator.prototype._varWait = function (mode, name) {
    var v = Keys.VAR_KEYS[name];
    if (!v) {
      // any other key cancels the STO / RCL wait; AC also cancels
      return;
    }
    var A = FX.Adapter;
    if (mode === 'rcl') {
      var r = A.run([A.varToken(v)], this.engineSettings(), this.memory);
      if (!r.ok) { this._showError(r, [Editor.atom(v)], 0); return; }
      this.memory.Ans = r.value;
      this.lastExpr = [Editor.atom(v)];
      this.shownExpr = [Editor.atom('lbl:' + v + '=')];
      this.res = makeRes(r, false);
      this.screen = 'result';
      this.histIdx = -1; this.multi = null; this.dispFlag = false;
      return;
    }
    // STO
    var expr = this._exprForMemOp();
    if (!expr) expr = [Editor.atom('Ans')];
    var rr = this._evalRow(expr);
    if (!rr.ok) { this._showError(rr, expr, 0); return; }
    this._applyAssign(rr);
    this.memory[v] = rr.value;
    this.memory.Ans = rr.value;
    this.lastExpr = expr;
    this.shownExpr = expr.concat([Editor.atom('→' + v)]);
    this.res = makeRes(rr, false);
    this.screen = 'result';
    this.histIdx = -1; this.multi = null; this.dispFlag = false;
  };

  /* ---------------- menus ---------------- */
  var MENUS = {
    mode: { pages: [['1:COMP', '2:CMPLX', '3:STAT', '5:EQN', '7:TABLE']] },   // one page (3 lines); 4/6/8 removed
    setup: { pages: [
      ['1:MthIO', '2:LineIO', '3:Deg', '4:Rad', '5:Gra', '6:Fix', '7:Sci', '8:Norm'],
      ['1:ab/c', '2:d/c', '3:CMPLX', '4:STAT', '5:Disp', '6:◀CONT▶']
    ] },
    setupMthIO: { pages: [['1:MathO', '2:LineO']] },
    setupCmplx: { pages: [['1:a+bi', '2:r∠θ']] },
    setupStat: { title: 'Frequency?', pages: [['1:ON', '2:OFF']] },
    setupDisp: { pages: [['1:Dot', '2:Comma']] },
    setupFix: { title: 'Fix 0~9?', pages: [[]] },
    setupSci: { title: 'Sci 0~9?', pages: [[]] },
    setupNorm: { title: 'Norm 1~2?', pages: [[]] },
    contrast: { pages: [[]] },
    hyp: { pages: [['1:sinh', '2:cosh', '3:tanh', '4:sinh⁻¹', '5:cosh⁻¹', '6:tanh⁻¹']] },
    drg: { pages: [['1:°', '2:ʳ', '3:ᵍ']] },
    cmplx: { pages: [['1:arg', '2:Conjg', '3:▶r∠θ', '4:▶a+bi']] },
    clr: { title: 'CLR', pages: [['1:Setup', '2:Memory', '3:All']] },
    clrConfirm: { pages: [[]] }
  };
  Calculator.MENUS = MENUS;

  Calculator.prototype._openMenu = function (id, extra) {
    if (!this.menu || this.screen !== 'menu') this.prevScreen = { screen: this.screen };
    var def = (extra && extra.itemPages) ? { pages: extra.itemPages } : MENUS[id];
    this.menu = { id: id, page: 0, pages: def.pages.length };
    if (extra) for (var k in extra) this.menu[k] = extra[k];
    this.screen = 'menu';
  };

  Calculator.prototype._closeMenu = function (toBlank) {
    this.menu = null;
    if (this.settings.mode === 'STAT' && this.stat && this.prevScreen && this.prevScreen.screen === 'stat') {
      // menus opened from the STAT type menu / data editor (MODE, SETUP, SHIFT 1) come back to it
      this.screen = 'stat';
      if (toBlank) this._statAfterSetup();
      return;
    }
    if (this._inTable() && this.prevScreen && this.prevScreen.screen === 'table') {
      // menus opened from a TABLE screen (MODE, SETUP, hyp, DRG, CLR) come back to it
      this.screen = 'table';
      if (toBlank) this._tableAfterSetup();
      return;
    }
    if (this._inEqn() && this.prevScreen && this.prevScreen.screen === 'eqn') {
      // menus opened from an EQN screen (MODE, SETUP, hyp, DRG, CLR) come back to it
      this.screen = 'eqn';
      if (toBlank) this._eqnAfterSetup();
      return;
    }
    if (toBlank) {
      this.ed.clear();
      this._toInput();
      return;
    }
    var prev = this.prevScreen ? this.prevScreen.screen : 'input';
    this.screen = prev === 'result' && this.res ? 'result' : 'input';
  };

  function digitOf(name) { return /^[0-9]$/.test(name) ? parseInt(name, 10) : null; }

  Calculator.prototype._menuKey = function (name, action) {
    var m = this.menu;
    var d = digitOf(name);
    if (action === 'ac') {
      // contrast / any menu: AC closes without selection
      this._closeMenu(m.id === 'contrast' || m.id.indexOf('setup') === 0 || m.id === 'mode');
      return;
    }
    if (action === 'off') { this.menu = null; this.powerOff(); return; }
    if (name === '▼' && m.page < m.pages - 1) { m.page++; return; }
    if (name === '▲' && m.page > 0) { m.page--; return; }
    if (m.id.indexOf('stm:') === 0) { this._statMenuKey(name, action, d); return; }

    var s = this.settings;
    switch (m.id) {
      case 'mode':
        if (d !== null && MODES[d]) {
          var mode = MODES[d];
          // mode change clears the calculation history; Ans, variables and M are kept
          var wasEqn = s.mode === 'EQN', wasStat = s.mode === 'STAT';
          s.mode = mode;
          this.history = []; this.histIdx = -1;
          this.lastExpr = null; this.shownExpr = null;
          // STAT forces linear display (manual 12쪽 주의: "STAT, BASE-N, MATRIX 또는 VECTOR 모드를 입력할 때마다
          // 계산기가 리니어 표기를 자동으로 변환"). Restoring the previous display format when leaving STAT is
          // not stated in the manual [미확인]; the previous format is restored (simplest choice).
          if (mode === 'STAT' && !wasStat) {
            this._statIoBack = s.io;
            this._setIO('LineIO');
          } else if (mode !== 'STAT' && wasStat) {
            if (this._statIoBack) this._setIO(this._statIoBack);
            this._statIoBack = null;
          }
          if (mode === 'EQN') {
            // MODE 5: equation type menu (also from inside EQN = change of type, spec Part A)
            this.menu = null;
            this.ed.clear();
            this._toInput();
            this.stat = null;
            this.table = null;
            this._eqnEnter(wasEqn ? this.eqn : null);
            return;
          }
          if (mode === 'STAT') {
            // MODE 3: statistics type menu (src/ui/stat.js)
            this.menu = null;
            this.ed.clear();
            this._toInput();
            this.eqn = null;
            this.table = null;
            this._statEnter(wasStat ? this.stat : null);
            return;
          }
          if (mode === 'TABLE') {
            // MODE 7: f(X)= entry (src/ui/table.js). A mode change deletes f(X) (manual 63쪽), also MODE 7 in TABLE
            this.menu = null;
            this.ed.clear();
            this._toInput();
            this.eqn = null;
            this.stat = null;
            this._tableEnter(null);
            return;
          }
          this.eqn = null;
          this.table = null;
          this.stat = null;       // leaving STAT deletes the statistics data
          this._closeMenu(true);
        }
        return;
      case 'setup':
        if (m.page === 0) {
          if (d === 1) { this._openMenu('setupMthIO'); return; }
          if (d === 2) { this._setIO('LineIO'); this._closeMenu(true); return; }
          if (d === 3) { s.angle = 'deg'; this._closeMenu(true); return; }
          if (d === 4) { s.angle = 'rad'; this._closeMenu(true); return; }
          if (d === 5) { s.angle = 'gra'; this._closeMenu(true); return; }
          if (d === 6) { this._openMenu('setupFix'); return; }
          if (d === 7) { this._openMenu('setupSci'); return; }
          if (d === 8) { this._openMenu('setupNorm'); return; }
        } else {
          if (d === 1) { s.fraction = 'ab/c'; this._closeMenu(true); return; }
          if (d === 2) { s.fraction = 'd/c'; this._closeMenu(true); return; }
          if (d === 3) { this._openMenu('setupCmplx'); return; }
          if (d === 4) { this._openMenu('setupStat'); return; }
          if (d === 5) { this._openMenu('setupDisp'); return; }
          if (d === 6) { this._openMenu('contrast'); return; }
        }
        return;
      case 'setupMthIO':
        if (d === 1 || d === 2) { this._setIO(d === 1 ? 'MathO' : 'LineO'); this._closeMenu(true); }
        return;
      case 'setupFix':
        if (d !== null) { s.format = { type: 'fix', digits: d }; this._closeMenu(true); }
        return;
      case 'setupSci':
        if (d !== null) { s.format = { type: 'sci', digits: d }; this._closeMenu(true); }
        return;
      case 'setupNorm':
        if (d === 1 || d === 2) { s.format = { type: 'norm' + d, digits: null }; this._closeMenu(true); }
        return;
      case 'setupCmplx':
        if (d === 1 || d === 2) { s.cmplxFormat = d === 1 ? 'a+bi' : 'r∠θ'; this._closeMenu(true); }
        return;
      case 'setupStat':
        if (d === 1 || d === 2) { s.statFreq = d === 1; this._closeMenu(true); }
        return;
      case 'setupDisp':
        if (d === 1 || d === 2) { s.disp = d === 1 ? 'dot' : 'comma'; this._closeMenu(true); }
        return;
      case 'contrast':
        if (name === '◀') s.contrast = Math.max(0, s.contrast - 1);
        if (name === '▶') s.contrast = Math.min(10, s.contrast + 1);
        return;
      case 'hyp':
        if (d >= 1 && d <= 6) { this._closeMenu(false); this._insert('a:' + HYP_FNS[d - 1], this.screen === 'result'); }
        return;
      case 'drg':
        if (d >= 1 && d <= 3) { this._closeMenu(false); this._insert('a:' + ['drgD', 'drgR', 'drgG'][d - 1], this.screen === 'result'); }
        return;
      case 'cmplx':
        // SHIFT 2 (CMPLX): 1 arg  2 Conjg  3 ▶r∠θ  4 ▶a+bi. Other digits ignored (no Re/Im on this model).
        if (d >= 1 && d <= 4) { this._closeMenu(false); this._insert('a:' + CMPLX_MENU_ATOMS[d - 1], this.screen === 'result'); }
        return;
      case 'clr':
        if (d >= 1 && d <= 3) { this._openMenu('clrConfirm', { what: d }); }
        return;
      case 'clrConfirm':
        if (action === 'exe') {
          var what = m.what;
          this.menu = null;
          if (what === 1 || what === 3) {
            var c = this.settings.contrast;
            this.eqn = null;            // Reset Setup returns to COMP
            this.stat = null;
            this.table = null;
            this.settings = defaultSettings();
            this.settings.contrast = c;
            this._statIoBack = null;
            this.ed.lineMode = false; this.ed.overwrite = false;
            this.history = []; this.histIdx = -1;
          }
          if (what === 2 || what === 3) this.memory = FX.Adapter.freshMemory();
          var label = what === 1 ? 'Reset Setup' : what === 2 ? 'Clear Memory' : 'Reset All';
          this.ed.clear();
          this._toInput();
          this._showMessage([label, '', 'Press [AC] Key'], { back: 'input' });
        }
        return;
    }
  };

  Calculator.prototype.menuLines = function () {
    var m = this.menu;
    if (!m) return [];
    var def = m.itemPages ? { pages: m.itemPages, title: m.title } : MENUS[m.id];
    if (m.id === 'contrast') return ['CONTRAST', '', 'LIGHT        DARK', ' [◀]          [▶]'];
    if (m.id === 'clrConfirm') {
      var q = m.what === 1 ? 'Reset Setup?' : m.what === 2 ? 'Clear Memory?' : 'Reset All?';
      return [q, '[=] :Yes', '[AC]:Cancel'];
    }
    var items = def.pages[m.page] || [];
    var lines = [];
    if (def.title) lines.push(def.title);
    for (var i = 0; i < items.length; i += 2) {
      lines.push(pad(items[i], 9) + (items[i + 1] || ''));
    }
    return lines;
  };

  function pad(s, n) { while (s.length < n) s += ' '; return s; }

  /* ---------------- messages ---------------- */
  Calculator.prototype._showMessage = function (lines, opts) {
    this.message = { lines: lines, back: (opts && opts.back) || 'input', result: opts && opts.result };
    this.screen = 'message';
  };

  Calculator.prototype._messageKey = function (name, action) {
    var msg = this.message;
    if (msg && msg.solve) {
      if (action === 'exe' || action === 'solve') { this.message = null; this._startCalc(true, this.calc.expr); return; }
      if (action === 'ac') { this.message = null; this.calc = null; this.ed.clear(); this._toInput(); return; }
      if (action === 'left' || action === 'right') {
        var ex = this.calc.expr; this.message = null; this.calc = null;
        this.ed.load(ex, action === 'right'); this._toInput(); return;
      }
      return;
    }
    if (action === 'ac' || action === 'exe') {
      this.message = null;
      this.screen = this._inEqn() ? 'eqn' : this._inTable() ? 'table' : (this.settings.mode === 'STAT' && this.stat && this.stat.sub !== 'calc' ? 'stat' : 'input');
      if (this.screen === 'eqn') this._eqnAfterSetup();
      return;
    }
    if (action === 'off') { this.message = null; this.powerOff(); }
  };

  /* ---------------- prompts (CONST / CONV / CALC / SOLVE) ---------------- */
  Calculator.prototype._openPrompt = function (kind, extra) {
    if (this.screen !== 'prompt') this.prevScreen = { screen: this.screen };
    this.prompt = { kind: kind, digits: '' };
    if (extra) for (var k in extra) this.prompt[k] = extra[k];
    if (kind === 'calcVar' || kind === 'solveX') {
      this.prompt.editor = new Editor();
      this.prompt.editor.lineMode = true;
    }
    this.screen = 'prompt';
  };

  Calculator.prototype._promptKey = function (name, action) {
    var p = this.prompt;
    if (action === 'off') { this.prompt = null; this.powerOff(); return; }
    if (p.kind === 'const' || p.kind === 'conv') {
      if (action === 'ac') { this.prompt = null; this.screen = this._backScreen(); return; }
      if (action === 'del') { p.digits = p.digits.slice(0, -1); return; }
      var d = digitOf(name);
      if (d === null) return;
      p.digits += String(d);
      if (p.digits.length === 2) {
        var n = parseInt(p.digits, 10);
        if (n < 1 || n > 40) { p.digits = ''; return; }
        var id = (p.kind === 'const' ? 'const:' : 'conv:') + p.digits;
        this.prompt = null;
        this.screen = this._backScreen();
        this._insert('a:' + id, this.screen === 'result');
      }
      return;
    }
    // CALC / SOLVE variable prompts
    var ed = p.editor;
    if (action === 'ac') { this.prompt = null; this.calc = null; this.ed.clear(); this._toInput(); return; }
    if (action === 'exe') { this._promptEnter(); return; }
    if (action === 'calc' && p.kind === 'calcVar') { this._promptEnter(); return; }
    if (action === 'left') { ed.left(); return; }
    if (action === 'right') { ed.right(); return; }
    if (action === 'up' || action === 'down') {
      // move between prompts
      if (action === 'up' && this.calc.idx > 0) { this.calc.idx--; this._nextPrompt(true); }
      return;
    }
    if (action === 'del') { ed.del(); return; }
    if (action === 'ins') { ed.overwrite = !ed.overwrite; return; }
    if (action && (action.indexOf('a:') === 0 || action.indexOf('t:') === 0 || action.indexOf('v:') === 0)) {
      var kind = action.slice(0, 2), id = action.slice(2);
      if (kind === 't:') ed.insertTemplate(id); else ed.insertAtom(id);
    }
  };

  Calculator.prototype._startCalc = function (solve, exprIn) {
    var expr = exprIn || (this.screen === 'result' ? this.lastExpr : this.ed.snapshot());
    if (!expr || !expr.length) return;
    var vars = Editor.collectVars(expr);
    var target = null;
    if (solve) {
      target = 'X';
      if (vars.indexOf('X') < 0) {
        this._showError({ error: 'Variable ERROR' }, expr, 0);
        return;
      }
      vars = vars.filter(function (v) { return v !== target; });
    }
    this.calc = { solve: solve, expr: Editor.cloneRow(expr), vars: vars, idx: 0, target: target };
    this.lastExpr = this.calc.expr;
    this._nextPrompt(true);
  };

  // SHIFT CALC (SOLVE) in a mode without SOLVE (CMPLX): no "Solve for X" prompt. The expression is
  // handed to the engine's solve(), whose error (Syntax ERROR) is shown. If the engine has no solve()
  // or unexpectedly succeeds, the UI shows Syntax ERROR itself. Empty input: key ignored.
  Calculator.prototype._solveUnsupported = function () {
    var expr = this.screen === 'result' ? this.lastExpr : this.ed.snapshot();
    if (!expr || !expr.length) return;
    var A = FX.Adapter;
    var comp = A.compile(expr, this.engineSettings());
    var r = comp.error ? { ok: false, error: comp.error } : null;
    if (!r) {
      var hasSolve = G.CalcEngine && typeof G.CalcEngine.solve === 'function';
      r = hasSolve ? A.solve(comp.tokens, 'X', this.engineSettings(), this.memory) : null;
      if (!r || r.ok) r = { ok: false, error: 'Syntax ERROR' };
      r = { ok: false, error: r.error || 'Syntax ERROR', errorPos: null };
    }
    this.calc = null;
    this.multi = null;
    this._showError(r, expr, 0);
  };

  Calculator.prototype._nextPrompt = function (fresh) {
    var c = this.calc;
    if (c.idx < c.vars.length) {
      this._openPrompt('calcVar', { varName: c.vars[c.idx] });
      return;
    }
    if (c.solve && c.idx === c.vars.length) {
      this._openPrompt('solveX', { varName: c.target });
      return;
    }
    this._finishCalc();
  };

  Calculator.prototype._promptValue = function (v) {
    var A = FX.Adapter;
    var r = A.run([A.varToken(v)], this.engineSettings(), this.memory);
    return r.ok ? r.display : '0';
  };

  Calculator.prototype._promptEnter = function () {
    var p = this.prompt;
    var c = this.calc;
    if (!p.editor.isEmpty()) {
      var r = this._evalRow(p.editor.snapshot());
      if (!r.ok) { this.prompt = null; this.calc = null; this._showError(r, p.editor.snapshot(), 0); return; }
      this.memory[p.varName] = r.value;
    }
    c.idx++;
    this.prompt = null;
    this._nextPrompt(false);
  };

  Calculator.prototype._finishCalc = function () {
    var c = this.calc;
    var A = FX.Adapter;
    if (!c.solve) {
      // CALC: an expression "Y=..." evaluates its right-hand side (assumption)
      var stmts = splitStatements(c.expr);
      var stmt = stmts[stmts.length - 1];
      var eqAt = -1;
      for (var i = 0; i < stmt.length; i++) if (stmt[i].k === 'atom' && stmt[i].id === '=') { eqAt = i; break; }
      var row = eqAt >= 0 ? stmt.slice(eqAt + 1) : stmt;
      var r = this._evalRow(row);
      if (!r.ok) { var e = c.expr; this.calc = null; this._showError(r, e, 0); return; }
      this.memory.Ans = r.value;
      this._applyAssign(r);
      this.res = makeRes(r, false);
      this.shownExpr = c.expr;
      this.screen = 'result';
      this.histIdx = -1; this.multi = null; this.dispFlag = false;
      return;
    }
    // SOLVE
    var comp = A.compile(c.expr, this.engineSettings());
    var sr = A.solve(comp.tokens, c.target, this.engineSettings(), this.memory);
    if (!sr.ok) { var ex = c.expr; this.calc = null; this._showError(sr, ex, 0); return; }
    this.memory[c.target] = sr.value;
    this.memory.Ans = sr.value;
    this.message = {
      solve: true,
      expr: c.expr,
      lines: null,
      rows: [{ label: c.target + '=', value: sr.display }, { label: 'L-R=', value: sr.lr != null ? sr.lr : '0' }]
    };
    this.screen = 'message';
  };

  /* ---------------- EQN (MODE 3) ---------------- */
  // Spec: _workspace/01_spec_eqn.md Part B (screens and keys), G-2 (UI). Engine via FX.Adapter.evalCoeff /
  // FX.Adapter.solveEqn only; the UI never solves or formats values itself.
  //   this.eqn = { sub: 'menu'|'edit'|'sol', type, cells:[{value, cache}], sel, colStart, editing,
  //                sols, solIdx, sdAlt, prev, settingsKey }
  // While a cell is being edited, this.ed holds the cell's expression (same editor as COMP, so
  // MathO templates, INS, DEL, CONST, CONV, hyp and DRG menus all work in a cell).
  var EQN_ORDER = ['lin2', 'lin3', 'quad', 'cubic'];
  var EQN_TYPES = {
    lin2: { rows: 2, cols: 3, heads: ['a', 'b', 'c'], rowNums: true },
    lin3: { rows: 3, cols: 4, heads: ['a', 'b', 'c', 'd'], rowNums: true },
    quad: { rows: 1, cols: 3, heads: ['a', 'b', 'c'], rowNums: false },
    cubic: { rows: 1, cols: 4, heads: ['a', 'b', 'c', 'd'], rowNums: false }
  };
  // EQN_1.png (manual): the type menu. ₙ is written as a small n on the LCD.
  var EQN_MENU = ['1:aₙX+bₙY=cₙ', '2:aₙX+bₙY+cₙZ=dₙ', '3:aX²+bX+c=0', '4:aX³+bX²+cX+d=0'];
  var EQN_VISIBLE_COLS = 3;          // EQN_3.png: 3 columns visible, horizontal scroll
  Calculator.EQN_TYPES = EQN_TYPES;
  Calculator.EQN_MENU = EQN_MENU;

  Calculator.prototype._inEqn = function () { return this.settings.mode === 'EQN' && !!this.eqn; };

  // screen to return to after a prompt (CONST/CONV) closes
  Calculator.prototype._backScreen = function () {
    var prev = this.prevScreen ? this.prevScreen.screen : 'input';
    if (prev === 'eqn' && this._inEqn()) return 'eqn';
    if (prev === 'table' && this._inTable()) return 'table';
    return prev === 'result' && this.res ? 'result' : 'input';
  };

  // MODE 3 (and ON in EQN): equation type menu. prev = the session being replaced (AC returns to it).
  Calculator.prototype._eqnEnter = function (prev) {
    if (prev) prev.prev = null;
    this.eqn = { sub: 'menu', type: null, cells: [], sel: 0, colStart: 0, editing: false,
      sols: null, solIdx: 0, sdAlt: false, prev: prev && prev.type ? prev : null, settingsKey: null };
    this.ed.clear();
    this.screen = 'eqn';
  };

  Calculator.prototype._eqnSelect = function (type) {
    var def = EQN_TYPES[type];
    var e = this.eqn;
    var zero = FX.Adapter.freshMemory().Ans;
    e.type = type;
    e.cells = [];
    for (var i = 0; i < def.rows * def.cols; i++) e.cells.push({ value: zero, cache: null });
    e.sel = 0; e.colStart = 0;
    e.sub = 'edit'; e.editing = false; e.sols = null; e.solIdx = 0; e.sdAlt = false; e.prev = null;
    this.ed.clear();
  };

  Calculator.prototype._eqnKey = function (name, action) {
    var e = this.eqn;
    if (!e) { this.screen = 'input'; this._editKey(name, action); return; }
    if (!action) return;
    if (action === 'off') { this.powerOff(); return; }
    if (action === 'mode') { this._openMenu('mode'); return; }
    if (action === 'setup') { this._openMenu('setup'); return; }
    if (e.sub === 'menu') {
      var d = digitOf(name);
      if (d >= 1 && d <= 4) { this._eqnSelect(EQN_ORDER[d - 1]); return; }
      // AC on the type menu: back to the equation being edited before MODE 3 (if any) [미확인]
      if (action === 'ac' && e.prev) {
        var p = e.prev;
        p.sub = 'edit'; p.editing = false; p.sols = null;
        this.eqn = p;
        this.ed.clear();
      }
      return;
    }
    if (e.sub === 'sol') { this._eqnSolKey(action); return; }
    this._eqnEditKey(name, action);
  };

  Calculator.prototype._eqnEditKey = function (name, action) {
    var e = this.eqn, ed = this.ed;
    if (action.indexOf('a:') === 0 || action.indexOf('t:') === 0 || action.indexOf('v:') === 0) {
      this._eqnInsert(action);
      return;
    }
    switch (action) {
      case 'dms': this._eqnInsert('a:dms'); return;
      case 'left':
      case 'right':
        if (e.editing) { if (action === 'left') ed.left(); else ed.right(); }
        else this._eqnMove(0, action === 'left' ? -1 : 1);
        return;
      case 'up':
      case 'down':
        // inside a fraction: numerator <-> denominator. Otherwise move to the cell above/below; an
        // unfinished entry is dropped (spec G-2.3 recommendation, [명세 공백])
        if (e.editing && !ed.lineMode && ed.vertical(action === 'up' ? -1 : 1)) return;
        if (e.editing) this._eqnCancelEdit();
        this._eqnMove(action === 'up' ? -1 : 1, 0);
        return;
      case 'del':
        if (e.editing) ed.del();
        return;
      case 'ins':
        if (e.editing) { if (ed.lineMode) ed.overwrite = !ed.overwrite; else ed.insWrap = !ed.insWrap; }
        return;
      case 'ac':
        this._eqnClearAll();          // spec B-1: AC on the coefficient screen = all coefficients 0
        return;
      case 'exe':
      case 'exeDec':
        if (e.editing) this._eqnCommit(); else this._eqnSolve();
        return;
      case 'hyp':
      case 'drg':
      case 'clr':
        this._openMenu(action);
        return;
      case 'const':
      case 'conv':
        this._openPrompt(action);
        return;
    }
    // M+, M−, STO (spec B-1 "지원 안 됨"), RCL, CALC, SOLVE, S⇔D, ENG, SHIFT 1~5 menus: ignored here
  };

  // value keys into the selected cell (starts a new entry on the first key)
  Calculator.prototype._eqnInsert = function (action) {
    var e = this.eqn;
    if (!e || e.sub !== 'edit' || !action) return;
    var kind = action.slice(0, 2), id = action.slice(2);
    if (id === 'Pol(' || id === 'Rec(' || id === ':') return;   // spec B-1 / C-2: cannot be entered
    if (!e.editing) { this.ed.clear(); e.editing = true; }
    // QA-U7: `)` leaves a √ template when no `(` is open in it (manual example 4: "(−) 2 √ 2 )")
    if (kind === 'a:' && id === ')' && this.ed.closeTemplate()) return;
    if (kind === 't:') this.ed.insertTemplate(id); else this.ed.insertAtom(id);
  };

  Calculator.prototype._eqnDef = function () { return EQN_TYPES[this.eqn.type]; };

  Calculator.prototype._eqnMove = function (dr, dc) {
    var e = this.eqn, def = this._eqnDef();
    var r = Math.floor(e.sel / def.cols) + dr, c = e.sel % def.cols + dc;
    // no wrap-around at the edges (spec B-1 recommendation [명세 공백])
    r = Math.max(0, Math.min(def.rows - 1, r));
    c = Math.max(0, Math.min(def.cols - 1, c));
    e.sel = r * def.cols + c;
    this._eqnScroll();
  };

  Calculator.prototype._eqnScroll = function () {
    var e = this.eqn, def = this._eqnDef();
    var c = e.sel % def.cols;
    if (c < e.colStart) e.colStart = c;
    if (c >= e.colStart + EQN_VISIBLE_COLS) e.colStart = c - EQN_VISIBLE_COLS + 1;
    e.colStart = Math.max(0, Math.min(Math.max(0, def.cols - EQN_VISIBLE_COLS), e.colStart));
  };

  Calculator.prototype._eqnCancelEdit = function () {
    if (this.eqn) this.eqn.editing = false;
    this.ed.clear();
  };

  Calculator.prototype._eqnClearAll = function () {
    var e = this.eqn;
    this._eqnCancelEdit();
    var zero = FX.Adapter.freshMemory().Ans;
    e.cells = e.cells.map(function () { return { value: zero, cache: null }; });
  };

  // `=` with an entry: evaluate the cell (engine evalCoeff), store, move to the next cell (row-major).
  // On the last cell the cursor stays (spec B-1, EQN_2.png); the next `=` solves.
  Calculator.prototype._eqnCommit = function () {
    var A = FX.Adapter, e = this.eqn;
    if (!this.ed.isEmpty()) {
      var expr = this.ed.snapshot();
      var comp = A.compile(expr, this.engineSettings());
      var r = comp.error ? { ok: false, error: comp.error, errorPos: null }
        : A.evalCoeff(comp.tokens, this.engineSettings(), this.memory);
      if (!r.ok) {
        r.srcMap = comp.srcMap;
        this._showError(r, expr, 0);
        this.error.eqn = { cell: true };
        return;
      }
      e.cells[e.sel] = { value: r.value, cache: null };
    }
    this._eqnCancelEdit();
    if (e.sel < e.cells.length - 1) { e.sel++; this._eqnScroll(); }
  };

  Calculator.prototype._eqnSolve = function () {
    var A = FX.Adapter, e = this.eqn;
    var r = A.solveEqn(e.type, e.cells.map(function (c) { return c.value; }), this.engineSettings(), this.memory);
    if (!r.ok && r.missing) {
      this._showMessage(['EQN solver', 'is not loaded', '(src/engine/eqn.js)', '[AC]:Back'], { back: 'eqn' });
      return;
    }
    if (!r.ok) {
      this._showError({ ok: false, error: r.error || 'Math ERROR', errorPos: null }, [], 0);
      this.error.eqn = { cell: false };
      return;
    }
    // Ans and variables are not changed by EQN solutions (spec C-5 recommendation)
    e.sols = r.solutions;
    e.solIdx = 0;
    e.sdAlt = false;
    e.sub = 'sol';
    e.settingsKey = JSON.stringify(this.settings);
  };

  Calculator.prototype._eqnSolKey = function (action) {
    var e = this.eqn, n = e.sols.length;
    switch (action) {
      case 'exe':
      case 'exeDec':
        // next solution; after the last one back to the coefficient screen (spec B-1 단계4)
        if (e.solIdx < n - 1) e.solIdx++;
        else this._eqnToEdit();
        return;
      case 'down': if (e.solIdx < n - 1) e.solIdx++; return;      // stops at the last (spec 권장)
      case 'up': if (e.solIdx > 0) e.solIdx--; return;
      case 'ac': this._eqnToEdit(); return;                       // coefficients kept (spec B-1)
      case 'sd': e.sdAlt = !e.sdAlt; return;                       // kept while moving between solutions
    }
    // ENG (spec: not available on the solution screen), M+, STO, value keys ...: ignored
  };

  Calculator.prototype._eqnToEdit = function () {
    var e = this.eqn;
    e.sub = 'edit'; e.sols = null; e.solIdx = 0; e.sdAlt = false;
    this._eqnCancelEdit();
  };

  // after SETUP / CLR / a message closed back onto the EQN screen
  Calculator.prototype._eqnAfterSetup = function () {
    var e = this.eqn;
    if (!e) return;
    var key = JSON.stringify(this.settings);
    if (e.sub === 'sol') {
      if (key !== e.settingsKey) {
        // display settings changed: solve again so the solutions follow the new format
        var idx = e.solIdx, sd = e.sdAlt;
        this._eqnSolve();
        if (this.screen === 'eqn' && e.sub === 'sol') { e.solIdx = Math.min(idx, e.sols.length - 1); e.sdAlt = sd; }
      }
      return;
    }
    if (e.editing && this.ed.lineMode !== (this.settings.io === 'LineIO')) this._eqnCancelEdit();
  };

  Calculator.prototype._eqnErrorKey = function (action) {
    var err = this.error;
    if (action === 'off') { this.error = null; this.powerOff(); return; }
    if (action !== 'ac' && action !== 'left' && action !== 'right') return;
    this.error = null;
    this.screen = 'eqn';
    this.eqn.sub = 'edit';
    this.eqn.sols = null;
    this._eqnCancelEdit();
    if (action !== 'ac' && err.eqn.cell) {
      // Goto: back into the cell entry with the cursor at the error
      this.ed.load(err.expr, false);
      if (err.loc) {
        try { this.ed.rowAt(err.loc.path); this.ed.setCursor(err.loc.path, err.loc.pos); } catch (x) { this.ed.end(); }
      }
      this.eqn.editing = true;
    }
  };

  // display node of cell i in the current settings (engine formatValue, cached per settings)
  Calculator.prototype._eqnCellNode = function (i) {
    var c = this.eqn.cells[i];
    var es = this.engineSettings();
    var key = JSON.stringify(es);
    if (!c.cache || c.cache.key !== key) {
      var f = FX.Adapter.formatValue(c.value, es);
      c.cache = { key: key, node: f ? f.display : { type: 'text', value: '?' }, text: f ? f.text : '?' };
    }
    return c.cache;
  };

  // shown form of the current solution: natural, or after S⇔D the decimal (or alt) form
  Calculator.prototype._eqnShown = function () {
    var e = this.eqn, s = e.sols[e.solIdx];
    var form = 'natural';
    if (e.sdAlt) {
      if (displayText(s.natural) !== displayText(s.decimal)) form = 'decimal';
      else if (s.alt != null && displayText(s.alt) !== displayText(s.natural)) form = 'alt';
    }
    var node = form === 'decimal' ? s.decimal : form === 'alt' ? s.alt : s.natural;
    var rows = null;
    if (s.lines && this.settings.io !== 'MathO') {
      rows = s.lines[form] || null;
      if (rows && !rows.length) rows = null;
    }
    return { label: s.label + '=', node: node, form: form, rows: rows };
  };

  Calculator.prototype._eqnState = function () {
    var e = this.eqn;
    if (!e) return null;
    var out = { sub: e.sub, type: e.type, editing: e.editing };
    if (e.type && e.sub !== 'menu') {
      var def = this._eqnDef(), self = this;
      out.sel = e.sel; out.row = Math.floor(e.sel / def.cols); out.col = e.sel % def.cols; out.colStart = e.colStart;
      out.cells = e.cells.map(function (c, i) { return self._eqnCellNode(i).text; });
    }
    if (e.sub === 'sol') {
      var sh = this._eqnShown();
      out.solIdx = e.solIdx; out.solCount = e.sols.length; out.label = sh.label; out.form = sh.form;
      out.solutions = e.sols.map(function (s) { return s.label + '=' + displayText(s.natural); });
    }
    return out;
  };

  // text lines of the EQN screen (getState().lines, QA)
  Calculator.prototype._eqnLines = function () {
    var e = this.eqn;
    if (!e || e.sub === 'menu') return EQN_MENU.slice();
    if (e.sub === 'sol') {
      var sh = this._eqnShown();
      return [sh.label, sh.rows ? sh.rows.map(displayText).join(' ') : displayText(sh.node)];
    }
    var def = this._eqnDef(), self = this;
    var lines = [(def.rowNums ? '  ' : '') + def.heads.join(' ')];
    for (var r = 0; r < def.rows; r++) {
      var cells = [];
      for (var c = 0; c < def.cols; c++) {
        var i = r * def.cols + c;
        var t = this._eqnCellNode(i).text;
        cells.push(i === e.sel ? '[' + t + ']' : t);
      }
      lines.push((def.rowNums ? (r + 1) + ' ' : '') + cells.join(' '));
    }
    lines.push(e.editing ? rowText(this.ed.root) : self._eqnCellNode(e.sel).text);
    return lines;
  };

  // structure for render.js
  Calculator.prototype._eqnScreen = function () {
    var e = this.eqn;
    if (!e || e.sub === 'menu') return { sub: 'menu' };
    if (e.sub === 'sol') {
      var sh = this._eqnShown();
      return { sub: 'sol', label: sh.label, node: sh.node, rows: sh.rows, lineOut: this.settings.io !== 'MathO' || sh.form !== 'natural' };
    }
    var def = this._eqnDef();
    var c0 = e.colStart, c1 = Math.min(def.cols, c0 + EQN_VISIBLE_COLS);
    var rows = [];
    for (var r = 0; r < def.rows; r++) {
      var cells = [];
      for (var c = c0; c < c1; c++) {
        var i = r * def.cols + c;
        cells.push({ node: this._eqnCellNode(i).node, sel: i === e.sel });
      }
      rows.push({ num: def.rowNums ? r + 1 : null, cells: cells });
    }
    var bottom = e.editing
      ? { expr: this.ed.root, cursor: { path: this.ed.cur.path, pos: this.ed.cur.pos, style: this.ed.cursorStyle() } }
      : { node: this._eqnCellNode(e.sel).node };
    return { sub: 'edit', heads: def.heads.slice(c0, c1), rows: rows, bottom: bottom,
      moreLeft: c0 > 0, moreRight: c1 < def.cols };
  };

  /* ---------------- screen description for renderer ---------------- */
  Calculator.prototype.screenLines = function () {
    if (!this.power) return [];
    switch (this.screen) {
      case 'menu': return this.menuLines();
      case 'message': return this.message && this.message.lines ? this.message.lines.slice() : [];
      case 'error': return [this.error.message, '', '[AC] :Cancel', '[◀][▶]:Goto'];
      case 'eqn': return this._eqnLines();
      case 'stat': return this._statLines();
      case 'table': return this._tableLines();
      case 'prompt':
        if (this.prompt.kind === 'const') return ['CONSTANT', 'Number 01~40?', '[' + pad(this.prompt.digits, 2).replace(/ /g, '_') + ']'];
        if (this.prompt.kind === 'conv') return ['CONVERSION', 'Number 01~40?', '[' + pad(this.prompt.digits, 2).replace(/ /g, '_') + ']'];
        if (this.prompt.kind === 'calcVar') return [this.prompt.varName + '?'];
        if (this.prompt.kind === 'solveX') return ['Solve for ' + this.prompt.varName];
    }
    return [];
  };

  Calculator.prototype.getScreen = function () {
    var sc = {
      power: this.power,
      kind: this.power ? this.screen : 'off',
      io: this.settings.io,
      contrast: this.settings.contrast,
      indicators: this.deriveIndicators(),
      lines: this.screenLines()
    };
    if (!this.power) return sc;
    if (this.screen === 'input') {
      sc.expr = this.ed.root;
      sc.cursor = { path: this.ed.cur.path, pos: this.ed.cur.pos, style: this.ed.cursorStyle() };
      sc.lineMode = this.ed.lineMode;
    } else if (this.screen === 'result') {
      sc.expr = this.shownExpr;
      sc.result = this.res ? this.res.shown : null;
      sc.resultRows = this._resultRows();
      sc.lineMode = this.ed.lineMode;
      sc.resultLine = this.settings.io !== 'MathO' || (this.res && this.res.form !== 'natural' && this.res.form !== 'mixed' && this.res.form !== 'alt');
    } else if (this.screen === 'prompt' && this.prompt.editor) {
      var pe = this.prompt.editor;
      sc.promptLabel = this.screenLines()[0];
      sc.promptValue = pe.isEmpty() ? this._promptValue(this.prompt.varName) : null;
      sc.expr = pe.root;
      sc.cursor = { path: pe.cur.path, pos: pe.cur.pos, style: pe.cursorStyle() };
      sc.lineMode = true;
    } else if (this.screen === 'eqn') {
      sc.eqn = this._eqnScreen();
      sc.lineMode = this.ed.lineMode;
    } else if (this.screen === 'stat') {
      sc.eqn = this._statScreen();      // same grid layout as the EQN coefficient screen
      sc.lineMode = this.ed.lineMode;
    } else if (this.screen === 'table') {
      sc.table = this._tableScreen();   // f(X)= / Start? End? Step? / X F(X) grid (EQN grid layout)
      sc.lineMode = this.ed.lineMode;
    } else if (this.screen === 'message' && this.message && this.message.solve) {
      sc.solve = { expr: this.message.expr, rows: this.message.rows };
    }
    return sc;
  };

  FX.Calculator = Calculator;
})(typeof window !== 'undefined' ? window : globalThis);
