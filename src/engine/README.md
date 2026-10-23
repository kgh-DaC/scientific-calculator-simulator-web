# CalcEngine (COMP, CMPLX, EQN)

순수 JS, DOM 미사용. 토큰 형식은 `TOKENS.md`.

## 로드
- 브라우저: `core.js → parser.js → constants.js → evaluator.js → format.js → api.js → eqn.js` 순서로 `<script>`. 전역 `CalcEngine`.
- Node: `require('src/engine/index.js')`.

## API
| 함수 | 설명 |
|---|---|
| `evaluate(tokens, settings, memory, opts)` | 결과 객체(아래). `:` 로 나뉜 식은 순서대로 계산하고 마지막 결과를 주며 `steps`에 각 결과 |
| `solve(tokens, varName, settings, memory)` | SOLVE(뉴턴법). 초기값 = `memory.vars[varName]`. `{ok, value, display, text, lr, lrDisplay, error}`. 오류: `Variable ERROR`, `Can't Solve` |
| `zero()`, `isZero(v)`, `add(a,b)`, `sub(a,b)`, `fromInput(x)`, `toNumber(v)` | 메모리(M+/M−, STO) 처리용. 복소수 값도 받는다. `toNumber`는 복소수면 실수부 |
| `isComplex(v)` | 값이 복소수(`{k:'c'}`)인지 |
| `format(value, settings, opts)` | 값만 다시 표시(복소수면 a+bi 형식의 `formatComplex` 결과) |

`opts`: `decimalOutput`(SHIFT =), `sdToggle`(S⇔D 대체 표시), `eng`(지수 고정, 3의 배수), `dmsOutput`(60진 표시), `random`(테스트용 난수 함수).

## 결과
`{ ok, value, display, text, decimal, decimalNode, alt, altText, view, dms, engExp, assign, multi, steps, error, errorPos }` (CMPLX 결과는 `format, re, im, reText, imText, r, theta, rText, thetaText, lines` 추가)
- `display` 노드: `text{value}`, `row{children}`, `frac{num,den}`, `mixed{int,num,den}`, `sqrt{arg}`, `pow{base,exp}`.
- `text`: 한 줄 문자열. MathO 분수 `⟨7/6⟩`, 대분수 `1⟨1/6⟩`, LineIO `7⌟6`/`1⌟1⌟6`, √ `√6+2√3`, `⟨√2/2⟩`, π `⟨1/6⟩π`, 지수 `1.4286×10⁻¹`, 60진 `2°15′18″`. 음수 기호는 ASCII `-`.
- `decimal`: 현재 Norm/Fix/Sci 설정의 소수 표기 문자열(노드는 `decimalNode`).
- `alt`/`altText`: S⇔D 로 바꿀 다른 표기(LineIO 소수 → 분수, MathO 분수·소수 혼합 결과 → 분수). 없으면 null.
- `view`: `decimal|frac|sqrt|pi|dms|eng|multi|cmplx`.
- `assign`: Pol/Rec 의 `{X, Y}`. `multi`: `[{label, value, display, text, view, decimal, decimalNode, toggled, toggledText}]`.

### Pol/Rec(`view === 'multi'`) 결과 필드
두 값(r,θ 또는 X,Y)을 모두 같은 `opts`(decimalOutput, sdToggle 등)로 포맷한다. UI는 첫 값만 다시 평가하지 말고 아래 필드를 그대로 쓴다.

| 필드 | 내용 | 예: MathO `Rec(2,60)` |
|---|---|---|
| `display` / `text` | 요청한 형태(row 노드 / 문자열) | `X=1,Y=√3` |
| `decimal` / `decimalNode` | 두 값 모두 소수 형태(SHIFT = 로 보일 것) | `X=1,Y=1.732050808` |
| `alt` / `altText` | S⇔D 를 누른 뒤 형태(두 값 모두). 바뀌는 값이 없으면 null | `X=1,Y=1.732050808` (opts.sdToggle 이면 `X=1,Y=√3`) |
| `multi[i].decimal` / `decimalNode` | 항목별 소수 | `1.732050808` |
| `multi[i].toggled` / `toggledText` | 항목별 S⇔D 뒤 형태 | `1.732050808` |
| `multi[i].view` | 항목별 view(`decimal|sqrt|frac|pi`) | `sqrt` |
| `engExp`, `dms` | multi 에서는 항상 `null`, `false` | |

