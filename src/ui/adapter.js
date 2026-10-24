/*
 * 공학용계산기 시뮬레이터 - UI <-> engine adapter.
 *
 * Contract: src/engine/TOKENS.md (semantic tokens) and .claude/skills/calc-engine-build/SKILL.md.
 * This file is the ONLY place that calls the engine: CalcEngine.evaluate(tokens, settings, memory, opts)
 * (plus CalcEngine.solve when present). Everything else in src/ui talks to FX.Adapter.
 *
 * UI memory shape : { Ans, A, B, C, D, E, F, M, X, Y }      (values are opaque engine values)
 * Engine memory   : { ans, vars: { A, B, C, D, E, F, M, X, Y } }
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'M', 'X', 'Y'];

  function engine() { return G.CalcEngine && typeof G.CalcEngine.evaluate === 'function' ? G.CalcEngine : null; }

  /* ---------------- atom / template -> token ---------------- */
  var OPS = { '+': '+', '−': '-', '×': '*', '÷': '/', 'nPr': 'nPr', 'nCr': 'nCr' };
  var FNS = {
    'sin(': 'sin', 'cos(': 'cos', 'tan(': 'tan', 'sin⁻¹(': 'asin', 'cos⁻¹(': 'acos', 'tan⁻¹(': 'atan',
    'sinh(': 'sinh', 'cosh(': 'cosh', 'tanh(': 'tanh', 'sinh⁻¹(': 'asinh', 'cosh⁻¹(': 'acosh', 'tanh⁻¹(': 'atanh',
    'log(': 'log', 'ln(': 'ln', 'e^(': 'exp', '10^(': 'pow10', '√(': 'sqrt', '³√(': 'cbrt', 'Abs(': 'abs',
    'Pol(': 'pol', 'Rec(': 'rec', 'RanInt#(': 'ranint', 'Rnd(': 'rnd', '∫(': 'integ', 'd/dx(': 'diff', 'Σ(': 'sum',
    'arg(': 'arg', 'Conjg(': 'conjg'                       // CMPLX menu (SHIFT 2 1/2)
  };
  // CMPLX result-format commands (SHIFT 2 3/4), allowed only at the end of an expression (engine checks)
  var CMDS = { '▶r∠θ': 'polar', '▶a+bi': 'rect' };
  var POSTFIX = { '²': 'sq', '³': 'cube', '⁻¹': 'inv', '!': 'fact', '%': 'pct', 'drgD': 'deg', 'drgR': 'rad', 'drgG': 'grad' };
  var BASE_OPS = { 'and': 1, 'or': 1, 'xor': 1, 'xnor': 1 };
  var TPL_NAME = { frac: 'frac', mixed: 'mixed', sqrt: 'sqrt', cbrt: 'cbrt', nroot: 'root', pow: 'pow', pow10: 'pow10',
    powe: 'exp', logb: 'logb', abs: 'abs', integ: 'integ', deriv: 'diff', sum: 'sum' };

  function atomToken(id) {
    if (/^[0-9.]$/.test(id)) return { type: 'num', value: id };
    if (OPS[id]) return { type: 'op', value: OPS[id] };
    if (FNS[id]) return { type: 'fn', name: FNS[id] };
    if (POSTFIX[id]) return { type: 'postfix', name: POSTFIX[id] };
    if (CMDS[id]) return { type: 'cmd', name: CMDS[id] };
    switch (id) {
      case 'i': return { type: 'imag' };                    // CMPLX: ENG key
      case '∠': return { type: 'angle' };                   // CMPLX: SHIFT (−)
      case 'x10': return { type: 'exp10' };
      case 'neg': return { type: 'neg' };
      case '(': return { type: 'paren', value: '(' };
      case ')': return { type: 'paren', value: ')' };
      case ',': return { type: 'comma' };
      case ':': return { type: 'colon' };
      case '=': return { type: 'eq' };
      case 'dms': return { type: 'dms' };
      case '⌟': return { type: 'fracsep' };
      case '^(': return { type: 'infix', name: 'pow' };
      case 'ˣ√(': return { type: 'infix', name: 'xroot' };
      case 'π': return { type: 'const', name: 'pi' };
      case 'e': return { type: 'const', name: 'e' };
      case 'Ans': return { type: 'ans' };
      case 'Ran#': return { type: 'ran' };
    }
    if (VARS.indexOf(id) >= 0) return { type: 'var', name: id };
    if (id.indexOf('const:') === 0) return { type: 'const', name: 'sc', index: parseInt(id.slice(6), 10) };
    if (id.indexOf('conv:') === 0) return { type: 'conv', index: parseInt(id.slice(5), 10) };
    if (id.indexOf('st:') === 0) return { type: 'stat', name: id.slice(3) };                    // STAT values (SHIFT 1 menus)
    if (id.indexOf('sp:') === 0) return { type: 'statpost', name: id.slice(3) };                // x-hat y-hat x-hat1 x-hat2 and the t command
    if (id.indexOf('sf:') === 0) return { type: 'fn', name: id.slice(3).replace('(', '') };     // P( Q( R(
    if (id.indexOf('hx:') === 0) return { type: 'num', value: id.slice(3) };                    // BASE-N hex digit A~F
    if (id.indexOf('rdx:') === 0) return { type: 'radix', value: id.slice(4) };                 // BASE-N prefix d h b o
    if (BASE_OPS[id]) return { type: 'op', value: id };                                          // BASE-N and or xor xnor
    if (id === 'Not(' || id === 'Neg(') return { type: 'fn', name: id === 'Not(' ? 'not' : 'neg' };
    return null; // display-only atoms ('→A', 'M+', 'lbl:...')
  }

  // row -> tokens. srcMap[i] = editor cursor location right AFTER top-level token i
  function rowTokens(row, path, srcMap) {
    var out = [];
    for (var i = 0; i < row.length; i++) {
      var n = row[i];
      var tok;
      if (n.k === 'tpl') {
        var slots = [];
        for (var s = 0; s < n.slots.length; s++) slots.push(rowTokens(n.slots[s], null, null));
        tok = { type: 'tpl', name: TPL_NAME[n.type] || n.type, slots: slots };
      } else {
        tok = atomToken(n.id);
      }
      if (!tok) continue;
      out.push(tok);
      if (srcMap) srcMap.push({ path: path ? path.slice() : [], pos: i + 1 });
    }
    return out;
  }

  function compile(row) {
    var srcMap = [];
    var tokens = rowTokens(row || [], [], srcMap);
    return { tokens: tokens, srcMap: srcMap };
  }

  /* ---------------- memory ---------------- */
  function zero() {
    var E = engine();
    if (E && typeof E.zero === 'function') return E.zero();
    return 0;
  }

  function freshMemory() {
    var m = { Ans: zero() };
    VARS.forEach(function (v) { m[v] = zero(); });
    return m;
  }

  function toEngineMemory(mem) {
    var vars = {};
    VARS.forEach(function (v) { vars[v] = mem[v]; });
    return { ans: mem.Ans, vars: vars, stat: mem.stat || null };
  }

  function withAns(mem, value) {
    var m = {};
    for (var k in mem) m[k] = mem[k];
    m.Ans = value;
    return m;
  }

  function isZero(v) {
    if (v == null) return true;
    if (typeof v === 'number') return v === 0;
    if (typeof v === 'string') return Number(v) === 0;
    var E = engine();
    if (E && typeof E.isZero === 'function') {
      try { return !!E.isZero(v); } catch (e) { /* fall through */ }
    }
    var r = run([{ type: 'ans' }], { io: 'LineIO', angle: 'deg', format: { type: 'norm1', digits: null }, fraction: 'd/c' }, { Ans: v });
    return r.ok && (r.text === '0' || FX.displayText(r.display) === '0');
  }

  /* ---------------- engine call (single call site) ---------------- */
  // Splits UI-only display options out of settings into opts.
  var OPT_KEYS = ['decimalOutput', 'eng', 'dmsOutput', 'sdToggle'];

  function normalizeResult(r) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'Syntax ERROR', errorPos: null };
    var out = {};
    for (var k in r) out[k] = r[k];
    out.ok = !!r.ok && !r.error;
    if (!out.ok && !out.error) out.error = 'Syntax ERROR';
    if (out.display == null && out.text != null) out.display = { type: 'text', value: String(out.text) };
    if (out.errorPos === undefined) out.errorPos = null;
    return out;
  }

  function run(tokens, settings, mem) {
    var E = engine();
    var s = {}, opts = {};
    for (var k in settings) {
      if (OPT_KEYS.indexOf(k) >= 0) opts[k] = settings[k];
      else s[k] = settings[k];
    }
    if (s.disp && !s.decimalSep) s.decimalSep = s.disp;
    var memory = toEngineMemory(mem || freshMemory());
    if (!E) return normalizeResult(FX.FallbackEngine ? FX.FallbackEngine.evaluate(tokens, s, memory, opts) :
      { ok: false, error: 'No Engine' });
    try {
      return normalizeResult(E.evaluate(tokens, s, memory, opts));
    } catch (e) {
      if (G.console) console.error('[adapter] engine threw', e);
      return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: (e && e.pos != null) ? e.pos : null };
    }
  }

  function solve(tokens, varName, settings, mem) {
    var E = G.CalcEngine;
    if (!E || typeof E.solve !== 'function') return { ok: false, error: "Can't Solve", errorPos: null };
    try {
      var r = E.solve(tokens, varName, settings, toEngineMemory(mem));
      var out = normalizeResult(r);
      if (out.ok && r.lr != null) out.lr = r.lrDisplay || r.lr;
      return out;
    } catch (e) {
      return { ok: false, error: (e && (e.calcError || e.kind)) || "Can't Solve", errorPos: null };
    }
  }

  /* ---------------- helpers used by calculator.js ---------------- */
  function ansTokens() { return [{ type: 'ans' }]; }
  function varToken(v) { return { type: 'var', name: v }; }
  function memOpTokens(v, op) { return [{ type: 'var', name: v }, { type: 'op', value: op === '−' ? '-' : '+' }, { type: 'ans' }]; }

  // exponent of the standard engineering form (multiple of 3) for the current result
  function engStdExponent(res) {
    var E = engine();
    if (E && typeof E.toNumber === 'function' && res && res.value != null) {
      try {
        var xv = Math.abs(E.toNumber(res.value));
        if (!isFinite(xv) || xv === 0) return 0;
        // 10-digit mantissa rounding (e.g. 999.99999999999 -> 1000) before taking the exponent
        var ex = Math.floor(Math.log10(Number(xv.toPrecision(10))) + 1e-12);
        return 3 * Math.floor(ex / 3);
      } catch (e0) { /* fall through */ }
    }
    var txt = FX.displayText(res.decimal).replace(/×10\^?\(?([−\-]?\d+)\)?/, 'e$1').replace(/−/g, '-').replace(/,/g, '.');
    var x = Math.abs(parseFloat(txt));
    if (!isFinite(x) || x === 0) return 0;
    var e = Math.floor(Math.log10(x) + 1e-12);
    return 3 * Math.floor(e / 3);
  }

  /* ---------------- CMPLX results ---------------- */
  // Engine result fields for complex values (proposal in _workspace/issues_engine-dev.md "CMPLX"):
  //   view === 'cmplx'                    complex (or polar-format) result
  //   display / decimalNode / alt         one-row forms (MathO), already formatted by the engine
  //   lines / decimalLines / altLines     LineIO/LineO two-row forms [a, +bi] or [r, ∠θ]
  //                                       (engine gives lines as [{node, text}, {node, text}])
  // The UI never splits a value into parts itself: when the engine gives no *Lines field the one-row
  // node is shown on a single line.
  function isComplexResult(r) {
    return !!r && (r.view === 'cmplx' || r.view === 'complex' || r.complex === true);
  }

  // form: 'natural' | 'decimal' | 'alt'  ->  array of DisplayNodes (1 or 2 rows) or null
  function complexLines(r, form) {
    if (!r) return null;
    var key = form === 'decimal' ? 'decimalLines' : form === 'alt' ? 'altLines' : 'lines';
    var v = r[key];
    if (!v && r.cmplx && r.cmplx[key]) v = r.cmplx[key];
    if (!Array.isArray(v) || !v.length) return null;
    // items may be DisplayNodes, strings, or the engine's {node, text} pairs (format.js assembleC)
    return v.map(function (n) {
      if (typeof n === 'string') return { type: 'text', value: n };
      if (n && n.node !== undefined && n.type === undefined) return n.node;
      return n;
    });
  }

  /* ---------------- EQN (MODE 3) ---------------- */
  // Contract: _workspace/01_spec_eqn.md Part G-1 (engine API CalcEngine.solveEqn / CalcEngine.evalCoeff).
  // The UI never solves anything itself. Coefficient cells are evaluated by the engine (evalCoeff, or
  // evaluate() with the same real-only checks when evalCoeff is absent); solving needs solveEqn.
  var EQN_TYPES = ['lin2', 'lin3', 'quad', 'cubic'];

  function textNode(s) { return { type: 'text', value: String(s) }; }

  function copySettings(settings, mode) {
    var s = {};
    for (var k in settings) s[k] = settings[k];
    if (mode) s.mode = mode;
    return s;
  }

  // a value -> its display node in the current settings (cells keep the exact value and this node)
  function formatValue(value, settings) {
    var r = run([{ type: 'ans' }], copySettings(settings, 'COMP'), { Ans: value });
    return r.ok ? { display: r.display, text: r.text != null ? String(r.text) : FX.displayText(r.display) } : null;
  }

  // tokens of one coefficient cell -> {ok, value, display, text, error, errorPos}
  function evalCoeff(tokens, settings, mem) {
    var E = engine();
    var r;
    if (E && typeof E.evalCoeff === 'function') {
      try {
        r = normalizeResult(E.evalCoeff(tokens, settings, toEngineMemory(mem || freshMemory())));
      } catch (e) {
        return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null };
      }
    } else {
      // engine without evalCoeff: plain evaluate() in COMP with the spec's checks (G-1.4)
      var multi = tokens.some(function (t) { return t.type === 'colon' || (t.type === 'fn' && (t.name === 'pol' || t.name === 'rec')); });
      if (multi) return { ok: false, error: 'Syntax ERROR', errorPos: null };
      r = run(tokens, copySettings(settings, 'COMP'), mem);
      if (r.ok && (r.view === 'multi' || isComplexResult(r) || (E && E.isComplex && E.isComplex(r.value)))) {
        return { ok: false, error: 'Math ERROR', errorPos: null };
      }
    }
    if (!r.ok) return r;
    if (r.display == null) {
      var f = formatValue(r.value, settings);
      if (f) { r.display = f.display; r.text = f.text; }
    }
    if (r.text == null) r.text = FX.displayText(r.display);
    return r;
  }

  // one engine Solution -> the fields calculator.js uses
  function eqnSolution(s, i) {
    var cx = s.kind === 'complex' || isComplexResult(s);
    var natural = s.display != null ? s.display : (s.text != null ? textNode(s.text) : textNode('?'));
    var dec = s.decimalNode != null ? s.decimalNode : (s.decimal != null ? textNode(s.decimal) : natural);
    return {
      label: s.label || ('X' + (i + 1)),
      value: s.value,
      kind: cx ? 'complex' : 'real',
      natural: natural,
      decimal: dec,
      alt: s.alt != null ? s.alt : null,
      text: s.text != null ? String(s.text) : FX.displayText(natural),
      lines: cx ? { natural: complexLines(s, 'natural'), decimal: complexLines(s, 'decimal'), alt: complexLines(s, 'alt') } : null
    };
  }

  // type: 'lin2'|'lin3'|'quad'|'cubic', coeffs: engine values (row-major)
  // -> {ok, error, type, solutions:[{label, value, kind, natural, decimal, alt, text, lines}]}
  function solveEqn(type, coeffs, settings, mem) {
    var E = engine();
    if (!E || typeof E.solveEqn !== 'function') return { ok: false, error: 'No Engine', errorPos: null, missing: true };
    var r;
    try {
      r = E.solveEqn(type, coeffs, copySettings(settings, 'EQN'), toEngineMemory(mem || freshMemory()));
    } catch (e) {
      return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null };
    }
    if (!r || !r.ok || r.error) return { ok: false, error: (r && r.error) || 'Math ERROR', errorPos: null };
    var list = (r.solutions || []).map(eqnSolution);
    if (!list.length) return { ok: false, error: 'Math ERROR', errorPos: null };
    return { ok: true, error: null, type: r.type || type, solutions: list };
  }

  // rows: [{x, y, f}] engine values (null = empty cell) -> engine statistics object (memory.stat)
  function statAnalyze(type, rows) {
    var E = engine();
    if (!E || typeof E.statAnalyze !== 'function') return { ok: false, error: 'Math ERROR' };
    try { return E.statAnalyze(type, rows); } catch (e) { return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR' }; }
  }

  /* ---------------- TABLE (MODE 7) ---------------- */
  // Contract: src/engine/table.js (CalcEngine.tableCheck / tableParam / tableGenerate), _workspace/02_engine_changes.md.
  // The UI never computes X values or f(X) itself. Without the engine functions every call reports
  // missing:true and calculator shows a "not loaded" message.
  function engSettings(settings) {
    var s = {};
    for (var k in settings) if (OPT_KEYS.indexOf(k) < 0) s[k] = settings[k];
    if (s.disp && !s.decimalSep) s.decimalSep = s.disp;
    s.mode = 'TABLE';
    return s;
  }
  function tableMissing(name) {
    var E = engine();
    return !E || typeof E[name] !== 'function';
  }
  // manual p.42: unit conversion (CONV) is not usable in TABLE (CONST is). The engine's tableCheck rejects it;
  // this scan only covers the engine-missing fallbacks below. -> top-level index or -1
  function convIndex(tokens) {
    function has(t) {
      if (!t) return false;
      if (t.type === 'conv') return true;
      var sl = t.slots || [];
      for (var i = 0; i < sl.length; i++) for (var j = 0; j < (sl[i] || []).length; j++) if (has(sl[i][j])) return true;
      return false;
    }
    for (var i = 0; tokens && i < tokens.length; i++) if (has(tokens[i])) return i;
    return -1;
  }
  // f(X) entry check on `=` -> {ok, error, errorPos}
  function tableCheck(tokens) {
    if (tableMissing('tableCheck')) {
      var ci = convIndex(tokens);
      if (ci >= 0) return { ok: false, error: 'Syntax ERROR', errorPos: ci };
      return { ok: !!(tokens && tokens.length), error: tokens && tokens.length ? null : 'Syntax ERROR', errorPos: null };
    }
    try { return engine().tableCheck(tokens); } catch (e) { return { ok: false, error: (e && (e.calcError || e.kind)) || 'Syntax ERROR', errorPos: null }; }
  }
  // one Start/End/Step entry -> {ok, value, error, errorPos}
  function tableParam(tokens, settings, mem) {
    if (tableMissing('tableParam')) {
      var ci = convIndex(tokens);
      if (ci >= 0) return { ok: false, error: 'Syntax ERROR', errorPos: ci };
      return run(tokens, copySettings(settings, 'COMP'), mem);
    }
    try { return normalizeResult(engine().tableParam(tokens, engSettings(settings), toEngineMemory(mem || freshMemory()))); }
    catch (e) { return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null }; }
  }
  // -> {ok, error, errorPos, stage, rows:[{x, xNode, xText, fx, fxNode, fxText, error}], lastX} | {ok:false, missing:true}
  function tableGenerate(tokens, start, end, step, settings, mem) {
    if (tableMissing('tableGenerate')) return { ok: false, error: 'No Engine', errorPos: null, missing: true };
    try {
      var r = engine().tableGenerate(tokens, start, end, step, engSettings(settings), toEngineMemory(mem || freshMemory()));
      if (!r || !r.ok || r.error) return { ok: false, error: (r && r.error) || 'Math ERROR', errorPos: r ? r.errorPos : null, stage: r ? r.stage : null };
      return r;
    } catch (e) {
      return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null };
    }
  }
  // initial Start / End / Step values (manual 62쪽: 1, 5, 1) as engine values
  function tableDefaults() {
    var E = engine(), d = (E && E.TABLE_DEFAULTS) || { start: 1, end: 5, step: 1 };
    function v(n) { return E && typeof E.fromInput === 'function' ? E.fromInput(String(n)) : n; }
    return { start: v(d.start), end: v(d.end), step: v(d.step) };
  }

  /* ---------------- BASE-N (MODE 4) ---------------- */
  // Contract: src/engine/basen.js (CalcEngine.evaluateBase / baseConvert / baseZero), _workspace/02_engine_changes.md.
  // settings.base = 'DEC'|'HEX'|'BIN'|'OCT'. Results: {ok, value, n, base, indicator, text, display, error, errorPos}
  // with display/text already in the fixed-width form of the base. Without the engine: missing:true.
  function baseMissing(name) { var E = engine(); return !E || typeof E[name] !== 'function'; }
  function baseRun(tokens, settings, mem) {
    if (baseMissing('evaluateBase')) return { ok: false, error: 'No Engine', errorPos: null, missing: true };
    var s = {};
    for (var k in settings) if (OPT_KEYS.indexOf(k) < 0) s[k] = settings[k];
    try { return normalizeResult(engine().evaluateBase(tokens, s, toEngineMemory(mem || freshMemory()))); }
    catch (e) { return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null }; }
  }
  function baseConvert(value, base) {
    if (baseMissing('baseConvert')) return { ok: false, error: 'No Engine', errorPos: null, missing: true };
    try { return normalizeResult(engine().baseConvert(value, base)); }
    catch (e) { return { ok: false, error: (e && (e.calcError || e.kind)) || 'Math ERROR', errorPos: null }; }
  }
  // 0 of a base as shown on the result line ('0', '00000000', '0000000000000000', '00000000000'); null without engine
  function baseZero(base) {
    if (baseMissing('baseZero')) return null;
    try { return engine().baseZero(base); } catch (e) { return null; }
  }

  FX.Adapter = {
    baseRun: baseRun,
    baseConvert: baseConvert,
    baseZero: baseZero,
    hasBase: function () { return !baseMissing('evaluateBase'); },
    tableCheck: tableCheck,
    tableParam: tableParam,
    tableGenerate: tableGenerate,
    tableDefaults: tableDefaults,
    hasTable: function () { return !tableMissing('tableGenerate'); },
    statAnalyze: statAnalyze,
    EQN_TYPES: EQN_TYPES,
    evalCoeff: evalCoeff,
    solveEqn: solveEqn,
    formatValue: formatValue,
    hasEqnSolver: function () { var E = engine(); return !!(E && typeof E.solveEqn === 'function'); },
    isComplexResult: isComplexResult,
    complexLines: complexLines,
    compile: compile,
    atomToken: atomToken,
    run: run,
    solve: solve,
    freshMemory: freshMemory,
    withAns: withAns,
    isZero: isZero,
    ansTokens: ansTokens,
    varToken: varToken,
    memOpTokens: memOpTokens,
    engStdExponent: engStdExponent,
    hasEngine: function () { return !!engine(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
