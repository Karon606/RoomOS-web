'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmdStr } from '@/lib/kstDate'
import { calcStayQuote } from '@/lib/prorate'
import { calcShortStay, stayDaysOf } from '@/lib/shortStay'
import { getRoomsForQuote } from '@/app/(app)/tenants/actions'

// ── 단기 입실 요금 시뮬레이션 — 등록 없이 견적(운영자 요청 2026-07-05) ──
// 위치: 홈 헤더 + 전체 메뉴(운영자 지시 2026-07-06 — 문의 전화 시 홈에서 바로).
// 방 선택 시 월세 자동(직접 수정 가능) + 입실·퇴실일 → 회차/일할 분해.
// 계산은 lib/prorate.calcStayQuote — 실제 퇴실 정산(일할)과 동일 규칙이라 금액이 일치.
export function StayQuoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomsForQuote>> | null>(null)
  const [roomId, setRoomId] = useState('')
  const [rentStr, setRentStr] = useState('')
  const [inDate, setInDate] = useState('')
  const [outDate, setOutDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    setRoomId(''); setRentStr(''); setInDate(kstYmdStr()); setOutDate('')
    setLoadFailed(false); setLoading(true)
    getRoomsForQuote()
      .then(setData)
      .catch(() => { setData(null); setLoadFailed(true) })
      .finally(() => setLoading(false))
  }, [open])

  const rooms = data?.rooms
  const rent = Number(rentStr.replace(/[^0-9]/g, '')) || 0
  // 단기 정책 우선 — 적용 범위(1달 이내 등) 안이면 주 단위 정책 요금, 밖이면 기존 월 단위+일할 견적
  const stayDays = inDate && outDate ? stayDaysOf(inDate, outDate) : null
  const short = data && rent > 0 && stayDays != null ? calcShortStay(data.shortStay, rent, stayDays) : null
  const quote = !short && rent > 0 && inDate && outDate ? calcStayQuote(rent, inDate, outDate) : null

  return (
    <Modal open={open} onClose={onClose} title="단기 입실 요금 계산" width="sm"
      subtitle="등록 없이 기간별 요금을 미리 계산합니다 · 실제 정산(일할)과 동일 규칙">
      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">호실 (선택 시 월 이용료 자동)</span>
          <select value={roomId} disabled={loading}
            onChange={e => {
              setRoomId(e.target.value)
              const r = rooms?.find(x => x.id === e.target.value)
              if (r) setRentStr(r.baseRent ? r.baseRent.toLocaleString() : '')
            }}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] disabled:opacity-60">
            <option value="">{loading ? '호실 불러오는 중...' : '직접 입력'}</option>
            {(rooms ?? []).map(r => (
              <option key={r.id} value={r.id}>{r.roomNo}호 · {fmtWon(r.baseRent)}{r.occupied ? ' (사용중)' : ''}</option>
            ))}
          </select>
          {loadFailed && (
            <span className="block text-xs text-[var(--danger-fg)] mt-1">호실 목록을 불러오지 못했어요. 월 이용료를 직접 입력해 주세요.</span>
          )}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">월 이용료 *</span>
          <input value={rentStr} inputMode="numeric"
            onChange={e => { const n = e.target.value.replace(/[^0-9]/g, ''); setRentStr(n ? Number(n).toLocaleString() : '') }}
            placeholder="600,000"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">입실일 *</span>
            <DatePicker value={inDate} onChange={setInDate}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">퇴실일 *</span>
            <DatePicker value={outDate} onChange={setOutDate}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
          </label>
        </div>

        {!short && !quote && (
          rent === 0 ? (
            <p className="text-xs text-[var(--warm-muted)]">월 이용료를 입력해 주세요.</p>
          ) : !(inDate && outDate) ? (
            <p className="text-xs text-[var(--warm-muted)]">입실일과 퇴실일을 모두 입력하면 요금이 계산됩니다.</p>
          ) : (
            <p className="text-xs text-[var(--danger-fg)]">퇴실일이 입실일보다 빠릅니다.</p>
          )
        )}
        {short && data && (
          <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-4 space-y-2">
            <p className="text-xs font-semibold text-[var(--warm-dark)]">
              계약 {data.shortStay.unitDays === 7 ? `${short.units}주` : `${short.units} × ${data.shortStay.unitDays}일`}
              <span className="font-normal text-[var(--warm-muted)]"> · 거주 {short.stayDays}일{short.roundedUp ? ` (단위 계약이라 ${short.contractDays}일로 올림)` : ''}</span>
            </p>
            <ul className="space-y-1">
              <li className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-[var(--warm-mid)]">
                  기본요금 · {short.billedDays}일치{short.cappedAtMonth ? ' (1개월 요금 상한)' : ` (계약 ${short.contractDays}일 × ${data.shortStay.multiplier})`}
                </span>
                <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(short.baseAmount)}</span>
              </li>
              {short.cleaningFee > 0 && (
                <li className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-[var(--warm-mid)]">청소비</span>
                  <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(short.cleaningFee)}</span>
                </li>
              )}
            </ul>
            <div className="border-t border-[var(--warm-border)] pt-2 flex items-baseline justify-between">
              <span className="text-xs text-[var(--warm-mid)]">단기 정책 요금</span>
              <span className="text-lg font-bold tnum text-[var(--coral)]">{fmtWon(short.total)}</span>
            </div>
            {short.deposit > 0 && (
              <p className="text-[0.6875rem] text-[var(--warm-mid)] flex items-baseline justify-between">
                <span>보증금 (요금과 별도 · 퇴실 시 환불)</span>
                <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(short.deposit)}</span>
              </p>
            )}
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              {data.shortStay.unitDays}일 단위 계약(일할 아님) · {data.shortStay.thresholdDays}일 이하 거주에 적용. 수치는 설정에서 영업장별로 바꿀 수 있습니다.
            </p>
          </div>
        )}
        {quote && (
          <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-4 space-y-2">
            <ul className="space-y-1">
              {quote.items.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-[var(--warm-mid)] tabular-nums">
                    {it.start.slice(5).replace('-', '/')} ~ {it.end.slice(5).replace('-', '/')}
                    <span className="text-[var(--warm-muted)]"> · {it.full ? '1개월' : `${it.days}일 일할`}</span>
                  </span>
                  <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(it.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--warm-border)] pt-2 flex items-baseline justify-between">
              <span className="text-xs text-[var(--warm-mid)]">
                총 {quote.fullMonths > 0 ? `${quote.fullMonths}개월` : ''}{quote.fullMonths > 0 && quote.partialDays > 0 ? ' + ' : ''}{quote.partialDays > 0 ? `${quote.partialDays}일` : ''}
              </span>
              <span className="text-lg font-bold tnum text-[var(--coral)]">{fmtWon(quote.total)}</span>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">일할은 30일 기준. 퇴실 정산과 동일한 계산입니다.</p>
          </div>
        )}

        <Btn type="button" variant="secondary" size="md" fullWidth onClick={onClose}>닫기</Btn>
      </div>
    </Modal>
  )
}
