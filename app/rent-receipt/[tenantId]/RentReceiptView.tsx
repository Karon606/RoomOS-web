'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RentReceiptData } from './actions'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

const fmtDot = (d: string) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  if (!y) return d
  return `${y}. ${Number(m)}. ${Number(dd)}`
}

type Fields = { nameRoom: string; period: string; amount: string; recipientName: string; recipientPhone: string }

function buildInitial(data: RentReceiptData): Fields {
  const start = fmtDot(data.periodStart)
  const end = fmtDot(data.periodEnd || kstYmdStr())
  return {
    nameRoom: data.nameRoom,
    period: start ? `${start} ~ ${end}` : end,
    amount: data.amount ? `${data.amount.toLocaleString()} 원` : '',
    recipientName: data.recipientName,
    recipientPhone: data.recipientPhone,
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
    if (!(await confirmDialog({ title: '월세 영수증을 발급할까요?', message: '도장이 합성된 PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.', confirmLabel: '발급' }))) return
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
        pushToast('error', msg); alert(`월세 영수증 PDF 생성 실패\n\n${msg}`); return
      }
      pushToast('success', '월세 영수증 발급됨 — 발급 이력으로 이동합니다')
      router.push('/rent-receipts')
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg); alert(`월세 영수증 PDF 생성 실패\n\n${msg}`)
    } finally { release(); setIssuing(false) }
  }

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'
  const Field = ({ label, k, placeholder }: { label: string; k: keyof Fields; placeholder?: string }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" value={f[k]} onChange={set(k)} placeholder={placeholder} className={inputCls} />
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/rent-receipts" className="text-sm text-[var(--coral)]">← 월세 영수증</Link>
          <button onClick={reset} className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--cream)]">자동값으로</button>
        </div>

        <div>
          <h1 className="text-lg font-bold text-[var(--warm-dark)]">월세 영수증 작성</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">외국인등록증 신청용. 자동으로 채워진 값을 확인·수정한 뒤 발급하세요.</p>
        </div>

        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--warm-mid)]">발행일</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
          </div>
          <Field label="이름 (호실)" k="nameRoom" placeholder="홍길동 (501호)" />
          <Field label="거주 기간" k="period" placeholder="2024. 8. 13 ~ 2026. 6. 15" />
          <Field label="금액 (월세)" k="amount" placeholder="390,000 원" />
          <Field label="수령인 이름 / 서명 (거주제공자)" k="recipientName" placeholder="김건우" />
          <Field label="수령인 연락처 (전화번호)" k="recipientPhone" placeholder="010-0000-0000" />
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">수령인 서명란엔 환경설정에 등록된 도장이 자동으로 들어갑니다.</p>
        </div>

        <div className="flex gap-2">
          <button onClick={handlePreview} disabled={previewing}
            className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--warm-border)] text-sm font-medium text-[var(--warm-dark)] bg-[var(--cream)] disabled:opacity-60">
            {previewing ? '여는 중…' : '미리보기·인쇄'}
          </button>
          <button onClick={handleIssue} disabled={issuing}
            className="flex-1 px-3 py-2.5 rounded-xl bg-[var(--coral)] text-white text-sm font-semibold disabled:opacity-60">
            {issuing ? '발급 중…' : '발급 (PDF 저장)'}
          </button>
        </div>
      </div>
    </div>
  )
}
