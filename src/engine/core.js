/*
 * CalcEngine core: BigInt 유리수(Q)와 정확값(Value).
 * DOM을 참조하지 않는 순수 JS. 브라우저(file://)에서는 전역 CalcEngine, Node에서는 module.exports.
 *
 * Value 형태
 *   {k:'x', t:[[Q, r], ...], tag}   정확값: Σ c·√r  (r: 제곱인수 없는 BigInt, r=1은 유리수 항), r 오름차순
 *   {k:'p', c:Q, tag}                정확값: c·π
 *   {k:'a', q:Q, tag}                근사값: 유효숫자 15자리로 반올림된 10진 유리수 (기기 내부 15자리 모사)
 *   {k:'c', re:Value, im:Value}      복소수(CMPLX 모드). re/im 은 위의 실수 Value. im 이 0 이면 만들지 않고 re 를 쓴다(mkC)
 *   tag: undefined | 'frac' (분수 입력에서 나온 값) | 'dec' (소수점 입력이 섞인 값) | 'dms' (60진수)
 * 실수 전용 연산(sign, numQ, toDouble …)에 복소수가 들어오면 Math ERROR.
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};

  function CalcError(kind, pos) {
    var e = new Error(kind);
    e.calcError = kind; // 'Math ERROR' | 'Syntax ERROR' | 'Stack ERROR' | 'Argument ERROR' | 'Time Out' ...
    e.pos = (pos === undefined ? null : pos);
    return e;
  }

  var ZERO = 0n, ONE = 1n, TEN = 10n;

  function babs(a) { return a < 0n ? -a : a; }
  function gcd(a, b) {
    a = babs(a); b = babs(b);
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  function pow10(n) { return TEN ** BigInt(n); }
  function digits(a) { a = babs(a); return a === 0n ? 1 : a.toString().length; }

  // ---------- Q ----------
  function Q(n, d) {
    if (d === undefined) d = ONE;
    if (typeof n === 'number') n = BigInt(n);
    if (typeof d === 'number') d = BigInt(d);
    if (d === 0n) throw CalcError('Math ERROR');
    if (d < 0n) { n = -n; d = -d; }
    var g = gcd(n, d);
    if (g > 1n) { n /= g; d /= g; }
    return { n: n, d: d };
  }
  var Q0 = { n: 0n, d: 1n }, Q1 = { n: 1n, d: 1n };
  function qadd(a, b) { return a.d === b.d ? Q(a.n + b.n, a.d) : Q(a.n * b.d + b.n * a.d, a.d * b.d); }
  function qsub(a, b) { return qadd(a, qneg(b)); }
  function qmul(a, b) { return Q(a.n * b.n, a.d * b.d); }
  function qdiv(a, b) { if (b.n === 0n) throw CalcError('Math ERROR'); return Q(a.n * b.d, a.d * b.n); }
  function qneg(a) { return { n: -a.n, d: a.d }; }
  function qabs(a) { return { n: babs(a.n), d: a.d }; }
  function qsign(a) { return a.n > 0n ? 1 : (a.n < 0n ? -1 : 0); }
  function qcmp(a, b) { var x = a.n * b.d - b.n * a.d; return x > 0n ? 1 : (x < 0n ? -1 : 0); }
  function qIsInt(a) { return a.d === 1n; }
  function qIsZero(a) { return a.n === 0n; }
  function qPowInt(a, k) {
    if (k === 0) return Q1;
    if (k < 0) { if (a.n === 0n) throw CalcError('Math ERROR'); return Q(a.d ** BigInt(-k), a.n ** BigInt(-k)); }
    return Q(a.n ** BigInt(k), a.d ** BigInt(k));
  }
  // floor(log10(|a|)), a != 0
  function qlog10floor(a) {
    var n = babs(a.n), d = a.d;
    var e = digits(n) - digits(d);
    // compare n/d with 10^e
    var lhs, rhs;
    if (e >= 0) { lhs = n; rhs = d * pow10(e); } else { lhs = n * pow10(-e); rhs = d; }
    if (lhs < rhs) e -= 1;
    return e;
  }
  // round half away from zero of a rational to an integer
  function qroundInt(a) {
    var n = babs(a.n), d = a.d;
    var q = (2n * n + d) / (2n * d);
    return a.n < 0n ? -q : q;
  }
  function qfloor(a) {
    var q = a.n / a.d;
    if (a.n < 0n && q * a.d !== a.n) q -= 1n;
    return q;
  }
  // 유효숫자 sig 자리로 반올림(사사오입)
  function qroundSig(a, sig) {
    if (a.n === 0n) return Q0;
    var e = qlog10floor(a);
    var scale = sig - 1 - e;
    var m;
    if (scale >= 0) { m = qroundInt(qmul(a, Q(pow10(scale)))); return Q(m, pow10(scale)); }
    m = qroundInt(qdiv(a, Q(pow10(-scale))));
    return Q(m * pow10(-scale));
  }
  // 소수점 이하 places 자리로 반올림
  function qroundDec(a, places) {
    if (places >= 0) return Q(qroundInt(qmul(a, Q(pow10(places)))), pow10(places));
    return Q(qroundInt(qdiv(a, Q(pow10(-places)))) * pow10(-places));
  }
  // "12.5", "1.2e-3", "-0.5" → Q
  function qFromString(s) {
    s = String(s).trim();
    var m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
    var intp = m[2] || '0', frac = m[3] || '';
    var n = BigInt(intp + frac), d = pow10(frac.length);
    var ex = m[4] ? parseInt(m[4], 10) : 0;
    if (ex > 0) n *= pow10(ex); else if (ex < 0) d *= pow10(-ex);
    if (m[1] === '-') n = -n;
    return Q(n, d);
  }
  function qToDouble(a) {
    if (a.n === 0n) return 0;
    var n = babs(a.n), d = a.d;
    var dn = digits(n), dd = digits(d);
    // 각 수의 상위 18자리만 사용
    var sn = 0, sd = 0;
    if (dn > 18) { sn = dn - 18; n = n / pow10(sn); }
    if (dd > 18) { sd = dd - 18; d = d / pow10(sd); }
    var v = Number(n) / Number(d) * Math.pow(10, sn - sd);
    if (!isFinite(v) || v === 0) {
      // 극단값: 문자열 경유
      v = Number(n) / Number(d);
      v = v * Math.pow(10, (sn - sd) / 2) * Math.pow(10, (sn - sd) / 2);
    }
    return a.n < 0n ? -v : v;
  }
  function qFromDouble(x, sig) {
    if (!isFinite(x)) throw CalcError('Math ERROR');
    if (x === 0) return Q0;
    return qFromString(x.toPrecision(sig || 15));
  }
  function isqrt(n) {
    if (n < 0n) throw CalcError('Math ERROR');
    if (n < 2n) return n;
    // 위에서 내려오는 뉴턴법: 시작값은 반드시 √n 이상이어야 한다
    var x = 1n << BigInt((n.toString(2).length >> 1) + 1);
    while (true) {
      var y = (x + n / x) >> 1n;
      if (y >= x) return x;
      x = y;
    }
  }
  function icbrt(n) { // n >= 0
    if (n < 2n) return n;
    var x = 1n << BigInt(Math.floor(n.toString(2).length / 3) + 1); // ≥ ∛n
    for (var i = 0; i < 2000; i++) {
      var y = (2n * x + n / (x * x)) / 3n;
      if (y >= x) break;
      x = y;
    }
    while (x * x * x > n) x -= 1n;
    while ((x + 1n) * (x + 1n) * (x + 1n) <= n) x += 1n;
    return x;
  }

  // 정수 n>0 를 s²·m (m 제곱인수 없음) 으로. 큰 인수는 시험 나눗셈 한계까지만 → 실패 시 null
  var SMALL_PRIMES = (function () {
    var ps = [], lim = 20000, sieve = new Uint8Array(lim + 1);
    for (var i = 2; i <= lim; i++) { if (!sieve[i]) { ps.push(BigInt(i)); for (var j = i * i; j <= lim; j += i) sieve[j] = 1; } }
    return ps;
  })();
  function squareFree(n) {
    var s = 1n, m = 1n;
    if (n === 0n) return { s: 0n, m: 1n };
    for (var i = 0; i < SMALL_PRIMES.length; i++) {
      var p = SMALL_PRIMES[i];
      if (p * p > n) break;
      if (n % p === 0n) {
        var c = 0;
        while (n % p === 0n) { n /= p; c++; }
        if (c >= 2) s *= p ** BigInt(c >> 1);
        if (c & 1) m *= p;
      }
    }
    if (n > 1n) {
      var r = isqrt(n);
      if (r * r === n) s *= r;
      else {
        // 남은 인수 n: 20000보다 큰 소수의 곱. n < 20000^3 이면 제곱인수가 있다면 n 자체가 p² 또는 p²q 인데
        // p > 20000, q > 20000 이므로 p²q > 8e12. 그 이상은 판정 불가 → null
        if (n > 8000000000000n) return null;
        m *= n;
      }
    }
    return { s: s, m: m };
  }

  // ---------- π, e ----------
  var PI_STR = '3.14159265358979323846264338327950288419716939937510582097494459';
  var PI_Q = qFromString(PI_STR);
  var E_Q = qFromString('2.71828182845904'); // 설명서: e = 2.71828182845904 (내부 15자리)

  // ---------- Value ----------
  var RAD_LIMIT = 1000000000000n; // 정확 √ 유지 한계 (근호 안 값)
  function vq(q, tag) { return { k: 'x', t: q.n === 0n ? [] : [[q, 1n]], tag: tag }; }
  function vint(n, tag) { return vq(Q(BigInt(n)), tag); }
  function vpi(c, tag) { return c.n === 0n ? vq(Q0, tag) : { k: 'p', c: c, tag: tag }; }
  function vapprox(q, tag) { return { k: 'a', q: q, tag: tag }; }
  var V0 = vq(Q0), V1 = vq(Q1);

  function isRational(v) { return v.k === 'x' && (v.t.length === 0 || (v.t.length === 1 && v.t[0][1] === 1n)); }
  function getQ(v) { return v.t.length === 0 ? Q0 : v.t[0][0]; }
  function isZero(v) {
    if (v.k === 'c') return isZero(v.re) && isZero(v.im);
    if (v.k === 'x') return v.t.length === 0;
    if (v.k === 'p') return v.c.n === 0n;
    return v.q.n === 0n;
  }
  function isExact(v) { return v.k !== 'a'; }

  // 고정밀 근사 유리수 (D: 소수점 아래 자리수 정도)
  function numQ(v, D) {
    D = D || 40;
    if (v.k === 'c') throw CalcError('Math ERROR');
    if (v.k === 'a') return v.q;
    if (v.k === 'p') return qmul(v.c, PI_Q);
    var s = Q0;
    for (var i = 0; i < v.t.length; i++) {
      var c = v.t[i][0], r = v.t[i][1];
      if (r === 1n) s = qadd(s, c);
      else {
        // c·√r = sign(c)·√(c²r)
        var cc = qmul(qmul(c, c), Q(r));
        var sc = pow10(D);
        var rt = Q(isqrt(cc.n * cc.d * sc * sc), cc.d * sc);
        s = qadd(s, c.n < 0n ? qneg(rt) : rt);
      }
    }
    return s;
  }
  function sign(v) {
    if (v.k === 'c') throw CalcError('Math ERROR');
    if (v.k === 'a') return qsign(v.q);
    if (v.k === 'p') return qsign(v.c);
    if (v.t.length === 0) return 0;
    if (v.t.length === 1) return qsign(v.t[0][0]);
    return qsign(numQ(v, 60));
  }
  function toApproxQ(v) { return v.k === 'a' ? v.q : qroundSig(numQ(v, 40), 15); }
  function toApprox(v) { return vapprox(toApproxQ(v), v.tag); }
  function toDouble(v) { return qToDouble(v.k === 'a' ? v.q : numQ(v, 30)); }

  var LIM_HI = Q(pow10(100));          // |x| >= 1e100 → Math ERROR
  var LIM_LO = Q(1n, pow10(99));       // |x| < 1e-99 → 0
  // 범위 검사. 넘으면 Math ERROR, 아주 작으면 0
  function checkRange(v) {
    if (v.k === 'c') return mkC(checkRange(v.re), checkRange(v.im));
    if (isZero(v)) return v;
    var q = v.k === 'a' ? v.q : (isRational(v) ? getQ(v) : numQ(v, 20));
    var aq = qabs(q);
    if (qcmp(aq, LIM_HI) >= 0) throw CalcError('Math ERROR');
    if (qcmp(aq, LIM_LO) < 0) return vq(Q0, v.tag);
    return v;
  }

  function normTerms(map) {
    var keys = Object.keys(map), t = [];
    for (var i = 0; i < keys.length; i++) {
      var c = map[keys[i]];
      if (c.n !== 0n) t.push([c, BigInt(keys[i])]);
    }
    t.sort(function (a, b) { return a[1] < b[1] ? -1 : (a[1] > b[1] ? 1 : 0); });
    return t;
  }
  function addTermsInto(map, c, r) {
    var key = r.toString();
    map[key] = map[key] ? qadd(map[key], c) : c;
  }
  function vx(t, tag) { return { k: 'x', t: t, tag: tag }; }

  // 근사 덧셈: 15자리 반올림 + 상쇄 잡음 제거 (|결과| ≤ 1e-13·max(|a|,|b|) 이면 0)
  function approxAdd(qa, qb) {
    var r = qadd(qa, qb);
    if (r.n !== 0n) {
      var m = qcmp(qabs(qa), qabs(qb)) >= 0 ? qabs(qa) : qabs(qb);
      if (qcmp(qmul(qabs(r), Q(pow10(13))), m) <= 0) return Q0;
    }
    return qroundSig(r, 15);
  }

  // ---------- 복소수 ----------
  function stripTag(v) { return v.tag ? withTag(v, undefined) : v; }
  function mkC(re, im) {
    if (re.k === 'c' || im.k === 'c') throw CalcError('Math ERROR');
    if (isZero(im)) return stripTag(re);
    return { k: 'c', re: stripTag(re), im: stripTag(im) };
  }
  function isC(v) { return !!v && v.k === 'c'; }
  function reOf(v) { return v.k === 'c' ? v.re : v; }
  function imOf(v) { return v.k === 'c' ? v.im : V0; }
  function conj(v) { return v.k === 'c' ? mkC(v.re, neg(v.im)) : v; }
  // |z| (실수면 |x|)
  function cabs(v) {
    if (v.k !== 'c') return abs(v);
    return sqrtV(add(mul(v.re, v.re), mul(v.im, v.im)));
  }
  function cmul(a, b) {
    var ar = reOf(a), ai = imOf(a), br = reOf(b), bi = imOf(b);
    return mkC(sub(mul(ar, br), mul(ai, bi)), add(mul(ar, bi), mul(ai, br)));
  }
  function cdiv(a, b) {
    if (isZero(b)) throw CalcError('Math ERROR');
    if (b.k !== 'c') return mkC(div(reOf(a), b), div(imOf(a), b));
    var den = add(mul(b.re, b.re), mul(b.im, b.im));
    var n = cmul(a, conj(b));
    return mkC(div(reOf(n), den), div(imOf(n), den));
  }

  function add(a, b) {
    if (isZero(a)) return b;
    if (isZero(b)) return a;
    if (a.k === 'c' || b.k === 'c') return mkC(add(reOf(a), reOf(b)), add(imOf(a), imOf(b)));
    if (a.k === 'x' && b.k === 'x') {
      var map = {};
      a.t.forEach(function (p) { addTermsInto(map, p[0], p[1]); });
      b.t.forEach(function (p) { addTermsInto(map, p[0], p[1]); });
      return checkRange(vx(normTerms(map)));
    }
    if (a.k === 'p' && b.k === 'p') return checkRange(vpi(qadd(a.c, b.c)));
    return checkRange(vapprox(approxAdd(toApproxQ(a), toApproxQ(b))));
  }
  function neg(a) {
    if (a.k === 'c') return { k: 'c', re: neg(a.re), im: neg(a.im), tag: a.tag };
    if (a.k === 'x') return vx(a.t.map(function (p) { return [qneg(p[0]), p[1]]; }), a.tag);
    if (a.k === 'p') return vpi(qneg(a.c), a.tag);
    return vapprox(qneg(a.q), a.tag);
  }
  function sub(a, b) { return add(a, neg(b)); }

  function mulTerms(a, b) { // exact × exact, null if too big
    var map = {};
    for (var i = 0; i < a.t.length; i++) for (var j = 0; j < b.t.length; j++) {
      var c = qmul(a.t[i][0], b.t[j][0]);
      var r1 = a.t[i][1], r2 = b.t[j][1];
      var g = gcd(r1, r2);
      var r = (r1 / g) * (r2 / g);
      c = qmul(c, Q(g));
      if (r >= RAD_LIMIT) return null;
      addTermsInto(map, c, r);
    }
    return vx(normTerms(map));
  }
  function mul(a, b) {
    if ((a.k !== 'a' && isZero(a)) || (b.k !== 'a' && isZero(b))) return V0;
    if (a.k === 'c' || b.k === 'c') return cmul(a, b);
    if (a.k === 'x' && b.k === 'x') {
      var r = mulTerms(a, b);
      if (r) return checkRange(r);
    } else if (a.k === 'p' && b.k === 'x' && isRational(b)) {
      return checkRange(vpi(qmul(a.c, getQ(b))));
    } else if (b.k === 'p' && a.k === 'x' && isRational(a)) {
      return checkRange(vpi(qmul(b.c, getQ(a))));
    }
    return checkRange(vapprox(qroundSig(qmul(toApproxQ(a), toApproxQ(b)), 15)));
  }
  function inv(b) {
    if (isZero(b)) throw CalcError('Math ERROR');
    if (b.k === 'c') return cdiv(V1, b);
    if (b.k === 'x') {
      if (b.t.length === 1) {
        var c = b.t[0][0], r = b.t[0][1];
        // 1/(c√r) = √r/(c·r)
        return checkRange(vx([[qdiv(Q1, qmul(c, Q(r))), r]]));
      }
      if (b.t.length === 2) {
        // 켤레: (x+y)(x−y) = x² − y² (유리수)
        var x = vx([b.t[0]]), y = vx([b.t[1]]);
        var conj = sub(x, y);
        var den = sub(mul(x, x), mul(y, y));
        if (isRational(den) && !isZero(den) && conj.k === 'x') {
          var dq = getQ(den);
          return checkRange(vx(conj.t.map(function (p) { return [qdiv(p[0], dq), p[1]]; })));
        }
      }
    }
    var q = toApproxQ(b);
    return checkRange(vapprox(qroundSig(qdiv(Q1, q), 15)));
  }
  function div(a, b) {
    if (isZero(b)) throw CalcError('Math ERROR');
    if (a.k === 'x' && isZero(a)) return V0;
    if (a.k === 'c' || b.k === 'c') return cdiv(a, b);
    if (a.k === 'p' && b.k === 'p') return checkRange(vq(qdiv(a.c, b.c)));
    if (a.k === 'p' && b.k === 'x' && isRational(b)) return checkRange(vpi(qdiv(a.c, getQ(b))));
    if (a.k === 'x' && b.k === 'x') {
      if (isRational(b)) {
        var dq = getQ(b);
        return checkRange(vx(a.t.map(function (p) { return [qdiv(p[0], dq), p[1]]; })));
      }
      var ib = inv(b);
      if (ib.k === 'x') return mul(a, ib);
    }
    return checkRange(vapprox(qroundSig(qdiv(toApproxQ(a), toApproxQ(b)), 15)));
  }
  function abs(a) { return sign(a) < 0 ? neg(a) : a; }
  function cmp(a, b) { return sign(sub(a, b)); }

  // 정확 제곱근 (가능하면 a√b 형태)
  function sqrtV(v) {
    var s = sign(v);
    if (s < 0) throw CalcError('Math ERROR');
    if (s === 0) return V0;
    if (isRational(v)) {
      var q = getQ(v);
      var sf = squareFree(q.n * q.d); // √(n/d) = √(n·d)/d
      if (sf && sf.m < RAD_LIMIT) return checkRange(vx([[Q(sf.s, q.d), sf.m]]));
    } else if (v.k === 'x' && v.t.length === 1) {
      // √(c√r) 는 정확 표현 불가
    }
    return fromDouble(Math.sqrt(toDouble(v)));
  }
  function cbrtV(v) {
    var s = sign(v);
    if (s === 0) return V0;
    if (isRational(v)) {
      var q = qabs(getQ(v));
      var a = icbrt(q.n), b = icbrt(q.d);
      if (a * a * a === q.n && b * b * b === q.d) return vq(Q(s < 0 ? -a : a, b));
    }
    var x = Math.cbrt(toDouble(v));
    return fromDouble(x);
  }
  function fromDouble(x, tag) {
    if (!isFinite(x)) throw CalcError('Math ERROR');
    return checkRange(vapprox(qFromDouble(x, 15), tag));
  }
  // 근사값을 원래 Q로 보며 정수인지
  function asQ(v) { // 유리수로 볼 수 있으면 Q, 아니면 null (근사값도 유리수)
    if (v.k === 'a') return v.q;
    if (isRational(v)) return getQ(v);
    return null;
  }
  function isIntegerV(v) { var q = asQ(v); return q !== null && q.d === 1n; }

  function fromInput(x) {
    // UI 가 JS number/문자열을 넘겨도 되게
    if (x === undefined || x === null) return V0;
    if (typeof x === 'object' && x.k) return x;
    if (typeof x === 'number') { if (Number.isInteger(x)) return vint(x); return fromDouble(x); }
    if (typeof x === 'bigint') return vq(Q(x));
    var q = qFromString(x);
    if (!q) throw CalcError('Syntax ERROR');
    return vq(q);
  }
  function withTag(v, tag) {
    var o = {}; for (var k in v) o[k] = v[k];
    o.tag = tag; return o;
  }

  CE._core = {
    CalcError: CalcError, gcd: gcd, pow10: pow10, digits: digits, babs: babs,
    Q: Q, Q0: Q0, Q1: Q1, qadd: qadd, qsub: qsub, qmul: qmul, qdiv: qdiv, qneg: qneg, qabs: qabs,
    qsign: qsign, qcmp: qcmp, qIsInt: qIsInt, qIsZero: qIsZero, qPowInt: qPowInt, qlog10floor: qlog10floor,
    qroundInt: qroundInt, qfloor: qfloor, qroundSig: qroundSig, qroundDec: qroundDec, qFromString: qFromString,
    qToDouble: qToDouble, qFromDouble: qFromDouble, isqrt: isqrt, icbrt: icbrt, squareFree: squareFree,
    PI_Q: PI_Q, E_Q: E_Q,
    vq: vq, vint: vint, vpi: vpi, vapprox: vapprox, vx: vx, V0: V0, V1: V1,
    isRational: isRational, getQ: getQ, isZero: isZero, isExact: isExact, numQ: numQ, sign: sign,
    toApprox: toApprox, toApproxQ: toApproxQ, toDouble: toDouble, checkRange: checkRange,
    add: add, sub: sub, neg: neg, mul: mul, div: div, inv: inv, abs: abs, cmp: cmp,
    sqrtV: sqrtV, cbrtV: cbrtV, fromDouble: fromDouble, asQ: asQ, isIntegerV: isIntegerV,
    fromInput: fromInput, withTag: withTag, approxAdd: approxAdd,
    mkC: mkC, isC: isC, reOf: reOf, imOf: imOf, conj: conj, cabs: cabs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
