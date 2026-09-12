// 일본어 번역본의 '入室·退室' 을 '入居·退去' 로, 주어 잃은 '負担します' 를 바로잡는다 — 기본은 예행.
//
// 왜 있나(운영자 결정 2026-09-12). 일본어에서 `入室` 은 방에 들어가는 **동작**이지 이사의 뜻이
// 아니다. 일본 월세 계약은 `入居`·`退去` 를 쓴다. 번역가 패널과 운영자가 직접 물은 일본인 원어민이
// **독립적으로 같은 지적**을 했다. '이용료'를 한자 그대로 옮겨도 되느냐는 물음에서 나온 것으로,
// 요금 이름(`利用料`)은 건너갔는데 입실은 안 건너간 자리다.
//
// 함께 고치는 것 하나. `契約した期間の利用料を負担します` 는 주어가 없어 **작성 주체(운영자)가
// 낸다는 뜻으로 읽힐 여지**가 있다. 한국어는 "입실자가 부담합니다"다. 돈을 누가 내는지가 뒤집혀
// 읽히는 것이라 용어 논쟁과 성격이 다르다. 살아있는 줄 10개를 훑어 이 한 줄뿐임을 확인했다.
//
// **요금 이름은 안 건드린다.** `利用料` 유지가 확정이다(운영자 2026-09-12). 원어민은 `賃料`·`家賃`
// 를 권했으나 그 말은 일본 借家 관행의 기대(해약 예고·갱신 거절 정당사유·原状回復·敷金)를 끌고
// 오는데, 이 계약은 기본 1개월에 즉시 퇴실 조항이 있어 정면으로 어긋난다. 그 어긋남은 약관규제법
// 제3조 제3항의 설명의무 쪽에서 사업자에게 불리하게 돌아온다. `宿泊料` 계열은 공중위생관리법상
// 미신고 숙박업으로 읽힐 위험까지 새로 끌어온다(법무 패널 2026-09-12).
//
// 무엇을 고치나. **Property.contractTranslations.langs.ja.dict 의 값뿐이다.**
//   - 열쇠(한국어)는 한 글자도 안 건드린다. 열쇠가 바뀌면 그 줄 번역이 통째로 고아가 된다.
//   - 다른 언어는 안 본다. 중국어 `入住` 는 그 언어에서 올바른 말이다.
//
// 무엇을 안 고치나. **박제는 손대지 않는다.** ContractShareLink 의 서명본, ContractFile 의 발급본,
// LeaseTerm 의 signedContractSnapshot·contractVersionArchive 는 "그 사람이 그때 서명한 종이"라
// 지금 문안으로 덮으면 서명 증거가 사라지고 드리프트 감지가 거짓말을 한다.
//
// 안전장치 셋. 하나라도 걸리면 **아무것도 안 쓰고** 멈춘다.
//   (1) DB 의 지금 값이 문안표의 `ja_before` 와 **글자 단위로 같아야** 한다. 다르면 그 사이 누가
//       고쳤다는 뜻이라 덮어쓰면 그 수정이 사라진다.
//   (2) `{{자리표시자}}` 가 before 와 after 에서 **같은 것이 같은 수만큼** 있어야 한다. 하나라도
//       잃으면 종이가 금액이나 표를 잃는다.
//   (3) `入室`·`退室` 이 after 에 남아 있으면 멈춘다. 일부러 남긴 자리는 문안표가 `keep` 로 밝힌다.
//
// 실행:
//   예행  npx tsx --env-file=.env.local scripts/fix-ja-residency-term.ts <문안표.json>
//   적용  npx tsx --env-file=.env.local scripts/fix-ja-residency-term.ts <문안표.json> --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync } from 'node:fs'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const APPLY = process.argv.includes('--apply')
const TABLE = process.argv.find(a => a.endsWith('.json'))

type Row = { n: number; ja_before: string; ja_after: string; changed: boolean; note?: string; keep?: boolean }

