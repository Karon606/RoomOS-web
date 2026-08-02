// 저장된 계약서 템플릿의 청소비 자리표시자를 조항 단위 변수로 이관 (운영자 확인 2026-08-03).
//
// 왜
//   {{청소비}} 는 금액만 치환한다. 청소비 0원 계약(실측 41건 중 29건)에서
//     화면 "청소비 0원은 퇴실 후 실내 청소 용역의 대가입니다"
//     인쇄 "청소비 은 퇴실 후 실내 청소 용역의 대가입니다"
//   가 되어 비문이 되고, 없는 금액에 대해 '공제하겠다'는 채무를 선언한다.
//   운영자 확인 — "청소비 없음으로 (아마 전 원장 때 입실한 사람들의 내역일 것으로 예상됨)".
//
// 무엇을 바꾸나 — **문안은 그대로 두고 자리표시자만 바꾼다.** 운영자가 직접 쓴 문장이다.
//   §2-1  "... 남은 금액을 환불합니다. (보증금 내 청소비 {{청소비}} 별도 공제)"
//      -> "... 남은 금액을 환불합니다.{{청소비공제}}"        (0원이면 괄호째 사라진다)
//   §2-4  "[청소비] 청소비 {{청소비}}은 퇴실 후 ... 함께 받습니다."
//      -> "{{청소비조항}}"                                   (0원이면 '청소비가 없습니다'로 바뀐다)
// 치환값은 lib/contract 의 cleaningFeeVars 정본이 만든다. 화면·인쇄가 같은 문자열을 쓴다.
//
// 실행:   npx tsx --env-file=.env.local scripts/migrate-cleaning-clause-vars.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const DEDUCT_OLD = ' (보증금 내 청소비 {{청소비}} 별도 공제)'
const DEDUCT_NEW = '{{청소비공제}}'
const CLAUSE_OLD = '[청소비] 청소비 {{청소비}}은 퇴실 후 실내 청소 용역의 대가입니다. 보증금이 있는 경우 퇴실 정산 시 보증금에서 공제하고, 보증금이 없는 경우 입실 시 이용료와 함께 받습니다.'
const CLAUSE_NEW = '{{청소비조항}}'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

function walk(node: unknown, fn: (s: string) => string): unknown {
  if (typeof node === 'string') return fn(node)
  if (Array.isArray(node)) return node.map(n => walk(n, fn))
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v, fn)
    return out
  }
  return node
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const props = await prisma.property.findMany({ select: { id: true, name: true, contractTemplate: true } })

  let changed = 0
  for (const prop of props) {
    if (!prop.contractTemplate) { console.log(`  ${prop.name} — 저장 템플릿 없음(기본값 사용). 건너뜀`); continue }
    const before = JSON.stringify(prop.contractTemplate)
    const next = walk(prop.contractTemplate, s => revert
      ? s.replace(CLAUSE_NEW, CLAUSE_OLD).replace(DEDUCT_NEW, DEDUCT_OLD)
      : s.replace(CLAUSE_OLD, CLAUSE_NEW).replace(DEDUCT_OLD, DEDUCT_NEW))
    const after = JSON.stringify(next)
    if (before === after) { console.log(`  ${prop.name} — 바꿀 자리 없음(이미 이관됐거나 문안이 다름)`); continue }
    changed++
    console.log(`  ${prop.name} — 이관 대상`)
    for (const [label, o, n] of [['공제 괄호', DEDUCT_OLD, DEDUCT_NEW], ['청소비 조항', CLAUSE_OLD, CLAUSE_NEW]] as const) {
      const from = revert ? n : o, to = revert ? o : n
      if (before.includes(JSON.stringify(from).slice(1, -1))) console.log(`     ${label}: ${from.slice(0, 40)}... -> ${to}`)
    }
    if (apply) await prisma.property.update({ where: { id: prop.id }, data: { contractTemplate: next as object } })
  }

  console.log(apply ? `\n${changed}건 반영 완료` : '\n실제 반영: --apply · 되돌리기: --revert --apply')
  await prisma.$disconnect()
}

void main()
