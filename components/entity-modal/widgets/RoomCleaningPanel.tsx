'use client'

// 방 청소 이력 위젯 — 예정 등록·날짜 변경·완료 처리·적용취소 (2026-08-05, 신고 b21e4e98).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다.
// 이 위젯은 돈을 만들지 않는다. 비용 연결은 2단계다.
//
// 완료를 되돌릴 수 있어야 한다. 오탭 한 번에 이력이 굳으면 그게 다음 신고가 된다.

import { useEffect, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { DatePicker } from '@/components/ui/DatePicker'
import CategorySelect from '@/components/ui/CategorySelect'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import {
  getRoomCleanings, getCleaningFundStatus, createCleaning, completeCleaning, reopenCleaning, skipCleaning, deleteCleaning,
  rescheduleCleaning, getRecentCleaningPerformers,
} from '@/app/(app)/room-manage/cleaningActions'
import {
  CLEANING_REASON_LABEL, CLEANING_PERFORMER_LABEL,
  type CleaningRow, type CleaningReason, type CleaningPerformer,
  type CleaningFundStatus, type CleaningFundLease,
} from '@/app/(app)/room-manage/cleaningConstants'

const REASONS: CleaningReason[] = ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER']
const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']
const fmt = (d: string | null) => (d ? d.replace(/-/g, '.').slice(2) : '')
const won = (n: number) => `${n.toLocaleString()}원`

export function RoomCleaningPanel({ roomId }: { roomId: string }) {
  const [rows, setRows] = useState<CleaningRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [reason, setReason] = useState<CleaningReason>('CHECKOUT')
  const [scheduled, setScheduled] = useState(kstYmdStr())
  // 사유 메모. '기타'를 고르면 라벨만으로는 무슨 청소인지 알 수 없어 설명할 자리가 필요하다.
  const [memo, setMemo] = useState('')
  const [doneFor, setDoneFor] = useState<string | null>(null)
  // 완료일은 오늘로 못 박지 않는다 — 어제 한 청소를 오늘 입력하면 이력이 하루 틀어지고,
  // 비용을 함께 넣은 건은 지출 date 까지 같이 틀어진다(신고 e1ad1c5b).
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  // 날짜 변경 대상 행. 등록 후에는 바꿀 수단이 아예 없었다(같은 신고).
  // 완료 건의 완료일도 여기서 고친다 — 그 문이 없어 운영자가 되돌리기로 우회했고,
  // 그 우회로가 같은 청소에 지출을 두 건 만들던 경로였다.
  const [reschedFor, setReschedFor] = useState<string | null>(null)
  const [reschedDate, setReschedDate] = useState(kstYmdStr())
  // 기본은 '업체'. 청소는 대개 맡기고, 직접 한 경우가 예외라 기본을 직접으로 두면
  // 매번 칩을 한 번 더 눌러야 이름 칸이 나온다(운영자 지적 2026-08-10, 신고 c2a87782).
  const [performer, setPerformer] = useState<CleaningPerformer>('VENDOR')
  const [performerName, setPerformerName] = useState('')
  // 최근에 맡긴 업체·사람 — 이름 칸 선택지. 없는 영업장은 지금처럼 손으로 적는다.
  const [recentPerformers, setRecentPerformers] = useState<string[]>([])
  const [cost, setCost] = useState('')
  const [useFund, setUseFund] = useState(false)
  const [pending, startTransition] = useTransition()

  const [loadFailed, setLoadFailed] = useState(false)
  const [fund, setFund] = useState<CleaningFundStatus | null>(null)
  // 실패를 빈 목록으로 삼키지 않는다. 그러면 고장이 '기록 없음' 과 똑같이 보인다.
  const reload = () => {
    void Promise.all([
      getRoomCleanings(roomId),
      getCleaningFundStatus(roomId),
      // 추천 목록만 실패를 삼킨다. 이름 칸 편의값 하나 때문에 이력 전체가 '불러오지 못했습니다'가 되면 안 된다.
      getRecentCleaningPerformers().catch(() => [] as string[]),
    ])
      .then(([v, f, p]) => { setRows(v); setFund(f); setRecentPerformers(p); setLoadFailed(false) })
      .catch(() => { setRows([]); setFund(null); setLoadFailed(true) })
  }
  useEffect(reload, [roomId])   // eslint-disable-line react-hooks/exhaustive-deps

  // 그 청소가 딛고 설 계약. 아직 안 걸려 있으면 완료 시점에 서버가 고를 퇴실 계약을 미리 본다
  // (같은 규칙이라 체크 전후로 답이 안 갈린다).
  const leaseOf = (r: CleaningRow) =>
    r.leaseTermId ?? (r.reason === 'CHECKOUT' ? fund?.checkoutLeaseTermId ?? null : null)
  const fundOf = (leaseTermId: string | null): CleaningFundLease | null =>
    (leaseTermId && fund?.leases.find(l => l.leaseTermId === leaseTermId)) || null

  // okMsg 를 함수로도 받는다 — 되돌리기 문구는 지출이 남았는지를 **서버가 돌려준 값**으로 갈라야 한다.
  // 클라가 들고 있는 목록으로 짐작하면 마지막 조회 이후 지출을 지운 경우와 어긋난다.
  type Done = { ok: true; id?: string; expenseKept?: boolean }
  const run = (fn: () => Promise<Done | { ok: false; error: string }>, okMsg: string | ((res: Done) => string)) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', typeof okMsg === 'function' ? okMsg(res) : okMsg)
        reload()
      } finally { release() }
    })

  const open = rows?.find(r => r.status === 'PLANNED') ?? null

  // 받은 청소비로 부담한 건이 있는 계약만 잔고를 보여준다. 부담이 없으면 보여줄 잔고도 없다.
  const fundedLeases = [...new Set((rows ?? [])
    .filter(r => r.status === 'DONE' && r.fromCleaningFund && r.leaseTermId)
    .map(r => r.leaseTermId as string))]
    .map(id => fundOf(id))
    .filter((f): f is CleaningFundLease => !!f && f.fundedExpenseTotal > 0)

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">청소 이력</h3>
        {!adding && (
          <Btn variant="secondary" size="sm" onClick={() => { setAdding(true); setReason('CHECKOUT'); setScheduled(kstYmdStr()); setMemo('') }}>
            청소 예정 등록
          </Btn>
        )}
      </div>

      {adding && (
        <div className="rounded-lg p-2.5 mb-2 space-y-2" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex gap-1.5 flex-wrap">
            {REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className="px-2 py-1 rounded-lg text-xs"
                style={reason === r
                  ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                  : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                {CLEANING_REASON_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            예정일
            {/* 정본 DatePicker 사용 — 네이티브 date 입력은 앱 캘린더 문법과 어긋난다(운영자 지적 2026-08-06). */}
            <DatePicker value={scheduled} onChange={setScheduled} className="text-xs" />
          </div>
          {/* 사유 메모 — 업체·사람 이름 칸과 같은 입력 문법. '기타'는 라벨만으로 뜻이 안 서고,
              나머지 사유도 "왜 지금" 이 남아야 나중에 목록을 읽을 수 있다. */}
          <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
            placeholder="사유 메모 (선택)"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <Btn variant="primary" size="sm" disabled={pending}
              onClick={() => { run(() => createCleaning({ roomId, reason, scheduledDate: scheduled, memo }), '청소 예정 등록됨'); setAdding(false) }}>
              등록
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setAdding(false)}>취소</Btn>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="text-xs text-[var(--warm-muted)]">불러오는 중…</p>
      ) : loadFailed ? (
        <p className="text-xs text-[var(--danger-fg)]">청소 이력을 불러오지 못했습니다.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--warm-muted)]">청소 기록이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--cream)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 톤은 기존 정본 셋만 쓴다. 새 톤을 만들면 StatusBadge 세 곳을 동시에 고쳐야 한다.
                    완료=paid(끝난 것), 안 함=info(중립), 예정=await(기다리는 것) */}
                <StatusBadge tone={r.status === 'DONE' ? 'paid' : r.status === 'SKIPPED' ? 'info' : 'await'}>
                  {r.status === 'DONE' ? '완료' : r.status === 'SKIPPED' ? '안 함' : '예정'}
                </StatusBadge>
                <span className="text-xs text-[var(--warm-dark)]">{CLEANING_REASON_LABEL[r.reason]}</span>
                <span className="text-xs text-[var(--warm-muted)] num">
                  {r.status === 'DONE' ? fmt(r.doneDate) : fmt(r.scheduledDate)}
                </span>
                {/* 되돌린 건은 수행자 구분은 내려가도 이름은 남는다(재완료 때 다시 안 적게).
                    구분 없이 이름만 뜨면 무슨 이름인지 안 서니, 바로 옆 '기록된 지출' 과 같은 말을 붙여 가른다. */}
                {(r.performer || r.performerName) && (
                  <span className="text-xs text-[var(--warm-muted)]">
                    {r.performer ? CLEANING_PERFORMER_LABEL[r.performer] : '기록된 이름'}
                    {r.performerName ? ` · ${r.performerName}` : ''}
                  </span>
                )}
                {/* 되돌린 건은 예정인데도 지출이 그대로 걸려 있다(그래야 재완료가 두 건을 안 만든다).
                    같은 금액을 완료 건과 똑같이 보여주면 '예정인데 얼마 나갔다'로 읽히니 말을 붙여 가른다. */}
                {r.cost != null && r.cost > 0 && (
                  r.status === 'DONE' ? (
                    <span className="text-xs font-medium text-[var(--warm-dark)] num">{r.cost.toLocaleString()}원</span>
                  ) : (
                    <span className="text-xs text-[var(--warm-muted)] num">기록된 지출 {r.cost.toLocaleString()}원</span>
                  )
                )}
                {/* 표식이라 배지가 아니다. 새 톤을 만들면 StatusBadge 세 곳을 같이 고쳐야 한다. */}
                {r.fromCleaningFund && (
                  <span className="text-xs text-[var(--warm-muted)]">받은 청소비로 부담</span>
                )}
              </div>
              {/* 사유 메모는 §11 보조줄. 길이를 모르는 자유 입력이라 칩 줄에 끼우면 줄이 무너진다. */}
              {r.memo && (
                <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words">{r.memo}</p>
              )}

              {/* 완료 입력 — 그 줄에서 바로 받는다. 별도 모달을 띄우면 방 상세 위에 창이 또 쌓인다. */}
              {doneFor === r.id ? (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {PERFORMERS.map(pf => (
                      <button key={pf} type="button" onClick={() => {
                        setPerformer(pf)
                        // 직접 청소는 이름 칸이 사라진다. 값을 남겨 두면 화면에 없는 이름이 저장되고
                        // 지출 구매처까지 따라 들어간다 — 안 보이는 값은 저장하지 않는다.
                        if (pf === 'SELF') setPerformerName('')
                        // 맡긴 쪽으로 바꾸면 최근에 맡긴 곳을 채워 둔다. 이미 적어 둔 이름은 덮지 않는다.
                        else if (!performerName) setPerformerName(recentPerformers[0] ?? '')
                      }}
                        className="px-2 py-1 rounded-lg text-xs"
                        style={performer === pf
                          ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                          : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                        {CLEANING_PERFORMER_LABEL[pf]}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
                    완료일
                    {/* 예정 등록 폼과 같은 정본 DatePicker. 앞으로 한 청소는 없으므로 오늘까지만 고를 수 있다. */}
                    <DatePicker value={doneDate} onChange={setDoneDate} maxDate={kstYmdStr()} className="text-xs" />
                  </div>
                  {/* 이름 칸은 맡긴 경우에만. 직접 청소는 적을 이름이 없다.
                      맡긴 이력이 있으면 그 목록에서 고른다 — 같은 업체를 매번 손으로 적으면 오타 한 번에
                      한 업체가 두 이름으로 갈린다. 처음 쓰는 영업장(이력 0건)은 고를 것이 '기타' 하나뿐이라
                      select 가 오히려 걸리적거려 지금의 입력 칸을 그대로 둔다. */}
                  {performer !== 'SELF' && (
                    recentPerformers.length > 0 ? (
                      <CategorySelect
                        value={performerName} onChange={setPerformerName}
                        options={recentPerformers} emptyLabel="업체·사람 이름 (선택)"
                        placeholder="업체·사람 이름" closeIconSize={12}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]" />
                    ) : (
                      <input type="text" value={performerName} onChange={e => setPerformerName(e.target.value)}
                        placeholder="업체·사람 이름 (선택)"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs" />
                    )
                  )}
                  {/* 비용을 적으면 지출이 함께 만들어져 그 방 비용에 잡힌다. 비우면 지출을 안 만든다.
                      직접 청소에도 이 칸이 뜬다 — 노동은 공짜여도 세제·용품값은 실제로 나간 돈이다. */}
                  <label className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
                    비용
                    <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)}
                      placeholder="0" min={0}
                      className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs num" />
                    원
                  </label>
                  {/* 받은 청소비는 반환의무 없는 확정 수입이라 이 체크는 회계를 안 바꾼다.
                      어느 돈으로 냈는지 적는 표식일 뿐이고, 퇴실 청소에만 붙는다 —
                      그 외에는 귀속시킬 퇴실 계약이 없다.
                      직접 청소도 재료비를 그 돈으로 낼 수 있어 수행자로 가르지 않는다. */}
                  {r.reason === 'CHECKOUT' && (() => {
                    const f = fundOf(leaseOf(r))
                    const remain = f ? Math.max(0, f.realizedIncome - f.fundedExpenseTotal) : 0
                    return (
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={useFund} onChange={e => setUseFund(e.target.checked)}
                            className="w-4 h-4 accent-[var(--coral)]" />
                          <span className="text-xs text-[var(--warm-mid)]">받아둔 청소비로 부담</span>
                        </label>
                        {f && f.realizedIncome > 0 ? (
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] num pl-6">
                            이 퇴실 건 받은 청소비 {won(f.realizedIncome)}, 남은 {won(remain)}.
                          </p>
                        ) : f && f.contractFee > 0 ? (
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] num pl-6">
                            정산 전, 계약 청소비 {won(f.contractFee)}.
                          </p>
                        ) : null}
                      </div>
                    )
                  })()}
                  <div className="flex gap-2">
                    <Btn variant="primary" size="sm" disabled={pending || !doneDate}
                      onClick={() => {
                        const c = Number(cost || 0)
                        const fromFund = useFund && r.reason === 'CHECKOUT' && c > 0
                        // 비용을 넣은 건은 지출 date 도 이 날짜를 따라간다(completeCleaning 이 생성·수정 양쪽에서 doneDate 를 쓴다).
                        run(() => completeCleaning({ id: r.id, doneDate, performer, performerName, cost: c, fromCleaningFund: fromFund }),
                          fromFund ? '청소 완료 · 받은 청소비에서 부담으로 기록됨'
                            : c > 0 ? '청소 완료 · 지출도 함께 기록됨' : '청소 완료로 기록됨')
                        setDoneFor(null); setPerformerName(''); setCost(''); setUseFund(false)
                      }}>
                      완료
                    </Btn>
                    <Btn variant="secondary" size="sm" onClick={() => { setDoneFor(null); setUseFund(false) }}>취소</Btn>
                  </div>
                </div>
              ) : reschedFor === r.id ? (
                /* 날짜 변경 — 완료 입력과 같은 자리, 같은 문법. 고치는 날짜는 그 행에 보이는 날짜다.
                   완료 건이면 완료일이고, 앞으로 한 청소는 없으니 완료일 입력과 같은 상한을 건다. */
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
                    {r.status === 'DONE' ? '완료일' : '예정일'}
                    <DatePicker value={reschedDate} onChange={setReschedDate}
                      maxDate={r.status === 'DONE' ? kstYmdStr() : undefined} className="text-xs" />
                  </div>
                  <div className="flex gap-2">
                    <Btn variant="primary" size="sm" disabled={pending || !reschedDate}
                      onClick={() => {
                        // 완료 건은 지출 date 도 이 날짜를 따라간다(rescheduleCleaning 이 한 트랜잭션에서 함께 옮긴다).
                        run(() => rescheduleCleaning({ id: r.id, date: reschedDate }),
                          r.status !== 'DONE' ? '예정일 변경됨'
                            : r.cost ? '완료일 변경됨 · 지출 날짜도 함께 바뀜' : '완료일 변경됨')
                        setReschedFor(null)
                      }}>
                      저장
                    </Btn>
                    <Btn variant="secondary" size="sm" onClick={() => setReschedFor(null)}>취소</Btn>
                  </div>
                </div>
              ) : (
                /* 행 액션은 RowActionBtn 정본 — 맨 텍스트 버튼은 히트영역이 글자 높이(16px)라
                   §09 터치 타깃 44px 에 못 미친다. 형제(수납·보증금 목록)와 같은 문법이다. */
                <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
                  {r.status === 'PLANNED' && (
                    <RowActionBtn tone="accent" disabled={pending}
                      onClick={() => {
                        setReschedFor(null)
                        // 기본 '업체' — 폼이 열리자마자 이름 칸이 뜬다. 되돌린 건은 그때 적어 둔 이름이
                        // 남아 있어 그것부터 쓰고(다시 받아 적으면 오타로 갈린다), 없으면 최근에 맡긴 곳.
                        setDoneFor(r.id); setPerformer('VENDOR')
                        setPerformerName(r.performerName ?? recentPerformers[0] ?? '')
                        setDoneDate(kstYmdStr())
                        // 되돌린 건은 지출이 그대로 걸려 있다. 비용 칸을 비워 두면 0 으로 다시 완료돼
                        // 연결이 끊기고 그 지출이 고아가 된다 — 걸려 있는 금액을 그대로 채워 둔다.
                        setCost(r.cost ? String(r.cost) : '')
                        // 받아둔 돈이 있거나(실현) 받기로 한 돈이 있으면(계약) 기본 켜짐 —
                        // 퇴실 청소비는 그 돈으로 내는 것이 원칙이라 매번 체크하게 두면 놓친다.
                        const f = fundOf(leaseOf(r))
                        setUseFund(r.reason === 'CHECKOUT' && !!f && (f.realizedIncome > 0 || f.contractFee > 0))
                      }}>
                      완료 처리
                    </RowActionBtn>
                  )}
                  {/* 날짜 변경은 상태를 안 가린다. 완료 건이면 완료일을 고친다. */}
                  <RowActionBtn tone="neutral" disabled={pending}
                    onClick={() => {
                      setDoneFor(null); setReschedFor(r.id)
                      setReschedDate((r.status === 'DONE' ? r.doneDate : r.scheduledDate) ?? kstYmdStr())
                    }}>
                    날짜 변경
                  </RowActionBtn>
                  {r.status === 'PLANNED' && (
                    <RowActionBtn tone="neutral" disabled={pending}
                      onClick={async () => {
                        if (!(await confirmDialog({ title: '이 청소를 안 하기로 할까요?', message: '기록은 남고 상태만 바뀝니다. 같은 자리의 \'안 함 적용취소\'로 되돌릴 수 있습니다.', confirmLabel: '안 하기로', level: 'caution' }))) return
                        run(() => skipCleaning(r.id), '안 하기로 표시됨')
                      }}>
                      안 하기로
                    </RowActionBtn>
                  )}
                  {/* §16 라벨은 '적용취소' 단일. 완료와 안 함 두 곳에서 뜨니 명사를 보강해 무엇을 무르는지 밝힌다.
                      지출이 남았는지는 서버가 돌려준 expenseKept 로 말한다. */}
                  {r.status !== 'PLANNED' && (
                    <RowActionBtn tone="accent" disabled={pending}
                      onClick={() => {
                        const what = r.status === 'DONE' ? '완료' : '안 함'
                        run(() => reopenCleaning(r.id), res =>
                          res.expenseKept ? `${what} 적용취소됨 · 기록된 지출은 그대로 남습니다` : `${what} 적용취소됨`)
                      }}>
                      {r.status === 'DONE' ? '완료 적용취소' : '안 함 적용취소'}
                    </RowActionBtn>
                  )}
                  <RowActionBtn tone="danger" disabled={pending} className="ml-auto"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: '이 청소 기록을 삭제할까요?', message: '기록이 목록에서 사라집니다.', confirmLabel: '삭제', level: 'danger' }))) return
                      run(() => deleteCleaning(r.id), '삭제됨')
                    }}>
                    삭제
                  </RowActionBtn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 잔고는 파생값이라 저장하지 않는다 — 수납·몰취·지출을 그때그때 합해 보여줄 뿐이다.
          초과분은 운영 부담이고, 받은 청소비를 더 받아내는 근거가 아니다. */}
      {fundedLeases.map(f => (
        <p key={f.leaseTermId} className="mt-2 text-xs text-[var(--warm-muted)] num">
          {f.fundedExpenseTotal <= f.realizedIncome
            ? `받은 청소비 ${won(f.realizedIncome)} 중 ${won(f.fundedExpenseTotal)} 부담, 잔여 ${won(f.realizedIncome - f.fundedExpenseTotal)}.`
            : `받은 청소비 ${won(f.realizedIncome)} 중 ${won(f.fundedExpenseTotal)} 부담, 초과 ${won(f.fundedExpenseTotal - f.realizedIncome)}은 운영 부담.`}
        </p>
      ))}

      {open && (
        <p className="mt-2 text-xs text-[var(--warning-fg)]">청소 예정이 남아 있습니다. 호실 목록에도 표시됩니다.</p>
      )}
    </div>
  )
}