/** `{{이름}}` 을 세어 이름별 개수로 만든다. 순서가 아니라 구성으로 견준다. */
function placeholders(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of s.match(/\{\{[^}]+\}\}/g) ?? []) m.set(p, (m.get(p) ?? 0) + 1)
  return m
}

function samePlaceholders(a: string, b: string): boolean {
  const x = placeholders(a), y = placeholders(b)
  if (x.size !== y.size) return false
  for (const [k, v] of x) if (y.get(k) !== v) return false
  return true
}

async function main() {
  if (!TABLE) throw new Error('문안표 JSON 경로를 인자로 달아라.')
  const table = JSON.parse(readFileSync(TABLE, 'utf8')) as Row[]
  const rows = table.filter(r => r.changed)
  console.log(`문안표 ${table.length}줄 · 그중 고칠 것 ${rows.length}줄 · ${APPLY ? '적용' : '예행'}\n`)

  const props = await prisma.property.findMany({ select: { id: true, name: true, contractTranslations: true } })
  const blockers: string[] = []
  const plan: { id: string; name: string; next: unknown; hits: Row[] }[] = []

  for (const p of props) {
    const raw = p.contractTranslations as { enabled?: boolean; langs?: Record<string, { dict?: Record<string, string> }> } | null
    const dict = raw?.langs?.ja?.dict
    if (!dict) continue

    const hits: Row[] = []
    const nextDict: Record<string, string> = { ...dict }

    for (const r of rows) {
      // 값으로 찾는다. 열쇠(한국어)를 인자로 받지 않는 이유는, 열쇠에는 탭·줄바꿈이 섞여 있어
      // 옮겨 적는 과정에서 조용히 어긋나기 때문이다. 값은 문안표가 DB 에서 그대로 떠 온 것이다.
      const key = Object.keys(nextDict).find(k => nextDict[k] === r.ja_before)
      if (!key) continue
      if (!samePlaceholders(r.ja_before, r.ja_after)) {
        blockers.push(`${p.name} #${r.n} — 자리표시자가 달라졌다. 종이가 금액이나 표를 잃는다.`)
        continue
      }
      if (!r.keep && /[入退]室/.test(r.ja_after)) {
        blockers.push(`${p.name} #${r.n} — 고친 문안에 아직 入室·退室 이 남았다: ${r.ja_after.slice(0, 60)}`)
        continue
      }
      nextDict[key] = r.ja_after
      hits.push(r)
    }

    // 문안표에 있는데 DB 에서 못 찾은 줄 — 그 사이 누가 고쳤거나 문안표가 낡았다.
    for (const r of rows) {
      if (hits.includes(r)) continue
      if (Object.values(dict).some(v => v === r.ja_after)) continue // 이미 반영돼 있다
      blockers.push(`${p.name} #${r.n} — DB 에서 지금 값을 못 찾았다(그 사이 바뀌었거나 문안표가 낡았다).`)
    }

    if (hits.length === 0) continue
    plan.push({
      id: p.id, name: p.name, hits,
      next: { ...raw, langs: { ...raw!.langs, ja: { ...raw!.langs!.ja, dict: nextDict } } },
    })
  }

  for (const pl of plan) {
    console.log(`[${pl.name}] ${pl.hits.length}줄`)
    for (const r of pl.hits) console.log(`   #${String(r.n).padStart(2)}  ${r.note ?? ''}`)
  }

  if (blockers.length > 0) {
    console.error(`\n막혔다. ${blockers.length}건 — 아무것도 안 썼다.`)
    for (const b of blockers) console.error(`  - ${b}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  if (!APPLY) {
    console.log(`\n예행이다. 쓰려면 --apply 를 달아라.`)
    await prisma.$disconnect()
    return
  }

  for (const pl of plan) {
    await prisma.property.update({ where: { id: pl.id }, data: { contractTranslations: pl.next as never } })
    console.log(`\n[${pl.name}] ${pl.hits.length}줄 적용`)
  }
  console.log(`\n끝. 영업장 ${plan.length}곳.`)
  await prisma.$disconnect()
}

main()