`assign.X/Y` 는 정확값(√3 등)을 유지한다.
- `error`: `Math ERROR|Syntax ERROR|Stack ERROR|Time Out|...`, `errorPos`: 최상위 토큰 인덱스(그 토큰 뒤에 커서).

## CMPLX 모드
`settings.mode = 'CMPLX'`(기본 `'COMP'`), `settings.cmplxFormat = 'a+bi' | 'r∠θ'`(기본 `'a+bi'`, UI의 `settings.complex`도 별칭으로 받음).
토큰: `{type:'imag'}`(i), `{type:'angle'}`(∠, 우선순위 8), `fn arg`·`fn conjg`, 식 끝 `{type:'cmd', name:'polar'|'rect'}`(▶r∠θ, ▶a+bi). 자세한 것은 `TOKENS.md` 6절. COMP에서 이 토큰들은 Syntax ERROR.

### 복소수 결과 (`view === 'cmplx'`)
결과가 복소수(허수부 ≠ 0)이거나, 극형식 표시(▶r∠θ 또는 설정 r∠θ)이면서 0이 아닌 값일 때. 허수부가 0인 a+bi 결과는 지금까지와 같은 실수 결과(view `frac|sqrt|decimal|…`)다.

| 필드 | 내용 | 예: MathO `2∠45` |
|---|---|---|
| `format` | `'rect'`(a+bi) 또는 `'polar'`(r∠θ) | `rect` |
| `display` / `text` | 한 행 표시. row(a, `+`/`-`, b, `i`) 또는 row(r, `∠`, θ) | `√2+√2i` |
| `decimal` / `decimalNode` | 두 성분 모두 소수 | `1.414213562+1.414213562i` |
| `alt` / `altText` | S⇔D 뒤 형태(두 성분 모두 전환). 같으면 null | `1.414213562+1.414213562i` |
| `lines` | LineIO/LineO 2행 표시용 `[{node,text},{node,text}]`: rect `['a', '+bi']`, polar `['r', '∠θ']` (MathO에서도 들어 있으나 UI는 LineIO/LineO에서만 쓴다) | `[√2, +√2i]` |
| `decimalLines` | `decimalNode`에 대응하는 2행(SHIFT = 결과, S⇔D로 소수가 될 때). 형식은 `lines`와 같음. 항상 있음 | `[1.414213562, +1.414213562i]` |
| `altLines` | `alt`에 대응하는 2행(S⇔D 뒤). `alt`가 null이면 null | `[1.414213562, +1.414213562i]` |
| `re`/`im`, `reText`/`imText` | rect 성분 노드·문자열. `im`은 부호 포함(`-2`) | `√2`, `√2` |
| `r`/`theta`, `rText`/`thetaText` | polar 성분 | |
| `value` | 복소수 Value `{k:'c', re, im}`. Ans/STO/M+ 에 그대로 쓴다 | |
| `engExp`, `dms`, `assign`, `multi` | `null`, `false`, `null`, `null` | |

- 허수 단위 `i`는 모든 노드(`display`, `decimalNode`, `alt`, `*Lines[k].node`)에서 항상 단독 text 노드 `{type:'text', value:'i'}`다(앞 계수와 합치지 않음). 예 `3-i` → row(`'3-'`, `'i'`).
- 표시 규칙: 계수 1은 생략(`i`, `-i`, `3-i`), 실수부 0이면 생략(`2i`), 허수부 0이면 실수 결과. 극형식 θ는 −180 < θ ≦ 180(현재 각도 단위, Rad는 `⟨1/4⟩π`처럼 π 표시 가능).
- `opts.decimalOutput`, `opts.sdToggle`은 두 성분에 함께 적용된다. `opts.eng`, `opts.dmsOutput`은 복소수 결과에서 무시된다.
- 성분 하나가 두 항짜리 √ 식(예 `1+√2`)이면 a+bi 로 이을 수 없어 두 성분 모두 소수로 낸다.
- 복소수 값을 COMP 등 다른 모드에서 Ans/변수로 읽으면 실수부만 쓴다.
- CMPLX 에서 `∫`, `d/dx`, `solve()`는 Syntax ERROR. 실수 전용 함수(sin, ln, x!, %, Pol, nCr, 단위변환, Σ의 항 등)에 허수부 ≠ 0 인 값이 들어가면 Math ERROR. `√(음수)`는 CMPLX에서만 `i√|x|`.

