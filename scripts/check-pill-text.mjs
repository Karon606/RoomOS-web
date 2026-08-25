// 글자를 담는 알약(r-pill) 재발 감지망 — 위반 시 exit 1 (2026-08-25 디자인 정비).
//
// 원칙(가이드 §07 개정): 원(rounded-full)은 도형이 기능일 때만 쓴다 — 도트·스피너·아바타·
// 토글·그립·숫자 카운터·부유 알약·진행바. **글자를 담는 배지·칩은 r-sm(6px)이다.**
// 글자 알약이 화면마다 서는 것이 운영자가 지목한 'AI 가 만든 앱' 인상의 큰 몫이었다.
//
// 판정: 한 줄에 rounded-full + px-* + text-* 가 함께 있으면 '글자를 담는 알약'으로 본다.
// 허용 목록은 도형-기능 원형과, 정비가 아직 안 닿은 자리(TODO — 해당 커밋에서 지운다)다.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// (파일, 줄에 함께 있어야 하는 표식) — 표식 기반이라 줄번호 이동에 흔들리지 않는다.
const ALLOW = [
  ['components/ui/inventory/SelectionPillBar.tsx', ''],           // 부유 알약(§22·§07 허용 목록)
  ['components/ErrorReportButton.tsx', ''],                        // FAB
  ['components/layout/NotificationBell.tsx', 'min-w-[18px]'],      // 숫자 카운터(§11 범위 밖)
  ['components/feedback/SaveFeedback.tsx', 'font-bold'],           // 숫자 카운터
  ['app/(app)/dashboard/DashboardClient.tsx', 'min-w-4 h-4'],      // 숫자 카운터
  ['components/room-manage/MoveCalendar.tsx', 'shadow-lift'],      // '오늘로' 부유 알약
  ['components/entity-modal/widgets/PhotoStrip.tsx', 'bg-black/'], // 사진 위 오버레이 층
  // TODO(정비 3/7 — 모조 필터 커밋에서 지운다)
  ['app/(app)/accrual-check/AccrualCheckClient.tsx', ''],
  ['app/(app)/requests/RequestsClient.tsx', ''],
  // TODO(정비 4/7 — 선택 칩 커밋에서 지운다. 파일 통째 허용은 임시다)
  ['app/(app)/inventory/InventoryClient.tsx', ''],
  ['app/(app)/tenants/TenantClient.tsx', ''],
  ['app/(app)/inventory/assets/AssetsClient.tsx', ''],
  ['components/ui/PeekSheet.tsx', ''],
  ['components/NoticeSmsModal.tsx', ''],
  ['components/search/GlobalSearchHost.tsx', ''],
]

const files = execSync("grep -rln 'rounded-full' app components --include='*.tsx' 2>/dev/null || true", { encoding: 'utf8' })
  .split('\n').filter(f => f && !f.includes('.claude'))

const violations = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.includes('rounded-full')) return
    if (!(/px-[0-9.[]/.test(line) && line.includes('text-'))) return
    const allowed = ALLOW.some(([af, marker]) => f === af && (marker === '' || line.includes(marker)))
    if (!allowed) violations.push(`${f}:${i + 1}`)
  })
}

console.log(`[글자 알약] rounded-full 보유 ${files.length}파일 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  for (const v of violations.slice(0, 15)) console.error(`  - ${v} 글자를 담는 면이 알약이다. r-sm 으로(가이드 §07·§11)`)
  if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
}
process.exit(violations.length > 0 ? 1 : 0)
