// 같은 품명 안에서 표기만 다른 같은 서술 규격(specText)이 갈려 있는지 감사한다. 읽기 전용, 새 갈림이면 exit 1.
//
// 왜 필요한가(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 비품 카드 묶음 키에 서술 규격 글자가 그대로 들어가서,
// '폭 183cm · 두께 1.8T'(5~8월)와 영수증 자동 읽기의 '183cm, 1.8T'(10-20)가 같은 장판인데 카드 둘로 섰다. 생성 경로는
// 지난 기록 맞추기(lib/itemVariants)로 막았다. 이 감사는 그 뒤에 같은 갈림이 **다시 생기는지** 본다. 판정은 정본
// lib/specNotation specNotationKey 하나다(숫자+단위 토큰 동치 AND 글자 토큰 집합 일치, 접두어·구분자 무시).
//
// 경고와 실패. 갈린 두 표기의 행이 모두 CUTOFF 전에 생겼으면 경고다(그 전의 갈림은 정리 대기다. 원목무늬 장판은 운영자가
// 비품 화면 '합치기'로, 방에 배정된 행은 scripts/fix-spec-notation-room-row.ts 로 정리한다). 한쪽이라도 CUTOFF 이후에
// 생긴 행이면 생성 경로가 다시 샌 것이라 실패다.
//
// 사용: npx tsx --env-file=.env.local scripts/check-spec-notation-split.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { specNotationKey } from '../lib/specNotation'

// 생성 경로 봉합(지난 기록 맞추기) 이후. 이 시각 뒤에 생긴 행이 갈림에 끼면 실패다.
const CUTOFF = new Date('2026-10-28T00:00:00+09:00')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const rows = await prisma.expense.groupBy({
    by: ['propertyId', 'itemLabel', 'specText'],
    where: { itemLabel: { not: null }, specText: { not: null }, isShipping: false },
    _count: { _all: true },
    _max: { createdAt: true },
  })
  const groups = new Map<string, Map<string, { text: string; count: number; newest: Date | null }[]>>()
  for (const r of rows) {
    const text = (r.specText ?? '').trim()
    if (!text) continue
    const g = groups.get(`${r.propertyId}␟${r.itemLabel}`) ?? new Map()
    const k = specNotationKey(text)
    const list = g.get(k) ?? []
    list.push({ text, count: r._count._all, newest: r._max.createdAt })
    g.set(k, list)
    groups.set(`${r.propertyId}␟${r.itemLabel}`, g)
  }
  let warn = 0, fresh = 0
  for (const [gk, byKey] of groups) {
    const label = gk.split('␟')[1]
    for (const list of byKey.values()) {
      if (list.length < 2) continue
      const isFresh = list.some(x => x.newest && x.newest >= CUTOFF)
      if (isFresh) fresh++; else warn++
      list.sort((a, b) => b.count - a.count)
      console.log(`${isFresh ? '[실패]' : '[경고]'} ${label} · 표기만 다른 같은 규격 ${list.length}가지: ${list.map(x => `'${x.text}' ${x.count}건`).join(' / ')}`)
    }
  }
  console.log(warn + fresh === 0
    ? '[규격 표기 갈림] 없음. 정상.'
    : `[규격 표기 갈림] 정리 대기 ${warn}건 · 새 갈림 ${fresh}건${fresh ? '. 영수증·지출 저장이 지난 기록 표기를 따르지 않았다(lib/itemVariants)' : ''}`)
  if (fresh > 0) process.exitCode = 1
  await prisma.$disconnect()
}
main()
