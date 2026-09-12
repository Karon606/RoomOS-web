// 계약서 조판(표 머리글)에 옛 용어 '입실료' 가 되살아나는지 본다 — 소스 가드.
//
// 왜 진리표가 아니라 소스 가드인가. 조항 문안과 라벨은 상수라 진리표가 값을 읽어 본다
// (test-contract-translation 10단계). 그런데 **표 머리글은 상수가 아니다** — JSX 와 템플릿
// 문자열 안에 박혀 있어 import 로 꺼낼 수가 없다. 값을 못 읽으면 소스를 볼 수밖에 없다.
//
// 무엇을 지키나. 2026-09-11 에 계약서 조항을 '이용료' 로 통일했는데 표 머리글 일곱 자리가
// '입실료' 로 남아, **조항은 이용료인데 바로 위 표는 입실료인 종이**가 그대로 나갔다. 고치라던
// 그 문제가 문안에서 조판으로 자리만 옮긴 것이었다(2026-09-12 봉합).
//
// **주석은 걷고 본다.** 안 그러면 이 파일의 설명 글자가 스스로 붉게 서고, 반대로 주석에
// "고쳤다"고 적어 두면 통과시키는 그물이 된다(이 저장소에서 실제로 한 번 뚫렸다).
//
// 한계. 낱말의 '존재'만 본다. '이용료' 를 다른 엉뚱한 말로 바꾸는 변경은 못 잡고, 새로 만든
// 파일에 표를 그리면 대상 밖이다. 그 몫은 대상 목록을 늘려서 진다.
//
// 실행: node scripts/check-contract-fee-term-typeset.mjs
import { readFileSync } from 'node:fs'

const OLD = '입실료'
const NEW = '이용료'

// 계약서 종이를 그리는 자리. 늘어나면 여기에 더한다.
const FILES = [
  'lib/contractPrintHtml.ts',
  'app/contract/[tenantId]/ContractView.tsx',
]

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

const violations = []
let newHits = 0

for (const f of FILES) {
  let raw
  try {
    raw = readFileSync(f, 'utf8')
  } catch {
    violations.push(`${f} — 파일이 없다. 계약서 조판이 옮겨갔다면 이 가드의 대상도 함께 옮겨라.`)
    continue
  }
  const src = stripComments(raw)

  const old = (src.match(new RegExp(OLD, 'g')) ?? []).length
  if (old > 0) {
    violations.push(
      `${f} — 옛 용어 '${OLD}' 가 ${old}회 남았다. 조항은 '${NEW}' 인데 표 머리글만 옛 이름이면 ` +
      '한 장 안에서 같은 돈을 두 이름으로 부른다(2026-09-11 운영자 결정).',
    )
  }

  // 문장을 통째로 지우는 회피를 막는다 — 새 용어가 실제로 그 자리에 있어야 한다.
  const cur = (src.match(new RegExp(NEW, 'g')) ?? []).length
  newHits += cur
  if (cur === 0) {
    violations.push(`${f} — 새 용어 '${NEW}' 가 한 번도 안 나온다. 표 머리글이 사라졌거나 다른 말로 바뀌었다.`)
  }
}

if (violations.length > 0) {
  console.error(`[계약서 조판 용어] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`[계약서 조판 용어] 위반 0건 (파일 ${FILES.length}개 · '${NEW}' ${newHits}회 · '${OLD}' 0회)`)
