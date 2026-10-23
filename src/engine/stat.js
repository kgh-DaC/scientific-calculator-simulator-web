/*
 * CalcEngine STAT 모드: 통계 계산(1변수, 직선·2차·대수·e지수·ab지수·누승·역수 회귀), 추정값, 정규분포.
 * 근거: 카시오 한글 매뉴얼(2019판) "통계 계산(STAT)" (fx-570ESPLUS_991ESPLUS_KO.pdf 45~53쪽).
 * 값은 엔진 Value(정확값)로 계산하지만, STAT 모드는 UI가 리니어 표기로 전환하므로 화면에는 소수로
 * 보인다(분수·√ 모양은 엔진 내부 표현). ln·e 변환이 들어가는
 * 회귀(ln X, e^X, A·B^X, A·X^B)만 근사값이다.
 * 브라우저: api.js 다음에 <script src="src/engine/stat.js">. Node: index.js 가 불러온다.
 *
 * statAnalyze(type, rows) -> { ok, error, type, two, vars:{...Value}, est:{...} }
 *   type: 'var1' | 'lin' | 'quad' | 'log' | 'exp' | 'ab' | 'pow' | 'inv'
 *   rows: [{ x:Value, y:Value|null, f:Value|null }]  (x 가 비어 있으면 건너뜀, 2변수는 y 도 필요)
 * vars 이름: n sumx sumx2 sumy sumy2 sumxy sumx3 sumx2y sumx4 meanx sigx sx meany sigy sy
 *            A B C r minx maxx miny maxy      (없는 값은 정의하지 않음)
 * 평가기는 memory.stat 으로 이 결과를 받는다(CE._stat.value / command / normal).
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core;

  function err(kind) { return C.CalcError(kind); }
  function mathErr() { return err('Math ERROR'); }

  var TYPES = {
    var1: { two: false }, lin: { two: true }, quad: { two: true }, log: { two: true },
    exp: { two: true }, ab: { two: true }, pow: { two: true }, inv: { two: true }
  };

  function dbl(v) { return C.toDouble(v); }
  function fd(x) {
    if (!isFinite(x)) throw mathErr();
    return C.fromDouble(x);
  }
  function lnD(v) { var x = dbl(v); if (!(x > 0)) throw mathErr(); return Math.log(x); }
  function isZ(v) { return C.isZero(v); }
  function zeroClamp(v) { return C.sign(v) < 0 ? C.V0 : v; }

  // 변환 u = g(x), v = h(y) (회귀 종류별 직선화)
  function transforms(type) {
    switch (type) {
      case 'lin': case 'quad': return { u: function (x) { return x; }, v: function (y) { return y; } };
      case 'log': return { u: function (x) { return fd(lnD(x)); }, v: function (y) { return y; } };
      case 'exp': case 'ab': return { u: function (x) { return x; }, v: function (y) { return fd(lnD(y)); } };
      case 'pow': return { u: function (x) { return fd(lnD(x)); }, v: function (y) { return fd(lnD(y)); } };
      case 'inv': return { u: function (x) { if (isZ(x)) throw mathErr(); return C.inv(x); }, v: function (y) { return y; } };
    }
    return null;
  }

  function det3(m) {
    var a = m[0], b = m[1], c = m[2];
    var t1 = C.mul(a[0], C.sub(C.mul(b[1], c[2]), C.mul(b[2], c[1])));
    var t2 = C.mul(a[1], C.sub(C.mul(b[0], c[2]), C.mul(b[2], c[0])));
    var t3 = C.mul(a[2], C.sub(C.mul(b[0], c[1]), C.mul(b[1], c[0])));
    return C.add(C.sub(t1, t2), t3);
  }

  function statAnalyze(type, rows) {
    var def = TYPES[type];
    if (!def) return { ok: false, error: 'Syntax ERROR' };
    var data = [];
    (rows || []).forEach(function (r) {
      if (!r || r.x == null) return;
      if (def.two && r.y == null) return;
      var f = r.f == null ? C.V1 : r.f;
      if (C.sign(f) <= 0) return;
      data.push({ x: r.x, y: def.two ? r.y : null, f: f });
    });
    var res = { ok: true, error: null, type: type, two: def.two, n: data.length, vars: {}, est: {} };
    if (!data.length) { res.ok = false; res.error = 'Math ERROR'; return res; }
    var V = res.vars;
    var sum = function (fn) {
      var s = C.V0;
      data.forEach(function (d) { s = C.add(s, C.mul(d.f, fn(d))); });
      return s;
    };
    var n = sum(function () { return C.V1; });
    V.n = n;
    V.sumx = sum(function (d) { return d.x; });
    V.sumx2 = sum(function (d) { return C.mul(d.x, d.x); });
    V.meanx = C.div(V.sumx, n);
    V.sigx = C.sqrtV(zeroClamp(C.sub(C.div(V.sumx2, n), C.mul(V.meanx, V.meanx))));
    if (C.cmp(n, C.V1) > 0) {
      var vx = C.div(C.sub(V.sumx2, C.mul(n, C.mul(V.meanx, V.meanx))), C.sub(n, C.V1));
      V.sx = C.sqrtV(zeroClamp(vx));
    }
    var xs = data.map(function (d) { return d.x; });
    V.minx = xs.reduce(function (a, b) { return C.cmp(b, a) < 0 ? b : a; });
    V.maxx = xs.reduce(function (a, b) { return C.cmp(b, a) > 0 ? b : a; });
    if (!def.two) return res;

    V.sumy = sum(function (d) { return d.y; });
    V.sumy2 = sum(function (d) { return C.mul(d.y, d.y); });
    V.sumxy = sum(function (d) { return C.mul(d.x, d.y); });
    V.sumx3 = sum(function (d) { return C.mul(d.x, C.mul(d.x, d.x)); });
    V.sumx2y = sum(function (d) { return C.mul(C.mul(d.x, d.x), d.y); });
    V.sumx4 = sum(function (d) { var q = C.mul(d.x, d.x); return C.mul(q, q); });
    V.meany = C.div(V.sumy, n);
    V.sigy = C.sqrtV(zeroClamp(C.sub(C.div(V.sumy2, n), C.mul(V.meany, V.meany))));
    if (C.cmp(n, C.V1) > 0) {
      var vy = C.div(C.sub(V.sumy2, C.mul(n, C.mul(V.meany, V.meany))), C.sub(n, C.V1));
      V.sy = C.sqrtV(zeroClamp(vy));
    }
    var ys = data.map(function (d) { return d.y; });
    V.miny = ys.reduce(function (a, b) { return C.cmp(b, a) < 0 ? b : a; });
    V.maxy = ys.reduce(function (a, b) { return C.cmp(b, a) > 0 ? b : a; });

    try { regress(type, data, res, n); } catch (e) {
      if (!(e && e.calcError)) throw e;
      res.regError = e.calcError;
    }
    return res;
  }

  function regress(type, data, res, n) {
    var V = res.vars;
    if (type === 'quad') {
      var M = [[n, V.sumx, V.sumx2], [V.sumx, V.sumx2, V.sumx3], [V.sumx2, V.sumx3, V.sumx4]];
      var R = [V.sumy, V.sumxy, V.sumx2y];
      var D = det3(M);
      if (isZ(D)) throw mathErr();
      var col = function (k) {
        var m = M.map(function (row, i) { var r = row.slice(); r[k] = R[i]; return r; });
        return C.div(det3(m), D);
      };
      V.A = col(0); V.B = col(1); V.C = col(2);
      res.est = {
        yhat: function (x) { return C.add(V.A, C.add(C.mul(V.B, x), C.mul(V.C, C.mul(x, x)))); },
        xhat1: function (y) { return quadRoot(V, y, 1); },
        xhat2: function (y) { return quadRoot(V, y, -1); }
      };
      return;
    }
    var T = transforms(type);
    var us = data.map(function (d) { return T.u(d.x); });
    var vs = data.map(function (d) { return T.v(d.y); });
    var su = C.V0, sv = C.V0;
    data.forEach(function (d, i) { su = C.add(su, C.mul(d.f, us[i])); sv = C.add(sv, C.mul(d.f, vs[i])); });
    var mu = C.div(su, n), mv = C.div(sv, n);
    var suu = C.V0, suv = C.V0, svv = C.V0;
    data.forEach(function (d, i) {
      var du = C.sub(us[i], mu), dv = C.sub(vs[i], mv);
      suu = C.add(suu, C.mul(d.f, C.mul(du, du)));
      suv = C.add(suv, C.mul(d.f, C.mul(du, dv)));
      svv = C.add(svv, C.mul(d.f, C.mul(dv, dv)));
    });
    if (isZ(suu)) throw mathErr();
    var b = C.div(suv, suu);
    var a = C.sub(mv, C.mul(b, mu));
    if (!isZ(svv)) V.r = C.div(suv, C.sqrtV(C.mul(suu, svv)));
    else V.r = C.V1;
    var A, B;
    switch (type) {
      case 'lin': case 'log': case 'inv': A = a; B = b; break;
      case 'exp': A = fd(Math.exp(dbl(a))); B = b; break;
      case 'ab': A = fd(Math.exp(dbl(a))); B = fd(Math.exp(dbl(b))); break;
      case 'pow': A = fd(Math.exp(dbl(a))); B = b; break;
    }
    V.A = A; V.B = B;
    var ad = function () { return dbl(A); }, bd = function () { return dbl(B); };
    switch (type) {
      case 'lin':
        res.est = { yhat: function (x) { return C.add(A, C.mul(B, x)); },
          xhat: function (y) { if (isZ(B)) throw mathErr(); return C.div(C.sub(y, A), B); } };
        break;
      case 'log':
        res.est = { yhat: function (x) { return C.add(A, C.mul(B, fd(lnD(x)))); },
          xhat: function (y) { if (isZ(B)) throw mathErr(); return fd(Math.exp(dbl(C.div(C.sub(y, A), B)))); } };
        break;
      case 'inv':
        res.est = { yhat: function (x) { if (isZ(x)) throw mathErr(); return C.add(A, C.div(B, x)); },
          xhat: function (y) { var d = C.sub(y, A); if (isZ(d)) throw mathErr(); return C.div(B, d); } };
        break;
      case 'exp':
        res.est = { yhat: function (x) { return fd(ad() * Math.exp(bd() * dbl(x))); },
          xhat: function (y) { return fd(Math.log(dbl(y) / ad()) / bd()); } };
        break;
      case 'ab':
        res.est = { yhat: function (x) { return fd(ad() * Math.pow(bd(), dbl(x))); },
          xhat: function (y) { return fd(Math.log(dbl(y) / ad()) / Math.log(bd())); } };
        break;
      case 'pow':
        res.est = { yhat: function (x) { return fd(ad() * Math.pow(dbl(x), bd())); },
          xhat: function (y) { return fd(Math.pow(dbl(y) / ad(), 1 / bd())); } };
        break;
    }
  }

  // 2차 회귀의 x̂1, x̂2 = (−B ± √(B² − 4C(A − y))) / 2C
  function quadRoot(V, y, sg) {
    if (isZ(V.C)) throw mathErr();
    var disc = C.sub(C.mul(V.B, V.B), C.mul(C.vint(4), C.mul(V.C, C.sub(V.A, y))));
    if (C.sign(disc) < 0) throw mathErr();
    var root = C.sqrtV(disc);
    var num = sg > 0 ? C.add(C.neg(V.B), root) : C.sub(C.neg(V.B), root);
    return C.div(num, C.mul(C.vint(2), V.C));
  }

  /* ---------------- 평가기 연결 ---------------- */
  function need(st) {
    if (!st) throw mathErr();
    if (st.error) throw err(st.error);
    return st;
  }
  function value(st, name) {
    need(st);
    var v = st.vars[name];
    if (v === undefined) {
      if (st.regError && (name === 'A' || name === 'B' || name === 'C' || name === 'r')) throw err(st.regError);
      throw mathErr();
    }
    return v;
  }
  function command(st, name, a) {
    need(st);
    if (st.regError && name !== 'tnorm') throw err(st.regError);
    if (name === 'tnorm') {
      if (!st.vars.sigx || isZ(st.vars.sigx)) throw mathErr();
      return C.div(C.sub(a, st.vars.meanx), st.vars.sigx);
    }
    var f = st.est[name];
    if (!f) throw mathErr();
    return f(a);
  }

  // 표준정규분포 (Φ). |x| ≤ 3 은 급수, 그 밖은 연분수 (오차 < 1e-13)
  function erf(x) {
    var ax = Math.abs(x);
    if (ax > 3) return (x < 0 ? -1 : 1) * (1 - erfcCF(ax));
    var sum = ax, term = ax, n = 0;
    do {
      n++;
      term *= -ax * ax / n;
      sum += term / (2 * n + 1);
    } while (Math.abs(term / (2 * n + 1)) > 1e-18 && n < 200);
    return (x < 0 ? -1 : 1) * 2 / Math.sqrt(Math.PI) * sum;
  }
  function erfcCF(x) {
    var f = 0;
    for (var k = 60; k >= 1; k--) f = k / 2 / (x + f);
    return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
  }
  function phi(t) { return 0.5 * (1 + erf(t / Math.SQRT2)); }
  // P(t) = Φ(t),  Q(t) = |Φ(t) − 1/2| [미확인: 음수 t],  R(t) = 1 − Φ(t)
  function normal(name, a) {
    var t = dbl(a);
    var p = phi(t), r;
    if (name === 'normP') r = p;
    else if (name === 'normQ') r = Math.abs(p - 0.5);
    else r = t < 0 ? phi(-t) : 1 - p;
    return C.fromDouble(Number(r.toPrecision(12)));
  }

  CE.statAnalyze = statAnalyze;
  CE._stat = { value: value, command: command, normal: normal, TYPES: TYPES, phi: phi };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
