// 계약서·동의서 코드 기본값에서 약관규제법상 무효 소지 문안이 되살아나는지 감시 — 읽기 전용, 위반 시 exit 1.
//
// 왜 있나(법률 패널 2026-09-09). 같은 양식을 여러 입실자에게 쓰므로 약관규제법이 적용된다.
// 패널이 무효 소지 조항 셋을 지목했고 그 셋의 문안을 갈았다.
//   (1) 서약문 — "위반 시 어떠한 조치에도 이의를 제기하지 않는다"는 고객의 항변권 배제(무효).
//   (2) 1절 4항 — 법적 절차 "모든 비용" 부담(6조 2항 1호·8조 무효 소지).
//   (3) 임의처분 동의서 — 고소권 사전 포기(무효)와 민사 청구 포기(14조 1호 무효).
//
// **문자열이 아니라 값을 본다.** 소스를 정규식으로 훑으면 이 파일이나 knowledge 노트가 옛 문안을
// 인용하는 것만으로 붉게 서고, 반대로 주석이 "고쳤다"고 적혀 있으면 통과시키는 그물이 된다.
// 그래서 lib/contract 를 실제로 불러 상수값을 읽는다 — 값이 되돌아가야만 잡힌다.
//
// **DB 저장본은 이 그물의 대상이 아니다.** 영업장이 환경설정에서 자기 문안을 쓰는 칸이라
// 코드가 강제할 수 없다. 저장본 교체는 scripts/fix-unfair-contract-clauses.ts 가 한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CONTRACT_TEMPLATE,
  DEFAULT_DISPOSAL_CONSENT,
  DEFAULT_SUB_LEASE_ADDENDUM,
  DEFAULT_SHORT_STAY_ADDENDUM,
  DEFAULT_EARLY_CHECKOUT_ADDENDUM,
  DEFAULT_ROOM_SCHEDULE_ADDENDUM,
} from '../lib/contract'

// 되살아나면 안 되는 문안. 조각으로 잡는 이유는 앞뒤를 조금 고쳐 다시 넣는 길까지 막기 위함이다.
const BANNED: { frag: string; why: string }[] = [
  { frag: '어떠한 조치에도 이의를 제기하지', why: '(1) 서약문 — 고객 항변권 배제(약관규제법 무효 소지)' },
  { frag: '모든 비용은 입실자가 부담',       why: '(2) 법적 절차 비용 — 6조 2항 1호·8조 무효 소지' },
  { frag: '어떠한 이의도 제기하지',          why: '(3) 동의서 — 고소권 사전 포기·민사 청구 포기(14조 1호)' },
  { frag: '이의를 제기하지 않을 것을 서약',  why: '(3) 동의서 — 같은 클래스의 변형' },
]

// 반드시 남아 있어야 하는 문안. 금지어만 보면 "문장을 통째로 지운다"는 회피로 뚫린다 —
// 서약문이 빈 문자열이 되어도 금지어는 사라지므로 그물이 눈을 감는다.
const REQUIRED: { where: string; text: string; got: () => string }[] = [
  {
    where: 'DEFAULT_CONTRACT_TEMPLATE.oathText',
    text: '위 계약 내용과 생활 수칙을 모두 읽고 이해하였으며, 위반 시 본 계약서에 정한 바에 따라 계약 해지 등의 조치가 있을 수 있음을 확인하고 서명합니다.',
    got: () => DEFAULT_CONTRACT_TEMPLATE.oathText,
  },
  {
    where: 'DEFAULT_DISPOSAL_CONSENT.body (승낙 확인)',
    text: '위 동의 범위 안에서 이루어진 개방·반출·보관·처분은 본인의 승낙에 따른 것임을 확인합니다.',
    got: () => DEFAULT_DISPOSAL_CONSENT.body,
  },
  {
    // 설명의무 이행 증거라 살린 줄이다. 앞줄을 고치면서 함께 지워지기 쉬워 따로 지킨다.
    where: 'DEFAULT_DISPOSAL_CONSENT.body (설명의무)',
    text: '본인은 위 특약의 의미와 법적 효력을 관리자로부터 충분히 설명을 듣고 이해하였으며, 자유로운 의사에 따라 이에 동의합니다.',
    got: () => DEFAULT_DISPOSAL_CONSENT.body,
  },
]

