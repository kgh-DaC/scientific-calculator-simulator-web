/*
 * 공학용계산기 시뮬레이터 - key table.
 * Key names are EXACTLY the "이름" column of _workspace/01_spec_comp.md Part B.
 * handleKey(name) accepts these names (plus a few ASCII aliases, see ALIASES).
 *
 * act: [base, SHIFT, ALPHA] action strings
 *   'a:<id>'  insert atom          't:<type>' insert template (LineIO -> atom)
 *   'v:<X>'   insert variable      other     command handled by calculator.js
 *   'cx:<action>'  action available only in CMPLX mode (ignored elsewhere)
 * cxAct: replaces the base action (no SHIFT/ALPHA) in CMPLX mode (ENG -> i)
 * cx:    CMPLX-mode legend drawn on the key face area (blue)
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};

  // label helpers (HTML)
  var BOX = '<i class="bx"></i>';
  var BOXF = '<i class="bx f"></i>';
  var FRAC_ICON = '<span class="ic-frac">' + BOX + '<i class="bar"></i>' + BOX + '</span>';
  var MIXED_ICON = '<span class="ic-mixed">' + BOXF + '<span class="ic-frac">' + BOX + '<i class="bar"></i>' + BOX + '</span></span>';

  var KEYS = [
    // ---- R1 ----
    { name: 'SHIFT', cap: 'SHIFT', cls: 'k-top k-shift', r: 1, c: 1, act: ['SHIFT'] },
    { name: 'ALPHA', cap: 'ALPHA', cls: 'k-top k-alpha', r: 1, c: 2, act: ['ALPHA'] },
    { name: 'MODE', cap: 'MODE', sh: 'SETUP', cls: 'k-top', r: 1, c: 5, act: ['mode', 'setup'] },
    { name: 'ON', cap: 'ON', cls: 'k-top k-on', r: 1, c: 6, act: ['on'] },
    // ---- R2 ----
    { name: 'CALC', cap: 'CALC', sh: 'SOLVE', al: '=', cls: 'k-top', r: 2, c: 1, act: ['calc', 'solve', 'a:='] },
    { name: '∫', cap: '<span class="ic-int">∫' + BOX + '</span>', sh: '<sup class="ddx">d</sup>/<sub class="ddx">dx</sub>' + BOXF, al: ':', cls: 'k-top', r: 2, c: 2, act: ['t:integ', 't:deriv', 'a::'] },
    { name: 'x⁻¹', cap: '<i class="xv">x</i><sup>−1</sup>', sh: '<i class="xv">x</i>!', cls: 'k-top', r: 2, c: 5, act: ['a:⁻¹', 'a:!'] },
    { name: 'log□', cap: 'log<sub>' + BOXF + '</sub>' + BOX, sh: 'Σ' + BOXF, cls: 'k-top', r: 2, c: 6, act: ['t:logb', 't:sum'] },
    // ---- R3 ----
    { name: 'a b/c', cap: FRAC_ICON, sh: MIXED_ICON, cls: 'k-fn', r: 3, c: 1, act: ['t:frac', 't:mixed'] },
    { name: '√', cap: '√' + BOXF, sh: '<sup>3</sup>√' + BOXF, cls: 'k-fn', r: 3, c: 2, act: ['t:sqrt', 't:cbrt'] },
    { name: 'x²', cap: '<i class="xv">x</i><sup>2</sup>', sh: '<i class="xv">x</i><sup>3</sup>', cls: 'k-fn', r: 3, c: 3, act: ['a:²', 'a:³'] },
    { name: 'x^', cap: '<i class="xv">x</i><sup>' + BOXF + '</sup>', sh: '<sup>' + BOXF + '</sup>√' + BOX, cls: 'k-fn', r: 3, c: 4, act: ['t:pow', 't:nroot'] },
    { name: 'log', cap: 'log', sh: '10<sup>' + BOXF + '</sup>', cls: 'k-fn', r: 3, c: 5, act: ['a:log(', 't:pow10'] },
    { name: 'ln', cap: 'ln', sh: '<i>e</i><sup>' + BOXF + '</sup>', cls: 'k-fn', r: 3, c: 6, act: ['a:ln(', 't:powe'] },
    // ---- R4 ----
    { name: '(−)', cap: '(−)', sh: '∠', al: 'A', cls: 'k-fn', r: 4, c: 1, act: ['a:neg', 'cx:a:∠', 'v:A'] },
    { name: '°′″', cap: '°′″', al: 'B', cls: 'k-fn', r: 4, c: 2, act: ['dms', null, 'v:B'] },
    { name: 'hyp', cap: 'hyp', sh: 'Abs', al: 'C', cls: 'k-fn', r: 4, c: 3, act: ['hyp', 't:abs', 'v:C'] },
    { name: 'sin', cap: 'sin', sh: 'sin<sup>−1</sup>', al: 'D', cls: 'k-fn', r: 4, c: 4, act: ['a:sin(', 'a:sin⁻¹(', 'v:D'] },
    { name: 'cos', cap: 'cos', sh: 'cos<sup>−1</sup>', al: 'E', cls: 'k-fn', r: 4, c: 5, act: ['a:cos(', 'a:cos⁻¹(', 'v:E'] },
    { name: 'tan', cap: 'tan', sh: 'tan<sup>−1</sup>', al: 'F', cls: 'k-fn', r: 4, c: 6, act: ['a:tan(', 'a:tan⁻¹(', 'v:F'] },
    // ---- R5 ----
    { name: 'RCL', cap: 'RCL', sh: 'STO', cls: 'k-fn', r: 5, c: 1, act: ['rcl', 'sto'] },
    { name: 'ENG', cap: 'ENG', sh: '←', cx: '<i>i</i>', cls: 'k-fn', r: 5, c: 2, act: ['eng', 'engL', null], cxAct: 'a:i' },
    { name: '(', cap: '(', sh: '%', cls: 'k-fn', r: 5, c: 3, act: ['a:(', 'a:%'] },
    { name: ')', cap: ')', sh: ',', al: 'X', cls: 'k-fn', r: 5, c: 4, act: ['a:)', 'a:,', 'v:X'] },
    { name: 'S⇔D', cap: 'S⇔D', sh: FRAC_ICON.replace('ic-frac', 'ic-frac sm') + '⇔' + MIXED_ICON.replace('ic-mixed', 'ic-mixed sm'), al: 'Y', cls: 'k-fn', r: 5, c: 5, act: ['sd', 'sdMixed', 'v:Y'] },
    { name: 'M+', cap: 'M+', sh: 'M−', al: 'M', cls: 'k-fn', r: 5, c: 6, act: ['mplus', 'mminus', 'v:M'] },
    // ---- R6 ----
    { name: '7', cap: '7', sh: 'CONST', cls: 'k-num', r: 6, c: 1, act: ['a:7', 'const'] },
    { name: '8', cap: '8', sh: 'CONV', cls: 'k-num', r: 6, c: 2, act: ['a:8', 'conv'] },
    { name: '9', cap: '9', sh: 'CLR', cls: 'k-num', r: 6, c: 3, act: ['a:9', 'clr'] },
    { name: 'DEL', cap: 'DEL', sh: 'INS', cls: 'k-num k-del', r: 6, c: 4, act: ['del', 'ins'] },
    { name: 'AC', cap: 'AC', sh: 'OFF', cls: 'k-num k-del', r: 6, c: 5, act: ['ac', 'off'] },
    // ---- R7 ----
    { name: '4', cap: '4', sh: 'MATRIX', cls: 'k-num', r: 7, c: 1, act: ['a:4', 'modeOnly:MATRIX'] },
    { name: '5', cap: '5', sh: 'VECTOR', cls: 'k-num', r: 7, c: 2, act: ['a:5', 'modeOnly:VECTOR'] },
    { name: '6', cap: '6', cls: 'k-num', r: 7, c: 3, act: ['a:6'] },
    { name: '×', cap: '×', sh: '<i>n</i>P<i>r</i>', cls: 'k-num k-op', r: 7, c: 4, act: ['a:×', 'a:nPr'] },
    { name: '÷', cap: '÷', sh: '<i>n</i>C<i>r</i>', cls: 'k-num k-op', r: 7, c: 5, act: ['a:÷', 'a:nCr'] },
    // ---- R8 ----
    { name: '1', cap: '1', sh: 'STAT', cls: 'k-num', r: 8, c: 1, act: ['a:1', 'modeOnly:STAT'] },
    { name: '2', cap: '2', sh: 'CMPLX', cls: 'k-num', r: 8, c: 2, act: ['a:2', 'cx:cmplxMenu'] },
    { name: '3', cap: '3', sh: 'BASE', cls: 'k-num', r: 8, c: 3, act: ['a:3', 'modeOnly:BASE'] },
    { name: '+', cap: '+', sh: 'Pol', cls: 'k-num k-op', r: 8, c: 4, act: ['a:+', 'a:Pol('] },
    { name: '−', cap: '−', sh: 'Rec', cls: 'k-num k-op', r: 8, c: 5, act: ['a:−', 'a:Rec('] },
    // ---- R9 ----
    { name: '0', cap: '0', sh: 'Rnd', cls: 'k-num', r: 9, c: 1, act: ['a:0', 'a:Rnd('] },
    { name: '.', cap: '•', sh: 'Ran#', al: 'RanInt', cls: 'k-num', r: 9, c: 2, act: ['a:.', 'a:Ran#', 'a:RanInt#('] },
    { name: '×10^x', cap: '×10<sup><i>x</i></sup>', sh: 'π', al: '<i>e</i>', cls: 'k-num', r: 9, c: 3, act: ['a:x10', 'a:π', 'a:e'] },
    { name: 'Ans', cap: 'Ans', sh: 'DRG▸', cls: 'k-num', r: 9, c: 4, act: ['a:Ans', 'drg'] },
    { name: '=', cap: '=', cls: 'k-num', r: 9, c: 5, act: ['exe', 'exeDec'] },
    // ---- REPLAY pad ----
    { name: '▲', pad: 'up', act: ['up'] },
    { name: '▼', pad: 'down', act: ['down'] },
    { name: '◀', pad: 'left', act: ['left'] },
    { name: '▶', pad: 'right', act: ['right'] }
  ];

  var BY_NAME = {};
  KEYS.forEach(function (k) { BY_NAME[k.name] = k; });

  // tolerant aliases (ASCII / alternate glyphs) -> canonical key names
  var ALIASES = {
    '-': '−', '–': '−', '*': '×', 'x': '×', '/': '÷', '(-)': '(−)', '(–)': '(−)', 'neg': '(−)',
    'up': '▲', 'down': '▼', 'left': '◀', 'right': '▶', 'UP': '▲', 'DOWN': '▼', 'LEFT': '◀', 'RIGHT': '▶',
    '↑': '▲', '↓': '▼', '←': '◀', '→': '▶', '◄': '◀', '►': '▶',
    'ab/c': 'a b/c', 'a_b/c': 'a b/c', 'frac': 'a b/c', '▣/▣': 'a b/c',
    'x^-1': 'x⁻¹', 'x-1': 'x⁻¹', 'x^2': 'x²', 'x2': 'x²', 'x■': 'x^', 'xy': 'x^', 'x^y': 'x^',
    'logab': 'log□', 'log_a': 'log□', 'log▫': 'log□', 'log■': 'log□',
    'sqrt': '√', 'S<->D': 'S⇔D', 'S<=>D': 'S⇔D', 'SD': 'S⇔D', 'S↔D': 'S⇔D',
    'EXP': '×10^x', 'x10^x': '×10^x', '×10x': '×10^x', 'x10x': '×10^x', '×10ˣ': '×10^x',
    'DMS': '°′″', "°'\"": '°′″', 'integral': '∫', 'shift': 'SHIFT', 'alpha': 'ALPHA', 'ENTER': '=', 'EXE': '=',
    'ans': 'Ans', 'ANS': 'Ans', 'del': 'DEL', 'ac': 'AC', 'on': 'ON', 'mode': 'MODE', 'rcl': 'RCL', 'eng': 'ENG',
    'calc': 'CALC', 'HYP': 'hyp', 'SIN': 'sin', 'COS': 'cos', 'TAN': 'tan', 'LOG': 'log', 'LN': 'ln'
  };

  function canonical(name) {
    if (name == null) return null;
    name = String(name);
    if (BY_NAME[name]) return name;
    if (ALIASES[name]) return ALIASES[name];
    var t = name.trim();
    if (BY_NAME[t]) return t;
    if (ALIASES[t]) return ALIASES[t];
    return null;
  }

  // variable key mapping for STO / RCL (pressed without ALPHA)
  var VAR_KEYS = { '(−)': 'A', '°′″': 'B', 'hyp': 'C', 'sin': 'D', 'cos': 'E', 'tan': 'F', ')': 'X', 'S⇔D': 'Y', 'M+': 'M' };

  FX.Keys = { KEYS: KEYS, BY_NAME: BY_NAME, ALIASES: ALIASES, canonical: canonical, VAR_KEYS: VAR_KEYS };
})(typeof window !== 'undefined' ? window : globalThis);
