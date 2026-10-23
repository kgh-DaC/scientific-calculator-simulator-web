/*
 * CalcEngine 공개 API (계약: .claude/skills/calc-engine-build/SKILL.md, src/engine/TOKENS.md)
 *   evaluate(tokens, settings, memory, opts) -> {ok, value, display, text, decimal, error, errorPos, view, alt, assign, multi, ...}
 *   solve(tokens, varName, settings, memory) -> {ok, value, display, text, lr, lrDisplay, error}
 *   zero(), isZero(v), add(a,b), sub(a,b), fromInput(x), format(value, settings, opts)
 * 브라우저: core.js → parser.js → constants.js → evaluator.js → format.js → api.js 순서로 <script> 로드.
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core, PA = CE._parser, EV = CE._eval, FM = CE._format;

  var DEFAULTS = { mode: 'COMP', cmplxFormat: 'a+bi', io: 'MathO', angle: 'deg', format: { type: 'norm1', digits: null }, fraction: 'd/c', decimalSep: 'dot' };
  function normSettings(s) {
    s = s || {};
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in s) if (s[k2] !== undefined && s[k2] !== null) o[k2] = s[k2];
    if (!o.format || !o.format.type) o.format = DEFAULTS.format;
    if (o.io === 'LineI' || o.io === 'Line') o.io = 'LineIO';
    if (o.io !== 'MathO' && o.io !== 'LineO' && o.io !== 'LineIO') o.io = 'MathO';
    if (!o.decimalSep && o.disp) o.decimalSep = o.disp;
    var md = String(o.mode || 'COMP').toUpperCase();
    o.mode = (md === 'CMPLX' || md === 'EQN') ? md : 'COMP'; // EQN 계수 식은 COMP 와 같은 규칙으로 계산(복소수 토큰 불가)
    var cf = s.cmplxFormat || s.complex;
    o.cmplxFormat = (cf === 'r∠θ' || cf === 'polar' || cf === 'r<θ' || cf === 'rθ') ? 'r∠θ' : 'a+bi';
    return o;
  }
  function normMemory(m) {
    m = m || {};
    var vars = m.vars || {};
    return { ans: m.ans !== undefined ? m.ans : (m.Ans !== undefined ? m.Ans : 0), vars: vars };
  }
  function errKind(e) {
    if (e && e.calcError) return e.calcError;
    return 'Math ERROR'; // BigInt 크기 초과 등 내부 예외
  }

  function multiSep(settings) { return (settings.decimalSep === 'comma' || settings.decimalSep === 'Comma') ? ';' : ','; }

  // CMPLX 결과: view 'cmplx'. form = 'rect' | 'polar'
  function buildComplex(v, ctx, settings, opts, form) {
    var a, b;
    if (form === 'polar') { var p = EV.polarOf(v, settings); a = p.r; b = p.th; }
    else { a = C.reOf(v); b = C.imOf(v); }
    var f = FM.formatComplex(form, a, b, settings, ctx.flags, opts);
    var rect = form === 'rect';
    return {
      ok: true, error: null, errorPos: null,
      value: f.exact || v, display: f.display, text: f.text,
      decimal: f.decimal, decimalNode: f.decimalNode,
      alt: f.alt, altText: f.altText, view: 'cmplx', format: form,
      re: rect ? f.partA.display : null, im: rect ? f.partB.display : null,
      reText: rect ? f.partA.text : null, imText: rect ? f.partB.text : null,
      r: rect ? null : f.partA.display, theta: rect ? null : f.partB.display,
      rText: rect ? null : f.partA.text, thetaText: rect ? null : f.partB.text,
      lines: f.lines, decimalLines: f.decimalLines, altLines: f.altLines,
      engExp: null, dms: false, assign: null, multi: null
    };
  }

  function buildResult(v, ctx, settings, opts, cmd) {
    if (!ctx.multi && settings.mode === 'CMPLX') {
      var form = cmd === 'polar' ? 'polar' : cmd === 'rect' ? 'rect' : (settings.cmplxFormat === 'r∠θ' ? 'polar' : 'rect');
      if (v.k === 'c' || (form === 'polar' && !C.isZero(v))) return buildComplex(v, ctx, settings, opts || {}, form);
    }
    var f = FM.formatValue(v, settings, ctx.flags, opts);
    var value = v;
    if (f.exact) value = C.withTag(f.exact, v.tag);
    var r = {
      ok: true, error: null, errorPos: null,
      value: value, display: f.display, text: f.text,
      decimal: f.decimal, decimalNode: f.decimalNode,
      alt: f.alt, altText: f.altText, view: f.view,
      engExp: f.engExp != null ? f.engExp : null, dms: !!f.dms,
      assign: null, multi: null
    };
    if (ctx.multi) {
      // Pol/Rec: 두 값 모두 같은 opts(SHIFT =, S⇔D 등)로 포맷하고, 소수·전환 형태도 두 값을 묶은 row 로 준다(QA-E3).
      var sep = multiSep(settings);
      var items = ctx.multi.map(function (m) {
        var fm = FM.formatValue(m.value, settings, ctx.flags, opts || {});
        // S⇔D 를 누른 뒤의 형태: sdToggle 을 뒤집어 다시 포맷
        var tOpts = {}; for (var k in (opts || {})) tOpts[k] = opts[k];
        tOpts.sdToggle = !(opts && opts.sdToggle);
        var ft = FM.formatValue(m.value, settings, ctx.flags, tOpts);
        return {
          label: m.label, value: fm.exact || m.value, display: fm.display, text: fm.text, view: fm.view,
          decimal: fm.decimal, decimalNode: fm.decimalNode,
          toggled: ft.display, toggledText: ft.text
        };
      });
      function joinRow(nodeKey) {
        var ch = [];
        items.forEach(function (it, i) {
          if (i) ch.push({ type: 'text', value: sep });
          ch.push({ type: 'text', value: it.label + '=' });
          ch.push(it[nodeKey]);
        });
        return { type: 'row', children: ch };
      }
      function joinText(textKey) { return items.map(function (it) { return it.label + '=' + it[textKey]; }).join(sep); }
      r.multi = items;
      r.assign = { X: items[0].value, Y: items[1].value };
      r.display = joinRow('display');
      r.text = joinText('text');
      r.decimalNode = joinRow('decimalNode');
      r.decimal = joinText('decimal');
      var altText = joinText('toggledText');
      if (altText !== r.text) { r.alt = joinRow('toggled'); r.altText = altText; }
      else { r.alt = null; r.altText = null; }
      r.engExp = null; r.dms = false;
      r.view = 'multi';
    }
    return r;
  }

  function evaluate(tokens, settings, memory, opts) {
    settings = normSettings(settings);
    memory = normMemory(memory);
    opts = opts || {};
    try {
      var stmts = PA.parseProgram(tokens, { mode: settings.mode });
      var ans = memory.ans, res = null, steps = [];
      for (var i = 0; i < stmts.length; i++) {
        var st = stmts[i];
        var mem = { ans: ans, vars: memory.vars };
        var ctx = new EV.Ctx(settings, mem, opts);
        var node = st.rhs || st.expr;
        EV.checkStack(st.expr);
        if (st.rhs) EV.checkStack(st.rhs);
        var v = EV.ev(node, ctx);
        res = buildResult(v, ctx, settings, opts, st.cmd);
        if (st.rhs && st.expr.t === 'var') res.assign = (function (o) { o[st.expr.name] = res.value; return o; })({});
        steps.push(res);
        ans = res.value;
      }
      if (steps.length > 1) res.steps = steps;
      return res;
    } catch (e) {
      if (!(e && e.calcError) && root.console && root.CALC_DEBUG) console.error(e);
      return { ok: false, error: errKind(e), errorPos: e && e.pos != null ? e.pos : null, value: null, display: null, text: errKind(e) };
    }
  }

  // ---------- SOLVE (뉴턴법) ----------
  function solve(tokens, varName, settings, memory) {
    settings = normSettings(settings);
    memory = normMemory(memory);
    if (settings.mode !== 'COMP') return { ok: false, error: 'Syntax ERROR', errorPos: null }; // SOLVE 는 COMP 전용 [가정]
    try {
      var stmts = PA.parseProgram(tokens, { allowSolveVar: true });
      var st = stmts[stmts.length - 1];
      var vars = PA.collectVars(st.expr, []);
      if (st.rhs) PA.collectVars(st.rhs, vars);
      var target = st.solveVar || varName || (vars.indexOf('X') >= 0 ? 'X' : null);
      if (!target || vars.indexOf(target) < 0) return { ok: false, error: 'Variable ERROR', errorPos: null };
      var ctx = new EV.Ctx(settings, memory, {});
      function F(x) {
        ctx.bound = {}; ctx.bound[target] = C.fromDouble(x);
        var l = C.toDouble(EV.ev(st.expr, ctx));
        var r = st.rhs ? C.toDouble(EV.ev(st.rhs, ctx)) : 0;
        ctx.bound = null;
        return { lr: l - r, scale: Math.max(Math.abs(l), Math.abs(r)) };
      }
      var x = C.toDouble(C.fromInput(memory.vars[target]));
      var fx = F(x), it;
      for (it = 0; it < 200 && fx.lr !== 0; it++) {
        var h = Math.max(1e-8, Math.abs(x) * 1e-8);
        var d = (F(x + h).lr - F(x - h).lr) / (2 * h);
        if (!isFinite(d) || d === 0) { x += 0.1 * (Math.abs(x) + 1); fx = F(x); continue; }
        var nx = x - fx.lr / d;
        if (!isFinite(nx)) break;
        var conv = Math.abs(nx - x) <= 1e-15 * Math.max(1, Math.abs(nx));
        x = nx; fx = F(x);
        if (conv) break;
      }
      if (!isFinite(x) || Math.abs(fx.lr) > 1e-9 * Math.max(1, fx.scale)) return { ok: false, error: "Can't Solve", errorPos: null };
      var xv = C.fromDouble(x);
      var lr = Math.abs(fx.lr) <= 1e-13 * Math.max(1, fx.scale) ? 0 : fx.lr;
      var xd = FM.formatDecimalQ(xv.k === 'a' ? xv.q : C.toApproxQ(xv), settings);
      var lq = C.fromDouble(lr);
      var ld = FM.formatDecimalQ(lq.k === 'a' ? lq.q : C.toApproxQ(lq), settings);
      return { ok: true, error: null, errorPos: null, value: xv, display: xd.node, text: xd.text, decimal: xd.text,
        lr: ld.text, lrDisplay: ld.node, lrValue: lq, variable: target };
    } catch (e) {
      return { ok: false, error: errKind(e), errorPos: e && e.pos != null ? e.pos : null };
    }
  }

  CE.evaluate = evaluate;
  CE.solve = solve;
  CE.zero = function () { return C.V0; };
  CE.isZero = function (v) { return C.isZero(C.fromInput(v)); };
  CE.add = function (a, b) { return C.add(C.fromInput(a), C.fromInput(b)); };
  CE.sub = function (a, b) { return C.sub(C.fromInput(a), C.fromInput(b)); };
  CE.fromInput = function (x) { return C.fromInput(x); };
  CE.format = function (v, settings, opts) {
    v = C.fromInput(v); settings = normSettings(settings);
    if (v.k === 'c') return FM.formatComplex('rect', v.re, v.im, settings, {}, opts || {});
    return FM.formatValue(v, settings, {}, opts || {});
  };
  // 복소수는 실수부의 근사값 (ENG 지수 계산 등)
  CE.toNumber = function (v) { return C.toDouble(C.reOf(C.fromInput(v))); };
  CE.isComplex = function (v) { return C.isC(v); };
  CE.version = 'eqn-1';
  CE._api = { normSettings: normSettings, normMemory: normMemory, errKind: errKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
