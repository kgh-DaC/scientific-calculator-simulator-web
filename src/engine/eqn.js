/*
 * CalcEngine EQN 모드(MODE 3): 연립 1차(2원·3원), 2차, 3차 방정식.
 * 근거: _workspace/01_spec_eqn.md Part C, G-1.
 *   solveEqn(type, coeffs, settings, memory, opts) -> {ok, error, type, count, solutions, allText}
 *   evalCoeff(tokens, settings, memory) -> {ok, value, display, text, decimal, error, errorPos}
 * 브라우저: api.js 다음에 <script src="src/engine/eqn.js">.
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core, FM = CE._format, API = CE._api;
  var Q = C.Q, Q0 = C.Q0;
  var add = C.add, sub = C.sub, mul = C.mul, div = C.div, neg = C.neg;
  function I(n) { return C.vint(n); }

  var COUNTS = { lin2: 6, lin3: 12, quad: 3, cubic: 4 };
  var PREC = 50; // 수치해 내부 유효숫자

  function mathErr() { return C.CalcError('Math ERROR'); }
  function strip(v) { return v && v.tag ? C.withTag(v, undefined) : v; }
  function isRat(v) { return v.k === 'x' && C.isRational(v); }

  // ---------- 해 포맷 ----------
  var FLAGS = { frac: true }; // 계수 입력 경로와 무관하게 분수는 분수로(LineIO 는 a⌟b) [가정]

  function toggled(opts) {
    var o = {}; for (var k in opts) if (k !== 'eng' && k !== 'dmsOutput') o[k] = opts[k];
    o.sdToggle = !opts.sdToggle;
    return o;
  }
  function baseOpts(opts) {
    var o = {}; for (var k in opts) if (k !== 'eng' && k !== 'dmsOutput') o[k] = opts[k];
    return o;
  }

  // 실수 해. linear 이면 √·π 형태로 표시하지 않는다(설명서 주의: 연립 해는 √ 형태 아님)
  function realSolution(label, v, settings, opts, linear) {
    v = strip(v);
    var o = baseOpts(opts);
    if (linear) {
      var rv = v;
      if (!isRat(rv) && rv.k === 'a') { var rec = FM.recognize(rv, false); if (rec && isRat(rec)) rv = rec; }
      if (!isRat(rv)) {
        var fd = FM.formatValue(v, settings, FLAGS, o);
        return {
          label: label, value: v, kind: 'real',
          display: fd.decimalNode, text: fd.decimal, decimal: fd.decimal, decimalNode: fd.decimalNode,
          alt: null, altText: null, view: 'decimal',
          re: null, im: null, reText: null, imText: null, lines: null, decimalLines: null, altLines: null
        };
      }
      v = rv;
    }
    var f = FM.formatValue(v, settings, FLAGS, o);
    var ft = FM.formatValue(v, settings, FLAGS, toggled(opts));
    var hasAlt = ft.text !== f.text;
    return {
      label: label, value: f.exact ? f.exact : v, kind: 'real',
      display: f.display, text: f.text, decimal: f.decimal, decimalNode: f.decimalNode,
      alt: hasAlt ? ft.display : null, altText: hasAlt ? ft.text : null, view: f.view,
      re: null, im: null, reText: null, imText: null, lines: null, decimalLines: null, altLines: null
    };
  }

  // 허근: 기존 CMPLX 포맷(a+bi) 재사용. SETUP 의 r∠θ 설정과 무관 [가정]
  function complexSolution(label, re, im, settings, opts) {
    re = strip(re); im = strip(im);
    if (C.isZero(im)) return realSolution(label, re, settings, opts, false);
    var f = FM.formatComplex('rect', re, im, settings, FLAGS, baseOpts(opts));
    return {
      label: label, value: f.exact || C.mkC(re, im), kind: 'complex',
      display: f.display, text: f.text, decimal: f.decimal, decimalNode: f.decimalNode,
      alt: f.alt, altText: f.altText, view: 'cmplx',
      re: f.partA.display, im: f.partB.display, reText: f.partA.text, imText: f.partB.text,
      lines: f.lines, decimalLines: f.decimalLines, altLines: f.altLines
    };
  }

  // ---------- 연립 1차 (Cramer) ----------
  function det2(a, b, c, d) { return sub(mul(a, d), mul(b, c)); }
  function det3(m) {
    return add(sub(mul(m[0][0], det2(m[1][1], m[1][2], m[2][1], m[2][2])),
                   mul(m[0][1], det2(m[1][0], m[1][2], m[2][0], m[2][2]))),
               mul(m[0][2], det2(m[1][0], m[1][1], m[2][0], m[2][1])));
  }
  function solveLin2(k) {
    var a1 = k[0], b1 = k[1], c1 = k[2], a2 = k[3], b2 = k[4], c2 = k[5];
    var d = det2(a1, b1, a2, b2);
    if (C.isZero(d)) throw mathErr(); // 해 없음·무수한 해 모두 Math ERROR [가정]
    return [div(det2(c1, b1, c2, b2), d), div(det2(a1, c1, a2, c2), d)];
  }
  function solveLin3(k) {
    var A = [[k[0], k[1], k[2]], [k[4], k[5], k[6]], [k[8], k[9], k[10]]];
    var B = [k[3], k[7], k[11]];
    var d = det3(A);
    if (C.isZero(d)) throw mathErr();
    var out = [];
    for (var j = 0; j < 3; j++) {
      var M = A.map(function (r, i) { var rr = r.slice(); rr[j] = B[i]; return rr; });
      out.push(div(det3(M), d));
    }
    return out;
  }

  // ---------- 2차 (정확 판별식) ----------
  // 반환: [{re, im}] 서로 다른 근만. 순서 X1=(-b+√D)/2a, X2=(-b-√D)/2a, 허근은 허수부 + 먼저
  function quadRoots(a, b, c) {
    if (C.isZero(a)) throw mathErr();
    var D = sub(mul(b, b), mul(I(4), mul(a, c)));
    var s = C.sign(D);
    var a2 = mul(I(2), a);
    var nb = neg(b);
    if (s === 0) return [{ re: div(nb, a2), im: C.V0 }];
    if (s > 0) {
      var r = C.sqrtV(D);
      return [{ re: div(add(nb, r), a2), im: C.V0 }, { re: div(sub(nb, r), a2), im: C.V0 }];
    }
    var re = div(nb, a2);
    var im = div(C.sqrtV(neg(D)), C.abs(a2));
    return [{ re: re, im: im }, { re: re, im: neg(im) }];
  }

  // ---------- 3차 ----------
  // Q 다항식 (내림차순 계수)
  function polyQ(cs, x) { var s = Q0; for (var i = 0; i < cs.length; i++) s = C.qadd(C.qmul(s, x), cs[i]); return s; }
  function dpolyQ(cs, x) {
    var n = cs.length - 1, s = Q0;
    for (var i = 0; i < n; i++) s = C.qadd(C.qmul(s, x), C.qmul(cs[i], Q(BigInt(n - i))));
    return s;
  }
  function newtonQ(cs, x0) {
    var x = C.qFromDouble(x0, 17);
    var tol = Q(1n, C.pow10(PREC - 8));
    for (var it = 0; it < 200; it++) {
      var p = polyQ(cs, x);
      if (p.n === 0n) return x;
      var dp = dpolyQ(cs, x);
      if (dp.n === 0n) break;
      var nx = C.qroundSig(C.qsub(x, C.qdiv(p, dp)), PREC);
      var dx = C.qabs(C.qsub(nx, x));
      x = nx;
      var scale = C.qcmp(C.qabs(x), C.Q1) > 0 ? C.qabs(x) : C.Q1;
      if (C.qcmp(dx, C.qmul(scale, tol)) <= 0) break;
    }
    return x;
  }
  function sqrtQ(q) { // q >= 0, PREC 자리 근사
    if (q.n <= 0n) return Q0;
    var sc = C.pow10(PREC);
    return Q(C.isqrt(q.n * q.d * sc * sc), q.d * sc);
  }
  // 실근 초기값(double): 세 실근이면 오름차순 3개, 아니면 1개
  function cubicEstimates(cd, threeReal) {
    var p = cd[1] / cd[0], q = cd[2] / cd[0], r = cd[3] / cd[0];
    var P = q - p * p / 3, R = 2 * p * p * p / 27 - p * q / 3 + r, sh = -p / 3;
    if (!isFinite(P) || !isFinite(R)) throw mathErr();
    if (threeReal && P < 0) {
      var m = 2 * Math.sqrt(-P / 3);
      var arg = 3 * R / (P * m); arg = Math.max(-1, Math.min(1, arg));
      var th = Math.acos(arg) / 3;
      var xs = [0, 1, 2].map(function (k) { return m * Math.cos(th - 2 * Math.PI * k / 3) + sh; });
      return xs.sort(function (x, y) { return x - y; });
    }
    var D = R * R / 4 + P * P * P / 27;
    var t;
    if (D >= 0) { var sd = Math.sqrt(D); t = Math.cbrt(-R / 2 + sd) + Math.cbrt(-R / 2 - sd); }
    else t = 2 * Math.sqrt(-P / 3) * Math.cos(Math.acos(Math.max(-1, Math.min(1, 3 * R / (P * 2 * Math.sqrt(-P / 3))))) / 3);
    return [t + sh];
  }
  // x 근처의 유리근 (분모 ≤ 10²⁰ 연분수 수렴분수를 정확 대입으로 확인)
  function rationalNear(cs, x) {
    if (x.n === 0n) return polyQ(cs, Q0).n === 0n ? Q0 : null;
    var neg_ = x.n < 0n, a = C.babs(x.n), b = x.d;
    var h0 = 0n, h1 = 1n, k0 = 1n, k1 = 0n, maxDen = C.pow10(20);
    var tol = C.qmul(C.qabs(x), Q(1n, C.pow10(PREC - 12)));
    for (var it = 0; it < 120 && b !== 0n; it++) {
      var t = a / b;
      var h2 = t * h1 + h0, k2 = t * k1 + k0;
      if (k2 > maxDen) return null;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      var cand = Q(neg_ ? -h1 : h1, k1);
      if (polyQ(cs, cand).n === 0n) return cand;
      if (C.qcmp(C.qabs(C.qsub(cand, x)), tol) <= 0) return null;
      var rr = a - t * b; a = b; b = rr;
    }
    return null;
  }
  function apx(q) { return C.checkRange(C.vapprox(C.qroundSig(q, 15))); }

  function cubicRoots(a, b, c, d) {
    if (C.isZero(a)) throw mathErr();
    var D0 = sub(mul(b, b), mul(I(3), mul(a, c)));
    var disc = sub(add(sub(add(mul(I(18), mul(mul(a, b), mul(c, d))),
                                neg(mul(I(4), mul(mul(mul(b, b), b), d)))),
                            mul(I(4), mul(a, mul(mul(c, c), c)))),
                        mul(mul(b, b), mul(c, c))),
                    mul(I(27), mul(mul(a, a), mul(d, d))));
    // disc = 18abcd − 4b³d − 4ac³ + b²c² − 27a²d²
    var sd = C.sign(disc);
    if (sd === 0) {
      if (C.isZero(D0)) return [{ re: div(neg(b), mul(I(3), a)), im: C.V0 }]; // 삼중근
      var rd = div(sub(mul(I(9), mul(a, d)), mul(b, c)), mul(I(2), D0));
      var rs = div(sub(sub(mul(I(4), mul(a, mul(b, c))), mul(I(9), mul(mul(a, a), d))), mul(mul(b, b), b)), mul(a, D0));
      var two = C.cmp(rd, rs) <= 0 ? [rd, rs] : [rs, rd]; // 중근: 서로 다른 두 근을 오름차순 [가정]
      return two.map(function (v) { return { re: v, im: C.V0 }; });
    }
    var threeReal = sd > 0;
    var cq = [a, b, c, d].map(function (v) { return C.numQ(v, PREC); });
    var cd = cq.map(C.qToDouble);
    var est = cubicEstimates(cd, threeReal);
    // 유리근 우선(계수가 모두 정확 유리수일 때): 가장 작은 유리근 X1, 나머지는 인수분해한 2차
    if (isRat(a) && isRat(b) && isRat(c) && isRat(d)) {
      var ce = [a, b, c, d].map(C.getQ), best = null;
      if (ce[3].n === 0n) best = Q0;
      est.forEach(function (x0) {
        var rq = rationalNear(ce, newtonQ(ce, x0));
        if (rq && (best === null || C.qcmp(rq, best) < 0)) best = rq;
      });
      if (best !== null) {
        var r1 = C.vq(best);
        var B1 = add(b, mul(a, r1)), C1 = add(c, mul(B1, r1));
        return [{ re: r1, im: C.V0 }].concat(quadRoots(a, B1, C1));
      }
    }
    // 수치해: 가장 작은 실근(실근 1개면 그 근)을 고정밀 뉴턴으로 구하고 2차로 축소
    var r = newtonQ(cq, est[0]);
    var A = cq[0], Bq = C.qadd(cq[1], C.qmul(A, r)), Cq = C.qadd(cq[2], C.qmul(Bq, r));
    var Dq = C.qsub(C.qmul(Bq, Bq), C.qmul(Q(4n), C.qmul(A, Cq)));
    var A2 = C.qmul(Q(2n), A), out = [{ re: apx(r), im: C.V0 }];
    if (threeReal) {
      var s = sqrtQ(C.qsign(Dq) > 0 ? Dq : Q0);
      out.push({ re: apx(C.qdiv(C.qadd(C.qneg(Bq), s), A2)), im: C.V0 });
      out.push({ re: apx(C.qdiv(C.qsub(C.qneg(Bq), s), A2)), im: C.V0 });
    } else {
      var re = apx(C.qdiv(C.qneg(Bq), A2));
      var im = apx(C.qdiv(sqrtQ(C.qsign(Dq) < 0 ? C.qneg(Dq) : Q0), C.qabs(A2)));
      out.push({ re: re, im: im }, { re: re, im: neg(im) });
    }
    return out;
  }

  // 같은 값의 근 병합(서로 다른 근만, 첫 위치 유지)
  function dedupe(rs) {
    var out = [];
    rs.forEach(function (r) {
      for (var i = 0; i < out.length; i++) if (C.isZero(sub(out[i].re, r.re)) && C.isZero(sub(out[i].im, r.im))) return;
      out.push(r);
    });
    return out;
  }

  function coeffValue(x) {
    var v = C.fromInput(x && x.value && x.value.k ? x.value : x);
    if (v.k === 'c') throw mathErr(); // 계수는 실수만
    return C.checkRange(strip(v));
  }

  function solveEqn(type, coeffs, settings, memory, opts) {
    settings = API.normSettings(settings);
    opts = opts || {};
    try {
      var n = COUNTS[type];
      if (!n) return { ok: false, error: 'Syntax ERROR', type: type, count: 0, solutions: [], allText: '' };
      if (!coeffs || coeffs.length !== n) throw mathErr();
      var k = []; for (var i = 0; i < n; i++) k.push(coeffValue(coeffs[i]));
      var sols;
      if (type === 'lin2' || type === 'lin3') {
        var xs = type === 'lin2' ? solveLin2(k) : solveLin3(k);
        var labels = ['X', 'Y', 'Z'];
        sols = xs.map(function (v, j) { return realSolution(labels[j], C.checkRange(v), settings, opts, true); });
      } else {
        var rs = dedupe(type === 'quad' ? quadRoots(k[0], k[1], k[2]) : cubicRoots(k[0], k[1], k[2], k[3]));
        sols = rs.map(function (r, j) {
          var label = rs.length === 1 ? 'X' : 'X' + (j + 1);
          return complexSolution(label, C.checkRange(r.re), C.checkRange(r.im), settings, opts);
        });
      }
      return {
        ok: true, error: null, type: type, count: sols.length, solutions: sols,
        allText: sols.map(function (s) { return s.label + '=' + s.text; }).join(', ')
      };
    } catch (e) {
      if (!(e && e.calcError) && root.console && root.CALC_DEBUG) console.error(e);
      return { ok: false, error: API.errKind(e), type: type, count: 0, solutions: [], allText: '' };
    }
  }

  // 계수 셀 하나 계산: COMP 규칙의 실수 한 값만. 정확값 유지(3⌟4 → ¾)
  function evalCoeff(tokens, settings, memory) {
    var s = {}; var src = settings || {};
    for (var key in src) s[key] = src[key];
    s.mode = 'EQN';
    var r = CE.evaluate(tokens, s, memory, {});
    if (!r.ok) return { ok: false, value: null, display: null, text: r.error, decimal: null, error: r.error, errorPos: r.errorPos };
    // 멀티 스테이트먼트(:), Pol/Rec, 대입식은 계수로 쓸 수 없다 [가정: Syntax ERROR]
    if (r.steps || r.multi || r.assign) return { ok: false, value: null, display: null, text: 'Syntax ERROR', decimal: null, error: 'Syntax ERROR', errorPos: null };
    if (r.value && r.value.k === 'c') return { ok: false, value: null, display: null, text: 'Math ERROR', decimal: null, error: 'Math ERROR', errorPos: null };
    return { ok: true, value: strip(r.value), display: r.display, text: r.text, decimal: r.decimal, decimalNode: r.decimalNode, view: r.view, error: null, errorPos: null };
  }

  CE.solveEqn = solveEqn;
  CE.evalCoeff = evalCoeff;
  CE.eqnCoeffCount = function (type) { return COUNTS[type] || 0; };
  CE._eqn = { quadRoots: quadRoots, cubicRoots: cubicRoots, solveLin2: solveLin2, solveLin3: solveLin3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
