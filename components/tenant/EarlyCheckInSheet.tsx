'use client'

// 조기 입실 시트 — 본 계약 방이 아직 비기 전, 임시 방에서 먼저 입실 처리한다.
//
// 여기로 오는 길은 하나다. 입주자 카드에서 입실 처리를 눌렀는데 본 방이 아직 차 있어
// 거절당하는 자리에서, 그냥 막는 대신 "다른 방에서 먼저 재울까요"로 이어진다. 거절이 곧
// 진입점인 셈이라 운영자가 이 기능을 따로 찾아 헤맬 일이 없다.
//
// 홈 알림에서는 잇지 않는다 — 그 알림은 계약 시작일이 지나야 뜨는데 조기 입실은 그 전날까지만
// 성립한다. 거기서 열면 언제나 못 넣는 폼을 보여 주게 된다(디자이너 패스 2026-08-26).
//
// 화면이 정하는 것은 셋뿐이다 — 어느 방에서 잘지, 언제부터인지, 하루치를 얼마 받을지.
// 계약 자체(본 방·계약 시작일·이용료)는 손대지 않는다는 사실을 안내 줄이 말한다.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { getEarlyCheckInOptions, earlyCheckInTenant } from '@/app/(app)/tenants/actions'

type Options = Extract<Awaited<ReturnType<typeof getEarlyCheckInOptions>>, { ok: true }>

const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'
// 날짜 칸의 포커스 링 — DatePicker 는 기본 클래스에 포커스 스타일이 없어 호출부가 준다(§09).
// 퇴실 미니폼(CheckoutRefundModal)이 같은 자리에 붙인 것과 한 벌이다.
const dateCls = 'w-full bg-[var(--canvas)] border rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]/40 focus-visible:border-[var(--coral)]'
const errCls = 'text-[0.6875rem] text-[var(--danger-fg)]'
const capCls = 'text-[0.6875rem] text-[var(--warm-muted)]'

/** 하루 전 — 'YYYY-MM-DD' 그대로 다룬다(시간대가 끼면 하루가 밀린다). */
function dayBefore(ymd: string): string {
  const t = Date.parse(`${ymd}T00:00:00Z`)
  return new Date(t - 86400000).toISOString().slice(0, 10)
}

export function EarlyCheckInSheet({ leaseTermId, tenantName, onClose, onDone }: {
  leaseTermId: string
  tenantName: string
  onClose: () => void
  onDone: () => void
}) {
  const today = kstYmdStr(new Date())
  const [date, setDate] = useState(today)
  const [opts, setOpts] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const [roomId, setRoomId] = useState('')
  // 고른 방이 새 기간에 안 맞아 풀렸다 — 말없이 비우면 왜 못 누르는지 알 수 없다.
  const [roomDropped, setRoomDropped] = useState(false)
  const [charge, setCharge] = useState(0)
  // 손으로 고친 금액을 날짜 변경이 덮으면 안 된다 — 제안은 처음 한 번이다.
  const [chargeTouched, setChargeTouched] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void getEarlyCheckInOptions(leaseTermId, date)
      .then(r => {
        if (!alive) return
        if (!r.ok) { setFailed(r.error); return }
        setOpts(r)
        setFailed(null)
        if (!chargeTouched) setCharge(r.suggest)
        setRoomId(prev => {
          if (!prev || r.rooms.some(x => x.id === prev)) return prev
          setRoomDropped(true)
          return ''
        })
      })
      .catch(() => { if (alive) setFailed('정보를 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseTermId, date])

  const moveIn = opts?.moveInDate ?? null
  // 고를 수 있는 마지막 날 — 오늘과 '본 계약 시작 전날' 중 이른 쪽. 못 고르게 하는 편이
  // 고르게 한 뒤 빨간 줄로 나무라는 것보다 앞선다(§27.2).
  const lastPick = moveIn ? (dayBefore(moveIn) < today ? dayBefore(moveIn) : today) : today
  const tooLate = !!moveIn && date >= moveIn
  const days = opts?.days ?? 0
  const canSubmit = !!opts && !loading && !pending && !!roomId && days > 0 && !tooLate && date <= today

  const submit = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      const r = await earlyCheckInTenant({ leaseTermId, tempRoomId: roomId, date, chargeAmount: charge })
      if (!r.ok) { pushToast('error', r.error); return }
      pushToast('success', '조기 입실 처리했습니다', { detail: r.notice })
      onDone()
    } catch (e) {
      pushToast('error', (e as Error).message ?? '처리에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open onClose={onClose} z={280} width="md"
      title={`조기 입실 · ${tenantName}`}
      // 세 칸 중 하나라도 손댔으면 배경 클릭으로 조용히 닫히지 않게(§12).
      dirty={!!roomId || chargeTouched || date !== today}
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">닫기</Btn>
          <Btn variant="primary" size="md" onClick={() => void submit()} disabled={!canSubmit} className="flex-1">
            {pending ? '처리 중…' : '조기 입실 처리'}
          </Btn>
        </div>
      }>
      <div className="space-y-3">
        {!opts && loading && <SkeletonRows rows={4} />}
        {failed && <p className={errCls}>{failed}</p>}

        {opts && (
          <>
            {/* 무엇이 안 바뀌는지를 먼저 말한다 — 이 화면의 불안은 "계약이 흔들리나"이기 때문이다. */}
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
                계약은 {opts.roomNo}호 · {fmtDateDot(opts.moveInDate)} 시작 그대로입니다.
                아래에서 정한 방에는 그 전날까지만 머뭅니다.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">먼저 들어오는 날</label>
              <DatePicker value={date} onChange={v => { setDate(v); setRoomDropped(false) }} maxDate={lastPick}
                className={`${dateCls} ${tooLate ? 'border-[var(--tc)]' : 'border-[var(--warm-border)]'}`} />
              {tooLate ? (
                <p className={errCls}>
                  본 계약 시작일({fmtDateDot(opts.moveInDate)})보다 앞선 날짜를 골라 주세요.
                </p>
              ) : days > 0 && (
                <p className={capCls}>{fmtDateDot(date)}부터 {days}일 동안 머뭅니다.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="early-room">머물 방</label>
              {opts.rooms.length > 0 ? (
                <>
                  <select id="early-room" value={roomId}
                    onChange={e => { setRoomId(e.target.value); setRoomDropped(false) }} className={inputCls}>
                    <option value="">고르세요</option>
                    {opts.rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                  </select>
                  <p className={capCls}>그 기간에 다른 입주자가 없는 방만 보입니다.</p>
                  {roomDropped && (
                    <p className={errCls}>고른 방이 새 기간에는 비지 않아 풀렸습니다. 다시 골라 주세요.</p>
                  )}
                </>
              ) : (
                <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
                  그 기간에 비는 방이 없습니다. 날짜를 바꾸거나 본 계약 시작일에 입실 처리해 주세요.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">추가로 받을 금액</label>
              <MoneyInput value={charge} onChange={v => { setCharge(v); setChargeTouched(true) }} placeholder="0원" />
              <p className={capCls}>
                하루치 {fmtWon(opts.suggest)}을 제안합니다. 안 받으시려면 0으로 두세요.
                부가수익으로 기록되고 이용료 청구에는 섞이지 않습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
