/*
 * CalcEngine BASE-N 모드(MODE 4): 정수 평가기 (DEC / HEX / BIN / OCT).
 * 근거: _workspace/01_spec_basen.md (2019판 한글 매뉴얼 53~56쪽, 계산 우선 순위 표).
 * 브라우저: api.js 다음에 <script src="src/engine/basen.js">. Node: index.js 가 불러온다.
 *
 *   evaluateBase(tokens, settings, memory) -> {ok, value, n, dec, base, indicator, text, display, decimal, error, errorPos, view:'basen', ...}
 *   baseConvert(value, base)               -> 같은 형태 (결과 화면에서 진법 키를 눌렀을 때)
 *   baseFormat(n, base)                    -> 고정 자릿수 문자열 (BIN 범위 밖이면 null)
 *   baseZero(base)                         -> 진법 전환 직후 결과줄 문자열 ('0', '00000000', ...)
 *   BASE_LIST = ['DEC','HEX','BIN','OCT'], BASE_INDICATOR = {DEC:'Dec',...}
 *
 * 규칙 ([확인] 매뉴얼, [가정] 매뉴얼에 없음 → _workspace/02_engine_changes.md BASE-N 절)
 *  - 값은 부호 있는 32비트 정수(−2147483648 … 2147483647). BIN 입출력은 16비트(−32768 … 32767). [확인 p.54 표]
 *  - 2·8·16진의 음수는 2의 보수(HEX 8자리, OCT 11자리, BIN 16자리 고정, 앞 0 채움), DEC 는 '-' 부호. [확인]
 *  - 우선순위: 괄호 > Not( Neg( > (−)·n진 기호 > 생략 곱셈 > × ÷ > + − > and > or xor xnor (같은 순위 좌→우). [확인 표]
 *  - ÷ 결과의 소수부는 연산마다 0 방향으로 잘라낸다. [확인: 잘림 / 가정: 0 방향, 연산마다]
 *  - 중간·최종 결과가 32비트 범위를 넘으면 Math ERROR, BIN 표시 범위를 넘으면 Math ERROR. 0 나누기 Math ERROR. [가정]
 *  - 입력 리터럴이 그 진법의 입력 범위를 넘으면 Math ERROR. 그 진법에 없는 숫자는 Syntax ERROR. [가정]
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core;

  var BASES = ['DEC', 'HEX', 'BIN', 'OCT'];
  var RADIX = { DEC: 10, HEX: 16, BIN: 2, OCT: 8 };
  var INDICATOR = { DEC: 'Dec', HEX: 'Hex', BIN: 'Bin', OCT: 'Oct' };
  var WIDTH = { DEC: 0, HEX: 8, BIN: 16, OCT: 11 };
  var PREFIX = { d: 'DEC', h: 'HEX', b: 'BIN', o: 'OCT' };
  var MIN32 = -2147483648n, MAX32 = 2147483647n;
  var MIN16 = -32768n, MAX16 = 32767n;
  // 입력 리터럴의 최댓값(부호 없는 비트열). 이보다 크면 Math ERROR [가정]
  var LIT_MAX = { DEC: MAX32, HEX: 0xFFFFFFFFn, OCT: 0o37777777777n, BIN: 0xFFFFn };
  var LOGIC_OR = { or: 1, xor: 1, xnor: 1 };

  function err(kind, pos) { return C.CalcError(kind, pos == null ? null : pos); }

  function normBase(b) {
    if (b == null) return 'DEC';
    var s = String(b).toUpperCase();
    if (s === 'D' || s === 'DEC') return 'DEC';
    if (s === 'H' || s === 'HEX') return 'HEX';
    if (s === 'B' || s === 'BIN') return 'BIN';
    if (s === 'O' || s === 'OCT') return 'OCT';
    return 'DEC';
  }

  function opName(tk) {
    if (!tk || tk.type !== 'op') return null;
    var v = String(tk.value);
    if (v === '×') return '*';
    if (v === '÷') return '/';
    if (v === '−') return '-';
    var l = v.toLowerCase();
    if (l === 'and' || l === 'or' || l === 'xor' || l === 'xnor') return l;
    return v;
  }

  function fnName(tk) {
    if (!tk || tk.type !== 'fn') return null;
    var l = String(tk.name).toLowerCase();
    return (l === 'not' || l === 'neg') ? l : null;
  }

  function isOpen(tk) { return tk && tk.type === 'paren' && tk.value === '('; }
  function isClose(tk) { return tk && tk.type === 'paren' && tk.value === ')'; }

  // ---------- 파서 (AST) ----------
  function Parser(tokens, base) {
    this.t = tokens; this.i = 0; this.base = base;
  }
  Parser.prototype.peek = function () { return this.t[this.i]; };
  Parser.prototype.atEnd = function () { return this.i >= this.t.length; };
  Parser.prototype.syntax = function (pos) { throw err('Syntax ERROR', pos == null ? Math.min(this.i, this.t.length - 1) : pos); };

  Parser.prototype.parse = function () {
    if (!this.t.length) throw err('Syntax ERROR', 0);
    var n = this.parseOr();
    if (!this.atEnd()) this.syntax(this.i);   // 짝 없는 ')' 또는 남은 토큰
    return n;
  };
  // 13위: or xor xnor
  Parser.prototype.parseOr = function () {
    var a = this.parseAnd();
    for (;;) {
      var o = opName(this.peek());
      if (!o || !LOGIC_OR[o]) return a;
      var p = this.i; this.i++;
      var b = this.parseAnd();
      a = { t: 'bin', op: o, a: a, b: b, p: p, e: b.e };
    }
  };
  // 12위: and
  Parser.prototype.parseAnd = function () {
    var a = this.parseAdd();
    for (;;) {
      if (opName(this.peek()) !== 'and') return a;
      var p = this.i; this.i++;
      var b = this.parseAdd();
      a = { t: 'bin', op: 'and', a: a, b: b, p: p, e: b.e };
    }
  };
  // 11위: + −
  Parser.prototype.parseAdd = function () {
    var a = this.parseMul();
    for (;;) {
      var o = opName(this.peek());
      if (o !== '+' && o !== '-') return a;
      var p = this.i; this.i++;
      var b = this.parseMul();
      a = { t: 'bin', op: o, a: a, b: b, p: p, e: b.e };
    }
  };
  // 10위: × ÷
  Parser.prototype.parseMul = function () {
    var a = this.parseImp();
    for (;;) {
      var o = opName(this.peek());
      if (o !== '*' && o !== '/') return a;
      var p = this.i; this.i++;
      var b = this.parseImp();
      a = { t: 'bin', op: o, a: a, b: b, p: p, e: b.e };
    }
  };
  // 7위: 생략 곱셈. 오른쪽은 '(' / Not( / Neg( / Ans / 변수로 시작하는 원자만 [가정]
  Parser.prototype.parseImp = function () {
    var a = this.parseUnary();
    for (;;) {
      var tk = this.peek();
      if (!(isOpen(tk) || fnName(tk) || (tk && (tk.type === 'ans' || tk.type === 'var')))) return a;
      var p = this.i;
      var b = this.parsePrimary();
      a = { t: 'bin', op: '*', a: a, b: b, p: p, e: b.e };
    }
  };
  // 5위: (−) 와 단항 −
  Parser.prototype.parseUnary = function () {
    var tk = this.peek();
    if (tk && (tk.type === 'neg' || opName(tk) === '-')) {
      var p = this.i; this.i++;
      var a = this.parseUnary();
      return { t: 'neg', a: a, p: p, e: a.e };
    }
    return this.parsePrimary();
  };
  Parser.prototype.parsePrimary = function () {
    var tk = this.peek();
    if (!tk) this.syntax(this.t.length - 1);
    var p = this.i;
    // n진 기호(d h b o) + 숫자
    if (tk.type === 'radix' || tk.type === 'num') {
      var base = this.base;
      if (tk.type === 'radix') {
        base = PREFIX[String(tk.value).toLowerCase()];
        if (!base) this.syntax(p);
        this.i++;
        if (!this.peek() || this.peek().type !== 'num') this.syntax(this.i < this.t.length ? this.i : p);
      }
      var s = '', start = this.i;
      while (this.peek() && this.peek().type === 'num') {
        var v = String(this.peek().value);
        for (var k = 0; k < v.length; k++) {
          var ch = v.charAt(k).toUpperCase();
          var d = parseInt(ch, 16);
          if (isNaN(d) || d >= RADIX[base]) this.syntax(this.i);   // '.' 포함, 그 진법에 없는 숫자
          s += ch;
        }
        this.i++;
      }
      return { t: 'lit', s: s, base: base, p: p, e: this.i - 1, ps: start };
    }
    if (isOpen(tk)) {
      this.i++;
      var inner = this.parseOr();
      if (isClose(this.peek())) this.i++;
      else if (!this.atEnd()) this.syntax(this.i);
      return { t: 'grp', a: inner, p: p, e: this.i - 1 };
    }
    var f = fnName(tk);
    if (f) {
      this.i++;
      var arg = this.parseOr();
      if (isClose(this.peek())) this.i++;
      else if (!this.atEnd()) this.syntax(this.i);
      return { t: 'fn', name: f, a: arg, p: p, e: this.i - 1 };
    }
    if (tk.type === 'ans') { this.i++; return { t: 'ans', p: p, e: p }; }
    if (tk.type === 'var') { this.i++; return { t: 'var', name: tk.name, p: p, e: p }; }
    // 그 밖의 토큰(연산자 연속, 닫는 괄호, COMP 전용 토큰 fn sin·postfix·tpl·const·exp10·'.' 등)
    this.syntax(p);
  };

  // ---------- 평가 ----------
  function check32(n, pos) {
    if (n < MIN32 || n > MAX32) throw err('Math ERROR', pos);
    return n;
  }

  // 엔진 Value / JS 수 / 문자열 / BigInt → 정수 (소수부 0 방향 절단 [가정])
  function toInt(x, pos) {
    if (typeof x === 'bigint') return check32(x, pos);
    var v = C.fromInput(x);
    if (C.isC(v)) throw err('Math ERROR', pos);
    var q = C.numQ(v, 40);
    return check32(q.n / q.d, pos);
  }

  function litValue(node) {
    var n = BigInt(node.base === 'DEC' ? node.s : (node.base === 'HEX' ? '0x' : node.base === 'BIN' ? '0b' : '0o') + node.s);
    if (n > LIT_MAX[node.base]) throw err('Math ERROR', node.e);
    if (node.base === 'BIN') return BigInt.asIntN(16, n);
    if (node.base === 'DEC') return n;
    return BigInt.asIntN(32, n);
  }

  function ev(node, mem) {
    switch (node.t) {
      case 'lit': return litValue(node);
      case 'grp': return ev(node.a, mem);
      case 'ans': return toInt(mem.ans, node.e);
      case 'var': return toInt(mem.vars[node.name] !== undefined ? mem.vars[node.name] : 0, node.e);
      case 'neg':
        // DEC 입력 범위의 최솟값 −2147483648 [확인 p.54 표]: (−)/− 바로 뒤의 10진 리터럴 2147483648 은 허용
        if (node.a.t === 'lit' && node.a.base === 'DEC' && BigInt(node.a.s) === -MIN32) return MIN32;
        return check32(-ev(node.a, mem), node.e);
      case 'fn': {
        var x = ev(node.a, mem);
        if (node.name === 'not') return BigInt.asIntN(32, ~x);   // 1의 보수: Not(x) = −x−1
        return check32(-x, node.e);                               // 2의 보수 [가정: Neg(−2147483648) Math ERROR]
      }
      case 'bin': {
        var a = ev(node.a, mem), b = ev(node.b, mem), r;
        switch (node.op) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/': if (b === 0n) throw err('Math ERROR', node.e); r = a / b; break;   // BigInt 나눗셈 = 0 방향 절단
          case 'and': r = BigInt.asIntN(32, a & b); break;
          case 'or': r = BigInt.asIntN(32, a | b); break;
          case 'xor': r = BigInt.asIntN(32, a ^ b); break;
          case 'xnor': r = BigInt.asIntN(32, ~(a ^ b)); break;
          default: throw err('Syntax ERROR', node.p);
        }
        return check32(r, node.e);
      }
    }
    throw err('Syntax ERROR', node.p);
  }

  // ---------- 표시 ----------
  function baseFormat(n, base) {
    base = normBase(base);
    n = BigInt(n);
    if (n < MIN32 || n > MAX32) return null;
    if (base === 'DEC') return n.toString();
    if (base === 'BIN') {
      if (n < MIN16 || n > MAX16) return null;
      return BigInt.asUintN(16, n).toString(2).padStart(16, '0');
    }
    var u = BigInt.asUintN(32, n);
    return u.toString(RADIX[base]).toUpperCase().padStart(WIDTH[base], '0');
  }

  function baseZero(base) { return baseFormat(0n, base); }

  function failResult(kind, pos, base) {
    return { ok: false, error: kind, errorPos: pos == null ? null : pos, value: null, n: null, dec: null,
      base: base, indicator: INDICATOR[base], display: null, text: kind, decimal: null, view: 'basen',
      alt: null, altText: null, assign: null, multi: null };
  }

  function okResult(n, base) {
    var text = baseFormat(n, base);
    if (text === null) return failResult('Math ERROR', null, base);   // BIN 16비트 밖 [가정]
    return { ok: true, error: null, errorPos: null,
      value: C.fromInput(n), n: Number(n), dec: n.toString(),
      base: base, indicator: INDICATOR[base],
      display: { type: 'text', value: text }, text: text, decimal: text, view: 'basen',
      alt: null, altText: null, assign: null, multi: null };
  }

  function kindOf(e) { return (e && e.calcError) ? e.calcError : 'Math ERROR'; }

  function evaluateBase(tokens, settings, memory) {
    settings = settings || {};
    var base = normBase(settings.base);
    memory = memory || {};
    var mem = { ans: memory.ans !== undefined ? memory.ans : (memory.Ans !== undefined ? memory.Ans : 0), vars: memory.vars || {} };
    var ast;
    try {
      ast = new Parser(tokens || [], base).parse();
    } catch (e) {
      return failResult(kindOf(e), e && e.pos != null ? e.pos : null, base);
    }
    try {
      var n = ev(ast, mem);
      var r = okResult(n, base);
      if (!r.ok) r.errorPos = ast.e;
      return r;
    } catch (e2) {
      return failResult(kindOf(e2), e2 && e2.pos != null ? e2.pos : null, base);
    }
  }

  // 결과 화면에서 진법 키: 값을 그대로 두고 표시만 바꾼다. [확인 p.55]
  function baseConvert(value, base) {
    base = normBase(base);
    try {
      return okResult(toInt(value, null), base);
    } catch (e) {
      return failResult(kindOf(e), null, base);
    }
  }

  CE.evaluateBase = evaluateBase;
  CE.baseConvert = baseConvert;
  CE.baseFormat = baseFormat;
  CE.baseZero = baseZero;
  CE.BASE_LIST = BASES.slice();
  CE.BASE_INDICATOR = INDICATOR;
  CE.BASE_WIDTH = WIDTH;
  CE._basen = { normBase: normBase, toInt: toInt, Parser: Parser };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
