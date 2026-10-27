// 방에 배정된 비품 행 중 표기만 다른 같은 서술 규격으로 적힌 행을 많이 쓴 표기 카드로 합치는 일회성 정리. 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 원목무늬 장판이 '폭 183cm · 두께 1.8T'(33행)와 영수증 자동 읽기의
// '183cm, 1.8T'(2행)로 갈렸다. 창고에 남은 두 카드는 운영자가 비품 화면 '합치기'로 직접 정리하고, 방에 배정된 행만 여기서 합친다.
// 생성 경로는 지난 기록 맞추기(lib/itemVariants)로 막았고, 재발 감지는 scripts/check-spec-notation-split.ts(verify:db)다.
//
// 어떻게. 비품 화면 '합치기'와 **같은 서버 액션(combineAssets)** 을 부른다. 이름·규격·단위·detail 통일, 배정 이력 이동, 병합 기록
// (itemNameMergeRun)이 한 트랜잭션이고, 적용취소는 그 기록을 되돌리는 undoItemNameMerge 다(환경설정 '품명 병합' 목록에서도 된다).
// 행별 규격 수정(setAssetRowSpec)은 쓰지 않는다. 그것은 운영자가 한 행을 고칠 때의 통로다.
//   · 대상 행: 같은 영업장·같은 품명 안에서 서술 규격이 정본 specNotationKey 로 동치인데 글자가 다른 표기 중 **많이 쓴 표기가 아닌** 쪽,
//     그중 방에 배정된 행(roomId 있음). 창고·미배정 행은 건드리지 않는다. --include-unplaced 를 주면 창고·미배정 행도 함께 합친다
//     (2026-10-27 운영자가 창고 두 카드 정리도 맡김).
//   · 합칠 상대(dest): 같은 영업장·품명·카테고리에서 많이 쓴 표기를 가진 행 중 수량 단위·숫자 규격이 대상 행과 같은 가장 최근 행.
//     없으면 건너뛴다(combineAssets 는 단위를 상대 것으로 맞추므로 단위가 다르면 수량이 흔들린다).
//
// 실행: npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.fix-asset-combine.json scripts/fix-spec-notation-room-row.ts [--include-unplaced] [--apply | --revert <undo.json>]
// 되돌림 파일: 저장소 루트의 scripts/.fix-spec-notation-undo-<시각>.json(.gitignore 대상)
import fs from 'node:fs'
import path from 'node:path'
import prisma from '@/lib/prisma'
import { specNotationKey } from '@/lib/specNotation'

const ROOT = path.resolve(__dirname, '..')
const g = globalThis as unknown as { __FIX_PID?: string }
const INCLUDE_UNPLACED = process.argv.includes('--include-unplaced')

type Plan = {
  propertyId: string; itemLabel: string
  src: { id: string; date: string; roomId: string | null; specText: string; qtyValue: number | null; qtyUnit: string | null }
  dest: { id: string; specText: string }
}
type UndoFile = { createdAt: string; runs: (Plan & { runId: string })[] }

