/*
 * CalcEngine evaluator: AST(parser.js) → Value(core.js).
 * 함수 정의역과 오류는 설명서 technical_informatoin/calculation_ranges, errors 를 따른다.
 * DOM 을 참조하지 않는다.
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core;
  var Q = C.Q, Q0 = C.Q0, Q1 = C.Q1;
  var CalcError = C.CalcError;

  function mathErr() { return CalcError('Math ERROR'); }
  function synErr() { return CalcError('Syntax ERROR'); }

  // ---------- 평가 문맥 ----------
  // settings: {angle, format, ...}; memory: {ans, vars}; 플래그는 표시 규칙(분수/소수 혼합)에 쓰인다.
  function Ctx(settings, memory, opts) {
    this.settings = settings || {};
    this.memory = memory || { ans: C.V0, vars: {} };
    this.opts = opts || {};
    this.flags = { frac: false, dec: false, mixed: false };
    this.bound = null;     // ∫, d/dx, Σ 실행 중 X 바인딩
    this.inCalculus = 0;   // ∫ d/dx Σ 중첩 금지
    this.multi = null;     // Pol/Rec 결과
    this.random = (opts && opts.random) || Math.random;
  }

  function angleUnit(ctx) { var a = ctx.settings.angle; return a === 'rad' || a === 'gra' ? a : 'deg'; }
  function isCmplx(ctx) { return ctx.settings.mode === 'CMPLX'; }
  // 실수 전용 연산의 인수 검사: 허수부가 0 이 아니면 Math ERROR [가정: 명세 C-2 권장안]
  function realOnly(v) { if (v && v.k === 'c') throw mathErr(); return v; }

  // ---------- 보조 ----------
  function qOf(v) { return C.toApproxQ(v); }      // 15자리 유리수(정확 유리수면 그대로)
  function exactQ(v) { return C.isRational(v) && v.k === 'x' ? C.getQ(v) : null; }
  function dbl(v) { return C.toDouble(v); }
  function qd(s) { return C.qFromString(s); }
  function fromQ(q, tag) { return C.checkRange(C.vq(q, tag)); }
  function isIntQ(q) { return q && q.d === 1n; }
  function intOf(v) { // 정수이면 BigInt, 아니면 null
    var q = C.asQ(v);
    if (q === null) {
      var x = dbl(v);
      if (Math.abs(x - Math.round(x)) < 1e-12 * Math.max(1, Math.abs(x)) && Math.abs(x) < 1e15) return BigInt(Math.round(x));
      return null;
    }
    return q.d === 1n ? q.n : null;
  }
  function cmpQ(a, b) { return C.qcmp(a, b); }
  function absLess(v, limStr) { return cmpQ(C.qabs(qOf(v)), qd(limStr)) < 0; }
  function absLE(v, limStr) { return cmpQ(C.qabs(qOf(v)), qd(limStr)) <= 0; }

  // 정수 n제곱근 (정확하면 BigInt, 아니면 null)
  function iroot(N, n) {
    if (N < 0n) return null;
    if (N < 2n) return N;
    if (n === 1) return N;
    var digits = N.toString().length;
    if (digits > 300) return null;
    var est = Math.round(Math.pow(Number(N), 1 / n));
    if (!isFinite(est)) return null;
    for (var d = -2; d <= 2; d++) {
      var x = BigInt(Math.max(0, est + d));
      if (x ** BigInt(n) === N) return x;
    }
    return null;
  }

  // ---------- 거듭제곱 ----------
  function powInt(a, k) { // a: Value, k: BigInt
    if (a.k === 'c') return cpowInt(a, k);
    if (k === 0n) { if (C.isZero(a)) throw mathErr(); return C.V1; }
    if (C.isZero(a)) { if (k < 0n) throw mathErr(); return C.V0; }
    var neg = k < 0n, kk = neg ? -k : k;
    // 크기 추정: |k|·log10|a| ≥ 100 → Math ERROR
    var la = Math.log10(Math.abs(dbl(a)));
    var mag = Number(kk) * la * (neg ? -1 : 1);
    if (mag >= 100) throw mathErr();
    if (mag < -100) return C.V0;
    var q = exactQ(a);
    if (q && kk <= 4000n) {
      var dg = C.digits(q.n) + C.digits(q.d);
      if (dg * Number(kk) < 20000) return C.checkRange(C.vq(C.qPowInt(q, Number(k))));
    }
    if (a.k === 'x' && kk <= 64n) {
      var r = C.V1, b = a, e = kk;
      while (e > 0n) {
        if (e & 1n) r = C.mul(r, b);
        e >>= 1n;
        if (e > 0n) b = C.mul(b, b);
      }
      return neg ? C.inv(r) : r;
    }
    if (a.k === 'a' && kk <= 400n) {
      var aq = a.q;
      if ((C.digits(aq.n) + C.digits(aq.d)) * Number(kk) < 20000) {
        var pq = C.qPowInt(aq, Number(k));
        return C.checkRange(C.vapprox(C.qroundSig(pq, 15)));
      }
    }
    var x = dbl(a);
    return C.fromDouble(Math.pow(x, Number(k)));
  }

  // 복소수 정수 거듭제곱 (이진 거듭제곱, 정확값 유지)
  function cpowInt(a, k) {
    if (k === 0n) return C.V1;
    var neg = k < 0n, kk = neg ? -k : k;
    var mod = Math.hypot(dbl(a.re), dbl(a.im));
    var mag = Number(kk) * Math.log10(mod) * (neg ? -1 : 1);
    if (mag >= 100) throw mathErr();
    if (mag < -100) return C.V0;
    var b = a;
    if (kk > 1000n) b = C.mkC(C.toApprox(a.re), C.toApprox(a.im)); // 정확 유리수 자릿수 폭주 방지
    var r = C.V1, e = kk;
    while (e > 0n) {
      if (e & 1n) r = C.mul(r, b);
      e >>= 1n;
      if (e > 0n) b = C.mul(b, b);
    }
    return neg ? C.inv(r) : r;
  }

  // a^b
  function powV(a, b) {
    if (a.k === 'c' || b.k === 'c') {
      // 복소수 밑은 정수 지수만, 복소수 지수는 Math ERROR [가정]
      if (b.k === 'c') throw mathErr();
      var kc = intOf(b);
      if (kc === null) throw mathErr();
      return cpowInt(a, kc);
    }
    var bq = C.asQ(b);
    var bExact = b.k === 'x' && C.isRational(b);
    var sa = C.sign(a);
    if (sa === 0) {
      if (C.sign(b) > 0) return C.V0;
      throw mathErr();
    }
    var k = intOf(b);
    if (k !== null && (bExact || b.k === 'a')) return powInt(a, k);
    if (bq !== null && bExact) {
      // 유리 지수 m/n
      var m = bq.n, n = bq.d;
      if (sa < 0 && n % 2n === 0n) throw mathErr();
      var aq = exactQ(a);
      var absA = C.abs(a);
      var oddNeg = sa < 0 && (m % 2n !== 0n);
      if (aq && n <= 1000n) {
        var A = C.qabs(aq);
        var rn = iroot(A.n, Number(n)), rd = iroot(A.d, Number(n));
        if (rn !== null && rd !== null) {
          var base = C.vq(C.Q(rn, rd));
          var res = powInt(base, m);
          return oddNeg ? C.neg(res) : res;
        }
        if (n === 2n && (m < 0n ? -m : m) <= 64n) {
          // √(A^m)
          var am = powInt(C.vq(A), m < 0n ? -m : m);
          var s = C.sqrtV(am);
          if (m < 0n) s = C.inv(s);
          return oddNeg ? C.neg(s) : s;
        }
      }
      checkPowRange(dbl(absA), Number(m) / Number(n));
      var r = C.fromDouble(Math.pow(dbl(absA), Number(m) / Number(n)));
      return oddNeg ? C.neg(r) : r;
    }
    // 무리수 또는 근사 지수
    if (sa < 0) {
      if (bq !== null) {
        if (bq.d % 2n === 0n) throw mathErr();
        var odd = bq.n % 2n !== 0n;
        var y0 = C.qToDouble(bq);
        checkPowRange(Math.abs(dbl(a)), y0);
        var rr = C.fromDouble(Math.pow(Math.abs(dbl(a)), y0));
        return odd ? C.neg(rr) : rr;
      }
      throw mathErr();
    }
    var x = dbl(a), y = dbl(b);
    checkPowRange(x, y);
    return C.fromDouble(Math.pow(x, y));
  }
  function checkPowRange(x, y) {
    var t = y * Math.log10(Math.abs(x));
    if (t >= 100) throw mathErr();
  }

  // ⁿ√x = x^(1/n)
  function rootV(n, x) {
    if (C.isZero(n)) throw mathErr();
    if (C.isZero(x)) { if (C.sign(n) > 0) return C.V0; throw mathErr(); }
    var e = C.inv(n);
    if (C.sign(x) < 0) {
      var eq = C.asQ(e);
      if (eq === null || eq.d % 2n === 0n) throw mathErr();
    }
    return powV(x, e);
  }

  // ---------- 각도 ----------
  var DEG_PER = { deg: Q1, rad: null, gra: Q(9n, 10n) };
  // 각도 Value → 도 단위 정확 Q (가능하면), 아니면 null
  function toDegQ(v, unit) {
    if (unit === 'rad') {
      if (v.k === 'p') return C.qmul(v.c, Q(180n));
      if (C.isZero(v)) return Q0;
      return null;
    }
    var q = C.asQ(v);
    if (q === null) return null;
    return unit === 'deg' ? q : C.qmul(q, DEG_PER.gra);
  }
  function toRadDouble(v, unit) {
    var x = dbl(v);
    if (unit === 'deg') return x * Math.PI / 180;
    if (unit === 'gra') return x * Math.PI / 200;
    return x;
  }
  function checkTrigRange(v, unit) {
    var lim = unit === 'deg' ? '9e9' : unit === 'rad' ? '157079632.7' : '1e10';
    if (!absLess(v, lim)) throw mathErr();
  }
  var R2 = C.vx([[Q(1n, 2n), 2n]]), R3 = C.vx([[Q(1n, 2n), 3n]]), R3_3 = C.vx([[Q(1n, 3n), 3n]]), SQ3 = C.vx([[Q1, 3n]]);
  var HALF = C.vq(Q(1n, 2n));
  // 0~90 사이 특수각의 sin 정확값
  function sinSpecial(d) { // d: 0..90 정수
    switch (d) {
      case 0: return C.V0; case 30: return HALF; case 45: return R2; case 60: return R3; case 90: return C.V1;
    }
    return null;
  }
  function trigExact(name, degQ) {
    // degQ 를 [0,360) 로
    var r = C.qsub(degQ, C.qmul(Q(C.qfloor(C.qdiv(degQ, Q(360n)))), Q(360n)));
    if (r.d !== 1n) return null;
    var d = Number(r.n);
    if (d % 15 !== 0 || (d % 30 !== 0 && d % 45 !== 0)) return null;
    function sinD(t) {
      t = ((t % 360) + 360) % 360;
      var sg = 1;
      if (t >= 180) { t -= 180; sg = -1; }
      if (t > 90) t = 180 - t;
      var s = sinSpecial(t);
      return sg < 0 ? C.neg(s) : s;
    }
    if (name === 'sin') return sinD(d);
    if (name === 'cos') return sinD(d + 90);
    // tan
    if (d % 180 === 90) throw mathErr();
    var t = d % 180, sg = 1;
    if (t > 90) { t = 180 - t; sg = -1; }
    var v = t === 0 ? C.V0 : t === 30 ? R3_3 : t === 45 ? C.V1 : t === 60 ? SQ3 : null;
    if (v === null) return null;
    return sg < 0 ? C.neg(v) : v;
  }
  function trig(name, v, ctx) {
    var unit = angleUnit(ctx);
    checkTrigRange(v, unit);
    var dq = toDegQ(v, unit);
    if (dq) {
      var ex = trigExact(name, dq);
      if (ex) return ex;
      // 각을 [0,360) 으로 줄여서 계산 (정밀도)
      var red = C.qsub(dq, C.qmul(Q(C.qfloor(C.qdiv(dq, Q(360n)))), Q(360n)));
      var xr = C.qToDouble(red) * Math.PI / 180;
      return trigD(name, xr);
    }
    var x = toRadDouble(v, unit);
    if (unit === 'rad') {
      x = x % (2 * Math.PI);
    } else if (unit === 'deg') {
      x = (dbl(v) % 360) * Math.PI / 180;
    } else {
      x = (dbl(v) % 400) * Math.PI / 200;
    }
    return trigD(name, x);
  }
  function trigD(name, x) {
    var r;
    if (name === 'sin') r = Math.sin(x);
    else if (name === 'cos') r = Math.cos(x);
    else {
      if (Math.abs(Math.cos(x)) < 1e-16) throw mathErr();
      r = Math.tan(x);
    }
    if (Math.abs(r) < 1e-15) r = 0;
    return C.fromDouble(r);
  }
  // 역삼각: 결과 도(deg) → 설정 단위
  function fromDeg(degQ, unit) {
    if (unit === 'deg') return C.vq(degQ);
    if (unit === 'gra') return C.vq(C.qmul(degQ, Q(10n, 9n)));
    return C.vpi(C.qdiv(degQ, Q(180n)));
  }
  function fromRadDouble(r, unit) {
    if (unit === 'deg') r = r * 180 / Math.PI;
    else if (unit === 'gra') r = r * 200 / Math.PI;
    return C.fromDouble(r);
  }
  var ASIN_TABLE = null;
  function invTrigTable() {
    if (ASIN_TABLE) return ASIN_TABLE;
    ASIN_TABLE = {
      asin: [[C.V0, 0], [HALF, 30], [R2, 45], [R3, 60], [C.V1, 90]],
      atan: [[C.V0, 0], [R3_3, 30], [C.V1, 45], [SQ3, 60]]
    };
    return ASIN_TABLE;
  }
  function invTrig(name, v, ctx) {
    var unit = angleUnit(ctx);
    var x = dbl(v);
    if (name !== 'atan' && !absLE(v, '1')) throw mathErr();
    if (C.isExact(v) && v.k === 'x') {
      var tb = invTrigTable()[name === 'atan' ? 'atan' : 'asin'];
      var s = C.sign(v), av = C.abs(v);
      for (var i = 0; i < tb.length; i++) {
        if (C.cmp(av, tb[i][0]) === 0) {
          var d = tb[i][1] * s;               // asin/atan
          if (name === 'acos') d = 90 - d;     // acos x = 90 − asin x
          return fromDeg(Q(BigInt(d)), unit);
        }
      }
    }
    var r = name === 'asin' ? Math.asin(x) : name === 'acos' ? Math.acos(x) : Math.atan(x);
    return fromRadDouble(r, unit);
  }

  // DRG▸ 후위: 값을 지정 단위로 보고 현재 단위로 변환
  function drg(v, from, ctx) {
    var to = angleUnit(ctx);
    if (from === to) return v;
    // 도 단위 정확 변환
    if (from === 'deg') { if (to === 'gra') return C.mul(v, C.vq(Q(10n, 9n))); return C.mul(v, C.vpi(Q(1n, 180n))); }
    if (from === 'gra') { if (to === 'deg') return C.mul(v, C.vq(Q(9n, 10n))); return C.mul(v, C.vpi(Q(1n, 200n))); }
    // from rad
    var k = to === 'deg' ? 180n : 200n;
    if (v.k === 'p') return C.checkRange(C.vq(C.qmul(v.c, Q(k))));
    return C.div(C.mul(v, C.vint(k)), C.vpi(Q1));
  }

  // ---------- 계승, 순열, 조합 ----------
  function fact(v) {
    var n = intOf(v);
    if (n === null || n < 0n || n > 69n || !C.isRational(v) && v.k !== 'a') throw mathErr();
    var r = 1n;
    for (var i = 2n; i <= n; i++) r *= i;
    return C.vq(Q(r));
  }
  var E100 = 10n ** 100n, E10 = 10n ** 10n;
  function permComb(op, a, b) {
    var n = intOf(a), r = intOf(b);
    if (n === null || r === null || C.asQ(a) === null || C.asQ(b) === null) throw mathErr();
    if (n < 0n || r < 0n || r > n || n >= E10) throw mathErr();
    if (op === 'nPr') {
      var p = 1n;
      for (var i = 0n; i < r; i++) { p *= (n - i); if (p >= E100) throw mathErr(); }
      return C.vq(Q(p));
    }
    var k = r < n - r ? r : n - r;
    var c = 1n;
    for (var j = 1n; j <= k; j++) { c = c * (n - k + j) / j; if (c >= E100) throw mathErr(); }
    return C.vq(Q(c));
  }

  // ---------- 쌍곡선, 로그, 지수 ----------
  function hyp(name, v) {
    var x = dbl(v), r;
    switch (name) {
      case 'sinh': if (!absLE(v, '230.2585092')) throw mathErr(); r = Math.sinh(x); break;
      case 'cosh': if (!absLE(v, '230.2585092')) throw mathErr(); r = Math.cosh(x); break;
      case 'tanh': r = Math.tanh(x); break;
      case 'asinh': if (!absLE(v, '4.999999999e99')) throw mathErr(); r = Math.asinh(x); break;
      case 'acosh':
        if (C.cmp(v, C.V1) < 0 || !absLE(v, '4.999999999e99')) throw mathErr();
        r = Math.acosh(x); break;
      case 'atanh': if (!absLE(v, '0.9999999999')) throw mathErr(); r = Math.atanh(x); break;
    }
    if (C.isZero(v)) return C.V0;
    return C.fromDouble(r);
  }
  // log10 정확: x = 10^k 이면 k
  function exactLog(baseQ, xq) {
    // baseQ^k == xq (k 정수) 찾기
    var lb = Math.log(C.qToDouble(baseQ)), lx = Math.log(C.qToDouble(xq));
    if (!isFinite(lb) || !isFinite(lx) || lb === 0) return null;
    var k = Math.round(lx / lb);
    if (Math.abs(k) > 400) return null;
    var p = C.qPowInt(baseQ, k);
    if (C.qcmp(p, xq) === 0) return k;
    return null;
  }
  function log10V(v) {
    if (C.sign(v) <= 0) throw mathErr();
    var q = exactQ(v);
    if (q) { var k = exactLog(Q(10n), q); if (k !== null) return C.vint(k); }
    return C.fromDouble(Math.log10(dbl(v)));
  }
  function logBase(a, b) {
    if (C.sign(a) <= 0 || C.sign(b) <= 0 || C.cmp(a, C.V1) === 0) throw mathErr();
    var aq = exactQ(a), bq = exactQ(b);
    if (aq && bq) { var k = exactLog(aq, bq); if (k !== null) return C.vint(k); }
    var r = Math.log(dbl(b)) / Math.log(dbl(a));
    return C.fromDouble(r);
  }
  function lnV(v) {
    if (C.sign(v) <= 0) throw mathErr();
    if (C.cmp(v, C.V1) === 0) return C.V0;
    return C.fromDouble(Math.log(dbl(v)));
  }
  function expV(v) {
    if (C.isZero(v)) return C.V1;
    if (C.cmp(v, C.vq(qd('230.2585092'))) > 0) throw mathErr();
    var x = dbl(v);
    var r = Math.exp(x);
    if (r === 0 || x < -230.2585093) return C.V0;
    return C.fromDouble(r);
  }
  function pow10V(v) {
    if (C.cmp(v, C.vq(qd('99.99999999'))) > 0) throw mathErr();
    var k = intOf(v);
    if (k !== null && C.asQ(v) !== null) {
      if (k < -99n) return C.V0;
      return C.checkRange(C.vq(C.qPowInt(Q(10n), Number(k))));
    }
    var x = dbl(v);
    if (x < -100) return C.V0;
    return C.fromDouble(Math.pow(10, x));
  }

  // ---------- Rnd ----------
  function rndV(v, ctx) {
    var f = ctx.settings.format || { type: 'norm1' };
    var q = qOf(v);
    var r;
    if (f.type === 'fix') r = C.qroundDec(q, f.digits | 0);
    else if (f.type === 'sci') r = C.qroundSig(q, (f.digits | 0) || 10);
    else r = C.qroundSig(q, 10);
    return C.checkRange(C.vq(r));
  }

  // ---------- 단위 변환 ----------
  function convV(v, index) {
    var cv = CE.conversions && CE.conversions[index];
    if (!cv) throw synErr();
    if (cv.kind === 'F2C') return C.mul(C.sub(v, C.vint(32)), C.vq(Q(5n, 9n)));
    if (cv.kind === 'C2F') return C.add(C.mul(v, C.vq(Q(9n, 5n))), C.vint(32));
    var f = C.vq(qd(cv.factor));
    return cv.kind === 'mul' ? C.mul(v, f) : C.div(v, f);
  }
  function constV(index) {
    var c = CE.constants && CE.constants[index];
    if (!c) throw synErr();
    // μ0 = 4π×10⁻⁷ : 상수는 소수로 표시되므로 15자리 근사값으로 둔다
    if (typeof c.value === 'object' && c.value.pi) return C.toApprox(C.vpi(qd(c.value.pi)));
    return C.vq(qd(c.value));
  }

  // ---------- 적분 / 미분 / Σ ----------
  var GK_X = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
    0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
    0.207784955007898467600689403773245, 0.000000000000000000000000000000000];
  var GK_WK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
    0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
    0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
  var GK_WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975,
    0.417959183673469387755102040816327];
  function gk15(f, a, b) {
    var c = (a + b) / 2, h = (b - a) / 2;
    var fc = f(c), rk = fc * GK_WK[7], rg = fc * GK_WG[3];
    for (var j = 0; j < 7; j++) {
      var dx = h * GK_X[j];
      var f1 = f(c - dx), f2 = f(c + dx);
      rk += GK_WK[j] * (f1 + f2);
      if (j % 2 === 1) rg += GK_WG[(j - 1) / 2] * (f1 + f2);
    }
    return { v: rk * h, err: Math.abs((rk - rg) * h) };
  }
  function integrate(f, a, b, tol) {
    if (a === b) return 0;
    var evals = 0, maxEvals = 15 * 2000;
    var whole = gk15(f, a, b); evals += 15;
    var list = [{ a: a, b: b, v: whole.v, err: whole.err }];
    var total = whole.v, err = whole.err;
    var target = function () { return Math.max(1e-15 * Math.abs(total), Math.min(tol, 1e-13) * 1e-2); };
    while (err > target() && evals < maxEvals) {
      // 오차가 가장 큰 구간 분할
      var wi = 0;
      for (var i = 1; i < list.length; i++) if (list[i].err > list[wi].err) wi = i;
      var it = list[wi], m = (it.a + it.b) / 2;
      if (m === it.a || m === it.b) break;
      var l = gk15(f, it.a, m), r = gk15(f, m, it.b); evals += 30;
      list.splice(wi, 1, { a: it.a, b: m, v: l.v, err: l.err }, { a: m, b: it.b, v: r.v, err: r.err });
      total = 0; err = 0;
      for (var k = 0; k < list.length; k++) { total += list[k].v; err += list[k].err; }
    }
    if (err > Math.max(tol, 1e-14) * Math.max(1, Math.abs(total)) * 10) throw CalcError('Time Out');
    return total;
  }
  // Ridders 외삽 미분. dq(i)는 i번째 간격 h0·(5/7)^i 의 중심차분 몫(유리수 Q).
  // 외삽표도 유리수로 계산하므로 다항식은 h² 항이 정확히 소거된다(x³│0 → 0, x³│1e-5 → 3e-10).
  // 반환: { q: 추정값(Q), err: 오차 추정(double) }
  function derivative(dq) {
    var NTAB = 10, CON2 = Q(49n, 25n), BIG = 1e300, SAFE = 2;
    var a = [], ans = null, err = BIG;
    function dist(x, y) { return Math.abs(C.qToDouble(C.qsub(x, y))); }
    for (var i = 0; i < NTAB; i++) a.push(new Array(NTAB));
    a[0][0] = dq(0);
    ans = a[0][0];
    for (i = 1; i < NTAB; i++) {
      a[0][i] = dq(i);
      var fac = CON2;
      for (var j = 1; j <= i; j++) {
        a[j][i] = C.qdiv(C.qsub(C.qmul(a[j - 1][i], fac), a[j - 1][i - 1]), C.qsub(fac, Q1));
        fac = C.qmul(CON2, fac);
        var errt = Math.max(dist(a[j][i], a[j - 1][i]), dist(a[j][i], a[j - 1][i - 1]));
        if (errt <= err) { err = errt; ans = a[j][i]; }
      }
      if (err === 0 || dist(a[i][i], a[i - 1][i - 1]) >= SAFE * err) break;
    }
    return { q: ans, err: err };
  }

  function withX(ctx, xv, fn) {
    var saved = ctx.bound;
    ctx.bound = { X: xv };
    try { return fn(); } finally { ctx.bound = saved; }
  }
  function realFn(node, ctx) {
    return function (x) {
      var v = withX(ctx, C.fromDouble(x), function () { return ev(node, ctx); });
      return dbl(v);
    };
  }

  function calculus(name, node, ctx) {
    if (ctx.inCalculus) throw synErr();
    var args = node.args;
    ctx.inCalculus++;
    try {
      if (name === 'sum') {
        var a = ev(args[1], ctx), b = ev(args[2], ctx);
        var ia = intOf(a), ib = intOf(b);
        if (ia === null || ib === null || ia > ib || ia <= -E10 || ib >= E10) throw mathErr();
        if (ib - ia > 100000n) throw CalcError('Time Out');
        var s = C.V0;
        for (var k = ia; k <= ib; k++) {
          var kv = C.vq(Q(k));
          s = C.add(s, realOnly(withX(ctx, kv, function () { return ev(args[0], ctx); })));
        }
        return s;
      }
      if (name === 'integ') {
        var lo = dbl(ev(args[1], ctx)), hi = dbl(ev(args[2], ctx));
        var tol = args[3] ? dbl(ev(args[3], ctx)) : 1e-5;
        if (!(tol > 0)) throw mathErr();
        var r = integrate(realFn(args[0], ctx), lo, hi, tol);
        if (!isFinite(r)) throw mathErr();
        return C.fromDouble(r);
      }
      // diff: X = a ± h 를 정확값(유리수 간격)으로 대입하고 차분도 값 연산으로 구한다.
      // 다항식·유리식은 차분이 정확해서 f(a)의 크기와 상관없이 기울기가 보존된다(QA-E1).
      var x0v = ev(args[1], ctx);
      var fx = function (xv) { return withX(ctx, xv, function () { return ev(args[0], ctx); }); };
      var fa = fx(x0v); // f(a) 정의 여부
      if (!isFinite(dbl(fa))) throw mathErr();
      var ax = Math.abs(dbl(x0v));
      var CONQ = Q(5n, 7n);
      var runD = function (h0) {
        return derivative(function (i) {
          var hq = C.qmul(h0, C.qPowInt(CONQ, i));
          var hv = C.vq(hq);
          var df = C.sub(fx(C.add(x0v, hv)), fx(C.sub(x0v, hv)));
          return C.qdiv(C.numQ(df, 30), C.qmul(hq, Q(2n)));
        });
      };
      // 시작 간격: 절대 0.1 과 상대 0.1·|a| 를 모두 시도해 오차 추정이 작은 쪽을 쓴다
      // (sin x│1e5 는 절대 간격, ln x│1e10 은 상대 간격이 맞다. ln x│0.05 는 상대 간격만 정의역 안).
      var hs = [Q(1n, 10n)];
      if (ax > 0 && ax !== 1) hs.push(C.qmul(Q(1n, 10n), C.qFromDouble(ax, 3)));
      var d = null, firstErr = null;
      hs.forEach(function (h0) {
        try {
          var dd = runD(h0);
          if (!d || dd.err < d.err) d = dd;
        } catch (e) {
          if (!(e && e.calcError)) throw e;
          if (!firstErr) firstErr = e;
        }
      });
      if (!d) throw firstErr;
      var dv = C.qToDouble(d.q);
      if (!isFinite(dv)) throw mathErr();
      // 크기가 오차 추정값 수준이면 반올림 잡음으로 보고 0 (sin′(π/2) 등). 고정 임계값은 쓰지 않는다(QA-E1).
      if (C.qIsZero(d.q) || Math.abs(dv) <= 4 * d.err) return C.V0;
      return C.checkRange(C.vapprox(C.qroundSig(d.q, 15)));
    } finally { ctx.inCalculus--; }
  }

  // ---------- Pol / Rec ----------
  function polV(x, y, ctx) {
    var unit = angleUnit(ctx);
    if (!absLE(x, '9.999999999e99') || !absLE(y, '9.999999999e99')) throw mathErr();
    var r = C.sqrtV(C.add(C.mul(x, x), C.mul(y, y)));
    var th;
    if (C.isZero(x) && C.isZero(y)) th = C.V0;
    else {
      var sx = C.sign(x), sy = C.sign(y);
      if (sy === 0) th = sx > 0 ? C.V0 : fromDeg(Q(180n), unit);
      else if (sx === 0) th = fromDeg(Q(sy > 0 ? 90n : -90n), unit);
      else if (C.cmp(C.abs(x), C.abs(y)) === 0) th = fromDeg(Q(BigInt((sx > 0 ? 45 : 135) * sy)), unit);
      else th = fromRadDouble(Math.atan2(dbl(y), dbl(x)), unit);
    }
    ctx.multi = [{ label: 'r', value: r }, { label: 'θ', value: th }];
    return r;
  }
  function recV(r, th, ctx) {
    if (C.sign(r) < 0 || !absLE(r, '9.999999999e99')) throw mathErr();
    var x = C.mul(r, trig('cos', th, ctx));
    var y = C.mul(r, trig('sin', th, ctx));
    ctx.multi = [{ label: 'X', value: x }, { label: 'Y', value: y }];
    return x;
  }

  // ---------- 복소수: 편각, 극형식 ----------
  // 편각 θ (−180° < θ ≦ 180°, 현재 각도 단위). 특수각(0, ±30, ±45, ±60, ±90, … 180)은 정확값
  function argOf(re, im, unit) {
    var sx = C.sign(re), sy = C.sign(im);
    if (sy === 0) return sx < 0 ? fromDeg(Q(180n), unit) : C.V0;
    if (sx === 0) return fromDeg(Q(sy > 0 ? 90n : -90n), unit);
    if (re.k !== 'a' && im.k !== 'a') {
      var t = C.div(C.abs(im), C.abs(re)), base = null;
      if (t.k !== 'a') {
        if (C.cmp(t, C.V1) === 0) base = 45;
        else if (C.cmp(t, SQ3) === 0) base = 60;
        else if (C.cmp(t, R3_3) === 0) base = 30;
      }
      if (base !== null) {
        var d = sx > 0 ? base : 180 - base;
        return fromDeg(Q(BigInt(d * sy)), unit);
      }
    }
    return fromRadDouble(Math.atan2(dbl(im), dbl(re)), unit);
  }
  function argV(z, unit) { return argOf(C.reOf(z), C.imOf(z), unit); }
  // r∠θ → r(cosθ + i sinθ)
  function polarIn(r, th, ctx) {
    realOnly(r); realOnly(th);
    return C.mkC(C.mul(r, trig('cos', th, ctx)), C.mul(r, trig('sin', th, ctx)));
  }
  // 결과 표시용 극형식 {r, th}
  function polarOf(z, settings) {
    var unit = angleUnit({ settings: settings || {} });
    return { r: C.cabs(z), th: argV(z, unit) };
  }
  // COMP 등 실수 모드에서 복소수 메모리 값은 실수부만 쓴다 [가정]
  function memVal(v, ctx) { return v.k === 'c' && !isCmplx(ctx) ? v.re : v; }

  // ---------- 노드 평가 ----------
  function ev(n, ctx) {
    var v = evInner(n, ctx);
    return v;
  }
  function at(pos, fn) {
    try { return fn(); } catch (e) {
      if (e && e.calcError && e.pos == null) e.pos = pos;
      throw e;
    }
  }
  function tagOf(v) { return v && v.tag; }
  function retag(v, tag) { return tag ? C.withTag(v, tag) : (v.tag ? C.withTag(v, undefined) : v); }

  function lookupVar(name, ctx) {
    if (ctx.bound && ctx.bound[name] !== undefined) return ctx.bound[name];
    var vars = (ctx.memory && ctx.memory.vars) || {};
    return C.fromInput(vars[name]);
  }

  function evInner(n, ctx) {
    switch (n.t) {
      case 'num':
        if (n.v.tag === 'dec') ctx.flags.dec = true;
        return C.checkRange(C.withTag(n.v, undefined));
      case 'paren': return ev(n.a, ctx);
      case 'bin': {
        var l = ev(n.l, ctx), r = ev(n.r, ctx);
        return at(n.r.e, function () {
          var v, dms = false;
          switch (n.op) {
            case '+': v = C.add(l, r); dms = tagOf(l) === 'dms' && tagOf(r) === 'dms'; break;
            case '-': v = C.sub(l, r); dms = tagOf(l) === 'dms' && tagOf(r) === 'dms'; break;
            case '*': case 'imul': v = C.mul(l, r); dms = (tagOf(l) === 'dms') !== (tagOf(r) === 'dms'); break;
            case '/': v = C.div(l, r); dms = tagOf(l) === 'dms' && tagOf(r) !== 'dms'; break;
            case 'nPr': case 'nCr': v = permComb(n.op, l, r); break;
            case 'angle': v = polarIn(l, r, ctx); break;
            case '^': v = powV(l, r); break;
            default: throw synErr();
          }
          return retag(v, dms ? 'dms' : undefined);
        });
      }
      case 'neg': {
        var a = ev(n.a, ctx);
        return retag(C.neg(a), tagOf(a));
      }
      case 'post': {
        var x = ev(n.a, ctx);
        return at(n.e, function () {
          if (n.name !== 'sq' && n.name !== 'cube' && n.name !== 'inv') realOnly(x);
          switch (n.name) {
            case 'sq': return powInt(x, 2n);
            case 'cube': return powInt(x, 3n);
            case 'inv': return C.inv(x);
            case 'fact': return fact(x);
            case 'pct': return C.div(x, C.vint(100));
            case 'deg': return drg(x, 'deg', ctx);
            case 'rad': return drg(x, 'rad', ctx);
            case 'grad': return drg(x, 'gra', ctx);
          }
          throw synErr();
        });
      }
      case 'pow': {
        var pa = ev(n.a, ctx), pb = ev(n.b, ctx);
        return at(n.e, function () { return powV(pa, pb); });
      }
      case 'root': {
        var rn = ev(n.n, ctx), rx = ev(n.x, ctx);
        return at(n.e, function () { return rootV(rn, rx); });
      }
      case 'frac': {
        ctx.flags.frac = true;
        var fa = ev(n.a, ctx), fb = ev(n.b, ctx);
        return at(n.e, function () { return C.div(fa, fb); });
      }
      case 'mixed': {
        ctx.flags.frac = true; ctx.flags.mixed = true;
        var mi = ev(n.i, ctx), ma = ev(n.a, ctx), mb = ev(n.b, ctx);
        return at(n.e, function () {
          var f = C.div(ma, mb);
          return C.sign(mi) < 0 ? C.sub(mi, f) : C.add(mi, f);
        });
      }
      case 'dms': {
        var parts = n.parts.map(function (p) { return ev(p, ctx); });
        return at(n.e, function () {
          var v = parts[0];
          var neg = C.sign(v) < 0;
          for (var i = 1; i < parts.length; i++) {
            if (C.sign(parts[i]) < 0) throw mathErr();
            var t = C.div(parts[i], C.vint(i === 1 ? 60 : 3600));
            v = neg ? C.sub(v, t) : C.add(v, t);
          }
          return C.withTag(v, 'dms');
        });
      }
      case 'conv': {
        var cv = ev(n.a, ctx);
        return at(n.e, function () { return convV(realOnly(cv), n.index); });
      }
      case 'const':
        if (n.name === 'pi') return C.vpi(Q1);
        if (n.name === 'e') return C.vapprox(C.E_Q);
        return constV(n.index);
      case 'var': return memVal(lookupVar(n.name, ctx), ctx);
      case 'ans': return memVal(C.fromInput(ctx.memory ? ctx.memory.ans : 0), ctx);
      case 'imag': return C.mkC(C.V0, C.V1);
      case 'ran': {
        var k = Math.floor(ctx.random() * 1000);
        if (k > 999) k = 999;
        return C.vq(Q(BigInt(k), 1000n));
      }
      case 'call': return evCall(n, ctx);
    }
    throw synErr();
  }

  function evCall(n, ctx) {
    var name = n.name;
    // ∫, d/dx 는 COMP 전용: CMPLX 에서는 실행 시 Syntax ERROR [가정: 명세 G-1.9 권장안]
    if ((name === 'integ' || name === 'diff') && isCmplx(ctx)) throw CalcError('Syntax ERROR', n.e);
    if (name === 'integ' || name === 'diff' || name === 'sum') {
      return at(n.e, function () { return calculus(name, n, ctx); });
    }
    if ((name === 'pol' || name === 'rec') && ctx.inCalculus) throw CalcError('Syntax ERROR', n.e);
    var args = n.args.map(function (a) { return ev(a, ctx); });
    return at(n.e, function () {
      var a = args[0];
      if (name !== 'abs' && name !== 'arg' && name !== 'conjg') args.forEach(realOnly);
      switch (name) {
        case 'sin': case 'cos': case 'tan': return trig(name, a, ctx);
        case 'asin': case 'acos': case 'atan': return invTrig(name, a, ctx);
        case 'sinh': case 'cosh': case 'tanh': case 'asinh': case 'acosh': case 'atanh': return hyp(name, a);
        case 'log': return args.length === 2 ? logBase(args[0], args[1]) : log10V(a);
        case 'ln': return lnV(a);
        case 'exp': return expV(a);
        case 'pow10': return pow10V(a);
        case 'sqrt':
          // CMPLX: 음의 실수 → i√|x| [가정: 명세 C-2 최소 구현]
          if (isCmplx(ctx) && C.sign(a) < 0) return C.mkC(C.V0, C.sqrtV(C.neg(a)));
          return C.sqrtV(a);
        case 'cbrt': return C.cbrtV(a);
        case 'abs': return a.k === 'c' ? C.cabs(a) : retag(C.abs(a), tagOf(a));
        case 'arg': return argV(a, angleUnit(ctx));
        case 'conjg': return C.conj(a);
        case 'pol': return polV(args[0], args[1], ctx);
        case 'rec': return recV(args[0], args[1], ctx);
        case 'ranint': {
          var lo = intOf(args[0]), hi = intOf(args[1]);
          if (lo === null || hi === null || lo >= hi || hi - lo >= E10 || lo <= -E10 || hi >= E10) throw mathErr();
          var span = Number(hi - lo + 1n);
          return C.vq(Q(lo + BigInt(Math.floor(ctx.random() * span))));
        }
        case 'rnd': return rndV(a, ctx);
      }
      throw synErr();
    });
  }

  // ---------- 스택 사용량 (Stack ERROR) ----------
  // 수치 스택 10단, 명령 스택 24단 [가정: 설명서에 수치 없음]. 좌→우 평가 중 동시에 대기하는 수/명령 수를 센다.
  var NUM_STACK = 10, CMD_STACK = 24;
  function stackUse(n) {
    if (!n || typeof n !== 'object') return { num: 0, cmd: 0 };
    function mx(a, b) { return { num: Math.max(a.num, b.num), cmd: Math.max(a.cmd, b.cmd) }; }
    function plus(u, dn, dc) { return { num: u.num + dn, cmd: u.cmd + dc }; }
    switch (n.t) {
      case 'num': case 'const': case 'var': case 'ans': case 'ran': return { num: 1, cmd: 0 };
      case 'paren': return plus(stackUse(n.a), 0, 1);
      case 'bin': return mx(stackUse(n.l), plus(stackUse(n.r), 1, 1));
      case 'neg': return plus(stackUse(n.a), 0, 1);
      case 'post': case 'conv': return stackUse(n.a);
      case 'pow': return mx(stackUse(n.a), plus(stackUse(n.b), 1, 2));
      case 'root': return mx(stackUse(n.n), plus(stackUse(n.x), 1, 2));
      case 'frac': return mx(plus(stackUse(n.a), 0, 1), plus(stackUse(n.b), 1, 1));
      case 'mixed': return mx(mx(stackUse(n.i), plus(stackUse(n.a), 1, 1)), plus(stackUse(n.b), 2, 2));
      case 'dms': {
        var u = { num: 0, cmd: 0 };
        n.parts.forEach(function (p, i) { u = mx(u, plus(stackUse(p), i, i)); });
        return u;
      }
      case 'call': {
        var w = { num: 1, cmd: 1 };
        n.args.forEach(function (a, i) { w = mx(w, plus(stackUse(a), i, 1)); });
        return w;
      }
    }
    return { num: 1, cmd: 0 };
  }
  function checkStack(node) {
    var u = stackUse(node);
    if (u.num > NUM_STACK || u.cmd > CMD_STACK) throw CalcError('Stack ERROR', null);
  }

  CE._eval = {
    Ctx: Ctx, ev: ev, checkStack: checkStack, stackUse: stackUse,
    powV: powV, rootV: rootV, trig: trig, invTrig: invTrig, intOf: intOf, iroot: iroot,
    argOf: argOf, polarOf: polarOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
