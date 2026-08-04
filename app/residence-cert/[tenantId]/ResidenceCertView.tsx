'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ResidenceCertData } from './actions'
import { RC_PAGE, RC_TEXT_FIELDS, RC_ISSUE_GAPS, RC_STAMP } from '@/lib/residenceCertLayout'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn, btnClass } from '@/components/ui/Btn'
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

  // 디자인 폭(595.3pt)을 viewport 에 맞춰 scale.
  // 상한 4/3 은 '종이가 실물 A4 폭을 넘지 않는다' 는 뜻이다 — 793.7(A4 를 CSS px 로) / 595.3(pt) = 4/3.
  // 종전 1.4 는 실물의 1.05배였다. 계약서 상한 1 과 달라 보였지만 단위(px 대 pt)가 달랐을 뿐
  // 실제 차이는 5% 였다. 근거 없는 상수를 없애고 두 화면이 같은 규칙을 쓰게 한다.
  // 가독성은 상한이 아니라 핀치줌이 맡는다. 모바일에서는 어차피 상한 근처에도 못 간다.
  const [scale, setScale] = useState(1)
  useEffect(() => {
    // 폭은 layout viewport 로 잰다 — window.innerWidth 는 iOS 에서 핀치에 줄어들어 확대를 상쇄한다
    const calc = () => setScale(Math.min(4 / 3, (document.documentElement.clientWidth - 24) / RC_PAGE.w))
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

  const docFileName = `${data.tenantName}_실거주확인서`

  const payload = () => ({ tenantId: data.tenantId, leaseTermId: data.leaseTermId, fields: { ...f, issueDate } })


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
        {/* 사진 저장은 '저장 및 보내기'가 흡수했다(§30.4, 운영자 확정 6). 그쪽이 형식을 먼저 묻고
            사진을 고르면 전 페이지를 그리므로 기능이 줄지 않고 다페이지 유실만 사라진다.
            1단계 다음 커밋에서 이 툴바를 상단 크롬 + 하단 액션바로 나눈다. */}
        <Btn variant="secondary" size="md" onClick={reset}>자동값으로</Btn>
        <SendDocButton getPdfBytes={fetchPreviewBytes} fileName={docFileName} className={btnClass('secondary', 'md')} />
        <Btn variant="primary" size="md" onClick={handleIssue} disabled={issuing}>
          {issuing ? '발급 중…' : '발급'}
        </Btn>
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

        /* 흐름 안에 둔다 — 핀치줌이 열린 화면에서 sticky 는 확대 시 시야 밖으로 밀린다(신고 d9f93bdd) */
        .rc-toolbar {
          width: min(595px, 100% - 24px);
          display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: var(--cream); border: 1px solid var(--warm-border); border-radius: 10px; margin-bottom: 10px;
          flex-wrap: wrap; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        .rc-link { color: var(--tc-text); font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
        .rc-spacer { flex: 1; }
        .rc-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-s); }
        .rc-field input { padding: 4px 8px; border: 1px solid var(--warm-border); border-radius: 6px; font-size: 12px; }
        .rc-issue { padding: 6px 14px; background: var(--coral); color: var(--on-solid); border: 0; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .rc-issue:disabled { opacity: 0.6; }
        .rc-btn-secondary { padding: 6px 12px; background: var(--cream); color: var(--ink); border: 1px solid var(--warm-border); border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer; }
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

        /* 인쇄 — 종전에는 .rc-shell 을 통째로 display:none 해서 **백지가 나왔다**.
           c0eb9c4(6/15)가 이 화면을 좌표 캔버스로 갈아엎으면서 이전 인쇄 오버라이드를 새 구조로
           옮기지 못했다. 좌표 단위가 pt(595.3 x 841.9)라 그대로 인쇄하면 A4 의 75% 자리에 작게 찍힌다.
           그 배율 문제를 푸는 대신 화면을 껐고, 인쇄 진입점이 없어 아무도 눈치채지 못했다.
           96/72 = 4/3 이 pt 를 실물 A4 로 되돌리는 정확한 값이다. */
        @media print {
          @page { size: A4; margin: 0; }
          .rc-shell { min-height: 0; padding: 0; display: block; }
          /* 상자를 A4 로 못 박는다. 자동 높이로 두면 확대된 내용이 흐름 높이를 넘어 2장으로 갈린다 */
          .rc-cage { width: 210mm !important; height: 297mm !important; }
          .rc-page { transform: scale(${4 / 3}) !important; box-shadow: none; }
          /* 양식·도장은 배경 이미지라 색 강제가 없으면 통째로 빠지고 타이핑한 값만 뜬다 — 백지의 두 번째 얼굴 */
          .rc-bg, .rc-stamp, .rc-stamp-cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* 커서가 있던 칸만 노란 박스로 찍히는 것을 막는다 */
          .rc-in:hover, .rc-in:focus { background: transparent !important; }
        }
      `}</style>
    </div>
  )
}
