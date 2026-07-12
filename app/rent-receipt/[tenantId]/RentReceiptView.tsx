'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RentReceiptData } from './actions'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

type Fields = {
  name: string; room: string; period: string; targetMonth: string
  amount: string; payDate: string; payMethod: string; note: string; recipientName: string
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

  const payload = () => ({ tenantId: data.tenantId, leaseTermId: data.leaseTermId, fields: { ...f, issueDate } })

  const reset = async () => {
    if (!(await confirmDialog({ title: '자동값으로 되돌릴까요?', message: '직접 수정한 내용이 모두 사라집니다.', confirmLabel: '되돌리기', level: 'caution' }))) return
    setF(buildInitial(data)); setIssueDate(kstYmdStr())
    pushToast('info', '자동값으로 되돌렸습니다')
  }

  const [previewing, setPreviewing] = useState(false)
  const handlePreview = async () => {
    if (previewing) return
    setPreviewing(true)
    try {
      const res = await fetch('/api/rent-receipt/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), preview: true }),
      })
      if (!res.ok) {
        let msg = `서버 오류 (${res.status})`
        try { const j = await res.json(); msg = j?.error ?? msg } catch { /* not json */ }
        pushToast('error', msg); return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      pushToast('error', (err as Error).message ?? '미리보기 생성 실패')
    } finally { setPreviewing(false) }
  }

  const [issuing, setIssuing] = useState(false)
  const handleIssue = async () => {
    if (!(await confirmDialog({ title: '입실료 납부 확인서를 발급할까요?', message: '도장이 합성된 PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.', confirmLabel: '발급' }))) return
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
      pushToast('success', '입실료 납부 확인서 발급됨. 발급 이력으로 이동합니다')
      router.push('/rent-receipts')
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg)
    } finally { release(); setIssuing(false) }
  }

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'
  const Field = ({ label, k, placeholder }: { label: string; k: keyof Fields; placeholder?: string }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" value={f[k]} onChange={set(k)} placeholder={placeholder} className={inputCls} />
    </div>
  )

  // 100dvh + 하단 safe-area — 모바일에서 브라우저 하단 바·홈 인디케이터에 발급 버튼이 잘리던 문제(운영자 신고 2026-07-10)
  return (
    <div className="min-h-dvh bg-[var(--canvas)] flex flex-col items-center px-4 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/rent-receipts" className="text-sm text-[var(--coral)]">‹ 입실료 납부 확인서</Link>
          <button onClick={reset} className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--cream)]">자동값으로</button>
        </div>

        <div>
          <h1 className="text-lg font-bold text-[var(--warm-dark)]">입실료 납부 확인서 작성</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">자동으로 채워진 값을 확인·수정한 뒤 발급하세요. 영업장명·로고·사업자정보는 자동으로 들어갑니다.</p>
        </div>

        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--warm-mid)]">발행일</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="수령인 (입주자)" k="name" placeholder="홍길동" />
            <Field label="호실" k="room" placeholder="501호" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="거주 기간 (1달 선납)" k="period" placeholder="2026.06.05 ~ 2026.07.04" />
            <Field label="납부 대상월" k="targetMonth" placeholder="2026년 6월분" />
          </div>
          <Field label="금액 (월 이용료, 원)" k="amount" placeholder="390,000" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="납부일" k="payDate" placeholder="2026년 6월 16일" />
            <Field label="납부방법" k="payMethod" placeholder="계좌이체 · 계좌번호 / 현금" />
          </div>
          <Field label="비고" k="note" placeholder="다음 납부 예정일 …" />
          <Field label="임대인 대표 (수령인)" k="recipientName" placeholder="예: 홍길동" />
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">영업장명·로고·사업자정보·발행번호·도장은 자동으로 들어갑니다. 모든 칸은 직접 수정 가능합니다. (납부방법의 계좌번호는 환경설정에서 설정)</p>
        </div>

        <div className="flex gap-2">
          <button onClick={handlePreview} disabled={previewing}
            className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--warm-border)] text-sm font-medium text-[var(--warm-dark)] bg-[var(--cream)] disabled:opacity-60">
            {previewing ? '여는 중…' : '미리보기·인쇄'}
          </button>
          <button onClick={handleIssue} disabled={issuing}
            className="flex-1 px-3 py-2.5 rounded-xl bg-[var(--coral)] text-[var(--on-solid)] text-sm font-semibold disabled:opacity-60">
            {issuing ? '발급 중…' : '발급 (PDF 저장)'}
          </button>
        </div>
      </div>
    </div>
  )
}
