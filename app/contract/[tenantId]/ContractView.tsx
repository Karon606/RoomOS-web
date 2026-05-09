'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { ContractData } from './actions'
import { renderContractText } from '@/lib/contract'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney } from '@/lib/fmtMoney'

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

export default function ContractView({ data }: { data: ContractData }) {
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

  // 도장은 사업자 서명란 옆에 절대 위치로 합성. 서명일은 yyyy-MM-dd → "yyyy년 M월 d일"
  const signDateLabel = (() => {
    const [y, m, d] = signDate.split('-').map(Number)
    return Number.isFinite(y) ? `${y}년 ${m}월 ${d}일` : signDate
  })()

  return (
    <div className="contract-shell">
      {/* 화면 전용 툴바 — 인쇄 시 숨김 */}
      <div className="no-print toolbar">
        <Link href={`/tenants?id=${data.tenant.id}`} className="toolbar-link">← 입실자 목록</Link>
        <div className="toolbar-spacer" />
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
        <button onClick={handlePrint} className="toolbar-print">인쇄 / PDF 저장</button>
      </div>

      {/* 인쇄 영역 — A4 1장 기준 */}
      <main className="contract-paper">
        <h1 className="contract-title">{data.template.title}</h1>

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
              <th>전세 사고 유무</th>
              <td>없음</td>
            </tr>
          </tbody>
        </table>

        {/* 비상 연락망 안내 */}
        {data.template.emergencyContactNote && (
          <p className="emergency-note">
            {data.template.emergencyContactNote}{' '}
            <span className="emergency-input-screen no-print">
              <input
                type="text"
                value={emergencyContactText}
                onChange={e => setEmergencyContactText(e.target.value)}
                placeholder="이름/전화번호/관계"
              />
            </span>
            <span className="emergency-input-print only-print">{emergencyContactText}</span>
          </p>
        )}

        {/* 본문 섹션 */}
        <div className="sections">
          {data.template.sections.map(sec => (
            <section key={sec.id} className="section">
              <p className="section-title">{renderContractText(sec.title, vars)}</p>
              {sec.items.map((item, i) => (
                <p key={i} className="section-item">{renderContractText(item, vars)}</p>
              ))}
            </section>
          ))}
        </div>

        {/* 서약 + 서명란 */}
        <div className="oath">
          <p className="oath-text">{renderContractText(data.template.oathText, vars)}</p>
          <div className="signature-row">
            <span className="signature-date">{signDateLabel}</span>
            <span className="signature-label">/ 서명: </span>
            <span className="signature-name no-print">
              <input type="text" value={signatureName} onChange={e => setSignatureName(e.target.value)} />
            </span>
            <span className="signature-name only-print">{signatureName}</span>
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
              {/* Phase 1: 도장은 화면에서만 미리보기. 인쇄 시는 (인) 텍스트 사용.
                  Phase 2에서 자동 합성으로 옮긴다. */}
              {data.stampThumbnailUrl ? <span className="business-stamp-marker">(인)</span> : <span className="business-stamp-marker">(인)</span>}
            </span>
          </div>
          {data.businessInfo.address && (
            <div className="business-line">사업장 주소: {data.businessInfo.address}</div>
          )}
        </div>
      </main>

      {/* 인쇄/화면 공통 스타일 */}
      <style jsx global>{`
        html, body { background: #efeae0; }
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
        .business-stamp-slot { margin-left: 4px; position: relative; display: inline-block; }
        .business-stamp-marker { font-weight: 600; }

        /* ── 인쇄 전용 ─────────────────────────────────────────── */
        @page {
          size: A4;
          margin: 0;
        }
        @media print {
          html, body { background: #fff; }
          .contract-shell { padding: 0; min-height: auto; }
          .no-print { display: none !important; }
          .only-print { display: inline !important; }
          .contract-paper {
            box-shadow: none;
            width: 210mm;
            min-height: 297mm;
          }
        }
      `}</style>
    </div>
  )
}
