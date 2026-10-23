/*
 * 공학용계산기 시뮬레이터 - page wiring: keypad DOM, mouse / keyboard input, LCD refresh.
 *
 * Globals for QA / tutorials:
 *   handleKey(name)        one key press (names = src/ui/keys.js, spec Part B "이름")
 *   pressKeys('1 + 2 =')   key sequence (array or space separated)
 *   getCalcState()         FX.Calculator#getState()
 *   FX.calc                the Calculator instance
 */
(function (G) {
  'use strict';
  var FX = G.FX;
  var doc = G.document;

  /* ---------------- keypad ---------------- */
  function legendHTML(k) {
    var s = k.sh ? '<span class="lg-s">' + k.sh + '</span>' : '';
    var a = k.al ? '<span class="lg-a">' + k.al + '</span>' : '';
    if (k.cx) a += '<span class="lg-c">' + k.cx + '</span>';   // CMPLX-mode legend (ENG: i)
    return '<div class="leg' + (s && a ? ' both' : '') + '">' + s + a + '</div>';
  }

  function keyEl(k) {
    var w = doc.createElement('div');
    w.className = 'kw';
    w.style.gridRow = String(k.gridRow);
    w.style.gridColumn = String(k.c);
    w.innerHTML = legendHTML(k) +
      '<button type="button" class="key ' + k.cls + '" data-key="' + k.name.replace(/"/g, '&quot;') + '" title="' + k.name.replace(/"/g, '&quot;') + '">' +
      '<span class="cap">' + k.cap + '</span></button>';
    return w;
  }

  function buildKeypad(root) {
    var top = root.querySelector('.kp-top');
    var fn = root.querySelector('.kp-fn');
    var num = root.querySelector('.kp-num');
    FX.Keys.KEYS.forEach(function (k) {
      if (k.pad) return;
      if (k.r <= 2) { k.gridRow = k.r; top.appendChild(keyEl(k)); }
      else if (k.r <= 5) { k.gridRow = k.r - 2; fn.appendChild(keyEl(k)); }
      else { k.gridRow = k.r - 5; num.appendChild(keyEl(k)); }
    });
    var pad = doc.createElement('div');
    pad.className = 'pad';
    pad.innerHTML =
      '<button type="button" class="pk pk-up" data-key="▲" title="▲"><span>▲</span></button>' +
      '<button type="button" class="pk pk-left" data-key="◀" title="◀"><span>◀</span></button>' +
      '<div class="pad-c">REPLAY</div>' +
      '<button type="button" class="pk pk-right" data-key="▶" title="▶"><span>▶</span></button>' +
      '<button type="button" class="pk pk-down" data-key="▼" title="▼"><span>▼</span></button>';
    top.appendChild(pad);
  }

  function flash(name) {
    var btn = doc.querySelector('[data-key="' + String(name).replace(/"/g, '\\"') + '"]');
    if (!btn) return;
    btn.classList.add('pressed');
    setTimeout(function () { btn.classList.remove('pressed'); }, 110);
  }

  /* ---------------- keyboard ---------------- */
  // PC key -> calculator key (or key sequence)
  var KB = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    '.': '.', '+': '+', '-': '−', '*': '×', '/': '÷', '(': '(', ')': ')',
    'Enter': '=', '=': '=', 'Backspace': 'DEL', 'Delete': 'DEL', 'Escape': 'AC',
    'ArrowUp': '▲', 'ArrowDown': '▼', 'ArrowLeft': '◀', 'ArrowRight': '▶',
    '^': 'x^', 's': 'sin', 'c': 'cos', 't': 'tan', 'l': 'log', 'n': 'ln', 'r': '√', 'q': 'x²', 'i': 'x⁻¹',
    'f': 'a b/c', 'h': 'hyp', 'a': 'Ans', 'k': '×10^x', 'm': 'MODE', 'o': 'ON', 'd': 'S⇔D', 'g': 'ENG',
    'Insert': ['SHIFT', 'DEL'], '%': ['SHIFT', '('], ',': ['SHIFT', ')'], ':': ['ALPHA', '∫'],
    '!': ['SHIFT', 'x⁻¹'], 'p': ['SHIFT', '×10^x'], 'e': ['ALPHA', '×10^x'],
    'A': ['ALPHA', '(−)'], 'B': ['ALPHA', '°′″'], 'C': ['ALPHA', 'hyp'], 'D': ['ALPHA', 'sin'], 'E': ['ALPHA', 'cos'],
    'F': ['ALPHA', 'tan'], 'M': ['ALPHA', 'M+'], 'X': ['ALPHA', ')'], 'Y': ['ALPHA', 'S⇔D'], '~': '(−)', '_': '(−)'
  };

  function installKeyboard(calc) {
    var tap = null;   // 'Shift' | 'Control' pressed alone -> SHIFT / ALPHA
    doc.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Shift' || e.key === 'Control') { if (!e.repeat) tap = e.key; return; }
      tap = null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var m = KB[e.key];
      if (!m) return;
      e.preventDefault();
      (Array.isArray(m) ? m : [m]).forEach(function (k) { calc.handleKey(k); flash(k); });
    });
    doc.addEventListener('keyup', function (e) {
      if ((e.key === 'Shift' || e.key === 'Control') && tap === e.key) {
        var k = e.key === 'Shift' ? 'SHIFT' : 'ALPHA';
        calc.handleKey(k);
        flash(k);
      }
      tap = null;
    });
    G.addEventListener('blur', function () { tap = null; });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var calc = new FX.Calculator();
    FX.calc = calc;
    G.handleKey = function (k) { return calc.handleKey(k); };
    G.pressKeys = function (seq) { return calc.pressKeys(seq); };
    G.getCalcState = function () { return calc.getState(); };

    var body = doc.querySelector('.calc');
    buildKeypad(body);
    var renderer = new FX.Render.Renderer(doc.querySelector('.lcd'));
    var debug = doc.querySelector('.state-line');
    var badge = doc.querySelector('.engine-badge');
    if (badge) {
      // real engine: no badge. Fallback only: show a warning badge.
      if (FX.Adapter.hasEngine()) {
        badge.textContent = '';
        badge.className = 'engine-badge';
        badge.style.display = 'none';
      } else {
        badge.textContent = 'engine: fallback (src/ui/fallback-engine.js, 부동소수 근사)';
        badge.className = 'engine-badge fb';
        badge.style.display = '';
      }
    }

    function refresh() {
      renderer.render(calc.getScreen());
      if (debug) {
        var st = calc.getState();
        debug.textContent = 'state=' + st.state + '  screen=' + st.screen + (st.menu ? '  menu=' + st.menu : '') +
          '  expr=' + st.expr + (st.result != null ? '  result=' + st.result : '') + (st.error ? '  error=' + st.error : '');
      }
    }
    calc.onChange(refresh);

    body.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('[data-key]');
      if (!btn) return;
      e.preventDefault();
      btn.classList.add('pressed');
      calc.handleKey(btn.getAttribute('data-key'));
    });
    var release = function () {
      var p = body.querySelectorAll('.pressed');
      for (var i = 0; i < p.length; i++) p[i].classList.remove('pressed');
    };
    doc.addEventListener('pointerup', release);
    doc.addEventListener('pointercancel', release);
    installKeyboard(calc);
    G.addEventListener('resize', refresh);
    refresh();
  }

  // scripts sit at the end of <body>: boot right away so handleKey exists for any later inline script
  if (doc.readyState === 'loading' && !doc.querySelector('.calc .kp-num')) doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
