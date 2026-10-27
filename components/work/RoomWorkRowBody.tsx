'use client'

// 작업 행의 표시·조작 — 완료 처리·한 건 수정·복원 (2026-08-25, 신고 b21e4e98 후속. 2026-10-27 한 건 수정 Modal).
//
// components/cleaning/CleaningRowBody 를 거울로 삼았다. 그 파일을 재사용하지 않은 것은
// 거기에 청소 전용 조작(안 함 처리·받은 청소비 부담·잔고 조회)이 얽혀 있어, 파라미터로
// 가르면 접점이 그만큼 늘기 때문이다. 껍데기 문법과 톤은 그대로 베꼈다.
//
// 다른 것 셋. 상태가 둘뿐이고(예정·완료), 부담 표식이 없고, 비용이 **여러 지출의 합**이다
// (자재를 여러 날 나눠 사고 시공은 하루다 — Expense.roomWorkId 가 1:N 이다).

import { useState, useTransition } from 'react'
import { askWorkLink } from '@/components/work/workLinkPrompt'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { DatePicker } from '@/components/ui/DatePicker'
import CategorySelect from '@/components/ui/CategorySelect'
import { pushToast, trackSave, type ToastAction } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { kstYmdStr } from '@/lib/kstDate'
import {
  completeRoomWork, reopenRoomWork, deleteRoomWork, restoreRoomWork, unlinkExpensesFromWork,
  type RoomWorkRow,
} from '@/app/(app)/room-manage/workActions'
import {
  CLEANING_PERFORMER_LABEL, type CleaningPerformer,
} from '@/app/(app)/room-manage/cleaningConstants'
import { PayMethodField } from '@/components/finance/PayMethodField'
import { useWorkPay } from '@/components/work/useWorkPay'
import { RoomWorkEditModal } from '@/components/work/RoomWorkEditModal'

// 형제 행과 같은 껍데기·같은 이유(오류신고 c2ab5b83 — 안 넘기면 맨글자로 그려진다).
const DENSE_DATE_CLS =
  'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
// 촘촘한 완료 폼 라벨 폭 — 완료일·시공비·결제수단·계좌 칸이 같은 자리에서 시작한다(권고 8, PayMethodField dense 와 같은 값).
const DENSE_LABEL_CLS = 'w-14 shrink-0'
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tc-text)]'

const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']

/** 톤은 기존 정본만 쓴다. 완료=paid(끝난 것) · 예정=await(기다리는 것). '안 함'은 작업에 없다. */
const workTone = (s: 'PLANNED' | 'DONE'): BadgeTone => (s === 'DONE' ? 'paid' : 'await')

