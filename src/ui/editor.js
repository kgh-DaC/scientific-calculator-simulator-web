/*
 * 공학용계산기 시뮬레이터 - expression editor model (DOM-free).
 *
 * The input expression is a tree:
 *   Row  = Array<Node>
 *   Node = { k:'atom', id:string, ... }                    one deletable unit (digit, "sin(", "Ans", "²" ...)
 *        | { k:'tpl',  type:string, slots:Array<Row> }       natural-display template (MathIO only)
 *
 * Cursor = { path: Array<[nodeIndex, slotIndex]>, pos: number }
 *   path walks from the root row into template slots; pos is the insertion index in that row.
 *
 * LineIO never creates templates: every key becomes atoms ("√(", "⌟", "^(" ...).
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};

  /* ---------------- template catalogue ---------------- */
  // slots: number of slots. absorb: slot index that receives the operand left of the cursor
  // (MathIO: "2 a b/c" puts 2 in the numerator). wrapSlot: slot that receives INS-wrapped operand.
  // after: where the cursor goes after absorb/wrap (slot index, or -1 = after the template).
  var TPL = {
    frac:   { slots: 2, absorb: 0, absorbNext: 1, wrapSlot: 0, wrapNext: 1, vert: [[0, 1]] },
    mixed:  { slots: 3, absorb: 0, absorbNext: 1, wrapSlot: 0, wrapNext: 1, vert: [[1, 2]] },
    sqrt:   { slots: 1, wrapSlot: 0, wrapNext: -1 },
    cbrt:   { slots: 1, wrapSlot: 0, wrapNext: -1 },
    nroot:  { slots: 2, absorb: 0, absorbNext: 1, wrapSlot: 1, wrapNext: 0 },  // [index n, radicand]
    pow:    { slots: 1, postfix: true, wrapSlot: 0, wrapNext: -1 },             // x^□ (superscript of preceding)
    pow10:  { slots: 1, wrapSlot: 0, wrapNext: -1 },                            // 10^□
    powe:   { slots: 1, wrapSlot: 0, wrapNext: -1 },                            // e^□
    logb:   { slots: 2, wrapSlot: 1, wrapNext: 0 },                             // log_□(□)  [base, arg]
    abs:    { slots: 1, wrapSlot: 0, wrapNext: -1 },
    integ:  { slots: 3, wrapSlot: 0, wrapNext: 1, vert: [[2, 1]] },             // [f, lower, upper]  (▲ lower→upper)
    deriv:  { slots: 2, wrapSlot: 0, wrapNext: 1 },                             // [f, x=a]
    sum:    { slots: 3, wrapSlot: 0, wrapNext: 1, vert: [[2, 1]] }              // [f, lower, upper]
  };

  // LineIO equivalents of template keys
  var LINE_EQUIV = {
    frac: '⌟', mixed: '⌟', sqrt: '√(', cbrt: '³√(', nroot: 'ˣ√(', pow: '^(', pow10: '10^(',
    powe: 'e^(', logb: 'log(', abs: 'Abs(', integ: '∫(', deriv: 'd/dx(', sum: 'Σ('
  };

  /* ---------------- atom catalogue ---------------- */
  var VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'M', 'X', 'Y'];
  var NUM_CHARS = { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '.': 1 };
  var POSTFIX = { '²': 1, '³': 1, '⁻¹': 1, '!': 1, '%': 1, 'dms': 1, 'drgD': 1, 'drgR': 1, 'drgG': 1 };
  var POWER_POSTFIX = { '²': 1, '³': 1, '⁻¹': 1 };
  var OPERAND = { 'Ans': 1, 'Ran#': 1, 'π': 1, 'e': 1, 'i': 1 };           // 'i': CMPLX imaginary unit
  var INFIX = { '+': 1, '−': 1, '×': 1, '÷': 1, 'nPr': 1, 'nCr': 1, ',': 1, ':': 1, '=': 1, 'x10': 1, '⌟': 1, '∠': 1 };
  var FN_HEADS = ['sin(', 'cos(', 'tan(', 'sin⁻¹(', 'cos⁻¹(', 'tan⁻¹(', 'sinh(', 'cosh(', 'tanh(',
    'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹(', 'log(', 'ln(', 'Abs(', '√(', '³√(', 'ˣ√(', '10^(', 'e^(', '^(',
    '∫(', 'd/dx(', 'Σ(', 'Pol(', 'Rec(', 'Rnd(', 'RanInt#(', 'arg(', 'Conjg('];
  // CMPLX result-format commands (end of expression only): '▶r∠θ', '▶a+bi' -> atomKind 'cmd'
  var CMDS = { '▶r∠θ': 1, '▶a+bi': 1 };
  var FN_SET = {};
  FN_HEADS.forEach(function (f) { FN_SET[f] = 1; });

  function atomKind(id) {
    if (NUM_CHARS[id]) return 'num';
    if (id === '(' || FN_SET[id]) return 'open';
    if (id === ')') return 'close';
    if (POSTFIX[id] || id.indexOf('conv:') === 0) return 'postfix';
    if (OPERAND[id] || VARS.indexOf(id) >= 0 || id.indexOf('const:') === 0) return 'operand';
    if (id === 'neg') return 'prefix';
    if (INFIX[id] !== undefined) return 'infix';
    if (CMDS[id]) return 'cmd';
    if (id.charAt(0) === '→' || id === 'M+' || id === 'M−') return 'display';
    return 'other';
  }

  function atom(id) { return { k: 'atom', id: id }; }
  function tpl(type) {
    var def = TPL[type];
    var slots = [];
    for (var i = 0; i < def.slots; i++) slots.push([]);
    return { k: 'tpl', type: type, slots: slots };
  }

  function cloneRow(row) {
    return row.map(function (n) {
      if (n.k === 'tpl') return { k: 'tpl', type: n.type, slots: n.slots.map(cloneRow) };
      var c = {};
      for (var key in n) c[key] = n[key];
      return c;
    });
  }

  // approximate byte cost (manual: 1 byte per symbol, some functions 3~13 bytes)
  function rowBytes(row) {
    var b = 0;
    row.forEach(function (n) {
      if (n.k === 'tpl') {
        b += 2;
        n.slots.forEach(function (s) { b += rowBytes(s); });
      } else if (n.id.indexOf('const:') === 0 || n.id.indexOf('conv:') === 0) b += 2;
      else b += 1;
    });
    return b;
  }

  var CAPACITY = 99;

  /* ---------------- Editor ---------------- */
  function Editor() {
    this.root = [];
    this.cur = { path: [], pos: 0 };
    this.lineMode = false;     // true in LineIO
    this.overwrite = false;    // LineIO overwrite (SHIFT DEL)
    this.insWrap = false;      // MathIO INS (wrap operand right of cursor)
  }

  Editor.TPL = TPL;
  Editor.LINE_EQUIV = LINE_EQUIV;
  Editor.VARS = VARS;
  Editor.atomKind = atomKind;
  Editor.cloneRow = cloneRow;
  Editor.rowBytes = rowBytes;
  Editor.CAPACITY = CAPACITY;
  Editor.atom = atom;
  Editor.tpl = tpl;

  Editor.prototype.clear = function () {
    this.root = [];
    this.cur = { path: [], pos: 0 };
    this.insWrap = false;
  };

  Editor.prototype.isEmpty = function () { return this.root.length === 0; };

  Editor.prototype.load = function (row, atStart) {
    this.root = cloneRow(row);
    this.cur = { path: [], pos: atStart ? 0 : this.root.length };
    this.insWrap = false;
  };

  Editor.prototype.snapshot = function () { return cloneRow(this.root); };

  Editor.prototype.rowAt = function (path) {
    var row = this.root;
    for (var i = 0; i < path.length; i++) row = row[path[i][0]].slots[path[i][1]];
    return row;
  };

  Editor.prototype.row = function () { return this.rowAt(this.cur.path); };

  Editor.prototype.bytes = function () { return rowBytes(this.root); };
  Editor.prototype.remaining = function () { return CAPACITY - this.bytes(); };

  Editor.prototype.cursorStyle = function () {
    if (this.insWrap) return 'block';
    if (this.remaining() <= 10) return 'full';
    if (this.overwrite && this.lineMode) return 'under';
    return 'bar';
  };

  /* ---- insertion ---- */
  Editor.prototype._prevAtom = function () {
    var row = this.row();
    var p = this.cur.pos;
    return p > 0 ? row[p - 1] : null;
  };

  Editor.prototype.insertAtom = function (id) {
    if (this.remaining() <= 0) return false;
    var prev = this._prevAtom();
    // x², x³, x⁻¹ and x^ cannot be entered consecutively in MathIO (manual: "2 x² x²" ignores the last x²)
    if (!this.lineMode && POWER_POSTFIX[id] && prev &&
        ((prev.k === 'atom' && POWER_POSTFIX[prev.id]) || (prev.k === 'tpl' && prev.type === 'pow'))) {
      return false;
    }
    if (this.insWrap) this.insWrap = false;
    var row = this.row();
    var a = atom(id);
    if (this.lineMode && this.overwrite && this.cur.pos < row.length) {
      row[this.cur.pos] = a;
    } else {
      row.splice(this.cur.pos, 0, a);
    }
    this.cur.pos++;
    return true;
  };

  // find start index of the operand ending at index `end` (exclusive) in `row`
  function operandStartLeft(row, end) {
    var i = end;
    // trailing postfix / power templates belong to the operand
    while (i > 0) {
      var n = row[i - 1];
      if ((n.k === 'atom' && atomKind(n.id) === 'postfix') || (n.k === 'tpl' && TPL[n.type].postfix)) i--;
      else break;
    }
    if (i === 0) return i;
    var m = row[i - 1];
    if (m.k === 'tpl') return i - 1;
    var kind = atomKind(m.id);
    if (kind === 'num') {
      while (i > 0 && row[i - 1].k === 'atom' && atomKind(row[i - 1].id) === 'num') i--;
      return i;
    }
    if (kind === 'close') {
      var depth = 0;
      for (var j = i - 1; j >= 0; j--) {
        var x = row[j];
        if (x.k !== 'atom') continue;
        var kk = atomKind(x.id);
        if (kk === 'close') depth++;
        else if (kk === 'open') { depth--; if (depth === 0) return j; }
      }
      return 0;
    }
    if (kind === 'operand') return i - 1;
    return end; // nothing absorbable (operator, open paren ...)
  }

  function operandEndRight(row, start) {
    var i = start;
    if (i >= row.length) return i;
    var n = row[i];
    if (n.k === 'atom' && n.id === 'neg') i++;
    if (i >= row.length) return i;
    n = row[i];
    if (n.k === 'tpl') i++;
    else {
      var kind = atomKind(n.id);
      if (kind === 'num') {
        while (i < row.length && row[i].k === 'atom' && atomKind(row[i].id) === 'num') i++;
      } else if (kind === 'open') {
        var depth = 0;
        for (; i < row.length; i++) {
          var x = row[i];
          if (x.k !== 'atom') continue;
          var kk = atomKind(x.id);
          if (kk === 'open') depth++;
          else if (kk === 'close') { depth--; if (depth === 0) { i++; break; } }
        }
      } else if (kind === 'operand') i++;
      else return start;
    }
    while (i < row.length) {
      var y = row[i];
      if ((y.k === 'atom' && atomKind(y.id) === 'postfix') || (y.k === 'tpl' && TPL[y.type].postfix)) i++;
      else break;
    }
    return i;
  }

  Editor.operandStartLeft = operandStartLeft;
  Editor.operandEndRight = operandEndRight;

  Editor.prototype.insertTemplate = function (type) {
    if (this.lineMode) {
      return this.insertAtom(LINE_EQUIV[type]);
    }
    if (this.remaining() <= 2) return false;
    var def = TPL[type];
    var prev = this._prevAtom();
    if (type === 'pow' && prev && ((prev.k === 'atom' && POWER_POSTFIX[prev.id]) || (prev.k === 'tpl' && prev.type === 'pow'))) {
      return false; // consecutive x^ not allowed
    }
    // nesting depth limit (manual: too deep nesting is refused)
    if (this.cur.path.length >= 7) return false;
    var row = this.row();
    var t = tpl(type);
    var p = this.cur.pos;
    var basePath = this.cur.path.slice();

    if (this.insWrap && def.wrapSlot !== undefined) {
      this.insWrap = false;
      var end = operandEndRight(row, p);
      var taken = row.splice(p, end - p);
      t.slots[def.wrapSlot] = taken;
      row.splice(p, 0, t);
      if (def.wrapNext === -1) {
        this.cur = { path: basePath, pos: p + 1 };
      } else {
        basePath.push([p, def.wrapNext]);
        this.cur = { path: basePath, pos: t.slots[def.wrapNext].length };
      }
      return true;
    }
    this.insWrap = false;

    if (def.absorb !== undefined) {
      var s = operandStartLeft(row, p);
      if (s < p) {
        var absorbed = row.splice(s, p - s);
        t.slots[def.absorb] = absorbed;
        row.splice(s, 0, t);
        basePath.push([s, def.absorbNext]);
        this.cur = { path: basePath, pos: 0 };
        return true;
      }
    }
    row.splice(p, 0, t);
    basePath.push([p, 0]);
    this.cur = { path: basePath, pos: 0 };
    return true;
  };

  /* ---- deletion ---- */
  Editor.prototype.del = function () {
    if (this.insWrap) { this.insWrap = false; }
    var row = this.row();
    var p = this.cur.pos;
    if (this.lineMode && this.overwrite && p < row.length) {
      row.splice(p, 1);
      return true;
    }
    if (p > 0) {
      row.splice(p - 1, 1);
      this.cur.pos = p - 1;
      return true;
    }
    if (this.cur.path.length > 0) {
      // at the start of a slot: remove the template, keep its contents
      var path = this.cur.path.slice();
      var last = path.pop();
      var parent = this.rowAt(path);
      var t = parent[last[0]];
      var flat = [];
      var offset = 0;
      for (var i = 0; i < t.slots.length; i++) {
        if (i === last[1]) offset = flat.length;
        flat = flat.concat(t.slots[i]);
      }
      Array.prototype.splice.apply(parent, [last[0], 1].concat(flat));
      this.cur = { path: path, pos: last[0] + offset };
      return true;
    }
    return false;
  };

  /* ---- cursor movement ---- */
  // returns 'wrap' when the cursor jumped around the root row ends
  Editor.prototype.right = function () {
    var row = this.row();
    var p = this.cur.pos;
    this.insWrap = false;
    if (p < row.length) {
      var n = row[p];
      if (n.k === 'tpl' && !this.lineMode) {
        this.cur.path.push([p, 0]);
        this.cur.pos = 0;
      } else this.cur.pos = p + 1;
      return 'move';
    }
    if (this.cur.path.length === 0) {
      if (this.lineMode) return 'end';
      this.cur.pos = 0;
      return 'wrap';
    }
    var last = this.cur.path[this.cur.path.length - 1];
    var parent = this.rowAt(this.cur.path.slice(0, -1));
    var t = parent[last[0]];
    if (last[1] + 1 < t.slots.length) {
      this.cur.path[this.cur.path.length - 1] = [last[0], last[1] + 1];
      this.cur.pos = 0;
    } else {
      this.cur.path.pop();
      this.cur.pos = last[0] + 1;
    }
    return 'move';
  };

  Editor.prototype.left = function () {
    var row = this.row();
    var p = this.cur.pos;
    this.insWrap = false;
    if (p > 0) {
      var n = row[p - 1];
      if (n.k === 'tpl' && !this.lineMode) {
        var si = n.slots.length - 1;
        this.cur.path.push([p - 1, si]);
        this.cur.pos = n.slots[si].length;
      } else this.cur.pos = p - 1;
      return 'move';
    }
    if (this.cur.path.length === 0) {
      if (this.lineMode) return 'start';
      this.cur.pos = row.length;
      return 'wrap';
    }
    var last = this.cur.path[this.cur.path.length - 1];
    var parent = this.rowAt(this.cur.path.slice(0, -1));
    var t = parent[last[0]];
    if (last[1] > 0) {
      this.cur.path[this.cur.path.length - 1] = [last[0], last[1] - 1];
      this.cur.pos = t.slots[last[1] - 1].length;
    } else {
      this.cur.path.pop();
      this.cur.pos = last[0];
    }
    return 'move';
  };

  // vertical move inside fraction / mixed / integral / sum templates. dir: -1 up, +1 down
  Editor.prototype.vertical = function (dir) {
    if (this.lineMode) {
      this.cur = { path: [], pos: dir < 0 ? 0 : this.root.length };
      return true;
    }
    for (var d = this.cur.path.length - 1; d >= 0; d--) {
      var seg = this.cur.path[d];
      var parent = this.rowAt(this.cur.path.slice(0, d));
      var t = parent[seg[0]];
      var def = TPL[t.type];
      if (!def.vert) continue;
      for (var i = 0; i < def.vert.length; i++) {
        var pair = def.vert[i]; // [upper, lower] slot indices (down: pair[0] -> pair[1])
        var target = -1;
        if (dir > 0 && seg[1] === pair[0]) target = pair[1];
        if (dir < 0 && seg[1] === pair[1]) target = pair[0];
        if (target >= 0) {
          var newPath = this.cur.path.slice(0, d);
          newPath.push([seg[0], target]);
          var len = t.slots[target].length;
          var pos = d === this.cur.path.length - 1 ? Math.min(this.cur.pos, len) : len;
          this.cur = { path: newPath, pos: pos };
          this.insWrap = false;
          return true;
        }
      }
    }
    return false;
  };

  // `)` inside a root template (√, ³√, ˣ√ radicand) with no unmatched `(` before the cursor in that slot:
  // leave the template like ▶ instead of inserting `)` (manual EQN example 4 key sequence "√ 2 )",
  // _workspace/01_spec_eqn.md Part D note / Q10). Returns true when the cursor moved out.
  // Used by EQN coefficient cells only (COMP keeps inserting `)`, pending spec-analyst decision).
  var CLOSE_EXITS = { sqrt: [0], cbrt: [0], nroot: [1] };
  Editor.prototype.closeTemplate = function () {
    if (this.lineMode || !this.cur.path.length) return false;
    var last = this.cur.path[this.cur.path.length - 1];
    var parentPath = this.cur.path.slice(0, -1);
    var t = this.rowAt(parentPath)[last[0]];
    var slots = t && CLOSE_EXITS[t.type];
    if (!slots || slots.indexOf(last[1]) < 0) return false;
    var row = this.row(), depth = 0;
    for (var i = 0; i < this.cur.pos; i++) {
      var n = row[i];
      if (n.k !== 'atom') continue;
      var k = atomKind(n.id);
      if (k === 'open') depth++;
      else if (k === 'close' && depth > 0) depth--;
    }
    if (depth > 0) return false;
    this.insWrap = false;
    this.cur = { path: parentPath, pos: last[0] + 1 };
    return true;
  };

  Editor.prototype.home = function () { this.cur = { path: [], pos: 0 }; };
  Editor.prototype.end = function () { this.cur = { path: [], pos: this.root.length }; };

  // place cursor in the root row right after node index i (used for error "Goto")
  Editor.prototype.setCursor = function (path, pos) {
    this.cur = { path: path.slice(), pos: pos };
  };

  /* ---- variables used in expression (CALC / SOLVE) ---- */
  Editor.collectVars = function (row, out) {
    out = out || [];
    row.forEach(function (n) {
      if (n.k === 'tpl') n.slots.forEach(function (s) { Editor.collectVars(s, out); });
      else if (VARS.indexOf(n.id) >= 0 && out.indexOf(n.id) < 0) out.push(n.id);
    });
    return out;
  };

  FX.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
