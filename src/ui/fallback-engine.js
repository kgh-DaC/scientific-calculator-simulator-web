/*
 * Minimal floating-point stand-in used ONLY when src/engine (CalcEngine.evaluate) is not loaded,
 * so that the UI can be exercised on its own. It is not exact and does not implement
 * fractions/√ display, nPr/nCr, CALC/SOLVE etc. The real engine always takes precedence.
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};

  var FN = {
    sin: 'T.sin', cos: 'T.cos', tan: 'T.tan', asin: 'T.asin', acos: 'T.acos', atan: 'T.atan',
    sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh', asinh: 'Math.asinh', acosh: 'Math.acosh', atanh: 'Math.atanh',
    log: 'T.log', ln: 'Math.log', exp: 'Math.exp', pow10: 'T.p10', sqrt: 'Math.sqrt', cbrt: 'Math.cbrt', abs: 'Math.abs',
    rnd: 'T.id'
  };

  function startsOperand(t) {
    return t.type === 'num' || t.type === 'fn' || t.type === 'tpl' && t.name !== 'pow' || t.type === 'const' ||
      t.type === 'var' || t.type === 'ans' || t.type === 'ran' || (t.type === 'paren' && t.value === '(') || t.type === 'neg';
  }
  function endsOperand(t) {
    return t.type === 'num' || (t.type === 'tpl') || t.type === 'const' || t.type === 'var' || t.type === 'ans' ||
      t.type === 'ran' || (t.type === 'paren' && t.value === ')') || t.type === 'postfix';
  }

  function scValue(i) {
    var e = FX.Tables && FX.Tables.constEntry(i);
    if (!e || e.value == null) return '#';
    if (typeof e.value === 'object' && e.value.pi != null) return '(' + Number(e.value.pi) + '*Math.PI)';
    return '(' + Number(e.value) + ')';
  }
  function convFactor(i) {
    var e = FX.Tables && FX.Tables.convEntry(i);
    if (!e || !e.factor) return '#';      // °F/°C need the real engine
    return (e.kind === 'div' ? '/' : '*') + Number(e.factor);
  }
  // LineIO "a⌟b" / "a⌟b⌟c" (integer literals) -> frac / mixed templates
  function foldFracsep(tokens) {
    var out = [];
    function numRun(i) { var j = i; var v = ''; while (tokens[j] && tokens[j].type === 'num') { v += tokens[j].value; j++; } return { end: j, toks: tokens.slice(i, j), ok: j > i }; }
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'num' && (i === 0 || tokens[i - 1].type !== 'num')) {
        var a = numRun(i);
        if (tokens[a.end] && tokens[a.end].type === 'fracsep') {
          var b = numRun(a.end + 1);
          if (!b.ok) throw 'Syntax ERROR';
          if (tokens[b.end] && tokens[b.end].type === 'fracsep') {
            var c = numRun(b.end + 1);
            if (!c.ok) throw 'Syntax ERROR';
            out.push({ type: 'tpl', name: 'mixed', slots: [a.toks, b.toks, c.toks] });
            i = c.end - 1;
          } else {
            out.push({ type: 'tpl', name: 'frac', slots: [a.toks, b.toks] });
            i = b.end - 1;
          }
          continue;
        }
      }
      if (t.type === 'fracsep') throw 'Syntax ERROR';
      out.push(t);
    }
    return out;
  }

  function toJS(tokens) {
    tokens = foldFracsep(tokens);
    var s = '';
    var open = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var prev = tokens[i - 1];
      if (prev && endsOperand(prev) && startsOperand(t) && !(prev.type === 'num' && t.type === 'num')) s += '*';
      switch (t.type) {
        case 'num': s += t.value; break;
        case 'exp10': {
          var sign = '';
          var j = i + 1;
          if (tokens[j] && (tokens[j].type === 'neg' || (tokens[j].type === 'op' && tokens[j].value === '-'))) { sign = '-'; j++; }
          var dig = '';
          while (tokens[j] && tokens[j].type === 'num') { dig += tokens[j].value; j++; }
          s += (prev && endsOperand(prev) ? '*' : '1*') + '1e' + sign + (dig || '0');
          i = j - 1;
          break;
        }
        case 'op': s += { '+': '+', '-': '-', '*': '*', '/': '/', '×': '*', '÷': '/', '−': '-' }[t.value] || '#'; break;
        case 'neg': s += '(-1)*'; break;   // (−)2² = −4 (JS forbids -2**2)
        case 'paren': if (t.value === '(') { s += '('; open++; } else { s += ')'; open--; } break;
        case 'comma': s += ','; break;
        case 'fn': if (!FN[t.name]) throw 'Syntax ERROR'; s += FN[t.name] + '('; open++; break;
        case 'postfix': s += { sq: '**2', cube: '**3', inv: '**-1', pct: '/100' }[t.name] || '#'; break;
        case 'const': s += t.name === 'pi' ? 'Math.PI' : t.name === 'e' ? 'Math.E' : t.name === 'sc' ? scValue(t.index) : '#'; break;
        case 'conv': s += convFactor(t.index); break;
        case 'var': s += '(+V.' + t.name + '||0)'; break;
        case 'ans': s += '(+V.Ans||0)'; break;
        case 'ran': s += 'Math.random()'; break;
        case 'infix': s += t.name === 'pow' ? '**(' : '#'; open++; break;
        case 'tpl': {
          var a = t.slots.map(function (sl) { if (!sl.length) throw 'Syntax ERROR'; return '(' + toJS(sl) + ')'; });
          switch (t.name) {
            case 'frac': s += '(' + a[0] + '/' + a[1] + ')'; break;
            case 'mixed': s += '(' + a[0] + '+' + a[1] + '/' + a[2] + ')'; break;
            case 'sqrt': s += 'Math.sqrt' + a[0]; break;
            case 'cbrt': s += 'Math.cbrt' + a[0]; break;
            case 'root': s += 'Math.pow(' + a[1] + ',1/' + a[0] + ')'; break;
            case 'pow': s += '**' + a[0]; break;
            case 'pow10': s += 'T.p10' + a[0]; break;
            case 'exp': s += 'Math.exp' + a[0]; break;
            case 'logb': s += '(Math.log' + a[1] + '/Math.log' + a[0] + ')'; break;
            case 'abs': s += 'Math.abs' + a[0]; break;
            default: throw 'Syntax ERROR';
          }
          break;
        }
        default: throw 'Syntax ERROR';
      }
    }
    while (open-- > 0) s += ')';
    if (s.indexOf('#') >= 0) throw 'Syntax ERROR';
    return s;
  }

  function fmt(x) {
    if (!isFinite(x) || isNaN(x)) throw 'Math ERROR';
    if (x === 0) return '0';
    var ax = Math.abs(x);
    if (ax < 1e-2 || ax >= 1e10) {
      var e = Math.floor(Math.log10(ax));
      var m = parseFloat((x / Math.pow(10, e)).toPrecision(10));
      if (Math.abs(m) >= 10) { m /= 10; e++; }
      return { type: 'row', children: [{ type: 'text', value: String(m).replace('-', '−') + '×' }, { type: 'pow', base: { type: 'text', value: '10' }, exp: { type: 'text', value: String(e).replace('-', '−') } }] };
    }
    return String(parseFloat(x.toPrecision(10))).replace('-', '−');
  }

  function evaluate(tokens, settings, memory) {
    var ang = settings.angle === 'rad' ? 1 : settings.angle === 'gra' ? Math.PI / 200 : Math.PI / 180;
    var T = {
      sin: function (x) { return Math.sin(x * ang); }, cos: function (x) { return Math.cos(x * ang); },
      tan: function (x) { return Math.tan(x * ang); }, asin: function (x) { return Math.asin(x) / ang; },
      acos: function (x) { return Math.acos(x) / ang; }, atan: function (x) { return Math.atan(x) / ang; },
      log: function (a, b) { return b === undefined ? Math.log10(a) : Math.log(b) / Math.log(a); },
      p10: function (x) { return Math.pow(10, x); }, id: function (x) { return x; }
    };
    var V = { Ans: memory.ans };
    for (var k in memory.vars) V[k] = memory.vars[k];
    try {
      var js = toJS(tokens);
      /* eslint no-new-func: 0 */
      var x = new Function('T', 'V', '"use strict";return (' + js + ');')(T, V);
      if (typeof x !== 'number') throw 'Syntax ERROR';
      x = parseFloat(x.toPrecision(15));
      if (Math.abs(x) < 1e-99) x = 0;
      var d = fmt(x);
      return { ok: true, value: x, display: typeof d === 'string' ? { type: 'text', value: d } : d, decimal: d, text: FX.displayText(d), error: null, errorPos: null };
    } catch (e) {
      return { ok: false, error: typeof e === 'string' ? e : 'Syntax ERROR', errorPos: null };
    }
  }

  FX.FallbackEngine = { evaluate: evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