// 금지어를 훑을 범위 — 종이에 찍히는 코드 기본 문안 전부. 새 특약 상수가 생기면 여기 더한다.
function corpus(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  const t = DEFAULT_CONTRACT_TEMPLATE
  out.push({ where: 'DEFAULT_CONTRACT_TEMPLATE.title', text: t.title })
  out.push({ where: 'DEFAULT_CONTRACT_TEMPLATE.oathText', text: t.oathText })
  t.sections.forEach((s, i) => {
    out.push({ where: `DEFAULT_CONTRACT_TEMPLATE.sections[${i}].title`, text: s.title })
    s.items.forEach((it, j) => out.push({ where: `DEFAULT_CONTRACT_TEMPLATE.sections[${i}].items[${j}]`, text: it }))
  })
  out.push({ where: 'DEFAULT_DISPOSAL_CONSENT.title', text: DEFAULT_DISPOSAL_CONSENT.title })
  out.push({ where: 'DEFAULT_DISPOSAL_CONSENT.body', text: DEFAULT_DISPOSAL_CONSENT.body })
  const addenda = {
    DEFAULT_SUB_LEASE_ADDENDUM,
    DEFAULT_SHORT_STAY_ADDENDUM,
    DEFAULT_EARLY_CHECKOUT_ADDENDUM,
    DEFAULT_ROOM_SCHEDULE_ADDENDUM,
  }
  for (const [name, a] of Object.entries(addenda)) {
    out.push({ where: `${name}.title`, text: a.title })
    a.items.forEach((it, j) => out.push({ where: `${name}.items[${j}]`, text: it }))
  }
  return out
}

// 축 3 — 배선. 문안만 지키면 "값은 그대로 두고 종이에서 그 줄을 안 그리는" 길로 뚫린다.
// 상수는 새 문장을 담은 채 통과하고 종이에는 서약문이 아예 안 실린다(체크리스트 F 의
// '호출을 지운 역주입'과 같은 클래스). 그래서 종이 두 겹이 지금도 그 값을 그리는지 본다.
// 주석은 지우고 본다 — 주석의 글자로 통과하는 그물은 그물이 아니다.
const WIRED: { file: string; must: RegExp; why: string }[] = [
  {
    file: 'lib/contractPrintHtml.ts',
    must: /renderContractText\(\s*d\.template\.oathText/,
    why: '인쇄 HTML 이 서약문을 그리지 않으면 확정 문안이 종이에 안 실린다',
  },
  {
    file: 'app/contract/[tenantId]/ContractView.tsx',
    must: /renderContractText\(\s*view\.oathText/,
    why: '계약서 화면이 서약문을 그리지 않으면 확정 문안이 화면·PDF 에 안 실린다',
  },
]

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const problems: string[] = []

for (const w of WIRED) {
  const src = stripComments(readFileSync(join(process.cwd(), w.file), 'utf8'))
  if (!w.must.test(src)) {
    problems.push(`배선 끊김 — ${w.file}\n    찾는 호출: ${w.must}\n    근거: ${w.why}`)
  }
}

for (const line of corpus()) {
  for (const b of BANNED) {
    if (typeof line.text === 'string' && line.text.includes(b.frag)) {
      problems.push(`무효 소지 문안 복귀 — ${line.where}\n    금지 문안: "${b.frag}"\n    근거: ${b.why}`)
    }
  }
}

for (const r of REQUIRED) {
  const got = r.got()
  if (typeof got !== 'string' || !got.includes(r.text)) {
    problems.push(`확정 문안 실종 — ${r.where}\n    있어야 할 문장: "${r.text}"\n    지금 값: ${JSON.stringify(String(got).slice(0, 120))}`)
  }
}

if (problems.length) {
  console.error(`[check-contract-unfair-clause] 위반 ${problems.length}건`)
  for (const p of problems) console.error('  - ' + p)
  console.error('\n  법률 패널이 확정한 문안이다. 되돌리려면 운영자 승인이 필요하다(knowledge/domain-contracts.md).')
  process.exit(1)
}

console.log(`[check-contract-unfair-clause] OK — 검사 ${corpus().length}줄, 금지 문안 ${BANNED.length}종, 확정 문안 ${REQUIRED.length}건, 배선 ${WIRED.length}곳 모두 제자리.`)
