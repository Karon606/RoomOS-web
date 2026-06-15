'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ResidenceCertData } from './actions'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

const fmtDot = (d: string) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  if (!y) return d
  return `${y}. ${Number(m)}. ${Number(dd)}`
}

const issueDateLabel = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : d
}

type Fields = {
  siteAddress: string
  areaM2: string
  tenantName: string
  tenantAddress: string
  tenantBirth: string
  tenantPhone: string
  periodText: string
  rentText: string
  depositText: string
  landlordBusinessName: string
  landlordName: string
  landlordAddress: string
  landlordBirth: string
  landlordRegistrationNo: string
  landlordPhone: string
  submitTo: string
}

function buildInitial(data: ResidenceCertData): Fields {
  // 거주기간 — 시작은 입주일, 끝은 퇴실 예정일이 있으면 그것, 없으면 오늘 날짜로 채움(편집·삭제 가능).
  const start = fmtDot(data.periodStart)
  const end = fmtDot(data.periodEnd || kstYmdStr())
  return {
    siteAddress: data.siteAddress,
    areaM2: data.areaM2,
    tenantName: data.tenantName,
    tenantAddress: data.tenantAddress,
    tenantBirth: fmtDot(data.tenantBirth),
    tenantPhone: data.tenantPhone,
    periodText: start ? `${start}  ~  ${end}` : end,
    rentText: data.rentAmount ? data.rentAmount.toLocaleString() : '',
    depositText: data.depositAmount ? data.depositAmount.toLocaleString() : '',
    landlordBusinessName: data.landlordBusinessName,
    landlordName: data.landlordName,
    landlordAddress: data.landlordAddress,
    landlordBirth: data.landlordBirth,
    landlordRegistrationNo: data.landlordRegistrationNo,
    landlordPhone: data.landlordPhone,
    submitTo: data.submitTo,
  }
}

