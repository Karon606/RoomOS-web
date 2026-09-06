// 원격 서명 화면이 '서류는 둘'을 전제하지 않는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-09-06). 이 화면에는 2 가 열두 자리에 손으로 박혀 있었고, 그중 셋은 이미
// 결함이었다.
//
//   ⓐ 영문 안내가 서류 개수(twoDocs)에 묶여, 동의서를 안 쓰는 영업장의 외국인 입주자가
//     이 화면에서 영어를 한 줄도 못 봤다. 서류 개수와 안내 언어는 아무 관계가 없다.
//   ⓑ 마지막 한 장 강조(.last)도 개수에 묶여, 서류가 하나인 영업장의 유일한 서명란이
//     미서명 상태에서도 절대 강조를 못 받았다.
//   ⓒ 남은 서명 확인창이 세션당 한 번이라, 서류가 셋이 되면 두 번째 서명 뒤에 침묵한다.
//     "확인창도 안 뜨네, 끝났나 보다" — 2026-09-03 사고의 심리 그대로다.
//   ⓓ 진행 문구에 '/ 2', '두 곳', 'Two signatures' 같은 고정 수사가 없는가.
//
// 실행: node scripts/check-sign-screen-n.mjs
import { readFileSync } from 'node:fs'

const F = 'app/contract/[tenantId]/ContractView.tsx'
const raw = readFileSync(F, 'utf8')
// 주석은 지운다 — 위 설명문의 '두 장' 같은 말이 제 그물에 걸리면 안 된다.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

const violations = []

// ⓐ 영문 안내가 서류 개수에 묶이지 않았는가.
//
//   **금지 목록이 아니라 허용 목록으로 본다.** 종전에는 옛 변수 이름(twoDocs)이 조건에 있는지를
//   봤는데, 그 이름을 지우는 순간 규칙이 영원히 초록이 됐다. 누가 `docTotal > 1 &&` 로 다시
//   묶어도 통과한다. 막으려던 것은 이름이 아니라 **결합**이다(2026-09-06 디자이너 지적).
{
  const at = src.indexOf('className="en"')
  if (at < 0) {
    violations.push(`${F} — 영문 안내(em.en)를 못 찾았다. 한글을 못 읽는 입주자에게 남는 것이 그 줄뿐이다.`)
  } else {
    // 그 JSX 를 여는 조건식만 떠서 본다. 바로 앞 `{` 부터 `&& (` 까지다.
    const head = src.lastIndexOf('{', src.lastIndexOf('<em', at))
    const cond = head < 0 ? '' : src.slice(head, src.lastIndexOf('<em', at))
    for (const bad of ['docTotal', 'docCount', 'disposalConsent', 'signedCount', 'twoDocs']) {
      if (new RegExp(`\\b${bad}\\b`).test(cond)) {
        violations.push(`${F} — 영문 안내를 여는 조건에 ${bad} 가 있다. 서류 개수와 안내 언어는 아무 관계가 없다. 동의서를 안 쓰는 영업장의 외국인이 영어를 한 줄도 못 본다.`)
      }
    }
    if (!/\bremote\b/.test(cond)) {
      violations.push(`${F} — 영문 안내를 여는 조건이 remote 가 아니다(조건: ${cond.slice(0, 60).trim()}). 원격 서명 화면이면 언제나 서야 한다.`)
    }
  }
}

// ⓑ 마지막 한 장 강조가 서류 개수에 묶이지 않았는가. 여기도 허용 목록이다.
{
  const hits = [...src.matchAll(/\?\s*' last'/g)]
  if (hits.length === 0) {
    violations.push(`${F} — .last 강조를 못 찾았다. 남은 서명란을 가리키는 신호가 사라지면 텍스트를 못 읽는 사람에게 남는 것이 없다.`)
  }
  for (const m of hits) {
    // 그 삼항의 조건식 — 앞쪽 `${` 부터 `?` 까지.
    const open = src.lastIndexOf('${', m.index)
    const cond = open < 0 ? '' : src.slice(open + 2, m.index)
    for (const bad of ['docTotal', 'docCount', 'disposalConsent', 'twoDocs']) {
      if (new RegExp(`\\b${bad}\\b`).test(cond)) {
        violations.push(`${F} — .last 강조를 여는 조건에 ${bad} 가 있다. 서류가 하나인 영업장의 유일한 서명란이 절대 강조를 못 받는다.`)
      }
    }
  }
}

// ⓒ 확인창이 진행 단계별로 뜨는가. boolean 한 번이면 서류가 셋일 때 두 번째 뒤에 침묵한다.
if (/askedRef\s*=\s*useRef\(false\)/.test(src) || /!askedRef\.current/.test(src)) {
  violations.push(`${F} — 남은 서명 확인창이 세션당 한 번이다. 서류가 셋이면 두 번째 서명 뒤에 침묵해 "끝났나 보다"가 된다(2026-09-03 사고 재현).`)
}
if (!/askedAtRef\.current\s*!==/.test(src)) {
  violations.push(`${F} — 확인창이 서명 진행 수를 안 본다. 진행이 실제로 늘 때마다 한 번씩 떠야 한다.`)
}

// ⓓ 진행 문구에 고정 수사가 없는가. 서류가 늘면 전부 거짓이 된다.
for (const [re, what] of [
  [/서명 \d+ \/ 2/, "'서명 N / 2' 고정"],
  [/\d+ of 2 signed/, "'N of 2 signed' 고정"],
  [/Two signatures required/, "'Two signatures required' 고정"],
  [/두 곳에 서명/, "'두 곳에 서명' 고정"],
  [/아직 하나 남았습니다/, "'아직 하나 남았습니다' 고정"],
  [/서류가 두 장 있습니다/, "'서류가 두 장' 고정"],
  [/signedCount >= 2/, 'signedCount >= 2 리터럴(진행 점 2개 고정)'],
]) {
  if (re.test(src)) violations.push(`${F} — 진행 문구에 ${what} 이 남아 있다. 서류가 늘면 화면이 거짓말을 한다.`)
}

console.log(`[서명 화면 N] ⓐ 영문 안내 · ⓑ 마지막 강조 · ⓒ 확인창 반복 · ⓓ 고정 수사 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