## EQN 모드 (`eqn.js`)
근거: `_workspace/01_spec_eqn.md` Part C, G-1. 브라우저는 `api.js` 다음에 `eqn.js`를 로드한다. Node `index.js`는 `eqn.js`까지 로드하므로 `require('src/engine/index.js')`에서 `solveEqn`, `evalCoeff`, `eqnCoeffCount`를 쓸 수 있다.

| 함수 | 설명 |
|---|---|
| `solveEqn(type, coeffs, settings, memory, opts)` | `type`: `'lin2'|'lin3'|'quad'|'cubic'`. `coeffs`: 행 우선 평탄 배열(lin2 6개 `[a1,b1,c1,a2,b2,c2]`, lin3 12개, quad 3개 `[a,b,c]`, cubic 4개 `[a,b,c,d]`). 원소는 Value(보통 `evalCoeff(...).value`) 또는 JS 수·문자열. 반환 `{ok, error, type, count, solutions, allText}` |
| `evalCoeff(tokens, settings, memory)` | 계수 셀 하나 계산(COMP 규칙). `{ok, value, display, text, decimal, decimalNode, view, error, errorPos}`. `value`는 정확값(`3⌟4` → ¾, `-2√2`) |
| `eqnCoeffCount(type)` | 계수 개수(6/12/3/4, 모르는 종류 0) |

### Solution (`solutions[i]`)
| 필드 | 내용 |
|---|---|
| `label` | `X`,`Y`,`Z`(연립), `X1..X3`(서로 다른 근이 2개 이상), `X`(근 1개: 중근·삼중근) |
| `kind` | `'real'` 또는 `'complex'` |
| `value` | 정확값 Value(허근이면 `{k:'c', re, im}`). Ans·변수에 저장하지 않는다 |
| `display`/`text` | 기본 표시. 노드는 `row/text/frac/sqrt`. 허근은 CMPLX a+bi 포맷 재사용(`i`는 단독 text 노드) |
| `decimal`/`decimalNode` | 소수 표시(Fix/Sci/Norm 적용) |
| `alt`/`altText` | S⇔D 뒤 표시. 바뀌지 않으면 null |
| `view` | `decimal|frac|sqrt|cmplx` (연립 해는 √ 불가라 `decimal|frac`) |
| `re`/`im`/`reText`/`imText`, `lines`/`decimalLines`/`altLines` | 허근일 때만(CMPLX 결과와 같은 의미). 실근이면 null |

규칙
- 연립: Cramer 법칙(정확값). 해가 유리수가 아니면 소수(√ 형태 표시 안 함).
- 2차: D=b²−4ac 정확 계산. X1=(−b+√D)/2a, X2=(−b−√D)/2a. 허근은 허수부 + 먼저. 중근은 `X` 하나.
- 3차: 계수가 모두 유리수면 가장 작은 유리근을 X1, 나머지는 인수분해한 2차(위 순서). 유리근이 없으면 고정밀 뉴턴 + 2차 축소로 소수 근. 중근은 서로 다른 근 2개를 오름차순, 삼중근은 `X` 하나 [가정].
- 허근 표시는 `cmplxFormat`(r∠θ) 설정과 무관하게 항상 a+bi [가정]. `opts.eng`, `opts.dmsOutput`은 무시.
- 오류: 계수 개수 불일치·복소수 계수·a=0(2·3차)·det=0(연립)·해 범위 초과 → `Math ERROR`. 모르는 `type` → `Syntax ERROR`. `evalCoeff`에서 `i` 토큰·`:`·Pol/Rec → `Syntax ERROR`, 0 나눗셈 → `Math ERROR`.
- `memory`는 읽기만 한다(Ans 갱신은 UI가 하지 않는다, 명세 C-5).

## 테스트
`node tests/engine/run.js [id 필터]` (`VERBOSE=1` 이면 통과 항목도 출력). 파일: `comp`, `cmplx`, `eqn`, `rules`, `qa_regress` `.test.js`.
