'use client'

// 현금영수증 탭 — 그 달 미발행 입금을 골라 한 번에 발행을 기록하는 자리 (2026-08-25, 3단계).
//
// 왜 새 라우트가 아니라 수납 관리의 탭인가. 월 스코프(`?month=`)와 발행일 축 합계가 이미 이
// 화면에 있어, "합계가 왜 이 값인가"의 답이 같은 자리에 선다. 새 라우트면 월 정본과 내비
// 전파를 다시 깔아야 한다(설계 판정 2026-08-25, Fable 5 + 전문가 패널).
//
// **축이 둘이다.** 후보는 입금일 축일 수밖에 없고(아직 발행 안 했으니 발행일이 없다) 합계와
// 발행 기록은 발행일 축이다. 그래서 각 목록이 축 이름을 **상시 텍스트**로 적는다.

import { useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { DatePicker } from '@/components/ui/DatePicker'
import { InfoHint } from '@/components/ui/InfoHint'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { useCanEdit } from '@/components/RoleContext'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtMD } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { kstYmdStr } from '@/lib/kstDate'
import { depositCashReceiptWarning, CASH_RECEIPT_OBLIGATION_MIN } from '@/lib/cashReceipt'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { batchSetCashReceipts, batchUnsetCashReceipts, muteReceiptAlert, unmuteReceiptAlert } from '@/app/(app)/rooms/actions'

type Candidate = {
  leaseTermId: string; tenantId: string; roomNo: string; tenantName: string
  payYmd: string; payMethod: string; amount: number; deposit: number; cleaning: number
}
type MutedCandidate = Candidate & { mutedAt: string }
type Issued = {
  roomNo: string; tenantName: string; amount: number
  issuedYmd: string; payYmd: string; payMethod: string | null
}

