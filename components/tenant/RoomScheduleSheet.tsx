'use client'

// 호실 일정 짜기 — 계약 호실이 입주일에 아직 안 비었을 때, 그때까지 어디에 머물지 정한다.
//
// 여기로 오는 길은 셋이다. 입주 희망일을 당겼을 때 뜨는 물음, 예약 상태의 [입실 일정] 버튼,
// 그리고 입실 처리가 계약 호실 점유로 거절당하는 자리.
//
// **이것은 '조기 입실'이 아니라 입주일이 바뀐 것이다**(운영자 정정 2026-08-26). 예약을 9/1로
// 잡았어도 상황에 따라 날짜는 바뀔 수 있다. 그래서 이 화면에 하루치 요금 같은 칸이 없다 —
// 입주일이 8/31이 되면 8월분이 8/31에 청구되고 다음 납부일이 9/30이 될 뿐이다.
//
// 화면이 정하는 것은 둘이다. 언제부터 사는가, 그리고 계약 호실이 빌 때까지 어디에 있는가.
// 방 하나가 그 기간을 다 못 덮으면 **그 다음 방을 이어서 묻는다**(운영자 요구).
//
// **목록이 계산을 시키지 않는다.** 방마다 "이 방이면 끝" 또는 "N일 더 필요"라고 결론을 적는다.
// '9월 2일까지'만 적으면 운영자가 끝점과 빼기를 머릿속으로 해야 한다 — 운영자가 요구한 것은
// 계산이 아니라 표시다("좀 더 심플하면서도 직관적이게").
//
// **바로 입주**(2026-10-02, 513호). 계약 호실이 입주일 전에 이미 비면 임시 호실이 필요 없다.
// 그때는 목록을 감추고 입주일만 저장한다(빈 일정 = 남아 있던 일정을 걷는다). 갈래 판정은
// lib/roomSchedule scheduleMode 하나이고 서버 가드도 같은 함수를 쓴다.
//
// 정한 일정은 계약서에도 적힌다. 옮기는 날이 오면 홈 알림이 '옮기시겠어요'를 묻는다 —
// 방을 옮기는 것은 실제로 짐을 나르는 일이라 앱이 대신 정하지 않는다.

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast, humanError } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import {
  scheduleOpenFrom, validateRoomSchedule, roomScheduleLines, effectiveMoveDate, scheduleMode,
  type RoomScheduleEntry,
} from '@/lib/roomSchedule'
import { getRoomScheduleOptions, startLeaseWithRoomSchedule, saveRoomSchedulePlan, undoSaveRoomSchedulePlan } from '@/app/(app)/tenants/actions'
import { fmtRoomNo, roomNoWithRo } from '@/lib/roomNo'

type Options = Extract<Awaited<ReturnType<typeof getRoomScheduleOptions>>, { ok: true }>
/** 고른 방 — 이름을 함께 담는다. 목록은 다음 걸음에서 그 방을 빼므로 거기서 이름을 못 찾는다. */
type Pick = RoomScheduleEntry & { roomNo: string }

const dateCls = 'w-full bg-[var(--canvas)] border rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/40 focus-visible:border-[var(--tc-text)]'
const capCls = 'text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]'
const errCls = 'text-[0.6875rem] text-[var(--danger-fg)]'

/** 하루 앞 — 'YYYY-MM-DD' 그대로 다룬다(시간대가 끼면 하루가 밀린다). */
function dayBefore(ymd: string): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

