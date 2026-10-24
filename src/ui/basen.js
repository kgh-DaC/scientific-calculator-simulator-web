/*
 * 공학용계산기 시뮬레이터 - BASE-N mode (MODE 4) UI: number base keys, A~F, SHIFT 3 logic menu, base label.
 * Extends FX.Calculator (src/ui/calculator.js must be loaded first). DOM-free.
 * Spec: _workspace/01_spec_basen.md (한글 매뉴얼 2019판 53~56쪽). Engine: FX.Adapter.baseRun / baseConvert / baseZero
 * (src/engine/basen.js CalcEngine.evaluateBase / baseConvert / baseZero). The UI never computes or pads values:
 * results and the 0 line are the engine's fixed-width strings (DEC no padding, HEX 8, BIN 16, OCT 11).
 *
 * this.basen = { radix: 'DEC'|'HEX'|'BIN'|'OCT' }. BASE-N uses the normal input / result screens and editor
 * (LineIO forced on MODE 4, see calculator.js MODE menu).
 *
 * Keys in BASE-N (src/ui/keys.js bnAct, resolved in calculator.js resolveAction):
 *   x² = DEC, x^ = HEX, log = BIN, ln = OCT (no SHIFT)            [확인 p.53]
 *   (−) °′″ hyp sin cos tan = hex digits A B C D E F (no ALPHA)     [확인 p.54]
 *   SHIFT 3 (BASE) = menu 1:and 2:or 3:xor 4:xnor 5:Not 6:Neg, ▼ page 2 1:d 2:h 3:b 4:o   [확인 p.54~55, 화면 모양 미확인]
 * Manual-confirmed: MODE 4 starts in Dec with 0 on the result line; a base key on a result converts the shown
 *   value (555 -> 0000022B -> 0000001000101011 -> 00000001053); the base label is a word (Dec Hex Bin Oct) at
 *   the top right of the screen.
 * [가정] (spec 10 미확인):
 *   - a base key on the input screen deletes the expression being typed and shows the new base's 0
 *   - the 0 of the current base stays on the result line while an expression is typed (input screen)
 *   - digit keys are accepted in every base; digits the base does not have (2 in Bin, A~F in Dec) give
 *     Syntax ERROR on `=` (engine). A~F keys always enter hex digits in BASE-N, also in Dec / Bin / Oct
 *     (needed after the h prefix). Negative numbers: − key at the start, Neg(, or two's complement digits.
 *   - keys of functions BASE-N does not have are ignored: `.`, ×10^x, π, e, fraction / √ / power / log keys,
 *     SHIFT functions of the base keys (x³, ˣ√, 10^x, e^x), trig / hyp, °′″, ENG, S⇔D, %, !, x⁻¹, nPr, nCr,
 *     Pol, Rec, Rnd, Ran#, RanInt#, Abs, ∫, d/dx, Σ, CALC, SOLVE, CONST, CONV (manual p.40 / p.42), DRG, `:`, `=`
 *   - SHIFT = works like =; ALPHA variables, STO, RCL, M+ / M− work (engine keeps integers)
 *   - the base is kept over OFF/ON; MODE 4 (also inside BASE-N) starts again in Dec
 *   - a base key on a result outside the BIN range (e.g. 40000 -> BIN) shows Math ERROR
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var Calculator = FX.Calculator;
  if (!Calculator) return;

  var LABEL = { DEC: 'Dec', HEX: 'Hex', BIN: 'Bin', OCT: 'Oct' };
  var LOGIC_ATOMS = ['and', 'or', 'xor', 'xnor', 'Not(', 'Neg('];         // SHIFT 3, page 1
  var PREFIX_ATOMS = ['rdx:d', 'rdx:h', 'rdx:b', 'rdx:o'];                // SHIFT 3 ▼, page 2
  var OK_ATOMS = { '+': 1, '−': 1, '×': 1, '÷': 1, '(': 1, ')': 1, 'Ans': 1,
    'and': 1, 'or': 1, 'xor': 1, 'xnor': 1, 'Not(': 1, 'Neg(': 1 };
  var OK_CMDS = { left: 1, right: 1, up: 1, down: 1, del: 1, ins: 1, ac: 1, off: 1, exe: 1,
    mode: 1, setup: 1, clr: 1, rcl: 1, sto: 1, mplus: 1, mminus: 1 };

  function okAtom(id) {
    return OK_ATOMS[id] === 1 || /^[0-9]$/.test(id) || /^hx:[A-F]$/.test(id) || /^rdx:[dhbo]$/.test(id);
  }

  // MODE 4 (radix = base to keep, e.g. after OFF/ON; null = Dec)
  Calculator.prototype._baseEnter = function (radix) {
    this.basen = { radix: LABEL[radix] ? radix : 'DEC' };
    this.screen = 'input';
  };

  // BASE-N key filter, called first in _editKey (input / result screens).
  // true = handled or ignored here, false = continue with the normal editing code.
  Calculator.prototype._baseKey = function (name, action, inResult) {
    if (action.indexOf('base:') === 0) { this._baseSwitch(action.slice(5), inResult); return true; }
    if (action === 'modeOnly:BASE') { this._openMenu('base'); return true; }
    if (action === 'exeDec') { this._execute(false); return true; }          // SHIFT = : same as = [가정]
    var kind = action.slice(0, 2);
    if (kind === 'v:') return false;                                         // ALPHA variables
    if (kind === 'a:') return !okAtom(action.slice(2));
    if (kind === 't:') return true;                                          // templates (fraction, √, power ...)
    return !OK_CMDS[action];
  };

  // DEC / HEX / BIN / OCT key
  Calculator.prototype._baseSwitch = function (radix, inResult) {
    var b = this.basen;
    if (!LABEL[radix]) return;
    if (inResult && this.res) {
      // result shown: same value in the new base (manual 55쪽)
      var r = FX.Adapter.baseConvert(this.res.value, radix);
      b.radix = radix;
      if (!r.ok) {
        if (r.missing) return;
        this._showError({ ok: false, error: r.error || 'Math ERROR', errorPos: null }, this.lastExpr || [], 0);
        return;
      }
      var res = this.res;
      res.natural = r.display; res.decimal = r.display; res.shown = r.display;
      res.decimalText = r.text; res.form = 'natural'; res.radix = radix;
      return;
    }
    // input screen: the expression is deleted and the new base starts at 0 [가정]
    b.radix = radix;
    this.ed.clear();
    this._toInput();
  };

  // SHIFT 3 menu (page 1 logic, page 2 prefixes)
  Calculator.prototype._baseMenuKey = function (d) {
    var m = this.menu;
    if (d === null) return;
    var list = m.page === 0 ? LOGIC_ATOMS : PREFIX_ATOMS;
    if (d < 1 || d > list.length) return;
    this._closeMenu(false);
    this._insert('a:' + list[d - 1], this.screen === 'result');
  };

  // engine call for `=`, STO, M+ and RCL in BASE-N
  Calculator.prototype._baseRun = function (tokens, mem) {
    var r = FX.Adapter.baseRun(tokens, this.engineSettings({ base: this.basen.radix }), mem || this.memory);
    if (r.missing) return { ok: false, error: 'No Engine', errorPos: null };
    return r;
  };

  Calculator.prototype._baseZero = function () {
    var z = FX.Adapter.baseZero(this.basen.radix);
    return z == null ? null : { type: 'text', value: z };
  };

  Calculator.prototype._baseState = function () {
    var b = this.basen;
    var z = this._baseZero();
    return { radix: b.radix, label: LABEL[b.radix], zero: z ? z.value : null,
      shown: this.screen === 'input' ? (z ? z.value : null) : (this.screen === 'result' ? this.resultText() : null) };
  };

  // getScreen() additions for render.js: base label on the input / result screens, 0 line on the input screen
  Calculator.prototype._baseScreen = function (sc) {
    if (this.screen !== 'input' && this.screen !== 'result') return;
    sc.baseLabel = LABEL[this.basen.radix];
    if (this.screen === 'input') sc.baseZero = this._baseZero();
  };

  Calculator.BASE_LABEL = LABEL;
  Calculator.BASE_LOGIC_ATOMS = LOGIC_ATOMS;
  Calculator.BASE_PREFIX_ATOMS = PREFIX_ATOMS;
})(typeof window !== 'undefined' ? window : globalThis);
