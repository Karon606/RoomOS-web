// 영업장 계약서의 청소비 조항 보완 — 2026-08-02.
//
// 왜: 청소비의 성격이 문구에 없으면 (a) 수익 인식 시점이 입실월인지 퇴실월인지 근거가 없고,
// (b) 부가세에서 용역 대가(과세)인지 손해배상(불과세)인지 판정이 갈린다(회계 패널).
// 그리고 보증금 없는 단기는 입실 때 청소비를 따로 받는데 종전 문구가 그 경우를 다루지 않았다.
//
// 최소 개입 원칙 — 운영자가 직접 쓴 문장이므로 조항을 새로 쓰지 않는다.
//   · 하드코딩된 '2만 원'을 {{청소비}} 치환으로 바꾼다(계약별 설정값을 따르게)
//   · '퇴실 및 환불' 절에 청소비 성격을 밝히는 항목 하나를 덧붙인다
// 원본은 백업 컬럼이 없으므로 실행 전 JSON 을 파일로 떨어뜨려 되돌릴 수 있게 한다.
//
// 실행: node --env-file=.env.local scripts/patch-cleaning-fee-clause.mjs [--apply]
// 되돌리기: --restore <백업파일경로>
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileSync, readFileSync } from 'fs'

const NEW_ITEM = '[청소비] 청소비 {{청소비}}은 퇴실 후 실내 청소 용역의 대가입니다. 보증금이 있는 경우 퇴실 정산 시 보증금에서 공제하고, 보증금이 없는 경우 입실 시 이용료와 함께 받습니다.'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const restoreIdx = argv.indexOf('--restore')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

if (restoreIdx >= 0) {
  const file = argv[restoreIdx + 1]
  if (!file) { console.log('사용법: --restore <백업파일경로>'); process.exit(1) }
  const backup = JSON.parse(readFileSync(file, 'utf8'))
  for (const b of backup) {
    await prisma.property.update({ where: { id: b.id }, data: { contractTemplate: b.contractTemplate } })
    console.log(`복원: ${b.name}`)
  }
  await prisma.$disconnect()
  process.exit(0)
}

const props = await prisma.property.findMany({ select: { id: true, name: true, contractTemplate: true } })
const backup = []
const plans = []

for (const p of props) {
  if (!p.contractTemplate) { console.log(`${p.name}: 덮어쓴 템플릿 없음(기본값 사용) — 코드 수정으로 이미 반영됨`); continue }
  const tpl = typeof p.contractTemplate === 'string' ? JSON.parse(p.contractTemplate) : p.contractTemplate
  const sections = tpl.sections ?? tpl
  const next = JSON.parse(JSON.stringify(tpl))
  const nextSections = next.sections ?? next
  const changes = []

  for (const sec of nextSections) {
    sec.items = sec.items.map(it => {
      // 하드코딩 금액을 치환 변수로 — '청소비 2만 원' / '청소비 20,000원' 형태를 모두 잡는다
      const replaced = it
        .replace(/청소비\s*2만\s*원/g, '청소비 {{청소비}}')
        .replace(/청소비\s*20,?000\s*원/g, '청소비 {{청소비}}')
      if (replaced !== it) changes.push(`  금액 치환: "${it.trim().slice(0, 60)}..."`)
      return replaced
    })
  }
  // '퇴실 및 환불' 절에 청소비 성격 항목 추가(이미 있으면 건너뜀)
  const target = nextSections.find(s => /퇴실/.test(s.title))
  if (target && !target.items.some(i => i.includes('청소 용역의 대가'))) {
    target.items.push(NEW_ITEM)
    changes.push(`  항목 추가(${target.title}): "${NEW_ITEM.slice(0, 60)}..."`)
  }

  if (!changes.length) { console.log(`${p.name}: 바꿀 것 없음`); continue }
  console.log(`\n${p.name}`)
  for (const c of changes) console.log(c)
  backup.push({ id: p.id, name: p.name, contractTemplate: p.contractTemplate })
  plans.push({ id: p.id, next })
}

if (!apply) {
  console.log('\n  실제 반영: --apply')
  await prisma.$disconnect()
  process.exit(0)
}

const stamp = backup.length ? `contract-template-backup-${Date.now()}.json` : null
if (stamp) {
  writeFileSync(stamp, JSON.stringify(backup, null, 2))
  console.log(`\n  백업 저장: ${stamp} (되돌리기: --restore ${stamp})`)
}
for (const pl of plans) {
  await prisma.property.update({ where: { id: pl.id }, data: { contractTemplate: pl.next } })
}
console.log(`  완료 — ${plans.length}개 영업장`)
await prisma.$disconnect()
