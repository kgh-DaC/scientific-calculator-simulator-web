/*
 * CalcEngine parser: 의미 토큰(TOKENS.md) → AST.
 * 우선순위(설명서 technical_informatoin/sequence, 낮은 번호가 먼저):
 *  1 괄호  2 괄호 포함 함수(sin( 등)  3 후위 함수(x², x⁻¹, x!, °′″, %, °ʳᵍ, ▸t), x^, ⁿ√
 *  4 분수(⌟)  5 (−)  6 단위변환, STAT 추정값(x̂ ŷ x̂1 x̂2)  7 생략된 곱셈  8 nPr nCr ∠  10 × ÷  11 + −
 * (9 내적, 12~13 논리연산은 쓰지 않음)
 * CMPLX 모드(opts.mode==='CMPLX')에서만: imag(i), angle(∠), fn arg/conjg, 식 끝 cmd polar/rect. 다른 모드에서는 Syntax ERROR.
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core;

  var OP_ALIAS = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '^': '^', 'nPr': 'nPr', 'nCr': 'nCr', 'P': 'nPr', 'C': 'nCr' };
  var FN_ARGS = {
    sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1],
    sinh: [1, 1], cosh: [1, 1], tanh: [1, 1], asinh: [1, 1], acosh: [1, 1], atanh: [1, 1],
    log: [1, 2], ln: [1, 1], exp: [1, 1], pow10: [1, 1], sqrt: [1, 1], cbrt: [1, 1], abs: [1, 1],
    pol: [2, 2], rec: [2, 2], ranint: [2, 2], rnd: [1, 1], integ: [3, 4], diff: [2, 3], sum: [3, 3],
    arg: [1, 1], conjg: [1, 1],
    normP: [1, 1], normQ: [1, 1], normR: [1, 1]
  };
  var STAT_FN = { normP: 1, normQ: 1, normR: 1 };   // STAT 전용: 정규분포 P( Q( R(
  // STAT 전용 후위 명령. 매뉴얼 71쪽: 추정값 x̂ ŷ x̂1 x̂2 는 우선순위 6(단위변환과 같음), ▸t 는 우선순위 3(x², x! 과 같음)
  var STAT_POST = { xhat: 1, xhat1: 1, xhat2: 1, yhat: 1 };
  var STAT_POST_3 = { tnorm: 1 };
  var CMPLX_FN = { arg: 1, conjg: 1 };
  var CMDS = { polar: 1, rect: 1 };
  var TPL_SLOTS = {
    frac: 2, mixed: 3, sqrt: 1, cbrt: 1, root: 2, pow: 1, pow10: 1, exp: 1, logb: 2, abs: 1,
    integ: 3, diff: 2, sum: 3
  };
  var POSTFIX = { sq: 1, cube: 1, inv: 1, fact: 1, pct: 1, deg: 1, rad: 1, grad: 1 };
  var VARS = { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, M: 1, X: 1, Y: 1 };

  function synErr(pos) { return C.CalcError('Syntax ERROR', pos); }

  // num 토큰 병합 + 원래 인덱스 보존
  function prep(tokens, mapPos) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (!tk || typeof tk !== 'object' || !tk.type) throw synErr(mapPos(i));
      if (tk.type === 'num') {
        var last = out[out.length - 1];
        if (last && last.type === 'num' && last._e === i - 1) {
          last.value += String(tk.value); last._e = i; continue;
        }
        out.push({ type: 'num', value: String(tk.value), _s: i, _e: i });
        continue;
      }
      var o = {}; for (var k in tk) o[k] = tk[k];
      o._s = i; o._e = i;
      if (o.type === 'op') {
        var v = OP_ALIAS[o.value];
        if (!v) throw synErr(mapPos(i));
        o.value = v;
      }
      out.push(o);
    }
    return out;
  }

  function Parser(tokens, mapPos, opts) {
    this.mapPos = mapPos || function (i) { return i; };
    this.toks = prep(tokens, this.mapPos);
    this.i = 0;
    this.opts = opts || {};
  }
  var P = Parser.prototype;
  P.peek = function (o) { return this.toks[this.i + (o || 0)]; };
  P.next = function () { return this.toks[this.i++]; };
  P.atEnd = function () { return this.i >= this.toks.length; };
  P.pos = function (tk) { return tk ? this.mapPos(tk._e) : (this.toks.length ? this.mapPos(this.toks[this.toks.length - 1]._e) : this.mapPos(0)); };
  P.err = function (tk) { return synErr(tk ? this.mapPos(tk._s) : this.pos(null)); };
  P.lastPos = function () { var t = this.toks[this.i - 1]; return t ? this.mapPos(t._e) : this.mapPos(0); };
  P.isOp = function (tk, v) { return tk && tk.type === 'op' && tk.value === v; };
  P.cmplx = function () { return this.opts.mode === 'CMPLX'; };
  P.stat = function () { return this.opts.mode === 'STAT'; };
  P.node = function (n, s) { n.s = s; n.e = this.lastPos(); return n; };

  P.parseExpr = function () { return this.parseAdd(); };
  P.parseAdd = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var l = this.parseMul();
    while (true) {
      var tk = this.peek();
      if (this.isOp(tk, '+') || this.isOp(tk, '-')) {
        this.next();
        var r = this.parseMul();
        l = this.node({ t: 'bin', op: tk.value, l: l, r: r }, s);
      } else break;
    }
    return l;
  };
  P.parseMul = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var l = this.parsePerm();
    while (true) {
      var tk = this.peek();
      if (this.isOp(tk, '*') || this.isOp(tk, '/')) {
        this.next();
        var r = this.parsePerm();
        l = this.node({ t: 'bin', op: tk.value, l: l, r: r }, s);
      } else break;
    }
    return l;
  };
  P.parsePerm = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var l = this.parseImp();
    while (true) {
      var tk = this.peek();
      if (this.isOp(tk, 'nPr') || this.isOp(tk, 'nCr')) {
        this.next();
        var r = this.parseImp();
        l = this.node({ t: 'bin', op: tk.value, l: l, r: r }, s);
      } else if (tk && tk.type === 'angle') {
        if (!this.cmplx()) throw this.err(tk);
        this.next();
        var ra = this.parseImp();
        l = this.node({ t: 'bin', op: 'angle', l: l, r: ra }, s);
      } else break;
    }
    return l;
  };
  // × 생략 가능: ( , 괄호 포함 함수, 템플릿 함수, Ran#, 변수, 상수, π, e, Ans 직전
  function canStartImplicit(tk) {
    if (!tk) return false;
    switch (tk.type) {
      case 'paren': return tk.value === '(';
      case 'fn': case 'ran': case 'var': case 'const': case 'ans': case 'exp10': case 'imag': case 'stat': return true;
      case 'tpl': return tk.name !== 'pow';
      default: return false;
    }
  }
  P.parseImp = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var l = this.parseConv();
    while (canStartImplicit(this.peek())) {
      var r = this.parseConv();
      l = this.node({ t: 'bin', op: 'imul', l: l, r: r }, s);
    }
    return l;
  };
  P.parseConv = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var a = this.parseNeg();
    while (this.peek() && (this.peek().type === 'conv' || this.peek().type === 'statpost')) {
      var tk = this.next();
      if (tk.type === 'statpost') {   // STAT 추정값(x̂ ŷ x̂1 x̂2): 우선순위 6, 단위변환과 같다. ▸t 는 parsePost 에서 처리
        // ▸t 가 6위 명령 뒤에 오면(3x̂▸t) 왼쪽 전체에 붙는 것 말고는 해석이 없다
        if (!this.stat() || !(STAT_POST[tk.name] || STAT_POST_3[tk.name])) throw this.err(tk);
        a = this.node({ t: 'statpost', name: tk.name, a: a }, s);
        continue;
      }
      var idx = tk.index | 0;
      if (idx < 1 || idx > 40) throw this.err(tk);
      a = this.node({ t: 'conv', index: idx, a: a }, s);
    }
    return a;
  };
  P.parseNeg = function () {
    var tk = this.peek();
    if (!tk) throw synErr(this.pos(null));
    if (tk.type === 'neg' || this.isOp(tk, '-')) {
      this.next();
      var s = this.mapPos(tk._s);
      var a = this.parseNeg();
      return this.node({ t: 'neg', a: a }, s);
    }
    if (this.isOp(tk, '+')) { this.next(); return this.parseNeg(); }
    return this.parseFrac();
  };
  P.parseFrac = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var a = this.parsePost();
    if (this.peek() && this.peek().type === 'fracsep') {
      this.next();
      var b = this.parsePost();
      if (this.peek() && this.peek().type === 'fracsep') {
        this.next();
        var c = this.parsePost();
        return this.node({ t: 'mixed', i: a, a: b, b: c, line: true }, s);
      }
      return this.node({ t: 'frac', a: a, b: b, line: true }, s);
    }
    return a;
  };
  P.parsePost = function () {
    var s = this.peek() ? this.mapPos(this.peek()._s) : null;
    var a = this.parsePrimary();
    while (true) {
      var tk = this.peek();
      if (!tk) break;
      if (tk.type === 'postfix') {
        if (!POSTFIX[tk.name]) throw this.err(tk);
        this.next();
        a = this.node({ t: 'post', name: tk.name, a: a }, s);
      } else if (tk.type === 'statpost' && STAT_POST_3[tk.name]) {
        // ▸t: 매뉴얼 71쪽 우선순위 3(입력값 뒤에 오는 함수). (−)3▸t = −(3▸t)
        if (!this.stat()) throw this.err(tk);
        this.next();
        a = this.node({ t: 'statpost', name: tk.name, a: a }, s);
      } else if (tk.type === 'tpl' && tk.name === 'pow') {
        this.next();
        var ex = this.parseSlot(tk, 0);
        a = this.node({ t: 'pow', a: a, b: ex }, s);
      } else if (this.isOp(tk, '^')) {
        this.next();
        var nt = this.peek(), b;
        if (nt && (nt.type === 'neg' || this.isOp(nt, '-'))) {
          this.next(); var bs = this.mapPos(nt._s);
          b = this.node({ t: 'neg', a: this.parsePrimary() }, bs);
        } else b = this.parsePrimary();
        a = this.node({ t: 'pow', a: a, b: b }, s);
      } else if (tk.type === 'infix' && (tk.name === 'pow' || tk.name === 'xroot')) {
        this.next();
        var g = this.parseGroupBody(tk);
        a = this.node(tk.name === 'pow' ? { t: 'pow', a: a, b: g } : { t: 'root', n: a, x: g }, s);
      } else if (tk.type === 'dms') {
        this.next();
        // a° [m° [s°]]
        var parts = [a];
        while (parts.length < 3) {
          var n1 = this.peek(), n2 = this.peek(1);
          if (n1 && n1.type === 'num' && n2 && n2.type === 'dms') {
            var pm = this.parsePrimary(); this.next(); parts.push(pm);
          } else break;
        }
        a = this.node({ t: 'dms', parts: parts }, s);
      } else break;
    }
    return a;
  };
  // 여는 괄호가 이미 소비된 상태에서 식 + 닫는 괄호(생략 가능)
  P.parseGroupBody = function (openTk) {
    var tk = this.peek();
    if (!tk || (tk.type === 'paren' && tk.value === ')')) throw tk ? this.err(tk) : synErr(this.pos(null));
    var e = this.parseExpr();
    tk = this.peek();
    if (tk) {
      if (tk.type === 'paren' && tk.value === ')') this.next();
      else throw this.err(tk);
    }
    return e;
  };
  P.parseSlot = function (tplTk, k) {
    var slots = tplTk.slots || [];
    var toks = slots[k];
    var pos = this.mapPos(tplTk._s);
    if (!toks || !toks.length) throw synErr(pos);
    var sub = new Parser(toks, function () { return pos; }, this.opts);
    var e = sub.parseExpr();
    if (!sub.atEnd()) throw synErr(pos);
    return e;
  };
  P.parseNumber = function () {
    var tk = this.peek();
    var s = this.mapPos(tk._s);
    var mant, tag;
    if (tk.type === 'num') {
      this.next();
      var str = tk.value;
      if ((str.match(/\./g) || []).length > 1 || !/^[0-9.]+$/.test(str)) throw this.err(tk);
      if (str === '.') str = '0';
      if (str.indexOf('.') >= 0) tag = 'dec';
      if (str[str.length - 1] === '.') str = str.slice(0, -1);
      if (str[0] === '.') str = '0' + str;
      mant = C.qFromString(str);
    } else {
      mant = C.Q1; // ×10^x 앞에 가수가 없으면 1
    }
    var nt = this.peek();
    if (nt && nt.type === 'exp10') {
      this.next();
      var sg = 1, t2 = this.peek();
      if (t2 && (t2.type === 'neg' || this.isOp(t2, '-'))) { sg = -1; this.next(); }
      else if (t2 && this.isOp(t2, '+')) { this.next(); }
      var en = this.peek();
      if (!en || en.type !== 'num' || !/^[0-9]+$/.test(en.value)) throw en ? this.err(en) : synErr(this.pos(null));
      this.next();
      var ex = parseInt(en.value, 10) * sg;
      if (ex > 0) mant = C.qmul(mant, C.Q(C.pow10(ex)));
      else if (ex < 0) mant = C.qdiv(mant, C.Q(C.pow10(-ex)));
    }
    return this.node({ t: 'num', v: C.vq(mant, tag) }, s);
  };
  P.parsePrimary = function () {
    var tk = this.peek();
    if (!tk) throw synErr(this.pos(null));
    var s = this.mapPos(tk._s);
    switch (tk.type) {
      case 'num': case 'exp10':
        return this.parseNumber();
      case 'paren':
        if (tk.value !== '(') throw this.err(tk);
        this.next();
        var g = this.parseGroupBody(tk);
        return this.node({ t: 'paren', a: g }, s);
      case 'fn': {
        var spec = FN_ARGS[tk.name];
        if (!spec || (CMPLX_FN[tk.name] && !this.cmplx()) || (STAT_FN[tk.name] && !this.stat())) throw this.err(tk);
        this.next();
        var args = [];
        var t2 = this.peek();
        if (!t2 || (t2.type === 'paren' && t2.value === ')')) throw t2 ? this.err(t2) : synErr(this.pos(null));
        while (true) {
          var c = this.peek();
          if (!c || c.type === 'comma' || (c.type === 'paren' && c.value === ')')) throw c ? this.err(c) : synErr(this.pos(null));
          args.push(this.parseExpr());
          c = this.peek();
          if (c && c.type === 'comma') { this.next(); continue; }
          if (c && c.type === 'paren' && c.value === ')') { this.next(); break; }
          if (!c) break;
          throw this.err(c);
        }
        if (args.length < spec[0] || args.length > spec[1]) throw synErr(this.lastPos());
        return this.node({ t: 'call', name: tk.name, args: args }, s);
      }
      case 'tpl': {
        var n = TPL_SLOTS[tk.name];
        if (!n || tk.name === 'pow') throw this.err(tk);
        this.next();
        var sl = [];
        for (var k = 0; k < n; k++) sl.push(this.parseSlot(tk, k));
        var nd;
        switch (tk.name) {
          case 'frac': nd = { t: 'frac', a: sl[0], b: sl[1] }; break;
          case 'mixed': nd = { t: 'mixed', i: sl[0], a: sl[1], b: sl[2] }; break;
          case 'root': nd = { t: 'root', n: sl[0], x: sl[1] }; break;
          case 'logb': nd = { t: 'call', name: 'log', args: [sl[0], sl[1]] }; break;
          default: nd = { t: 'call', name: tk.name, args: sl };
        }
        nd.tpl = true;
        return this.node(nd, s);
      }
      case 'const':
        this.next();
        if (tk.name === 'pi' || tk.name === 'e') return this.node({ t: 'const', name: tk.name }, s);
        if (tk.name === 'sc' && tk.index >= 1 && tk.index <= 40) return this.node({ t: 'const', name: 'sc', index: tk.index | 0 }, s);
        throw this.err(tk);
      case 'var':
        if (!VARS[tk.name]) throw this.err(tk);
        this.next();
        return this.node({ t: 'var', name: tk.name }, s);
      case 'ans': this.next(); return this.node({ t: 'ans' }, s);
      case 'stat':
        if (!this.stat() || !tk.name) throw this.err(tk);
        this.next(); return this.node({ t: 'stat', name: tk.name }, s);
      case 'imag':
        if (!this.cmplx()) throw this.err(tk);
        this.next(); return this.node({ t: 'imag' }, s);
      case 'ran': this.next(); return this.node({ t: 'ran' }, s);
      default:
        throw this.err(tk);
    }
  };

  // 문장 하나: expr [= expr] [▶r∠θ|▶a+bi] [, var]
  P.parseStatement = function () {
    if (this.atEnd()) throw synErr(this.pos(null));
    var st = { expr: this.parseExpr(), rhs: null, solveVar: null, cmd: null };
    var tk = this.peek();
    if (tk && tk.type === 'eq') {
      this.next();
      st.rhs = this.parseExpr();
      tk = this.peek();
    }
    if (tk && tk.type === 'cmd') {
      if (!this.cmplx() || !CMDS[tk.name]) throw this.err(tk);
      this.next();
      st.cmd = tk.name;
      tk = this.peek();
    }
    if (tk && tk.type === 'comma' && this.opts.allowSolveVar) {
      this.next();
      var v = this.next();
      if (!v || v.type !== 'var') throw v ? this.err(v) : synErr(this.pos(null));
      st.solveVar = v.name;
      tk = this.peek();
    }
    if (tk) throw this.err(tk);
    return st;
  };

  // 최상위: ':' 로 나눈 문장 목록
  function parseProgram(tokens, opts) {
    if (!Array.isArray(tokens)) throw synErr(0);
    var stmts = [], start = 0;
    for (var i = 0; i <= tokens.length; i++) {
      if (i === tokens.length || (tokens[i] && tokens[i].type === 'colon')) {
        var seg = tokens.slice(start, i);
        var off = start;
        var p = new Parser(seg, (function (o) { return function (j) { return j + o; }; })(off), opts);
        if (!seg.length) throw synErr(i < tokens.length ? i : Math.max(0, i - 1));
        var st = p.parseStatement();
        st.range = [start, i - 1];
        stmts.push(st);
        start = i + 1;
      }
    }
    return stmts;
  }

  // 식에 쓰인 변수(등장 순서)
  function collectVars(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (node.t === 'var' && out.indexOf(node.name) < 0) out.push(node.name);
    var keys = ['a', 'b', 'l', 'r', 'i', 'n', 'x'];
    // 왼쪽→오른쪽 순서 유지
    if (node.t === 'bin') { collectVars(node.l, out); collectVars(node.r, out); return out; }
    if (node.t === 'root') { collectVars(node.n, out); collectVars(node.x, out); return out; }
    if (node.t === 'mixed') { collectVars(node.i, out); collectVars(node.a, out); collectVars(node.b, out); return out; }
    if (node.args) node.args.forEach(function (a) { collectVars(a, out); });
    if (node.parts) node.parts.forEach(function (a) { collectVars(a, out); });
    keys.forEach(function (k) { if (node[k] && typeof node[k] === 'object' && node[k].t) collectVars(node[k], out); });
    return out;
  }

  CE._parser = { Parser: Parser, parseProgram: parseProgram, collectVars: collectVars, FN_ARGS: FN_ARGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