export function RoomWorkRowBody({
  row: r, canEdit, deleted = false, recentPerformers, modalZ, onChanged,
}: {
  row: RoomWorkRow
  canEdit: boolean
  /** 최근에 맡긴 업체·사람 — 이름 칸 선택지. 비면 자유 입력으로 떨어진다(형제 청소 행과 같다). */
  recentPerformers: string[]
  /**
   * 한 건 수정 Modal 의 층(2026-10-27). 방 모달(EntityModal) 안이면 260, 페이지(호실 관리 작업 탭)면 200.
   * 종전 '편집' 모드(showActions)는 걷었다. 목록 전체가 한꺼번에 고칠 수 있게 되는 것을 운영자가 불안해했다(2026-10-27 지적).
   * 이제 행마다 [수정] 이 그 한 건만 여는 Modal 이고, 되돌림·삭제는 그 Modal 발끝 `관리` 메뉴에 있다(가이드 §27.1·§13).
   */
  modalZ: 200 | 260

  /** 삭제된 행 — 복원만 할 수 있다. */
  deleted?: boolean
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [doneOpen, setDoneOpen] = useState(false)
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  const [performer, setPerformer] = useState<CleaningPerformer>('VENDOR')
  const [performerName, setPerformerName] = useState('')
  // 빈 문자열이다. 숫자 0 으로 두면 칸에 '0' 이 찍혀 뒤에 이어 친 값이 '0140000' 이 된다
  // (운영자 지적 2026-08-27). 형제인 청소 행이 이미 이 문법이다 — 0 은 placeholder 로만 보인다.
  const [cost, setCost] = useState('')
  // 완료 폼 시공비를 견적에서 채웠는가(3단계, 2026-10-27). 채운 값 그대로인 동안만 '견적에서 채웠습니다' 를 말한다.
  const [fromEstimate, setFromEstimate] = useState(false)
  // 결제수단 — 시공비가 지출을 새로 만들거나 걸린 한 건을 고칠 때만 묻는다(2026-10-27 운영자 지적). 여러 건이 걸려 있으면
  // 완료가 지출을 안 건드리므로 묻지 않는다. 기본값은 같은 업체 직전 → 같은 카테고리 직전 → 영업장 목록 첫 값(lib/workPayDefault).
  const payAsked = Number(cost || 0) > 0 && r.expenseCount <= 1
  const pay = useWorkPay({ kind: 'work', enabled: doneOpen && payAsked, vendor: performerName, vendors: recentPerformers })
  // 한 건 수정 Modal(날짜·종류·수행자·업체·시공비·결제수단·메모, 관리 메뉴의 완료 적용취소·삭제).
  const [editOpen, setEditOpen] = useState(false)

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okMsg: string,
    action?: ToastAction,
  ) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', okMsg, action ? { action } : undefined)
        onChanged()
      } finally { release() }
    })

  const shownDate = r.status === 'DONE' ? r.doneDate : r.scheduledDate

  return (
    <div>
      {/* 삭제된 건은 글만 흐린다. 감싸는 통째로 흐리면 '복원' 버튼까지 같이 죽는다(형제 CleaningRowBody 와 같은 문법). */}
      <div className={`flex items-center gap-1.5 flex-wrap${deleted ? ' opacity-60' : ''}`}>
        <StatusBadge tone={workTone(r.status)}>{r.status === 'DONE' ? '완료' : '예정'}</StatusBadge>
        <span className="text-xs font-medium text-[var(--warm-dark)]">{r.kind}</span>
        {shownDate && <span className="text-xs text-[var(--warm-muted)] num">{fmtDateDot(shownDate)}</span>}
        {/* 되돌린 건은 예정인데도 지출이 그대로 걸려 있다(그래야 재완료가 두 건을 안 만든다).
            형제 행과 같은 말로 가른다 — '예정인데 얼마 나갔다'로 읽히면 안 된다. */}
        {r.cost > 0 && (
          r.status === 'DONE' ? (
            <span className="text-xs font-medium text-[var(--warm-dark)] num">{fmtWon(r.cost)}</span>
          ) : (
            <span className="text-xs text-[var(--warm-muted)] num">기록된 지출 {fmtWon(r.cost)}</span>
          )
        )}

        {/* 여러 건이 붙었으면 그 사실을 말한다. 시공비를 나눠 받으면 합계만으로는 왜 이 금액인지 안 선다. */}
        {r.laborExpenseCount > 1 && (
          <span className="text-xs text-[var(--warm-muted)] num">시공 {r.laborExpenseCount}건</span>
        )}
      </div>

      {/* 수행자는 §11 보조줄이다. 칩 줄에 두면 종류 이름이 긴 행에서 금액이 다음 줄로 밀려
          형제 행과 모양이 갈린다 — '실리콘 시공 · 날짜 · 업체 · 글로벌코킹'까지 서면 150,000원이
          내려간다(운영자 지적 2026-08-28). 시공비·자재비를 칩 줄에서 내렸던 것과 같은 이유이고,
          그때 실측(437px, 320·360·390 전부 두 줄)으로 이미 한 번 겪은 자리다. */}
      {(r.performer || r.performerName) && (
        <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)]${deleted ? ' opacity-60' : ''}`}>
          {r.performer ? CLEANING_PERFORMER_LABEL[r.performer] : '기록된 이름'}
          {r.performerName ? ` · ${r.performerName}` : ''}
        </p>
      )}

      {/* 걸린 지출 줄 — **무엇이 얼마이고 어느 업체인지** 여기서 보인다.
          종전에는 '시공 2건'이라고만 하고 내용을 안 보여줬다(운영자 지적 2026-08-28 —
          "시공 2건이 뭔지도 못보고 시공업체도 못봐"). 걸린 지출이 여럿일 때 "어느 줄인지
          앱이 모른다"고 했던 것도 같은 원인이다 — 운영자는 안다. 화면이 안 보여줬을 뿐이다.
          금액은 [수정] Modal 에서 고친다(줄마다 '금액·업체 고치기'. 종전 즉시 저장 칸은 적용취소가 없어 걷었다). */}
      {r.linkedExpenses.length > 0 && (
        <ul className={`mt-1 space-y-0.5${deleted ? ' opacity-60' : ''}`}>
          {r.linkedExpenses.map(e => (
            <li key={e.id} className="flex items-center gap-1.5 text-[0.65625rem] text-[var(--warm-muted)]">
              <span className="min-w-0 flex-1 truncate">
                {e.label}{e.vendor ? ` · ${e.vendor}` : ''}
              </span>
              <span className="shrink-0 num">{fmtWon(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 견적은 §11 보조줄(3단계, 2026-10-27). 돈이 아니라 메모라 칩 줄의 굵은 금액(실제 시공비)과 자리를 나눈다.
          완료 건에서 실제 시공비가 견적과 다르면 둘을 가운뎃점으로 나란히 적는다. 값이 바뀐 것이 아니라 비교라 화살표를 쓰지 않는다(§29, 독립 검수 권고 7).
          '실제 시공비' 는 이 행 금액과 같은 시공 몫이다(자재비는 안 든다). */}
      {r.estimateAmount != null && (
        <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)] num${deleted ? ' opacity-60' : ''}`}>
          {r.status === 'DONE' && r.cost > 0 && r.cost !== r.estimateAmount
            ? `견적 ${fmtWon(r.estimateAmount)} · 실제 시공비 ${fmtWon(r.cost)}`
            : `견적 ${fmtWon(r.estimateAmount)}`}
        </p>
      )}

      {/* 메모는 §11 보조줄. 길이를 모르는 자유 입력이라 칩 줄에 끼우면 줄이 무너진다. */}
      {r.memo && (
        <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words${deleted ? ' opacity-60' : ''}`}>{r.memo}</p>
      )}

      {!canEdit ? null : deleted ? (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          <RowActionBtn tone="accent" disabled={pending}
            onClick={() => run(() => restoreRoomWork(r.id), '작업 기록 복원됨', {
              label: '적용취소',
              run: () => { void deleteRoomWork(r.id).then(res => {
                if (res.ok) { pushToast('info', '복원을 취소했습니다'); onChanged() }
                else pushToast('error', res.error)
              }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
            })}>
            복원
          </RowActionBtn>
        </div>
      ) : doneOpen ? (
        /* 완료 입력 — 그 줄에서 바로 받는다. 별도 모달을 띄우면 창이 또 쌓인다(형제 행과 같다). */
        <div className="mt-2 space-y-2">
          <div role="radiogroup" aria-label="작업 수행자" className="flex gap-1.5 flex-wrap">
            {PERFORMERS.map(v => (
              <button key={v} type="button" role="radio" aria-checked={performer === v}
                onClick={() => setPerformer(v)}
                className={`rounded-lg px-2 py-1 text-xs ${FOCUS_RING}`}
                style={performer === v
                  ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                  : { background: 'var(--canvas)', color: 'var(--seg-ink-off)', border: '1px solid var(--warm-border)' }}>
                {CLEANING_PERFORMER_LABEL[v]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            <span className={DENSE_LABEL_CLS}>완료일</span>
            {/* 미래는 못 고른다 — 아직 안 한 작업을 완료로 적을 수는 없다(운영자 확정 2026-09-17).
                바로 위 날짜 변경 줄은 완료 건에만 이 상한을 걸고 있었는데 여기만 비어 있었다. */}
            <DatePicker value={doneDate} onChange={setDoneDate} maxDate={kstYmdStr()} className={DENSE_DATE_CLS} />
          </div>
          {/* 이름 칸 — 맡긴 이력이 있으면 그 목록에서 고른다. 같은 업체를 매번 손으로 적으면
              오타 한 번에 한 업체가 두 이름으로 갈린다('글로벌 코킹' 대 '글로벌코킹'이 실제로 그랬다).
              형제인 청소 행이 쓰는 그 목록·그 컨트롤을 그대로 쓴다. */}
          {recentPerformers.length > 0 ? (
            <CategorySelect
              value={performerName} onChange={setPerformerName}
              options={recentPerformers} emptyLabel="업체·사람 이름 (선택)"
              placeholder="업체·사람 이름" closeIconSize={12}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]" />
          ) : (
            <input type="text" value={performerName} onChange={e => setPerformerName(e.target.value)}
              placeholder="업체·사람 이름 (선택)"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]" />
          )}
          {/* 비용 — 넣으면 지출이 **새로** 한 줄 생기고 이 작업에 걸린다.
              **여기 넣을 것은 시공비(이번에 새로 나간 돈)뿐이다.** 자재는 살 때 이미 지출로
              잡혔고, 방별 몫은 그 지출을 쪼갠 행이다(allocationGroupId). 총액을 넣으면 이미
              잡힌 자재값이 한 번 더 지출이 된다 — 운영자 지적 2026-08-25. */}
          {/* 형제 행과 같은 칸이다 — 폭 w-28 · 뒤에 '원'. MoneyInput 정본은 className 을 안 받고
              이 자리는 촘촘한 행이라 형제가 쓰는 문법을 그대로 쓴다. */}
          <label className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            <span className={DENSE_LABEL_CLS}>시공비</span>
            <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)}
              placeholder="0" min={0}
              className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs num" />
            원
          </label>
          {/* 시공비 안내는 시공비 칸 바로 밑이다(독립 검수 권고 8). 결제수단 칸이 그 사이에 끼면 무엇에 딸린 말인지 흐려진다. */}
          {fromEstimate && r.estimateAmount != null && cost === String(r.estimateAmount) && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">견적에서 채웠습니다.</p>
          )}
          {r.expenseCount > 0 ? (
            /* 금액은 지출 쪽이 정본이라 여기서 못 고친다. 그런데 종전에는 "지출 화면에서
               고칩니다"라고만 하고 **거기까지 가는 길이 없었다**(운영자 지적 2026-08-27).
               위 '이 방에 든 지출' 줄도 눌리지 않는다. 그 달 지출 화면으로 데려다준다. */
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              {r.expenseCount === 1
                ? '이미 걸린 지출의 금액과 업체를 여기서 고칩니다. 새 지출을 만들지 않습니다.'
                : `이미 지출 ${r.expenseCount}건이 걸려 있어 새로 만들지 않습니다. 줄마다 금액은 완료 뒤 수정에서 고칩니다.`}{' '}
              <button type="button"
                onClick={() => { window.location.assign(`/finance?month=${(r.doneDate ?? r.scheduledDate ?? kstYmdStr()).slice(0, 7)}`) }}
                className="underline text-[var(--tc-text)] font-medium">지출 화면 열기</button>
            </p>
          ) : Number(cost || 0) > 0 ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">지출 한 줄이 수선유지비로 기록되고 이 작업에 걸립니다. 이미 사둔 자재값은 넣지 마세요. 살 때 이미 지출로 잡혔습니다.</p>
          ) : null}
          {payAsked && pay.ready && (
            <PayMethodField dense methods={pay.methods} accounts={pay.accounts}
              payMethod={pay.payMethod} accountId={pay.accountId} onChange={pay.onChange} />
          )}
          <div className="flex gap-1.5 flex-wrap items-center">
            <RowActionBtn tone="accent" disabled={pending}
              onClick={async () => {
                const args = { id: r.id, doneDate, performer, performerName, cost: Number(cost || 0), ...(payAsked ? pay.payload : {}) }
                // 먼저 묻는다(mode 기본 'ask'). 걸릴 만한 지출이 있으면 서버가 **아무것도 쓰지 않고**
                // 후보를 돌려준다 — 자동으로 묶는 분기는 어디에도 없다.
                const probe = await completeRoomWork(args)
                let mode: 'link' | 'create' = 'create'
                if (!probe.ok && 'needsChoice' in probe) {
                  const pick = await askWorkLink({ roomNo: r.roomNo ?? '', kind: r.kind, candidates: probe.candidates })
                  if (!pick) return                       // 그만두기 — 아무것도 안 바뀐다(§27.5)
                  mode = pick
                } else if (!probe.ok) { pushToast('error', probe.error); return }
                else { setDoneOpen(false); setPerformerName(''); setCost(''); onChanged(); pushToast('success', '작업 완료됨'); return }

                const linked = mode === 'link' ? probe.candidates.map(c => c.id) : []
                run(
                  async () => {
                    const res = await completeRoomWork({ ...args, mode })
                    // mode 가 정해진 재호출이라 needsChoice 는 안 온다 — run() 의 계약에 맞춘다.
                    return res.ok ? res : { ok: false as const, error: 'error' in res ? res.error : '완료 처리에 실패했습니다.' }
                  },
                  mode === 'link' ? '작업 완료됨 · 이미 있던 지출을 걸었습니다' : '작업 완료됨',
                  { label: '적용취소', run: () => { void (async () => {
                      // 연결부터 되돌리고 완료를 무른다 — 순서가 반대면 되돌린 작업에 지출이 남는다.
                      if (linked.length > 0) await unlinkExpensesFromWork(linked)
                      const res = await reopenRoomWork(r.id)
                      if (res.ok) { pushToast('info', '완료를 적용취소했습니다 · 예정으로 복귀'); onChanged() }
                      else pushToast('error', res.error)
                    })().catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } },
                )
                // 폼을 닫는다. 종전에는 이 줄이 없어 배지가 '완료'로 바뀐 뒤에도 저장 버튼이
                // 그대로 살아 있었다(운영자 지적 2026-08-27). 형제인 청소 행은 원래 닫는다.
                setDoneOpen(false); setPerformerName(''); setCost('')
              }}>
              저장
            </RowActionBtn>
            <RowActionBtn onClick={() => setDoneOpen(false)}>취소</RowActionBtn>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {r.status === 'PLANNED' && (
            <RowActionBtn tone="accent" disabled={pending} onClick={() => {
              // 이미 걸린 지출이 있으면 그 값을 미리 채운다 — 아는 것을 다시 묻지 않는다
              // (운영자 지적 2026-08-28). 한 건일 때만이다. 여러 건이면 어느 줄의 금액인지 모른다.
              const only = r.linkedExpenses.length === 1 ? r.linkedExpenses[0] : null
              // 걸린 지출의 결제수단이 있으면 그것이 처음 값이다(없으면 업체를 따라가는 기본값).
              pay.reset(only ? { payMethod: only.payMethod, financialAccountId: only.financialAccountId } : null, !!only)
              if (only) {
                setCost(String(only.amount))
                if (only.vendor) { setPerformerName(only.vendor); setPerformer('VENDOR') }
              }
              // 걸린 지출이 없고 견적이 있으면 시공비 칸을 견적으로 채운다(3단계). 견적은 지출이 아니라 이 칸의 처음 값일 뿐이다.
              const est = !only && r.expenseCount === 0 && r.estimateAmount ? r.estimateAmount : null
              if (est) setCost(String(est))
              setFromEstimate(!!est)
              setDoneOpen(true)
            }}>완료 처리</RowActionBtn>
          )}
          {/* 한 건 수정 — 그 행 하나만 고치는 Modal 을 연다(2026-10-27). 날짜 변경·완료 적용취소·삭제가 따로 서던 자리를 모았다.
              되돌림·삭제는 Modal 발끝 `관리` 메뉴다. 행에는 [완료 처리](예정)와 [수정] 둘만 상시로 선다. */}
          <RowActionBtn tone="neutral" disabled={pending} onClick={() => { setDoneOpen(false); setEditOpen(true) }}>수정</RowActionBtn>
        </div>
      )}
      {editOpen && (
        <RoomWorkEditModal row={r} z={modalZ} recentPerformers={recentPerformers}
          onClose={() => setEditOpen(false)} onChanged={onChanged} />
      )}
    </div>
  )
}
