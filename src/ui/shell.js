/*
 * 공학용계산기 시뮬레이터 - mode shell: 계산용 / 레슨용 switch (.skills/calc-ui-shell).
 *
 * Only shows / hides the side panel areas and stops the lesson runner. It never calls the
 * calculator's handleKey and never resets the calculator: expression, settings and memory are kept
 * across switches. (Starting a lesson from the table of contents resets the calculator to the
 * lesson's start state; that is the lesson runner's job, see lessons.js.)
 *
 *   calc   : .calc-pane (state-line, keyboard help, CMPLX / EQN help) shown, .lesson-panel hidden,
 *            running lesson stopped
 *   lesson : .lesson-panel (table of contents + follow-along) shown, .calc-pane hidden
 *
 * Start mode: URL hash (#lesson / #calc) > lesson (every fresh open starts in 레슨용; the last mode is not restored).
 * Storage access is wrapped in try/catch (file://, private mode).
 *
 * Globals for QA: FX.Shell.getMode(), FX.Shell.setMode('calc' | 'lesson'), FX.Shell.toggle().
 * Event: 'fxsim:mode' on document, detail { mode }.
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};
  var doc = G.document;
  if (!doc || !doc.querySelector) return;

  var page = doc.querySelector('.page');
  var sw = doc.querySelector('.mode-switch');
  var calcPane = doc.querySelector('.calc-pane');
  var lessonPane = doc.querySelector('.lesson-panel');
  if (!page || !sw) return;

  function valid(m) { return m === 'calc' || m === 'lesson' ? m : null; }
  function hashMode() {
    try { return valid(String(G.location.hash || '').replace(/^#/, '').toLowerCase()); } catch (e) { return null; }
  }
  function setHash(m) {
    try {
      if (G.location.hash && hashMode() !== m && G.history && G.history.replaceState) G.history.replaceState(null, '', '#' + m);
    } catch (e) { /* file:// or sandbox: keep the URL as it is */ }
  }

  var mode = null;

  function setMode(m, opts) {
    m = valid(m) || 'calc';
    opts = opts || {};
    if (m === mode) return mode;
    mode = m;
    var lesson = m === 'lesson';
    page.classList.toggle('mode-lesson', lesson);
    page.classList.toggle('mode-calc', !lesson);
    page.setAttribute('data-mode', m);
    sw.setAttribute('aria-checked', lesson ? 'true' : 'false');
    if (calcPane) calcPane.hidden = lesson;
    if (lessonPane) lessonPane.hidden = !lesson;
    // calc mode: no lesson runs (grading off, key highlight cleared); the calculator itself is untouched
    if (!lesson && FX.lessonPanel && FX.lessonPanel.stop) FX.lessonPanel.stop();
    if (!opts.init) setHash(m);
    var ev;
    try { ev = new G.CustomEvent('fxsim:mode', { detail: { mode: m } }); }
    catch (e) { ev = doc.createEvent('CustomEvent'); ev.initCustomEvent('fxsim:mode', false, false, { mode: m }); }
    doc.dispatchEvent(ev);
    return mode;
  }

  function toggle() { return setMode(mode === 'lesson' ? 'calc' : 'lesson'); }

  sw.addEventListener('click', function (e) {
    // mouse / touch: drop focus so a later Enter on the PC keyboard is '=' for the calculator
    if (e.detail && sw.blur) sw.blur();
    toggle();
  });
  // keyboard: Space / Enter toggle. Stop the event here so app.js does not also press '='.
  sw.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggle();
    }
  });
  sw.addEventListener('keyup', function (e) {
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); e.stopPropagation(); }   // no second toggle by click
  });
  G.addEventListener('hashchange', function () {
    var h = hashMode();
    if (h) setMode(h);
  });

  // under 600px the switch lives in .shell-bar (sticky strip of its own) instead of the calculator's
  // brand row, so it can never cover calculator keys while the page scrolls (QA SH-14)
  var bar = doc.querySelector('.shell-bar');
  var home = sw.parentNode, homeNext = sw.nextSibling;
  function placeSwitch(narrow) {
    if (!bar) return;
    if (narrow && sw.parentNode !== bar) bar.appendChild(sw);
    else if (!narrow && sw.parentNode !== home) home.insertBefore(sw, homeNext && homeNext.parentNode === home ? homeNext : null);
  }
  var mq = null;
  try { mq = G.matchMedia ? G.matchMedia('(max-width: 599px)') : null; } catch (e) { mq = null; }
  if (mq) {
    placeSwitch(mq.matches);
    var onMq = function (e) { placeSwitch(e.matches); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  setMode(hashMode() || 'lesson', { init: true });

  FX.Shell = { getMode: function () { return mode; }, setMode: setMode, toggle: toggle };
})(window);
