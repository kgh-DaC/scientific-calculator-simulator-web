# 엔진 의미 토큰 형식 (COMP, CMPLX 모드) — v2 (v1 + CMPLX 토큰)

UI 어댑터는 키 입력을 아래 토큰 배열로 바꿔 `CalcEngine.evaluate(tokens, settings, memory, opts)`에 넘긴다.
토큰은 모두 `{ type: ..., ... }` 형태의 평범한 객체다. 엔진은 토큰 배열을 바꾸지 않는다.

## 1. 토큰 표

| type | 필드 | 의미 / 대응 키 | 예 |
|---|---|---|---|
| `num` | `value: string` (숫자와 `.`) | 숫자 리터럴. 연속된 `num` 토큰은 엔진이 이어 붙인다(한 자리씩 보내도 됨). `.`이 두 번 나오면 Syntax ERROR | `{type:'num',value:'1'}`, `{type:'num',value:'.'}`, `{type:'num',value:'25'}` |
| `exp10` | — | `×10^x` 키. 바로 뒤에 `neg`(또는 `op '-'`/`'+'`) 0~1개와 정수 `num`이 지수. 앞에 가수가 없으면 가수 1 | `1 ×10 (−) 7` → `num 1, exp10, neg, num 7` |
| `op` | `value: '+','-','*','/','nPr','nCr','^'` | 이항 연산자. `'×'`,`'÷'`,`'−'`도 같은 뜻으로 받는다. `'^'`는 괄호 없는 거듭제곱(가급적 아래 `infix pow` 사용) | `{type:'op',value:'*'}` |
| `neg` | — | `(−)` 음수 기호(우선순위 5) | |
| `paren` | `value: '(' \| ')'` | 괄호. 끝의 닫는 괄호는 생략 가능(자동 닫힘) | |
| `comma` | — | `SHIFT )` `,` (함수 인수 구분, SOLVE의 `식, 변수`) | |
| `colon` | — | `ALPHA ∫` `:` 멀티스테이트먼트 구분 | |
| `eq` | — | `ALPHA CALC` `=` (CALC/SOLVE 방정식의 등호) | `Y = A X² + B` |
| `fn` | `name` (아래 2절) | 여는 괄호를 **포함하는** 함수(`sin(` 등). 바로 다음에 `paren '('`를 따로 보내지 않는다. 인수는 `comma`로 구분, `paren ')'`로 닫음(끝이면 생략 가능). LineIO의 `√(`, `e^(`, `Abs(` 등도 이 형식 | `sin 30 )` → `fn sin, num 30, paren )` |
| `tpl` | `name`, `slots: Token[][]` | MathO 자연수 표기 템플릿(박스). 각 슬롯은 독립된 토큰 배열. 빈 슬롯은 Syntax ERROR. 템플릿 전체가 하나의 피연산자(원자)이다 | `{type:'tpl',name:'frac',slots:[[num 2],[num 3]]}` |
| `postfix` | `name: 'sq','cube','inv','fact','pct','deg','rad','grad'` | 값 뒤에 붙는 함수: `x²`, `x³`, `x⁻¹`, `x!`, `%`, DRG▸의 `°`(1) `ʳ`(2) `ᵍ`(3) | `5 x²` → `num 5, postfix sq` |
| `dms` | — | `°′″` 키(60진수 입력 구분 기호). `2°15°18°` → `num 2, dms, num 15, dms, num 18, dms` | |
| `fracsep` | — | LineIO에서 `a b/c` 키가 입력하는 `⌟`. `2⌟3`(분수), `3⌟1⌟2`(대분수) | |
| `infix` | `name: 'pow' \| 'xroot'` | LineIO의 `^(`와 `x√(`(ⁿ√). 여는 괄호를 포함하므로 `paren ')'`로 닫는다(끝이면 생략 가능) | `2 ^( 3 )`, `5 x√( 32 )` |
| `const` | `name: 'pi' \| 'e'` 또는 `name:'sc', index: 1..40` | π, e, 과학상수(`SHIFT 7` + 두 자리) | `{type:'const',name:'sc',index:28}` (C0) |
| `var` | `name: 'A','B','C','D','E','F','M','X','Y'` | 변수(ALPHA 변수키) | |
| `ans` | — | `Ans` | |
| `ran` | — | `Ran#` (`SHIFT .`) | |
| `conv` | `index: 1..40` | 단위변환 명령(`SHIFT 8` + 두 자리), 앞의 값에 붙는 후위 명령(우선순위 6) | `5 cm▸in` → `num 5, conv 2` |

