/*
 * 공학용계산기 시뮬레이터 - LCD renderer (DOM).
 *
 * Draws what FX.Calculator.getScreen() describes. It never computes anything:
 *   - the input line is the editor tree (atoms + natural-display templates) plus the cursor
 *   - the result line is the engine's DisplayNode tree (text, row, frac, sqrt, pow, mixed)
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------------- atoms ---------------- */
  var GLYPH = {
    'neg': '<span class="neg">-</span>',
    '−': '−', '+': '+', '×': '×', '÷': '÷',
    '²': '<sup class="ps">2</sup>', '³': '<sup class="ps">3</sup>', '⁻¹': '<sup class="ps">−1</sup>',
    'dms': '°', 'drgD': '<sup class="ps">o</sup>', 'drgR': '<sup class="ps">r</sup>', 'drgG': '<sup class="ps">g</sup>',
    'x10': '×<sub class="e10">10</sub>',
    'nPr': '<b class="pc">P</b>', 'nCr': '<b class="pc">C</b>',
    'e': '<i class="ee">e</i>', 'π': 'π',
    '⌟': '<span class="fsep">⌟</span>',
    'ˣ√(': '<sup class="ps">x</sup>√(',
    '^(': '^(',
    'sin⁻¹(': 'sin<sup class="ps">−1</sup>(', 'cos⁻¹(': 'cos<sup class="ps">−1</sup>(', 'tan⁻¹(': 'tan<sup class="ps">−1</sup>(',
    'sinh⁻¹(': 'sinh<sup class="ps">−1</sup>(', 'cosh⁻¹(': 'cosh<sup class="ps">−1</sup>(', 'tanh⁻¹(': 'tanh<sup class="ps">−1</sup>(',
    '³√(': '<sup class="ps">3</sup>√(',
    'e^(': '<i class="ee">e</i>^(',
    'd/dx(': '<sup class="ps">d</sup>/<sub class="ps">dx</sub>(',
    'RanInt#(': 'RanInt#(',
    // CMPLX
    'i': '<i class="im">i</i>', '∠': '∠',
    '▶r∠θ': '<span class="cmd">▶r∠θ</span>', '▶a+bi': '<span class="cmd">▶a+b<i class="im">i</i></span>'
  };

  function atomHTML(id) {
    if (GLYPH[id] !== undefined) return GLYPH[id];
    if (id.indexOf('const:') === 0) return '<span class="cst">' + esc(FX.Tables.constSymbol(id.slice(6))) + '</span>';
    if (id.indexOf('conv:') === 0) return '<span class="cnv">' + esc(FX.Tables.convLabel(id.slice(5))) + '</span>';
    if (id.indexOf('lbl:') === 0) return esc(id.slice(4));
    return esc(id);
  }

  /* ---------------- editor tree -> HTML ---------------- */
  var CURSOR = '<span class="cur"></span>';

  function samePath(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    return true;
  }

  // ctx: {cursor:{path,pos,style}|null, lineMode}
  function rowHTML(row, path, ctx, isSlot) {
    var html = '';
    var curHere = ctx.cursor && samePath(ctx.cursor.path, path);
    var cursorStr = curHere ? CURSOR.replace('cur"', 'cur ' + (ctx.cursor.style || 'bar') + '"') : '';
    if (isSlot && row.length === 0) {
      return '<span class="slot empty">' + cursorStr + '</span>';
    }
    for (var i = 0; i < row.length; i++) {
      if (curHere && ctx.cursor.pos === i) html += cursorStr;
      var n = row[i];
      if (n.k === 'tpl') html += tplHTML(n, path, i, ctx);
      else html += '<span class="a">' + atomHTML(n.id) + '</span>';
    }
    if (curHere && ctx.cursor.pos >= row.length) html += cursorStr;
    return isSlot ? '<span class="slot">' + html + '</span>' : html;
  }

  function slot(n, path, i, s, ctx) {
    return rowHTML(n.slots[s], path.concat([[i, s]]), ctx, true);
  }

  function tplHTML(n, path, i, ctx) {
    var S = function (s) { return slot(n, path, i, s, ctx); };
    switch (n.type) {
      case 'frac':
        return '<span class="t frac"><span class="fn">' + S(0) + '</span><span class="fd">' + S(1) + '</span></span>';
      case 'mixed':
        return '<span class="t mixed">' + S(0) + '<span class="t frac"><span class="fn">' + S(1) + '</span><span class="fd">' + S(2) + '</span></span></span>';
      case 'sqrt':
        return '<span class="t sqrt"><span class="rad">√</span><span class="rc">' + S(0) + '</span></span>';
      case 'cbrt':
        return '<span class="t sqrt"><sup class="ri"><span class="slot">3</span></sup><span class="rad">√</span><span class="rc">' + S(0) + '</span></span>';
      case 'nroot':
        return '<span class="t sqrt"><sup class="ri">' + S(0) + '</sup><span class="rad">√</span><span class="rc">' + S(1) + '</span></span>';
      case 'pow':
        return '<sup class="t pow">' + S(0) + '</sup>';
      case 'pow10':
        return '<span class="t">10<sup class="t pow">' + S(0) + '</sup></span>';
      case 'powe':
        return '<span class="t"><i class="ee">e</i><sup class="t pow">' + S(0) + '</sup></span>';
      case 'logb':
        return '<span class="t logb">log<sub class="lb">' + S(0) + '</sub>(' + S(1) + ')</span>';
      case 'abs':
        return '<span class="t abs">' + S(0) + '</span>';
      case 'integ':
        return '<span class="t big"><span class="bigsym">∫</span><span class="lim"><span class="up">' + S(2) + '</span><span class="lo">' + S(1) + '</span></span>' +
          S(0) + '<i class="dx">dx</i></span>';
      case 'deriv':
        return '<span class="t deriv"><span class="t frac sm"><span class="fn">d</span><span class="fd">dx</span></span>(' + S(0) + ')<span class="at">|<sub>x=' + S(1) + '</sub></span></span>';
      case 'sum':
        return '<span class="t big"><span class="lim2"><span class="up">' + S(2) + '</span><span class="bigsym s">Σ</span><span class="lo">x=' + S(1) + '</span></span>(' + S(0) + ')</span>';
    }
    return '?';
  }

  /* ---------------- engine DisplayNode -> HTML ---------------- */
  function textHTML(s) {
    // engine strings may contain ⁻ superscripts already; minus sign shown as the LCD hyphen
    return esc(s).replace(/⌟/g, '<span class="fsep">⌟</span>');
  }

  function nodeHTML(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return textHTML(node);
    if (Array.isArray(node)) return node.map(nodeHTML).join('');
    var ch = node.children || node.items;
    switch (node.type) {
      case 'text':
        if (node.value === 'i') return GLYPH.i;   // CMPLX imaginary unit: same glyph as the input line
        return textHTML(node.value != null ? node.value : (node.text || ''));
      case 'row': return (ch || []).map(nodeHTML).join('');
      case 'frac':
        return '<span class="t frac"><span class="fn"><span class="slot">' + nodeHTML(node.num) + '</span></span><span class="fd"><span class="slot">' +
          nodeHTML(node.den) + '</span></span></span>';
      case 'mixed':
        return '<span class="t mixed">' + nodeHTML(node.int || node.whole) + '<span class="t frac"><span class="fn"><span class="slot">' +
          nodeHTML(node.num) + '</span></span><span class="fd"><span class="slot">' + nodeHTML(node.den) + '</span></span></span></span>';
      case 'sqrt':
        return '<span class="t sqrt"><span class="rad">√</span><span class="rc"><span class="slot">' +
          nodeHTML(node.arg !== undefined ? node.arg : (node.radicand !== undefined ? node.radicand : ch)) + '</span></span></span>';
      case 'pow':
      case 'sup':
        return nodeHTML(node.base) + '<sup class="t pow"><span class="slot">' + nodeHTML(node.exp !== undefined ? node.exp : ch) + '</span></sup>';
      case 'sci':
      case 'exp10':
        return nodeHTML(node.mantissa) + '×10<sup class="t pow"><span class="slot">' + nodeHTML(node.exp) + '</span></sup>';
    }
    if (node.value !== undefined) return textHTML(node.value);
    if (node.text !== undefined) return textHTML(node.text);
    if (ch) return nodeHTML(ch);
    return '';
  }

  /* ---------------- EQN coefficient screen ---------------- */
  // EQN_2.png / EQN_3.png: column heads (a b c), row numbers (simultaneous equations), cells with the
  // selected one inverted, and the selected cell's value (or the entry being typed) bottom right.
  function eqnEditHTML(eq, lineMode) {
    var hasNo = eq.rows[0] && eq.rows[0].num != null;
    var h = '<div class="eqg">';
    h += '<div class="eqr eqh">' + (hasNo ? '<span class="eqn-no"></span>' : '') +
      eq.heads.map(function (x) { return '<span class="eqc">' + esc(x) + '</span>'; }).join('') + '</div>';
    eq.rows.forEach(function (row) {
      h += '<div class="eqr">' + (row.num != null ? '<span class="eqn-no">' + row.num + '</span>' : '') +
        row.cells.map(function (c) {
          return '<span class="eqc' + (c.sel ? ' sel' : '') + '"><span class="eqv">' + nodeHTML(c.node) + '</span></span>';
        }).join('') + '</div>';
    });
    h += '</div><div class="eqb">';
    var b = eq.bottom;
    if (b.expr) {
      h += b.expr.length ? rowHTML(b.expr, [], { cursor: b.cursor, lineMode: lineMode }, false)
        : CURSOR.replace('cur"', 'cur ' + (b.cursor.style || 'bar') + '"');
    } else h += nodeHTML(b.node);
    return h + '</div>';
  }

  /* ---------------- indicators ---------------- */
  var IND_ORDER = [
    ['S', 'S'], ['A', 'A'], ['M', 'M'], ['STO', 'STO'], ['RCL', 'RCL'], ['STAT', 'STAT'], ['CMPLX', 'CMPLX'],
    ['MAT', 'MAT'], ['VCT', 'VCT'], ['D', 'D'], ['R', 'R'], ['G', 'G'], ['FIX', 'FIX'], ['SCI', 'SCI'],
    ['Math', 'Math▲'], ['down', '▼'], ['up', '▲'], ['Disp', 'Disp']
  ];

  function indicatorsHTML(ind) {
    return IND_ORDER.map(function (p) {
      var label = p[1] === 'Math▲' ? 'Math' : p[1];
      return '<span class="ind ind-' + p[0] + (ind[p[0]] ? ' on' : '') + '">' + esc(label) + '</span>';
    }).join('');
  }

  /* ---------------- whole screen ---------------- */
  function Renderer(root) {
    this.root = root;
    this.indEl = root.querySelector('.lcd-ind');
    this.inEl = root.querySelector('.lcd-in');
    this.inInner = root.querySelector('.lcd-in-inner');
    this.outEl = root.querySelector('.lcd-out');
    this.outInner = root.querySelector('.lcd-out-inner');
    this.txtEl = root.querySelector('.lcd-text');
    this.scrollL = root.querySelector('.lcd-scroll-l');
    this.scrollR = root.querySelector('.lcd-scroll-r');
    this.scrollX = 0;
  }

  Renderer.prototype.render = function (sc) {
    var r = this.root;
    r.className = r.className.replace(/\s*lcd-(off|kind-\w+|line|math|res-line|rows|eqn-edit)\b/g, '');
    // CONTRAST setting 0..10: default 5 -> .95 (11차: darker ink), 0 -> .70, 9..10 -> 1
    r.style.setProperty('--ink-alpha', String(Math.min(1, 0.70 + (sc.contrast == null ? 5 : sc.contrast) * 0.05)));
    if (!sc.power) {
      r.className += ' lcd-off';
      this.indEl.innerHTML = '';
      this.inInner.innerHTML = '';
      this.outInner.innerHTML = '';
      this.txtEl.innerHTML = '';
      return;
    }
    r.className += ' lcd-kind-' + sc.kind + (sc.lineMode ? ' lcd-line' : ' lcd-math');
    this.indEl.innerHTML = indicatorsHTML(sc.indicators);
    var inHTML = '', outHTML = '', txt = null;

    switch (sc.kind) {
      case 'input':
        inHTML = rowHTML(sc.expr, [], { cursor: sc.cursor, lineMode: sc.lineMode }, false);
        if (!sc.expr.length && sc.cursor) inHTML = CURSOR.replace('cur"', 'cur ' + sc.cursor.style + '"');
        break;
      case 'result':
        inHTML = rowHTML(sc.expr || [], [], { cursor: null, lineMode: sc.lineMode }, false);
        if (sc.resultRows) {
          // CMPLX LineIO/LineO: a / bi (or r / ∠θ) on separate rows, right-aligned
          outHTML = sc.resultRows.map(function (n) { return '<span class="rrow">' + nodeHTML(n) + '</span>'; }).join('');
          r.className += ' lcd-rows';
        } else outHTML = nodeHTML(sc.result);
        if (sc.resultLine) r.className += ' lcd-res-line';
        break;
      case 'prompt':
        if (sc.promptLabel && sc.expr) {
          inHTML = esc(sc.promptLabel);
          outHTML = sc.promptValue != null ? nodeHTML(sc.promptValue) + CURSOR.replace('cur"', 'cur bar"')
            : rowHTML(sc.expr, [], { cursor: sc.cursor, lineMode: true }, false);
          if (sc.promptValue == null && !sc.expr.length) outHTML = CURSOR.replace('cur"', 'cur bar"');
        } else txt = sc.lines;
        break;
      case 'eqn':
        if (sc.eqn && sc.eqn.sub === 'edit') {
          // coefficient grid: drawn in the text layer, nothing on the input/result lines
          this.inInner.innerHTML = '';
          this.outInner.innerHTML = '';
          this.txtEl.innerHTML = eqnEditHTML(sc.eqn, sc.lineMode);
          r.className += ' lcd-eqn-edit';
          this.scrollL.className = 'lcd-scroll-l' + (sc.eqn.moreLeft ? ' on' : '');
          this.scrollR.className = 'lcd-scroll-r' + (sc.eqn.moreRight ? ' on' : '');
          return;
        }
        if (sc.eqn && sc.eqn.sub === 'sol') {
          // solution: label (X1=) on the top line, value right-aligned below (spec B-3 권장)
          inHTML = esc(sc.eqn.label);
          if (sc.eqn.rows) {
            outHTML = sc.eqn.rows.map(function (n) { return '<span class="rrow">' + nodeHTML(n) + '</span>'; }).join('');
            r.className += ' lcd-rows';
          } else outHTML = nodeHTML(sc.eqn.node);
          if (sc.eqn.lineOut) r.className += ' lcd-res-line';
          break;
        }
        txt = sc.lines;     // equation type menu (4 lines, EQN_1.png)
        break;
      case 'message':
        if (sc.solve) {
          inHTML = rowHTML(sc.solve.expr, [], { cursor: null, lineMode: false }, false);
          txt = null;
          outHTML = sc.solve.rows.map(function (row) {
            return '<span class="srow"><span class="sl">' + esc(row.label) + '</span><span class="sv">' + nodeHTML(row.value) + '</span></span>';
          }).join('');
          r.className += ' lcd-kind-solve';
        } else txt = sc.lines;
        break;
      default:
        txt = sc.lines;
    }

    if (txt) {
      this.inInner.innerHTML = '';
      this.outInner.innerHTML = '';
      this.txtEl.innerHTML = txt.map(function (l) { return '<div class="tl">' + (esc(l) || '&nbsp;') + '</div>'; }).join('');
      this.scrollL.className = 'lcd-scroll-l';
      this.scrollR.className = 'lcd-scroll-r';
      return;
    }
    this.txtEl.innerHTML = '';
    this.inInner.innerHTML = inHTML;
    this.outInner.innerHTML = outHTML;
    this._scroll(sc);
  };

  // keep the cursor visible on the input line (auto right scroll, ◀ indicator)
  Renderer.prototype._scroll = function (sc) {
    var box = this.inEl, inner = this.inInner;
    var W = box.clientWidth;
    var full = inner.scrollWidth;
    var cur = inner.querySelector('.cur');
    var x = this.scrollX;
    if (sc.kind === 'result' || !cur) {
      x = 0;
    } else {
      // both rects include the current translateX, so the difference is the unscrolled offset
      var cx = cur.getBoundingClientRect().left - inner.getBoundingClientRect().left;
      if (cx - x > W - 6) x = cx - W + 6;
      if (cx - x < 0) x = Math.max(0, cx - 12);
      if (full <= W) x = 0;
    }
    this.scrollX = x;
    inner.style.transform = 'translateX(' + (-x) + 'px)';
    this.scrollL.className = 'lcd-scroll-l' + (x > 0 ? ' on' : '');
    this.scrollR.className = 'lcd-scroll-r' + (full - x > W + 1 ? ' on' : '');
  };

  FX.Render = { Renderer: Renderer, rowHTML: rowHTML, nodeHTML: nodeHTML, atomHTML: atomHTML };
})(typeof window !== 'undefined' ? window : globalThis);
