'use client'

import { useState, useMemo, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ContractData } from './actions'
import { saveContractOverride, resetContractOverride } from './actions'
import { renderContractText, type ContractTemplate, type ContractSection } from '@/lib/contract'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { trackSave, pushToast } from '@/lib/saveStatus'

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
    roomNo:           data.lease?.roomNo ?? '',
    rentFee:          data.lease ? data.lease.rentAmount.toLocaleString() : '',
    emergencyContact: emergencyContactText,
  }), [data, smoking, emergencyContactText])

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

  // 출력에 쓰일 활성 템플릿 — 편집 중이면 draft, 아니면 props
  const view = editing ? draft : data.template

  return (
    <div className="contract-shell">
      {/* 화면 전용 툴바 — 인쇄 시 숨김 */}
      <div className="no-print toolbar">
        <Link href={`/tenants?id=${data.tenant.id}`} className="toolbar-link">← 입실자 목록</Link>
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
            <button onClick={handlePrint} className="toolbar-print">인쇄 / PDF 저장</button>
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

      {/* 인쇄 영역 — A4 1장 */}
      <main className="contract-paper">
        <h1 className="contract-title">{view.title}</h1>

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
              <th>입실 보증금 (Deposit)</th>
              <td>{data.lease ? `${data.lease.depositAmount.toLocaleString()}원${data.lease.cleaningFee ? ` (청소비 ${fmtKorMoney(data.lease.cleaningFee)})` : ''}` : ''}</td>
              <th>입실일 (Check-in)</th>
              <td>{fmtDate(data.lease?.moveInDate ?? null)}</td>
            </tr>
            <tr>
              <th>호실 (Room No.)</th>
              <td>{data.lease?.roomNo ?? ''}</td>
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
            <span className="signature-label">/ 서명: </span>
            <span className="signature-name no-print">
              <input type="text" value={signatureName} onChange={e => setSignatureName(e.target.value)} />
            </span>
            <span className="only-print">{signatureName}</span>
            <span className="signature-stamp">(인)</span>
          </div>
        </div>

        {/* 사업자 정보 + 도장 */}
        <div className="business-block">
          <div className="business-line">
            <span>상호: {data.businessInfo.name}</span>
            {data.businessInfo.registrationNo && <span> / 사업자번호 {data.businessInfo.registrationNo}</span>}
            {data.businessInfo.ceoName && <span> / 대표 {data.businessInfo.ceoName}</span>}
            <span className="business-stamp-slot">
              {data.stampImageUrl ? (
                <img src={data.stampImageUrl} alt="도장" className="business-stamp-image" />
              ) : (
                <span className="business-stamp-marker">(인)</span>
              )}
            </span>
          </div>
          {data.businessInfo.address && (
            <div className="business-line">사업장 주소: {data.businessInfo.address}</div>
          )}
        </div>
      </main>

      {/* 인쇄/화면 공통 스타일 */}
      <style jsx global>{`
        /* 글로벌 html/body overflow:hidden 을 이 라우트에선 해제 (스크롤 가능하도록) */
        html, body {
          overflow: auto !important;
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

        /* 인쇄 영역 — A4 1장 */
        .contract-paper {
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

        .contract-title {
          text-align: center;
          font-size: 13pt;
          font-weight: 700;
          text-decoration: underline;
          margin: 0 0 10px;
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

        .sections { margin-top: 6px; }
        .section { margin-bottom: 8pt; }
        .section-title { margin: 0 0 2pt 18pt; font-weight: 700; font-size: 9pt; }
        .section-item { margin: 0 0 1pt 0; font-size: 9pt; white-space: pre-line; }

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
          display: inline-flex; align-items: center; gap: 6px;
          font-weight: 700; font-size: 9pt;
        }
        .signature-name input {
          padding: 2px 10px; font-size: 9pt; border: 0; border-bottom: 1px solid #1a1a1a;
          min-width: 120px; text-align: center;
        }
        .only-print { display: none; }

        .business-block {
          margin-top: 14pt;
          text-align: center;
          font-size: 9pt;
        }
        .business-line { margin-bottom: 2pt; }
        .business-stamp-slot {
          margin-left: 4px; position: relative; display: inline-block;
          width: 18mm; height: 18mm; vertical-align: middle;
        }
        .business-stamp-image {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: contain; mix-blend-mode: multiply; /* 흰배경 PNG도 자연스럽게 */
        }
        .business-stamp-marker { font-weight: 600; }

        /* ── 인쇄 전용 ─────────────────────────────────────────── */
        @page {
          size: A4;
          margin: 0;
        }
        @media print {
          html, body { background: #fff; overflow: visible !important; height: auto !important; }
          .contract-shell { padding: 0; min-height: auto; }
          .no-print { display: none !important; }
          .only-print { display: inline !important; }
          .contract-paper {
            box-shadow: none;
            width: 210mm;
            min-height: 297mm;
            page-break-after: avoid;
          }
        }
      `}</style>
    </div>
  )
}
