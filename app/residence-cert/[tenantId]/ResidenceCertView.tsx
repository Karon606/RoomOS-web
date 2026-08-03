'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ResidenceCertData } from './actions'
import { RC_PAGE, RC_TEXT_FIELDS, RC_ISSUE_GAPS, RC_STAMP } from '@/lib/residenceCertLayout'
import { canShareFiles, sharePdfFile, pdfFileName } from '@/lib/docPreview'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { SaveDocImageButton } from '@/components/ui/SaveDocImageButton'
import { SendDocButton } from '@/components/ui/SendDocButton'

const fmtDot = (d: string) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  if (!y) return d
  return `${y}. ${Number(m)}. ${Number(dd)}`
}

type Fields = {
  siteAddress: string; areaM2: string
  tenantName: string; tenantAddress: string; tenantBirth: string; tenantPhone: string
  periodText: string; rentText: string; depositText: string
  landlordBusinessName: string; landlordName: string; landlordAddress: string
  landlordIdNo: string; landlordPhone: string
}

function buildInitial(data: ResidenceCertData): Fields {
  const start = fmtDot(data.periodStart)
  const end = fmtDot(data.periodEnd || kstYmdStr())
  return {
    siteAddress: data.siteAddress, areaM2: data.areaM2,
    tenantName: data.tenantName, tenantAddress: data.tenantAddress,
    tenantBirth: fmtDot(data.tenantBirth), tenantPhone: data.tenantPhone,
    periodText: start ? `${start}  ~  ${end}` : end,
    rentText: data.rentAmount ? data.rentAmount.toLocaleString() : '',
    depositText: data.depositAmount ? data.depositAmount.toLocaleString() : '',
    landlordBusinessName: data.landlordBusinessName, landlordName: data.landlordName,
    landlordAddress: data.landlordAddress, landlordIdNo: data.landlordIdNo,
    landlordPhone: data.landlordPhone,
  }
}

// PDF baseline(원점 좌하단) → CSS top(원점 좌상단, 디자인 단위 = pt). 베이스라인 근사 보정.
const topOf = (y: number, size: number) => (RC_PAGE.h - y) - size * 1.04

