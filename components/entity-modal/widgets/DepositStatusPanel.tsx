'use client'

// 보증금 계약 단위 패널 — 수납 정보(엔티티 모달)와 입주자 정보 두 화면의 정본.
//
// 왜 계약 단위인가. 보증금은 입주할 때 한 번 받고 끝이라 월별 수납이 아니라 계약 단위 사실이다.
// 퇴실 정산 때 "돌려줘야 하나 / 얼마 돌려주나 / 청소비 얼마인가"를 판단할 수 있어야 한다(운영자 요건 2026-08-02).
// 종전에는 조회월이 결제일의 달과 다르면 보증금이 화면에서 통째로 사라졌다.
//
// 두 화면이 이 파일 하나를 쓴다. 지금까지 갈렸던 이유가 각자 손으로 그렸기 때문이라, 그게 재발 방지다.
import { useCallback, useEffect, useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { withSave, pushToast } from '@/lib/saveStatus'
import { getDepositPaymentsByLease, updatePayment, deletePayment, restorePayment, saveDepositPaymentForLease } from '@/app/(app)/rooms/actions'
import { getDepositRefundForLease, undoDepositReturn, getDepositCompositionForLease, recordDepositReturn } from '@/app/(app)/tenants/actions'
import { kstYmdStr } from '@/lib/kstDate'
import { WITHHOLD_REASONS, buildWithholdReason, CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON } from '@/lib/depositWithholdReasons'
import { cleaningFeeDeductible } from '@/lib/depositWithholdReasons'
import { depositComposition, withheldPartsLabel } from '@/lib/depositComposition'

type Rec = Awaited<ReturnType<typeof getDepositPaymentsByLease>>['records'][number]
type Refund = Awaited<ReturnType<typeof getDepositRefundForLease>>
type Comp = Awaited<ReturnType<typeof getDepositCompositionForLease>>

const PAY_METHODS = ['계좌이체', '현금', '신용카드', '결제선생', '기타']
const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

export function DepositStatusPanel({
  leaseTermId, status, depositAmount, cleaningFee, reservationDepositMode, canEdit, reloadSignal, onChanged,
  tenantId, tenantName,
}: {
  leaseTermId: string
  status: string | null
  depositAmount: number
  cleaningFee: number
  reservationDepositMode?: string | null
  // 뷰어(STAFF)에게는 편집 진입을 숨긴다 — 형제 위젯(PaymentRecordList)과 같은 전달 경로.
  // 서버 requireEdit 가 최종 방어라 여기 없어도 저장은 막히지만, 눌러야 거절되는 버튼은 보이면 안 된다.
  canEdit: boolean
  reloadSignal?: number
  onChanged?: () => void
  // 환불 정산 재기록에 필요(recordDepositReturn 파라미터). 없으면 재기록 폼이 안 선다 — 열람 전용 자리 호환.
  tenantId?: string | null
  tenantName?: string | null
}) {
  const [data, setData] = useState<{ records: Rec[]; paidTotal: number; preAcquisition: boolean } | null>(null)
  const [refund, setRefund] = useState<Refund>(null)
  const [comp, setComp] = useState<Comp | null>(null)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editMethod, setEditMethod] = useState('')
  // 환불 정산 재기록 폼 — 퇴실 완료 계약에서 기록이 없을 때(최초 미처리·적용취소 직후)만 선다.
  // 종전에는 기록 입구가 퇴실 처리 과정에만 있어, 지우고 나면 어디서도 다시 못 적었다(황인정 402 실사례).
  const [recOpen, setRecOpen] = useState(false)
  const [recAmount, setRecAmount] = useState(0)
  const [recDate, setRecDate] = useState('')
  const [recReason, setRecReason] = useState('')
  const [recEtc, setRecEtc] = useState('')
  // 보증금 실입금 기록 미니폼 — 미수납·부분수납 상태의 1급 진입로(신고 98fb6fce·00c39371).
  // 사실이 표시되는 자리에 그 사실을 고칠 길이 없어서, 운영자가 '입주자 정보 수정' 폼으로 우회했다.
  const [recvOpen, setRecvOpen] = useState(false)
  const [recvAmount, setRecvAmount] = useState(0)
  const [recvDate, setRecvDate] = useState('')
  const [recvMethod, setRecvMethod] = useState('계좌이체')
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    // 두 값을 한 틱에 커밋한다. 순차로 넣으면 첫 페인트에 공제 전 숫자가 스쳤다가 바뀐다(로딩 점프).
    const [d, c] = await Promise.all([
      getDepositPaymentsByLease(leaseTermId),
      getDepositCompositionForLease(leaseTermId),
    ])
    setData(d)
    setComp(c)
    // 퇴실·취소 계약만 환불 기록을 묻는다(그 외에는 있을 수 없어 왕복이 낭비다)
    if (status === 'CHECKED_OUT' || status === 'CANCELLED') setRefund(await getDepositRefundForLease(leaseTermId))
  }, [leaseTermId, status])

  useEffect(() => { void load() }, [load, reloadSignal])

  if (!data || !comp) return <SkeletonRows rows={2} className="py-1" />
  const cleaningPaid = comp.cleaningPaid

  const paid = data.paidTotal
  // 판정은 정본 함수가 한다. 화면이 보여주는 그 숫자(paid·depositAmount)를 그대로 넣어야
  // 배지와 표시줄이 갈리지 않는다 — 서버가 5만, 화면이 3만이던 사고가 그 갈림에서 났다.
  const view = depositComposition({
    contractDeposit: depositAmount, depositPaid: paid,
    cleaningPaid, cleaningFeeInDeposit: comp.cleaningFeeInDeposit,
  })
  // 예약금을 '이용료 선납'이나 '없음'으로 받는 계약은 보증금 개념이 없다. 단 record 가 있으면 숨기지 않는다 —
  // PaymentRecordList 가 보증금 행의 편집을 이 패널로 넘겼기 때문에, 여기서 숨기면 어디서도 못 고치게 된다.
  //
  // 분해 수납(applyToRent 단기)도 보증금 record 를 만들지 않으므로 이 가드에 그대로 걸려 패널이 서지 않는다.
  // 그 자리는 PaymentBody 의 예약금 구성 줄이 대신한다(받은 총액 + 청소비 몫 / 이용료 충당 몫).
  if (status === 'RESERVED' && (reservationDepositMode === 'prepaid' || reservationDepositMode === 'none') && paid === 0) return null
  // 받은 것도 없고 계약도 없고 환불 기록도 없으면 보여줄 사실이 없다
  if (paid === 0 && depositAmount === 0 && !refund) return null

  const settled = !!refund
  const exited = status === 'CHECKED_OUT' || status === 'CANCELLED'
  // 아직 받을 단계가 아닌 계약 — 투어 대기·투어 완료. 받은 게 없는 게 정상이라 '미수납' 경고는 거짓이다.
  const notYet = status === 'WAITING_TOUR' || status === 'TOUR_DONE'
  // 인수 전 입주자는 이 앱에 영수 기록이 없는 게 정상이다(실측 10건 중 9건). 책임 금액은 계약 보증금(승계분)이다.
  const carriedOver = data.preAcquisition && paid === 0 && depositAmount > 0
  const refundBase = carriedOver ? depositAmount : paid
  // 환불 예상은 표시 전용이며 어떤 저장·집계에도 흘러가지 않는다. 확정은 퇴실 처리 폼이 한다.
  // 다만 판정은 돈이 움직이는 3경로와 같아야 한다 — 입실 때 청소비를 따로 받았으면 공제 0(계약서 §2-4).
  const effectiveFee = cleaningFeeDeductible(cleaningFee, cleaningPaid)
  const expectedRefund = Math.max(0, refundBase - effectiveFee)
  // 청소비가 보증금 안의 몫인 영업장(설정 cleaningFeeInDeposit): 입실 때 받은 청소비가 계약 보증금의
  // 일부를 채운다. 현금만 세면 그 몫이 '부족'으로 보인다(520호 — 현금 3만 정정이 부족 2만으로 표시,
  // 청소비 2만이 화면 어디에도 연결되지 않았다). 별도 수령 영업장도 있으므로 조용히 흡수하지 않는다 —
  // 배지는 채워진 만큼만 완납으로 판정하되 아래 표시줄이 현금·청소비 구성을 병기한다.
  // 판정식은 lib/depositComposition 정본. 여기서 다시 min/max 를 쓰면 스무 곳이 또 갈린다.
  const coveredByCleaning = view.coveredByCleaning
  const effectiveShortfall = view.shortfall
  // 계약 보증금이 비어 있으면 환불 여부 판정 자체가 불가능하다. 환불 경고보다 이게 먼저다.
  const noContractAmount = depositAmount === 0 && paid > 0 && !settled
  // 퇴실했는데 환불 기록이 없는 상태 — 운영자 요건 "돌려줘야 하는지"의 정답 자리라 초록으로 덮으면 안 된다
  const unsettledExit = exited && !settled && !noContractAmount && refundBase > 0

  // 순서가 곧 우선순위다. 위에서 걸리면 아래는 안 본다.
  //   판정 불가(계약액 미입력)  >  받을 단계 아님  >  환불 미처리  >  인수 승계  >  수납 상태
  // 종전에는 '환불 미처리'가 '계약액 미입력'과 '인수 승계'를 덮어, 한 패널이 세 가지 말을 동시에 했다.
  const badge: { tone: 'pale-green' | 'pale-amber' | 'pale-blue' | 'pale-neutral'; label: string } =
    settled && refund ? (
      refund.returned > 0 && refund.withheld > 0 ? { tone: 'pale-green' as const, label: '일부 환불' }
      : refund.returned === 0 && refund.withheld > 0 ? { tone: 'pale-green' as const, label: '환불 안 함' }
      : refund.returned === 0 && refund.withheld === 0 ? { tone: 'pale-neutral' as const, label: '정산 없음' }
      : { tone: 'pale-green' as const, label: '환불 완료' }
    )
    : noContractAmount ? { tone: 'pale-neutral', label: '계약액 미입력' }
    : paid === 0 && notYet ? { tone: 'pale-neutral', label: '수납 전' }
    : paid === 0 && status === 'CANCELLED' ? { tone: 'pale-neutral', label: '수납 없음' }
    : unsettledExit ? { tone: 'pale-amber', label: carriedOver ? '인수 승계 · 환불 미처리' : '환불 미처리' }
    : carriedOver ? { tone: 'pale-blue', label: '인수 승계' }
    : effectiveShortfall <= 0 ? { tone: 'pale-green', label: '수납 완료' }
    : paid === 0 && coveredByCleaning === 0 ? { tone: 'pale-amber', label: '미수납' }
    : { tone: 'pale-amber', label: `부족 ${fmtWon(effectiveShortfall)}` }

  // 수납 진입로 노출 술어. preAcquisition 을 통째로 뺀다 — carriedOver 가 아니다.
  // carriedOver 는 '받은 게 0 인 승계'만 참이라, 일부를 받은 승계 계약(실측 3건)에서 거짓이 되고
  // 그 계약에 record 를 만들면 퇴실 정산 기준액이 계약 보증금에서 실수납액으로 조용히 바뀐다
  // (getDepositBasisForLease — received > 0 이면 basis 가 넘어간다). 정본은 "승계 보증금에
  // 수납 record 를 만들지 않는다"(knowledge/money-display-feedback)다.
  // RESERVED 는 예약금 폼(saveReservationDeposit)이 모드까지 확정하는 정본이라 여기서 열지 않는다.
  const canRecordReceipt = canEdit && !settled && !exited && !notYet
    && !data.preAcquisition && status !== 'RESERVED' && effectiveShortfall > 0
  // 잔여를 넘는 입력은 막는다. 넘기면 초과분이 이용료 record 가 되는데, 이 폼은 조회월을 모르고
  // 어댑터가 입주월을 넘기므로 운영자가 보고 있지도 않은 달에 이용료가 앉는다. 이용료가 섞인 입금은
  // 수납 등록의 분해 블록이 맡는다.
  const recvOver = recvAmount > effectiveShortfall

  const openReceive = () => {
    // 프리필은 계약액 전액이 아니라 잔여다 — 전액 프리필이 이중 입력의 공범이었다(신고 50a2a69b).
    setRecvAmount(effectiveShortfall)
    setRecvDate(kstYmdStr())
    setRecvMethod('계좌이체')
    setRecvOpen(true)
  }
  const saveReceive = () => {
    startTransition(async () => {
      const res = await withSave(
        () => saveDepositPaymentForLease({
          leaseTermId, amount: recvAmount, payDate: recvDate || kstYmdStr(), payMethod: recvMethod,
        }),
        { success: '' },   // 금액·수납일을 실은 토스트를 아래에서 직접 띄운다
      )
      if (!res.ok) return
      const ids = res.createdIds
      let undone = false   // 연타 방지 — 두 번째 요청은 이미 지워진 걸 못 찾아 실패로 떨어진다
      // 금액·수납일 명시(정본 money-display-feedback §2-a). 조회월 안내는 붙이지 않는다 —
      // 보증금은 월 필터를 타지 않고 이 패널이 바로 위에서 그렇게 말하고 있다.
      pushToast('success', `보증금 ${fmtWon(recvAmount)} 수납됨 · 수납일 ${Number(recvDate.slice(5, 7))}/${Number(recvDate.slice(8, 10))}`, {
        action: {
          label: '적용취소',
          run: () => {
            if (undone) return
            undone = true
            void Promise.all(ids.map(id => deletePayment(id)))
              .then(() => { pushToast('info', '수납 기록을 취소했습니다'); void load(); onChanged?.() })
              .catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다'))
          },
        },
      })
      setRecvOpen(false)
      await load(); onChanged?.()
    })
  }

  const startEdit = (r: Rec) => {
    setEditId(r.id); setEditAmount(r.actualAmount); setEditDate(ymd(r.payDate)); setEditMethod(r.payMethod ?? '')
  }
  const saveEdit = () => {
    if (!editId) return
    startTransition(async () => {
      const res = await withSave(
        () => updatePayment(editId, { actualAmount: editAmount, payDate: editDate, payMethod: editMethod }),
        { success: '보증금 수납 수정됨' },
      )
      if (!res.ok) return   // withSave 가 이미 error 토스트를 쏜다(이중 통지 금지)
      setEditId(null); await load(); onChanged?.()
    })
  }
  const remove = async (r: Rec) => {
    if (!(await confirmDialog({
      title: `보증금 수납 ${r.actualAmount.toLocaleString()}원을 삭제할까요?`,
      message: '보증금 잔액이 그만큼 줄어듭니다. 환불 정산에도 그대로 반영됩니다.\n삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.',
      level: 'caution', confirmLabel: '삭제',
    }))) return
    startTransition(async () => {
      const res = await withSave(() => deletePayment(r.id), { success: '' })
      if (!res.ok) return
      pushToast('success', '보증금 수납 삭제됨', {
        action: { label: '적용취소', run: () => { void restorePayment(r.id).then(x => { if (x.ok) { void load(); onChanged?.() } else pushToast('error', x.error) }) } },
      })
      await load(); onChanged?.()
    })
  }

  const undoRefund = async (r: NonNullable<Refund>) => {
    const mon = `${Number(r.date.slice(0, 4))}년 ${Number(r.date.slice(5, 7))}월`
    if (!(await confirmDialog({
      title: '환불 기록을 적용취소할까요?',
      // 미반환분은 성격대로 최대 2행(청소비 몫 / 몰취)이라 무엇이 사라지는지 카테고리까지 말한다(§14).
      message: r.withheld > 0
        ? `미환불 ${fmtWon(r.withheld)}으로 잡힌 부가수익(${withheldPartsLabel(r.parts, fmtWon) ?? '보증금 몰취'})도 함께 사라집니다.\n${mon} 매출이 그만큼 줄어듭니다. 퇴실 상태는 그대로 유지됩니다.`
        : '환불 기록만 지웁니다. 퇴실 상태는 그대로 유지됩니다.',
      level: 'caution', confirmLabel: '적용취소',
    }))) return
    startTransition(async () => {
      const res = await withSave(() => undoDepositReturn(r.refundId, r.extraIncomeIds), { success: '환불 기록을 지웠습니다' })
      if (!res.ok) return
      setRefund(null); await load(); onChanged?.()
    })
  }

  const openRecord = () => {
    // 기본값은 화면이 이미 보여주는 환불 예상 그대로 — 다른 숫자로 시작하면 표시와 폼이 갈린다.
    setRecAmount(expectedRefund)
    setRecDate(kstYmdStr())
    setRecReason(carriedOver ? CARRIED_OVER_WITHHOLD_REASON : effectiveFee > 0 ? CLEANING_WITHHOLD_REASON : '')
    setRecEtc('')
    setRecOpen(true)
  }
  const saveRecord = async () => {
    if (!tenantId || !tenantName) return
    const withheldNow = Math.max(0, refundBase - recAmount)
    const reason = buildWithholdReason(recReason, recEtc)
    if (withheldNow > 0 && !reason) { pushToast('error', '미환불 사유를 선택해 주세요.'); return }
    // 전액 미환불 결정만 되묻는다 — 퇴실 처리 폼과 같은 방향(몰취에만 마찰).
    if (recAmount === 0 && refundBase > 0) {
      if (!(await confirmDialog({
        title: '보증금을 전액 돌려주지 않은 것으로 기록할까요?',
        message: `${fmtWon(refundBase)}이 미환불로 기록됩니다.\n사유: ${reason}.`,
        level: 'caution', confirmLabel: '전액 미환불로 기록',
      }))) return
    }
    startTransition(async () => {
      const res = await withSave(
        () => recordDepositReturn({
          leaseTermId, tenantId, depositAmount: refundBase,
          returnedAmount: recAmount, date: recDate || kstYmdStr(), tenantName,
          ...(withheldNow > 0 && reason ? { reason } : {}),
        }),
        { success: '환불 정산을 기록했습니다' },
      )
      if (!res.ok) return
      setRecOpen(false)
      setRefund(await getDepositRefundForLease(leaseTermId))
      await load(); onChanged?.()
    })
  }

  // 밀집 위젯 입력 정본 — 이 패널의 세 폼(수납 기록·환불 정산 기록·수납 수정)이 함께 쓴다.
  // 종전 py-1.5 는 실측 34px 로 §12 높이(40 / 모바일 44)에도, §09 터치 타깃 44px 에도 못 미쳤다.
  // 밀집 예외로 볼 근거가 없다 — §12 가 명문화한 유일한 높이 예외는 인라인 검색 36px 이고,
  // 같은 파일의 형제(DepositSection 행 액션)는 이미 같은 이유로 RowActionBtn 정본으로 갈아탔다.
  // min-h 만으로 44/40 을 만드는 문법은 inventory/assets 의 DATE_FIELD_CLS 가 쓰는 검증된 자다
  // (inline-flex 를 얹으면 DatePicker 트리거의 truncate 가 죽는다).
  // 포커스는 focus 가 아니라 focus-visible 이다 — 트리거가 button 이라 손가락으로 열고 닫은 뒤에도
  // 링이 남는다. 보더 색과 링을 둘 다 거는 이유는 링(rgba 코랄 12%)이 다크 배경에서 안 보이기 때문이다.
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors'
  // 폼 라벨 정본(§12 — 12px / 500 / --ink-s). 종전 10.5px --warm-muted 는 크기·굵기·색 셋 다 어긋났다.
  const labelCls = 'text-xs font-medium text-[var(--warm-mid)]'
  // 2열 그리드 — 320px 에서는 세로로 편다. 그 폭에서 날짜 칸 글자 영역이 97px 라
  // '2026년 8월 30일'(약 104px)이 truncate 에 걸려 '2026년 8월 3…'로 읽힌다(수납일 오독).
  const gridCls = 'grid grid-cols-1 min-[360px]:grid-cols-2 gap-1.5'
  // 인라인 폼 껍데기 — 표면을 한 단 올린다. 종전 --canvas 는 안의 입력과 같은 토큰이라
  // 다크에서 페이지·컨테이너·입력이 셋 다 #000 이고 보더 대비가 1.11:1 이었다(폼이 안 보인다).
  // --cream-soft 는 토큰 쌍이 갖춰져 있어(라이트 #f5ede0 · 다크 #261C14) 양 모드에서 산다.
  // 부수 효과로 라벨(--warm-mid) 대비가 4.12:1 에서 4.74:1 로 올라 §28 본문 기준을 넘긴다.
  const formBoxCls = 'space-y-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream-soft)] px-2.5 py-2'

  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-xs font-semibold text-[var(--deposit-fg)]">보증금</p>
        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
        {/* 예약 단계라는 맥락은 라벨을 바꾸지 말고 메타 칩으로. 받은 돈은 그대로 보증금이지 '대체'가 아니다. */}
        {status === 'RESERVED' && (
          <span className="text-[0.65625rem] rounded-full px-1.5 py-0.5 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">예약금으로 수납</span>
        )}
      </div>

      <p className="text-sm text-[var(--warm-dark)]">
        <span className="text-[var(--warm-muted)] text-xs">받은 보증금 </span>
        <span className="font-semibold num">{fmtWon(paid)}</span>
        {/* 청소비가 보증금 몫을 채운 계약은 구성을 병기한다 — 현금만 보이면 '어디에도 기록이 없다'로 읽힌다. */}
        {coveredByCleaning > 0 && <span className="text-xs text-[var(--warm-mid)]"> + 청소비 {fmtWon(coveredByCleaning)}</span>}
        {depositAmount > 0 && <span className="text-[var(--warm-muted)] text-xs"> / 계약 {fmtWon(depositAmount)}</span>}
      </p>

      {/* 이 블록만 스코프가 다르다. 못박지 않으면 이번 달 수납으로 읽힌다.
          문구는 rent-receipts 의 정본과 같은 한 문장 — 두 문장은 반폭에서 접힌다(디자이너 패스). */}
      <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">보증금은 월과 무관합니다.</p>

      {/* 미수납·부분수납의 1급 진입로. 라벨은 수납관리 보증금 탭의 행 액션과 같은 말이다 —
          같은 행동을 두 화면이 다르게 부르면 그 순간 갈린다. '수납 기록'은 이 앱에서 이미 명사라
          ('수납 기록 삭제됨'·'최근 3개월 수납 기록이 없습니다') 버튼에 쓰면 목록으로 읽힌다. */}
      {canRecordReceipt && !recvOpen && (
        <Btn variant="subtle" size="sm" disabled={pending} onClick={openReceive}>받음으로 기록</Btn>
      )}
      {recvOpen && (
        <div className={formBoxCls}>
          <div className={gridCls}>
            <div className="space-y-1.5">
              <label className={labelCls}>금액</label>
              <input type="text" inputMode="numeric" value={recvAmount.toLocaleString()}
                onChange={e => setRecvAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                className={`${inputCls} ${recvOver ? 'border-[var(--tc)]' : ''}`} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>납부일</label>
              {/* DatePicker 트리거는 껍데기가 없다 — 정본 inputCls 를 그대로 넘긴다(text-xs 만 넘기면 맨글자). */}
              <DatePicker value={recvDate} onChange={setRecvDate} className={inputCls} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>납부방법</label>
            <select value={recvMethod} onChange={e => setRecvMethod(e.target.value)} className={inputCls}>
              {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {recvOver ? (
            <p className="text-[0.6875rem] text-[var(--danger-fg)] break-keep">
              보증금 잔여 {fmtWon(effectiveShortfall)}보다 {fmtWon(recvAmount - effectiveShortfall)} 많습니다. 이용료도 함께 받았다면 수납 등록에서 나눠 적으세요.
            </p>
          ) : (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              보증금만 기록합니다. 이용료를 함께 받았다면 수납 등록에서 한 번에 나눠 적으세요.
            </p>
          )}
          {/* 퇴실 예정 계약은 이 금액이 곧 환불 기준액이 된다(getDepositBasisForLease). 조용히 바뀌면 안 된다. */}
          {status === 'CHECKOUT_PENDING' && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              이 금액이 곧 환불 정산 기준액이 됩니다.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" disabled={pending} onClick={() => setRecvOpen(false)}>취소</Btn>
            <Btn variant="primary" size="sm" disabled={pending || recvAmount <= 0 || recvOver} onClick={() => { void saveReceive() }}>기록</Btn>
          </div>
        </div>
      )}

      {carriedOver && !settled && (
        <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
          인수 전 입주라 이 앱에 영수 기록이 없습니다. 계약 보증금은 인수 시 승계된 금액입니다.
        </p>
      )}

      {noContractAmount && (
        <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
          {exited
            ? '계약 보증금을 입력해야 환불 여부를 판정할 수 있습니다. 입주자 정보 수정에서 입력해 주세요.'
            : '계약 보증금이 입력되지 않아 완납 여부를 판정하지 못합니다. 입주자 정보 수정에서 입력해 주세요.'}
        </p>
      )}

      {settled && refund && (
        <p className="text-xs text-[var(--warm-dark)] break-keep">
          환불 <span className="font-semibold num">{fmtWon(refund.returned)}</span>
          {refund.withheld > 0 && <span className="text-[var(--warm-muted)]"> · 미환불 {fmtWon(refund.withheld)}{refund.reason ? ` (${refund.reason})` : ''}</span>}
          <span className="text-[0.65625rem] text-[var(--warm-muted)]"> · {refund.date.replaceAll('-', '.')} 처리</span>
        </p>
      )}
      {/* §16 상시 적용취소 진입점 — 토스트는 사라지고, 이 패널이 정본이 되었으니 여기가 '원위치'다. */}
      {canEdit && settled && refund && (
        <Btn variant="subtle" size="sm" disabled={pending} onClick={() => { void undoRefund(refund) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          적용취소
        </Btn>
      )}
      {unsettledExit && (
        <p className="text-xs text-[var(--warning-fg)] break-keep">퇴실했으나 환불 처리가 기록되지 않았습니다.</p>
      )}
      {/* 재기록 입구 — 퇴실 완료 + 기록 없음(적용취소 직후 포함). 취소 계약은 예약 취소 경로가 정본이라 제외. */}
      {canEdit && unsettledExit && status === 'CHECKED_OUT' && tenantId && tenantName && !recOpen && (
        <Btn variant="subtle" size="sm" disabled={pending} onClick={openRecord}>환불 정산 기록</Btn>
      )}
      {recOpen && (
        <div className={formBoxCls}>
          <div className={gridCls}>
            <div className="space-y-1.5">
              <label className={labelCls}>반환액</label>
              <input type="text" inputMode="numeric" value={recAmount.toLocaleString()}
                onChange={e => setRecAmount(Number(e.target.value.replace(/[^0-9]/g, '')))} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>처리일</label>
              <DatePicker name="refundRecordDate" value={recDate} onChange={setRecDate} className={inputCls} />
            </div>
          </div>
          {Math.max(0, refundBase - recAmount) > 0 && (
            <div className="space-y-1.5">
              <p className={labelCls}>미환불 {fmtWon(Math.max(0, refundBase - recAmount))} · 사유</p>
              <select value={recReason} onChange={e => setRecReason(e.target.value)} className={inputCls}>
                <option value="">사유 선택</option>
                {WITHHOLD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {recReason === '기타' && (
                <input value={recEtc} onChange={e => setRecEtc(e.target.value)} placeholder="사유 입력" className={inputCls} />
              )}
            </div>
          )}
          {/* 취소 좌 · 확인 우(§13·§14). 종전 이 폼만 반대라 한 패널 안에 서로 반대인 두 폼이 서 있었다. */}
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" disabled={pending} onClick={() => setRecOpen(false)}>취소</Btn>
            <Btn variant="primary" size="sm" disabled={pending} onClick={() => { void saveRecord() }}>기록</Btn>
          </div>
        </div>
      )}

      {/* 퇴실 시 환불 예상 — 굵기를 올리지 않는다. 확정액이 아니라 예상이고, 실제 환불은 이용료 정산까지 얽힌다.
          근거는 항상 병기한다. 청소비가 0이면 괄호가 사라져 "받은 0원인데 30만원 환불"로 읽히던 구멍이 있었다. */}
      {!settled && refundBase > 0 && (
        <p className="text-xs text-[var(--warm-dark)] break-keep">
          {exited ? '환불 예정액 ' : '퇴실 시 환불 예상 '}<span className="num">{fmtWon(expectedRefund)}</span>
          {/* 근거는 값이 달라질 때만 병기한다. 무조건 붙이면 바로 위 '받은 보증금'과 같은 숫자를 두 번 말한다. */}
          {(carriedOver || effectiveFee > 0) && (
            <span className="text-[0.65625rem] text-[var(--warm-muted)]">
              {' ('}{carriedOver ? '계약 보증금' : '받은 보증금'} {fmtWon(refundBase)}
              {effectiveFee > 0 && <> − 청소비 {fmtWon(effectiveFee)}</>}
              {carriedOver && ' 기준, 인수 승계'}{')'}
            </span>
          )}
          {status === 'CHECKOUT_PENDING' && <span className="block text-[0.65625rem] text-[var(--warm-muted)]">퇴실 처리에서 최종 확정합니다.</span>}
        </p>
      )}
      {/* 왜 청소비를 안 뺐는지 — 계약에 청소비가 적혀 있는데 예상액에서 사라지면 누락으로 읽힌다.
          기본 문구는 퇴실 처리 폼의 정본과 같은 한 문장. 청소비가 보증금 몫을 채운 계약(coveredByCleaning)만
          구성 설명으로 분기한다 — 같은 문장으로는 '보증금 어디에도 청소비가 없다'는 혼란을 못 푼다(2026-08-10). */}
      {!settled && refundBase > 0 && cleaningFee > 0 && cleaningPaid > 0 && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
          {coveredByCleaning > 0
            ? `입실 때 받은 청소비 ${fmtWon(cleaningPaid)}이 계약 보증금의 일부를 채웁니다. 환불 예상은 현금으로 받은 몫 기준이며 청소비는 다시 공제하지 않습니다.`
            : `청소비 ${fmtWon(cleaningPaid)}은 입실 때 이미 받아 공제하지 않습니다.`}
        </p>
      )}

      {data.records.length > 0 && (
        <div className="pt-0.5">
          <button type="button" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 text-[0.65625rem] font-medium text-[var(--deposit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)] rounded-sm">
            받은 내역 {data.records.length}건
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1.5">
              {data.records.map(r => editId === r.id ? (
                <li key={r.id} className="rounded-lg bg-[var(--canvas)] border border-[var(--coral)] px-2.5 py-2 space-y-2">
                  <div className={gridCls}>
                    <div className="space-y-1.5">
                      <p className={labelCls}>금액</p>
                      <input type="text" inputMode="numeric" value={editAmount.toLocaleString()}
                        onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))} className={inputCls} />
                    </div>
                    <div className="space-y-1.5">
                      <p className={labelCls}>납부일</p>
                      {/* DatePicker 트리거는 껍데기가 없다 — 배경·보더·패딩·글자색이 전부 호출부 책임이라
                          정본 inputCls 를 그대로 넘긴다. text-xs 만 넘기면 맨글자로 렌더된다. */}
                      <DatePicker value={editDate} onChange={setEditDate} className={inputCls} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {/* 자유 입력 금지 — '카드' 등 변형 표기가 카드 수납 합계에서 누락된다(형제와 동일 select) */}
                    <p className={labelCls}>납부방법</p>
                    <select value={editMethod} onChange={e => setEditMethod(e.target.value)} className={inputCls}>
                      {editMethod && !PAY_METHODS.includes(editMethod) && <option value={editMethod}>{editMethod}</option>}
                      {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Btn variant="secondary" size="sm" onClick={() => setEditId(null)}>취소</Btn>
                    <Btn variant="primary" size="sm" onClick={saveEdit} disabled={pending}>저장</Btn>
                  </div>
                </li>
              ) : (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--deposit-bg)] border border-[var(--deposit-ring)] px-2.5 py-1.5">
                  <p className="text-[0.65625rem] text-[var(--warm-mid)] min-w-0">
                    <span className="num">{fmtDateDot(r.payDate)}</span>
                    {r.payMethod && <span className="text-[var(--warm-muted)]"> · {r.payMethod}</span>}
                    {r.cashReceiptIssuedAt && <span className="ml-1 font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1 py-0.5 whitespace-nowrap">현금영수증</span>}
                  </p>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-semibold num text-[var(--warm-dark)]">{fmtWon(r.actualAmount)}</span>
                    {canEdit && <RowActionBtn tone="deposit" onClick={() => startEdit(r)}>수정</RowActionBtn>}
                    {canEdit && <RowActionBtn tone="danger" onClick={() => { void remove(r) }} disabled={pending}>삭제</RowActionBtn>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
