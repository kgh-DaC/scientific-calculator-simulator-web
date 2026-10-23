/*
 * Node 용 로더. 브라우저에서는 아래 순서대로 <script> 태그로 넣는다(이 파일은 불필요).
 *   core.js, parser.js, constants.js, evaluator.js, format.js, api.js, eqn.js, stat.js, table.js
 */
'use strict';
require('./core.js');
require('./parser.js');
require('./constants.js');
require('./evaluator.js');
require('./format.js');
require('./api.js');
require('./stat.js');
require('./table.js');
module.exports = require('./eqn.js'); // eqn.js 가 CalcEngine 전체(evaluate + solveEqn/evalCoeff)를 export
