'use client'

// 단기 계약 연장 모달 — 세그먼트로 +1주/+2주/직접 날짜를 골라 서버 재견적(previewShortStayExtension)을 받고,
// 확정(extendShortStay) 시 완료 뷰로 전환한다. 금액은 전부 서버 재산출값 — 클라는 표시용 파생만.

import { useEffect, useRef, useState } from 'react'
import { previewShortStayExtension, extendShortStay, undoShortStayExtension } from '@/app/(app)/tenants/actions'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fmtWon } from '@/lib/fmtMoney'
import { pushToast } from '@/lib/saveStatus'
import { useEntityModal } from '@/components/entity-modal/EntityModal'

type Preview = Awaited<ReturnType<typeof previewShortStayExtension>>
type Seg = 'w1' | 'w2' | 'custom'

// 'YYYY-MM-DD' 에 일수를 더한 새 'YYYY-MM-DD'(UTC 기준 — @db.Date 저장 관행과 동일).
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// 'YYYY-MM-DD' → 'M/D'(TZ 영향 없이 문자열 파싱).
function fmtMD(ymd: string | null): string {
  if (!ymd) return '미정'
  const [, m, d] = ymd.split('-')
  return `${Number(m)}/${Number(d)}`
}

export function ShortStayExtensionModal({
  open, onClose, leaseTermId, tenantId, tenantName, currentOut, onDone,
}: {
  open: boolean
  onClose: () => void
  leaseTermId: string
  tenantId: string
  tenantName: string
  currentOut: string | null
  onDone?: () => void
}) {
  const entityModal = useEntityModal()
  // 호출부가 조건부 마운트하므로 초기값이 곧 열림 시점 상태 — 현재 퇴실일이 있으면 +1주가 기본.
  const [seg, setSeg] = useState<Seg>(currentOut ? 'w1' : 'custom')
  const [customOut, setCustomOut] = useState('')
  const [interacted, setInteracted] = useState(false)
  // 재견적 결과는 요청한 날짜와 함께 보관 — 로딩은 "현재 날짜의 결과가 아직 없음"으로 파생(경합도 자연 해소).
  const [preview, setPreview] = useState<{ forOut: string; res: Preview } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState('')
  const [done, setDone] = useState<{ diff: number } | null>(null)

  // 파생 새 퇴실일 — 세그먼트 선택에서 유도(표시·재견적 요청용).
  const newOut =
    seg === 'w1' && currentOut ? addDays(currentOut, 7)
    : seg === 'w2' && currentOut ? addDays(currentOut, 14)
    : seg === 'custom' ? customOut
    : ''

  // 새 퇴실일이 바뀔 때마다 서버 재견적(선택 이벤트 단위) — 상태 갱신은 비동기 콜백에서만.
  const reqRef = useRef(0)
  useEffect(() => {
    if (!open || done || !newOut) return
    const token = ++reqRef.current
    previewShortStayExtension(leaseTermId, newOut)
      .then(r => { if (token === reqRef.current) setPreview({ forOut: newOut, res: r }) })
      .catch(() => { if (token === reqRef.current) setPreview({ forOut: newOut, res: { ok: false, error: '재견적 중 통신 오류가 발생했습니다.' } }) })
  }, [open, done, newOut, leaseTermId])

  const current = preview && preview.forOut === newOut ? preview.res : null
  const loading = !!newOut && !current
  const ok = current && current.ok ? current : null
  const errText = current && !current.ok ? current.error : ''
  const overThreshold = !!(current && !current.ok && current.overThreshold)
  const canConfirm = !!ok && !loading && !submitting

  const handleConfirm = () => {
    if (!ok || submitting) return
    setSubmitErr('')
    setSubmitting(true)
    void extendShortStay(leaseTermId, ok.newOut, currentOut).then(r => {
      setSubmitting(false)
      if (!r.ok) { setSubmitErr(r.error); return }
      setDone({ diff: r.diff })
      onDone?.()
      pushToast('success', `단기 연장 완료 · 추가 ${fmtWon(r.diff)}`, {
        action: {
          label: '적용취소',
          run: () => {
            void undoShortStayExtension(leaseTermId).then(u => {
              if (u.ok) { pushToast('info', '연장이 취소되었습니다.'); onDone?.() }
              else pushToast('error', u.error)
            }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다.'))
          },
        },
      })
    }).catch(() => { setSubmitting(false); setSubmitErr('연장 처리 중 통신 오류가 발생했습니다.') })
  }

  // 수납 면으로 전환 — 프리즘 셸을 payment kind 로 인플레이스 교체(정산 딥링크와 동일 선례).
  const goPayment = () => {
    onClose()
    entityModal.open({ kind: 'payment', leaseTermId, tenantId })
  }

  return (
    <Modal open={open} z={260} width="md" dirty={!done && interacted}
      onClose={onClose}
      title={`${tenantName}님 · 단기 연장`}
      footer={
        done ? (
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" onClick={onClose} className="flex-1">닫기</Btn>
            <Btn variant="primary" size="md" onClick={goPayment} className="flex-1">지금 수납</Btn>
          </div>
        ) : (
          <Btn variant="primary" size="md" fullWidth disabled={!canConfirm} onClick={handleConfirm} className="font-semibold">
            {ok ? `연장 확정 · 추가 ${fmtWon(ok.diff)}` : '연장 확정'}
          </Btn>
        )
      }>
      <div className="px-5 py-4 space-y-4">
        {done ? (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-[var(--warm-dark)]">연장 완료.</p>
            <p className="text-sm text-[var(--warm-dark)]">추가 납부 <span className="font-bold text-[var(--coral)]">{fmtWon(done.diff)}</span></p>
          </div>
        ) : (
          <>
            {/* a. 현재 계약 요약 */}
            {ok && (
              <div className="space-y-1">
                <p className="text-sm text-[var(--warm-dark)]">
                  {ok.roomNo ? `${ok.roomNo}호` : '호실 미지정'}
                  <span className="text-[var(--warm-muted)]"> · </span>
                  {fmtMD(ok.moveInDate)} ~ {fmtMD(ok.currentOut)}
                </p>
                <p className="text-xs">
                  <span className="text-[var(--warm-muted)]">기납부 사용료</span> <span className="text-[var(--warm-dark)]">{fmtWon(ok.currentRent)}</span>
                  <span className="text-[var(--warm-muted)]"> · 청소비 </span><span className="text-[var(--warm-dark)]">{fmtWon(ok.cleaningFee)}</span>
                </p>
              </div>
            )}

            {/* b. 연장 선택 */}
            <div className="space-y-2">
              <SegmentedControl<Seg>
                options={[
                  { value: 'w1', label: '+1주' },
                  { value: 'w2', label: '+2주' },
                  { value: 'custom', label: '직접 선택' },
                ]}
                value={seg}
                onChange={v => { setSeg(v); setInteracted(true) }}
                ariaLabel="연장 기간 선택"
              />
              {seg === 'custom' && (
                <DatePicker value={customOut} onChange={v => { setCustomOut(v); setInteracted(true) }}
                  minDate={currentOut ?? undefined}
                  placeholder="새 퇴실일"
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] w-full" />
              )}
              {/* 이 창은 연장 전용(minDate=현재 퇴실일) — 앞당기기 경로를 명시해 라벨과 동작의 불일치를 메운다. */}
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">앞당기기는 정보 수정의 퇴실일에서 바꿔주세요.</p>
            </div>

            {/* c/d. 재계산 블록 또는 경고 */}
            {overThreshold ? (
              <p className="text-xs text-[var(--warning-fg)] leading-relaxed">{errText}</p>
            ) : errText ? (
              <p className="text-xs text-[var(--danger-fg)] leading-relaxed">{errText}</p>
            ) : ok ? (
              <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--warm-mid)]">{ok.units}주 사용료</span>
                  <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(ok.newRent)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--warm-mid)]">기납부 사용료</span>
                  <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(-ok.currentRent)}</span>
                </div>
                <div className="border-t border-[var(--warm-border)] pt-2 flex items-baseline justify-between">
                  <span className="text-xs text-[var(--warm-mid)]">추가 납부</span>
                  <span className="text-lg font-bold tnum text-[var(--coral)]">{fmtWon(ok.diff)}</span>
                </div>
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">청소비는 입실 시 1회 청구라 추가되지 않습니다.</p>
                {ok.roundedUp && <p className="text-[0.65625rem] text-[var(--warm-muted)]">{ok.stayDays}일 → {ok.units}주 계약으로 올림.</p>}
                {ok.cappedAtMonth && <p className="text-[0.65625rem] text-[var(--warm-muted)]">(1개월 요금 상한)</p>}
              </div>
            ) : (
              <p className="text-xs text-[var(--warm-muted)]">
                {loading ? '재견적 중…' : seg === 'custom' && !customOut ? '새 퇴실일을 선택해 주세요.' : ''}
              </p>
            )}

            {submitErr && <p className="text-xs text-[var(--danger-fg)] leading-relaxed">{submitErr}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
