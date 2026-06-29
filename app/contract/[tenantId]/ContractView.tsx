'use client'

import { useState, useMemo, useEffect, useTransition, useRef, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ContractData } from './actions'
import { saveContractOverride, resetContractOverride, setTenantSmoking } from './actions'
import { renderContractText, buildRefundClause, type ContractTemplate, type ContractSection } from '@/lib/contract'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

// 조항 항목 렌더 — 글머리('-'·'•'·'·') 제거 + **강조** → terracotta hl. (contractPrintHtml 와 동일 규칙)
function renderClauseItem(text: string): React.ReactNode {
  const stripped = text.replace(/^\s*[-–•·]\s?/, '')
  const parts = stripped.split(/\*\*(.+?)\*\*/g) // 짝수 idx=일반, 홀수 idx=강조
  return parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="hl">{p}</span> : p))
}

export default function ContractView({ data }: { data: ContractData }) {
  const router = useRouter()
  const today = kstYmdStr()
  const [signDate, setSignDate]       = useState(today)
  const [signatureName, setSignatureName] = useState(data.tenant.name ?? '')
  const [smoking, setSmoking]         = useState(data.tenant.smoking ? '흡연' : '비흡연')
  // 계약서에서 흡연 여부를 바꾸면 입실자(고객정보)에 즉시 저장 — 출력용 일회성이 아니라 영구 반영
  const handleSmokingChange = (v: string) => {
    setSmoking(v)
    setTenantSmoking(data.tenant.id, v === '흡연').then(res => {
      if (res.ok) pushToast('success', '흡연 여부 저장됨 (고객정보 반영)')
      else pushToast('error', res.error)
    })
  }
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
  const disposalRef = useRef<HTMLElement>(null)   // 동의서 종이(별도 cage) 높이 측정용
  const [scale, setScale]       = useState(1)
  const [paperHeight, setPaperHeight] = useState<number | null>(null)
  const [disposalHeight, setDisposalHeight] = useState<number | null>(null)
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

  // 동의서 종이(별도 cage) 높이 측정 — 활성화/서명/내용 변화 시 갱신
  useLayoutEffect(() => {
    const node = disposalRef.current
    if (!node) { setDisposalHeight(null); return }
    const update = () => setDisposalHeight(node.offsetHeight)
    update()
    const ro = new ResizeObserver(update)   // 서명 추가 등 내용 높이 변화는 옵저버가 잡음
    ro.observe(node)
    return () => ro.disconnect()
  }, [editing, draft, data])

  // 호실: 숫자만이면 '호' 자동 부착, 외수 문자가 섞이면 그대로
  const roomNoLabel = (() => {
    const v = data.lease?.roomNo
    if (!v) return ''
    return /^\d+$/.test(v.trim()) ? `${v.trim()}호` : v
  })()

  // 보증금/청소비 동적 표기 (§20 — 라벨 + 영문 + 값(청소비는 .sub))
  const { depositLabel, depositEn, depositNode } = (() => {
    const dep = data.lease?.depositAmount ?? 0
    const cln = data.lease?.cleaningFee ?? 0
    if (dep === 0 && cln > 0) return { depositLabel: '청소비', depositEn: 'Cleaning Fee', depositNode: `${cln.toLocaleString()}원` as React.ReactNode }
    if (dep > 0 && cln > 0)   return { depositLabel: '입실 보증금', depositEn: 'Deposit', depositNode: <>{dep.toLocaleString()}원<span className="sub"> (중 청소비 {cln.toLocaleString()}원)</span></> }
    if (dep > 0)              return { depositLabel: '입실 보증금', depositEn: 'Deposit', depositNode: `${dep.toLocaleString()}원` as React.ReactNode }
    return { depositLabel: '입실 보증금', depositEn: 'Deposit', depositNode: '' as React.ReactNode }
  })()

  // 헤더/푸터 영업장 메타 (§20)
  const biz = data.businessInfo
  const bizMeta1 = [biz.registrationNo ? `사업자등록번호 ${biz.registrationNo}` : '', biz.ceoName ? `대표 ${biz.ceoName}` : ''].filter(Boolean).join(' · ')
  const bizMeta2 = [biz.address || '', data.phone ? data.phone : ''].filter(Boolean).join(' · ')

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
    환불규정:          data.refundClauseInContract ? ' ' + buildRefundClause() : '',
  }), [data, smoking, emergencyContactText, roomNoLabel])

  // 잔여 소지품 임의처분 동의서 — 본문 변수(한글 키)
  const dcVars: Record<string, string> = {
    성명: data.tenant.name, 호실: roomNoLabel, 연락처: data.tenant.primaryPhone ?? '',
    미납일수: String(data.disposalConsent.days), 영업장명: biz.name || '', 대표: biz.ceoName || '',
  }

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

  const handleResetOverride = async () => {
    if (!data.lease?.id) return
    if (!(await confirmDialog({ title: '이 입실자 계약서를 영업장 공통 템플릿으로 되돌릴까요?', message: '현재 입실자에게 저장된 수정 내용은 사라집니다.', level: 'caution', confirmLabel: '되돌리기' }))) return
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
  const removeSection = async (idx: number) => {
    if (!(await confirmDialog({ title: '이 섹션을 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
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
  // 동의서(잔여 소지품 임의처분)는 별도 서명 — 같은 패드 모달을 target 으로 구분해 재사용.
  // 저장된 동의서 서명(disposalSignatureImageUrl)이 있으면 불러와 표시(입실계약서 서명과 동일하게 영구 보존).
  const [disposalSignatureDataUrl, setDisposalSignatureDataUrl] = useState<string | null>(data.lease?.disposalSignatureImageUrl ?? null)
  const [signTarget, setSignTarget] = useState<'contract' | 'disposal'>('contract')
  const openSign = (target: 'contract' | 'disposal') => { setSignTarget(target); setSignOpen(true) }
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
    const url = pad.toDataURL('image/png')
    setSignOpen(false)
    if (signTarget === 'disposal') {
      setDisposalSignatureDataUrl(url)
      pushToast('info', '동의서 서명 적용됨 — 확인 후 \'계약서 저장\' 을 눌러주세요')
    } else {
      setSignatureDataUrl(url)
      pushToast('info', '서명 적용됨 — 확인 후 \'계약서 저장\' 을 눌러주세요')
    }
  }

  // 툴바 "계약서 저장" — PDF 생성 + Drive 업로드 + 입실자 정보로 이동
  const [contractSaving, setContractSaving] = useState(false)
  const handleContractSave = async () => {
    if (!signatureDataUrl) {
      pushToast('error', '먼저 서명을 받아주세요.')
      return
    }
    if (!(await confirmDialog({ title: '이 계약서를 PDF로 저장할까요?', message: "도장·로고·서명이 합성된 PDF가 Google Drive에 업로드되고, 입실자 정보의 '계약서 파일'에 자동 첨부됩니다.", confirmLabel: '저장' }))) return
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
          disposalSignatureImageDataUrl: disposalSignatureDataUrl ?? '',
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
            {/* 흡연 여부는 아래 '입실자 정보' 표의 항목에서 직접 선택 (#4) */}
            <button onClick={() => setEditing(true)} className="toolbar-btn-secondary">
              본문 편집
            </button>
            {data.hasOverride && (
              <button onClick={handleResetOverride} disabled={pending} className="toolbar-btn-secondary toolbar-btn-warn">
                공통 템플릿으로
              </button>
            )}
            <button onClick={handlePrint} className="toolbar-btn-secondary">인쇄</button>
            {/* 서명은 본문 하단 서명란을 직접 눌러서 — 계약서를 끝까지 본 뒤 서명하도록 유도(상단 즉시서명 버튼 제거) */}
            {signatureDataUrl && (
              <button onClick={handleContractSave} disabled={contractSaving} className="toolbar-print">
                {contractSaving ? '저장 중... (5~15초)' : '계약서 저장'}
              </button>
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

      {/* 인쇄 영역. 모바일에선 scale로 viewport에 맞춤 (인쇄 시는 원본) */}
      <div
        className="paper-cage"
        style={{
          ['--paper-scale' as string]: scale,
          ['--paper-h' as string]: paperHeight != null ? `${paperHeight}px` : '297mm',
        }}
      >
      <main ref={paperRef} className="contract-paper">
        {/* 헤더 */}
        <div className="doc-header">
          <div className="biz">
            <div className="biz-logo">
              {data.logoImageUrl && <img src={data.logoImageUrl} alt="로고" />}
            </div>
            <div>
              <div className="biz-name">{biz.name || ''}</div>
              <div className="biz-meta">{bizMeta1}{bizMeta1 && bizMeta2 ? <br /> : null}{bizMeta2}</div>
            </div>
          </div>
          <div className="issue">작성일 {signDateLabel}</div>
        </div>
        <div className="tc-rule" />

        {/* 제목 */}
        <div className="doc-title-row">
          <div className="doc-title">{view.title}</div>
          <div className="doc-title-en">Residence Agreement</div>
        </div>

        {/* 정보 표 */}
        <table className="info">
          <tbody>
            <tr>
              <th>성명<span className="en">Name</span></th><td>{data.tenant.name}</td>
              <th>연락처<span className="en">Mobile Phone</span></th><td className="num">{data.tenant.primaryPhone ?? ''}</td>
            </tr>
            <tr>
              <th>생년월일<span className="en">Date of Birth</span></th><td className="num">{fmtDate(data.tenant.birthdate)}</td>
              <th>성별<span className="en">Gender</span></th><td>{data.tenant.gender}</td>
            </tr>
            <tr>
              <th>흡연 여부<span className="en">Smoking</span></th>
              <td>
                <select className="no-print smoke-select" value={smoking} onChange={e => handleSmokingChange(e.target.value)}
                  style={{ font: 'inherit', color: 'inherit', border: '1px solid #d6cdbb', borderRadius: 4, padding: '1px 4px', background: '#fff', cursor: 'pointer' }}>
                  <option value="비흡연">비흡연</option>
                  <option value="흡연">흡연</option>
                </select>
                <span className="only-print">{smoking}</span>
              </td>
              <th>전입신고<span className="en">Resident Reg.</span></th><td>{data.lease?.registrationStatus ?? '미신고'}</td>
            </tr>
            <tr>
              <th>호실<span className="en">Room Number</span></th><td className="num">{roomNoLabel}</td>
              <th>입실일<span className="en">Check-in</span></th><td className="num">{fmtDate(data.lease?.moveInDate ?? null)}</td>
            </tr>
            <tr>
              <th>퇴실 예정일<span className="en">Check-out</span></th><td className="num">{fmtDate(data.lease?.expectedMoveOut ?? null) || '—'}</td>
              <th>{depositLabel}<span className="en">{depositEn}</span></th><td className="amt">{depositNode}</td>
            </tr>
            <tr>
              <th>입실료<span className="en">Rent / month</span></th><td className="amt">{data.lease ? `${data.lease.rentAmount.toLocaleString()}원` : ''}</td>
              <th>매월 납부일<span className="en">Payment Day</span></th><td className="num">{data.lease?.dueDay ? (data.lease.dueDay.includes('말') ? '매월 말일' : `매월 ${parseInt(data.lease.dueDay, 10)}일`) : '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* 비상 연락망 — 화면 입력 / 인쇄 텍스트 */}
        <table className="emerg">
          <tbody>
            <tr>
              <th>비상 연락망<span className="en">Emergency Contact</span></th>
              <td>
                <span className="emerg-input no-print">
                  <input type="text" value={emergencyContactText}
                    onChange={e => setEmergencyContactText(e.target.value)}
                    placeholder={view.emergencyContactNote || '이름 / 전화번호 / 관계'} />
                </span>
                <span className="only-print">{emergencyContactText}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* 조항 — 보기: 2단 / 편집: 단일 인라인 편집 */}
        {!editing ? (
          <div className="clauses">
            {view.sections.map(sec => (
              <div key={sec.id} className="clause-group">
                <div className="clause-h">{renderContractText(sec.title, vars)}</div>
                <ul className="clause-list">
                  {sec.items.map((item, i) => (
                    <li key={i}>{renderClauseItem(renderContractText(item, vars))}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="clauses-edit no-print-edit">
            {draft.sections.map((sec, idx) => (
              <div key={sec.id} className="section-edit">
                <div className="section-edit-toolbar">
                  <input type="text" value={sec.title} onChange={e => updateSection(idx, { title: e.target.value })} className="section-edit-title" />
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
            <button type="button" onClick={addSection} className="section-add-btn">+ 섹션 추가</button>
          </div>
        )}

        {/* 서약 */}
        {editing ? (
          <input type="text" value={draft.oathText} onChange={e => setDraft(t => ({ ...t, oathText: e.target.value }))} className="pledge-edit no-print" />
        ) : (
          <div className="pledge">{renderContractText(view.oathText, vars)}</div>
        )}

        {/* 서명 */}
        <div className="sign-wrap">
          <div className="sign-date num">{signDateLabel}</div>
          <div className="sign-grid">
            <div className="sign-col">
              <div className="sign-role">임차인 (입주자)</div>
              <div className="sign-line">
                <span className="lbl">성명</span>
                <span className="signame-input no-print">
                  <input type="text" value={signatureName} onChange={e => setSignatureName(e.target.value)} />
                </span>
                <span className="val only-print">{signatureName}</span>
                <span className="seal-wrap">
                  {signatureDataUrl ? (
                    <>
                      <img className="sign-img" src={signatureDataUrl} alt="서명" onClick={() => openSign('contract')} style={{ cursor: 'pointer' }} title="다시 서명하려면 클릭" />
                      <button type="button" onClick={() => setSignatureDataUrl(null)} className="signature-clear no-print" title="서명 지우기">✕</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => openSign('contract')} className="no-print"
                        style={{ border: '1.5px dashed var(--coral, #a03c2e)', borderRadius: 6, padding: '6px 14px', color: 'var(--coral, #a03c2e)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        여기를 눌러 서명
                      </button>
                      <span className="seal-mark only-print">(서명)</span>
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="sign-col">
              <div className="sign-role">임대인 (사업자)</div>
              <div className="sign-line">
                <span className="lbl">대표</span>
                <span className="val">{biz.ceoName || ''}</span>
                <span className="seal-wrap">
                  {data.stampImageUrl ? (
                    <img className="seal-stamp" src={data.stampImageUrl} alt="도장" />
                  ) : (
                    <span className="seal-mark">(인)</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="doc-footer">
          <div className="foot-biz">
            <span className="nm">{biz.name || ''}</span>
            {biz.registrationNo ? ` · 사업자등록번호 ${biz.registrationNo}` : ''}
            {biz.ceoName ? ` · 대표 ${biz.ceoName}` : ''}
            {bizMeta2 ? <><br />{bizMeta2}</> : null}
          </div>
          <div className="wordmark">made with <span className="wm"><span className="wm-stay">stay</span><span className="wm-eum">eum</span></span></div>
        </div>
      </main>
      </div>
      {data.disposalConsent.enabled && (
      <div
        className="paper-cage disposal-cage"
        style={{
          ['--paper-scale' as string]: scale,
          ['--paper-h' as string]: disposalHeight != null ? `${disposalHeight}px` : '297mm',
        }}
      >
        <main ref={disposalRef} className="contract-paper disposal-paper">
          <div className="dc-title">{data.disposalConsent.title}</div>
          <div className="dc-sec-h">1. 입실자 정보</div>
          <table className="info dc-info"><tbody>
            <tr><th>성명<span className="en">Name</span></th><td>{data.tenant.name}</td></tr>
            <tr><th>호실<span className="en">Room</span></th><td className="num">{roomNoLabel}</td></tr>
            <tr><th>연락처<span className="en">Phone</span></th><td className="num">{data.tenant.primaryPhone ?? ''}</td></tr>
          </tbody></table>
          <div className="dc-sec-h">2. 동의 내용</div>
          <div className="dc-body">
            {data.disposalConsent.body.split('\n').map(p => p.trim()).filter(Boolean).map((p, i) => (
              <p key={i} className="dc-p">{renderContractText(p, dcVars)}</p>
            ))}
          </div>
          <div className="dc-date num">{signDateLabel}</div>
          <div className="dc-sign">
            <span className="dc-sign-lbl">동의자(입실자) 성명</span>
            <span className="dc-sign-line">{signatureName || data.tenant.name}</span>
            <span className="dc-sign-seal">
              {disposalSignatureDataUrl ? (
                <>
                  <img className="sign-img" src={disposalSignatureDataUrl} alt="동의서 서명" onClick={() => openSign('disposal')} style={{ cursor: 'pointer', height: '11mm', maxWidth: '38mm' }} title="다시 서명하려면 클릭" />
                  <button type="button" onClick={() => setDisposalSignatureDataUrl(null)} className="signature-clear no-print" title="서명 지우기">✕</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => openSign('disposal')} className="no-print"
                    style={{ border: '1.5px dashed var(--coral, #a03c2e)', borderRadius: 6, padding: '5px 12px', color: 'var(--coral, #a03c2e)', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    여기를 눌러 서명
                  </button>
                  <span className="only-print">(서명 또는 인)</span>
                </>
              )}
            </span>
          </div>
          <div className="dc-to">{biz.name || ''} 대표 귀하</div>
        </main>
      </div>
      )}

      {/* 서명 받기 모달 — 아이패드/모바일에서 입실자 손글씨 서명 캡처 */}
      {signOpen && (
        <div className="sig-overlay no-print" onClick={() => setSignOpen(false)}>
          <div className="sig-modal" onClick={e => e.stopPropagation()}>
            <div className="sig-head">
              <div>
                <div className="sig-title">{signTarget === 'disposal' ? '동의서 서명' : '입실자 서명'}</div>
                <div className="sig-sub">아래 영역에 서명해주세요. 확인을 누르면 {signTarget === 'disposal' ? '동의서' : '계약서'}에 서명이 표시됩니다 (PDF 저장은 다음 단계).</div>
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

      {/* 인쇄/화면 공통 스타일 — 브랜드 가이드 §20 입실 계약서 (contractPrintHtml 과 동일 시각) */}
      <style jsx global>{`
        html, body {
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          background: #E8DDD0;
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
          position: sticky; top: 8px; z-index: 5;
          width: min(210mm, 100% - 24px);
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: #fff;
          border: 1px solid #e7dfd1; border-radius: 12px;
          margin-bottom: 14px; flex-wrap: wrap;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        .toolbar-link { color: #a03c2e; font-size: 13px; text-decoration: none; }
        .toolbar-spacer { flex: 1; }
        .toolbar-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6258; }
        .toolbar-field input, .toolbar-field select { padding: 4px 8px; border: 1px solid #e7dfd1; border-radius: 6px; font-size: 12px; }
        .toolbar-print { padding: 6px 14px; background: #a03c2e; color: #fff; border: 0; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .toolbar-print:disabled { opacity: 0.6; }
        .toolbar-btn-secondary { padding: 6px 12px; background: #fff; color: #1a1a1a; border: 1px solid #d6cdbb; border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer; }
        .toolbar-btn-warn { color: #b85a30; border-color: #f3c8b5; }
        .toolbar-status { font-size: 12px; color: #b85a30; font-weight: 600; }
        .toolbar-badge { padding: 3px 8px; background: #fff5ed; color: #b85a30; border: 1px solid #f3c8b5; border-radius: 999px; font-size: 11px; font-weight: 600; }

        /* paper-cage: 화면용 viewport-fit wrapper */
        .paper-cage {
          width: calc(210mm * var(--paper-scale, 1));
          height: calc(var(--paper-h, 297mm) * var(--paper-scale, 1));
          margin: 0 auto; position: relative;
        }

        /* ── §20 종이 ─────────────────────────────────────────────── */
        .contract-paper {
          position: absolute; top: 0; left: 0;
          transform: scale(var(--paper-scale, 1)); transform-origin: top left;
          width: 210mm; min-height: 297mm; padding: 11mm 18mm;
          background: #fff; color: var(--p-ink);
          font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
          word-break: keep-all; box-sizing: border-box;
          box-shadow: 0 4px 24px -6px rgba(61,36,24,.28);
          display: flex; flex-direction: column;
          --p-ink: #1F1A17; --p-muted: #6B5D4F; --p-tc: #A03C2E;
          --p-label-bg: #F2ECE3; --p-rule: #D8CFC4; --p-rule-strong: #9A8A78; --p-amt-bg: #FCFAF6;
        }
        .contract-paper .num { font-variant-numeric: tabular-nums; }

        /* 헤더 */
        .contract-paper .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 3.5mm; gap: 6mm; }
        .contract-paper .biz { display: flex; gap: 4mm; align-items: flex-start; }
        .contract-paper .biz-logo { width: 13mm; height: 13mm; border: 0.6pt solid var(--p-rule); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .contract-paper .biz-logo img { max-width: 11mm; max-height: 11mm; width: auto; height: auto; object-fit: contain; }
        .contract-paper .biz-name { font-size: 13pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; margin-bottom: 1mm; }
        .contract-paper .biz-meta { font-size: 8pt; color: var(--p-muted); line-height: 1.5; }
        .contract-paper .issue { text-align: right; font-size: 8pt; color: var(--p-ink); font-weight: 500; line-height: 1.65; flex-shrink: 0; white-space: nowrap; }
        .contract-paper .tc-rule { height: 1.6pt; background: var(--p-tc); margin-bottom: 4mm; }

        /* 제목 */
        .contract-paper .doc-title-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4mm; }
        .contract-paper .doc-title { font-size: 21pt; font-weight: 700; letter-spacing: -.03em; }
        .contract-paper .doc-title-en { font-size: 9pt; color: var(--p-muted); font-weight: 500; letter-spacing: .02em; }

        /* 정보 표 */
        .contract-paper .info { width: 100%; border-collapse: collapse; border: 0.6pt solid var(--p-rule-strong); margin-bottom: 3mm; }
        .contract-paper .info tr { height: 7.4mm; }
        .contract-paper .info th { width: 30mm; background: var(--p-label-bg); font-size: 8.5pt; font-weight: 600; text-align: left; padding: 0 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; line-height: 1.25; }
        .contract-paper .info th .en { display: block; font-size: 7pt; font-weight: 400; color: var(--p-muted); letter-spacing: .01em; }
        .contract-paper .info td { font-size: 9.5pt; padding: 0 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }
        .contract-paper .info td.amt { font-weight: 700; color: var(--p-tc); font-variant-numeric: tabular-nums; }
        .contract-paper .info td .sub { font-size: 8pt; color: var(--p-muted); font-weight: 400; }
        .contract-paper .emerg { width: 100%; border-collapse: collapse; border: 0.6pt solid var(--p-rule-strong); border-top: none; margin-bottom: 4mm; }
        .contract-paper .emerg th { width: 30mm; background: var(--p-label-bg); font-size: 8.5pt; font-weight: 600; text-align: left; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; line-height: 1.3; }
        .contract-paper .emerg th .en { display: block; font-size: 7pt; font-weight: 400; color: var(--p-muted); }
        .contract-paper .emerg td { font-size: 9pt; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }
        .contract-paper .emerg-input input { width: 100%; min-width: 60mm; padding: 1mm 2mm; font-size: 9pt; border: 1px dashed #b9ac9a; border-radius: 4px; background: #fff; color: var(--p-ink); font-family: inherit; }

        /* 조항 — 2단 */
        .contract-paper .clauses { column-count: 2; column-gap: 7mm; column-fill: balance; margin-bottom: 3mm; }
        .contract-paper .clause-group { margin-bottom: 2.6mm; }
        .contract-paper .clause-h { font-size: 10.5pt; font-weight: 700; letter-spacing: -.01em; margin-bottom: 1.6mm; padding-left: 3mm; border-left: 2.5pt solid var(--p-tc); line-height: 1.2; break-after: avoid; }
        .contract-paper .clause-list { list-style: none; margin: 0; padding: 0; }
        .contract-paper .clause-list li { font-size: 8.7pt; line-height: 1.42; color: var(--p-ink); padding-left: 3mm; text-indent: -3mm; margin-bottom: 0.8mm; word-break: keep-all; break-inside: avoid; }
        .contract-paper .clause-list li::before { content: "·"; color: var(--p-muted); margin-right: 1.5mm; }
        .contract-paper .clause-list li .hl { color: var(--p-tc); font-weight: 600; }

        /* 서약 */
        .contract-paper .pledge { border: 0.6pt solid var(--p-rule-strong); background: var(--p-amt-bg); padding: 3mm 5mm; font-size: 9.5pt; font-weight: 500; line-height: 1.45; text-align: center; margin-bottom: 4.5mm; break-inside: avoid; }
        .contract-paper .pledge-edit { width: 100%; padding: 3mm 5mm; border: 1px solid #d6cdbb; border-radius: 6px; text-align: center; font-size: 9.5pt; font-weight: 500; margin-bottom: 4.5mm; background: #fffaf2; font-family: inherit; }

        /* 서명 */
        .contract-paper .sign-wrap { margin-top: auto; }
        .contract-paper .sign-date { text-align: center; font-size: 11pt; font-weight: 600; letter-spacing: .04em; margin-bottom: 3mm; }
        /* 두 칸 높이를 동일 고정 → 밑줄 좌우 정렬. 내용은 가운데(이름이 바닥으로 안 내려감). 긴 이름 줄바꿈. */
        .contract-paper .sign-grid { display: flex; gap: 14mm; margin-bottom: 4mm; }
        .contract-paper .sign-col { flex: 1; min-width: 0; }
        .contract-paper .sign-role { font-size: 8.5pt; color: var(--p-muted); margin-bottom: 3mm; letter-spacing: .06em; }
        .contract-paper .sign-line { display: flex; align-items: center; gap: 3mm; font-size: 10pt; border-bottom: 0.5pt solid var(--p-rule); padding-bottom: 1.5mm; height: 17mm; }
        .contract-paper .sign-line .lbl { color: var(--p-muted); font-size: 8.5pt; flex-shrink: 0; white-space: nowrap; }
        .contract-paper .sign-line .val { font-weight: 500; letter-spacing: .04em; flex: 1; min-width: 0; word-break: keep-all; }
        .contract-paper .signame-input { flex: 1; min-width: 0; }
        .contract-paper .signame-input input { padding: 0 2px; font-size: 10pt; border: 0; border-bottom: 1px dashed #b9ac9a; width: 100%; text-align: left; font-weight: 500; background: transparent; color: var(--p-ink); font-family: inherit; }
        .contract-paper .sign-img { height: 11mm; width: auto; max-width: 42mm; object-fit: contain; flex-shrink: 0; }
        .contract-paper .seal-wrap { flex-shrink: 0; position: relative; display: inline-flex; align-items: center; justify-content: center; }
        .contract-paper .seal-mark { font-size: 9.5pt; color: var(--p-muted); white-space: nowrap; }
        .contract-paper .seal-stamp { height: 15mm; width: auto; max-width: 22mm; object-fit: contain; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .contract-paper .signature-clear { margin-left: 4px; width: 18px; height: 18px; border-radius: 50%; border: 1px solid #d6cdbb; background: #fff; color: #6b6258; font-size: 11px; cursor: pointer; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
        .contract-paper .signature-clear:hover { color: #c4452b; border-color: #f3c8b5; }

        /* 푸터 */
        .contract-paper .doc-footer { border-top: 0.6pt solid var(--p-rule); padding-top: 3mm; margin-top: 4mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; }
        .contract-paper .foot-biz { font-size: 8pt; color: var(--p-muted); line-height: 1.55; }
        .contract-paper .foot-biz .nm { color: var(--p-ink); font-weight: 600; }
        .contract-paper .wordmark { font-size: 8pt; color: var(--p-muted); white-space: nowrap; }
        .contract-paper .wordmark .wm { font-weight: 600; }
        .contract-paper .wordmark .wm-stay { color: var(--p-ink); }
        .contract-paper .wordmark .wm-eum { color: var(--p-tc); }
        /* 잔여 소지품 임의처분 동의서 — 화면에선 계약서 cage 아래 별도 페이지 cage로 배치 */
        .disposal-cage { margin-top: 24px; }
        .contract-paper .dc-title { font-size: 15pt; font-weight: 800; text-align: center; letter-spacing: -.02em; margin: 2mm 0 7mm; }
        .contract-paper .dc-sec-h { font-size: 10.5pt; font-weight: 700; padding-left: 3mm; border-left: 2.5pt solid var(--p-tc); margin: 5mm 0 2.5mm; }
        .contract-paper .dc-info { width: 65%; }
        .contract-paper .dc-body { font-size: 9.4pt; line-height: 1.75; color: var(--p-ink); }
        .contract-paper .dc-p { margin-bottom: 2.6mm; word-break: keep-all; }
        .contract-paper .dc-date { text-align: center; font-size: 10pt; margin: 9mm 0 5mm; }
        .contract-paper .dc-sign { display: flex; align-items: baseline; justify-content: flex-end; gap: 3mm; font-size: 10pt; }
        .contract-paper .dc-sign-lbl { color: var(--p-muted); }
        .contract-paper .dc-sign-line { min-width: 42mm; border-bottom: 0.5pt solid var(--p-rule); padding: 0 2mm 1mm; font-weight: 600; text-align: center; }
        .contract-paper .dc-sign-seal { color: var(--p-muted); font-size: 9pt; }
        .contract-paper .dc-to { text-align: center; font-size: 11pt; font-weight: 700; margin: 8mm 0 4mm; }

        .only-print { display: none; }

        /* 편집 모드 */
        .contract-paper .clauses-edit { margin-bottom: 4mm; }
        .contract-paper .section-edit { border: 1px dashed #d6cdbb; border-radius: 8px; padding: 8px; margin-bottom: 10px; background: #fffaf2; }
        .contract-paper .section-edit-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
        .contract-paper .section-edit-title { flex: 1; padding: 4px 8px; border: 1px solid #d6cdbb; border-radius: 6px; font-size: 9.5pt; font-weight: 700; background: #fff; font-family: inherit; }
        .contract-paper .section-edit-btn { padding: 3px 8px; font-size: 11px; border: 1px solid #d6cdbb; border-radius: 6px; background: #fff; cursor: pointer; color: #6b6258; }
        .contract-paper .section-edit-btn:disabled { opacity: 0.3; }
        .contract-paper .section-edit-btn-danger { color: #c4452b; border-color: #f3c8b5; }
        .contract-paper .section-edit-textarea { width: 100%; min-height: 80px; padding: 6px 8px; border: 1px solid #d6cdbb; border-radius: 6px; font-size: 9.5pt; font-family: inherit; line-height: 1.5; background: #fff; resize: vertical; }
        .contract-paper .section-add-btn { width: 100%; padding: 8px; border: 1px dashed #a03c2e; color: #a03c2e; background: transparent; border-radius: 8px; font-size: 12px; cursor: pointer; }

        /* ── 서명 모달 ──────────────────────────────────────────── */
        .sig-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .sig-modal { width: 100%; max-width: 640px; background: #fff; border-radius: 16px; padding: 18px 18px 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 14px; }
        .sig-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .sig-title { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .sig-sub { font-size: 12px; color: #6b6258; line-height: 1.5; }
        .sig-close { width: 32px; height: 32px; border: 0; background: transparent; color: #6b6258; font-size: 18px; cursor: pointer; border-radius: 8px; }
        .sig-close:hover { background: #f3eee5; }
        .sig-canvas-wrap { position: relative; width: 100%; aspect-ratio: 16 / 7; background: #fbf6ee; border: 1px dashed #d6cdbb; border-radius: 12px; touch-action: none; }
        .sig-canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
        .sig-baseline { position: absolute; left: 12%; right: 12%; bottom: 22%; border-top: 1px dashed #d6cdbb; pointer-events: none; }
        .sig-actions { display: flex; align-items: center; gap: 8px; }

        /* ── 인쇄 전용 ─────────────────────────────────────────── */
        @page { size: A4; margin: 14mm; }   /* 상하좌우 동일(대칭) */
        @media print {
          html, body { background: #fff; overflow: visible !important; height: auto !important; }
          .contract-shell { padding: 0; min-height: auto; display: block !important; align-items: stretch !important; }
          .no-print { display: none !important; }
          .only-print { display: inline !important; }
          .paper-cage { display: contents !important; }
          .contract-paper {
            position: static !important; transform: none !important; transform-origin: 0 0 !important;
            box-shadow: none; width: 100% !important; max-width: 100% !important;
            min-height: 0 !important; padding: 0 !important; margin: 0 !important;
          }
          /* 페이지 split 보호 */
          .contract-paper .info, .contract-paper .emerg,
          .contract-paper .pledge, .contract-paper .sign-wrap, .contract-paper .doc-footer { page-break-inside: avoid; }
          .contract-paper .doc-footer { page-break-before: avoid; }
          .contract-paper.disposal-paper { page-break-before: always; margin-top: 0; }
          body { widows: 2; orphans: 2; }
          .seal-stamp, .sign-img, .biz-logo img, img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  )
}
