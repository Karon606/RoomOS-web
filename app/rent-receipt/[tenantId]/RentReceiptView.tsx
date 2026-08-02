'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RentReceiptData } from './actions'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn } from '@/components/ui/Btn'
import { SendDocButton } from '@/components/ui/SendDocButton'
import DocumentScroll from '@/components/layout/DocumentScroll'

type Fields = {
  name: string; room: string; period: string; targetMonth: string
  amount: string; payDate: string; payMethod: string; note: string; recipientName: string
}

const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'

// 모듈 레벨 — 렌더 본문 안에서 정의하면 입력 한 글자마다 컴포넌트 identity 가 바뀌어
// input 이 unmount/remount 되고 모바일 키보드가 닫힌다(운영자 신고 2026-07-27).
function Field({ label, value, onChange, placeholder }: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" value={value} onChange={onChange} placeholder={placeholder} className={inputCls} />
    </div>
  )
}

// 보고 있는 대상월이 '이번 달'과 얼마나 떨어졌는지 (MonthSelector 와 동일 규칙). 같으면 null.
function relMonthLabel(view: string, today: string): string | null {
  if (view === today) return null
  const [vy, vm] = view.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const diff = (ty - vy) * 12 + (tm - vm)   // +면 과거
  if (diff === 1) return '지난달'
  if (diff > 1) return `${diff}개월 전`
  if (diff === -1) return '다음달'
  return `${-diff}개월 후`
}

function buildInitial(data: RentReceiptData): Fields {
  return {
    name: data.name,
    room: data.room,
    period: data.period,
    targetMonth: data.targetMonth,
    amount: data.amount ? data.amount.toLocaleString() : '',
    payDate: data.payDate,
    payMethod: data.payMethod,
    note: data.note,
    recipientName: data.recipientName,
  }
}

