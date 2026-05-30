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
  NOT_REPORTED: '미신고', REGISTERED: '완료', EXEMPTED: '해당없음',
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

export function TenantAdditionalInfo({ lease }: { lease: Lease }) {
  return (
    <Section title="추가 정보">
      <Grid>
        <Item label="전입신고"       value={REG_LABEL[lease.registrationStatus] ?? lease.registrationStatus} />
        <Item label="결제 수단"      value={lease.payMethod ?? '—'} />
        <Item label="현금영수증"     value={lease.cashReceipt ?? '—'} />
        <Item label="방문 경로"      value={lease.visitRoute ?? '—'} />
        <Item label="희망 이동 호실" value={wishDisplay(lease)} />
        {lease.contractUrl && (
          <Item label="계약서" value={
            <a href={lease.contractUrl} target="_blank" rel="noopener noreferrer"
              className="text-[var(--coral)] hover:text-[var(--coral)] text-xs">링크 열기 ↗</a>
          } />
        )}
      </Grid>
    </Section>
  )
}