export default function ResidenceCertView({ data }: { data: ResidenceCertData }) {
  const router = useRouter()
  const [f, setF] = useState<Fields>(() => buildInitial(data))
  const [issueDate, setIssueDate] = useState(kstYmdStr())
  const upd = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  // ── 모바일 횡스크롤 방지: 210mm 종이를 viewport 폭에 맞춰 scale ──
  const paperRef = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(1)
  const [paperHeight, setPaperHeight] = useState<number | null>(null)
  const PAPER_W_PX = 210 * 3.7795275591

  useEffect(() => {
    const calc = () => {
      const SIDE_PADDING = 12
      const available = window.innerWidth - SIDE_PADDING * 2
      setScale(Math.min(1, available / PAPER_W_PX))
    }
    calc()
    window.addEventListener('resize', calc)
    window.addEventListener('orientationchange', calc)
    return () => {
      window.removeEventListener('resize', calc)
      window.removeEventListener('orientationchange', calc)
    }
  }, [PAPER_W_PX])

  useLayoutEffect(() => {
    const node = paperRef.current
    if (!node) return
    const update = () => setPaperHeight(node.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [f])

  const handlePrint = () => window.print()

  const reset = async () => {
    if (!(await confirmDialog({ title: '자동값으로 되돌릴까요?', message: '직접 수정한 내용이 모두 사라지고 시스템 자동값으로 복원됩니다.', confirmLabel: '되돌리기', level: 'caution' }))) return
    setF(buildInitial(data))
    setIssueDate(kstYmdStr())
    pushToast('info', '자동값으로 되돌렸습니다')
  }

  const [issuing, setIssuing] = useState(false)
  const handleIssue = async () => {
    if (!(await confirmDialog({ title: '실거주 확인서를 발급할까요?', message: '도장이 합성된 PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.', confirmLabel: '발급' }))) return
    setIssuing(true)
    const release = trackSave()
    try {
      const res = await fetch('/api/residence-cert/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: data.tenantId,
          leaseTermId: data.leaseTermId,
          fields: { ...f, issueDate },
        }),
      })
      const text = await res.text()
      let json: { ok: boolean; error?: string } | null = null
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok || !json?.ok) {
        const msg = json?.error ?? `서버 오류 (${res.status}): ${text.slice(0, 200)}`
        pushToast('error', msg)
        alert(`실거주 확인서 PDF 생성 실패\n\n${msg}`)
        return
      }
      pushToast('success', '실거주 확인서 발급됨 — 발급 이력으로 이동합니다')
      router.push('/residence-certs')
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg)
      alert(`실거주 확인서 PDF 생성 실패\n\n${msg}`)
    } finally {
      release()
      setIssuing(false)
    }
  }

  return (
    <div className="rc-shell">
      {/* 화면 전용 툴바 — 인쇄 시 숨김 */}
      <div className="no-print rc-toolbar">
        <Link href="/residence-certs" className="rc-link">← 실거주 확인서</Link>
        <div className="rc-spacer" />
        <label className="rc-field">
          <span>작성일</span>
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
        </label>
        <button onClick={reset} className="rc-btn-secondary">자동값으로</button>
        <button onClick={handlePrint} className="rc-btn-secondary">인쇄</button>
        <button onClick={handleIssue} disabled={issuing} className="rc-issue">
          {issuing ? '발급 중... (5~15초)' : '발급 (PDF 저장)'}
        </button>
      </div>

      <p className="no-print rc-hint">모든 칸을 직접 수정할 수 있습니다. 자동으로 채워진 값이 틀리면 그대로 고쳐서 발급하세요.</p>

      {/* A4 1장 — 모바일에선 scale로 viewport에 맞춤 (인쇄 시는 원본) */}
      <div
        className="rc-cage"
        style={{
          ['--paper-scale' as string]: scale,
          ['--paper-h' as string]: paperHeight != null ? `${paperHeight}px` : '297mm',
        }}
      >
        <main ref={paperRef} className="rc-paper">
          <div className="rc-outer">
            <h1 className="rc-doc-title">실거주 확인서</h1>

            <table className="rc-form">
              <colgroup><col style={{ width: '18%' }} /><col style={{ width: '14%' }} /><col /></colgroup>
              <tbody>
                <tr className="rc-row">
                  <th>소 재 지</th>
                  <td colSpan={2}>
                    <div className="rc-site">
                      <input className="rc-in rc-site-addr" value={f.siteAddress} onChange={upd('siteAddress')} />
                      <span className="rc-area">(※ 면적 : <input className="rc-in rc-area-in" value={f.areaM2} onChange={upd('areaM2')} /> ㎡)</span>
                    </div>
                  </td>
                </tr>
                <tr className="rc-row">
                  <th rowSpan={4}>임 차 인</th>
                  <th>성 명</th>
                  <td><input className="rc-in" value={f.tenantName} onChange={upd('tenantName')} /></td>
                </tr>
                <tr className="rc-row"><th>주 소</th><td><input className="rc-in" value={f.tenantAddress} onChange={upd('tenantAddress')} /></td></tr>
                <tr className="rc-row"><th>생년월일</th><td><input className="rc-in" value={f.tenantBirth} onChange={upd('tenantBirth')} /></td></tr>
                <tr className="rc-row"><th>연 락 처</th><td><input className="rc-in" value={f.tenantPhone} onChange={upd('tenantPhone')} /></td></tr>
                <tr className="rc-row">
                  <th colSpan={2}>거 주 기 간</th>
                  <td>
                    <div className="rc-period">
                      <input className="rc-in" value={f.periodText} onChange={upd('periodText')} placeholder="2026. 1. 1  ~  2026. 7. 1" />
                      <span className="rc-muted">* (최소 1개월 기재)</span>
                    </div>
                  </td>
                </tr>
                <tr className="rc-row">
                  <th colSpan={2}>임 대 료</th>
                  <td>
                    <div className="rc-rent">
                      <span>월</span>
                      <input className="rc-in rc-amount" value={f.rentText} onChange={upd('rentText')} />
                      <span>원 (보증금 :</span>
                      <input className="rc-in rc-amount" value={f.depositText} onChange={upd('depositText')} />
                      <span>원)</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="rc-confirm">위 임차인이 상기와 같이 거주하고 있음을 확인합니다.</p>

            <p className="rc-issue-date">{issueDateLabel(issueDate)}</p>

            <div className="rc-landlord">
              <p className="rc-landlord-head">임 대 인(확인)</p>
              <div className="rc-lrow"><span className="rc-llabel">상 호 :</span><input className="rc-in rc-lvalue" value={f.landlordBusinessName} onChange={upd('landlordBusinessName')} /></div>
              <div className="rc-lrow">
                <span className="rc-llabel">성 명 :</span>
                <span className="rc-lvalue rc-stamp-slot">
                  <input className="rc-in rc-lname" value={f.landlordName} onChange={upd('landlordName')} />
                  <span className="rc-seal">
                    <span className="rc-seal-mark" style={data.stampImageUrl ? { visibility: 'hidden' } : undefined}>(인)</span>
                    {data.stampImageUrl && <img className="rc-seal-img" src={data.stampImageUrl} alt="도장" />}
                  </span>
                </span>
              </div>
              <div className="rc-lrow"><span className="rc-llabel">주 소 :</span><input className="rc-in rc-lvalue" value={f.landlordAddress} onChange={upd('landlordAddress')} /></div>
              <div className="rc-lrow"><span className="rc-llabel">생 년 월 일 :</span><input className="rc-in rc-lvalue" value={f.landlordBirth} onChange={upd('landlordBirth')} /></div>
              <div className="rc-lrow"><span className="rc-llabel">(사업자등록번호) :</span><input className="rc-in rc-lvalue" value={f.landlordRegistrationNo} onChange={upd('landlordRegistrationNo')} /></div>
              <div className="rc-lrow"><span className="rc-llabel">연 락 처 :</span><input className="rc-in rc-lvalue" value={f.landlordPhone} onChange={upd('landlordPhone')} /></div>
            </div>

            <p className="rc-submit-to"><input className="rc-in rc-submit-in" value={f.submitTo} onChange={upd('submitTo')} /></p>

            <p className="rc-warning">다른 사람의 인장 도용 등 허위로 확인서를 작성하여 신청할 경우에는 「형법」 제231조와 제232조에 따라 사문서 위조ㆍ변조죄로 5년 이하의 징역 또는 1천만 원 이하의 벌금에 처하게 됩니다.</p>
          </div>
        </main>
      </div>

      <style jsx global>{`
        html, body {
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          background: #efeae0;
        }
        body { margin: 0; }

        .rc-shell { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 16px 0 40px; }

        .rc-toolbar {
          position: sticky; top: 8px; z-index: 5;
          width: min(210mm, 100% - 24px);
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: #fff; border: 1px solid #e7dfd1; border-radius: 12px;
          margin-bottom: 10px; flex-wrap: wrap; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        .rc-link { color: #a03c2e; font-size: 13px; text-decoration: none; }
        .rc-spacer { flex: 1; }
        .rc-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6258; }
        .rc-field input { padding: 4px 8px; border: 1px solid #e7dfd1; border-radius: 6px; font-size: 12px; }
        .rc-issue { padding: 6px 14px; background: #a03c2e; color: #fff; border: 0; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .rc-issue:disabled { opacity: 0.6; }
        .rc-btn-secondary { padding: 6px 12px; background: #fff; color: #1a1a1a; border: 1px solid #d6cdbb; border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer; }
        .rc-hint { width: min(210mm, 100% - 24px); font-size: 12px; color: #8a7f70; margin: 0 0 12px; }

        .rc-cage { width: calc(210mm * var(--paper-scale, 1)); height: calc(var(--paper-h, 297mm) * var(--paper-scale, 1)); margin: 0 auto; position: relative; }

        .rc-paper {
          position: absolute; top: 0; left: 0;
          transform: scale(var(--paper-scale, 1)); transform-origin: top left;
          width: 210mm; min-height: 297mm; background: #fff; color: #1a1a1a;
          padding: 14mm; box-shadow: 0 6px 24px rgba(0,0,0,0.12);
          font-size: 10.5pt; line-height: 1.5;
        }
        .rc-outer { border: 1.5px solid #1a1a1a; padding: 7mm 6mm; min-height: calc(297mm - 28mm); }

        .rc-doc-title { text-align: center; font-size: 19pt; font-weight: 700; letter-spacing: 8px; margin: 2mm 0 6mm; }

        .rc-form { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
        .rc-form th, .rc-form td { border: 1px solid #1a1a1a; padding: 4px 8px; vertical-align: middle; }
        .rc-form th { font-weight: 500; text-align: center; white-space: nowrap; letter-spacing: 2px; }
        .rc-row { height: 32px; }

        .rc-in { width: 100%; border: 0; background: transparent; font: inherit; color: inherit; padding: 1px 2px; outline: none; }
        .rc-in:focus { background: #fff6e0; border-radius: 3px; }
        .rc-in-mark { white-space: nowrap; }

        .rc-site { display: flex; align-items: center; gap: 6px; }
        .rc-site-addr { flex: 1; }
        .rc-area { white-space: nowrap; color: #1a1a1a; }
        .rc-area-in { width: 60px; text-align: right; display: inline-block; }
        .rc-period { display: flex; align-items: center; gap: 8px; }
        .rc-muted { color: #777; white-space: nowrap; font-size: 9.5pt; }
        .rc-rent { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
        .rc-amount { width: 90px; text-align: right; display: inline-block; }

        .rc-confirm { margin: 9mm 0 0; }
        .rc-issue-date { text-align: center; margin: 7mm 0 8mm; }

        .rc-landlord-head { margin: 0 0 3mm; }
        .rc-lrow { display: flex; align-items: center; margin: 0 0 1.5mm; padding-left: 7mm; }
        .rc-llabel { display: inline-block; width: 36mm; letter-spacing: 1px; flex: 0 0 36mm; }
        .rc-lvalue { flex: 1; }
        .rc-stamp-slot { display: flex; align-items: center; gap: 2mm; }
        .rc-lname { width: 40mm; flex: 0 0 auto; }
        .rc-seal { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 16mm; height: 16mm; }
        .rc-seal-img { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 15mm; height: 15mm; object-fit: contain; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

        .rc-submit-to { text-align: right; margin: 6mm 0 0; }
        .rc-submit-in { width: 60mm; text-align: right; display: inline-block; font-weight: 700; font-size: 12pt; }

        .rc-warning { margin-top: 8mm; border-top: 1px solid #1a1a1a; padding-top: 3mm; font-size: 8.5pt; line-height: 1.45; }

        @media print {
          html, body { background: #fff !important; }
          .rc-shell { display: block !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .rc-cage { width: auto !important; height: auto !important; }
          .rc-paper {
            position: static !important; transform: none !important;
            width: 100% !important; min-height: auto !important;
            padding: 0 !important; box-shadow: none !important;
          }
          .rc-in:focus { background: transparent !important; }
          .rc-form, .rc-landlord, .rc-warning { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}
