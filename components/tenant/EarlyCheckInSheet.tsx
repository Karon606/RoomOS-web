'use client'

// 조기 입실 시트 — 본 계약 방이 아직 비기 전, 임시 방에서 먼저 입실 처리한다.
//
// 여기로 오는 길은 하나다. 입실 처리를 눌렀는데 본 방이 아직 차 있어 거절당하는 자리에서,
// 그냥 막는 대신 "다른 방에서 먼저 입실 처리할까요"로 이어진다. 거절이 곧 진입점인 셈이라
// 운영자가 이 기능을 따로 찾아 헤맬 일이 없다.
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
import { getEarlyCheckInOptions, earlyCheckInTenant } from '@/app/(app)/tenants/actions'

type Options = Extract<Awaited<ReturnType<typeof getEarlyCheckInOptions>>, { ok: true }>

const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'

export function EarlyCheckInSheet({ leaseTermId, tenantName, onClose, onDone }: {
  leaseTermId: string
  tenantName: string
  onClose: () => void
  onDone: () => void
}) {
  const today = kstYmdStr(new Date())
  const [date, setDate] = useState(today)
  const [opts, setOpts] = useState<Options | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [roomId, setRoomId] = useState('')
  const [charge, setCharge] = useState(0)
  // 손으로 고친 금액을 날짜 변경이 덮으면 안 된다 — 제안은 처음 한 번이다.
  const [chargeTouched, setChargeTouched] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let alive = true
    void getEarlyCheckInOptions(leaseTermId, date)
      .then(r => {
        if (!alive) return
        if (!r.ok) { setFailed(r.error); return }
        setOpts(r)
        setFailed(null)
        if (!chargeTouched) setCharge(r.suggest)
        // 고른 방이 새 기간에 안 맞으면 비운다 — 못 쓰는 방이 골라진 채로 남으면 안 된다.
        setRoomId(prev => (prev && r.rooms.some(x => x.id === prev) ? prev : ''))
      })
      .catch(() => { if (alive) setFailed('정보를 불러오지 못했습니다.') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseTermId, date])

  const submit = async () => {
    if (!roomId || pending) return
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
    <Modal open onClose={onClose} z={280} width="md" title={`먼저 입실 · ${tenantName}`}>
      <div className="space-y-3">
        {!opts && !failed && <SkeletonRows rows={4} />}
        {failed && <p className="text-xs text-[var(--danger-fg)]">{failed}</p>}

        {opts && (
          <>
            {/* 무엇이 안 바뀌는지를 먼저 말한다 — 이 화면의 불안은 "계약이 흔들리나"이기 때문이다. */}
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
                계약은 {opts.roomNo}호 · {fmtDateDot(opts.moveInDate)} 시작 그대로입니다.
                아래에서 정한 방에는 본 계약 시작일 전까지만 머뭅니다. 이용료 청구와 계약서는 바뀌지 않습니다.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">먼저 입실할 날짜</label>
              <DatePicker value={date} onChange={setDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
              {date > today && (
                <p className="text-[0.65625rem] text-[var(--danger-fg)]">입실일은 오늘보다 뒤로 잡을 수 없습니다.</p>
              )}
              {opts.days > 0 && date <= today && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                  {fmtDateDot(date)}부터 {opts.days}일 동안 머뭅니다.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="early-room">머물 방</label>
              {opts.rooms.length > 0 ? (
                <select id="early-room" value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                  <option value="">고르세요</option>
                  {opts.rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                </select>
              ) : (
                <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
                  그 기간에 비는 방이 없습니다. 날짜를 바꾸거나 본 계약 시작일에 입실 처리해 주세요.
                </p>
              )}
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">그 기간에 다른 입주자가 없는 방만 보입니다.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">추가로 받을 금액</label>
              <MoneyInput value={charge} onChange={v => { setCharge(v); setChargeTouched(true) }} placeholder="0원" />
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                하루치 {opts.suggest.toLocaleString()}원을 제안합니다. 안 받으시려면 0으로 두세요.
                기타수익으로 기록되고 이용료 청구에는 섞이지 않습니다.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Btn type="button" variant="secondary" size="md" onClick={onClose} disabled={pending}>취소</Btn>
              <Btn type="button" variant="primary" size="md" onClick={() => void submit()}
                disabled={pending || !roomId || opts.days <= 0 || date > today}>
                {pending ? '처리 중…' : '먼저 입실 처리'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
