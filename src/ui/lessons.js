/*
 * 공학용계산기 시뮬레이터 - lesson runner (src/tutorial/lessons.json).
 *
 * Two parts:
 *   FX.Lessons.Runner   DOM-free. Drives one Calculator through a lesson and grades each step.
 *   FX.Lessons.mount()  side-panel UI (only when a document exists).
 *
 * Grading (see _workspace/03_ui_changes.md "레슨 실행기"):
 *   step.expect is a human-readable Korean description ("식 1+2, 결과 3", "3분의 1 ..."), not a
 *   machine format, so it is shown as a guide only. The reference is computed by replaying the
 *   lesson's own key sequences on a hidden Calculator that starts from the same initial state.
 *   After every key the student presses, the student's calculator state fingerprint (screen, menu,
 *   expression, result, error, settings, indicators, variables) is compared with the reference
 *   fingerprint for the end of the current step. Equal -> correct. The student may reach it with a
 *   different key path (e.g. DEL corrections); only the resulting state counts.
 *
 * Every lesson starts from the power-on initial state (COMP, MathO, Deg, Norm1, memory cleared), so
 * lessons whose first step is MODE 2 behave the same every time.
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var Keys = FX.Keys;

  /* ---------------- calculator helpers ---------------- */
  function resetCalc(calc) {
    calc.settings = new FX.Calculator().settings;   // power-on defaults
    calc.reset(true);                                // memory cleared, editor/history/menus cleared
  }

  function stringify(v) {
    return JSON.stringify(v, function (k, x) { return typeof x === 'bigint' ? x.toString() + 'n' : x; });
  }

  // what the student can see / what later steps depend on
  function fingerprint(calc) {
    var s = calc.getState();
    var st = s.settings;
    // ▲/▼ history arrows depend on how many calculations the student made (retries), not on the step
    var ind = {};
    for (var k in s.indicators) if (k !== 'up' && k !== 'down') ind[k] = s.indicators[k];
    // while typing, the cursor position and INS state are what a step like "◀ ◀ ◀ ◀ SHIFT DEL" changes
    // (comp-ins-01 step 2); they only count on screens that show a cursor
    var editing = s.screen === 'input' || (s.screen === 'eqn' && s.eqn && s.eqn.editing);
    return stringify({
      screen: s.screen, menu: s.menu, menuPage: s.menuPage, prompt: s.prompt, mod: s.mod,
      expr: s.expr, result: s.result, resultLines: s.resultLines, error: s.error, lines: s.lines,
      cursor: editing ? s.cursor : null, insertMode: editing ? s.insertMode : null, eqn: s.eqn || null,
      settings: { mode: st.mode, io: st.io, angle: st.angle, format: st.format, fraction: st.fraction, cmplxFormat: st.cmplxFormat },
      indicators: ind,
      memory: calc.memory
    });
  }

  function canon(k) { return Keys.canonical(k) || k; }

  // key names in a lesson that the keypad does not know (lesson data check)
  function validate(lessons) {
    var bad = [];
    (lessons || []).forEach(function (l) {
      (l.steps || []).forEach(function (s, i) {
        (s.keys || []).forEach(function (k) {
          if (!Keys.BY_NAME[k]) bad.push(l.id + ' 단계 ' + (i + 1) + ': ' + k);
        });
      });
    });
    return bad;
  }

  /* ---------------- runner (DOM-free) ---------------- */
  // status: idle | active | wrong | correct | done
  function Runner(calc, lessons) {
    this.calc = calc;
    this.lessons = lessons || [];
    this.lesson = null;
    this.stepIdx = 0;
    this.refs = [];          // fingerprint at the end of each step
    this.refStates = [];     // getState() at the end of each step (debug / QA)
    this.pressed = [];       // keys pressed by the student in the current step
    this.status = 'idle';
    this.recovered = false;  // true right after DEL fixed a wrong key and the student is back on the key sequence
    this.reason = null;      // wrong: 'order' (left the key sequence) | 'result' (all keys pressed, state differs)
    this.busy = false;       // true while the runner itself presses keys
    this.listeners = [];
    var self = this;
    var orig = calc.handleKey;
    calc.handleKey = function (k) {
      var r = orig.apply(calc, arguments);
      if (r && !self.busy) self._onKey(calc.lastKey);
      return r;
    };
  }

  Runner.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Runner.prototype._emit = function () {
    var self = this;
    this.listeners.forEach(function (fn) { try { fn(self); } catch (e) { if (G.console) console.error(e); } });
  };

  Runner.prototype._silent = function (fn) {
    this.busy = true;
    try { fn(); } finally { this.busy = false; }
  };

  Runner.prototype.find = function (id) {
    for (var i = 0; i < this.lessons.length; i++) if (this.lessons[i].id === id) return this.lessons[i];
    return null;
  };

  Runner.prototype.step = function () {
    return this.lesson ? this.lesson.steps[this.stepIdx] || null : null;
  };

  Runner.prototype.start = function (id) {
    var lesson = this.find(id);
    if (!lesson) return false;
    this.lesson = lesson;
    // reference: replay the lesson's keys on a hidden calculator from the same initial state
    var shadow = new FX.Calculator();
    resetCalc(shadow);
    this.refs = [];
    this.refStates = [];
    var self = this;
    lesson.steps.forEach(function (s) {
      shadow.pressKeys(s.keys);
      self.refs.push(fingerprint(shadow));
      self.refStates.push(shadow.getState());
    });
    this._goStep(0);
    return true;
  };

  // put the student's calculator at the start of step i (reset + replay of the earlier steps)
  Runner.prototype._goStep = function (i) {
    var calc = this.calc, steps = this.lesson.steps;
    this._silent(function () {
      resetCalc(calc);
      for (var j = 0; j < i; j++) calc.pressKeys(steps[j].keys);
      calc._emit();
    });
    this.stepIdx = i;
    this.pressed = [];
    this.status = 'active';
    this.reason = null;
    this._emit();
  };

  Runner.prototype.restart = function () { if (this.lesson) this._goStep(0); };
  Runner.prototype.retryStep = function () { if (this.lesson && this.status !== 'done') this._goStep(this.stepIdx); };

  // run the current step's keys for the student, then move on
  Runner.prototype.skipStep = function () {
    if (!this.lesson || this.status === 'done') return;
    var i = this.stepIdx, n = this.lesson.steps.length;
    if (i + 1 >= n) {
      this._goStep(i);
      var calc = this.calc, keys = this.lesson.steps[i].keys;
      this._silent(function () { calc.pressKeys(keys); calc._emit(); });
      this.status = 'done';
      this.reason = null;
      this._emit();
      return;
    }
    this._goStep(i + 1);
  };

  Runner.prototype.next = function () {
    if (!this.lesson || this.status !== 'correct') return;
    this.stepIdx++;
    this.pressed = [];
    this.status = 'active';
    this.reason = null;
    this._emit();
  };

  Runner.prototype.stop = function () {
    this.lesson = null;
    this.status = 'idle';
    this.pressed = [];
    this._emit();
  };

  // is the student's key list still a prefix of the step's key list?
  Runner.prototype.onTrack = function () {
    var s = this.step();
    if (!s) return false;
    if (this.pressed.length > s.keys.length) return false;
    for (var i = 0; i < this.pressed.length; i++) if (canon(s.keys[i]) !== this.pressed[i]) return false;
    return true;
  };

  // number of leading keys of the step the student pressed correctly
  Runner.prototype.matched = function () {
    var s = this.step();
    if (!s) return 0;
    var n = Math.min(this.pressed.length, s.keys.length);
    for (var i = 0; i < n; i++) if (canon(s.keys[i]) !== this.pressed[i]) return i;
    return n;
  };

  // next key the student should press (null when it cannot be told)
  Runner.prototype.nextKey = function () {
    if (!this.lesson) return null;
    if (this.status === 'correct') {
      var ns = this.lesson.steps[this.stepIdx + 1];
      return ns ? canon(ns.keys[0]) : null;
    }
    if (this.status === 'done') return null;
    // left the key sequence: DEL takes back the wrong key(s)
    if (this.status === 'wrong' && this.reason === 'order') return 'DEL';
    if (!this.onTrack()) return null;
    var s = this.step();
    return this.pressed.length < s.keys.length ? canon(s.keys[this.pressed.length]) : null;
  };

  Runner.prototype._onKey = function (name) {
    if (!this.lesson || this.status === 'idle' || this.status === 'done') return;
    if (this.status === 'correct') {
      // pressing on after a correct step starts the next step with that key
      if (this.stepIdx + 1 >= this.lesson.steps.length) return;
      this.stepIdx++;
      this.pressed = [];
    }
    this.recovered = false;
    if (name === 'DEL' && this.status === 'wrong' && this.pressed.length) {
      // DEL after a wrong key: take that key back and judge again from the shorter list
      this.pressed.pop();
      this.recovered = this.onTrack();
    } else {
      this.pressed.push(name);
    }
    var s = this.step();
    if (fingerprint(this.calc) === this.refs[this.stepIdx]) {
      this.status = this.stepIdx + 1 >= this.lesson.steps.length ? 'done' : 'correct';
      this.reason = null;
    } else if (!this.onTrack()) {
      this.status = 'wrong';
      this.reason = 'order';
    } else if (this.pressed.length >= s.keys.length) {
      this.status = 'wrong';
      this.reason = 'result';
    } else {
      this.status = 'active';
      this.reason = null;
    }
    this._emit();
  };

  // QA / tests: reference state at the end of step i
  Runner.prototype.reference = function (i) { return this.refStates[i == null ? this.stepIdx : i] || null; };

  /* ---------------- table of contents model (DOM-free) ---------------- */
  // _workspace/05_curriculum_v2.md "데이터 필드" / "ui-dev 조건".
  // Lesson fields: course, unit, order, minutes, status (public | verify | draft), kind (lesson | check |
  // review), slides. Course / unit titles and order: src/tutorial/toc.json
  //   { version, courses: [{ id, title, units: [{ id, title, slides?, reserved?, note? }] }] }
  var STATUS = { 'public': 1, verify: 1, draft: 1 };
  var KINDS = { lesson: 1, check: 1, review: 1 };
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // public table of contents shows status "public" only (a lesson without status = old data, shown).
  // opts.dev also shows verify / draft (with a badge).
  function visible(l, opts) {
    if (!l.status || l.status === 'public') return true;
    return !!(opts && opts.dev);
  }

  /*
   * buildToc(lessons, toc, opts) -> {
   *   tree: true when grouped by course -> unit (toc.json present and lessons have `unit`),
   *         false = fallback grouping by lesson.mode,
   *   courses: [{ id, no, title, units: [{ id, no, title, reserved, note, minutes,
   *              items: [{ lesson, no, label }] }] }],
   *   order: [lesson ids in display order], byId: { id: item (+ course, unit) }
   * }
   * Numbers come from the sorted display order, never from the array position.
   */
  function buildToc(lessons, toc, opts) {
    lessons = lessons || [];
    var hasUnits = lessons.some(function (l) { return l && l.unit; });
    var courses = toc && Array.isArray(toc.courses) && toc.courses.length ? toc.courses : null;
    var out = { tree: !!(courses && hasUnits), courses: [], order: [], byId: {} };
    var shown = [];
    lessons.forEach(function (l, i) { if (l && visible(l, opts)) shown.push({ l: l, i: i }); });

    function push(course, unit, l) {
      var item = { lesson: l, no: '', label: '' };
      unit.items.push(item);
      return item;
    }

    if (!out.tree) {
      // fallback: group by mode in order of first appearance, numbered 1..N in display order
      var byMode = {}, n = 0;
      shown.forEach(function (x) {
        var m = x.l.mode || '기타';
        if (!byMode[m]) {
          byMode[m] = { id: m, no: '', title: m, units: [{ id: m, no: '', title: m, reserved: false, note: '', minutes: 0, items: [] }] };
          out.courses.push(byMode[m]);
        }
      });
      out.courses.forEach(function (c) {
        shown.forEach(function (x) {
          if ((x.l.mode || '기타') !== c.id) return;
          var it = push(c, c.units[0], x.l);
          it.no = String(++n);
          it.label = c.id + ' · ' + it.no + '번 레슨';
          if (isInt(x.l.minutes)) c.units[0].minutes += x.l.minutes;
        });
      });
    } else {
      var unitIdx = {};
      courses.forEach(function (c, ci) {
        var co = { id: c.id, no: String(ci + 1), title: c.title || c.id, units: [] };
        (c.units || []).forEach(function (u, ui) {
          var un = { id: u.id, no: (ci + 1) + '-' + (ui + 1), title: u.title || u.id, reserved: !!u.reserved,
            note: u.note || '', minutes: 0, items: [], course: co };
          co.units.push(un);
          unitIdx[u.id] = un;
        });
        out.courses.push(co);
      });
      var other = null;    // lessons whose unit is not in toc.json (lessons.check.js reports them)
      var sorted = shown.slice().sort(function (a, b) {
        var oa = isInt(a.l.order) ? a.l.order : 1e9, ob = isInt(b.l.order) ? b.l.order : 1e9;
        return oa - ob || a.i - b.i;
      });
      sorted.forEach(function (x) {
        var un = unitIdx[x.l.unit];
        if (!un) {
          if (!other) {
            var oc = { id: '_other', no: String(out.courses.length + 1), title: '기타', units: [] };
            other = { id: '_other', no: oc.no + '-1', title: '분류 없음', reserved: false, note: '', minutes: 0, items: [], course: oc };
            oc.units.push(other);
            out.courses.push(oc);
          }
          un = other;
        }
        push(un.course, un, x.l);
        if (isInt(x.l.minutes)) un.minutes += x.l.minutes;
      });
      out.courses.forEach(function (co) {
        co.units.forEach(function (un) {
          un.items.forEach(function (it, k) {
            it.no = un.no + '-' + (k + 1);
            it.label = '과정 ' + co.no + ' › ' + un.title + ' › ' + (k + 1);
          });
          delete un.course;
        });
      });
    }
    out.courses.forEach(function (co) {
      co.units.forEach(function (un) {
        un.items.forEach(function (it) {
          out.order.push(it.lesson.id);
          out.byId[it.lesson.id] = { item: it, course: co, unit: un };
        });
      });
    });
    return out;
  }

  // field checks for lessons.check.js (all lessons, public or not). Returns a list of problems.
  function validateMeta(lessons, toc) {
    var bad = [];
    var units = {}, courseIds = {};
    if (!toc || !Array.isArray(toc.courses)) bad.push('toc: courses 배열 없음');
    else toc.courses.forEach(function (c) {
      if (!c.id) bad.push('toc: 과정 id 없음');
      if (courseIds[c.id]) bad.push('toc: 과정 id 중복 ' + c.id);
      courseIds[c.id] = 1;
      (c.units || []).forEach(function (u) {
        if (!u.id) bad.push('toc: ' + c.id + ' 단원 id 없음');
        if (units[u.id]) bad.push('toc: 단원 id 중복 ' + u.id);
        units[u.id] = c.id;
      });
    });
    var seen = {};
    (lessons || []).forEach(function (l) {
      var id = l.id || '(id 없음)';
      ['course', 'unit'].forEach(function (f) {
        if (typeof l[f] !== 'string' || !l[f]) bad.push(id + ': ' + f + ' 없음');
      });
      if (!isInt(l.order) || l.order < 1) bad.push(id + ': order는 1 이상의 정수');
      if (!isInt(l.minutes) || l.minutes < 1) bad.push(id + ': minutes는 정수');
      if (!STATUS[l.status]) bad.push(id + ': status 값 ' + JSON.stringify(l.status) + ' (public | verify | draft)');
      if (l.kind != null && !KINDS[l.kind]) bad.push(id + ': kind 값 ' + JSON.stringify(l.kind) + ' (lesson | check | review)');
      if (l.slides != null && !(Array.isArray(l.slides) && l.slides.every(isInt))) bad.push(id + ': slides는 정수 배열');
      if (l.unit && !units[l.unit]) bad.push(id + ': unit ' + l.unit + ' 이(가) toc에 없음');
      else if (l.unit && l.course && units[l.unit] !== l.course) bad.push(id + ': unit ' + l.unit + ' 은(는) 과정 ' + units[l.unit] + ' 소속 (course ' + l.course + ')');
      if (l.unit && isInt(l.order)) {
        var k = l.unit + '#' + l.order;
        if (seen[k]) bad.push(id + ': ' + l.unit + ' 순서 ' + l.order + ' 중복 (' + seen[k] + ')');
        else seen[k] = id;
      }
    });
    return bad;
  }

  /* ---------------- panel (DOM) ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function plain(html) {
    var d = G.document.createElement('div');
    d.innerHTML = html;
    return d.textContent;
  }

  // key chip: key name, plus the function it selects after SHIFT / ALPHA (or i in CMPLX)
  function chipHTML(keys, i, mode, cls) {
    var k = keys[i], key = Keys.BY_NAME[k], prev = keys[i - 1];
    var sub = '';
    if (key) {
      if (prev === 'SHIFT' && key.sh) sub = plain(key.sh);
      else if (prev === 'ALPHA' && key.al) sub = plain(key.al);
      else if (prev !== 'SHIFT' && prev !== 'ALPHA' && mode === 'CMPLX' && key.cxAct && key.cx) sub = plain(key.cx);
    }
    return '<span class="lk ' + cls + '">' + esc(k) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
  }

  // table-of-contents group captions (lesson.mode)
  var GROUP_NAMES = { COMP: '기본 계산', CMPLX: '복소수', EQN: '방정식', STAT: '통계', 'BASE-N': '진법', MATRIX: '행렬', VECTOR: '벡터', TABLE: '수표' };

  // finished lessons are remembered in localStorage when it is available (file:// included); otherwise
  // only for this page view
  var DONE_KEY = 'fxsim.lessonsDone';
  function loadDone() {
    try { return JSON.parse(G.localStorage.getItem(DONE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveDone(d) {
    try { G.localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
  }

  // cb(lessons, source, toc). toc = src/tutorial/toc.json (null when the file does not exist yet:
  // the table of contents then falls back to grouping by mode)
  function loadLessons(cb) {
    var embedded = G.FX_LESSON_DATA || null;
    var embeddedToc = G.FX_TOC_DATA || null;
    // file:// blocks fetch in Chromium: use the embedded copies (src/ui/lessons-data.js) without trying
    if (!G.fetch || !G.location || G.location.protocol === 'file:') { cb(embedded, 'embedded', embeddedToc); return; }
    function get(url) {
      return G.fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    }
    get('src/tutorial/lessons.json')
      .then(function (d) {
        return get('src/tutorial/toc.json').then(function (t) { cb(d, 'json', t); }, function () { cb(d, 'json', embeddedToc); });
      })
      .catch(function () { cb(embedded, 'embedded', embeddedToc); });
  }

  // ?dev=1: table of contents also shows verify / draft lessons with a badge
  function devMode() {
    try { return /(?:^|[?&])dev=1(?:&|$)/.test(G.location.search || ''); } catch (e) { return false; }
  }

  // last started lesson (shell: "이어서" button). Storage may be unavailable (file://, private mode).
  var LAST_KEY = 'fxsim.lastLesson';
  function loadLast() {
    try { return G.localStorage.getItem(LAST_KEY) || null; } catch (e) { return null; }
  }
  function saveLast(id) {
    try { G.localStorage.setItem(LAST_KEY, id); } catch (e) { /* storage unavailable */ }
  }

  /*
   * Two separate areas inside root (.lesson-panel):
   *   .ls-toc-pane  table of contents (renderToc). A click emits 'fxsim:lesson-select' on root.
   *   .ls-follow    follow-along pane (renderFollow). Listens to 'fxsim:lesson-select' and starts the lesson.
   * Below 1000px the toc collapses (.ls-toc-pane.open), its toggle shows the current lesson.
   * Tree toc: course and unit titles are always shown; each unit's lesson list is folded. The unit title is a
   * button (aria-expanded, ▸ / ▾). When the current lesson changes, only its unit is opened (units the student
   * opened by hand stay open until then). Reserved units ("준비 중") have no button.
   */
  function mount(root, calc) {
    var doc = G.document;
    root.innerHTML =
      '<div class="ls-toc-pane">' +
      '  <h2 class="ls-toc-head">목차</h2>' +
      '  <button type="button" class="ls-toc-toggle" aria-expanded="false" aria-controls="ls-toc">' +
      '    <span class="ls-toc-lbl">목차</span><span class="ls-toc-cur"></span><span class="ls-toc-arrow" aria-hidden="true">▾</span></button>' +
      '  <nav class="ls-toc" id="ls-toc" aria-label="레슨 목차"></nav>' +
      '</div>' +
      '<div class="ls-follow" role="region" aria-label="따라하기">' +
      '<h2>따라하기</h2>' +
      '<div class="ls-empty">' +
      '  <p>목차에서 레슨을 고르세요. 레슨을 시작하면 계산기가 레슨의 시작 상태(COMP, 기본 설정, 메모리 지움)로 바뀝니다.</p>' +
      '  <button type="button" class="ls-btn ls-resume primary" hidden></button>' +
      '</div>' +
      '<div class="ls-body" hidden>' +
      '  <div class="ls-bar"><span class="ls-pos"></span></div>' +
      '  <div class="ls-title"></div><div class="ls-goal"></div>' +
      '  <div class="ls-stepno"></div>' +
      '  <div class="ls-keys" aria-label="눌러야 할 키"></div>' +
      '  <div class="ls-hint"></div>' +
      '  <div class="ls-expect"></div>' +
      '  <div class="ls-status" aria-live="polite"></div>' +
      '  <div class="ls-actions">' +
      '    <button type="button" class="ls-btn ls-show">키 보여주기</button>' +
      '    <button type="button" class="ls-btn ls-retry">이 단계 다시</button>' +
      '    <button type="button" class="ls-btn ls-skip">단계 건너뛰기</button>' +
      '    <button type="button" class="ls-btn ls-restart">처음부터</button>' +
      '    <button type="button" class="ls-btn ls-next primary">다음 단계</button>' +
      '  </div>' +
      '  <details class="ls-pit"><summary>자주 하는 실수</summary><ul></ul></details>' +
      '</div>' +
      '</div>' +
      '<div class="ls-warn"></div>';
    var q = function (c) { return root.querySelector(c); };
    var toc = q('.ls-toc'), body = q('.ls-body'), tocPane = q('.ls-toc-pane'), tocToggle = q('.ls-toc-toggle');
    var follow = q('.ls-follow'), empty = q('.ls-empty'), resume = q('.ls-resume');
    var runner = null;
    var hlKey = null;
    var tocKey = null;         // what the toc was last drawn for (current lesson + finished set)
    var tocData = null;        // src/tutorial/toc.json (null: fallback by mode)
    var model = buildToc([], null);
    var dev = devMode();
    var lastId = loadLast();
    var done = loadDone();     // ids of finished lessons (completion mark)
    var expanded = {};         // unit id -> true: units whose lesson list is open (tree toc)
    var foldFor = null;        // current lesson the fold state was last reset for

    // collapsible toc (narrow screens only; CSS always shows it from 1000px)
    function setTocOpen(open) {
      tocPane.classList.toggle('open', !!open);
      tocToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) scrollTocToCurrent();
    }
    function scrollTocToCurrent() {
      var cur = toc.querySelector('.ls-item.cur');
      if (!cur || !toc.getBoundingClientRect) return;
      var tr = toc.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      if (cr.top < tr.top + 28 || cr.bottom > tr.bottom) toc.scrollTop += cr.top - tr.top - 40;
    }

    function clearHL() {
      var on = doc.querySelectorAll('.hint-key');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('hint-key');
      hlKey = null;
    }
    function showKey() {
      clearHL();
      var k = runner && runner.nextKey();
      if (!k) {
        q('.ls-status').innerHTML = '<span class="bad">누른 키가 안내와 달라 다음 키를 정할 수 없습니다. "이 단계 다시"를 누르세요.</span>';
        return;
      }
      var btn = doc.querySelector('.calc [data-key="' + k.replace(/"/g, '\\"') + '"]');
      if (btn) { btn.classList.add('hint-key'); hlKey = k; }
    }

    // table of contents: course -> unit -> lesson (toc.json), or lessons grouped by mode (fallback).
    // One click on a lesson starts it. Reserved units / units without public lessons: "준비 중" text.
    function itemHTML(it, cur) {
      var l = it.lesson, isCur = l.id === cur, isDone = !!done[l.id];
      var badge = l.status && l.status !== 'public' ? ' <span class="ls-badge">' + (l.status === 'verify' ? '검증 중' : '작성 중') + '</span>' : '';
      var kind = l.kind === 'review' ? ' <span class="ls-kind">종합</span>' : (l.kind === 'check' ? ' <span class="ls-kind">확인</span>' : '');
      var meta = l.steps.length + '단계' + (isInt(l.minutes) ? ' · ' + l.minutes + '분' : '');
      return '<li><button type="button" class="ls-item' + (isCur ? ' cur' : '') + (isDone ? ' done' : '') +
        '" data-id="' + esc(l.id) + '"' + (isCur ? ' aria-current="true"' : '') + '>' +
        '<span class="ls-no">' + esc(it.no) + '</span><span class="ls-name">' + esc(l.title) + kind + badge + '</span>' +
        '<span class="ls-n">' + meta + '</span>' +
        '<span class="ls-chk" aria-label="' + (isDone ? '완료' : '') + '">' + (isDone ? '✓' : '') + '</span></button></li>';
    }
    function renderToc() {
      var lessons = runner ? runner.lessons : [];
      var cur = runner && runner.lesson ? runner.lesson.id : null;
      var curL = runner && runner.lesson ? runner.lesson : null;
      var curE = cur ? model.byId[cur] : null;
      q('.ls-toc-cur').textContent = curL ? '현재: ' + (curE ? curE.item.no + ' ' : '') + curL.title : '레슨 ' + model.order.length + '개';
      var key = (cur || '') + '|' + Object.keys(done).join(',') + '|' + lessons.length + '|' + model.order.length + '|' + model.tree;
      if (key === tocKey) return;      // unchanged: keep the list (and its scroll position)
      tocKey = key;
      toc.setAttribute('data-kind', model.tree ? 'tree' : 'mode');
      if (!model.tree) {
        toc.innerHTML = model.courses.map(function (c) {
          var u = c.units[0];
          return '<section class="ls-grp"><h3>' + esc(c.id) + (GROUP_NAMES[c.id] ? ' <small>' + esc(GROUP_NAMES[c.id]) + '</small>' : '') +
            ' <span class="ls-cnt">' + u.items.length + '</span></h3><ol>' +
            u.items.map(function (it) { return itemHTML(it, cur); }).join('') + '</ol></section>';
        }).join('');
        return;
      }
      // folding: a new current lesson opens its own unit only and drops the units the student opened
      var curUnit = curE ? curE.unit.id : null;
      if (cur && cur !== foldFor) {
        foldFor = cur;
        expanded = {};
        if (curUnit) expanded[curUnit] = true;
      }
      // keep the current lesson's unit title where it was on the screen while the units above fold
      var anchor = curUnit ? unitEl(curUnit) : null;
      var tr0 = toc.getBoundingClientRect && toc.clientHeight ? toc.getBoundingClientRect().top : null;
      var y0 = anchor && tr0 != null ? anchor.getBoundingClientRect().top - tr0 : null;
      toc.innerHTML = model.courses.map(function (c) {
        return '<section class="ls-course"><h3>과정 ' + esc(c.no) + '. ' + esc(c.title) + '</h3>' +
          c.units.map(function (u) {
            if (!u.items.length) {
              // reserved unit (or no public lesson yet): not a button, readable text
              return '<section class="ls-unit ls-reserved"><h4><span class="ls-uno">' + esc(u.no) + '</span> ' + esc(u.title) +
                ' <span class="ls-soon">준비 중</span></h4>' + (u.note && u.note !== '준비 중' ? '<p class="ls-note">' + esc(u.note) + '</p>' : '') + '</section>';
            }
            var open = !!expanded[u.id], lid = 'ls-u-' + u.id.replace(/[^\w-]/g, '_');
            return '<section class="ls-unit' + (open ? ' open' : '') + (u.id === curUnit ? ' has-cur' : '') + '" data-unit="' + esc(u.id) + '">' +
              '<h4 class="ls-uh"><button type="button" class="ls-unit-btn" aria-expanded="' + open + '" aria-controls="' + lid + '">' +
              '<span class="ls-fold" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
              '<span class="ls-ut"><span class="ls-uno">' + esc(u.no) + '</span> ' + esc(u.title) + '</span>' +
              '<span class="ls-cnt">' + u.items.length + '개' + (u.minutes ? ' · ' + u.minutes + '분' : '') + '</span></button></h4>' +
              '<ol id="' + lid + '"' + (open ? '' : ' hidden') + '>' +
              u.items.map(function (it) { return itemHTML(it, cur); }).join('') + '</ol></section>';
          }).join('') + '</section>';
      }).join('');
      if (y0 != null) {
        var a1 = unitEl(curUnit);
        if (a1) toc.scrollTop += a1.getBoundingClientRect().top - toc.getBoundingClientRect().top - y0;
      }
      if (cur && toc.clientHeight) scrollTocToCurrent();
    }
    function unitEl(id) {
      var all = toc.querySelectorAll('.ls-unit[data-unit]');
      for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-unit') === id) return all[i];
      return null;
    }
    // open / fold one unit in place (no redraw: the list keeps its scroll position)
    function setUnitOpen(id, open) {
      var sec = unitEl(id);
      if (!sec) return false;
      open = !!open;
      if (open) expanded[id] = true; else delete expanded[id];
      sec.classList.toggle('open', open);
      var b = sec.querySelector('.ls-unit-btn'), ol = sec.querySelector('ol');
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.querySelector('.ls-fold').textContent = open ? '▾' : '▸';
      ol.hidden = !open;
      return true;
    }

    // lessons / toc data in use (boot, and tests: useData)
    function setData(lessons, t) {
      tocData = t || null;
      runner.lessons = lessons;
      model = buildToc(lessons, tocData, { dev: dev });
      tocKey = null;
      expanded = {};
      foldFor = null;
    }

    function render() {
      renderToc();
      renderFollow();
    }

    function renderFollow() {
      var inLesson = !!(runner && runner.lesson);
      body.hidden = !inLesson;
      empty.hidden = inLesson;
      if (!inLesson) {
        var last = runner && lastId ? runner.find(lastId) : null;
        resume.hidden = !last;
        if (last) { resume.textContent = '이어서: ' + last.title; resume.setAttribute('data-id', last.id); }
        return;
      }
      var l = runner.lesson, n = l.steps.length;
      var done = runner.status === 'done';
      var pe = model.byId[l.id];
      q('.ls-pos').textContent = pe ? pe.item.label : l.mode;
      var idx = Math.min(runner.stepIdx, n - 1);
      var s = l.steps[idx];
      q('.ls-title').textContent = l.title + ' (' + l.mode + ', 단계 ' + n + '개)';
      q('.ls-goal').textContent = l.goal;
      q('.ls-stepno').textContent = '단계 ' + (idx + 1) + ' / ' + n;
      var track = runner.onTrack() || runner.status === 'correct' || done;
      var np = runner.status === 'correct' || done ? s.keys.length : runner.pressed.length;
      var off = !track && runner.status === 'wrong' && runner.reason === 'order';
      var mt = runner.matched();
      var chips = [];
      for (var i = 0; i < s.keys.length; i++) {
        var cls = track && i < np ? 'ok' : (track && i === np ? 'cur' : '');
        if (off) cls = i < mt ? 'ok' : (i === mt ? 'cur miss' : '');
        chips.push(chipHTML(s.keys, i, l.mode, cls));
      }
      q('.ls-keys').innerHTML = chips.join('<span class="lk-sep"> </span>');
      var hint = q('.ls-hint');
      hint.textContent = s.hint || '';
      hint.className = 'ls-hint' + (runner.status === 'wrong' ? ' emph' : '');
      q('.ls-expect').innerHTML = '<b>기대 화면</b> ' + esc(s.expect || '');
      var st = q('.ls-status');
      if (runner.status === 'correct') {
        st.innerHTML = '<span class="good">정답</span> 잠시 후 다음 단계로 넘어갑니다. (바로 가려면 "다음 단계" 또는 다음 키)';
        scheduleAdvance();
      }
      else if (done) {
        var nextId = nextLessonId(l.id);
        st.innerHTML = nextId
          ? '<span class="good">정답, 레슨 완료</span> 잠시 후 다음 레슨으로 넘어갑니다. ("처음부터"로 다시 연습할 수도 있어요.)'
          : '<span class="good">정답, 마지막 레슨 완료</span> 다른 레슨을 고르거나 "처음부터"로 다시 연습하세요.';
        if (nextId) scheduleNextLesson(l.id, nextId);
      }
      else if (runner.status === 'wrong' && runner.reason === 'order') {
        var extra = runner.pressed.length - mt, want = s.keys[mt];
        st.innerHTML = '<span class="bad">' + esc(runner.pressed[runner.pressed.length - 1]) + ' 키는 안내와 다릅니다.</span> ' +
          '<b>DEL</b>(파란 테두리)로 ' + (extra > 1 ? extra + '개를 지운' : '지운') + ' 뒤 ' + (want ? '<b>' + esc(want) + '</b>를 누르세요.' : '이어서 누르세요.') +
          ' 어려우면 "이 단계 다시"를 누르세요.';
      }
      else if (runner.status === 'wrong') st.innerHTML = '<span class="bad">화면이 기대와 다릅니다.</span> 힌트를 보고 "이 단계 다시"로 다시 시도하세요.';
      else if (runner.recovered) st.innerHTML = '<span class="good">고쳤어요.</span> 다시 안내를 따라가고 있어요. 이어서 누르세요.';
      else st.textContent = runner.pressed.length ? '계속 누르세요.' : '계산기 키패드(또는 키보드)로 위의 키를 차례로 누르세요.';
      q('.ls-next').disabled = runner.status !== 'correct';
      q('.ls-skip').disabled = done;
      q('.ls-retry').disabled = done;
      q('.ls-show').disabled = done;
      var ul = root.querySelector('.ls-pit ul');
      ul.innerHTML = (l.pitfalls || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    }

    // a finished lesson moves on to the next one in the table of contents after a pause
    var lessonTimer = null, NEXT_LESSON_MS = 2500;
    function nextLessonId(id) {
      var i = model.order.indexOf(id);
      return i >= 0 && i + 1 < model.order.length ? model.order[i + 1] : null;
    }
    function scheduleNextLesson(id, nextId) {
      if (lessonTimer || !G.setTimeout) return;
      lessonTimer = G.setTimeout(function () {
        lessonTimer = null;
        if (runner.lesson && runner.lesson.id === id && runner.status === 'done') emitSelect(nextId);
      }, NEXT_LESSON_MS);
    }

    // a correct step moves on by itself after a short pause (long enough to read the result)
    var advanceTimer = null, ADVANCE_MS = 1500;
    function scheduleAdvance() {
      if (advanceTimer || !G.setTimeout) return;
      var idx = runner.stepIdx, lesson = runner.lesson;
      advanceTimer = G.setTimeout(function () {
        advanceTimer = null;
        if (runner.lesson !== lesson || runner.status !== 'correct') return;
        if (runner.stepIdx === idx) runner.next();
        else scheduleAdvance();   // the student moved on and solved a later step meanwhile
      }, ADVANCE_MS);
    }

    function act(fn) {
      return function (e) {
        if (e && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();   // Enter must not re-click
        if (runner) fn();
      };
    }

    loadLessons(function (data, src, tdata) {
      var lessons = Array.isArray(data) ? data : [];
      if (!lessons.length) {
        q('.ls-warn').textContent = '레슨 데이터를 읽지 못했습니다 (src/tutorial/lessons.json, src/ui/lessons-data.js).';
        return;
      }
      var bad = validate(lessons);
      if (bad.length) q('.ls-warn').textContent = '키 이름 확인 필요: ' + bad.join(', ');
      runner = new Runner(calc, lessons);
      FX.lessonRunner = runner;
      setData(lessons, tdata);
      root.setAttribute('data-source', src);
      runner.onChange(function () {
        if (runner.lesson && runner.status === 'done' && !done[runner.lesson.id]) { done[runner.lesson.id] = 1; saveDone(done); }
        clearHL(); render(); renderDock();
        // wrong key: light up DEL on the keypad so the way back is visible
        if (runner.status === 'wrong' && runner.reason === 'order') {
          var del = doc.querySelector('.calc [data-key="DEL"]');
          if (del) { del.classList.add('hint-key'); hlKey = 'DEL'; }
        }
      });
      calc.onChange(renderDock);
      render();
    });

    function emitSelect(id) {
      var ev;
      try { ev = new G.CustomEvent('fxsim:lesson-select', { detail: { id: id } }); }
      catch (e) { ev = doc.createEvent('CustomEvent'); ev.initCustomEvent('fxsim:lesson-select', false, false, { id: id }); }
      root.dispatchEvent(ev);
    }

    // toc -> event (the toc does not know how a lesson is run)
    toc.addEventListener('click', function (e) {
      var ub = e.target && e.target.closest ? e.target.closest('.ls-unit-btn') : null;
      if (ub) {
        if (e.detail && ub.blur) ub.blur();          // mouse / touch: a later Enter is '=' again
        var sec = ub.closest('.ls-unit');
        setUnitOpen(sec.getAttribute('data-unit'), ub.getAttribute('aria-expanded') !== 'true');
        return;
      }
      var b = e.target && e.target.closest ? e.target.closest('.ls-item') : null;
      if (!b) return;
      if (b.blur) b.blur();
      emitSelect(b.getAttribute('data-id'));
    });
    // keyboard: Enter on a focused toc button activates it (app.js would otherwise take Enter as '=')
    toc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest('.ls-unit-btn, .ls-item')) e.stopPropagation();
    });
    resume.addEventListener('click', function (e) {
      if (e.currentTarget.blur) e.currentTarget.blur();
      emitSelect(resume.getAttribute('data-id'));
    });
    tocToggle.addEventListener('click', function (e) {
      if (e.detail && e.currentTarget.blur) e.currentTarget.blur();
      setTocOpen(!tocPane.classList.contains('open'));
    });

    // follow pane: start the selected lesson (resets the calculator to the lesson's start state)
    root.addEventListener('fxsim:lesson-select', function (e) {
      var id = e.detail && e.detail.id;
      if (!runner || !id || !runner.start(id)) return;
      lastId = id;
      saveLast(id);
      setTocOpen(false);   // narrow screens: fold the list, the follow pane sits right under the keypad
      revealFollow();
    });

    /* ---- bottom dock (under 600px, lesson running): next keys + calculator expression / result ----
       position: fixed at the bottom. body gets a bottom padding of the dock height so the last keypad
       row can always be scrolled above it; the dock never lies over a key that is visible. */
    var dock = doc.createElement('div');
    dock.className = 'ls-dock';
    dock.hidden = true;
    dock.setAttribute('role', 'region');
    dock.setAttribute('aria-label', '다음에 누를 키와 계산기 화면');
    dock.innerHTML = '<div class="ld-row"><span class="ld-lbl">다음 키</span><div class="ld-keys"></div></div>' +
      '<div class="ld-row"><span class="ld-lbl">화면</span><div class="ld-scr"></div></div>';
    doc.body.appendChild(dock);
    var dockKeys = dock.querySelector('.ld-keys'), dockScr = dock.querySelector('.ld-scr');

    /* dock "화면": one line drawn from calc.getScreen() with render.js's natural notation (fractions, roots,
       mixed numbers, powers, the cursor and its INS / block style), so the line looks like the LCD.
       { html, text: true when it is plain menu text (shrunk to fit one line) } */
    var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
    function subNum(n) { return String(n).replace(/[0-9]/g, function (d) { return SUB[d]; }); }
    function textLine(lines) {
      return { html: (lines || []).map(function (l) { return '<span class="ld-t">' + esc(String(l).replace(/\s+/g, ' ').trim()) + '</span>'; }).join(''), text: true };
    }
    function screenHTML() {
      var R = FX.Render, sc = calc.getScreen();
      if (!sc.power) return { html: '', text: true };
      if (!R) { var st0 = calc.getState(); return textLine([st0.error || st0.expr || '']); }
      var arrow = '<span class="ld-arrow">→</span>';
      var ctx = { cursor: sc.cursor, lineMode: sc.lineMode };
      switch (sc.kind) {
        case 'input':
          if (!sc.expr || !sc.expr.length) return { html: sc.cursor ? '<span class="cur ' + (sc.cursor.style || 'bar') + '"></span>' : '' };
          return { html: R.rowHTML(sc.expr, [], ctx, false) };
        case 'result':
          var out = sc.resultRows ? sc.resultRows.map(R.nodeHTML).join('<span class="ld-sep">,</span>') : R.nodeHTML(sc.result);
          return { html: (sc.expr && sc.expr.length ? R.rowHTML(sc.expr, [], { cursor: null, lineMode: sc.lineMode }, false) + arrow : '') + out };
        case 'prompt':
          if (sc.promptLabel && sc.expr) {
            var v = sc.promptValue != null ? R.nodeHTML(sc.promptValue) : (sc.expr.length ? R.rowHTML(sc.expr, [], { cursor: sc.cursor, lineMode: true }, false) : '');
            return { html: '<span class="ld-lab">' + esc(sc.promptLabel) + '</span>' + v + (sc.promptValue != null || !sc.expr.length ? '<span class="cur bar"></span>' : '') };
          }
          return textLine(sc.lines);
        case 'eqn':
          var e = sc.eqn;
          if (e && e.sub === 'sol') {
            // solution: label (X=, X1=) and value; complex / LineIO rows joined
            var val = e.rows ? e.rows.map(R.nodeHTML).join('<span class="ld-sep"> </span>') : R.nodeHTML(e.node);
            return { html: '<span class="ld-lab">' + esc(e.label) + '</span>' + val };
          }
          if (e && e.sub === 'edit') {
            // coefficient entry: label of the selected cell (a₁=, b=) and its value or the entry being typed
            var lab = '';
            (e.rows || []).forEach(function (row) {
              (row.cells || []).forEach(function (c, ci) { if (c.sel) lab = (e.heads[ci] || '') + (row.num != null ? subNum(row.num) : '') + '='; });
            });
            var b = e.bottom || {};
            var bv = b.expr ? (b.expr.length ? R.rowHTML(b.expr, [], { cursor: b.cursor, lineMode: sc.lineMode }, false)
              : '<span class="cur ' + ((b.cursor && b.cursor.style) || 'bar') + '"></span>') : R.nodeHTML(b.node);
            return { html: '<span class="ld-lab">' + esc(lab) + '</span>' + bv };
          }
          return textLine(sc.lines);     // equation type menu
        case 'message':
          if (sc.solve) {
            return { html: R.rowHTML(sc.solve.expr, [], { cursor: null, lineMode: false }, false) + arrow +
              sc.solve.rows.map(function (row) { return '<span class="ld-lab">' + esc(row.label) + '</span>' + R.nodeHTML(row.value); }).join('<span class="ld-sep"> </span>') };
          }
          return textLine(sc.lines);
        default:
          return textLine(sc.lines);
      }
    }
    function drawScreen() {
      var r = screenHTML();
      dockScr.className = 'ld-scr' + (r.text ? ' ld-text' : '');
      dockScr.innerHTML = '<span class="ld-in">' + r.html + '</span>';
      var inner = dockScr.firstChild;
      inner.style.fontSize = '';
      dockScr.scrollLeft = 0;
      var W = dockScr.clientWidth, full = inner.scrollWidth;
      if (!W || full <= W) return;
      if (r.text) {
        // menus: shrink to one line (down to 60 %)
        var f = parseFloat(G.getComputedStyle(inner).fontSize) || 13;
        inner.style.fontSize = Math.max(f * 0.6, f * (W - 2) / full) + 'px';
        return;
      }
      // long expression: keep the cursor (or the end, for results) in view
      var cur = inner.querySelector('.cur');
      var x = cur ? cur.getBoundingClientRect().left - inner.getBoundingClientRect().left : full;
      dockScr.scrollLeft = Math.max(0, x - W + 14);
    }
    // chips of the step the student works on: the current step, or the next one after "정답"
    function dockChips() {
      var l = runner.lesson, i = runner.stepIdx, n = l.steps.length;
      if (runner.status === 'correct' && i + 1 < n) {
        var ns = l.steps[i + 1];
        return ns.keys.map(function (k, j) { return chipHTML(ns.keys, j, l.mode, j === 0 ? 'cur' : ''); });
      }
      var s = l.steps[Math.min(i, n - 1)];
      var track = runner.onTrack();
      var np = runner.pressed.length;
      var off = !track && runner.status === 'wrong' && runner.reason === 'order', mt = runner.matched();
      return s.keys.map(function (k, j) {
        if (off) return chipHTML(s.keys, j, l.mode, j < mt ? 'ok' : (j === mt ? 'cur miss' : ''));
        return chipHTML(s.keys, j, l.mode, track && j < np ? 'ok' : (track && j === np ? 'cur' : ''));
      });
    }
    function renderDock() {
      var on = !!(runner && runner.lesson && runner.status !== 'done');
      if (on) {
        dockKeys.innerHTML = dockChips().join('');
        drawScreen();
        var cur = dockKeys.querySelector('.lk.cur');
        if (cur) dockKeys.scrollLeft = Math.max(0, cur.offsetLeft - dockKeys.clientWidth / 2);
      }
      dock.hidden = !on;
      padForDock();
    }
    function padForDock() {
      var h = dock.hidden ? 0 : dock.offsetHeight;      // 0 from 600px (CSS hides the dock)
      doc.body.style.paddingBottom = h ? h + 'px' : '';
      doc.documentElement.classList.toggle('has-dock', !!h);
    }
    G.addEventListener('resize', padForDock);

    // After a lesson is chosen.
    // Under 600px with the dock: the whole calculator (LCD to the last key row) between the strip and the
    // dock if it fits, otherwise the keypad (from its top row) right under the strip. The dock shows the
    // keys to press and the expression, so the follow pane need not be on screen.
    // Stacked layout without the dock (600-999px): keypad top and follow pane together if they fit,
    // otherwise the follow pane. Side by side: nearest.
    function revealFollow() {
      var keys = doc.querySelector('.calc .kp-top');
      var vh = G.innerHeight || 0, y = G.pageYOffset || 0;
      var fr = follow.getBoundingClientRect ? follow.getBoundingClientRect() : null;
      var bar = doc.querySelector('.shell-bar');
      var barH = bar && bar.offsetHeight ? bar.offsetHeight : 0;
      var dockH = dock.hidden ? 0 : dock.offsetHeight;
      if (keys && fr && vh && G.scrollTo) {
        var kr = keys.getBoundingClientRect();
        if (dockH) {
          var lcd = doc.querySelector('.calc .lcd-frame'), cb = doc.querySelector('.calc').getBoundingClientRect();
          var lr = lcd ? lcd.getBoundingClientRect() : kr;
          var avail = vh - barH - dockH;
          var top = cb.bottom - lr.top + 8 <= avail ? lr.top : kr.top;
          G.scrollTo(0, Math.max(0, top + y - barH - 6));
          return;
        }
        if (fr.top >= kr.bottom) {
          var target = Math.max(0, kr.top + y - barH - 8);
          var followTop = fr.top + y - target;          // follow pane top in the viewport after scrolling
          if (followTop + 120 <= vh) { G.scrollTo(0, target); return; }
        }
      }
      if (follow.scrollIntoView) follow.scrollIntoView({ block: 'nearest' });
    }
    setTocOpen(true);
    q('.ls-show').addEventListener('click', act(showKey));
    q('.ls-retry').addEventListener('click', act(function () { runner.retryStep(); }));
    q('.ls-skip').addEventListener('click', act(function () { runner.skipStep(); }));
    q('.ls-restart').addEventListener('click', act(function () { runner.restart(); }));
    q('.ls-next').addEventListener('click', act(function () { runner.next(); }));
    return {
      getRunner: function () { return runner; },
      highlighted: function () { return hlKey; },
      // QA / tests: start a lesson as a click on its table-of-contents entry would
      // (a folded unit is opened first, as a student would)
      open: function (id) {
        var b = toc.querySelector('.ls-item[data-id="' + id + '"]');
        if (!b) return false;
        var sec = b.closest('.ls-unit[data-unit]');
        if (sec && !expanded[sec.getAttribute('data-unit')]) sec.querySelector('.ls-unit-btn').click();
        b.click();
        return true;
      },
      // tree toc: open (true) / fold (false) / toggle (undefined) a unit; expandedUnits() lists the open ones
      toggleUnit: function (id, open) {
        var sec = unitEl(id);
        if (!sec) return false;
        return setUnitOpen(id, open == null ? !expanded[id] : open);
      },
      expandedUnits: function () { return Object.keys(expanded).filter(function (k) { return expanded[k]; }); },
      // narrow screens: unfold the table of contents (it is always visible from 1000px)
      showToc: function () { setTocOpen(true); },
      // shell (calc mode): stop the running lesson; the calculator state is left as it is
      stop: function () { clearHL(); if (runner && runner.lesson) runner.stop(); else render(); renderDock(); setTocOpen(true); },
      // tests: draw the table of contents from other lessons / toc data (stops the running lesson)
      useData: function (lessons, t) {
        if (!runner) return false;
        if (runner.lesson) runner.stop();
        setData(lessons, t);
        render(); renderDock();
        return true;
      },
      model: function () { return model; },
      dock: function () { return dock; }
    };
  }

  FX.Lessons = { Runner: Runner, fingerprint: fingerprint, resetCalc: resetCalc, validate: validate, mount: mount,
    buildToc: buildToc, validateMeta: validateMeta };

  // boot: after app.js created FX.calc
  if (G.document && G.document.querySelector) {
    var el = G.document.querySelector('.lesson-panel');
    if (el && FX.calc) FX.lessonPanel = mount(el, FX.calc);
  }
})(typeof window !== 'undefined' ? window : globalThis);