export default function RentReceiptView({ data }: { data: RentReceiptData }) {
  const router = useRouter()
  const [f, setF] = useState<Fields>(() => buildInitial(data))
  const [issueDate, setIssueDate] = useState(kstYmdStr())
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  // 서류 종류 — 보증금은 귀속 월이 없어 스테퍼를 숨기고 문구·라벨이 갈린다(신고 d68220bd)
  const isDeposit = data.kind === 'deposit'
  const docLabel = isDeposit ? '보증금 영수증' : '입실료 납부 확인서'
  // 목록 복귀 경로 — 종류를 유지한다. 안 붙이면 보증금으로 발급하고도 입실료 탭으로 떨어진다(운영자 지적).
  const listHref = isDeposit ? '/rent-receipts?kind=deposit' : '/rent-receipts'
  const payload = () => ({ tenantId: data.tenantId, leaseTermId: data.leaseTermId, fields: { ...f, issueDate, kind: data.kind, preResidence: data.preResidence } })

  // 대상월 스테퍼 — ?month 를 갈아끼우면 서버가 그 달 주기로 자동값을 다시 계산한다.
  // 작성 중인 수정값이 있으면 리마운트로 사라지므로 먼저 확인받는다.
  const [initialSnapshot] = useState(() => JSON.stringify({ ...buildInitial(data), issueDate: kstYmdStr() }))
  const dirty = JSON.stringify({ ...f, issueDate }) !== initialSnapshot
  const rel = relMonthLabel(data.anchorMonth, data.todayMonth)
  // 계약서 §1-3 이 "입실료는 매월 선납을 원칙으로 하며, 반드시 입실일 기준 전일까지 납부" 를 약정한다.
  // 이번 달까지만 열어두면 선납을 받고도 그 달 확인서를 만들 수 없다(E페이즈 2026-08-03).
  // 다음 달까지 한 칸 연다 — 그보다 먼 미래는 증빙할 사실이 없다.
  const nextMonth = (() => {
    const [y, m] = data.todayMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const atCurrentMonth = data.anchorMonth >= nextMonth
  const stepMonth = async (delta: number) => {
    if (delta > 0 && atCurrentMonth) return
    if (dirty && !(await confirmDialog({ title: '대상월을 옮길까요?', message: '작성 중인 내용이 초기화됩니다.', confirmLabel: '옮기기', level: 'caution' }))) return
    const [ay, am] = data.anchorMonth.split('-').map(Number)
    const d = new Date(ay, am - 1 + delta, 1)
    router.replace(`/rent-receipt/${data.tenantId}?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const reset = async () => {
    if (!(await confirmDialog({ title: '자동값으로 되돌릴까요?', message: '직접 수정한 내용이 모두 사라집니다.', confirmLabel: '되돌리기', level: 'caution' }))) return
    setF(buildInitial(data)); setIssueDate(kstYmdStr())
    pushToast('info', '자동값으로 되돌렸습니다')
  }

  const [previewing, setPreviewing] = useState(false)
  const handlePreview = async () => {
    if (previewing) return
    setPreviewing(true)
    // 팝업 차단 회피: 사용자 제스처 시점에 빈 새 탭을 먼저 열고 PDF 준비되면 주입(모바일 Safari 대응).
    const win = window.open('', '_blank')
    try {
      const res = await fetch('/api/rent-receipt/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), preview: true }),
      })
      if (!res.ok) {
        win?.close()
        let msg = `미리보기를 불러오지 못했습니다.`
        try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* not json */ }
        pushToast('error', msg); return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      win?.close()
      pushToast('error', (err as Error).message ?? '미리보기 생성에 실패했습니다.')
    } finally { setPreviewing(false) }
  }

  const [issuing, setIssuing] = useState(false)
  const handleIssue = async () => {
    if (!(await confirmDialog({ title: `${docLabel}를 발급할까요?`, message: '도장이 합성된 PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.', confirmLabel: '발급' }))) return
    setIssuing(true)
    const release = trackSave()
    try {
      const res = await fetch('/api/rent-receipt/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      const text = await res.text()
      let json: { ok: boolean; error?: string } | null = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      if (!res.ok || !json?.ok) {
        const msg = json?.error ?? `서버 오류 (${res.status})`
        pushToast('error', msg); return
      }
      pushToast('success', `${docLabel} 발급됨. 발급 이력으로 이동합니다`)
      router.push(listHref)
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg)
    } finally { release(); setIssuing(false) }
  }

  // 100dvh + 하단 safe-area — 모바일에서 브라우저 하단 바·홈 인디케이터에 발급 버튼이 잘리던 문제(운영자 신고 2026-07-10)
  // DocumentScroll — 셸 밖 라우트라 문서 스크롤을 켜야 폼 하단 발급 버튼에 닿는다(신고 000a22ed)
  return (
    <div className="min-h-dvh bg-[var(--canvas)] flex flex-col items-center px-4 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <DocumentScroll />
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={listHref} className="text-sm text-[var(--coral)]">‹ {docLabel}</Link>
          <button onClick={reset} className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--cream)]">자동값으로</button>
        </div>

        <div>
          <h1 className="text-lg font-bold text-[var(--warm-dark)]">{docLabel} 작성</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">자동으로 채워진 값을 확인·수정한 뒤 발급하세요. 영업장명·로고·사업자정보는 자동으로 들어갑니다.</p>
        </div>

        {/* 발급 대상월 — 이번 달이 아니면 '눈에 띄게'(MonthSelector 와 동일한 감색 셸·상대월 배지). 발행일은 항상 오늘. */}
        <div
          className="flex items-stretch min-h-[44px] rounded-lg overflow-hidden transition-colors"
          style={rel
            ? { background: 'var(--warning-bg)', border: '1.5px solid var(--warning-fg)' }
            : { background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
        >
          {/* 단기는 입주월 단일 청구라 월 이동이 무의미 — 스테퍼 숨김(회계 오더 2026-07-27) */}
          {!data.isShortTerm && !isDeposit && (
          <button
            onClick={() => void stepMonth(-1)}
            className="w-11 shrink-0 flex items-center justify-center transition-colors hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
            style={{ color: 'var(--warm-mid)' }}
            aria-label="이전 달"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          )}
          <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-semibold text-center" style={{ color: 'var(--warm-dark)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>{isDeposit ? '입주 예정일' : '발급 대상월'}</span>
            <span className="truncate">{data.targetMonth}</span>
            {rel && (
              <span className="text-[0.65625rem] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
                style={{ background: 'var(--warning-solid)', color: 'var(--on-solid)' }}>{rel}</span>
            )}
          </div>
          {!data.isShortTerm && !isDeposit && (
          <button
            onClick={() => void stepMonth(1)}
            disabled={atCurrentMonth}
            className="w-11 shrink-0 flex items-center justify-center transition-colors enabled:hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
            style={{ color: atCurrentMonth ? 'var(--warm-border)' : 'var(--warm-mid)', cursor: atCurrentMonth ? 'default' : 'pointer' }}
            aria-label="다음 달"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6"/></svg>
          </button>
          )}
        </div>

        {/* 수납 대조 경고 — 화면 전용(인쇄물 미출력). 발급은 막지 않는다(자동값은 초기값일 뿐, 회계 오더). */}
        {data.warning && (
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}>
            {data.warning === 'noRecord'
              ? (isDeposit
                  ? '보증금 수납 기록이 없어 금액을 0원으로 두었습니다. 실제 받은 내역이 있으면 직접 입력해 주세요.'
                  : '이 달 수납 기록이 없어 금액을 0원으로 두었습니다. 실제 받은 내역이 있으면 직접 입력해 주세요.')
              : (isDeposit
                  ? '계약 보증금보다 적게 받았습니다. 영수증에는 받은 금액 그대로 표기됩니다.'
                  : '실입금이 청구액보다 적습니다. 확인서에는 받은 금액 그대로 표기됩니다.')}
          </p>
        )}

        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--warm-mid)]">발행일</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="수령인 (입주자)" value={f.name} onChange={set('name')} placeholder="홍길동" />
            <Field label="호실" value={f.room} onChange={set('room')} placeholder="501호" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* 입주 전 보증금 영수증은 거주 기간이 비어 있다(살지 않은 기간을 적으면 허위 기재) */}
            <Field label={isDeposit ? '거주 기간' : '거주 기간 (1달 선납)'} value={f.period} onChange={set('period')}
              placeholder={isDeposit ? '입주 전이라 비워 둡니다' : '2026.06.05 ~ 2026.07.04'} />
            <Field label={isDeposit ? '입주 예정일' : '납부 대상월'} value={f.targetMonth} onChange={set('targetMonth')} placeholder={isDeposit ? '2026년 8월 17일' : '2026년 6월분'} />
          </div>
          <Field label={isDeposit ? '금액 (보증금, 원)' : '금액 (월 이용료, 원)'} value={f.amount} onChange={set('amount')} placeholder={isDeposit ? '500,000' : '390,000'} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={isDeposit ? '수령일' : '납부일'} value={f.payDate} onChange={set('payDate')} placeholder="2026년 6월 16일" />
            <Field label={isDeposit ? '수령방법' : '납부방법'} value={f.payMethod} onChange={set('payMethod')} placeholder="계좌이체 · 계좌번호 / 현금" />
          </div>
          <Field label="비고" value={f.note} onChange={set('note')}
            placeholder={isDeposit
              ? (data.preResidence ? '입주 전 예약금 · 입실 취소 시 반환되지 않습니다' : '퇴실 시 미납금·손해배상액 공제 후 반환')
              : '다음 납부 예정일 …'} />
          <Field label="임대인 대표 (수령인)" value={f.recipientName} onChange={set('recipientName')} placeholder="예: 홍길동" />
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">영업장명·로고·사업자정보·발행번호·도장은 자동으로 들어갑니다. 모든 칸은 직접 수정 가능합니다. (납부방법의 계좌번호는 환경설정에서 설정)</p>
        </div>

        <div className="flex gap-2">
          <Btn variant="secondary" className="flex-1" onClick={handlePreview} disabled={previewing}>
            {previewing ? '여는 중…' : '미리보기·인쇄'}
          </Btn>
          {/* 발급 직후 전송 동선 — 실거주확인서 발급 화면과 동일 클래스(사진/PDF 형식 선택, 운영자 확인 2026-07-22) */}
          <SendDocButton fileName={`${data.name}_${isDeposit ? '보증금영수증' : '입실료납부확인서'}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 font-medium transition-colors bg-[var(--cream-soft)] hover:bg-[var(--sand)] text-[var(--warm-dark)] border border-[var(--warm-border)] px-4 py-2.5 text-sm min-h-[44px] rounded-lg disabled:opacity-50"
            getPdfBytes={async () => {
              const res = await fetch('/api/rent-receipt/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload(), preview: true }),
              })
              if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
              return res.arrayBuffer()
            }} />
          <Btn variant="primary" className="flex-1" onClick={handleIssue} disabled={issuing}>
            {issuing ? '발급 중…' : '발급 (PDF 저장)'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
