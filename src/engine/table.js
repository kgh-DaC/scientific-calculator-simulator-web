/*
 * CalcEngine TABLE 모드(MODE 7): f(X) 수표 생성.
 * 근거: _workspace/01_spec_table.md (2019판 한글 매뉴얼 62~63쪽, 오류표 68쪽).
 * 브라우저: api.js 다음에 <script src="src/engine/table.js">. Node: index.js 가 불러온다.
 *
 *   tableGenerate(tokens, start, end, step, settings, memory, opts)
 *     -> { ok, error, errorPos, stage, count, rows, lastX }
 *   tableCheck(tokens)            -> { ok, error, errorPos }   f(X) 입력만 검사(= 를 눌렀을 때)
 *   tableParam(tokens, settings, memory) -> evaluate 결과(Start/End/Step 한 칸 계산, COMP 규칙)
 *   TABLE_MAX_ROWS = 30
 *
 * 규칙
 *  - 행마다 evaluate(tokens, settings, {ans, vars:{...vars, X:x}}) 로 계산한다(COMP 규칙).
 *  - X 는 Start + k·Step 을 정확값으로 누적한다(0.1 같은 Step 도 오차 없음).
 *  - X 개수 30 초과 → 'Insufficient MEM' (표 전체 오류, 행 없음).
 *  - Pol, Rec, ∫, d/dx, Σ (fn pol/rec/integ/diff/sum, tpl integ/diff/sum, 템플릿 슬롯 안 포함),
 *    '=' (eq), ':' (colon), 단위 변환 conv (매뉴얼 42쪽, CONST 는 허용) → 'Syntax ERROR' (errorPos = 그 토큰을 포함하는 최상위 토큰 인덱스).
 *  - 개별 X 에서 f(X) 오류 → 그 행만 error 를 갖고(셀 표시 'ERROR'), 표는 ok. [가정]
 *  - 엔진은 memory 를 바꾸지 않는다. 표 생성 뒤 변수 X 에 넣을 값은 lastX (UI 가 저장). [가정]
 */
(function (root) {
  'use strict';
  var CE = root.CalcEngine = root.CalcEngine || {};
  var C = CE._core, FM = CE._format, API = CE._api;

  var MAX_ROWS = 30;
  var BANNED_FN = { pol: 1, rec: 1, integ: 1, diff: 1, sum: 1 };
  var BANNED_TPL = { integ: 1, diff: 1, sum: 1 };

  function fail(kind, pos, stage) {
    return { ok: false, error: kind, errorPos: pos == null ? null : pos, stage: stage || 'f', count: 0, rows: [], lastX: null };
  }

  // 금지 토큰이 들어 있는지(슬롯 재귀)
  function hasBanned(tok) {
    if (!tok) return false;
    if (tok.type === 'fn' && BANNED_FN[tok.name]) return true;
    if (tok.type === 'tpl' && BANNED_TPL[tok.name]) return true;
    if (tok.type === 'eq' || tok.type === 'colon') return true;
    if (tok.type === 'conv') return true;   // 매뉴얼 42쪽: 단위 변환은 BASE-N·TABLE 에서 사용 불가 (CONST 는 허용)
    if (tok.type === 'tpl' && tok.slots) {
      for (var i = 0; i < tok.slots.length; i++) {
        var s = tok.slots[i] || [];
        for (var j = 0; j < s.length; j++) if (hasBanned(s[j])) return true;
      }
    }
    return false;
  }

  function tableCheck(tokens) {
    if (!tokens || !tokens.length) return { ok: false, error: 'Syntax ERROR', errorPos: null };
    for (var i = 0; i < tokens.length; i++) {
      if (hasBanned(tokens[i])) return { ok: false, error: 'Syntax ERROR', errorPos: i };
    }
    return { ok: true, error: null, errorPos: null };
  }

  function realValue(v) {
    v = C.fromInput(v);
    if (C.isC(v)) throw C.CalcError('Math ERROR');
    return v;
  }

  function cellOf(v, settings) {
    var f = FM.formatValue(v, settings, {}, {});
    return { text: f.decimal, node: f.decimalNode };
  }

  function tableGenerate(tokens, start, end, step, settings, memory, opts) {
    var chk = tableCheck(tokens);
    if (!chk.ok) return fail(chk.error, chk.errorPos, 'f');
    var s = {}; for (var k in (settings || {})) s[k] = settings[k];
    s.mode = 'TABLE';
    var ns = API.normSettings(s);
    memory = API.normMemory(memory);
    opts = opts || {};

    var xs = [];
    try {
      var a = realValue(start), b = realValue(end), d = realValue(step);
      // [가정] End < Start, Step <= 0 → Math ERROR. End = Start 는 1행.
      if (C.sign(d) <= 0) return fail('Math ERROR', null, 'range');
      if (C.cmp(b, a) < 0) return fail('Math ERROR', null, 'range');
      var x = a;
      while (C.cmp(x, b) <= 0) {
        if (xs.length >= MAX_ROWS) return fail('Insufficient MEM', null, 'range');
        xs.push(x);
        x = C.add(x, d);
      }
    } catch (e) {
      return fail(API.errKind(e), null, 'range');
    }

    var rows = xs.map(function (xv, i) {
      var vars = {}; for (var n in memory.vars) vars[n] = memory.vars[n];
      vars.X = xv;
      var r = CE.evaluate(tokens, ns, { ans: memory.ans, vars: vars, stat: memory.stat }, opts.evalOpts || {});
      var xc = cellOf(xv, ns);
      var row = { index: i + 1, x: xv, xText: xc.text, xNode: xc.node };
      if (r.ok && C.isC(r.value)) r = { ok: false, error: 'Math ERROR' };
      if (r.ok) {
        row.fx = r.value; row.fxText = r.decimal; row.fxNode = r.decimalNode; row.error = null;
      } else {
        row.fx = null; row.fxText = 'ERROR'; row.fxNode = { type: 'text', value: 'ERROR' }; row.error = r.error;
      }
      return row;
    });
    return { ok: true, error: null, errorPos: null, stage: null, count: rows.length, rows: rows, lastX: xs[xs.length - 1] };
  }

  // Start/End/Step 한 칸: 식 입력 가능(COMP 규칙). 복소수 불가.
  function tableParam(tokens, settings, memory) {
    var s = {}; for (var k in (settings || {})) s[k] = settings[k];
    s.mode = 'TABLE';
    var chk = tableCheck(tokens);
    if (!chk.ok) return { ok: false, error: chk.error, errorPos: chk.errorPos, value: null };
    return CE.evaluate(tokens, s, memory || {}, {});
  }

  CE.tableGenerate = tableGenerate;
  CE.tableCheck = tableCheck;
  CE.tableParam = tableParam;
  CE.TABLE_MAX_ROWS = MAX_ROWS;
  CE.TABLE_DEFAULTS = { start: 1, end: 5, step: 1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
