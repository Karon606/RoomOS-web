'use client'

// 수납 내역 — 표시 + 편집 + 삭제. 자체 fetch (getPaymentsByLease).
// scope='window' 면 최근 3개월(입금일·귀속월 합집합)을 그리고, 편집은 조회월 귀속 행에만 붙인다.
// 편집 가능 항목: 금액·납부일·납부방법·메모·귀속월. 보증금 record 는 귀속월 변경 불가.
// 양도인 record 는 양도인 색 표시.

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { CARD_LIKE_METHODS, MANUAL_PAY_METHODS } from '@/lib/paymentMethods'
import { fmtDateDot as fmtDate, fmtMD } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton'
import {
  getPaymentsByLease, getTargetMonthOptions, updatePayment, undoPaymentEdit, deletePayment, restorePayment, setCashReceiptIssued,
  undoCashReceiptChange, previewCashReceiptOn, previewPaymentDelete, previewPaymentEditCr,
} from '@/app/(app)/rooms/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { kstYmdStr, kstMonthStr } from '@/lib/kstDate'
import { canEditPaymentHere } from '@/lib/paymentEditScope'
import { CASH_RECEIPT_DEFAULT_INCL } from '@/lib/cashReceipt'
import { CARD_NOT_CASH_RECEIPT_NOTE, CR_ZERO_ROW_CAPTION, isCashReceiptEligible } from '@/lib/cashReceipt'
import {
  cashReceiptRowCaption, crAddPreviewChunks, crReplacePreview, CR_PREVIEW_UNREAD, CR_KEEP_PREVIEW, CR_NONE_PREVIEW, crOnToast, crOffToastDetail, crOffUndoneMessage, crOnUndoneMessage,
  CR_DELETE_UNDONE, crUndoMismatchDetail, crDeleteToastDetail, crRestoreDetail, cashReceiptGapSentence, crEditToastDetail,
  crCoveredRent, CR_EDIT_MOVED_NOTE,
} from '@/lib/cashReceiptCopy'
import { CashReceiptCaption } from './CashReceiptCaption'
import { withSave, trackSave, pushToast, humanError } from '@/lib/saveStatus'
import { confirmDeletePayment, previewWithin } from '@/lib/paymentConfirm'
import { isRentRefundRecord } from '@/lib/rentRefundRecord'
import { isDueDayAdjust } from '@/lib/dueDayAdjust'
import { DueDayAdjustList } from './DueDayAdjustList'
import { PAY_CHIP_CLS, PAY_CHIP_TONE } from './paymentRowChip'

type Record = Awaited<ReturnType<typeof getPaymentsByLease>>['records'][number]

/**
 * 발행일이 입금일과 **다를 때만** 그 날짜를 덧붙인다(2026-08-24 축 재판정).
 *
 * 합계가 발행일의 달로 잡히므로 지연 발행이면 이 행이 어느 달 합계에 들어갔는지 화면에서
 * 읽혀야 한다. 같은 날이면 굳이 안 적는다 — 그 경우가 대부분이고, 매번 적으면 이미 줄 하나에
 * 배지가 넷인 자리에 뜻 없는 숫자가 하나 더 는다.
 * 원터치 토글이 오늘로 켠 값이 실제와 다르면 여기서 눈에 걸리고, 고치는 자리는 이 행의 수정 폼이다.
 */
function crIssuedLabel(p: Record): string {
  if (!p.cashReceiptIssuedAt) return ''
  const issued = kstYmdStr(new Date(p.cashReceiptIssuedAt))
  return issued === kstYmdStr(new Date(p.payDate)) ? '' : ` ${fmtMD(p.cashReceiptIssuedAt)} 발행`
}
type TmOption = Awaited<ReturnType<typeof getTargetMonthOptions>>[number]