export default function ResidenceCertView({ data }: { data: ResidenceCertData }) {
  const router = useRouter()
  const [f, setF] = useState<Fields>(() => buildInitial(data))
  const [issueDate, setIssueDate] = useState(kstYmdStr())
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  // 디자인 폭(595.3pt)을 viewport 에 맞춰 scale (최대 1.4배까지 확대해 가독성 확보)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const calc = () => setScale(Math.min(1.4, (window.innerWidth - 24) / RC_PAGE.w))
    calc()
    window.addEventListener('resize', calc)
    window.addEventListener('orientationchange', calc)
    return () => { window.removeEventListener('resize', calc); window.removeEventListener('orientationchange', calc) }
  }, [])

  const reset = async () => {
    if (!(await confirmDialog({ title: '자동값으로 되돌릴까요?', message: '직접 수정한 내용이 모두 사라지고 시스템 자동값으로 복원됩니다.', confirmLabel: '되돌리기', level: 'caution' }))) return
    setF(buildInitial(data)); setIssueDate(kstYmdStr())
    pushToast('info', '자동값으로 되돌렸습니다')
  }

  const payload = () => ({ tenantId: data.tenantId, leaseTermId: data.leaseTermId, fields: { ...f, issueDate } })

  const [previewing, setPreviewing] = useState(false)
  const handlePrint = async () => {
    if (previewing) return
    setPreviewing(true)
    // 터치 기기는 공유 시트로 넘긴다 — standalone 앱에서 새 탭은 돌아올 길이 없다(lib/docPreview).
    // 데스크톱은 종전대로. 팝업 차단 회피: 제스처 시점에 빈 새 탭을 먼저 열고 준비되면 주입.
    const useShare = canShareFiles()
    const win = useShare ? null : window.open('', '_blank')
    try {
      const res = await fetch('/api/residence-cert/generate', {
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
      if (useShare && await sharePdfFile(blob, pdfFileName('실거주 확인서', data.tenantName, issueDate), '실거주 확인서')) return
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else if (!window.open(url, '_blank')) {
        // 공유가 안 되는 기기인데 새 탭도 막혔다 — 여기서 조용히 끝나면 화면 무반응이 된다
        pushToast('error', '미리보기를 열지 못했습니다', { detail: '팝업 차단을 해제한 뒤 다시 시도해 주세요.' })
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      win?.close()
      pushToast('error', (err as Error).message ?? '미리보기 생성에 실패했습니다.')
    } finally { setPreviewing(false) }
  }

  // 현재 입력값 그대로 '보내기' — 사진/PDF 형식 선택(SendDocButton 정본), preview PDF 바이트 사용.
  const fetchPreviewBytes = async () => {
    const res = await fetch('/api/residence-cert/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload(), preview: true }),
    })
    if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
    return res.arrayBuffer()
  }

  const hasStamp = !!data.stampImageUrl
  const [issuing, setIssuing] = useState(false)
  const handleIssue = async () => {
    const issueMsg = hasStamp
      ? '도장이 합성된 PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.'
      : '영업장 도장이 등록되지 않아 도장 없이 발급됩니다. PDF가 Google Drive에 저장되고 발급 이력에 추가됩니다.'
    if (!(await confirmDialog({ title: '실거주 확인서를 발급할까요?', message: issueMsg, confirmLabel: '발급' }))) return
    setIssuing(true)
    const release = trackSave()
    try {
      const res = await fetch('/api/residence-cert/generate', {
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
      pushToast('success', '실거주 확인서 발급됨. 발급 이력으로 이동합니다')
      router.push('/residence-certs')
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg)
    } finally { release(); setIssuing(false) }
  }

  // 작성일 분해 (인쇄된 '20 년 월 일' 빈칸 표시)
  const dm = issueDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const issueParts: Record<string, string> = dm
    ? { yy: dm[1].slice(2), mm: String(Number(dm[2])), dd: String(Number(dm[3])) }
    : { yy: '', mm: '', dd: '' }

  const fv = f as unknown as Record<string, string>

  return (
    <div className="rc-shell">
      {/* 폰트 — 출력 PDF(나눔고딕)와 동일하게 */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap" />

      <div className="no-print rc-toolbar">
        <Link href="/residence-certs" className="rc-link">‹ 실거주 확인서</Link>
        <div className="rc-spacer" />
        <label className="rc-field"><span>작성일</span>
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
        </label>
        <button onClick={reset} className="rc-btn-secondary">자동값으로</button>
        <button onClick={handlePrint} disabled={previewing} className="rc-btn-secondary">
          {previewing ? '여는 중…' : '미리보기·인쇄'}
        </button>
        <SendDocButton getPdfBytes={fetchPreviewBytes} fileName={`${data.tenantName}_실거주확인서`} className="rc-btn-secondary" />
        {/* 현재 입력값 그대로 PNG 저장(공유 시트로 사진첩 저장, 신고 dc56f953) — preview PDF 를 래스터화 */}
        <SaveDocImageButton fileName={`${data.tenantName}_실거주확인서`} className="rc-btn-secondary"
          getPdfBytes={async () => {
            const res = await fetch('/api/residence-cert/generate', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload(), preview: true }),
            })
            if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
            return res.arrayBuffer()
          }} />
        <button onClick={handleIssue} disabled={issuing} className="rc-issue">
          {issuing ? '발급 중…' : '발급 (PDF 저장)'}
        </button>
      </div>

      <p className="no-print rc-hint">원본 양식 위에 바로 입력합니다. 칸을 눌러 수정하세요. 보이는 그대로 발급됩니다.</p>

      {!hasStamp && (
        <p className="no-print rc-warn">영업장 도장이 등록되지 않아 도장 없이 발급됩니다. 영업장 설정에서 도장을 등록하세요.</p>
      )}

      <div className="rc-cage" style={{ width: RC_PAGE.w * scale, height: RC_PAGE.h * scale }}>
        <div className="rc-page" style={{ width: RC_PAGE.w, height: RC_PAGE.h, transform: `scale(${scale})` }}>
          {/* 원본 양식 배경 */}
          <img src="/forms/residence-cert-seoul-bg.png" alt="실거주 확인서 양식" className="rc-bg"
            style={{ width: RC_PAGE.w, height: RC_PAGE.h }} draggable={false} />

          {/* 인쇄된 빈칸(거주기간 '20 . . . ~ 20 . . .') 흰 박스로 덮기 — 입력칸 아래 */}
          {RC_TEXT_FIELDS.filter(field => field.cover).map(field => (
            <div key={field.key + '-cover'} className="rc-stamp-cover" style={{
              left: field.cover!.x, top: RC_PAGE.h - (field.cover!.y + field.cover!.h),
              width: field.cover!.w, height: field.cover!.h,
            }} />
          ))}

          {/* 입력칸 — 공유 좌표맵 */}
          {RC_TEXT_FIELDS.map(field => {
            const isRight = field.align === 'right'
            const isCenter = field.align === 'center'
            const left = isRight ? field.x - field.width : isCenter ? field.x - field.width / 2 : field.x
            return (
              <input key={field.key} type="text" value={fv[field.key] ?? ''} onChange={set(field.key as keyof Fields)}
                className="rc-in"
                style={{
                  left, top: topOf(field.y, field.size), width: field.width,
                  height: field.size * 1.5, fontSize: field.size, lineHeight: `${field.size * 1.5}px`,
                  textAlign: isRight ? 'right' : isCenter ? 'center' : 'left',
                }} />
            )
          })}

          {/* 작성일 빈칸 (작성일은 툴바에서 선택, 여기엔 표시) */}
          {RC_ISSUE_GAPS.map(g => (
            <span key={g.part} className="rc-gap"
              style={{ left: g.cx, top: topOf(g.y, g.size), fontSize: g.size, lineHeight: `${g.size * 1.5}px`, height: g.size * 1.5 }}>
              {issueParts[g.part]}
            </span>
          ))}

          {/* 도장 — (인) 위 흰 박스 + 도장 이미지 */}
          {data.stampImageUrl && (
            <>
              <div className="rc-stamp-cover" style={{
                left: RC_STAMP.cover.x, top: RC_PAGE.h - (RC_STAMP.cover.y + RC_STAMP.cover.h),
                width: RC_STAMP.cover.w, height: RC_STAMP.cover.h,
              }} />
              <img src={data.stampImageUrl} alt="도장" className="rc-stamp" draggable={false}
                style={{
                  left: RC_STAMP.cx - RC_STAMP.size / 2, top: RC_PAGE.h - (RC_STAMP.cy + RC_STAMP.size / 2),
                  width: RC_STAMP.size, height: RC_STAMP.size,
                }} />
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        html, body { overflow-x: hidden !important; overflow-y: auto !important; height: auto !important; background: #efeae0; }
        body { margin: 0; }
        .rc-shell { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 16px 0 48px; }

        .rc-toolbar {
          position: sticky; top: 8px; z-index: 5; width: min(595px, 100% - 24px);
          display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: var(--cream); border: 1px solid var(--cream-3); border-radius: 10px; margin-bottom: 10px;
          flex-wrap: wrap; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        .rc-link { color: var(--coral); font-size: 13px; text-decoration: none; }
        .rc-spacer { flex: 1; }
        .rc-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-s); }
        .rc-field input { padding: 4px 8px; border: 1px solid var(--cream-3); border-radius: 6px; font-size: 12px; }
        .rc-issue { padding: 6px 14px; background: var(--coral); color: var(--on-solid); border: 0; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .rc-issue:disabled { opacity: 0.6; }
        .rc-btn-secondary { padding: 6px 12px; background: var(--cream); color: var(--ink); border: 1px solid var(--cream-3); border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer; }
        .rc-btn-secondary:disabled { opacity: 0.6; }
        .rc-hint { width: min(595px, 100% - 24px); font-size: 12px; color: var(--ink-m); margin: 0 0 12px; }
        .rc-warn { width: min(595px, 100% - 24px); font-size: 12px; color: var(--warning-fg); background: var(--warning-bg); border: 1px solid var(--warning-ring); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; line-height: 1.5; }

        .rc-cage { margin: 0 auto; position: relative; }
        .rc-page {
          position: absolute; top: 0; left: 0; transform-origin: top left;
          background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,0.14);
          font-family: 'Nanum Gothic', 'Apple SD Gothic Neo', sans-serif;
        }
        .rc-bg { position: absolute; left: 0; top: 0; pointer-events: none; user-select: none; }

        .rc-in {
          position: absolute; border: 0; background: transparent; padding: 0; margin: 0;
          color: #1a1a1a; font-family: inherit; outline: none; box-sizing: border-box;
        }
        .rc-in:hover { background: rgba(160,60,46,0.06); border-radius: 2px; }
        .rc-in:focus { background: rgba(255,214,0,0.18); border-radius: 2px; }

        .rc-gap {
          position: absolute; transform: translateX(-50%); white-space: nowrap;
          color: #1a1a1a; font-family: inherit; pointer-events: none; text-align: center;
        }
        .rc-stamp-cover { position: absolute; background: #fff; pointer-events: none; }
        .rc-stamp { position: absolute; object-fit: contain; pointer-events: none; }

        @media print { .rc-shell { display: none !important; } }
      `}</style>
    </div>
  )
}
