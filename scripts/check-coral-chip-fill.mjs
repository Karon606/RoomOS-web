// 고르는 칩·세그먼트의 켜짐을 코랄(감) 솔리드 채움으로 말하는 자리를 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-27 운영자 승인, 영수증 묶음 별건 D2). 가이드 §03 은 코랄 솔리드 채움을 CTA·연체·부유 액션에만 쓰고
// 필터·선택 칩의 상태 표시에는 쓰지 않는다고 정했다(2026-08-25 정비). 그런데 지출 등록 세부스펙 칩과 단계별 입력(SpecWizard)
// 칩이 고른 칸을 코랄로 채우고 있었고, 같은 꼴이 재고 추적 단위·위치 칩·배송비 결제 방식·지출 유형·지출 목록 필터 버튼에도
// 있었다. 자리 하나만 고치면 이웃이 남는다(클래스 봉합). 정본은 둘이다.
//   · 켜고 끄는 칩 = '긴급만'·점검 토글 칩 문법(켜짐 --neutral-bg + --warm-dark + ring --warm-border, 꺼짐 투명 + ring + --seg-ink-off,
//     aria-pressed, rounded-sm). 정본 components/inspection/InspectionRowBody.tsx ToggleChip.
//   · 둘·셋 중 하나를 고르는 자리 = SegmentedControl.
//
// 판정. 클래스 문자열 삼항(`조건 ? '켜짐' : '꺼짐'`)에서 한쪽에 코랄·감 솔리드 바탕(bg-[var(--coral)] · bg-[var(--persimmon)],
// 알파 /NN 없는 것)이 있고 다른 쪽이 그 바탕 없이 서 있으면 '고르면 채움' 칩이다. 체크 상자(22px 체크박스는 꺼짐 쪽 text-transparent,
// 선택 모드 체크 상자·라디오 점은 가로세로 고정 정사각형 h-4~6 · w-4~6, §22 허용)와 CTA 단추(삼항이 아닌 고정 클래스)는 이 꼴이 아니라
// 걸리지 않는다. 예외 명단은 없다(0 이 기대값이다).
//
// 범위. 이번 정비가 닫은 화면 전부(지출·재고·단계별 입력·홈 영수증 카드). 같은 꼴이 남은 다른 화면(호실 관리 필터·호실 일정
// 종류/등급 칩·체크리스트 주기 칩·배치도 편집기 토글)은 다른 작업이 도는 화면이라 이번에 손대지 않았다. 그 화면을 고칠 때
// SURFACES 에 더한다(빼는 일은 없다).
//
// 실행: node scripts/check-coral-chip-fill.mjs
import { readFileSync } from 'node:fs'

const SURFACES = [
  'app/(app)/finance/FinanceClient.tsx',
  'app/(app)/inventory/InventoryClient.tsx',
  'components/ui/SpecWizard.tsx',
  'components/dashboard/PendingReceiptSection.tsx',
]

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//gm, (m, pre) => pre + m.slice(pre.length).replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

const SOLID = /(?:^|[\s'"`])bg-\[var\(--(?:coral|persimmon)\)\](?!\/)/
const violations = []
for (const f of SURFACES) {
  const src = strip(readFileSync(f, 'utf8'))
  // ? '…' : '…'  (작은따옴표·큰따옴표·백틱 조각, 여러 줄 허용)
  const re = /\?\s*(['"`])([^'"`]*?)\1\s*:\s*(['"`])([^'"`]*?)\3/g
  for (const m of src.matchAll(re)) {
    const a = m[2], b = m[4]
    const aSolid = SOLID.test(' ' + a), bSolid = SOLID.test(' ' + b)
    if (aSolid === bSolid) continue
    const off = aSolid ? b : a
    if (/text-transparent/.test(off)) continue   // 22px 체크박스(§22 허용)
    // 선택 모드 체크 상자·라디오 점(가로세로가 고정된 작은 정사각형 + 켜지면 체크 글리프, §22·§23 '선택 시 coral 체크')도 칩이 아니다.
    const head = src.slice(Math.max(0, src.lastIndexOf('`', m.index - 1)), m.index)
    if (/(?:^|\s)h-(?:4|5|6|\[22px\])(?=\s)/.test(head) && /(?:^|\s)w-(?:4|5|6|\[22px\])(?=\s)/.test(head)) continue
    const line = src.slice(0, m.index).split('\n').length
    violations.push(`${f}:${line} 고르는 칩의 켜짐이 코랄 솔리드 채움이다(§03·§23). 토글 칩 문법이나 SegmentedControl 로: ${m[0].replace(/\s+/g, ' ').slice(0, 160)}`)
  }
}

if (violations.length) {
  console.error(`check-coral-chip-fill: 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`check-coral-chip-fill: 통과 (화면 ${SURFACES.length}곳 · 코랄 채움 선택 칩 0)`)
