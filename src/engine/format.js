/*
 * CalcEngine format: Value → 표시(DisplayNode 트리 + 한 줄 문자열).
 *  - 소수: Norm1/Norm2/Fix/Sci, 10자리 가수 (설명서 configuring_calculator)
 *  - 분수: d/c, ab/c, LineIO 의 ⌟ 표기
 *  - √ 표시: 최대 두 항, 계수 범위 (form_calculation_range)
 *  - π 표시: |x| < 10⁶ (calculation_ranges)
 *  - 근사값 인식: 기기처럼 15자리 내부값이 분수/√/π 형태와 일치하면 그 형태로 표시(MathO)
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core;
  var Q = C.Q, Q0 = C.Q0, Q1 = C.Q1;

  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function sup(s) { return String(s).split('').map(function (c) { return SUP[c] || c; }).join(''); }
  function T(s) { return { type: 'text', value: s }; }
  // 허수 단위 i: 계약 C4 대로 항상 단독 text 노드 'i' (인접 text 와 병합하지 않는다, QA-E5)
  function isImUnit(c) { return c && c.type === 'text' && c.value === 'i'; }
  function row(ch) {
    var out = [];
    ch.forEach(function (c) {
      if (!c) return;
      if (c.type === 'row') out = out.concat(c.children); else out.push(c);
    });
    // 인접 text 병합
    var m = [];
    out.forEach(function (c) {
      var last = m[m.length - 1];
      if (c.type === 'text' && last && last.type === 'text' && !isImUnit(c) && !isImUnit(last)) m[m.length - 1] = T(last.value + c.value);
      else m.push(c);
    });
    return m.length === 1 ? m[0] : { type: 'row', children: m };
  }
  function fmtOf(settings) {
    var f = (settings && settings.format) || {};
    var t = f.type || 'norm1';
    if (t === 'norm') t = 'norm' + (f.digits === 2 ? 2 : 1);
    return { type: t, digits: f.digits == null ? null : (f.digits | 0) };
  }
  function sepOf(settings) {
    var s = settings && (settings.decimalSep || settings.disp);
    return s === 'comma' || s === 'Comma' ? ',' : '.';
  }

  // ---------- 소수 ----------
  // |q| 를 유효숫자 sig 자리로: {m: BigInt(sig 자리), e: 첫 자리 지수}
  function sigParts(q, sig) {
    var a = C.qabs(q);
    var e = C.qlog10floor(a);
    var scale = sig - 1 - e;
    var m = scale >= 0 ? C.qroundInt(C.qmul(a, Q(C.pow10(scale)))) : C.qroundInt(C.qdiv(a, Q(C.pow10(-scale))));
    if (m >= C.pow10(sig)) { m = m / 10n; e += 1; }
    return { m: m, e: e };
  }
  function plainFromParts(m, e, sig, strip) {
    var ds = m.toString();
    while (ds.length < sig) ds = '0' + ds;
    var s;
    if (e >= 0) {
      if (ds.length <= e + 1) s = ds + '0'.repeat(e + 1 - ds.length);
      else s = ds.slice(0, e + 1) + '.' + ds.slice(e + 1);
    } else {
      s = '0.' + '0'.repeat(-e - 1) + ds;
    }
    if (strip && s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function sciNode(neg, mant, e, sep) {
    var ms = (neg ? '-' : '') + mant.replace('.', sep);
    return {
      node: { type: 'row', children: [T(ms + '×'), { type: 'pow', base: T('10'), exp: T(String(e)) }] },
      text: ms + '×10' + sup(String(e))
    };
  }
  function textNode(s, sep) { s = s.replace('.', sep); return { node: T(s), text: s }; }

  function formatDecimalQ(q, settings) {
    var f = fmtOf(settings), sep = sepOf(settings);
    if (q.n === 0n) {
      if (f.type === 'fix') return textNode(f.digits > 0 ? '0.' + '0'.repeat(f.digits) : '0', sep);
      if (f.type === 'sci') { var z = f.digits || 10; return sciNode(false, z > 1 ? '0.' + '0'.repeat(z - 1) : '0', 0, sep); }
      return textNode('0', sep);
    }
    var neg = q.n < 0n;
    var p, mant;
    if (f.type === 'sci') {
      var sig = f.digits || 10;
      p = sigParts(q, sig);
      var ds = p.m.toString();
      mant = ds.length > 1 ? ds[0] + '.' + ds.slice(1) : ds;
      return sciNode(neg, mant, p.e, sep);
    }
    if (f.type === 'fix') {
      var r = C.qroundDec(C.qabs(q), f.digits);
      if (r.n !== 0n && C.qcmp(r, Q(C.pow10(10))) < 0) {
        var scaled = C.qroundInt(C.qmul(C.qabs(q), Q(C.pow10(f.digits))));
        var s = scaled.toString();
        while (s.length < f.digits + 1) s = '0' + s;
        var str = f.digits > 0 ? s.slice(0, s.length - f.digits) + '.' + s.slice(s.length - f.digits) : s;
        return textNode((neg ? '-' : '') + str, sep);
      }
      if (r.n === 0n) return textNode((f.digits > 0 ? '0.' + '0'.repeat(f.digits) : '0'), sep);
      // 10¹⁰ 이상은 Norm1 지수 형식
    }
    p = sigParts(q, 10);
    var lo = f.type === 'norm2' ? -9 : -2;
    if (p.e < lo || p.e >= 10) {
      mant = plainFromParts(p.m, 0, 10, true);
      return sciNode(neg, mant, p.e, sep);
    }
    return textNode((neg ? '-' : '') + plainFromParts(p.m, p.e, 10, true), sep);
  }

  // ENG: 지수를 e 로 고정
  function formatEng(q, e, settings) {
    var sep = sepOf(settings);
    if (q.n === 0n) return sciNode(false, '0', e, sep);
    var p = sigParts(q, 10);
    var ds = p.m.toString(); // 10자리, 값 = 0.ds × 10^(p.e+1)
    // 가수 = |q| / 10^e : 소수점 위치 = p.e - e + 1
    var point = p.e - e + 1;
    var s;
    if (point <= 0) s = '0.' + '0'.repeat(-point) + ds;
    else if (point >= ds.length) s = ds + '0'.repeat(point - ds.length);
    else s = ds.slice(0, point) + '.' + ds.slice(point);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return sciNode(q.n < 0n, s, e, sep);
  }

  // 60진수 표시
  var DMS_MAX = Q(9999999n * 3600n + 59n * 60n + 59n);
  function formatDMS(q, settings) {
    var sep = sepOf(settings);
    var neg = q.n < 0n, a = C.qabs(q);
    var secs = C.qmul(a, Q(3600n));
    if (C.qcmp(secs, DMS_MAX) > 0) return null;
    var d = C.qfloor(a);
    var dDigits = d.toString().length;
    var places = Math.max(0, Math.min(2, 10 - dDigits - 4));
    var totalSec = C.qroundDec(secs, places);   // 초 단위 반올림
    var tsInt = C.qfloor(totalSec);
    d = tsInt / 3600n;
    var rem = C.qsub(totalSec, Q(d * 3600n));
    var mm = C.qfloor(rem) / 60n;
    var ss = C.qsub(rem, Q(mm * 60n));
    var sStr;
    if (ss.d === 1n) sStr = ss.n.toString();
    else {
      var sc = C.qroundInt(C.qmul(ss, Q(C.pow10(places))));
      var t = sc.toString(); while (t.length < places + 1) t = '0' + t;
      sStr = (t.slice(0, t.length - places) + '.' + t.slice(t.length - places)).replace(/0+$/, '').replace(/\.$/, '');
    }
    var s = (neg ? '-' : '') + d.toString() + '°' + mm.toString() + '′' + sStr.replace('.', sep) + '″';
    return { node: T(s), text: s };
  }

  // ---------- 분수 ----------
  function fracFits(q, mixed) {
    var n = C.babs(q.n), d = q.d;
    if (d === 1n) return C.digits(n) <= 10;
    if (mixed && n > d) {
      var i = n / d, r = n % d;
      return C.digits(i) + C.digits(r) + C.digits(d) + 2 <= 10;
    }
    return C.digits(n) + C.digits(d) + 1 <= 10;
  }
  // 정수가 아닌 유리수의 분수 표시 (line: LineIO 형식)
  function formatFrac(q, mixed, line) {
    var neg = q.n < 0n, n = C.babs(q.n), d = q.d;
    var sg = neg ? '-' : '';
    if (mixed && n > d) {
      var i = n / d, r = n % d;
      if (line) { var s1 = sg + i + '⌟' + r + '⌟' + d; return { node: T(s1), text: s1 }; }
      var mn = { type: 'mixed', int: T(i.toString()), num: T(r.toString()), den: T(d.toString()) };
      return { node: neg ? row([T('-'), mn]) : mn, text: sg + i + '⟨' + r + '/' + d + '⟩' };
    }
    if (line) { var s2 = sg + n + '⌟' + d; return { node: T(s2), text: s2 }; }
    var fn = { type: 'frac', num: T(n.toString()), den: T(d.toString()) };
    return { node: neg ? row([T('-'), fn]) : fn, text: sg + '⟨' + n + '/' + d + '⟩' };
  }

  // π 표시: c·π
  var PI_LIMIT = Q(1000000n);
  function formatPi(c, mixed) {
    if (C.qcmp(C.qabs(C.qmul(c, C.PI_Q)), PI_LIMIT) >= 0) return null;
    if (!fracFits(c, mixed)) return null;
    var neg = c.n < 0n, a = C.qabs(c);
    if (a.d === 1n) {
      var s = (neg ? '-' : '') + (a.n === 1n ? '' : a.n.toString()) + 'π';
      return { node: T(s), text: s };
    }
    var f = formatFrac(a, mixed, false);
    return { node: row([neg ? T('-') : null, f.node, T('π')]), text: (neg ? '-' : '') + f.text + 'π' };
  }

  // √ 표시: 항 [ [Q, r], ... ]
  function formatSqrt(terms) {
    if (!terms.length || terms.length > 2) return null;
    var hasRoot = terms.some(function (t) { return t[1] !== 1n; });
    if (!hasRoot) return null;
    // 공통 분모
    var den = 1n;
    terms.forEach(function (t) { den = den / C.gcd(den, t[0].d) * t[0].d; });
    if (den >= 100n) return null;
    // 정렬: 유리수 항 먼저, 그 뒤 근호 안 값 내림차순
    var ts = terms.map(function (t) { return { a: t[0].n * (den / t[0].d), r: t[1] }; });
    ts.sort(function (x, y) {
      if (x.r === 1n) return -1; if (y.r === 1n) return 1;
      return x.r > y.r ? -1 : (x.r < y.r ? 1 : 0);
    });
    for (var i = 0; i < ts.length; i++) {
      var aa = C.babs(ts[i].a);
      if (ts[i].r === 1n) { if (aa >= 100n) return null; }
      else if (aa >= 100n || ts[i].r >= 1000n) return null;
    }
    function termNodes(t, first, absSign) {
      var aa = C.babs(t.a), neg = t.a < 0n;
      var sg = absSign ? '' : (neg ? '-' : (first ? '' : '+'));
      var nodes = [], txt = sg;
      if (sg) nodes.push(T(sg));
      if (t.r === 1n) { nodes.push(T(aa.toString())); txt += aa.toString(); }
      else {
        if (aa !== 1n) { nodes.push(T(aa.toString())); txt += aa.toString(); }
        nodes.push({ type: 'sqrt', arg: T(t.r.toString()) });
        txt += '√' + t.r.toString();
      }
      return { nodes: nodes, text: txt };
    }
    var single = ts.length === 1;
    var outerNeg = single && ts[0].a < 0n;
    var nodes = [], text = '';
    ts.forEach(function (t, k) {
      var tn = termNodes(t, k === 0, single);
      nodes = nodes.concat(tn.nodes); text += tn.text;
    });
    var numNode = row(nodes);
    if (den === 1n) {
      return { node: outerNeg ? row([T('-'), numNode]) : numNode, text: (outerNeg ? '-' : '') + text };
    }
    var fr = { type: 'frac', num: numNode, den: T(den.toString()) };
    return {
      node: outerNeg ? row([T('-'), fr]) : fr,
      text: (outerNeg ? '-' : '') + '⟨' + (single ? text : '(' + text + ')') + '/' + den + '⟩'
    };
  }

  // ---------- 근사값 인식 ----------
  // 연분수 근사: |x − h/k| ≤ tol·|x| 인 첫 수렴분수 (분모 ≤ maxDen)
  function cfRational(x, relTol, maxDen) {
    if (x.n === 0n) return Q0;
    var neg = x.n < 0n;
    var n = C.babs(x.n), d = x.d;
    var tolQ = C.qmul(C.qabs(x), relTol);
    var h0 = 0n, h1 = 1n, k0 = 1n, k1 = 0n;
    var a = n, b = d;
    for (var it = 0; it < 80 && b !== 0n; it++) {
      var t = a / b;
      var h2 = t * h1 + h0, k2 = t * k1 + k0;
      if (k2 > maxDen) return null;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      var cand = Q(neg ? -h1 : h1, k1);
      if (C.qcmp(C.qabs(C.qsub(cand, x)), tolQ) <= 0) return cand;
      var r = a - t * b; a = b; b = r;
    }
    return null;
  }
  var TOL = Q(1n, 10n ** 13n);
  var TOL_SQ = Q(2n, 10n ** 13n);
  // 근사 Value → 정확 Value 후보 (유리수, a√b/c, c·π). 없으면 null
  function recognize(v, allowSqrt) {
    if (v.k !== 'a') return null;
    var x = v.q;
    if (x.n === 0n) return C.V0;
    var ax = C.qabs(x);
    if (C.qcmp(ax, Q(C.pow10(10))) >= 0 || C.qcmp(ax, Q(1n, C.pow10(10))) < 0) return null;
    var r = cfRational(x, TOL, 10n ** 9n);
    if (r && fracFits(r, false)) return C.vq(r);
    if (allowSqrt) {
      var sq = cfRational(C.qmul(x, x), TOL_SQ, 100000n);
      if (sq && sq.n > 0n) {
        var s = C.sqrtV(C.vq(sq));
        if (s.k === 'x' && s.t.length === 1 && s.t[0][1] !== 1n && formatSqrt(s.t)) return x.n < 0n ? C.neg(s) : s;
      }
    }
    var c = cfRational(C.qdiv(x, C.PI_Q), TOL, 10n ** 6n);
    if (c && c.n !== 0n && formatPi(c, false)) return C.vpi(c);
    return null;
  }

  // ---------- 결과 표시 결정 ----------
  // ctx: {settings, flags:{frac,dec}, opts}
  function formatValue(v, settings, flags, opts) {
    settings = settings || {}; flags = flags || {}; opts = opts || {};
    var io = settings.io || 'MathO';
    var math = io === 'MathO';
    var mixedPref = settings.fraction === 'ab/c';
    var line = !math;
    var numq = v.k === 'a' ? v.q : C.qroundSig(C.numQ(v, 40), 15);
    var dec = formatDecimalQ(numq, settings);
    var out = { display: dec.node, text: dec.text, decimal: dec.text, decimalNode: dec.node, view: 'decimal', alt: null, altText: null, exact: null };

    if (opts.eng != null) {
      var en = formatEng(numq, opts.eng | 0, settings);
      out.display = en.node; out.text = en.text; out.view = 'eng'; out.engExp = opts.eng | 0;
      return out;
    }
    if (opts.dmsOutput || (v.tag === 'dms' && !opts.sdToggle)) {
      var dm = formatDMS(numq, settings);
      if (dm) { out.display = dm.node; out.text = dm.text; out.view = 'dms'; out.dms = true; return out; }
      if (opts.dmsOutput) return out;
    }

    var mixedFD = flags.frac && flags.dec;   // 분수와 소수 혼합 → 항상 소수
    var ex = v;
    if (v.k === 'a' && math && !mixedFD) {
      var rec = recognize(v, !opts.decimalOutput);
      if (rec) { ex = rec; out.exact = rec; }
    }

    var natural = null, kind = 'decimal';
    var alt = null;
    if (ex.k === 'x' && C.isRational(ex)) {
      var q = C.getQ(ex);
      var fracForm = q.d !== 1n && fracFits(q, mixedPref) ? formatFrac(q, mixedPref, line) : null;
      if (math) {
        if (fracForm && !mixedFD) { natural = fracForm; kind = 'frac'; }
        else if (fracForm) alt = fracForm;
      } else {
        if (fracForm && flags.frac && !flags.dec) { natural = fracForm; kind = 'frac'; }
        else if (fracForm) alt = fracForm;
      }
    } else if (ex.k === 'x') {
      if (math && !opts.decimalOutput && !mixedFD) {
        var sf = formatSqrt(ex.t);
        if (sf) { natural = sf; kind = 'sqrt'; }
      }
    } else if (ex.k === 'p') {
      var pf = formatPi(ex.c, mixedPref);
      if (pf) {
        if (math && !mixedFD) { natural = pf; kind = 'pi'; }
        else if (math) alt = pf;
      }
    } else if (v.k === 'a' && !math) {
      // LineIO 에서 S⇔D 로 분수 표시
      var rr = cfRational(v.q, TOL, 10n ** 9n);
      if (rr && rr.d !== 1n && fracFits(rr, mixedPref)) alt = formatFrac(rr, mixedPref, true);
    }
    if (natural) {
      out.display = natural.node; out.text = natural.text; out.view = kind;
    }
    if (alt) { out.alt = alt.node; out.altText = alt.text; }
    if (opts.sdToggle) {
      if (natural) { out.display = dec.node; out.text = dec.text; out.view = 'decimal'; }
      else if (alt) { out.display = alt.node; out.text = alt.text; out.view = 'frac'; }
    }
    return out;
  }

  // ---------- 복소수 ----------
  // 자연 표기 문자열이 괄호 없이 두 항 이상(예 1+√2)인지. 이런 성분은 a+bi 로 이으면 읽을 수 없으므로 소수로 낸다 [가정]
  function multiTerm(text) {
    var s = text.charAt(0) === '-' ? text.slice(1) : text;
    if (s.charAt(0) === '⟨') return false;
    return /[+\-]/.test(s);
  }
  // form: 'rect' (a=re, b=im) | 'polar' (a=r, b=θ). aZero: 실수부가 0 (rect 에서 생략)
  function assembleC(form, A, B, bNeg, aZero) {
    if (form === 'polar') {
      return {
        node: row([A.node, T('∠'), B.node]), text: A.text + '∠' + B.text,
        lines: [{ node: A.node, text: A.text }, { node: row([T('∠'), B.node]), text: '∠' + B.text }]
      };
    }
    var one = B.text === '1';
    var coefN = one ? [] : [B.node], coefT = one ? '' : B.text;
    var sg = bNeg ? '-' : '+';
    var imNodes = coefN.concat([T('i')]);
    var node, text;
    if (aZero) { node = row([bNeg ? T('-') : null].concat(imNodes)); text = (bNeg ? '-' : '') + coefT + 'i'; }
    else { node = row([A.node, T(sg)].concat(imNodes)); text = A.text + sg + coefT + 'i'; }
    return {
      node: node, text: text,
      lines: [{ node: A.node, text: A.text }, { node: row([T(sg)].concat(imNodes)), text: sg + coefT + 'i' }]
    };
  }
  function formatComplex(form, a, b, settings, flags, opts) {
    settings = settings || {}; flags = flags || {}; opts = opts || {};
    var po = {};
    for (var k in opts) if (k !== 'eng' && k !== 'dmsOutput') po[k] = opts[k];
    var aZero = form === 'rect' && C.isZero(a);
    var bNeg = form === 'rect' && C.sign(b) < 0;
    var bAbs = bNeg ? C.neg(b) : b;
    function parts(o) {
      var fa = formatValue(a, settings, flags, o), fb = formatValue(bAbs, settings, flags, o);
      var fallback = multiTerm(fa.text) || multiTerm(fb.text);
      var nat = fallback
        ? assembleC(form, { node: fa.decimalNode, text: fa.decimal }, { node: fb.decimalNode, text: fb.decimal }, bNeg, aZero)
        : assembleC(form, { node: fa.display, text: fa.text }, { node: fb.display, text: fb.text }, bNeg, aZero);
      return { fa: fa, fb: fb, nat: nat, fallback: fallback };
    }
    var cur = parts(po);
    var dec = assembleC(form, { node: cur.fa.decimalNode, text: cur.fa.decimal }, { node: cur.fb.decimalNode, text: cur.fb.decimal }, bNeg, aZero);
    var to = {}; for (var k2 in po) to[k2] = po[k2];
    to.sdToggle = !po.sdToggle;
    var tog = parts(to).nat;
    var exact = null;
    if (form === 'rect' && (cur.fa.exact || cur.fb.exact)) {
      var eb = cur.fb.exact ? (bNeg ? C.neg(cur.fb.exact) : cur.fb.exact) : b;
      exact = C.mkC(cur.fa.exact || a, eb);
    }
    function signed(f, n) { return n ? { display: row([T('-'), f.display]), text: '-' + f.text } : { display: f.display, text: f.text }; }
    var hasAlt = tog.text !== cur.nat.text;
    return {
      display: cur.nat.node, text: cur.nat.text,
      decimal: dec.text, decimalNode: dec.node,
      alt: hasAlt ? tog.node : null, altText: hasAlt ? tog.text : null,
      // LineIO/LineO 2행 표시(설명서 cmplx 주의 3): lines=현재, decimalLines=소수(SHIFT =), altLines=S⇔D 뒤 (QA-E4)
      lines: cur.nat.lines, decimalLines: dec.lines, altLines: hasAlt ? tog.lines : null,
      view: 'cmplx', format: form, exact: exact,
      partA: { display: cur.fa.display, text: cur.fa.text },
      partB: signed(cur.fb, bNeg)
    };
  }

  CE._format = {
    formatComplex: formatComplex,
    formatValue: formatValue, formatDecimalQ: formatDecimalQ, formatEng: formatEng, formatDMS: formatDMS,
    formatFrac: formatFrac, formatPi: formatPi, formatSqrt: formatSqrt, recognize: recognize, cfRational: cfRational,
    fracFits: fracFits, sup: sup
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
