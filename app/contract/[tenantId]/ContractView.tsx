'use client'

import { useState, useMemo, useEffect, useTransition, useRef, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ContractData } from './actions'
import { saveContractOverride, resetContractOverride } from './actions'
import { renderContractText, type ContractTemplate, type ContractSection } from '@/lib/contract'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

export default function ContractView({ data }: { data: ContractData }) {
  const router = useRouter()
  const today = kstYmdStr()
  const [signDate, setSignDate]       = useState(today)
  const [signatureName, setSignatureName] = useState(data.tenant.name ?? '')
  const [smoking, setSmoking]         = useState('비흡연')
  const [emergencyContactText, setEmergencyContactText] = useState(() => {
    if (data.tenant.emergencyContacts.length === 0) return ''
    return data.tenant.emergencyContacts
      .map(c => [c.phone, c.relation].filter(Boolean).join(' / '))
      .join(', ')
  })

  // 편집 모드 + 작업본 (저장 전까지 props.data.template과 분리)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState<ContractTemplate>(data.template)
  // props가 갱신되면(서버 리프레시 후) draft도 동기화
  useEffect(() => { setDraft(data.template) }, [data.template])
  const [pending, startTransition] = useTransition()

  // ── 모바일 횡스크롤 방지: 210mm 종이를 viewport 폭에 맞춰 scale ──
  // 인쇄 시에는 @media print 에서 scale 1로 리셋되므로 실제 출력은 영향 없음
  const paperRef = useRef<HTMLElement>(null)
  const [scale, setScale]       = useState(1)
  const [paperHeight, setPaperHeight] = useState<number | null>(null)
  const PAPER_W_PX = 210 * 3.7795275591  // 210mm in CSS px (≈ 793.7)

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

  // 종이 실제 높이 측정 → cage 높이 = 측정값 × scale (편집 모드 진입·내용 변화 시 갱신)
  useLayoutEffect(() => {
    const node = paperRef.current
    if (!node) return
    const update = () => setPaperHeight(node.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [editing, draft, data])

  // 호실: 숫자만이면 '호' 자동 부착, 외수 문자가 섞이면 그대로
  const roomNoLabel = (() => {
    const v = data.lease?.roomNo
    if (!v) return ''
    return /^\d+$/.test(v.trim()) ? `${v.trim()}호` : v
  })()

  // 보증금/청소비 동적 표기
  // 둘 다 0/없음     → 라벨 '입실 보증금 (Deposit)' / 값 ''
  // 보증금만 있음    → 라벨 '입실 보증금 (Deposit)' / 값 'X원'
  // 보증금+청소비    → 라벨 '입실 보증금 (Deposit)' / 값 'X원 (중 청소비 Y원)'
  // 청소비만 있음    → 라벨 '청소비 (Cleaning Fee)'  / 값 'Y원'
  const depositRow = (() => {
    const dep = data.lease?.depositAmount ?? 0
    const cln = data.lease?.cleaningFee   ?? 0
    if (dep === 0 && cln > 0) {
      return { label: '청소비 (Cleaning Fee)', value: `${cln.toLocaleString()}원` }
    }
    if (dep > 0 && cln > 0) {
      return { label: '입실 보증금 (Deposit)', value: `${dep.toLocaleString()}원 (중 청소비 ${cln.toLocaleString()}원)` }
    }
    if (dep > 0) {
      return { label: '입실 보증금 (Deposit)', value: `${dep.toLocaleString()}원` }
    }
    return { label: '입실 보증금 (Deposit)', value: '' }
  })()

  // 변수 치환 맵 — 본문 섹션 내 {{key}} 자리 자동 채움
  const vars = useMemo<Record<string, string>>(() => ({
    name:             data.tenant.name ?? '',
    phone:            data.tenant.primaryPhone ?? '',
    birth:            fmtDate(data.tenant.birthdate),
    job:              data.tenant.job ?? '',
    gender:           data.tenant.gender ?? '',
    smoking:          smoking,
    deposit:          data.lease ? data.lease.depositAmount.toLocaleString() : '',
    checkInDate:      fmtDate(data.lease?.moveInDate ?? null),
    checkOutDate:     fmtDate(data.lease?.expectedMoveOut ?? null),
    roomNo:           roomNoLabel,
    rentFee:          data.lease ? data.lease.rentAmount.toLocaleString() : '',
    emergencyContact: emergencyContactText,
  }), [data, smoking, emergencyContactText, roomNoLabel])

  const handlePrint = () => window.print()

  const handleSaveOverride = () => {
    if (!data.lease?.id) {
      pushToast('error', '저장할 계약이 없습니다.')
      return
    }
    const leaseId = data.lease.id
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await saveContractOverride(leaseId, draft)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '이 입실자 계약서로 저장됨')
        setEditing(false)
        router.refresh()
      } finally { release() }
    })
  }

  const handleResetOverride = () => {
    if (!data.lease?.id) return
    if (!confirm('이 입실자 계약서를 영업장 공통 템플릿으로 되돌릴까요?\n\n현재 입실자에게 저장된 수정 내용은 사라집니다.')) return
    const leaseId = data.lease.id
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await resetContractOverride(leaseId)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '공통 템플릿으로 되돌림')
        setEditing(false)
        router.refresh()
      } finally { release() }
    })
  }

  // 편집 도우미
  const updateSection = (idx: number, patch: Partial<ContractSection>) => {
    setDraft(t => ({ ...t, sections: t.sections.map((s, i) => i === idx ? { ...s, ...patch } : s) }))
  }
  const moveSection = (idx: number, dir: -1 | 1) => {
    setDraft(t => {
      const next = [...t.sections]
      const j = idx + dir
      if (j < 0 || j >= next.length) return t
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return { ...t, sections: next }
    })
  }
  const removeSection = (idx: number) => {
    if (!confirm('이 섹션을 삭제할까요?')) return
    setDraft(t => ({ ...t, sections: t.sections.filter((_, i) => i !== idx) }))
  }
  const addSection = () => {
    setDraft(t => ({
      ...t,
      sections: [...t.sections, {
        id: `s${Date.now()}`,
        title: `${t.sections.length + 1}. 새 섹션`,
        items: ['- '],
      }],
    }))
  }

  // 서명일은 yyyy-MM-dd → "yyyy년 M월 d일"
  const signDateLabel = (() => {
    const [y, m, d] = signDate.split('-').map(Number)
    return Number.isFinite(y) ? `${y}년 ${m}월 ${d}일` : signDate
  })()

  // ── 서명 패드 모달 ──────────────────────────────────────────────
  const [signOpen, setSignOpen]       = useState(false)
  // 캡처된 서명 PNG dataURL — 화면 서명란에 즉시 표시.
  // #8: 이전에 저장된 앱서명이 있으면 초기값으로 불러와 표시(출력 시 (인) 대신 서명 보이게).
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(data.lease?.signatureImageUrl ?? null)
  const sigCanvasRef = useRef<HTMLCanvasElement>(null)
  const sigPadRef    = useRef<import('signature_pad').default | null>(null)

  // 패드 마운트 / 사이즈 (DPR 보정)
  useEffect(() => {
    if (!signOpen || !sigCanvasRef.current) return
    let pad: import('signature_pad').default | null = null
    const canvas = sigCanvasRef.current
    const setupCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      canvas.width = canvas.offsetWidth * ratio
      canvas.height = canvas.offsetHeight * ratio
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(ratio, ratio)
      pad?.clear()
    }
    import('signature_pad').then(({ default: SignaturePad }) => {
      pad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        penColor: '#1a1a1a',
        minWidth: 0.7,
        maxWidth: 2.4,
      })
      sigPadRef.current = pad
      setupCanvas()
    })
    window.addEventListener('resize', setupCanvas)
    return () => {
      window.removeEventListener('resize', setupCanvas)
      pad?.off()
      sigPadRef.current = null
    }
  }, [signOpen])

  // 모달 "확인" — 서명만 화면 상태에 반영. PDF 저장은 별도 버튼에서.
  const handleSignConfirm = () => {
    const pad = sigPadRef.current
    if (!pad || pad.isEmpty()) {
      pushToast('error', '서명을 입력해주세요.')
      return
    }
    setSignatureDataUrl(pad.toDataURL('image/png'))
    setSignOpen(false)
    pushToast('info', '서명 적용됨 — 확인 후 \'계약서 저장\' 을 눌러주세요')
  }

  // 툴바 "계약서 저장" — PDF 생성 + Drive 업로드 + 입실자 정보로 이동
  const [contractSaving, setContractSaving] = useState(false)
  const handleContractSave = async () => {
    if (!signatureDataUrl) {
      pushToast('error', '먼저 서명을 받아주세요.')
      return
    }
    if (!confirm('이 계약서를 PDF로 저장하시겠습니까?\n\n· 도장·로고·서명이 합성된 PDF가 Google Drive에 업로드됩니다.\n· 입실자 정보의 \'계약서 파일\' 에 자동 첨부됩니다.')) return
    setContractSaving(true)
    const release = trackSave()
    try {
      const res = await fetch('/api/contract/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: data.tenant.id,
          signDate,
          signatureName,
          signatureImageDataUrl: signatureDataUrl,
          smoking,
          emergencyContactText,
        }),
      })
      const text = await res.text()
      let json: { ok: boolean; error?: string } | null = null
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok || !json?.ok) {
        const msg = json?.error ?? `서버 오류 (${res.status}): ${text.slice(0, 200)}`
        pushToast('error', msg)
        alert(`계약서 PDF 생성 실패\n\n${msg}`)
        return
      }
      pushToast('success', '계약서 저장됨 — 입실자 정보로 이동합니다')
      router.push(`/tenants?tenantId=${data.tenant.id}&tab=info`)
    } catch (err) {
      const msg = (err as Error).message ?? 'PDF 생성 실패'
      pushToast('error', msg)
      alert(`계약서 PDF 생성 실패\n\n${msg}`)
    } finally {
      release()
      setContractSaving(false)
    }
  }

  // 출력에 쓰일 활성 템플릿 — 편집 중이면 draft, 아니면 props
  const view = editing ? draft : data.template

  return (
    <div className="contract-shell">
      {/* 화면 전용 툴바 — 인쇄 시 숨김 */}
      <div className="no-print toolbar">
        <Link href={`/tenants?tenantId=${data.tenant.id}`} className="toolbar-link">← 입실자 정보</Link>
        <div className="toolbar-spacer" />
        {!editing && (
          <>
            <label className="toolbar-field">
              <span>서명일</span>
              <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} />
            </label>
            <label className="toolbar-field">
              <span>흡연</span>
              <select value={smoking} onChange={e => setSmoking(e.target.value)}>
                <option value="비흡연">비흡연</option>
                <option value="흡연">흡연</option>
              </select>
            </label>
            <button onClick={() => setEditing(true)} className="toolbar-btn-secondary">
              본문 편집
            </button>
            {data.hasOverride && (
              <button onClick={handleResetOverride} disabled={pending} className="toolbar-btn-secondary toolbar-btn-warn">
                공통 템플릿으로
              </button>
            )}
            <button onClick={handlePrint} className="toolbar-btn-secondary">인쇄</button>
            {!signatureDataUrl ? (
              <button onClick={() => setSignOpen(true)} className="toolbar-print">서명 받기</button>
            ) : (
              <>
                <button onClick={() => setSignOpen(true)} className="toolbar-btn-secondary">서명 다시</button>
                <button onClick={handleContractSave} disabled={contractSaving} className="toolbar-print">
                  {contractSaving ? '저장 중... (5~15초)' : '계약서 저장'}
                </button>
              </>
            )}
          </>
        )}
        {editing && (
          <>
            <span className="toolbar-status">편집 중 — 이 입실자 전용으로 저장됩니다</span>
            <button onClick={() => { setDraft(data.template); setEditing(false) }} disabled={pending} className="toolbar-btn-secondary">
              취소
            </button>
            <button onClick={handleSaveOverride} disabled={pending} className="toolbar-print">
              {pending ? '저장 중...' : '저장'}
            </button>
          </>
        )}
        {data.hasOverride && !editing && (
          <span className="toolbar-badge">개별 수정본</span>
        )}
      </div>

      {/* 인쇄 영역 — A4 1장. 모바일에선 scale로 viewport에 맞춤 (인쇄 시는 원본) */}
      <div
        className="paper-cage"
        style={{
          ['--paper-scale' as string]: scale,
          ['--paper-h' as string]: paperHeight != null ? `${paperHeight}px` : '297mm',
        }}
      >
      <main ref={paperRef} className="contract-paper">
        <header className="contract-header">
          <div className="contract-header-logo">
            {data.logoImageUrl && (
              <img src={data.logoImageUrl} alt="영업장 로고" className="contract-logo-img" />
            )}
          </div>
          <h1 className="contract-title">{view.title}</h1>
          <div className="contract-header-spacer" />
        </header>

        {/* 입실자 정보 표 */}
        <table className="info-table">
          <colgroup>
            <col style={{ width: '23%' }} />
            <col style={{ width: '27%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '27%' }} />
          </colgroup>
          <tbody>
            <tr>
              <th>성명 (Name)</th>
              <td>{data.tenant.name}</td>
              <th>연락처 (Mobile)</th>
              <td>{data.tenant.primaryPhone ?? ''}</td>
            </tr>
            <tr>
              <th>생년월일 (Birth Date)</th>
              <td>{fmtDate(data.tenant.birthdate)}</td>
              <th>직업 (Job)</th>
              <td>{data.tenant.job ?? ''}</td>
            </tr>
            <tr>
              <th>성별 (Gender)</th>
              <td>{data.tenant.gender}</td>
              <th>흡연 여부 (Smoking)</th>
              <td>{smoking}</td>
            </tr>
            <tr>
              <th>{depositRow.label}</th>
              <td>{depositRow.value}</td>
              <th>입실일 (Check-in)</th>
              <td>{fmtDate(data.lease?.moveInDate ?? null)}</td>
            </tr>
            <tr>
              <th>호실 (Room No.)</th>
              <td>{roomNoLabel}</td>
              <th>퇴실 예정일 (Check-out)</th>
              <td>{fmtDate(data.lease?.expectedMoveOut ?? null)}</td>
            </tr>
            <tr>
              <th>입실료 (Rent Fee)</th>
              <td>{data.lease ? `${data.lease.rentAmount.toLocaleString()}원` : ''}</td>
              <th>전입신고 유무</th>
              <td>{data.lease?.registrationStatus ?? '미신고'}</td>
            </tr>
          </tbody>
        </table>

        {/* 비상 연락망 안내 */}
        {view.emergencyContactNote && (
          <p className="emergency-note">
            {view.emergencyContactNote}{' '}
            <span className="emergency-input-screen no-print">
              <input
                type="text"
                value={emergencyContactText}
                onChange={e => setEmergencyContactText(e.target.value)}
                placeholder="이름/전화번호/관계"
              />
            </span>
            <span className="only-print">{emergencyContactText}</span>
          </p>
        )}

        {/* 본문 섹션 — editing 중엔 인라인 편집 가능 */}
        <div className="sections">
          {!editing && view.sections.map(sec => (
            <section key={sec.id} className="section">
              <p className="section-title">{renderContractText(sec.title, vars)}</p>
              {sec.items.map((item, i) => (
                <p key={i} className="section-item">{renderContractText(item, vars)}</p>
              ))}
            </section>
          ))}
          {editing && draft.sections.map((sec, idx) => (
            <div key={sec.id} className="section section-edit no-print-edit">
              <div className="section-edit-toolbar no-print">
                <input
                  type="text"
                  value={sec.title}
                  onChange={e => updateSection(idx, { title: e.target.value })}
                  className="section-edit-title"
                />
                <button type="button" onClick={() => moveSection(idx, -1)} disabled={idx === 0} className="section-edit-btn">↑</button>
                <button type="button" onClick={() => moveSection(idx, 1)} disabled={idx === draft.sections.length - 1} className="section-edit-btn">↓</button>
                <button type="button" onClick={() => removeSection(idx)} className="section-edit-btn section-edit-btn-danger">삭제</button>
              </div>
              <textarea
                value={sec.items.join('\n')}
                onChange={e => updateSection(idx, { items: e.target.value.split('\n') })}
                rows={Math.max(3, sec.items.length)}
                className="section-edit-textarea"
              />
            </div>
          ))}
          {editing && (
            <button type="button" onClick={addSection} className="section-add-btn no-print">
              + 섹션 추가
            </button>
          )}
        </div>

        {/* 서약 + 서명란 */}
        <div className="oath">
          {editing ? (
            <input
              type="text"
              value={draft.oathText}
              onChange={e => setDraft(t => ({ ...t, oathText: e.target.value }))}
              className="oath-edit no-print"
            />
          ) : (
            <p className="oath-text">{renderContractText(view.oathText, vars)}</p>
          )}
          <div className="signature-row">
            <span className="signature-date">{signDateLabel}</span>
            <span className="signature-name no-print">
              <input type="text" value={signatureName} onChange={e => setSignatureName(e.target.value)} />
            </span>
            <span className="only-print">{signatureName}</span>
            {signatureDataUrl ? (
              <span className="signature-image-wrap">
                <img src={signatureDataUrl} alt="서명" className="signature-image" />
                <button
                  type="button"
                  onClick={() => setSignatureDataUrl(null)}
                  className="signature-clear no-print"
                  title="서명 지우기"
                >✕</button>
              </span>
            ) : (
              <span className="signature-stamp">(인)</span>
            )}
          </div>
        </div>

        {/* 사업자 정보 + 도장 — 도장은 우측에 flex로 자리잡아 줄바꿈 방지 */}
        <div className="business-block">
          <div className="business-info">
            <div className="business-line">
              상호: {data.businessInfo.name}
              {data.businessInfo.registrationNo && ` / 사업자번호 ${data.businessInfo.registrationNo}`}
              {data.businessInfo.ceoName && ` / 대표 ${data.businessInfo.ceoName}`}
            </div>
            {data.businessInfo.address && (
              <div className="business-line">사업장 주소: {data.businessInfo.address}</div>
            )}
          </div>
          <div className="business-stamp">
            {data.stampImageUrl ? (
              <img src={data.stampImageUrl} alt="도장" className="business-stamp-image" />
            ) : (
              <span className="business-stamp-marker">(인)</span>
            )}
          </div>
        </div>

        {/* 우측 하단 이스터에그 — Brand Guide 정식 워드마크(SVG) 사용 */}
        <div className="made-with" aria-label="Made with 스테이음">
          <span className="made-with-prefix">Made with</span>
          <StayeumWordmark height={11} className="made-with-wm" />
        </div>
      </main>
      </div>

      {/* 서명 받기 모달 — 아이패드/모바일에서 입실자 손글씨 서명 캡처 */}
      {signOpen && (
        <div className="sig-overlay no-print" onClick={() => setSignOpen(false)}>
          <div className="sig-modal" onClick={e => e.stopPropagation()}>
            <div className="sig-head">
              <div>
                <div className="sig-title">입실자 서명</div>
                <div className="sig-sub">아래 영역에 서명해주세요. 확인을 누르면 계약서에 서명이 표시됩니다 (PDF 저장은 다음 단계).</div>
              </div>
              <button onClick={() => setSignOpen(false)} className="sig-close" aria-label="닫기">✕</button>
            </div>
            <div className="sig-canvas-wrap">
              <canvas ref={sigCanvasRef} className="sig-canvas" />
              <div className="sig-baseline" />
            </div>
            <div className="sig-actions">
              <button onClick={() => sigPadRef.current?.clear()} className="toolbar-btn-secondary">
                지우기
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setSignOpen(false)} className="toolbar-btn-secondary">
                취소
              </button>
              <button onClick={handleSignConfirm} className="toolbar-print">
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 인쇄/화면 공통 스타일 */}
      <style jsx global>{`
        /* 글로벌 html/body overflow:hidden 을 이 라우트에선 해제 (스크롤 가능하도록).
           좌우는 hidden — scale로 viewport에 맞췄어도 포함된 layout box 안전장치 */
        html, body {
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          background: #efeae0;
        }
        body { margin: 0; }

        .contract-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 16px 0 40px;
        }

        /* 툴바 — 화면 전용 */
        .toolbar {
          position: sticky;
          top: 8px;
          z-index: 5;
          width: min(210mm, 100% - 24px);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: #fff;
          border: 1px solid #e7dfd1;
          border-radius: 12px;
          margin-bottom: 14px;
          flex-wrap: wrap;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        .toolbar-link { color: #e84a1a; font-size: 13px; text-decoration: none; }
        .toolbar-spacer { flex: 1; }
        .toolbar-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6258; }
        .toolbar-field input, .toolbar-field select {
          padding: 4px 8px; border: 1px solid #e7dfd1; border-radius: 6px; font-size: 12px;
        }
        .toolbar-print {
          padding: 6px 14px; background: #e84a1a; color: #fff; border: 0;
          border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;
        }
        .toolbar-print:disabled { opacity: 0.6; }
        .toolbar-btn-secondary {
          padding: 6px 12px; background: #fff; color: #1a1a1a; border: 1px solid #d6cdbb;
          border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer;
        }
        .toolbar-btn-warn { color: #b85a30; border-color: #f3c8b5; }
        .toolbar-status { font-size: 12px; color: #b85a30; font-weight: 600; }
        .toolbar-badge {
          padding: 3px 8px; background: #fff5ed; color: #b85a30; border: 1px solid #f3c8b5;
          border-radius: 999px; font-size: 11px; font-weight: 600;
        }

        /* paper-cage: 화면용 viewport-fit wrapper.
           cage 자체는 (210mm × paperHeight) × scale 크기로 layout 자리를 차지하고,
           안의 .contract-paper 는 원본 사이즈 그대로 유지하면서 transform: scale 로 시각 축소. */
        .paper-cage {
          width: calc(210mm * var(--paper-scale, 1));
          height: calc(var(--paper-h, 297mm) * var(--paper-scale, 1));
          margin: 0 auto;
          position: relative;
        }

        /* 인쇄 영역 — A4 1장. 화면에선 padding으로 종이 느낌, 인쇄에선 @page margin이 처리 */
        .contract-paper {
          position: absolute;          /* cage 안쪽 좌상단 고정 */
          top: 0;
          left: 0;
          transform: scale(var(--paper-scale, 1));
          transform-origin: top left;
          width: 210mm;
          min-height: 297mm;
          padding: 14mm 16mm;
          background: #fff;
          color: #1a1a1a;
          font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
          font-size: 9pt;
          line-height: 1.45;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          box-sizing: border-box;
        }

        /* Made with 스테이음 — 콘텐츠 끝에 우측 정렬로 흐름 배치.
           paper 강제 page-height 시 빈 2페이지가 생겨서 흐름 배치로 회피.
           본문이 거의 페이지를 채우므로 시각적으로 footer 효과 동일. */
        .made-with {
          margin-top: 14pt;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 5px;
          /* SVG 워드마크 안 ink/persimmon CSS var는 약간 톤 다운해 이스터에그 톤 유지 */
          --ink: #4a4a4a;
          --persimmon: #e84a1a;
        }
        .made-with-prefix {
          font-family: 'DM Mono', 'Pretendard', monospace;
          font-size: 6.5pt;
          letter-spacing: 0.04em;
          color: #b8b0a3;
          font-weight: 500;
        }
        .made-with-wm {
          opacity: 0.78; /* 너무 튀지 않게 살짝 죽임 */
        }

        /* 헤더 — 좌측 로고 슬롯 / 중앙 제목 / 우측 빈공간으로 제목을 페이지 정중앙에 정렬 */
        .contract-header {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 6mm;
          margin-bottom: 10px;
        }
        .contract-header-logo {
          justify-self: start;
          height: 14mm;
          max-width: 50mm;
          display: flex;
          align-items: center;
        }
        .contract-logo-img {
          max-height: 14mm;
          max-width: 50mm;
          width: auto;
          height: auto;
          object-fit: contain;
          opacity: 0.6;       /* 헤더 워터마크 톤 — 본문에 시선이 먼저 가도록 살짝 톤다운 */
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .contract-header-spacer { /* 우측 가짜 컬럼 — 제목 정중앙 정렬용 */ }

        .contract-title {
          text-align: center;
          font-size: 13pt;
          font-weight: 700;
          text-decoration: underline;
          margin: 0;
          white-space: nowrap;
        }

        .info-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9pt;
        }
        .info-table th, .info-table td {
          border: 1px solid #1a1a1a;
          padding: 4px 6px;
          text-align: center;
          vertical-align: middle;
          height: 22px;
        }
        .info-table th { background: #fafafa; font-weight: 500; }

        .emergency-note {
          margin: 10px 0 6px;
          padding-left: 36pt;
          font-size: 9pt;
        }
        .emergency-input-screen input {
          padding: 2px 8px; font-size: 9pt; border: 1px dashed #999; border-radius: 4px; min-width: 240px;
        }

        .sections { margin-top: 8pt; }
        .section { margin-bottom: 9pt; }
        /* 소제목 — 왼쪽 끝에 붙여서 위계가 한눈에 보이게 */
        .section-title { margin: 0 0 3pt 0; font-weight: 700; font-size: 9pt; }
        /* 항목 — 소제목 아래로 들여쓰기. text-indent: -10pt 로 hanging indent →
           '-' 글머리는 약간 왼쪽으로 튀어나오고, 줄바꿈된 본문은 들여쓴 위치에 맞춰 정렬 */
        .section-item {
          margin: 0 0 1pt 0;
          padding-left: 14pt;
          text-indent: -10pt;
          font-size: 9pt;
          white-space: pre-line;
        }

        /* 편집 모드 */
        .section-edit {
          border: 1px dashed #d6cdbb;
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 10px;
          background: #fffaf2;
        }
        .section-edit-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
        .section-edit-title {
          flex: 1; padding: 4px 8px; border: 1px solid #d6cdbb; border-radius: 6px;
          font-size: 9pt; font-weight: 700; background: #fff;
        }
        .section-edit-btn {
          padding: 3px 8px; font-size: 11px; border: 1px solid #d6cdbb; border-radius: 6px;
          background: #fff; cursor: pointer; color: #6b6258;
        }
        .section-edit-btn:disabled { opacity: 0.3; }
        .section-edit-btn-danger { color: #c4452b; border-color: #f3c8b5; }
        .section-edit-textarea {
          width: 100%; min-height: 80px; padding: 6px 8px; border: 1px solid #d6cdbb;
          border-radius: 6px; font-size: 9pt; font-family: inherit; line-height: 1.5;
          background: #fff; resize: vertical;
        }
        .section-add-btn {
          width: 100%; padding: 8px; border: 1px dashed #e84a1a; color: #e84a1a;
          background: transparent; border-radius: 8px; font-size: 12px; cursor: pointer;
          margin-top: 6px;
        }
        .oath-edit {
          width: 100%; max-width: 480px; padding: 4px 10px;
          border: 1px solid #d6cdbb; border-radius: 6px; text-align: center;
          font-size: 9pt; font-weight: 700; margin: 0 0 6pt;
        }

        .oath { margin-top: 12pt; text-align: center; }
        .oath-text { font-weight: 700; font-size: 9pt; margin: 0 0 6pt; }
        .signature-row {
          display: inline-flex; align-items: center; gap: 10px;
          font-weight: 700; font-size: 9pt;
        }
        .signature-name input {
          padding: 0 4px; font-size: 9pt; border: 0;
          width: 6em; text-align: center;
        }
        .signature-image-wrap {
          display: inline-flex; align-items: center; position: relative;
          padding: 0 4px;
        }
        .signature-image {
          height: 11mm; width: auto; max-width: 50mm;
          object-fit: contain;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .signature-clear {
          margin-left: 4px; width: 18px; height: 18px;
          border-radius: 50%; border: 1px solid #d6cdbb; background: #fff;
          color: #6b6258; font-size: 11px; cursor: pointer; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .signature-clear:hover { color: #c4452b; border-color: #f3c8b5; }
        .only-print { display: none; }

        .business-block {
          margin-top: 14pt;
          font-size: 9pt;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6mm;
          flex-wrap: nowrap;
        }
        .business-info { text-align: center; flex: 0 1 auto; min-width: 0; }
        .business-line { margin-bottom: 2pt; white-space: normal; }
        .business-stamp {
          flex: 0 0 auto;
          width: 14mm;
          height: 14mm;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .business-stamp-image {
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
          /* 인쇄·PDF에서도 도장 색이 빠지지 않도록 강제 */
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .business-stamp-marker { font-weight: 600; }

        /* ── 서명 모달 ──────────────────────────────────────────── */
        .sig-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .sig-modal {
          width: 100%; max-width: 640px;
          background: #fff; border-radius: 16px; padding: 18px 18px 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          display: flex; flex-direction: column; gap: 14px;
        }
        .sig-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .sig-title { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .sig-sub { font-size: 12px; color: #6b6258; line-height: 1.5; }
        .sig-close { width: 32px; height: 32px; border: 0; background: transparent; color: #6b6258; font-size: 18px; cursor: pointer; border-radius: 8px; }
        .sig-close:hover { background: #f3eee5; }
        .sig-canvas-wrap {
          position: relative; width: 100%; aspect-ratio: 16 / 7;
          background: #fbf6ee; border: 1px dashed #d6cdbb; border-radius: 12px;
          touch-action: none; /* 모바일에서 스크롤로 가로채지 않도록 */
        }
        .sig-canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
        .sig-baseline {
          position: absolute; left: 12%; right: 12%; bottom: 22%;
          border-top: 1px dashed #d6cdbb; pointer-events: none;
        }
        .sig-actions { display: flex; align-items: center; gap: 8px; }

        /* ── 인쇄 전용 ─────────────────────────────────────────── */
        /* iPad/iOS Safari 호환을 위해 @page margin 을 작게 (Safari가 자체 마진을
           추가하더라도 1장 안에 들어가도록). 데스크톱 브라우저는 @page margin 그대로 따름. */
        @page {
          size: A4;
          /* 상단 16mm: 브라우저 머리말 옵션 흡수
             우측 18mm: 표 우측 테두리/콘텐츠가 프린터 비인쇄 영역에 살짝 걸리는
                       문제 방지 (대부분 가정용 프린터 우측 비인쇄 ~5mm)
             하단 12mm: 꼬리말 흡수
             좌측 14mm: 표 좌측은 cell padding 으로 어차피 여유 */
          margin: 16mm 18mm 12mm 14mm;
        }
        @media print {
          html, body { background: #fff; overflow: visible !important; height: auto !important; }
          .contract-shell { padding: 0; min-height: auto; }
          .no-print { display: none !important; }
          .only-print { display: inline !important; }
          /* 인쇄 시: cage 레이아웃 완전 우회 — display:contents 로 cage box 제거.
             contract-paper 가 contract-shell 의 직접 자식처럼 동작 → cage 의 width/height/
             position 잔여 영향 zero */
          .contract-shell {
            display: block !important;
            align-items: stretch !important;
          }
          .paper-cage {
            display: contents !important;
          }
          .contract-paper {
            position: static !important;
            top: auto !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            transform: none !important;
            transform-origin: 0 0 !important;
            box-shadow: none;
            width: 100% !important;            /* @page 콘텐츠 영역 전체 사용 */
            max-width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            page-break-after: avoid;
            page-break-inside: avoid;
            font-size: 8pt;
            line-height: 1.32;
          }
          /* 헤더 — grid 레이아웃 유지 (로고 좌측, 제목 중앙). cage 우회 후엔 안전 */
          .contract-header { margin-bottom: 4pt !important; }
          .contract-header-logo { height: 10mm !important; }
          .contract-logo-img { max-height: 10mm !important; }
          .contract-title { font-size: 12pt !important; margin: 0 !important; }
          .sections { margin-top: 5pt !important; }
          .section { margin-bottom: 6pt !important; }
          .section-title { margin-bottom: 2pt !important; }
          .oath { margin-top: 8pt !important; }
          .oath-text { margin-bottom: 4pt !important; }
          .business-block { margin-top: 8pt !important; gap: 4mm !important; }
          .business-line { margin-bottom: 1pt !important; }
          .made-with { margin-top: 8pt !important; }
          .emergency-note { margin: 6px 0 4px !important; }
          .info-table th, .info-table td { padding: 2px 6px !important; height: auto !important; }
          /* 페이지 split 금지 — 핵심 묶음 보존 */
          .section, .info-table, .oath, .business-block, .emergency-note { page-break-inside: avoid; }
          .section-item { page-break-inside: avoid; }     /* 항목 한 줄이 페이지 사이로 잘리지 않게 */
          /* 서약 → 서명 → 사업자정보 → Made with 를 한 묶음으로 보존 (2장 가도 마지막에 같이 감) */
          .oath { page-break-after: avoid !important; }
          .business-block { page-break-before: avoid !important; page-break-after: avoid !important; }
          .made-with { page-break-before: avoid !important; page-break-inside: avoid !important; }
          /* 단락 widow/orphan — 페이지 끝/시작 최소 2줄 보장 */
          body { widows: 2; orphans: 2; }
          /* 도장·로고 — 인쇄에서도 색상 그대로 */
          .business-stamp-image, .contract-logo-img, .signature-image, img {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  )
}
