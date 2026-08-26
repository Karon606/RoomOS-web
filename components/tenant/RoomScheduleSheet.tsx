'use client'

// 호실 일정 짜기 — 계약 호실이 입주일에 아직 안 비었을 때, 그때까지 어디에 머물지 정한다.
//
// 여기로 오는 길은 하나다. 입주자 카드에서 입실 처리를 눌렀는데 계약 호실이 아직 차 있어
// 거절당하는 자리에서, 그냥 막는 대신 "다른 방부터 시작할까요"로 이어진다.
//
// **이것은 '조기 입실'이 아니라 입주일이 바뀐 것이다**(운영자 정정 2026-08-26). 예약을 9/1로
// 잡았어도 상황에 따라 날짜는 바뀔 수 있다. 그래서 이 화면에 하루치 요금 같은 칸이 없다 —
// 입주일이 8/31이 되면 8월분이 8/31에 청구되고 다음 납부일이 9/30이 될 뿐이다.
//
// 화면이 정하는 것은 둘이다. 언제부터 사는가, 그리고 계약 호실이 빌 때까지 어디에 있는가.
// 방 하나가 그 기간을 다 못 덮으면 **그 다음 방을 이어서 묻는다**(운영자 요구). 방마다
// '언제까지 머물 수 있는지'가 적혀 있어서 몇 개를 이어야 하는지 보고 고를 수 있다.
//
// 정한 일정은 계약서에도 적힌다. 그래서 그날이 와도 운영자가 무엇을 누를 필요가 없다 —
// 앱이 일정대로 방을 옮긴다.

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtDateDot } from '@/lib/fmtDate'
import {
  scheduleOpenFrom, validateRoomSchedule, roomScheduleText,
  type RoomScheduleEntry,
} from '@/lib/roomSchedule'
import { getRoomScheduleOptions, startLeaseWithRoomSchedule } from '@/app/(app)/tenants/actions'

type Options = Extract<Awaited<ReturnType<typeof getRoomScheduleOptions>>, { ok: true }>

const dateCls = 'w-full bg-[var(--canvas)] border rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]/40 focus-visible:border-[var(--coral)]'
const capCls = 'text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]'
const errCls = 'text-[0.6875rem] text-[var(--danger-fg)]'

/** 하루 앞 — 'YYYY-MM-DD' 그대로 다룬다(시간대가 끼면 하루가 밀린다). */
function dayBefore(ymd: string): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

