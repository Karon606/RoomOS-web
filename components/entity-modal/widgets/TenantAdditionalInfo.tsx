// 고객의 추가 정보 — 전입신고·결제수단·현금영수증·방문경로·희망 이동 호실·계약서 URL.

import { Section, Grid, Item } from './Section'

type Lease = {
  registrationStatus: string
  payMethod: string | null
  cashReceipt: string | null
  visitRoute: string | null
  wishRooms: string | null
  wishConditions: string | null
  contractUrl: string | null
}

const REG_LABEL: Record<string, string> = {
  NOT_REPORTED: '미신고', REGISTERED: '신고완료', EXEMPTED: '면제', PLANNED: '신고예정',
}
const WISH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const WISH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}

type WishConditionsObj = { floor?: string; windowType?: string; type?: string; direction?: string; minRent?: number; maxRent?: number }
function parseWishConditions(raw: string | null): WishConditionsObj {
  if (!raw) return {}
  try { return JSON.parse(raw) as WishConditionsObj } catch { return {} }
}

function wishDisplay(lease: Lease): string {
  if (lease.wishRooms) return lease.wishRooms
  const cond = parseWishConditions(lease.wishConditions)
  const parts: string[] = []
  if (cond.floor) parts.push(`${cond.floor}층`)
  if (cond.windowType) parts.push(WISH_WINDOW_LABEL[cond.windowType] ?? cond.windowType)
  if (cond.type) parts.push(cond.type)
  if (cond.direction) parts.push(WISH_DIR_LABEL[cond.direction] ?? cond.direction)
  const minR = cond.minRent ?? 0
  const maxR = cond.maxRent ?? 400000
  if (minR !== 0 || maxR !== 400000) parts.push(`${(minR / 10000).toFixed(0)}~${(maxR / 10000).toFixed(0)}만원`)
  return parts.length > 0 ? `조건: ${parts.join(' · ')}` : '—'
}

// foreign 은 부모가 정본(isForeignForDocuments)으로 판정해 내린다 — 위젯이 판정을 복제하면
// 계약서 종이의 체류지 변경신고 라벨과 갈릴 수 있다(운영자 오더 2026-09-07).
export function TenantAdditionalInfo({ lease, foreign = false }: { lease: Lease; foreign?: boolean }) {
  return (
    <Section title="추가 정보">
      <Grid>
        <Item label={foreign ? '체류지 변경신고' : '전입신고'} value={REG_LABEL[lease.registrationStatus] ?? lease.registrationStatus} />
        <Item label="결제 수단"      value={lease.payMethod ?? '—'} />
        <Item label="현금영수증"     value={lease.cashReceipt ?? '—'} />
        <Item label="방문 경로"      value={lease.visitRoute ?? '—'} />
        <Item label="희망 이동 호실" value={wishDisplay(lease)} />
        {/* 레거시 '계약서 · 링크 열기'(lease.contractUrl) 제거 — 2026-08-01.
            DB 실측 결과 값이 있는 계약이 0건이라 한 번도 그려진 적 없는 죽은 UI였고,
            계약서 접점이 여러 군데로 흩어져 보이는 원인 중 하나였다(운영자 지적).
            컬럼과 저장 액션은 그대로 두고 화면에서만 뺀다. 입력 필드도 함께 제거(TenantClient). */}
      </Grid>
    </Section>
  )
}
