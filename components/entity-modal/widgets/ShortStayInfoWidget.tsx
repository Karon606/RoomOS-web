'use client'

// 단기 입실 정보 — 단기 희망 고객 상세 전용 박스(운영자 확정 2026-07-10, a안).
// 입주 희망일·퇴실 예정일 나란히 + 희망 거주 기간 + 방 컨디션(타입·창문·가격)별 단기 요금.
// 희망 방이 있으면 그 방들의 컨디션만, 없으면 영업장 전체 컨디션을 모두 보여준다(문의 전화 대응용).
// 계산은 홈 '단기 요금 계산'과 동일(calcShortStay) — 금액이 항상 일치.

import { useEffect, useState } from 'react'
import { getRoomsForQuote, undoShortStayExtension } from '@/app/(app)/tenants/actions'
import { calcShortStay, stayDaysOf } from '@/lib/shortStay'
import { fmtWon } from '@/lib/fmtMoney'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import { Section } from './Section'
import { ShortStayExtensionModal } from './ShortStayExtensionModal'

type LeaseLite = {
  id: string
  status: string
  moveInDate: Date | string | null
  expectedMoveOut: Date | string | null
  wishRooms: string | null
  shortStayExtensions?: unknown
}

// 청구 이력 스냅샷 중 위젯이 읽는 필드만(서버 ShortStayExtensionSnapshot 부분집합).
// 사람이 읽는 이력은 이 스냅샷이 정본 — 전표(payment_records)는 감사 추적용으로 DB에만 남는다.
type ShortExt = {
  at?: string
  prevRentAmount: number; newRentAmount: number
  prevExpectedMoveOut: string | null; newExpectedMoveOut: string
  kind?: 'increase' | 'decrease'   // 구 스냅샷엔 없음(연장으로 간주)
  undoneAt: string | null
}

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
// 컴팩트 금액 — 470000 → '47만', 335000 → '33.5만'
const manCompact = (n: number) => {
  const man = n / 10000
  return `${Number.isInteger(man) ? man : Math.round(man * 10) / 10}만`
}
const toYmd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')
const fmtMD = (d: Date | string | null) => {
  if (!d) return '미정'
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

export function ShortStayInfoWidget({ lease, tenantId, tenantName, onChange }: {
  lease: LeaseLite
  tenantId: string
  tenantName: string
  onChange?: () => void
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomsForQuote>> | null>(null)
  useEffect(() => { getRoomsForQuote().then(setData).catch(() => setData(null)) }, [])

  // 연장 진입점(거주 중·퇴실 예정) + 마지막 미취소 연장 이력(상시 적용취소 진입점, v2.0 §16).
  const [extOpen, setExtOpen] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const canExtend = lease.status === 'ACTIVE' || lease.status === 'CHECKOUT_PENDING'
  const exts = Array.isArray(lease.shortStayExtensions) ? (lease.shortStayExtensions as ShortExt[]) : []
  const lastActive = [...exts].reverse().find(e => e.undoneAt === null) ?? null

  const lastLabel = lastActive?.kind === 'decrease' ? '감액' : '연장'

  const handleUndo = async () => {
    const ok = await confirmDialog({ title: `${lastLabel}을 적용취소할까요?`, confirmLabel: '적용취소', level: 'caution' })
    if (!ok) return
    setUndoing(true)
    const r = await undoShortStayExtension(lease.id)
    setUndoing(false)
    if (r.ok) { pushToast('info', `${lastLabel}이 취소되었습니다.`); onChange?.() }
    else pushToast('error', r.error)
  }

  const days = lease.moveInDate && lease.expectedMoveOut
    ? stayDaysOf(toYmd(lease.moveInDate), toYmd(lease.expectedMoveOut))
    : null

  // 방 컨디션 그룹 — 타입·창문·가격이 같으면 한 줄(영업장별로 방마다 가격이 달라도 전부 드러남)
  const groups = (() => {
    if (!data) return []
    const wish = (lease.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const pool = wish.length > 0 ? data.rooms.filter(r => wish.includes(r.roomNo)) : data.rooms
    const map = new Map<string, { label: string; rent: number; roomNos: string[] }>()
    for (const r of pool) {
      if (!r.baseRent || r.baseRent <= 0) continue   // 사무실 등 비대상
      const label = [r.type ?? '방', r.windowType ? WINDOW_LABEL[r.windowType] ?? r.windowType : null, r.tier].filter(Boolean).join(' ')
      const key = `${label}|${r.baseRent}`
      const g = map.get(key) ?? { label, rent: r.baseRent, roomNos: [] }
      g.roomNos.push(r.roomNo)
      map.set(key, g)
    }
    return [...map.values()].sort((a, b) => a.rent - b.rent)
  })()

  const wishCount = (lease.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean).length

  return (
    <>
    <Section title="단기 입실 정보">
      <div className="space-y-2.5">
        <p className="text-sm text-[var(--warm-dark)]">
          입주 희망 <span className="font-semibold">{fmtMD(lease.moveInDate)}</span>
          <span className="text-[var(--warm-muted)]"> ~ </span>
          퇴실 <span className="font-semibold">{fmtMD(lease.expectedMoveOut)}</span>
          {days != null && data && (() => {
            const s = calcShortStay(data.shortStay, 100, days)
            return (
              <span className="text-xs text-[var(--warm-mid)]"> · {days}일{s ? ` (${s.units}${data.shortStay.unitDays === 7 ? '주' : `×${data.shortStay.unitDays}일`} 계약)` : ''}</span>
            )
          })()}
        </p>
        {days == null ? (
          <p className="text-xs text-[var(--warm-muted)]">입주 희망일과 퇴실 예정일을 입력하면 방 컨디션별 요금이 자동 계산됩니다.</p>
        ) : !data ? (
          <p className="text-xs text-[var(--warm-muted)]">요금 계산 중…</p>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[var(--warm-mid)]">
              {wishCount > 0 ? '희망 방 기준 예상 요금' : '방 컨디션별 예상 요금'}
              {(() => {
                // 표시 금액은 월세 일할분(baseAmount)만 — 청소비·보증금은 별도로 안내(운영자 지적 2026-07-23).
                const parts: string[] = []
                if (data.shortStay.cleaningFee > 0) parts.push(`청소비 ${fmtWon(data.shortStay.cleaningFee)} 별도`)
                if (data.shortStay.deposit > 0) parts.push(`보증금 ${fmtWon(data.shortStay.deposit)} 별도`)
                return parts.length > 0 ? <span className="ml-1 font-normal text-[var(--warm-muted)]">({parts.join(' · ')})</span> : null
              })()}
            </p>
            <ul className="space-y-1">
              {groups.map(g => {
                const q = calcShortStay(data.shortStay, g.rent, days)
                return (
                  <li key={`${g.label}|${g.rent}`} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-[var(--warm-mid)]">
                      {g.label} <span className="text-[var(--warm-muted)]">{manCompact(g.rent)}{wishCount > 0 ? ` · ${g.roomNos.join(', ')}호` : ''}</span>
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-[var(--warm-dark)]">{q ? fmtWon(q.baseAmount) : '기간 초과(월 단위)'}</span>
                  </li>
                )
              })}
              {groups.length === 0 && <li className="text-xs text-[var(--warm-muted)]">계산할 방 정보가 없습니다.</li>}
            </ul>
          </div>
        )}

        {/* 청구 이력(연장·감액 전체, 시간순) + 상시 적용취소 진입점, 그리고 연장 버튼(거주 중·퇴실 예정).
            취소분은 취소선으로 남긴다 — 이력은 append-only 스택이고 적용취소는 마지막 미취소 항목만(LIFO). */}
        {(canExtend || exts.length > 0) && (
          <div className="mt-1 pt-3 border-t border-[var(--warm-border)] space-y-2">
            {exts.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-[var(--warm-mid)]">청구 이력</p>
                <ul className="space-y-1">
                  {exts.map((e, i) => {
                    const undone = !!e.undoneAt
                    return (
                      <li key={`${e.at ?? i}-${i}`} className="flex items-center justify-between gap-2">
                        <p className={`min-w-0 text-xs ${undone ? 'text-[var(--warm-muted)] line-through' : 'text-[var(--warm-mid)]'}`}>
                          {fmtMD(e.at ?? null)}
                          <span className="text-[var(--warm-muted)]"> · </span>
                          <span className="tabular-nums">{e.prevRentAmount.toLocaleString()} → <span className={undone ? '' : 'text-[var(--warm-dark)]'}>{e.newRentAmount.toLocaleString()}</span></span>
                          <span className="text-[var(--warm-muted)]"> (퇴실 {fmtMD(e.prevExpectedMoveOut)}→{fmtMD(e.newExpectedMoveOut)})</span>
                        </p>
                        {e === lastActive && (
                          <button type="button" onClick={handleUndo} disabled={undoing}
                            className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
                            {undoing ? '취소 중…' : '적용취소'}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {canExtend && (
              <Btn variant="subtle" size="sm" onClick={() => setExtOpen(true)} className="font-semibold">단기 연장</Btn>
            )}
          </div>
        )}
      </div>
    </Section>

    {extOpen && (
      <ShortStayExtensionModal open onClose={() => setExtOpen(false)}
        leaseTermId={lease.id} tenantId={tenantId} tenantName={tenantName}
        currentOut={toYmd(lease.expectedMoveOut) || null} onDone={onChange} />
    )}
    </>
  )
}