export function RoomScheduleSheet({ leaseTermId, tenantName, mode = 'now', onClose, onDone }: {
  leaseTermId: string
  tenantName: string
  /**
   * 'now' 는 오늘 실제로 들이는 것(입실 처리), 'plan' 은 **미리 잡아 두는 것**이다.
   *
   * 갈리는 곳은 둘뿐이다. 미리 잡기는 미래 날짜를 받고, 저장이 계약을 예약 상태 그대로 둔다.
   * 계약서는 예약 상태에서도 일정을 인쇄하므로 서명 전에 뽑아도 일정이 들어간다.
   */
  mode?: 'now' | 'plan'
  onClose: () => void
  onDone: () => void
}) {
  const plan = mode === 'plan'
  const today = kstYmdStr(new Date())
  const [moveIn, setMoveIn] = useState(today)
  // 미리 잡기는 예약 때 정한 입주 희망일에서 시작한다(오늘이 아니다).
  const [inited, setInited] = useState(false)
  const [opts, setOpts] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const [picks, setPicks] = useState<Pick[]>([])
  const [pending, setPending] = useState(false)

  // 아직 안 채운 기간의 시작 — 첫 걸음은 입주일, 방을 하나 고르면 그 방을 비우는 날이다.
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
        if (plan && !inited) { setMoveIn(r.moveInDate); setInited(true) }
      })
      .catch(() => { if (alive) setFailed('정보를 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseTermId, openFrom])

  // 일정의 끝점 — 계약 호실이 비는 날. 그날 본 방으로 든다.
  /**
   * 계약 호실로 드는 날. 종전에는 서버가 낸 '가능일'을 그대로 박아 사람이 못 고쳤다.
   *
   * 그래서 404호처럼 앞사람이 8/31 퇴실이라 9/1부터 비지만 청소가 9/2로 잡힌 방에서는, 9/2로
   * 미룰 방법이 아예 없었다(운영자 실기 2026-08-31 — "수정할 방법이 없어").
   *
   * 이제 서버 제안이 기본값이고 사람이 뒤로 미룰 수 있다. 하한은 앞사람이 나가는 날 당일이다
   * (오전 퇴실·오후 입실이 정당한 실무라 막지 않는다, 운영자 확정).
   */
  const [endEdit, setEndEdit] = useState<string | null>(null)
  const rawEnd = endEdit ?? opts?.moveSuggested ?? opts?.mainAvailableFrom ?? null
  /**
   * 입주일보다 앞서면 입주일로 올린다(2026-10-02 운영자 신고, 513호). 계약 호실이 10/1부터 비는데
   * 입주가 10/6이면 서버 제안(10/2)은 입주일 전이라, 그대로 쓰면 없는 기간의 임시 호실을 찾았다.
   */
  const endAt = opts ? effectiveMoveDate(rawEnd, moveIn) : null
  const unknownEnd = !!opts && endAt === null
  // 바로 입주 — 계약 호실로 드는 날이 곧 입주일이다. 임시 호실을 고를 기간이 없다.
  const direct = !!opts && scheduleMode(rawEnd, moveIn) === 'direct'
  // 다 채웠는가 — 일정 갈래는 **방을 하나라도 골랐을 때만** 참이다. 아무것도 안 정했는데 "다 됐다"고
  // 말하면 거짓이 된다(퇴실 예정일이 이미 지난 방에서 실제로 그랬다). 바로 입주는 고를 것이 없다.
  const done = direct || (picks.length > 0 && !!endAt && openFrom >= endAt)

  const fullSchedule: RoomScheduleEntry[] = useMemo(() => {
    if (!opts || !endAt || direct || picks.length === 0) return []
    return [...picks.map(p => ({ roomId: p.roomId, from: p.from, to: p.to })),
      { roomId: opts.mainRoomId, from: endAt, to: null }]
  }, [opts, picks, endAt, direct])

  // 이름은 고를 때 담아 둔 것에서 읽는다 — 목록은 다음 걸음에서 그 방을 빼기 때문이다.
  const scheduleLines = useMemo(() => {
    if (fullSchedule.length === 0 || !opts) return []
    const names = new Map(picks.map(p => [p.roomId, p.roomNo]))
    names.set(opts.mainRoomId, opts.mainRoomNo)
    return roomScheduleLines(fullSchedule, id => names.get(id) ?? null)
  }, [fullSchedule, picks, opts])

  const addRoom = (room: { id: string; roomNo: string; availableUntil: string | null }) => {
    if (!endAt) return
    // 이 방을 언제까지 쓸지 — 계약 호실이 비는 날과 이 방을 비워야 하는 날 중 이른 쪽이다.
    const until = room.availableUntil && room.availableUntil < endAt ? room.availableUntil : endAt
    setPicks(prev => [...prev, { roomId: room.id, roomNo: room.roomNo, from: openFrom, to: until }])
  }

  const submit = async () => {
    if (!opts || pending) return
    // 바로 입주는 빈 일정을 보낸다 — 서버가 입주일만 바꾸고 남아 있던 일정을 걷는다.
    if (!direct) {
      if (fullSchedule.length === 0) return
      const bad = validateRoomSchedule(fullSchedule, { moveInYmd: moveIn, mainRoomId: opts.mainRoomId })
      if (bad) { pushToast('error', bad); return }
    }
    setPending(true)
    try {
      if (plan) {
        const r = await saveRoomSchedulePlan({ leaseTermId, moveInDate: moveIn, schedule: fullSchedule })
        if (!r.ok) { pushToast('error', r.error); return }
        // 적용취소 — 저장 직전 값으로 되돌린다. 토스트가 눌리면 닫히지만 연타 사이를 한 번 더 막는다.
        let undoing = false
        pushToast('success', direct ? '입주일을 저장했습니다' : '거주 호실 일정을 정했습니다', {
          detail: r.notice,
          action: {
            label: '적용취소',
            run: () => {
              if (undoing) return
              undoing = true
              void undoSaveRoomSchedulePlan(r.undo).then(u => {
                if (!u.ok) { pushToast('error', u.error); return }
                pushToast('info', direct ? '입주일을 되돌렸습니다' : '거주 호실 일정을 되돌렸습니다', { detail: u.notice })
                onDone()
              }).catch(e => pushToast('error', humanError(e, '되돌리지 못했습니다.')))
            },
          },
        })
        onDone()
        return
      }
      const r = await startLeaseWithRoomSchedule({ leaseTermId, moveInDate: moveIn, schedule: fullSchedule })
      if (!r.ok) { pushToast('error', r.error); return }
      pushToast('success', '입실 처리했습니다', { detail: r.notice })
      onDone()
    } catch (e) {
      pushToast('error', humanError(e, '처리에 실패했습니다.'))
    } finally {
      setPending(false)
    }
  }

  const tooLate = !plan && moveIn > today
  // 오늘 입실 처리인데 바로 들어갈 수 있으면 이 시트의 일이 아니다 — 일반 입실 처리로 보낸다.
  const nowDirect = !plan && direct
  const canSubmit = !!opts && !loading && !pending && done && !tooLate && !nowDirect
  // 목록을 다시 읽는 중 — 라벨은 이미 새 기간을 말하는데 목록은 옛 기간 것이라 그 사이 탭을 막는다.
  const refreshing = loading && !!opts

  return (
    <Modal open onClose={onClose} z={280} width="md"
      title={`${plan ? '입실 일정' : '입실 처리'} · ${tenantName}`}
      // 미리 잡기는 예약 때 정한 입주 희망일에서 시작하므로 그 값과 견준다(오늘과 견주면 열자마자 dirty).
      dirty={picks.length > 0 || endEdit !== null || (plan ? (inited && moveIn !== opts?.moveInDate) : moveIn !== today)}
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">닫기</Btn>
          <Btn variant="primary" size="md" onClick={() => void submit()} disabled={!canSubmit} className="flex-1">
            {pending ? '처리 중…' : (plan ? (direct ? '입주일 저장' : '일정 저장') : '입실 처리')}
          </Btn>
        </div>
      }>
      <div className="space-y-3">
        {!opts && loading && <SkeletonRows rows={4} />}
        {failed && <p className={errCls}>{failed}</p>}

        {opts && (
          <>
            {/* 못 하는 경우에는 이 상자를 안 세운다 — 아래 경고와 정반대 지시를 동시에 하게 된다. */}
            {!unknownEnd && endAt && (
              <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
                <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
                  {nowDirect ? (
                    // 이 시트는 입실 처리가 계약 호실 점유로 막혔을 때만 열린다(moveInBlock = 그 방에 거주 중·
                    // 퇴실 예정 계약이 남음). 날짜로는 이미 비는데 막혔다면 그 계약의 퇴실 처리가 안 끝난 것이다.
                    // 퇴실 처리를 마쳐도 자동으로 입실되지는 않으므로 '할 수 있습니다'로 말한다.
                    <>
                      날짜로는 {fmtDate(opts.mainAvailableFrom ?? moveIn)}부터 비지만 {opts.mainOccupantName ? `${opts.mainOccupantName}님` : '앞 입주자'}의 퇴실 처리가 끝나지 않았습니다.
                      퇴실 처리를 마치면 임시 호실 없이 입실 처리할 수 있습니다.
                    </>
                  ) : direct ? (
                    <>입주일 {fmtDate(moveIn)}에 계약 호실 {roomNoWithRo(opts.mainRoomNo, '')} 바로 들어갑니다. 임시 호실이 필요 없습니다.</>
                  ) : (
                    <>
                      계약 호실 {fmtRoomNo(opts.mainRoomNo, '')}는 {fmtDate(opts.mainAvailableFrom ?? endAt)}부터 입주 가능합니다.
                      이사일까지 지낼 임시 호실을 정해 두면, 이사일에 홈 화면에서 이사 여부를 확인합니다.
                    </>
                  )}
                </p>
              </div>
            )}

            {unknownEnd && (
              <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warning-fg)]">
                계약 호실 {fmtRoomNo(opts.mainRoomNo, '')}의 입주 가능일이 정해지지 않았습니다.
                {opts.mainOccupantName
                  ? ` 지금 사는 ${opts.mainOccupantName}님의 퇴실 예정일을 먼저 정해 주세요.`
                  : ' 지금 사는 분의 퇴실 예정일을 먼저 정해 주세요.'}
              </p>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[var(--warm-mid)]">입주일</p>
              <DatePicker value={moveIn} onChange={v => { setMoveIn(v); setPicks([]) }}
                {...(plan ? {} : { maxDate: today })}
                className={`${dateCls} ${tooLate ? 'border-[var(--tc)]' : 'border-[var(--warm-border)]'}`} />
              {tooLate ? (
                <p className={errCls}>입주일은 오늘보다 뒤로 잡을 수 없습니다.</p>
              ) : (
                <p className={capCls}>
                  이 날짜부터 이용료가 청구됩니다.
                  {!plan && ` 예약 때 잡은 ${fmtDate(opts.moveInDate)}과 달라도 됩니다.`}
                  {picks.length > 0 && ' 날짜를 바꾸면 정해 둔 임시 호실이 지워집니다.'}
                </p>
              )}
            </div>

            {/* 계약 호실 이사일 — 서버가 낸 가능일은 하한일 뿐이고 실제로 드는 날은 사람이 정한다.
                청소 예정일은 막는 근거가 아니라 알리는 근거다(운영자 확정 2026-08-21). */}
            {!unknownEnd && opts.moveEarliest && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[var(--warm-mid)]">계약 호실 이사일</p>
                {/* 값은 입주일보다 앞서지 않는다(effectiveMoveDate). 하한은 앞사람이 나가는 날과 입주일 중
                    늦은 쪽이라, 계약 호실이 입주일 전에 비면 곧 입주일이다(같은 날 = 바로 입주). */}
                <DatePicker value={endAt ?? ''} onChange={v => { setEndEdit(v || null); setPicks([]) }}
                  minDate={opts.moveEarliest > moveIn ? opts.moveEarliest : moveIn}
                  className={`${dateCls} border-[var(--warm-border)]`} />
                <p className={capCls}>
                  {opts.moveEarliest <= moveIn
                    // 바로 입주면 상단 상자가 이미 '바로 들어갑니다'를 말한다 — 같은 말을 되풀이하지 않는다(§29).
                    ? (direct ? '더 늦게 들어가야 하면 뒤로 미루세요.' : '입주일과 같으면 임시 호실 없이 바로 들어갑니다. 더 늦게 들어가야 하면 뒤로 미루세요.')
                    : `${fmtDate(opts.mainAvailableFrom ?? opts.moveEarliest)}부터 입주 가능합니다. 사정에 맞춰 앞뒤로 옮겨도 됩니다.`}
                  {picks.length > 0 && ' 날짜를 바꾸면 정해 둔 임시 호실이 지워집니다.'}
                </p>
                {/* 청소는 막는 근거가 아니라 알리는 근거다(2026-08-21). 바로 입주이고 입주 전에 끝나면
                    사실만 말하고, 입주일 뒤로 잡혀 있으면 경고 색으로 알린다. */}
                {opts.mainCleaningYmd && (direct && opts.mainCleaningYmd < moveIn ? (
                  <p className={capCls}>
                    {fmtRoomNo(opts.mainRoomNo, '')} 퇴실 청소가 {fmtDate(opts.mainCleaningYmd)}로 정해져 있습니다. 입주 전에 끝납니다.
                  </p>
                ) : direct && opts.mainCleaningYmd === moveIn ? (
                  <p className={capCls}>
                    {fmtRoomNo(opts.mainRoomNo, '')} 퇴실 청소가 입주 당일입니다.
                  </p>
                ) : direct ? (
                  <p className="text-[0.6875rem] leading-relaxed text-[var(--warning-fg)]">
                    {fmtRoomNo(opts.mainRoomNo, '')} 퇴실 청소가 {fmtDate(opts.mainCleaningYmd)}로 정해져 있어 입주일보다 늦습니다.
                  </p>
                ) : (
                  // 이사일을 사람이 안 바꿨을 때만 '그날로 맞췄다'고 말한다. 바꿨으면 청소일 사실만 말한다.
                  <p className="text-[0.6875rem] leading-relaxed text-[var(--warning-fg)]">
                    {endEdit === null && opts.moveSuggested === opts.mainCleaningYmd
                      ? `${fmtRoomNo(opts.mainRoomNo, '')} 퇴실 청소가 ${fmtDate(opts.mainCleaningYmd)}로 정해져 있어 이사일을 그날로 맞췄습니다.`
                      : `${fmtRoomNo(opts.mainRoomNo, '')} 퇴실 청소가 ${fmtDate(opts.mainCleaningYmd)}로 정해져 있습니다.`}
                  </p>
                ))}
              </div>
            )}

            {/* 지금까지 짠 일정 — 구간마다 한 줄. 한 문장으로 이으면 안 읽힌다(운영자 지적). */}
            {!direct && scheduleLines.length > 0 && (
              <div className="rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2">
                <p className="text-[0.65625rem] text-[var(--warm-mid)]">지금까지 정한 일정</p>
                <ul className="mt-1 space-y-1">
                  {scheduleLines.map(line => (
                    <li key={line} className="text-sm leading-relaxed text-[var(--warm-dark)]">{line}</li>
                  ))}
                </ul>
                <div className="mt-2">
                  <Btn type="button" variant="subtle" size="sm"
                    onClick={() => setPicks(p => p.slice(0, -1))} disabled={pending}>
                    되돌리기
                  </Btn>
                </div>
              </div>
            )}

            {!done && !unknownEnd && endAt && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[var(--warm-mid)]">
                  {picks.length === 0 ? '어느 호실에서 시작할까요' : `${fmtDate(openFrom)}부터는 어느 호실로 옮길까요`}
                </p>
                {/* 갱신 중에는 목록이 옛 기간 것이라 누르지 못하게 잠근다(§17 콘텐츠 유지 + 진행 표시). */}
                {refreshing && (
                  <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--warm-border)]">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--tc)]" />
                  </div>
                )}
                {opts.rooms.length > 0 ? (
                  <ul className="space-y-1.5">
                    {opts.rooms.map(r => {
                      // 계약 호실 입주일까지 덮으면 여기서 일정이 끝난다.
                      const covers = !r.availableUntil || r.availableUntil >= endAt
                      return (
                        <li key={r.id}>
                          <button type="button" onClick={() => addRoom(r)} disabled={refreshing}
                            className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-3 text-left transition-colors hover:bg-[var(--cream-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)] disabled:opacity-50">
                            <span className="text-sm font-semibold text-[var(--warm-dark)]">{fmtRoomNo(r.roomNo, '')}</span>
                            <span className="shrink-0 text-[0.65625rem] text-[var(--warm-muted)]">
                              {covers
                                ? '계약 호실 입주일까지 가능'
                                : `${fmtDate(dayBefore(r.availableUntil as string))}까지 가능`}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warning-fg)]">
                    {picks.length === 0
                      ? '그날 지낼 수 있는 호실이 없습니다. 입주일을 바꿔 보세요.'
                      : '그 기간에 지낼 수 있는 호실이 없습니다. 위에서 되돌리기를 누르고 다시 골라 보세요.'}
                  </p>
                )}
              </div>
            )}

            {done && !direct && endAt && (
              <p className={capCls}>
                {fmtDate(endAt)}에 계약 호실 {fmtRoomNo(opts.mainRoomNo, '')}로 이사하라고 홈 화면에서 알립니다.
                이 일정은 계약서에도 적힙니다.
                {plan && ` ${fmtDate(moveIn)}에 입실 처리만 누르면 이 일정대로 진행됩니다.`}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