export function RoomScheduleSheet({ leaseTermId, tenantName, onClose, onDone }: {
  leaseTermId: string
  tenantName: string
  onClose: () => void
  onDone: () => void
}) {
  const today = kstYmdStr(new Date())
  const [moveIn, setMoveIn] = useState(today)
  const [opts, setOpts] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  // 지금까지 고른 임시 방들 — 마지막 계약 호실 줄은 확정할 때 붙인다.
  const [picks, setPicks] = useState<RoomScheduleEntry[]>([])
  const [pending, setPending] = useState(false)

  // 아직 안 채운 기간의 시작 — 첫 화면은 입주일, 방을 하나 고르면 그 방을 비우는 날이다.
  const openFrom = picks.length === 0 ? moveIn : (scheduleOpenFrom(picks) ?? moveIn)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void getRoomScheduleOptions(leaseTermId, openFrom)
      .then(r => {
        if (!alive) return
        if (!r.ok) { setFailed(r.error); return }
        setOpts(r)
        setFailed(null)
      })
      .catch(() => { if (alive) setFailed('정보를 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [leaseTermId, openFrom])

  // 일정의 끝점 — 계약 호실이 비는 날. 그날 본 방으로 든다.
  const endAt = opts?.mainAvailableFrom ?? null
  // 아직 못 정한 기간이 남았는가. openFrom 이 끝점에 닿으면 다 채운 것이다.
  const done = !!endAt && openFrom >= endAt
  const unknownEnd = !!opts && endAt === null

  const noOf = (id: string) =>
    id === opts?.mainRoomId ? (opts?.mainRoomNo ?? null) : (opts?.rooms.find(r => r.id === id)?.roomNo ?? null)

  const fullSchedule: RoomScheduleEntry[] = useMemo(() => {
    if (!opts || !endAt || picks.length === 0) return []
    return [...picks, { roomId: opts.mainRoomId, from: endAt, to: null }]
  }, [opts, picks, endAt])

  const scheduleText = useMemo(
    () => (fullSchedule.length > 0 ? roomScheduleText(fullSchedule, noOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullSchedule],
  )

  const addRoom = (room: { id: string; roomNo: string; availableUntil: string | null }) => {
    if (!endAt) return
    // 이 방을 언제까지 쓸지 — 계약 호실이 비는 날과 이 방을 비워야 하는 날 중 이른 쪽이다.
    // 계약 호실이 먼저 비면 그 줄로 일정이 끝나고, 이 방이 먼저 차면 다음 방을 이어서 묻는다.
    const until = room.availableUntil && room.availableUntil < endAt ? room.availableUntil : endAt
    setPicks(prev => [...prev, { roomId: room.id, from: openFrom, to: until }])
  }

  const submit = async () => {
    if (!opts || pending || fullSchedule.length === 0) return
    const bad = validateRoomSchedule(fullSchedule, { moveInYmd: moveIn, mainRoomId: opts.mainRoomId })
    if (bad) { pushToast('error', bad); return }
    setPending(true)
    try {
      const r = await startLeaseWithRoomSchedule({ leaseTermId, moveInDate: moveIn, schedule: fullSchedule })
      if (!r.ok) { pushToast('error', r.error); return }
      pushToast('success', '입실 처리했습니다', { detail: r.notice })
      onDone()
    } catch (e) {
      pushToast('error', (e as Error).message ?? '처리에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  const tooLate = moveIn > today
  const canSubmit = !!opts && !loading && !pending && done && !tooLate && fullSchedule.length > 0

  return (
    <Modal open onClose={onClose} z={280} width="md"
      title={`입실 처리 · ${tenantName}`}
      dirty={picks.length > 0 || moveIn !== today}
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">닫기</Btn>
          <Btn variant="primary" size="md" onClick={() => void submit()} disabled={!canSubmit} className="flex-1">
            {pending ? '처리 중…' : '입실 처리'}
          </Btn>
        </div>
      }>
      <div className="space-y-3">
        {!opts && loading && <SkeletonRows rows={4} />}
        {failed && <p className={errCls}>{failed}</p>}

        {opts && (
          <>
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
                계약 호실 {opts.mainRoomNo}호가 아직 비지 않았습니다.
                그때까지 머물 방을 정하면 그날 자동으로 옮겨집니다.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">입주일</label>
              <DatePicker value={moveIn} onChange={v => { setMoveIn(v); setPicks([]) }} maxDate={today}
                className={`${dateCls} ${tooLate ? 'border-[var(--tc)]' : 'border-[var(--warm-border)]'}`} />
              {tooLate ? (
                <p className={errCls}>입주일은 오늘보다 뒤로 잡을 수 없습니다.</p>
              ) : (
                <p className={capCls}>
                  이 날짜부터 이용료가 청구됩니다. 예약 때 잡은 {fmtDateDot(opts.moveInDate)}과 달라도 됩니다.
                </p>
              )}
            </div>

            {/* 지금까지 짠 일정 — 계약서에 적힐 문장 그대로 보여 준다. */}
            {scheduleText && (
              <div className="rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2">
                <p className="text-[0.65625rem] text-[var(--warm-mid)]">정한 일정</p>
                <p className="mt-0.5 text-sm leading-relaxed text-[var(--warm-dark)]">{scheduleText}</p>
                <button type="button" onClick={() => setPicks(p => p.slice(0, -1))}
                  className="-my-1 mt-1 inline-flex min-h-[44px] items-center rounded-sm text-[0.65625rem] text-[var(--tc-text)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)]">
                  마지막 방 다시 고르기
                </button>
              </div>
            )}

            {!done && !unknownEnd && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {picks.length === 0 ? '어느 방부터 시작할까요' : `${fmtDateDot(openFrom)}부터는 어느 방으로 갈까요`}
                </label>
                {opts.rooms.length > 0 ? (
                  <ul className="space-y-1.5">
                    {opts.rooms.map(r => (
                      <li key={r.id}>
                        <button type="button" onClick={() => addRoom(r)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-3 text-left transition-colors hover:bg-[var(--cream-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)]">
                          <span className="text-sm font-semibold text-[var(--warm-dark)]">{r.roomNo}호</span>
                          {/* 언제까지 머물 수 있는지 — 이 줄이 있어야 몇 개를 이어야 하는지 보인다. */}
                          <span className="shrink-0 text-[0.65625rem] text-[var(--warm-muted)]">
                            {r.availableUntil
                              ? `${fmtDateDot(dayBefore(r.availableUntil))}까지`
                              : (r.id === opts.mainRoomId ? '계약 호실' : '기한 없음')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
                    그날 비는 방이 없습니다. 입주일을 바꿔 보세요.
                  </p>
                )}
                <p className={capCls}>
                  {endAt && `계약 호실 ${opts.mainRoomNo}호는 ${fmtDateDot(endAt)}에 빕니다. 그때까지를 채우면 됩니다.`}
                </p>
              </div>
            )}

            {done && endAt && (
              <p className={capCls}>
                {fmtDateDot(endAt)}에 계약 호실 {opts.mainRoomNo}호로 자동으로 옮겨집니다.
                이 일정은 계약서에도 적힙니다.
              </p>
            )}

            {unknownEnd && (
              <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warning-fg)]">
                계약 호실 {opts.mainRoomNo}호가 언제 비는지 정해지지 않았습니다.
                지금 사는 분의 퇴실 예정일을 먼저 정해 주세요.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