async function buildPlan(): Promise<{ plans: Plan[]; skipped: string[] }> {
  const rows = await prisma.expense.groupBy({
    by: ['propertyId', 'itemLabel', 'specText'],
    where: { itemLabel: { not: null }, specText: { not: null }, isShipping: false },
    _count: { _all: true },
  })
  const groups = new Map<string, Map<string, { text: string; count: number }[]>>()
  for (const r of rows) {
    const text = (r.specText ?? '').trim()
    if (!text) continue
    const gk = `${r.propertyId}␟${r.itemLabel}`
    const byKey = groups.get(gk) ?? new Map<string, { text: string; count: number }[]>()
    const k = specNotationKey(text)
    byKey.set(k, [...(byKey.get(k) ?? []), { text: r.specText as string, count: r._count._all }])
    groups.set(gk, byKey)
  }
  const plans: Plan[] = []
  const skipped: string[] = []
  for (const [gk, byKey] of groups) {
    const [propertyId, itemLabel] = gk.split('␟')
    for (const list of byKey.values()) {
      if (list.length < 2) continue
      list.sort((a, b) => b.count - a.count)
      const major = list[0].text
      for (const minor of list.slice(1)) {
        const srcs = await prisma.expense.findMany({
          where: { propertyId, itemLabel, specText: minor.text, ...(INCLUDE_UNPLACED ? {} : { roomId: { not: null } }), isShipping: false },
          select: { id: true, date: true, roomId: true, category: true, specText: true, specValue: true, specUnit: true, qtyValue: true, qtyUnit: true },
          orderBy: { date: 'asc' },
        })
        for (const s of srcs) {
          const dest = await prisma.expense.findFirst({
            where: { propertyId, itemLabel, specText: major, category: s.category, qtyUnit: s.qtyUnit, specValue: s.specValue, specUnit: s.specUnit, isShipping: false },
            select: { id: true, specText: true },
            orderBy: { createdAt: 'desc' },
          })
          if (!dest) { skipped.push(`${itemLabel} 행 ${s.id.slice(0, 8)}: '${major}' 표기에 수량 단위(${s.qtyUnit ?? '없음'})·카테고리가 같은 상대가 없어 건너뜀`); continue }
          plans.push({
            propertyId, itemLabel,
            src: { id: s.id, date: s.date.toISOString().slice(0, 10), roomId: s.roomId, specText: s.specText as string, qtyValue: s.qtyValue, qtyUnit: s.qtyUnit },
            dest: { id: dest.id, specText: dest.specText as string },
          })
        }
      }
    }
  }
  return { plans, skipped }
}

async function roomNoOf(id: string | null): Promise<string> {
  if (!id) return '미배정'
  const r = await prisma.room.findUnique({ where: { id }, select: { roomNo: true } })
  return r?.roomNo ?? id.slice(0, 6)
}

async function revert(file: string) {
  const { undoItemNameMerge } = await import('@/app/(app)/finance/actions')
  const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as UndoFile
  for (const r of snap.runs) {
    g.__FIX_PID = r.propertyId
    const res = await undoItemNameMerge(r.runId)
    if (!res.ok) throw new Error(`되돌리지 못했다(${r.itemLabel} 행 ${r.src.id.slice(0, 8)}, 기록 ${r.runId.slice(0, 8)}): ${res.error}`)
    console.log(`되돌림: ${r.itemLabel} 행 ${r.src.id.slice(0, 8)} '${r.dest.specText}' -> '${r.src.specText}'`)
  }
}

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) return revert(process.argv[revertIdx + 1])
  const apply = process.argv.includes('--apply')

  const { plans, skipped } = await buildPlan()
  for (const p of plans) {
    console.log(`${p.itemLabel} · ${await roomNoOf(p.src.roomId)}${p.src.roomId ? '호' : ''} · ${p.src.date} · ${p.src.qtyValue ?? ''}${p.src.qtyUnit ?? ''}: '${p.src.specText}' -> '${p.dest.specText}' (행 ${p.src.id.slice(0, 8)}, 상대 ${p.dest.id.slice(0, 8)})`)
  }
  for (const s of skipped) console.log(`건너뜀: ${s}`)
  console.log(`대상 ${plans.length}행 · 건너뜀 ${skipped.length}행`)
  if (!apply) { console.log('예행이다. 바꾸려면 --apply.'); return }
  if (!plans.length) return

  const { combineAssets } = await import('@/app/(app)/inventory/assets/actions')
  const runs: UndoFile['runs'] = []
  const file = path.join(ROOT, 'scripts', `.fix-spec-notation-undo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  try {
    for (const p of plans) {
      g.__FIX_PID = p.propertyId
      const res = await combineAssets(p.dest.id, [p.src.id])
      if (!res.ok) throw new Error(`합치지 못했다(${p.itemLabel} 행 ${p.src.id.slice(0, 8)}): ${res.error}`)
      runs.push({ ...p, runId: res.runId })
      console.log(`적용: ${p.itemLabel} 행 ${p.src.id.slice(0, 8)} -> '${p.dest.specText}' (기록 ${res.runId.slice(0, 8)})`)
    }
  } finally {
    // 중간에 멈춰도 이미 합친 것은 되돌릴 수 있게 남긴다.
    if (runs.length) { fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), runs } satisfies UndoFile, null, 2)); console.log(`되돌림 파일: ${file}`) }
  }
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
