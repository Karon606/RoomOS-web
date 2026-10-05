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
// **DB 저장본은 `--db` 로만 본다**(verify:db 등록, 2026-10-05). 영업장이 환경설정에서 자기 문안을
// 쓰는 칸이라 코드가 덮지는 않는다(교체는 scripts/fix-unfair-contract-clauses.ts 류가 예행 뒤에 한다).
// 그래도 **보기는 해야 한다** — 운영자 원문이 "보증금 반환불가 등 페널티를 넣고 싶다"였다. 코드
// 기본값만 지키면 같은 문장이 설정 화면으로 들어와 종이에 나가도 아무 데서도 안 운다.
// verify:fast 는 DB 를 안 읽으므로 같은 파일을 `--db` 로 한 번 더 돌린다 — 금지 표가 한 벌이라
// 쌍둥이 표를 따로 고칠 일이 없다.
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
import { parseSignDocuments } from '../lib/signDocuments'

// 되살아나면 안 되는 문안. 조각으로 잡는 이유는 앞뒤를 조금 고쳐 다시 넣는 길까지 막기 위함이다.
const BANNED: { frag: string; why: string }[] = [
  { frag: '어떠한 조치에도 이의를 제기하지', why: '(1) 서약문 — 고객 항변권 배제(약관규제법 무효 소지)' },
  { frag: '모든 비용은 입실자가 부담',       why: '(2) 법적 절차 비용 — 6조 2항 1호·8조 무효 소지' },
  { frag: '어떠한 이의도 제기하지',          why: '(3) 동의서 — 고소권 사전 포기·민사 청구 포기(14조 1호)' },
  { frag: '이의를 제기하지 않을 것을 서약',  why: '(3) 동의서 — 같은 클래스의 변형' },
  // (4) 보증금 전액 몰취(법률 패널 2026-10-05). 통보 기한 위반에 보증금을 통째로 안 돌려주는 조항은
  // 약관규제법 8조(과중한 손해배상 예정) 무효 소지이고, 2절 1항이 공정위 기준을 약정하고 있어
  // 같은 종이 안에서 자기모순이다. 채택안은 '부족한 일수 × 일할, 상한 7일분'이다(아래 REQUIRED).
  { frag: '보증금 반환불가',                 why: '(4) 보증금 전액 몰취 — 약관규제법 8조 무효 소지' },
  { frag: '보증금 반환 불가',                why: '(4) 보증금 전액 몰취 — 같은 클래스의 띄어쓰기 변형' },
  { frag: '보증금은 반환하지 않',            why: '(4) 보증금 전액 몰취 — 같은 클래스의 변형' },
  { frag: '보증금을 반환하지 않',            why: '(4) 보증금 전액 몰취 — 같은 클래스의 변형' },
  { frag: '몰취',                            why: '(4) 보증금 전액 몰취 — 같은 클래스의 변형' },
]