export function CashReceiptTab({
  candidates, issued, muted, targetMonth, issuedSum, issuedCount, onChanged,
}: {
  candidates: Candidate[]
  issued: Issued[]
  /** 발급 기한 알림을 수동으로 끈 입금 — 접힌 목록으로 두고 언제든 다시 켠다(§16). */
  muted: MutedCandidate[]
  targetMonth: string
  issuedSum: number
  issuedCount: number
  onChanged: () => void
}) {
  const canEdit = useCanEdit()
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [issuedDate, setIssuedDate] = useState(kstYmdStr())
  // 끈 입금은 기본 접힘 — 끈 것은 조용한 것이 정상이다(홈 '끈 알림'과 같은 처방).
  const [mutedOpen, setMutedOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const keyOf = (c: Candidate) => `${c.leaseTermId}|${c.payYmd}|${c.payMethod}`
  const chosen = candidates.filter(c => picked.has(keyOf(c)))
  const chosenSum = chosen.reduce((a, c) => a + c.amount, 0)

  const exitSelect = () => { setSelectMode(false); setPicked(new Set()) }
  const toggle = (c: Candidate) => {
    const k = keyOf(c)
    setPicked(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const run = () => startTransition(async () => {
    const release = trackSave()
    try {
      const items = chosen.map(c => ({ leaseTermId: c.leaseTermId, tenantId: c.tenantId, payYmd: c.payYmd, payMethod: c.payMethod }))
      const res = await batchSetCashReceipts({ items, issuedDate })
      if (!res.ok) { pushToast('error', res.error); return }
      setModalOpen(false); exitSelect()
      pushToast('success', `${res.done}건 발행 기록됨 · 발행일 ${fmtMD(issuedDate)}`, {
        ...(res.skipped > 0 ? { detail: `${res.skipped}건은 이미 발행 기록이 있어 제외` } : {}),
        action: {
          label: '적용취소',
          run: () => { void batchUnsetCashReceipts(items).then(r => {
            if (r.ok) { pushToast('info', '일괄 발행 기록을 취소했습니다'); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) },
        },
      })
      // 발행일이 지금 보는 달 밖이면 그 사실을 말한다 — 처리는 됐는데 합계가 안 움직이면
      // 실패로 읽힌다(§27.6 월 스코프 사후 안내).
      if (issuedDate.slice(0, 7) !== targetMonth) {
        pushToast('info', `지금 보는 ${Number(targetMonth.slice(5))}월 합계에는 표시되지 않습니다`)
      }
      onChanged()
    } finally { release() }
  })

  return (
    <div className="space-y-4">
      {/* 헤더 — 수납 스트립과 같은 껍데기. 발행일 축임을 상시 텍스트로 적는다. */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-4 py-3">
        <p className="text-xs text-[var(--warm-muted)] num">
          발행일 기준 이 달 발행 <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(issuedSum)}</span>
          <span className="num"> ({issuedCount}건)</span>
          <InfoHint title="현금영수증 탭">
            <span className="block">합계는 발행한 날이 속한 달 기준입니다. 홈택스 자료와 맞추기 위한 축입니다.</span>
            <span className="block mt-1.5">아래 첫 목록은 이 달에 받은 입금 중 발행 기록이 없는 것입니다. 전부 발행 대상은 아니니 발행한 건만 골라 기록하세요.</span>
            <span className="block mt-1.5">카드 결제는 매출전표가 증빙을 대신해 여기 없습니다.</span>
            <span className="block mt-1.5">끈 건은 발급 후보에서도 빠집니다.</span>
          </InfoHint>
        </p>
      </div>

      {candidates.length === 0 && issued.length === 0 && muted.length === 0 ? (
        <EmptyState
          title="이 달 현금영수증 기록이 없습니다"
          description="현금이나 계좌이체로 받은 입금이 기록되면 여기서 발행을 기록할 수 있습니다."
        />
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-xs font-semibold text-[var(--warm-mid)]">발행 기록이 없는 입금 ({candidates.length}건)</h2>
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">입금일 기준 · 카드 결제 제외</p>
              </div>
              {canEdit && candidates.length > 0 && (
                <Btn variant="secondary" size="sm" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
                  {selectMode ? '선택 취소' : '선택'}
                </Btn>
              )}
            </div>
            {candidates.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)]">카드를 제외한 이 달 입금에는 모두 발행 기록이 있습니다.</p>
            ) : (
              <>
                {selectMode && (
                  <button type="button"
                    onClick={() => setPicked(picked.size === candidates.length ? new Set() : new Set(candidates.map(keyOf)))}
                    className="-my-2 min-h-[44px] flex items-center text-[0.65625rem] text-[var(--warm-mid)] underline decoration-dotted underline-offset-2">
                    {picked.size === candidates.length ? '전체 해제' : '전체 선택'}
                  </button>
                )}
                <ul className="space-y-1.5">
                  {candidates.map(c => {
                    const extra = [c.deposit > 0 ? `보증금 ${fmtWon(c.deposit)} 포함` : '', c.cleaning > 0 ? `청소비 ${fmtWon(c.cleaning)} 포함` : ''].filter(Boolean)
                    return (
                      <li key={keyOf(c)}>
                        <label className={`flex items-center gap-2.5 rounded-sm px-3 py-2.5 bg-[var(--canvas)] ${selectMode ? 'cursor-pointer' : ''}`}>
                          {selectMode && (
                            <input type="checkbox" checked={picked.has(keyOf(c))} onChange={() => toggle(c)}
                              className="w-3.5 h-3.5 accent-[var(--coral)] shrink-0" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-[var(--warm-dark)] truncate">
                              {fmtRoomNo(c.roomNo)} {c.tenantName}
                            </span>
                            <span className="block text-[0.65625rem] text-[var(--warm-muted)] break-keep">
                              입금 {fmtMD(c.payYmd)} · {c.payMethod}{extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}
                            </span>
                            {/* 알림 끄기 — 발행 여부는 운영자 판단 영역이라 끌 수 있어야 한다(운영자 지시
                                2026-09-01). 끈 건은 아래 접힌 목록에 남아 언제든 다시 켠다.
                                액션은 금액 앞이 아니라 텍스트 열 아래다 — 금액 열이 형제 목록과
                                어긋나고 선택 모드 전환 때 튀었다(디자이너 지적 2026-09-02).
                                홈 알림이 조르는 건(의무 기준액 이상)에만 선다 — 조르지도 않는 건에
                                끄기 버튼이 서면 목록이 없는 일을 시킨다. */}
                            {canEdit && !selectMode && c.amount >= CASH_RECEIPT_OBLIGATION_MIN && (
                              <span className="flex gap-1.5">
                                <RowActionBtn tone="neutral" disabled={pending}
                                  onClick={() => startTransition(async () => {
                                    const release = trackSave()
                                    try {
                                      const r = await muteReceiptAlert(keyOf(c))
                                      if (!r.ok) { pushToast('error', r.error); return }
                                      pushToast('success', `${fmtRoomNo(c.roomNo)} ${c.tenantName} 발급 알림을 껐습니다`, {
                                        detail: '알림만 접습니다. 발급 의무가 사라지는 것은 아니고, 아래 목록에서 다시 켤 수 있습니다.',
                                        action: { label: '적용취소', run: () => { void unmuteReceiptAlert(keyOf(c)).then(u => {
                                          if (u.ok) { pushToast('info', '알림을 다시 켰습니다'); onChanged() }
                                          else pushToast('error', u.error)
                                        }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
                                      })
                                      onChanged()
                                    } finally { release() }
                                  })}>
                                  알림 끄기
                                </RowActionBtn>
                              </span>
                            )}
                          </span>
                          <span className="text-sm font-semibold num text-[var(--warm-dark)] shrink-0">{fmtWon(c.amount)}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          {/* 끈 입금 — 기본 접힘. 목록을 늘리지 않으면서 다시 켤 문은 항상 남긴다(§16). */}
          {muted.length > 0 && (
            <section className="space-y-2">
              {!mutedOpen ? (
                <button type="button" onClick={() => setMutedOpen(true)}
                  className="-my-2 min-h-[44px] flex items-center text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2">
                  알림 끈 입금 {muted.length}건 보기
                </button>
              ) : (
                <>
                  <div>
                    <h2 className="text-xs font-semibold text-[var(--warm-mid)]">알림 끈 입금 ({muted.length}건)</h2>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">입금일 기준 · 발급 의무는 남음</p>
                  </div>
                  <ul className="space-y-1.5">
                    {muted.map(c => (
                      <li key={keyOf(c)} className="flex items-center gap-2.5 rounded-sm px-3 py-2.5 bg-[var(--canvas)]">
                        <span className="min-w-0 flex-1">
                          {/* 흐림은 텍스트에만 — 행 전체에 걸면 다시 켜는 버튼까지 흐려진다. */}
                          <span className="block text-sm font-semibold text-[var(--warm-dark)] truncate opacity-80">{fmtRoomNo(c.roomNo)} {c.tenantName}</span>
                          <span className="block text-[0.65625rem] text-[var(--warm-muted)] break-keep opacity-80">입금 {fmtMD(c.payYmd)} · {c.payMethod} · 알림 끔 {fmtMD(c.mutedAt)}</span>
                          {canEdit && (
                            <span className="flex gap-1.5">
                              <RowActionBtn tone="accent" disabled={pending}
                                onClick={() => startTransition(async () => {
                                  const release = trackSave()
                                  try {
                                    const r = await unmuteReceiptAlert(keyOf(c))
                                    if (!r.ok) { pushToast('error', r.error); return }
                                    pushToast('info', '알림을 다시 켰습니다')
                                    onChanged()
                                  } finally { release() }
                                })}>
                                다시 켜기
                              </RowActionBtn>
                            </span>
                          )}
                        </span>
                        <span className="text-sm font-semibold num text-[var(--warm-dark)] shrink-0">{fmtWon(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setMutedOpen(false)}
                    className="-my-2 min-h-[44px] flex items-center text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2">
                    접기
                  </button>
                </>
              )}
            </section>
          )}

          <section className="space-y-2">
            <div>
              <h2 className="text-xs font-semibold text-[var(--warm-mid)]">발행 기록</h2>
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">발행일 기준 · 위 합계와 같은 목록</p>
            </div>
            {issued.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)]">이 달 발행 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {issued.map((r, i) => (
                  <li key={`${r.roomNo}-${r.payYmd}-${i}`} className="flex items-center gap-2.5 rounded-sm px-3 py-2.5 bg-[var(--canvas)]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--warm-dark)] truncate">
                        {fmtRoomNo(r.roomNo)} {r.tenantName}
                      </span>
                      <span className="block text-[0.65625rem] text-[var(--warm-muted)] break-keep">
                        발행 {fmtMD(r.issuedYmd)}{r.issuedYmd !== r.payYmd ? ` · 입금 ${fmtMD(r.payYmd)}` : ''}{r.payMethod ? ` · ${r.payMethod}` : ''}
                      </span>
                    </span>
                    <span className="text-sm font-semibold num text-[var(--warm-dark)] shrink-0">{fmtWon(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selectMode && picked.size > 0 && (
        <SelectionPillBar count={picked.size} unit="건" onClose={exitSelect}>
          <PillButton primary onClick={() => setModalOpen(true)}>일괄 발행 기록</PillButton>
        </SelectionPillBar>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!pending) setModalOpen(false) }}
        title="일괄 발행 기록"
        subtitle={`${targetMonth.replace('-', '년 ')}월 · ${chosen.length}건`}
        width="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" onClick={() => setModalOpen(false)} disabled={pending}>취소</Btn>
            <Btn variant="primary" onClick={run} disabled={pending || chosen.length === 0}>
              {pending ? '기록 중…' : '발행 기록'}
            </Btn>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-md bg-[var(--sand)]/40 px-3 py-2.5 flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--warm-mid)]">발행 금액 합계</span>
            <span className="text-base font-bold num text-[var(--warm-dark)]">{fmtWon(chosenSum)}</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">발행일</label>
            <DatePicker value={issuedDate} onChange={setIssuedDate} maxDate={kstYmdStr()}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]/30" />
          </div>
          {chosen.some(c => c.deposit > 0) && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              {depositCashReceiptWarning(chosen.reduce((a, c) => a + c.deposit, 0))}
            </p>
          )}
          <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
            선택한 입금의 전액을 위 발행일로 기록합니다. 실제 발행은 홈택스나 결제 서비스에서 하고, 여기는 그 사실을 적는 자리입니다. 전액과 다르게 발행한 건은 그 입금의 수납 내역에서 금액을 고칠 수 있습니다. 처리 후 토스트의 적용취소로 되돌릴 수 있습니다.
          </p>
        </div>
      </Modal>
    </div>
  )
}
