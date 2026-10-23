/*
 * 공학용계산기 시뮬레이터 - label tables for CONST (SHIFT 7) / CONV (SHIFT 8) atoms.
 * Reads CalcEngine.constants / CalcEngine.conversions (src/engine/constants.js) when loaded;
 * otherwise falls back to the numbers from the spec (_workspace/01_spec_comp.md C-4, C-5).
 */
(function (G) {
  'use strict';
  var FX = G.FX = G.FX || {};

  var SC_FALLBACK = [null, 'mp', 'mn', 'me', 'mμ', 'a0', 'h', 'μN', 'μB', 'ħ', 'α', 're', 'λc', 'γp', 'λcp', 'λcn',
    'R∞', 'u', 'μp', 'μe', 'μn', 'μμ', 'F', 'e', 'NA', 'k', 'Vm', 'R', 'C0', 'C1', 'C2', 'σ', 'ε0', 'μ0', 'Φ0', 'g',
    'G0', 'Z0', 't', 'G', 'atm'];
  var CONV_FALLBACK = [null, 'in▸cm', 'cm▸in', 'ft▸m', 'm▸ft', 'yd▸m', 'm▸yd', 'mile▸km', 'km▸mile', 'n mile▸m',
    'm▸n mile', 'acre▸m²', 'm²▸acre', 'gal(US)▸ℓ', 'ℓ▸gal(US)', 'gal(UK)▸ℓ', 'ℓ▸gal(UK)', 'pc▸km', 'km▸pc',
    'km/h▸m/s', 'm/s▸km/h', 'oz▸g', 'g▸oz', 'lb▸kg', 'kg▸lb', 'atm▸Pa', 'Pa▸atm', 'mmHg▸Pa', 'Pa▸mmHg', 'hp▸kW',
    'kW▸hp', 'kgf/cm²▸Pa', 'Pa▸kgf/cm²', 'kgf·m▸J', 'J▸kgf·m', 'lbf/in²▸kPa', 'kPa▸lbf/in²', '°F▸°C', '°C▸°F',
    'J▸cal', 'cal▸J'];

  function idx(n) { var i = parseInt(n, 10); return isNaN(i) ? -1 : i; }

  function constEntry(n) {
    var E = G.CalcEngine;
    var i = idx(n);
    if (E && E.constants && E.constants[i]) return E.constants[i];
    return SC_FALLBACK[i] ? { index: i, symbol: SC_FALLBACK[i] } : null;
  }
  function convEntry(n) {
    var E = G.CalcEngine;
    var i = idx(n);
    if (E && E.conversions && E.conversions[i]) return E.conversions[i];
    return CONV_FALLBACK[i] ? { index: i, label: CONV_FALLBACK[i] } : null;
  }

  FX.Tables = {
    constEntry: constEntry,
    convEntry: convEntry,
    constSymbol: function (n) { var e = constEntry(n); return e ? e.symbol : '?'; },
    convLabel: function (n) { var e = convEntry(n); return e ? e.label : '?'; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