// 2절의 새 배상 문장(법률 패널·운영자 확정 2026-10-05, 글자 그대로). 위치까지 본다 — 다른 절로
// 옮겨지면 '7일 전까지'가 무엇의 기한인지 끊긴다.
const NOTICE_PENALTY =
  '7일 전까지 알리지 않은 경우, 부족한 통보 일수만큼의 이용료(1일 이용요금은 월 이용료의 30분의 1)를 공실 손해의 배상으로 청구하며 보증금에서 우선 공제합니다. 이 금액은 7일분을 넘지 않으며, 중도 퇴실 위약금과 겹치면 둘 중 큰 금액만 적용합니다.'

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
  {
    // 금지어만 보면 '조항을 통째로 지운다'로 뚫린다. 그러면 7일 통보 조항이 다시 불이익 없는 공문이 되고,
    // 운영자가 원래 원하던 '보증금 반환불가'를 손으로 적어 넣을 이유가 되살아난다.
    where: "DEFAULT_CONTRACT_TEMPLATE.sections[id='checkout'].items (통보 지연 배상)",
    text: NOTICE_PENALTY,
    got: () => (DEFAULT_CONTRACT_TEMPLATE.sections.find(s => s.id === 'checkout')?.items ?? []).join('\n'),
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

// ── 축 4 — DB 저장본(--db 일 때만) ───────────────────────────────────────
// 종이에 실리는 저장 문안 전부를 같은 금지 표로 훑는다. 영업장 본문·서약문, 조건부 특약 넷,
// 임의처분 동의서, 추가 서류, 입실자별 본문 사본(contractOverride).
// **박제는 안 본다.** 서명본·발급본 스냅샷은 그때 서명한 종이라 고칠 수 없고, 여기서 붉게 세우면
// 해소할 길이 없는 경보가 된다.
type Line = { where: string; text: string }

function templateLines(label: string, raw: unknown): Line[] {
  if (!raw || typeof raw !== 'object') return []
  const t = raw as { title?: unknown; oathText?: unknown; emergencyContactNote?: unknown; sections?: unknown }
  const out: Line[] = []
  const push = (where: string, v: unknown) => { if (typeof v === 'string') out.push({ where: `${label}.${where}`, text: v }) }
  push('title', t.title)
  push('oathText', t.oathText)
  push('emergencyContactNote', t.emergencyContactNote)
  if (Array.isArray(t.sections)) {
    t.sections.forEach((s: unknown, i: number) => {
      const sec = (s ?? {}) as { title?: unknown; items?: unknown }
      push(`sections[${i}].title`, sec.title)
      if (Array.isArray(sec.items)) sec.items.forEach((it: unknown, j: number) => push(`sections[${i}].items[${j}]`, it))
    })
  }
  return out
}

function titledLines(label: string, raw: unknown): Line[] {
  if (!raw || typeof raw !== 'object') return []
  const d = raw as { title?: unknown; body?: unknown; items?: unknown }
  const out: Line[] = []
  if (typeof d.title === 'string') out.push({ where: `${label}.title`, text: d.title })
  if (typeof d.body === 'string') out.push({ where: `${label}.body`, text: d.body })
  if (Array.isArray(d.items)) d.items.forEach((it: unknown, j: number) => { if (typeof it === 'string') out.push({ where: `${label}.items[${j}]`, text: it }) })
  return out
}

async function storedProblems(): Promise<{ problems: string[]; summary: string }> {
  // verify:fast 는 DB 접속 정보 없이 돈다. 거기서 클라이언트를 만들지 않도록 이 갈래 안에서만 부른다.
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const out: string[] = []
  try {
    const props = await prisma.property.findMany({
      select: {
        name: true, contractTemplate: true, disposalConsentTemplate: true, signDocuments: true,
        subLeaseAddendum: true, shortStayAddendum: true, earlyCheckoutAddendum: true, roomScheduleAddendum: true,
      },
    })
    const leases = await prisma.leaseTerm.findMany({
      where: { contractOverride: { not: null } },
      select: { contractOverride: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
    })

    let lines = 0
    let withTemplate = 0
    let templateExpected = 0
    let templateScanned = 0
    const scan = (owner: string, rows: Line[]) => {
      lines += rows.length
      for (const line of rows) {
        if (line.where.startsWith('contractTemplate.')) templateScanned++
        for (const b of BANNED) {
          if (line.text.includes(b.frag)) {
            out.push(`저장본 무효 소지 문안 — ${owner} ${line.where}\n    금지 문안: "${b.frag}"\n    근거: ${b.why}`)
          }
        }
      }
    }
    for (const p of props) {
      const tpl = templateLines('contractTemplate', p.contractTemplate)
      if (p.contractTemplate) { withTemplate++; templateExpected += tpl.length }
      scan(p.name, tpl)
      scan(p.name, titledLines('disposalConsentTemplate', p.disposalConsentTemplate))
      scan(p.name, titledLines('subLeaseAddendum', p.subLeaseAddendum))
      scan(p.name, titledLines('shortStayAddendum', p.shortStayAddendum))
      scan(p.name, titledLines('earlyCheckoutAddendum', p.earlyCheckoutAddendum))
      scan(p.name, titledLines('roomScheduleAddendum', p.roomScheduleAddendum))
      parseSignDocuments(p.signDocuments).forEach(d => scan(p.name, titledLines(`signDocuments[${d.key}]`, d)))
    }
    for (const l of leases) {
      scan(`${l.room?.roomNo ?? '-'}호 ${l.tenant?.name ?? '-'}`, templateLines('contractOverride', l.contractOverride))
    }

    // 자기 점검 — 계약서 저장본이 있는데 그 줄을 못 읽었거나 읽고도 안 훑었다면 이 축은 눈을 감은
    // 채 초록이다(저장 모양이 바뀌었거나, 위 scan 호출이 지워졌다). 체크리스트 F 의 '호출을 지운
    // 역주입' 클래스다. 다른 문안(동의서 등)의 줄 수로는 못 가린다 — 그래서 본문 줄만 따로 센다.
    if (withTemplate > 0 && (templateExpected === 0 || templateScanned < templateExpected)) {
      out.push(`검사 누락 — 계약서 저장본 ${withTemplate}곳에서 읽은 본문 ${templateExpected}줄 중 ${templateScanned}줄만 훑었다. 이 파일의 templateLines·scan 배선을 확인하라.`)
    }
    return {
      problems: out,
      summary: `DB 저장본 — 영업장 ${props.length}곳(계약서 저장본 ${withTemplate}) · 입실자별 사본 ${leases.length}건 · 훑은 줄 ${lines}`,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  let dbSummary = ''
  if (process.argv.includes('--db')) {
    const r = await storedProblems()
    problems.push(...r.problems)
    dbSummary = ` ${r.summary}.`
  }

  if (problems.length) {
    console.error(`[check-contract-unfair-clause] 위반 ${problems.length}건`)
    for (const p of problems) console.error('  - ' + p)
    console.error('\n  법률 패널이 확정한 문안이다. 되돌리려면 운영자 승인이 필요하다(knowledge/domain-contracts.md).')
    console.error('  저장본 위반은 영업장이 설정 > 계약서에 적은 문안이다. 코드가 덮지 않으니 운영자에게 알리고 그 화면에서 고친다.')
    process.exit(1)
  }

  console.log(`[check-contract-unfair-clause] OK — 검사 ${corpus().length}줄, 금지 문안 ${BANNED.length}종, 확정 문안 ${REQUIRED.length}건, 배선 ${WIRED.length}곳 모두 제자리.${dbSummary}`)
}

main().catch(e => { console.error(e); process.exit(1) })
