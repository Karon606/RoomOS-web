'use client'

// 청소 행 한 줄의 표시와 조작 정본 — 방 상세 패널과 호실 관리 '청소' 목록이 이 한 벌을 함께 쓴다.
//
// 왜 여기로 모았나. 2026-08-12 에 '청소' 뷰 탭이 생기면서 같은 행을 그리는 코드가 두 벌이 됐고
// (RoomCleaningPanel · CleaningView), 조작은 방 상세에만 있었다. 운영자 지적은 "이력 관리가 아니라
// 이력 뷰어" 였다. 조작을 목록에 복제하면 확인창·토스트·적용취소를 두 벌 관리하게 되고 그 순간
// 둘이 갈린다 — 그래서 복제하지 않고 **행 자체를 정본 컴포넌트로 만들어** 두 화면이 같은 것을 부른다.
//
// 바깥 껍데기(li 의 배경·패딩·구분선)는 부르는 쪽이 정한다. 위젯은 알약, 목록 화면은 카드 안 구분선이라
// 껍데기 문법이 다르지만 **안의 내용과 조작은 같아야** 한다.

import { useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { DatePicker } from '@/components/ui/DatePicker'
import CategorySelect from '@/components/ui/CategorySelect'
import { pushToast, trackSave, type ToastAction } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import {
  getCleaningFundStatus, completeCleaning, reopenCleaning, skipCleaning, deleteCleaning,
  restoreCleaning, rescheduleCleaning,
} from '@/app/(app)/room-manage/cleaningActions'
import {
  CLEANING_REASON_LABEL, CLEANING_PERFORMER_LABEL,
  type CleaningRow, type CleaningPerformer, type CleaningStatus,
  type CleaningFundStatus, type CleaningFundLease,
} from '@/app/(app)/room-manage/cleaningConstants'
import { fmtRoomNo } from '@/lib/roomNo'

const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']

export const CLEANING_STATUS_LABEL: Record<CleaningStatus, string> = {
  PLANNED: '예정', DONE: '완료', SKIPPED: '안 함',
}
// 톤은 기존 정본 셋만 쓴다. 새 톤을 만들면 StatusBadge 를 쓰는 곳을 동시에 고쳐야 한다.
// 완료=paid(끝난 것), 안 함=info(중립), 예정=await(기다리는 것)
export const cleaningTone = (s: CleaningStatus): BadgeTone =>
  (s === 'DONE' ? 'paid' : s === 'SKIPPED' ? 'info' : 'await')

export function CleaningRowBody({
  row: r, fund: fundProp, recentPerformers, canEdit, deleted = false, onOpenRoom, onChanged,
}: {
  row: CleaningRow
  /** 받은 청소비 잔고. undefined 면 완료 폼을 열 때 이 컴포넌트가 그 방 것을 직접 조회한다. */
  fund?: CleaningFundStatus | null
  recentPerformers: string[]
  canEdit: boolean
  /** 삭제된 행 — 복원만 할 수 있다. */
  deleted?: boolean
  /** 호실번호 버튼 — 영업장 교차 목록에서만 선다(방 상세는 이미 그 방이다). */
  onOpenRoom?: (roomId: string) => void
  onChanged: () => void
}) {
  const [doneOpen, setDoneOpen] = useState(false)
  const [reschedOpen, setReschedOpen] = useState(false)
  // 완료일은 오늘로 못 박지 않는다 — 어제 한 청소를 오늘 입력하면 이력이 하루 틀어지고,
  // 비용을 함께 넣은 건은 지출 date 까지 같이 틀어진다(신고 e1ad1c5b).
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  const [reschedDate, setReschedDate] = useState(kstYmdStr())
  // 기본은 '업체'. 청소는 대개 맡기고, 직접 한 경우가 예외다(운영자 지적 2026-08-10, 신고 c2a87782).
  const [performer, setPerformer] = useState<CleaningPerformer>('VENDOR')
  const [performerName, setPerformerName] = useState('')
  const [cost, setCost] = useState('')
  const [useFund, setUseFund] = useState(false)
  const [localFund, setLocalFund] = useState<CleaningFundStatus | null>(null)
  const [pending, startTransition] = useTransition()

  // 부르는 쪽이 주면 그것, 안 주면 완료 폼을 열 때 받아 둔 것.
  const fund = fundProp !== undefined ? fundProp : localFund

  // 그 청소가 딛고 설 계약. 아직 안 걸려 있으면 완료 시점에 서버가 고를 퇴실 계약을 미리 본다
  // (같은 규칙이라 체크 전후로 답이 안 갈린다).
  const fundOf = (f: CleaningFundStatus | null): CleaningFundLease | null => {
    const id = r.leaseTermId ?? (r.reason === 'CHECKOUT' ? f?.checkoutLeaseTermId ?? null : null)
    return (id && f?.leases.find(l => l.leaseTermId === id)) || null
  }

  // okMsg 를 함수로도 받는다 — 되돌리기 문구는 지출이 남았는지를 **서버가 돌려준 값**으로 갈라야 한다.
  // 클라가 들고 있는 목록으로 짐작하면 마지막 조회 이후 지출을 지운 경우와 어긋난다.
  // action 은 토스트 우측 적용취소 버튼(v2.0 §15·§16) — 삭제처럼 확인창만으로는 못 무르는 것에 단다.
  type Done = { ok: true; id?: string; expenseKept?: boolean }
  const run = (
    fn: () => Promise<Done | { ok: false; error: string }>,
    okMsg: string | ((res: Done) => string),
    action?: ToastAction,
  ) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', typeof okMsg === 'function' ? okMsg(res) : okMsg, action ? { action } : undefined)
        onChanged()
      } finally { release() }
    })

  return (
    <>
      <div className={`flex items-center gap-1.5 flex-wrap${deleted ? ' opacity-60' : ''}`}>
        {/* 호실 번호가 그 방으로 가는 문 — 카드 클릭과 같은 동선(형제 목록의 이름 버튼 문법) */}
        {onOpenRoom && (
          <button type="button" onClick={() => onOpenRoom(r.roomId)}
            className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
            {fmtRoomNo(r.roomNo)}
          </button>
        )}
        <StatusBadge tone={cleaningTone(r.status)}>{CLEANING_STATUS_LABEL[r.status]}</StatusBadge>
        <span className="text-xs text-[var(--warm-dark)]">{CLEANING_REASON_LABEL[r.reason]}</span>
        {/* 날짜는 목록·표 정본 fmtDateDot(lib/fmtDate) — 위젯과 목록이 같은 날을 같은 글자로 쓴다.
            로컬 재정의('26.08.07')는 감사 B5 금지 대상이었고, 연도 없는 짧은 표기는 해가 바뀌면
            작년 8/7 과 올해 8/7 이 같은 글자가 된다. */}
        {/* 날짜를 안 정한 예정은 '—' 로 두지 않는다. 그 글자는 '없음 또는 모름'으로 읽히는데
            여기서는 운영자가 '아직 안 정함'을 고른 상태라 뜻이 다르다. 퇴실 미니폼이 예정일을
            비울 수 있게 되면서 처음 생기는 상태다(2026-08-20) — 이 목록이 그 날짜를 잡는
            대기줄이므로, 데이터가 깨진 것처럼 보이면 그 행이 할 일을 못 말한다. */}
        {r.status === 'PLANNED' && !r.scheduledDate ? (
          <span className="text-xs text-[var(--warm-muted)]">예정일 미정</span>
        ) : (
          <span className="text-xs text-[var(--warm-muted)] num">
            {fmtDateDot(r.status === 'DONE' ? r.doneDate : r.scheduledDate)}
          </span>
        )}
        {/* 예정 담당은 계획이라 '누가 하기로 했나'다. 아래 완료 수행자와 칸이 다르므로 말도 다르다 —
            같은 낱말로 적으면 예정 건이 이미 누가 한 것처럼 읽힌다. 안 정했으면 아무 말도 안 한다
            (예정 행마다 '담당 미정'이 서면 그 말이 아무것도 뜻하지 않게 된다). */}
        {r.status === 'PLANNED' && r.plannedPerformer && (
          <span className="text-xs text-[var(--warm-muted)]">
            담당 {CLEANING_PERFORMER_LABEL[r.plannedPerformer]}
          </span>
        )}
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
            <span className="text-xs font-medium text-[var(--warm-dark)] num">{fmtWon(r.cost)}</span>
          ) : (
            <span className="text-xs text-[var(--warm-muted)] num">기록된 지출 {fmtWon(r.cost)}</span>
          )
        )}
        {/* 표식이라 배지가 아니다. 부담한 **금액이 있을 때만** 뜬다(결함 D5) — fromCleaningFund 는
            완료 시점에 켜지는데 그 뒤 지출을 지우면 표식만 남아 부담액 0 인 유령이 된다. */}
        {r.fromCleaningFund && r.cost != null && r.cost > 0 && (
          <span className="text-xs text-[var(--warm-muted)]">받은 청소비로 부담</span>
        )}
      </div>
      {/* 사유 메모는 §11 보조줄. 길이를 모르는 자유 입력이라 칩 줄에 끼우면 줄이 무너진다. */}
      {r.memo && (
        <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words${deleted ? ' opacity-60' : ''}`}>{r.memo}</p>
      )}

      {!canEdit ? null : deleted ? (
        /* 삭제된 행 — 되살리는 문 하나뿐. 토스트 6초는 §16 의 1순위 진입점이고 여기가 2순위다. */
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          <RowActionBtn tone="accent" disabled={pending}
            onClick={() => run(() => restoreCleaning(r.id), '청소 기록 복원됨', {
              label: '적용취소',
              run: () => { void deleteCleaning(r.id).then(res => {
                if (res.ok) { pushToast('info', '복원을 취소했습니다'); onChanged() }
                else pushToast('error', res.error)
              }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
            })}>
            복원
          </RowActionBtn>
        </div>
      ) : doneOpen ? (
        /* 완료 입력 — 그 줄에서 바로 받는다. 별도 모달을 띄우면 창이 또 쌓인다. */
        <div className="mt-2 space-y-2">
          {/* 배타 선택이라 소리로도 고른 것이 들려야 한다(WCAG 4.1.2). 형제 둘(CleaningPlanForm
              사유·담당)과 같은 문법이다 — 셋 중 하나만 고치면 또 갈린다. */}
          <div role="radiogroup" aria-label="청소 수행자" className="flex gap-1.5 flex-wrap">
            {PERFORMERS.map(pf => (
              <button key={pf} type="button" role="radio" aria-checked={performer === pf} onClick={() => {
                setPerformer(pf)
                // 직접 청소는 이름 칸이 사라진다. 값을 남겨 두면 화면에 없는 이름이 저장되고
                // 지출 구매처까지 따라 들어간다 — 안 보이는 값은 저장하지 않는다.
                if (pf === 'SELF') setPerformerName('')
                // 맡긴 쪽으로 바꾸면 최근에 맡긴 곳을 채워 둔다. 이미 적어 둔 이름은 덮지 않는다.
                else if (!performerName) setPerformerName(recentPerformers[0] ?? '')
              }}
                className="px-2 py-1 rounded-lg text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
                style={performer === pf
                  ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                  : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                {CLEANING_PERFORMER_LABEL[pf]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            완료일
            {/* 정본 DatePicker — 앞으로 한 청소는 없으므로 오늘까지만 고를 수 있다. */}
            <DatePicker value={doneDate} onChange={setDoneDate} maxDate={kstYmdStr()} className="text-xs" />
          </div>
          {/* 이름 칸은 맡긴 경우에만. 맡긴 이력이 있으면 그 목록에서 고른다 — 같은 업체를 매번 손으로
              적으면 오타 한 번에 한 업체가 두 이름으로 갈린다. 이력 0건이면 고를 것이 없어 입력 칸. */}
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
          {/* 받은 청소비는 반환의무 없는 확정 수입이라 이 체크는 회계를 안 바꾼다. 어느 돈으로 냈는지
              적는 표식일 뿐이고, 퇴실 청소에만 붙는다 — 그 외에는 귀속시킬 퇴실 계약이 없다. */}
          {r.reason === 'CHECKOUT' && (() => {
            const f = fundOf(fund)
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
                    이 퇴실 건 받은 청소비 {fmtWon(f.realizedIncome)}, 남은 {fmtWon(remain)}.
                  </p>
                ) : f && f.contractFee > 0 ? (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] num pl-6">
                    정산 전, 계약 청소비 {fmtWon(f.contractFee)}.
                  </p>
                ) : null}
              </div>
            )
          })()}
          <div className="flex gap-2">
            <Btn variant="primary" size="sm" disabled={pending || !doneDate}
              onClick={async () => {
                const c = Number(cost || 0)
                // 걸려 있는 지출이 있는데 비용을 0 으로 저장하면 서버가 **연결만 끊는다**(지우는 판단은
                // 운영자 몫이라 그게 맞다). 화면이 침묵하면 그 지출이 어느 청소에도 안 걸린 고아가 된다(D3).
                if (r.cost != null && r.cost > 0 && c === 0) {
                  if (!(await confirmDialog({
                    title: '비용을 0으로 저장할까요?',
                    message: `이 청소에 걸린 지출 ${fmtWon(r.cost)}은 지워지지 않고 연결만 끊깁니다. 지출 관리에 남으니 필요 없으면 거기서 지우세요.`,
                    confirmLabel: '0으로 저장', level: 'caution',
                  }))) return
                }
                const fromFund = useFund && r.reason === 'CHECKOUT' && c > 0
                // 비용을 넣은 건은 지출 date 도 이 날짜를 따라간다(completeCleaning 이 생성·수정 양쪽에서 doneDate 를 쓴다).
                run(() => completeCleaning({ id: r.id, doneDate, performer, performerName, cost: c, fromCleaningFund: fromFund }),
                  fromFund ? '청소 완료 · 받은 청소비에서 부담으로 기록됨'
                    : c > 0 ? '청소 완료 · 지출도 함께 기록됨' : '청소 완료로 기록됨')
                setDoneOpen(false); setPerformerName(''); setCost(''); setUseFund(false)
              }}>
              완료
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => { setDoneOpen(false); setUseFund(false) }}>취소</Btn>
          </div>
        </div>
      ) : reschedOpen ? (
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
                setReschedOpen(false)
              }}>
              저장
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setReschedOpen(false)}>취소</Btn>
          </div>
        </div>
      ) : (
        /* 행 액션은 RowActionBtn 정본 — 맨 텍스트 버튼은 히트영역이 글자 높이(16px)라
           §09 터치 타깃 44px 에 못 미친다. 형제(수납·보증금 목록)와 같은 문법이다. */
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {r.status === 'PLANNED' && (
            <RowActionBtn tone="accent" disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  setReschedOpen(false)
                  // 기본 '업체' — 폼이 열리자마자 이름 칸이 뜬다. 되돌린 건은 그때 적어 둔 이름이
                  // 남아 있어 그것부터 쓰고(다시 받아 적으면 오타로 갈린다), 없으면 최근에 맡긴 곳.
                  setPerformer('VENDOR')
                  setPerformerName(r.performerName ?? recentPerformers[0] ?? '')
                  setDoneDate(kstYmdStr())
                  // 되돌린 건은 지출이 그대로 걸려 있다. 비용 칸을 비워 두면 0 으로 다시 완료돼
                  // 연결이 끊기고 그 지출이 고아가 된다 — 걸려 있는 금액을 그대로 채워 둔다.
                  setCost(r.cost ? String(r.cost) : '')
                  // 잔고를 안 받아 왔으면 지금 받는다(교차 목록은 방마다 달라 미리 다 받으면 방 수만큼 조회다).
                  let f = fundProp
                  if (f === undefined) {
                    f = await getCleaningFundStatus(r.roomId).catch(() => null)
                    setLocalFund(f)
                  }
                  // 받아둔 돈이 있거나(실현) 받기로 한 돈이 있으면(계약) 기본 켜짐 —
                  // 퇴실 청소비는 그 돈으로 내는 것이 원칙이라 매번 체크하게 두면 놓친다.
                  const lease = fundOf(f)
                  setUseFund(r.reason === 'CHECKOUT' && !!lease && (lease.realizedIncome > 0 || lease.contractFee > 0))
                  setDoneOpen(true)
                })
              }}>
              완료 처리
            </RowActionBtn>
          )}
          {/* 날짜 변경은 상태를 안 가린다. 완료 건이면 완료일을 고친다. */}
          <RowActionBtn tone="neutral" disabled={pending}
            onClick={() => {
              setDoneOpen(false)
              setReschedDate((r.status === 'DONE' ? r.doneDate : r.scheduledDate) ?? kstYmdStr())
              setReschedOpen(true)
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
              // 지출이 걸려 있으면 문구를 가른다(결함 D1). 삭제는 청소 기록만 지우고 지출은 남기는데
              // 종전 확인창은 그 사실에 침묵했다 — 되돌리기는 이미 말해 주던 것을 삭제만 안 했다.
              const linkedCost = r.cost != null && r.cost > 0 ? r.cost : null
              if (!(await confirmDialog({
                title: '이 청소 기록을 삭제할까요?',
                message: linkedCost != null
                  ? `기록이 목록에서 사라집니다. 함께 기록된 지출 ${fmtWon(linkedCost)}은 지출 관리에 그대로 남습니다.`
                  : '기록이 목록에서 사라집니다.',
                confirmLabel: '삭제', level: 'danger',
              }))) return
              // 소프트삭제라 되살릴 수 있다(결함 D2) — 지출 삭제 토스트와 같은 적용취소 문법.
              // 토스트가 사라진 뒤에는 호실 관리 '청소' 뷰의 '삭제됨 보기'가 2순위 진입점이다(§16).
              run(() => deleteCleaning(r.id), '삭제됨', {
                label: '적용취소',
                run: () => { void restoreCleaning(r.id).then(res => {
                  if (res.ok) { pushToast('info', '청소 기록을 복원했습니다'); onChanged() }
                  else pushToast('error', res.error)
                }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) },
              })
            }}>
            삭제
          </RowActionBtn>
        </div>
      )}
    </>
  )
}