## 2. `fn` 이름 (LineIO 및 MathO의 괄호 함수)

| name | 화면 | 인수 | 비고 |
|---|---|---|---|
| `sin` `cos` `tan` | sin( | 1 | 각도 단위 설정 따름 |
| `asin` `acos` `atan` | sin⁻¹( | 1 | |
| `sinh` `cosh` `tanh` `asinh` `acosh` `atanh` | sinh( | 1 | 각도 무관 |
| `log` | log( | 1 또는 2 | `log(x)` 밑 10, `log(a,b)` 밑 a |
| `ln` | ln( | 1 | |
| `exp` | e^( | 1 | LineIO `SHIFT ln` |
| `pow10` | 10^( | 1 | LineIO `SHIFT log` |
| `sqrt` | √( | 1 | LineIO `√` |
| `cbrt` | ³√( | 1 | LineIO `SHIFT √` |
| `abs` | Abs( | 1 | |
| `pol` | Pol( | 2 | 결과 r, θ → X, Y |
| `rec` | Rec( | 2 | 결과 x, y → X, Y |
| `ranint` | RanInt#( | 2 | |
| `rnd` | Rnd( | 1 | 표시 자릿수로 반올림 |
| `integ` | ∫( | 3 또는 4 | `∫(f, a, b[, tol])` |
| `diff` | d/dx( | 2 또는 3 | `d/dx(f, a[, tol])` |
| `sum` | Σ( | 3 | `Σ(f, a, b)` |
| `arg` | arg( | 1 | CMPLX 전용(`SHIFT 2 1`). 편각, 현재 각도 단위 |
| `conjg` | Conjg( | 1 | CMPLX 전용(`SHIFT 2 2`). 켤레복소수 |

## 3. `tpl` 이름 (MathO 템플릿)

| name | slots | 화면 |
|---|---|---|
| `frac` | `[분자, 분모]` | ⟨a/b⟩ |
| `mixed` | `[정수, 분자, 분모]` | 대분수 |
| `sqrt` | `[x]` | √x |
| `cbrt` | `[x]` | ³√x |
| `root` | `[n, x]` | ⁿ√x |
| `pow` | `[지수]` | 바로 앞 피연산자가 밑 (`x^` 키). 앞 피연산자가 없으면 Syntax ERROR |
| `pow10` | `[x]` | 10^x |
| `exp` | `[x]` | e^x |
| `logb` | `[밑, x]` | log□ |
| `abs` | `[x]` | Abs |
| `integ` | `[f, a, b]` | ∫ (MathO는 tol 없음) |
| `diff` | `[f, a]` | d/dx(f)\|x=a |
| `sum` | `[f, a, b]` | Σ |

MathO에서도 `sin(` `log(` `ln(` `Pol(` `Rec(` `RanInt#(` `Rnd(` 같은 괄호 함수는 `fn` 토큰을 쓴다.

## 4. 예

```js
// C-I02  4sin(30)(30+10×3      (생략된 ×와 끝 괄호)
[{type:'num',value:'4'},{type:'fn',name:'sin'},{type:'num',value:'30'},{type:'paren',value:')'},
 {type:'paren',value:'('},{type:'num',value:'30'},{type:'op',value:'+'},{type:'num',value:'10'},
 {type:'op',value:'*'},{type:'num',value:'3'}]

// C-I03  ⟨(2+√2)/(1+√2)⟩  (MathO)
[{type:'tpl',name:'frac',slots:[
   [{type:'num',value:'2'},{type:'op',value:'+'},{type:'tpl',name:'sqrt',slots:[[{type:'num',value:'2'}]]}],
   [{type:'num',value:'1'},{type:'op',value:'+'},{type:'tpl',name:'sqrt',slots:[[{type:'num',value:'2'}]]}]]}]

// C-G16  (1+1)^(2+2)  MathO:  ( 1 + 1 ) tpl pow [2+2]
// C-X02  ∫(ln(X),1,e)  LineIO
[{type:'fn',name:'integ'},{type:'fn',name:'ln'},{type:'var',name:'X'},{type:'paren',value:')'},
 {type:'comma'},{type:'num',value:'1'},{type:'comma'},{type:'const',name:'e'},{type:'paren',value:')'}]
```

## 5. settings / memory / 결과

```js
settings = {
  mode: 'COMP' | 'CMPLX',                     // 기본 'COMP' (다른 값은 COMP 로 취급)
  cmplxFormat: 'a+bi' | 'r∠θ',                // 기본 'a+bi' (settings.complex 도 받음)
  io: 'MathO' | 'LineO' | 'LineIO',          // 기본 'MathO'
  angle: 'deg' | 'rad' | 'gra',               // 기본 'deg'
  format: { type: 'norm1'|'norm2'|'fix'|'sci', digits: 0..9 },   // 기본 norm1
  fraction: 'd/c' | 'ab/c',                   // 기본 'd/c'
  decimalSep: 'dot' | 'comma'                 // 기본 'dot' (결과 표시만)
}
memory = { ans: Value, vars: { A, B, C, D, E, F, M, X, Y } }   // Value = 엔진이 돌려준 value (JS number/문자열도 허용)
```

결과 (`evaluate`):
```js
{ ok, value, display, text, decimal, error, errorPos,
  view,            // 현재 표시 형태 'exact'|'decimal'|...
  assign,          // 변수에 써야 할 값 (Pol/Rec → {X, Y}), 없으면 null
  multi }          // Pol/Rec 결과 [{label:'r'|'θ'|'X'|'Y', value, display, text}]
```
- `display`: DisplayNode 트리. `{type:'text',value}`, `{type:'row',children}`, `{type:'frac',num,den}`, `{type:'sqrt',arg}`, `{type:'pow',base,exp}` (지수 표기 `×10ⁿ`은 `row[text '1.4286×', pow(text '10', text '-1')]`)
- `text`: 한 줄 문자열(LineIO 화면 그대로: `7⌟6`, `1.4286×10⁻¹`, `-23.8`). 자연 표기 결과도 `⟨1/6⟩π`, `√6+2√3` 처럼 문자열로 준다(테스트·디버그용).
- `errorPos`: 오류가 난 위치(최상위 토큰 배열의 인덱스, 해당 토큰 **뒤**에 커서). 알 수 없으면 null.
- Ans 갱신, STO, M+/M− 은 UI가 한다: `memory.ans = r.value`, `memory.vars.M = CalcEngine.add(memory.vars.M, r.value)`.
- 나머지 API는 `src/engine/README.md` 참조.

## 6. CMPLX 모드 토큰 (`settings.mode === 'CMPLX'`에서만, 다른 모드에서는 Syntax ERROR)

| type | 필드 | 의미 / 대응 키 | 비고 |
|---|---|---|---|
| `imag` | — | 허수 단위 `i` (`ENG` 키) | 원자. 생략 곱셈 가능: `2 i`, `i i`, `√2 i`. 후위 함수는 i 에만 붙음(`2i³` = 2·i³) |
| `angle` | — | `∠` (`SHIFT (−)`) | 이항 연산자, 우선순위 8(nPr/nCr 와 같음): `2∠45+1` = (2∠45)+1. r, θ 모두 실수여야 함(아니면 Math ERROR) |
| `fn` `arg` / `conjg` | — | `SHIFT 2 1` / `SHIFT 2 2` | 여는 괄호 포함. `)`로 닫음(끝이면 생략 가능) |
| `fn`/`tpl` `abs` | — | `SHIFT hyp` | 기존 토큰. 복소수면 크기 `|z|` |
| `cmd` | `name: 'polar' | 'rect'` | `SHIFT 2 3`(▶r∠θ) / `SHIFT 2 4`(▶a+bi) | 문장 끝에만(그 뒤에 다른 토큰이 오면 Syntax ERROR). 그 계산의 표시 형식을 설정보다 우선 |

예: CX-01 `(2+6i)÷(2i)` → `paren (, num 2, op +, num 6, imag, paren ), op /, paren (, num 2, imag, paren )`
CX-09 `√2+√2i▶r∠θ` (MathO) → `tpl sqrt[2], op +, tpl sqrt[2], imag, cmd polar`