export function PaymentRecordList({ leaseTermId, targetMonth, canEdit, onChange, reloadSignal, scope = 'month', cashReceiptOnly = false }: {
  leaseTermId: string
  targetMonth: string
  canEdit: boolean
  /** 'month'=조회월 입금분(기존) · 'window'=최근 3개월(입금일·귀속월 합집합, 신고 2c6de978). */
  scope?: 'month' | 'window'
  /** 수정·삭제는 막되 현금영수증 원터치만 허용 — 요약 화면용(신고 c0936f89 기능 유지). */
  cashReceiptOnly?: boolean
  /** 편집·삭제 후 부모가 settlement 재조회. */
  onChange?: () => void
  /** 부모(PaymentBody)에서 수납 등록 등으로 값이 바뀌면 증가 → 리스트 재fetch 트리거. */
  reloadSignal?: number
}) {
  // KST 이번 달 — 미래 귀속 판정의 기준. new Date() 로 뽑으면 매월 1일 00~09시에 서버·기기가
  // 다른 달을 봐서 같은 줄이 한쪽에선 고쳐지고 한쪽에선 안 고쳐진다(MonthSelector 와 같은 이유).
  const thisMonth = kstMonthStr()
  const editableHere = (recordMonth: string) => canEditPaymentHere(recordMonth, targetMonth, thisMonth)
  const [records, setRecords] = useState<Record[] | null>(null)
  const [acqDate, setAcqDate] = useState<Date | null>(null)
  const [tmOptions, setTmOptions] = useState<TmOption[]>([])
  const [pending, startTransition] = useTransition()
  // 행 캡션 id 의 접두. 체크 input 이 aria-describedby 로 캡션을 가리킨다(같은 record 가 두 목록에 서도 안 겹치게).
  const uid = useId()

  // 편집 모드 state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount]       = useState<number>(0)
  const [editDate, setEditDate]           = useState<string>('')
  const [editPayMethod, setEditPayMethod] = useState<string>('')
  const [editMemo, setEditMemo]           = useState<string>('')
  const [editTargetMonth, setEditTargetMonth] = useState<string>('')
  const [editCashReceipt, setEditCashReceipt] = useState(false)   // 현금영수증 발행 표시(오류신고 2bd8befa)
  // 발행일 — **원터치 토글로 켠 뒤 고치는 자리가 여기다**(운영자 확정 2026-08-24, 신고 8b9b6c43).
  // 토글은 한 번 눌러 켜는 자리라 날짜를 물으면 편의가 죽는다. 그래서 토글은 오늘로 켜고,
  // 실제 발행일이 달랐으면 이 수정 폼에서 고친다 — 새 인터랙션을 만들지 않고 기존 문법을 쓴다.
  const [editCashReceiptDate, setEditCashReceiptDate] = useState<string>('')
  // 발행 금액 — **잘못 적었을 때 고칠 수 있는 유일한 자리다**(운영자 승인 2026-08-25).
  // 여기가 없으면 틀린 국세청 숫자가 앱에 갇힌다. 프리필이 곧 현재값이라 안 건드리면 안 바뀐다.
  const [editCrAmount, setEditCrAmount] = useState(0)
  // 삭제 확인창 앞 미리보기를 읽는 중인 행. 그 행의 삭제 버튼을 막아 반응이 있었음을 보이고 연타를 막는다(검수 R-9).
  const [delPendingId, setDelPendingId] = useState<string | null>(null)
  // 원터치 토글이 켤 때 묻는 발행일(운영자 지시 2026-08-25 — "응 물어봐줘"). 끌 때는 안 묻는다.
  const [crAskId, setCrAskId] = useState<string | null>(null)
  const [crAskDate, setCrAskDate] = useState(kstYmdStr())
  // 켜기 확인 줄이 먼저 보일 '기록될 발행 금액'(서버 미리보기, 실제 켜기와 같은 정본 판정). 어느 행의 것인지 함께
  // 들고 있다. 다른 행을 빨리 이어 누르면 늦게 온 응답이 엉뚱한 행에 서지 않게.
  // 'net' 은 통신 실패다. 서버가 거절한 것(ok:false)과 갈라 말한다(웹디자이너 R2. 통신 실패는 버튼을 살리고 서버 거절은 막는다).
  const [crPreview, setCrPreview] = useState<{ id: string; res: Awaited<ReturnType<typeof previewCashReceiptOn>> | 'net' } | null>(null)
  const [editCrIncl, setEditCrIncl] = useState({ deposit: false, cleaning: false, rent: true })
  // 폼을 열 때의 발행 금액·구성. 운영자가 칸을 고쳤는지 가르는 기준(2026-10-14 독립 검수 F1).
  // 안 고쳤으면 저장에 싣지 않는다. 실으면 서버가 입금일 이동으로 합친 금액을 이 프리필(옛 키 금액)로 덮는다.
  const [editCrPrefill, setEditCrPrefill] = useState({ amount: 0, incl: { deposit: false, cleaning: false, rent: true } })
  // 수정 폼의 발행 금액 미리보기(독립 검수 F-A). 미발행 행을 켜거나 입금일·수단을 옮기면 칸이 '저장하면 기록될 금액'을
  // 보이게 한다. key 는 그 미리보기를 부른 입력이다(입력이 바뀌면 지난 응답을 안 쓴다). 'net' 은 통신 실패다.
  const [editCrPv, setEditCrPv] = useState<{ key: string; res: Awaited<ReturnType<typeof previewPaymentEditCr>> | 'net' } | null>(null)
  const editPvSeq = useRef(0)
  // 응답이 올 때의 프리필. 운영자가 칸을 고치지 않았으면(칸 = 프리필) 칸도 기록될 금액으로 옮기고, 고쳤으면 그 값을 지킨다.
  const editCrPrefillAmt = useRef(0)
  useEffect(() => { editCrPrefillAmt.current = editCrPrefill.amount }, [editCrPrefill.amount])
  // 이 계약의 활성 발행 줄 — (수납일·수단)으로 그 행의 발행을 찾는다.
  const [receipts, setReceipts] = useState<{ payDate: string | Date; payMethod: string | null; amount: number; inclDeposit: boolean; inclCleaning: boolean; inclRent: boolean }[]>([])

  const reload = async () => {
    const { records, windowRecords, acquisitionDate, receipts: rc } = await getPaymentsByLease(leaseTermId, targetMonth)
    setReceipts(rc)
    // 청구 조정 전표(단기 연장·감액 마커)는 편집·삭제 대상이 아니다 — 목록에서 제외(회차 번호도 세지 않음).
    // 조회가 payDate 월 기준이라 전표는 입주월이 아닌 달에도 섞여 들어온다(마커 payDate=조작 시각).
    // window 는 서버가 전표·보증금을 이미 걸러 내려보낸다(보증금 정본은 DepositStatusPanel).
    setRecords(scope === 'window' ? windowRecords : records.filter(r => !r.isBillingAdjust))
    setAcqDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId, targetMonth, reloadSignal, scope])

  const isPreAcq = (p: Record) => !!(acqDate && new Date(p.payDate) < acqDate)

  const startEdit = (p: Record) => {
    setEditingId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
    setEditTargetMonth(p.targetMonth)
    setEditCashReceipt(!!p.cashReceiptIssuedAt)
    // 저장된 발행 시각을 KST 날짜로 되읽는다. 없으면 오늘 — 여기서 처음 켜는 경우다.
    setEditCashReceiptDate(p.cashReceiptIssuedAt ? kstYmdStr(new Date(p.cashReceiptIssuedAt)) : kstYmdStr())
    // 저장된 발행 줄이 있으면 그 금액·구성을 그대로 연다. 없으면 이 record 금액이 기본값이다.
    const line = receipts.find(r =>
      kstYmdStr(new Date(r.payDate)) === kstYmdStr(new Date(p.payDate)) && (r.payMethod ?? '') === (p.payMethod ?? ''))
    setEditCrAmount(line?.amount ?? p.actualAmount)
    // 줄이 없으면 **정본 기본값**이다 — 보증금·청소비는 받을 때 발행 대상이 아니다
    // (운영자 확정 2026-09-21). 종전에는 `deposit: !!p.isDeposit` 로 받은 몫이 있으면 켰다.
    // 오늘 이 목록이 서는 자리 둘은 전부 scope='window' 이고 그 집합이 isDeposit=false 라
    // 보증금 행이 안 온다. 그런데 **기본 prop 은 'month' 이고 그쪽 집합에는 보증금이 든다** —
    // scope 를 안 준 마운트가 하나 생기는 순간 옛 규칙이 되살아난다. 그래서 죽은 가지여도
    // 정본을 쓴다. 이 화면은 금액 칸이 예외 문이라 켤 사람은 여기서 직접 켠다.
    const prefillIncl = line
      ? { deposit: line.inclDeposit, cleaning: line.inclCleaning, rent: line.inclRent }
      : { ...CASH_RECEIPT_DEFAULT_INCL }
    setEditCrIncl(prefillIncl)
    setEditCrPrefill({ amount: line?.amount ?? p.actualAmount, incl: prefillIncl })
    if (!p.isDeposit) {
      getTargetMonthOptions(leaseTermId, targetMonth).then(setTmOptions).catch(() => {})
    }
  }

  // 미리보기가 필요한 수정인가. 미발행 행을 켜거나(키 몫·더하기로 정해진다) 입금일·수단을 옮기면(옮긴 결과로 정해진다)
  // 칸의 프리필(행 금액·옛 줄 금액)이 저장 결과와 갈린다(검수 N2·N3). 같은 키에서 발행일·금액만 고치는 재저장은
  // 프리필이 곧 현재 줄이라 부르지 않는다. 옮겼는지는 서버와 같이 엄격히 본다(null 수단을 '' 로 저장해도 옮긴 것).
  const editRec = editingId ? records?.find(r => r.id === editingId) ?? null : null
  const editMoved = !!editRec && (editDate !== kstYmdStr(new Date(editRec.payDate)) || editPayMethod !== editRec.payMethod)
  const editPvKey = editRec && editCashReceipt && isCashReceiptEligible(editPayMethod) && editAmount > 0 && (!editRec.cashReceiptIssuedAt || editMoved)
    ? JSON.stringify([editRec.id, editDate, editPayMethod, editAmount, editCashReceiptDate])
    : null
  useEffect(() => {
    if (!editPvKey || !editingId) return
    const seq = ++editPvSeq.current
    // 금액을 치는 동안 매 글자마다 부르지 않게 잠깐 기다린다.
    const t = setTimeout(() => {
      previewPaymentEditCr(editingId, { payDate: editDate, payMethod: editPayMethod, issued: true, issuedDate: editCashReceiptDate, actualAmount: editAmount })
        .then(res => {
          if (seq !== editPvSeq.current) return
          setEditCrPv({ key: editPvKey, res })
          if (res.ok && res.fieldUsed && res.amount != null) {
            const amt = res.amount, pf = editCrPrefillAmt.current
            setEditCrAmount(cur => (cur === pf ? amt : cur))
            setEditCrPrefill(prev => ({ ...prev, amount: amt }))
          }
        })
        .catch(() => { if (seq === editPvSeq.current) setEditCrPv({ key: editPvKey, res: 'net' }) })
    }, 250)
    return () => clearTimeout(t)
  }, [editPvKey, editingId, editDate, editPayMethod, editCashReceiptDate, editAmount])

  // 수정 중 수단을 카드로 바꾸면 발행 표시를 끈다(운영자 확정 2026-08-24).
  // "결제 수단을 바꿨기 때문에 현금영수증은 자연히 취소가 되어야 하고 카드결제로 했으니
  // 카드결제 금액으로 합산되어야 하는거야". 서버도 같은 봉인을 갖지만(updatePayment) 화면이
  // 먼저 말해야 저장을 누르기 전에 무슨 일이 일어나는지 보인다.
  useEffect(() => {
    if (!isCashReceiptEligible(editPayMethod)) setEditCashReceipt(false)
  }, [editPayMethod])

  const handleSaveEdit = () => {
    if (!editingId) return
    // 발행 금액·구성은 운영자가 프리필과 다르게 고쳤을 때만 이 저장에 함께 싣는다(2026-10-14 독립 검수 F1).
    // 종전에는 저장 뒤 발행 금액 문(setPaymentCashReceipt)을 무조건 한 번 더 불러, 입금일을 옮겨 서버가
    // 두 영수증을 합친 금액(700,000)을 프리필(옛 키 400,000)로 덮었다. 이제 호출은 한 번, 적용취소 토큰도 하나다.
    // 0원 행은 발행할 돈이 아니라 켜는 저장을 서버가 거부한다(검수 R-6). 화면은 체크 대신 캡션을 세우고 켜지 않는다.
    const before = records?.find(r => r.id === editingId)
    const crOn = editCashReceipt && !(editAmount <= 0 && !before?.cashReceiptIssuedAt)
    const crChanged = crOn && (
      editCrAmount !== editCrPrefill.amount
      || editCrIncl.deposit !== editCrPrefill.incl.deposit
      || editCrIncl.cleaning !== editCrPrefill.incl.cleaning
      || editCrIncl.rent !== editCrPrefill.incl.rent
    )
    // 저장 토스트가 발행 줄에 일어난 일을 말할 재료(2026-10-13 422호 2단계). 옮겼는지는 서버와 같이 엄격히 본다
    // (옛 null 수단을 '' 로 다시 저장해도 서버는 키가 옮겨 간 것으로 본다).
    const crOpts = {
      moved: !!before && (editDate !== kstYmdStr(new Date(before.payDate)) || editPayMethod !== before.payMethod),
      wasStamped: !!before?.cashReceiptIssuedAt, nowStamped: crOn && isCashReceiptEligible(editPayMethod),
      amountEdited: crChanged, beforeAmount: before?.cashReceiptKey?.line?.amount ?? null,
      stampedRows: before?.cashReceiptKey?.stampedRentRows ?? 1,
    }
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
        targetMonth:  editTargetMonth || undefined,
        cashReceiptIssued: crOn,
        cashReceiptIssuedDate: editCashReceiptDate,
        ...(crChanged ? { cashReceiptAmount: editCrAmount, cashReceiptIncl: editCrIncl } : {}),
      }), { success: '' })
      if (!res.ok) return
      // 수정 저장도 적용취소가 있다(운영자 원칙 "모든 쓰기에 적용취소", 2026-10-14 W8).
      // 서버가 토큰을 못 냈으면(운영에서 서명 키 없음, 검수 R-7) 눌러도 거절될 버튼이라 숨긴다.
      const undo = res.undo
      let undone = false   // 연타 방지. 두 번째 요청은 이미 되돌린 기록과 충돌해 실패로 떨어진다
      const crDetail = crEditToastDetail(res.cashReceipt, crOpts)
      pushToast('success', '수납 기록 수정됨', {
        ...(crDetail ? { detail: crDetail } : {}),
        ...(undo ? { action: { label: '적용취소', run: () => {
          if (undone) return
          undone = true
          void undoPaymentEdit(undo).then(r => {
            if (r.ok) { pushToast('info', '수납 기록 수정을 적용취소했습니다'); reload(); onChange?.() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다'))
        } } } : {}),
      })
      await reload()
      setEditingId(null)
      onChange?.()
    })
  }

  const handleDelete = async (p: Record) => {
    // 이 삭제가 현금영수증 발행 기록에 무엇을 하는지 먼저 읽어 확인창이 말하게 한다(2026-10-13 422호 2단계).
    // 판정은 실제 삭제와 같은 정본이다. 읽기가 실패하거나 상한(600ms)을 넘으면 그 한 줄만 빠지고 삭제는 막지 않는다(검수 R-9).
    if (delPendingId) return
    setDelPendingId(p.id)
    const pv = await previewWithin(previewPaymentDelete(p.id))
    setDelPendingId(null)
    if (!(await confirmDeletePayment(p, pv?.ok ? pv : null))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deletePayment(p.id)
        if (!res.ok) { pushToast('error', res.error); return }
        const detail = crDeleteToastDetail(res.cashReceipt)
        const undo = res.undo   // 운영에서 서명 키가 없으면 null(검수 R-7). 그때는 적용취소를 숨긴다.
        pushToast('success', '수납 기록 삭제됨', {
          ...(detail ? { detail } : {}),
          ...(undo ? { action: { label: '적용취소', run: () => { void restorePayment(p.id, undo).then(r => {
            if (r.ok) {
              // 적용취소 뒤에도 결과 토스트(§16). 함께 지웠던 발행 기록을 되살렸으면 그 금액을, 되살린 금액이 지금
              // 받은 돈과 다르면 그 사실을 말한다(금액은 자동으로 안 덮는다).
              const d = crRestoreDetail(r.cashReceipt)
              pushToast('info', CR_DELETE_UNDONE, d ? { detail: d } : undefined)
              reload(); onChange?.()
            } else pushToast('error', r.error)
          }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다')) } } } : {}),
        })
        await reload()
        onChange?.()
      } catch (err) {
        pushToast('error', humanError(err, '삭제 실패'))
      } finally { release() }
    })
  }

  // 현금영수증 원터치 토글 — 수정 폼에 들어가지 않고 발행 표시(오류신고 c0936f89). 적용취소는 원래 시각 복원.
  // **켜기는 발행일을 먼저 묻는다**(운영자 지시 2026-08-25). 종전에는 무조건 오늘로 켜져 실제
  // 발행일이 다르면 수정 폼을 또 열어야 했다. 끄기는 날짜가 필요 없어 종전처럼 한 번에 꺼진다.
  const handleToggleCashReceipt = (p: Record) => {
    if (!p.cashReceiptIssuedAt) {
      // 켜기 — 행 밑에 발행일 확인 줄을 편다(작업 행 완료 폼과 같은 인라인 문법).
      // 기록될 발행 금액을 먼저 보인다(일괄 발행 모달과 같은 순서). 판정은 실제 켜기와 같은 정본이라
      // 미리 본 금액이 곧 기록되는 금액이다. 실패하면 금액 자리만 비우고 켜기는 막지 않는다(서버가 최종 판정).
      setCrAskId(p.id)
      setCrAskDate(kstYmdStr())
      setCrPreview(null)
      void previewCashReceiptOn(p.id)
        .then(res => setCrPreview({ id: p.id, res }))
        .catch(() => setCrPreview({ id: p.id, res: 'net' }))
      return
    }
    startTransition(async () => {
      const res = await setCashReceiptIssued(p.id, false)
      if (!res.ok) { pushToast('error', res.error); return }
      // 그 달 발행 합계에서 얼마가 빠지는지 말한다. 한 장이 같은 날 여러 행을 덮었으면 그 행들도 함께 내려간다.
      const undo = res.undo   // 운영에서 서명 키가 없으면 null(검수 R-7). 그때는 적용취소를 숨긴다.
      pushToast('success', '현금영수증 발행 표시를 해제했습니다', {
        detail: crOffToastDetail(res.dropped, p.cashReceiptKey?.stampedRentRows ?? 1),
        ...(undo ? { action: { label: '적용취소', run: () => { void undoCashReceiptChange(undo).then(r => {
          if (r.ok) {
            const d = crUndoMismatchDetail(r.mismatch)
            pushToast('info', crOffUndoneMessage(r.line), d ? { detail: d } : undefined)
            reload(); onChange?.()
          } else pushToast('error', r.error)
        }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다')) } } } : {}),
      })
      await reload()
      onChange?.()
    })
  }

  // 켜기 확정 — 물은 발행일로 기록한다. 토스트·적용취소는 종전 토글과 같은 문법.
  // 토스트는 기록된 줄의 발행일·금액을 말한다(고른 날짜가 아니다. 살아 있는 발행에 더하면 앞 발행일을 지킨다).
  // 이미 다 덮인 키(keep)는 바뀐 것이 없어 성공처럼 말하지 않고 적용취소도 달지 않는다(lib/cashReceiptCopy crOnToast).
  const confirmCashReceiptOn = (p: Record, ymd: string) => {
    startTransition(async () => {
      const res = await setCashReceiptIssued(p.id, true, ymd)
      if (!res.ok) { pushToast('error', res.error); return }
      setCrAskId(null)
      const t = crOnToast(res, ymd)
      const undo = res.undo   // 운영에서 서명 키가 없으면 null(검수 R-7). 그때는 적용취소를 숨긴다.
      pushToast(t.kind, t.message, {
        ...(t.detail ? { detail: t.detail } : {}),
        ...(t.undoable && undo ? { action: { label: '적용취소', run: () => { void undoCashReceiptChange(undo).then(r => {
          if (r.ok) {
            const d = crUndoMismatchDetail(r.mismatch)
            // 살아 있는 발행에 더한 켜기(add)를 무르면 앞 발행이 돌아온다. 그 금액을 말한다(미발행으로 복귀가 아니다).
            pushToast('info', crOnUndoneMessage(r.line), d ? { detail: d } : undefined)
            reload(); onChange?.()
          } else pushToast('error', r.error)
        }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다')) } } } : {}),
      })
      await reload()
      onChange?.()
    })
  }

  if (records === null) return <SkeletonRows rows={2} className="py-1" />
  // 납입일 변경 조정 행은 일반 수납 행이 아니다. 아래 '납입일 변경 조정' 묶음으로 떼어 그린다(신고 df82ce57, 입주자 수납 모달과 같은 컴포넌트).
  // 일반 수정 폼을 열면 금액 칸이 부호를 지운다. 서버도 그 저장을 거절한다(updatePayment, lib/dueDayAdjust).
  const regularRows = records.filter(r => !isDueDayAdjust(r.memo))
  const adjustRows = records.filter(r => isDueDayAdjust(r.memo))
  const adjustList = (
    <DueDayAdjustList
      records={adjustRows}
      canEdit={canEdit}
      readOnly={cashReceiptOnly}
      // 편집 접점은 일반 수납 행과 같은 규칙이다(그 record 의 귀속월 화면, 미래 귀속은 어디서든).
      editable={p => editableHere(p.targetMonth)}
      lockedNote={p => `위 조회 월을 ${Number(p.targetMonth.slice(5))}월로 바꾸면 수정할 수 있습니다.`}
      deletingId={delPendingId}
      onDelete={a => { const p = records.find(r => r.id === a.id); if (p) void handleDelete(p) }}
      onChanged={() => { void reload(); onChange?.() }}
    />
  )
  if (regularRows.length === 0) return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--warm-muted)] py-2">{scope === 'window' ? '최근 3개월 수납 기록이 없습니다.' : '이 달 수납 기록이 없습니다.'}</p>
      {adjustList}
    </div>
  )

  return (
    <div className="space-y-3">
    <div className="space-y-1.5">
      {regularRows.map((p, idx) => {
        const prevOwner = !p.isDeposit && (isPreAcq(p) || p.isPrevOwner)
        // 화면에 표시되는 "회차"는 viewMonth 안에서 payDate 시간 순. records가 이미 payDate asc 정렬돼 옴.
        // DB seqNo는 귀속월 별로 매겨져서 사용자가 보는 시간 순서와 안 맞을 수 있음 (사용자 피드백 2026-05-31).
        const displaySeq = idx + 1
        // 발행 금액 캡션(3번째 줄). 기준은 이 행 금액이 아니라 그 키(같은 날·같은 수단)의 이용료 합이다
        // (서버 cashReceiptKey, lib/cashReceiptCopy 정본). 같으면 null 이라 줄이 안 선다. 카드는 대상이 아니다.
        const crCap = isCashReceiptEligible(p.payMethod)
          ? cashReceiptRowCaption({ stamped: !!p.cashReceiptIssuedAt, key: p.cashReceiptKey })
          : null
        const crCapId = `${uid}-cr-${p.id}`
        // 켜기 확인 줄의 미리보기. 이 행의 것만 쓴다. null 이면 아직 읽는 중, 'net' 이면 통신 실패다.
        const crPv = crAskId === p.id && crPreview?.id === p.id ? crPreview.res : null
        const crPvOk = crPv && crPv !== 'net' && crPv.ok ? crPv : null
        // 못 읽었을 때의 이유 문장. 서버가 거절했으면 그 문장, 통신 실패면 정본 안내(웹디자이너 R2).
        const crPvFail = crPv === null || crPvOk ? null : crPv === 'net' || crPv.ok || !crPv.error ? CR_PREVIEW_UNREAD : crPv.error
        // 고른 발행일이 쓰이지 않는 켜기(add 는 앞 발행일을 지키고, keep·none 은 아무것도 안 쓴다)면 발행일 칸을 잠그고
        // 지켜지는 날짜를 보인다(웹디자이너 F2). 칸이 열려 있으면 고른 날짜가 기록되는 줄로 읽힌다.
        const crLocked = !!crPvOk && crPvOk.kind !== 'create' && crPvOk.kind !== 'rebuild'
        const crShownYmd = crLocked && crPvOk?.current ? crPvOk.current.issuedYmd : crAskDate
        // 받은 금액 대비(독립 검수 R-1). 기록될 금액이 그 키의 이용료 몫과 다르면 누르기 전에 말한다. 보증금·청소비를
        // 넣은 예외 발행은 이용료 몫과 견줄 수 없어 말하지 않는다. 폼과 같은 정본 문장, 경고색이 아니다.
        const crPvGap = crPvOk && crPvOk.kind !== 'none' && !(crPvOk.current && (crPvOk.current.inclDeposit || crPvOk.current.inclCleaning))
          ? cashReceiptGapSentence(crPvOk.amount, crPvOk.keyRent)
          : null
        // 기록 버튼. 읽는 중·서버 거절·발행할 것이 없는 키(none)·이미 다 덮인 키(keep)는 막는다. 통신 실패는 살린다.
        const crOnBlocked = crPv === null || (crPv !== 'net' && (!crPv.ok || crPv.kind === 'none' || crPv.kind === 'keep'))
        if (editingId === p.id) {
          // 발행 금액 미리보기(검수 F-A). 지금 입력에 대한 응답만 쓴다. 필요한데 아직 없으면 읽는 중이다.
          const editPv = editPvKey && editCrPv?.key === editPvKey ? editCrPv.res : null
          const editPvOk = editPv && editPv !== 'net' && editPv.ok ? editPv : null
          const editPvLoading = !!editPvKey && editPv === null
          // 옮겨 함께 옮겨 가거나 합쳐지거나 도장만 빠지면 서버가 칸을 안 쓴다. 칸 대신 그 사실을 적는다.
          const editPvMovedAway = editPvOk?.kind === 'transfer' || editPvOk?.kind === 'merge' || editPvOk?.kind === 'unstamp'
          // 발행 금액 힌트의 기준. 미리보기가 있으면 서버가 저장 뒤 그 키에서 견줄 몫이다. 없으면(같은 키 재저장·통신 실패)
          // 그 키(같은 날·같은 수단)의 도장 찍힌 이용료 몫에 입력 중인 수납 금액을 바꿔 넣는다(행 캡션과 같은 식, 검수 R-2).
          const sameKey = editDate === kstYmdStr(new Date(p.payDate)) && editPayMethod === (p.payMethod ?? '')
          const sib = sameKey ? null : records.find(r => r.id !== p.id && kstYmdStr(new Date(r.payDate)) === editDate && (r.payMethod ?? '') === editPayMethod)
          const crBasis = editPvOk
            ? editPvOk.keyRent
            : editAmount + (sameKey ? (p.cashReceiptKey ? crCoveredRent(p.cashReceiptKey) : p.actualAmount) - p.actualAmount : (sib?.cashReceiptKey ? crCoveredRent(sib.cashReceiptKey) : 0))
          const crGap = editCrIncl.deposit || editCrIncl.cleaning ? null : cashReceiptGapSentence(editCrAmount, crBasis)
          // 0원 행(금액 칸이 0)은 발행할 돈이 아니다. 체크 대신 목록 행과 같은 캡션을 세운다(검수 R-6, 가이드 §22 ②).
          const crZeroEdit = editAmount <= 0 && !p.cashReceiptIssuedAt
          return (
            <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--cream-soft)] px-3 py-2.5 space-y-2">
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">금액</p>
                  <input type="text" inputMode="numeric" value={editAmount.toLocaleString()}
                    onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">납부일</p>
                  <DatePicker value={editDate} onChange={setEditDate}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">납부방법</p>
                  <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors">
                    {/* 옵션은 정본 하나에서 온다 — 손으로 적으면 자리마다 갈린다(lib/paymentMethods). */}
                    {editPayMethod && !MANUAL_PAY_METHODS.includes(editPayMethod) && (
                      <option value={editPayMethod}>{editPayMethod}</option>
                    )}
                    {MANUAL_PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">메모</p>
                  <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
              </div>
              {!p.isDeposit && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">귀속월 (이 수납이 잡히는 달)</p>
                  <select value={editTargetMonth} onChange={e => setEditTargetMonth(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors">
                    {!tmOptions.some(o => o.month === p.targetMonth) && (
                      <option value={p.targetMonth}>
                        {Number(p.targetMonth.split('-')[0])}년 {Number(p.targetMonth.split('-')[1])}월분 (현재)
                      </option>
                    )}
                    {tmOptions.map(o => {
                      const [y, m] = o.month.split('-')
                      const tag = o.status === 'paid' ? '완납'
                        : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${fmtWon(o.expectedAmount)}`
                        : o.status === 'future' ? '향후' : '미수'
                      return <option key={o.month} value={o.month}>{Number(y)}년 {Number(m)}월분 · {tag}</option>
                    })}
                  </select>
                </div>
              )}
              {/* 카드는 현금영수증 대상이 아니다 — 형제 폼과 같은 분기·같은 문구(정본).
                  이 자리만 한 줄이 더 붙는다. 이미 발행 표시가 있던 건을 카드로 바꾸는 중이면
                  저장이 그 표시를 지우므로, 누르기 전에 그 사실을 말한다. */}
              {!isCashReceiptEligible(editPayMethod) ? (
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">{CARD_NOT_CASH_RECEIPT_NOTE}</p>
                  {p.cashReceiptIssuedAt && (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)]">저장하면 이 건의 현금영수증 발행 표시가 해제되고 금액은 카드 수납으로 잡힙니다.</p>
                  )}
                </div>
              ) : crZeroEdit ? (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">{CR_ZERO_ROW_CAPTION}</p>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editCashReceipt} onChange={e => setEditCashReceipt(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[var(--coral)]" />
                  <span className="text-[0.65625rem] text-[var(--warm-dark)]">현금영수증 발행함</span>
                </label>
              )}
              {/* 발행일 — 체크했을 때만 선다. 껍데기는 이 폼의 형제 칸('납부일')과 같은 것을 넘긴다
                  (§12 한 폼 안 입력 높이 혼용 금지). pl-6 은 체크박스의 하위 항목이라는 표시다.
                  미래는 maxDate 로 막고 과거는 안 막는다 — 누락분을 나중에 올리는 것이 정상 업무다. */}
              {editCashReceipt && !crZeroEdit && (
                <div className="space-y-1 pl-6">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">발행일</p>
                  <DatePicker value={editCashReceiptDate} onChange={setEditCashReceiptDate} maxDate={kstYmdStr()}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                  {/* 발행 금액. 받은 금액과 다를 수 있다. 프리필은 저장하면 기록될 금액이다(검수 F-A). 안 건드리면 안 실린다.
                      옮김 갈래(transfer·merge·unstamp)와 이미 다 덮인 키(keep)·이용료 몫 없음은 서버가 칸을 안 쓰므로
                      칸 대신 그 사실을 적는다. 모두 폼이라 경고색이 아니다(운영자 결정 2026-08-25). */}
                  {editPvMovedAway ? (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep mt-2">{CR_EDIT_MOVED_NOTE}</p>
                  ) : editPvOk?.kind === 'keep' || editPvOk?.kind === 'notIssued' ? (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep mt-2">{editPvOk.kind === 'keep' ? CR_KEEP_PREVIEW : CR_NONE_PREVIEW}</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-[var(--warm-mid)] mt-2">발행 금액</p>
                      <MoneyInput value={editCrAmount} onChange={setEditCrAmount} />
                      {/* 살아 있는 발행에 새 돈만 더하는 저장(add)은 앞 발행일을 지킨다. 켜기 확인 줄과 같은 세 덩이. */}
                      {editPvOk?.kind === 'add' && editPvOk.prev && (
                        <p className="num text-[0.65625rem] text-[var(--warm-mid)] flex flex-wrap gap-x-1">
                          {crAddPreviewChunks(editPvOk.prev, editPvOk.added).map((t, i) => <span key={i} className="whitespace-nowrap">{t}</span>)}
                        </p>
                      )}
                      {/* 기준은 이 행 금액이 아니라 그 키의 이용료 몫이다(결함 D12. 분할 결제면 행 금액과 늘 달라 거짓 경보였다).
                          문장은 수납 등록 폼과 글자까지 같은 정본이고 폼이라 경고색은 안 쓴다(운영자 결정 2026-08-25).
                          보증금·청소비를 넣은 예외 발행은 이용료 합과 견줄 수 없어 말하지 않는다(목록 캡션이 '포함'을 적는다). */}
                      {editPvLoading ? (
                        <Skeleton className="h-3 w-3/4 mt-1" />
                      ) : crGap && (
                        <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep num">{crGap}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              {/* 취소가 subtle 인 이유 — 이 면이 --cream-soft 인데 secondary 의 바탕도 --cream-soft 라,
                  다크에서 둘 다 --d-card-2 로 같은 색이 되고 경계가 --warm-border(8% 알파) 자국뿐이었다
                  (1.23:1). subtle 의 --camel 40% 테두리는 2.33:1 이다. 가이드 v2.0 §10 ·
                  감지망 check-secondary-on-soft. */}
              <div className="flex gap-2 justify-end">
                <Btn variant="subtle" size="sm" onClick={() => setEditingId(null)}>취소</Btn>
                {/* 기록될 금액을 읽는 동안은 저장을 막는다. 칸이 아직 옛 프리필이라 칸과 저장 결과가 갈린다(검수 F-A). */}
                <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={pending || editPvLoading}>저장</Btn>
              </div>
            </div>
          )
        }
        return (
          <div key={p.id}
            className={`rounded-sm px-3 py-2.5 space-y-1.5 ${
              p.isDeposit ? 'bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]' :
              prevOwner ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'
            }`}>
            {/* 줄1: 회차·날짜·방법 + 금액(우측, 안 줄임) */}
            <div className="flex items-baseline justify-between gap-2">
              <p className={`num text-xs ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'}`}>
                {scope === 'month' && `${displaySeq}회차 · `}{fmtDate(p.payDate)} · {p.payMethod ?? '—'}
              </p>
              <span className={`num text-sm font-semibold whitespace-nowrap ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'}`}>
                {fmtWon(p.actualAmount)}
              </span>
            </div>
            {/* 줄2: 뱃지들 + 메모 + 액션 버튼 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {p.isDeposit && <span className="text-[0.65625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1.5 py-0.5">보증금</span>}
                {prevOwner && <span className="text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1.5 py-0.5">양도인</span>}
                {!p.isDeposit && (() => {
                  // 배지 기준은 '낸 달과 귀속월이 다른가'다. '조회월과 다른가' 로 두면 3개월 창에서
                  // 108건 중 102건이 켜져 배지가 기본값이 된다(실측). 이 기준이면 16%만 켜진다.
                  // '(지난 미납분)·(선납)' 상대어는 버렸다 — 조회월 기준 표현이라 3개월 창에서 뜻이 흔들린다.
                  const paidMonth = new Date(p.payDate).toISOString().slice(0, 7)
                  const late = paidMonth > p.targetMonth
                  const prepay = paidMonth < p.targetMonth
                  const mon = Number(p.targetMonth.slice(5))
                  // 어휘·색은 홈 정산 목록 정본을 따른다(dashboard/page.tsx). 지연은 warning, 선납은 info.
                  // 정반대 두 사실에 같은 색을 주면 안 되고, 이미 받은 돈에 예정색(await)을 쓰면 §03 위반이다.
                  return (
                    <span className={`${PAY_CHIP_CLS} ${
                      late ? PAY_CHIP_TONE.warning
                      : prepay ? PAY_CHIP_TONE.info
                      : PAY_CHIP_TONE.month
                    }`}>
                      {mon}월분{late ? ' 지연' : prepay ? ' 선납' : ''}
                    </span>
                  )
                })()}
                {/* 현금영수증 — 편집 가능하면 원터치 체크박스, 아니면 발행 시에만 배지.
                    배지 모양 버튼이라 눌리는 걸 몰랐던 문제(신고 241c02ea)로 수납 폼 체크박스 정본 문법으로 교체.
                    즉시 저장 + 적용취소 토스트 동작 유지, 히트영역 44px(-my-2 확장 문법). */}
                {/* 카드 계열은 매출전표가 증빙이라 현금영수증 대상이 아니다. 집계에서도 빠지는데
                    화면에만 칩이 뜨면 발행했다고 오인한다(수납 폼은 원래부터 감춘다). */}
                {p.payMethod && CARD_LIKE_METHODS.includes(p.payMethod) ? (
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] whitespace-nowrap">카드 결제 · 매출전표</span>
                ) : canEdit && p.actualAmount <= 0 && !p.cashReceiptIssuedAt ? (
                  // 0원 행은 발행할 돈이 아니다. 체크를 두면 눌러야 거절되는 조작이 된다(검수 W3, 가이드 §22 ②).
                  // 카드 행과 같은 자리·같은 글자 크기로 상태만 말한다. 서버도 켜기를 거부한다(CR_ZERO_ROW_REFUSED).
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] whitespace-nowrap">{CR_ZERO_ROW_CAPTION}</span>
                ) : canEdit ? (
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap -my-2 min-h-[44px] ${pending ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input type="checkbox" checked={!!p.cashReceiptIssuedAt} disabled={pending} onChange={() => handleToggleCashReceipt(p)}
                      aria-describedby={crCap ? crCapId : undefined}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    <span className={`text-[0.65625rem] font-semibold ${p.cashReceiptIssuedAt ? 'text-[var(--success-fg)]' : 'text-[var(--warm-muted)]'}`}>
                      {p.cashReceiptIssuedAt ? `현금영수증${crIssuedLabel(p)}` : '현금영수증 미발행'}
                    </span>
                  </label>
                ) : (
                  p.cashReceiptIssuedAt && <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5 whitespace-nowrap">현금영수증{crIssuedLabel(p)}</span>
                )}
                {p.memo && !p.isDeposit && <span className="text-[0.6875rem] text-[var(--tc-text)]">· {p.memo}</span>}
              </div>
              {/* 보증금은 위 보증금 패널에서 관리한다. 여기에도 버튼을 두면 같은 record 에 편집 경로가 둘이 된다. */}
              {canEdit && p.isDeposit && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">보증금은 맨 위 보증금 항목에서 고칩니다.</span>
              )}
              {/* 편집 접점은 그 record 의 귀속월 화면 하나다. 창을 넓혔다고 편집까지 넓히면
                  지난달 매출이 어디서든 바뀔 수 있게 된다(영향 월 고지가 아직 없다).

                  **미래 귀속만 예외다**(운영자 확정 2026-08-27). 선납은 이 사업의 원칙이라
                  9월 귀속 건이 8월에 계속 생기는데, 종전에는 그 건을 고칠 길이 아예 없었다 —
                  버튼은 9월 화면에만 서고 재무 화면은 미래 월로 못 간다(MonthSelector
                  allowFuture=false). 두 잠금이 맞물려 막다른 길이 됐다(406호 실기).
                  미래 귀속은 마감된 적도, 신고에 실린 적도, 과거 어느 합계에 들어간 적도
                  없다 — 위 걱정('지난달 매출')이 성립하지 않으므로 입금일 화면에서 바로 다룬다.
                  미래 월 화면을 여는 쪽이 아니라 이쪽인 이유는 접점이 작아서다. */}
              {/* 이용료 환불 확정이 만든 record 는 여기서 안 고친다 — 스냅샷과 어긋나면 적용취소가 틀어진다.
                  서버(updatePayment·deletePayment)도 거부하므로 버튼을 두면 눌러야 거절되는 버튼이 된다. */}
              {canEdit && !cashReceiptOnly && !p.isDeposit && isRentRefundRecord(p.memo) && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">환불 확정 수납은 위 이용료 정산 항목에서 고칩니다.</span>
              )}
              {canEdit && !cashReceiptOnly && !p.isDeposit && !isRentRefundRecord(p.memo) && !editableHere(p.targetMonth) && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">위 조회 월을 {Number(p.targetMonth.slice(5))}월로 바꾸면 수정할 수 있습니다.</span>
              )}
              {canEdit && !cashReceiptOnly && !p.isDeposit && !isRentRefundRecord(p.memo) && editableHere(p.targetMonth) && (
                <div className="flex gap-1.5">
                  <RowActionBtn tone="neutral" onClick={() => startEdit(p)}>수정</RowActionBtn>
                  <RowActionBtn tone="danger" disabled={delPendingId === p.id} onClick={() => handleDelete(p)}>삭제</RowActionBtn>
                </div>
              )}
            </div>
            {/* 줄3: 발행 금액 캡션. 받은 금액과 다를 때만 선다(같으면 침묵, 침묵이 곧 '받은 금액 그대로 발행').
                체크 label 안이나 줄2 왼쪽 묶음에 넣지 않는다. 그 묶음은 flex-wrap 이라 캡션이 배지 사이로
                끼어 접히고, 44px 히트영역 안에 들면 캡션을 눌러도 토글이 된다. 보기 전용·요약 모드에도 같은 줄이다. */}
            {crCap && <CashReceiptCaption caption={crCap} id={crCapId} />}
            {/* 켜기 확인 줄 — 체크를 누르면 바로 켜지 않고 발행일부터 받는다(운영자 지시 2026-08-25).
                작업 행 완료 폼과 같은 인라인 문법이다. 끄기는 이 줄을 안 거친다. */}
            {crAskId === p.id && (
              <div className="mt-1.5 space-y-2">
                {/* 기록될 발행 금액. 읽기 전용으로 먼저, 발행일은 그다음(일괄 발행 모달과 같은 순서).
                    금액을 여기서 고치는 칸은 두지 않는다. 확인 줄에 입력 높이가 섞이고, 발행 금액을 고치는 자리는
                    수정 폼 하나라는 결정(2026-08-25)과 갈린다. 오른쪽 숫자는 줄1의 받은 금액과 자릿수가 맞는다. */}
                {/* aria-live 는 읽는 중 자리표시가 금액으로 바뀔 때 화면낭독기가 그 금액을 읽게 한다(웹디자이너 R3). */}
                <div className="space-y-0.5" aria-live="polite" aria-busy={crPv === null}>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--warm-mid)]">
                    <span>발행 금액</span>
                    {/* 읽는 중은 인라인 스켈레톤(가이드 §17, 말줄임표 대신). 실패는 대시 대신 아래 줄의 이유 문장(R2, §29). */}
                    {crPv === null ? (
                      <Skeleton className="h-4 w-20 self-center" />
                    ) : crPvOk ? (
                      <span className="num text-sm font-semibold text-[var(--warm-dark)] whitespace-nowrap">{fmtWon(crPvOk.amount)}</span>
                    ) : null}
                  </div>
                  {crPvFail && <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">{crPvFail}</p>}
                  {/* 살아 있는 발행에 새 돈만 더하는 켜기(add)는 앞 발행일을 지킨다. 금액 덩이만 오른쪽(줄1 금액과 자릿수
                      정렬)이고 문장은 왼쪽이다(웹디자이너 R4). 덩이는 셋이라 좁은 칸에서도 행 밖으로 안 나간다(F1). */}
                  {crPvOk?.kind === 'add' && crPvOk.current && (
                    <p className="num text-[0.65625rem] text-[var(--warm-mid)] flex flex-wrap justify-end gap-x-1">
                      {crAddPreviewChunks(crPvOk.current, crPvOk.added).map((t, i) => <span key={i} className="whitespace-nowrap">{t}</span>)}
                    </p>
                  )}
                  {/* 환불 확정 수납의 재발행은 살아 있는 앞 발행을 이 금액으로 바꾼다(독립 검수 R-5). */}
                  {crPvOk?.kind === 'rebuild' && crPvOk.current && (
                    <p className="num text-[0.65625rem] text-[var(--warm-mid)] break-keep">{crReplacePreview(crPvOk.current)}</p>
                  )}
                  {crPvGap && <p className="num text-[0.65625rem] text-[var(--warm-mid)] break-keep">{crPvGap}</p>}
                  {(crPvOk?.kind === 'keep' || crPvOk?.kind === 'none') && (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">{crPvOk.kind === 'keep' ? CR_KEEP_PREVIEW : CR_NONE_PREVIEW}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
                  발행일
                  <DatePicker value={crShownYmd} onChange={setCrAskDate} maxDate={kstYmdStr()} disabled={crLocked}
                    className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]" />
                </div>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {/* 금액을 읽기 전·서버가 거절한 키·발행할 것이 없는 키(none)·이미 다 덮인 키(keep)는 누르지 않게 한다.
                      눌러야 거절되거나 아무 일도 안 일어나는 버튼이 된다. 통신 실패만은 살린다(서버가 최종 판정). */}
                  <RowActionBtn tone="accent" disabled={pending || crOnBlocked} onClick={() => confirmCashReceiptOn(p, crShownYmd)}>발행 기록</RowActionBtn>
                  <RowActionBtn onClick={() => setCrAskId(null)}>취소</RowActionBtn>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
    {adjustList}
    </div>
  )
}
