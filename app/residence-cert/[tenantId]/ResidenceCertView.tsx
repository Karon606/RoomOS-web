'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ResidenceCertData } from './actions'
import { saveResidenceCertFieldOverride, resetResidenceCertFieldOverrides } from './actions'
import {
  type ResidenceCertFieldValues, type ResidenceCertOverrideKey, type ResidenceCertOverridePatch,
  RESIDENCE_CERT_FIELD_LABEL, fmtCertDate, mergeResidenceCertFields,
} from '@/lib/documentFieldOverrides'
import { DOC_NAME_STYLE_LABEL, asDocNameStyle, docNameStyles, documentName, resolveDocNameStyle, docNameStyleConflict, type DocNameStyle } from '@/lib/documentName'
import { docFileLabel } from '@/lib/docBundle'
import { RC_PAGE, RC_TEXT_FIELDS, RC_ISSUE_GAPS, RC_STAMP } from '@/lib/residenceCertLayout'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn, btnClass } from '@/components/ui/Btn'
import { SendDocButton } from '@/components/ui/SendDocButton'

type Fields = {
  siteAddress: string; areaM2: string
  tenantName: string; tenantAddress: string; tenantBirth: string; tenantPhone: string
  periodText: string; rentText: string; depositText: string
  landlordBusinessName: string; landlordName: string; landlordAddress: string
  landlordIdNo: string; landlordPhone: string
}

// ── 저장되는 표시값 5칸 ────────────────────────────────────────────
// 손으로 고친 값이 어디에도 남지 않아 발급할 때마다 같은 수정을 반복해야 했다. 이 다섯 칸은
// 저장된다(lib/documentFieldOverrides 정본). 나머지 칸은 이번 발급에만 쓰는 값이라 그대로 둔다.
// 금액은 화면에서 콤마 문자열로 다루고 저장은 숫자로 간다 — 계약서 표시값 문법과 같다.
type OverrideViewKey = 'siteAddress' | 'tenantAddress' | 'periodText' | 'rentText' | 'depositText'
const OVERRIDE_OF: Record<OverrideViewKey, ResidenceCertOverrideKey> = {
  siteAddress: 'siteAddress',
  tenantAddress: 'tenantAddress',
  periodText: 'periodText',
  rentText: 'rentAmount',
  depositText: 'depositAmount',
}
const isOverrideViewKey = (k: string): k is OverrideViewKey => k in OVERRIDE_OF
const AMOUNT_KEYS: ResidenceCertOverrideKey[] = ['rentAmount', 'depositAmount']
const amtNum = (s: string) => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}
const amtText = (s: string) => {
  const d = s.replace(/[^0-9]/g, '')
  return d ? parseInt(d, 10).toLocaleString() : ''
}

/** 표시값 5종 → 화면 칸 문자열. 자동값과 저장값이 같은 함수를 지나므로 서로 갈릴 수 없다. */
const toViewFields = (v: ResidenceCertFieldValues): Record<OverrideViewKey, string> => ({
  siteAddress: v.siteAddress,
  tenantAddress: v.tenantAddress,
  periodText: v.periodText,
  rentText: v.rentAmount ? v.rentAmount.toLocaleString() : '',
  depositText: v.depositAmount ? v.depositAmount.toLocaleString() : '',
})

/** 고객 정보의 세 이름 — 표기 선택이 이 셋 중 하나를 고른다(lib/documentName 정본). */
const nameSourceOf = (data: ResidenceCertData) =>
  ({ name: data.tenantName, englishName: data.tenantEnglishName, nativeName: data.tenantNativeName })

/**
 * 이 서류에 쓸 성명 표기 — 저장값, 앞 서류, 국적 순으로 정한다(lib/documentName 정본).
 *
 * **초기 조립과 셀렉트가 같은 답을 써야 한다.** 종전에는 성명 칸이 오버라이드의 nameStyle 만
 * 보고(없으면 기본값 한글) 셀렉트만 이 폴백을 거쳤다. 그래서 외국인이 아직 아무것도 안 고른
 * 상태로 열면 셀렉트는 영문인데 종이에는 한글 이름이 찍혔다. 한 번 골랐다 되돌리면 그때야
 * 맞아졌다(2026-08-31 운영자 실기).
 */
function docNameStyleOf(data: ResidenceCertData): DocNameStyle {
  return resolveDocNameStyle({
    saved: asDocNameStyle((data.overrides as { nameStyle?: unknown } | null)?.nameStyle),
    siblings: data.lastNameStyle ? [data.lastNameStyle] : [],
    tenant: data.tenantDocNameStyle,
    nationality: data.tenantNationality,
    hasForeignRegNo: data.tenantHasForeignRegNo,
    available: docNameStyles(nameSourceOf(data)),
  })
}

/** withOverrides=false 면 저장값을 무시한 순수 자동값 — '자동값으로' 버튼이 쓴다. */
function buildInitial(data: ResidenceCertData, withOverrides = true): Fields {
  const v = withOverrides ? mergeResidenceCertFields(data.autoFields, data.overrides) : data.autoFields
  return {
    ...toViewFields(v),
    areaM2: data.areaM2,
    // 성명 칸은 여전히 저장 대상이 아니다(손으로 고치면 그 발급에만 쓰인다). 저장되는 것은
    // 한글·영문·현지 중 어느 쪽을 채울지의 **선택**뿐이라, 초기값을 여기서 그 선택으로 조립한다.
    // 표기 판정은 셀렉트와 같은 자리를 지난다 — 두 벌이면 화면과 종이가 다른 이름을 단다.
    tenantName: documentName(nameSourceOf(data), withOverrides ? docNameStyleOf(data) : v.nameStyle),
    tenantBirth: fmtCertDate(data.tenantBirth), tenantPhone: data.tenantPhone,
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

  // 자동값과 저장값을 나눠 들고 있는다 — 고친 칸에 자동값을 병기하려면 둘 다 필요하다.
  const autoView = useMemo(() => toViewFields(data.autoFields), [data.autoFields])
  const savedView = useMemo(
    () => toViewFields(mergeResidenceCertFields(data.autoFields, data.overrides)),
    [data.autoFields, data.overrides],
  )
  const overrideCount = Object.keys(data.overrides).length
  // 서버 값이 갱신되면(저장 후 새로고침) 저장 대상 다섯 칸만 서버 값으로 되맞춘다.
  // 나머지 칸까지 덮으면 저장할 때마다 손으로 적어 둔 다른 칸이 지워진다.
  useEffect(() => { setF(p => ({ ...p, ...savedView })) }, [savedView])

  // 칸 이탈 시 저장. 저장 실패하면 화면 값을 서버 값으로 되돌린다 — 저장 안 된 값이
  // 화면에 남으면 운영자는 저장된 줄 알고 그대로 발급한다.
  const commit = (viewKey: OverrideViewKey, raw: string) => {
    const leaseTermId = data.leaseTermId
    const key = OVERRIDE_OF[viewKey]
    const isAmount = AMOUNT_KEYS.includes(key)
    const next = isAmount ? amtText(raw) : raw.trim()
    setF(p => ({ ...p, [viewKey]: next }))
    if (!leaseTermId) return                 // 계약이 없으면 저장할 자리가 없다(화면 안내로 알린다)
    if (next === savedView[viewKey]) return  // 서버가 내려준 값과 같으면 저장할 것이 없다
    // 빈 값은 그 키만 지운다 = 그 칸만 자동값으로 복귀(필드 단위 적용취소).
    const patch: ResidenceCertOverridePatch = { [key]: next === '' ? null : (isAmount ? amtNum(next) : next) }
    const release = trackSave()
    saveResidenceCertFieldOverride(leaseTermId, patch)
      .then(res => {
        if (!res.ok) {
          pushToast('error', res.error)
          setF(p => ({ ...p, ...savedView }))
          return
        }
        pushToast('success', [
          `${RESIDENCE_CERT_FIELD_LABEL[key]} 표시값 저장됨. 다음 발급에도 이 값이 나옵니다.`,
          isAmount ? '수납과 청구에는 영향이 없습니다.' : '',
        ].filter(Boolean).join(' '))
        router.refresh()
      })
      .finally(() => release())
  }

  // ── 성명 표기(한글/영문) ─────────────────────────────────────────
  // 저장되는 것은 이름이 아니라 **선택**이다(lib/documentName 정본). 성명 칸 자체는 여전히 저장
  // 대상이 아니라, 손으로 고친 이름은 그 발급에만 쓰인다.
  // 영문 이름이 없으면 아무것도 그리지 않는다 — 대다수 입주자의 화면은 종전과 완전히 같다.
  const nameSource = nameSourceOf(data)
  const nameStyles = docNameStyles(nameSource)
  const canPickName = nameStyles.length > 1
  // 이 서류에 저장된 값이 있으면 그것, 없으면 앞 서류, 그것도 없고 외국인이면 영문(lib/documentName).
  // 저장 여부는 오버라이드에 nameStyle 키가 실제로 있는가로 가른다 — 자동값과 같아진 키는
  // 저장에서 빠지므로, 병합 결과만 보면 '안 고른 것'과 '한글을 골랐던 것'이 구분되지 않는다.
  const storedNameStyle = asDocNameStyle((data.overrides as { nameStyle?: unknown } | null)?.nameStyle)
  const savedNameStyle = docNameStyleOf(data)
  const [nameStyle, setNameStyle] = useState(savedNameStyle)
  useEffect(() => { setNameStyle(savedNameStyle) }, [savedNameStyle])

  const commitNameStyle = async (raw: string) => {
    const next = asDocNameStyle(raw)
    if (!next || next === nameStyle) return
    // 앞 서류와 다르게 고르면 한 번 묻는다. 이 서류에 이미 저장된 값이 있으면 안 묻는다 —
    // 그때는 '앞'이 이 서류 자신이고, 되묻기가 열 때마다 반복된다.
    if (!storedNameStyle) {
      const prev = docNameStyleConflict(next, data.lastNameStyle ? [data.lastNameStyle] : [])
      if (prev && !(await confirmDialog({
        title: `앞선 서류가 ${DOC_NAME_STYLE_LABEL[prev]}으로 발급되었습니다`,
        message: `이 실거주 확인서만 ${DOC_NAME_STYLE_LABEL[next]}으로 바꿀까요? 한 사람의 서류는 같은 표기로 내는 편이 제출처에서 덜 막힙니다.`,
        level: 'caution',
        confirmLabel: `${DOC_NAME_STYLE_LABEL[next]}으로 바꾸기`,
      }))) return
    }
    setNameStyle(next)
    setF(p => ({ ...p, tenantName: documentName(nameSource, next) }))
    const leaseTermId = data.leaseTermId
    if (!leaseTermId) return                  // 계약이 없으면 저장할 자리가 없다(화면 안내로 알린다)
    if (next === savedNameStyle) return       // 서버가 내려준 값과 같으면 저장할 것이 없다
    const release = trackSave()
    saveResidenceCertFieldOverride(leaseTermId, { nameStyle: next })
      .then(res => {
        if (!res.ok) {
          pushToast('error', res.error)
          setNameStyle(savedNameStyle)
          setF(p => ({ ...p, tenantName: documentName(nameSource, savedNameStyle) }))
          return
        }
        pushToast('success', `${RESIDENCE_CERT_FIELD_LABEL.nameStyle} 저장됨. 다음 발급에도 이 표기로 나옵니다.`)
        router.refresh()
      })
      .finally(() => release())
  }

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

  // 되돌리기 = 저장해 둔 표시값 행까지 지운다. 화면만 되돌리면 다음 발급에 저장값이 다시 올라온다.
  const reset = async () => {
    if (!(await confirmDialog({ title: '자동값으로 되돌릴까요?', message: '직접 수정한 내용이 모두 사라지고 시스템 자동값으로 복원됩니다. 저장해 둔 표시값도 함께 지워집니다.', confirmLabel: '되돌리기', level: 'caution' }))) return
    if (data.leaseTermId && overrideCount > 0) {
      const release = trackSave()
      try {
        const res = await resetResidenceCertFieldOverrides(data.leaseTermId)
        if (!res.ok) { pushToast('error', res.error); return }
        router.refresh()
      } finally { release() }
    }
    // 표시값 행을 통째로 지웠으니 성명 표기도 자동값(한글)으로 돌아간다.
    setNameStyle(data.autoFields.nameStyle)
    setF(buildInitial(data, false)); setIssueDate(kstYmdStr())
    pushToast('info', '자동값으로 되돌렸습니다')
  }

  // 파일 이름도 표기를 따라간다 — 이름만 로마자이고 서류명이 한글이면 받는 사람이 절반을 못 읽는다
  // (납부 확인서와 같은 규칙). 이름은 표기가 적용된 값을 쓴다.
  const docFileName = `${documentName(nameSource, nameStyle)}_${docFileLabel('residence', nameStyle)}`

  // nameStyle 을 함께 싣는다 — 발급본에 박아 두면 목록에서 다시 보낼 때 파일 이름이 이 종이와 같은
  // 표기로 나온다. fields.name 에는 이미 적용된 이름만 들어 있어 서버가 선택 자체를 알 길이 없었다.
  const payload = () => ({ tenantId: data.tenantId, leaseTermId: data.leaseTermId, nameStyle, fields: { ...f, issueDate } })


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
        {overrideCount > 0 && <span className="rc-badge">표시값 수정</span>}
        <div className="rc-spacer" />
        {/* 성명 표기 — 고를 표기가 둘 이상인 입주자에게만 붙는다. 문법은 옆의 작성일 칸과 같은 rc-field. */}
        {canPickName && (
          <label className="rc-field"><span>성명</span>
            <select value={nameStyle} onChange={e => commitNameStyle(e.target.value)}>
              {nameStyles.map(s => <option key={s} value={s}>{DOC_NAME_STYLE_LABEL[s]}</option>)}
            </select>
          </label>
        )}
        <label className="rc-field"><span>작성일</span>
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
        </label>
        {/* 사진 저장은 '내보내기'가 흡수했다(§30.4, 운영자 확정 6). 그쪽이 형식을 먼저 묻고
            사진을 고르면 전 페이지를 그리므로 기능이 줄지 않고 다페이지 유실만 사라진다.
            1단계 다음 커밋에서 이 툴바를 상단 크롬 + 하단 액션바로 나눈다. */}
        <Btn variant="secondary" size="md" onClick={reset}>자동값으로</Btn>
        <SendDocButton getPdfBytes={fetchPreviewBytes} fileName={docFileName} className={btnClass('secondary', 'md')} />
        <Btn variant="primary" size="md" onClick={handleIssue} disabled={issuing}>
          {issuing ? '발급 중…' : '발급'}
        </Btn>
      </div>

      <p className="no-print rc-hint">
        원본 양식 위에 바로 입력합니다. 칸을 눌러 수정하세요. 보이는 그대로 발급됩니다.
        소재지, 임차인 주소, 거주 기간, 임대료, 보증금은 고치면 저장되어 다음 발급에도 그대로 나옵니다.
      </p>

      {data.overrideSavedDaysAgo !== null && data.overrideSavedDaysAgo >= 30 && (
        <p className="no-print rc-note">{data.overrideSavedDaysAgo}일 전에 저장한 값입니다. 지금 내용과 맞는지 확인해 주세요.</p>
      )}

      {!data.leaseTermId && (
        <p className="no-print rc-note">계약이 없어 여기서 고친 값은 저장되지 않습니다. 이번 발급에만 반영됩니다.</p>
      )}

      {!hasStamp && (
        <p className="no-print rc-warn">영업장 도장이 등록되지 않아 도장 없이 발급됩니다. 영업장 설정에서 도장을 등록하세요.</p>
      )}

      <div className="rc-cage" style={{ width: RC_PAGE.w * scale, height: RC_PAGE.h * scale }}>
        <div className="rc-page" style={{ width: RC_PAGE.w, height: RC_PAGE.h, transform: `scale(${scale})` }}>
          {/* 원본 양식 배경 */}
          <img src="/forms/residence-cert-seoul-bg.png" alt="실거주 확인서 양식" className="rc-bg"
            style={{ width: RC_PAGE.w, height: RC_PAGE.h }} draggable={false} />

          {/* 인쇄된 빈칸(거주기간 '20 . . . ~ 20 . . .') 흰 박스로 덮기 — 입력칸 아래.
              값이 있을 때만 덮는다. PDF(residenceCertOverlay)가 같은 조건이라, 종전처럼 무조건 덮으면
              칸을 비웠을 때 화면은 백지인데 종이에는 양식 빈칸이 찍혀 "보이는 그대로"가 깨진다. */}
          {RC_TEXT_FIELDS.filter(field => field.cover && (fv[field.key] ?? '').trim()).map(field => (
            <div key={field.key + '-cover'} className="rc-stamp-cover" style={{
              left: field.cover!.x, top: RC_PAGE.h - (field.cover!.y + field.cover!.h),
              width: field.cover!.w, height: field.cover!.h,
            }} />
          ))}

          {/* 입력칸 — 공유 좌표맵. 저장 대상 다섯 칸은 자동값과 다르면 배지 + 자동값을 아래에 병기한다
              (화면 전용 — no-print 라 종이에는 나가지 않는다). */}
          {RC_TEXT_FIELDS.map(field => {
            const isRight = field.align === 'right'
            const isCenter = field.align === 'center'
            const left = isRight ? field.x - field.width : isCenter ? field.x - field.width / 2 : field.x
            const align = isRight ? 'right' : isCenter ? 'center' : 'left'
            const vk = isOverrideViewKey(field.key) ? field.key : null
            const edited = !!vk && (fv[field.key] ?? '') !== autoView[vk]
            return (
              <Fragment key={field.key}>
                <input type="text" value={fv[field.key] ?? ''} onChange={set(field.key as keyof Fields)}
                  {...(vk ? { onBlur: (e: React.FocusEvent<HTMLInputElement>) => commit(vk, e.target.value) } : {})}
                  className={`rc-in${edited ? ' edited' : ''}`}
                  style={{
                    left, top: topOf(field.y, field.size), width: field.width,
                    height: field.size * 1.5, fontSize: field.size, lineHeight: `${field.size * 1.5}px`,
                    textAlign: align,
                  }} />
                {vk && edited && (
                  <span className="no-print rc-auto" style={{
                    left, top: topOf(field.y, field.size) + field.size * 1.5, width: field.width, textAlign: align,
                  }}>
                    <b>수정함</b>자동값 {autoView[vk] || '빈칸'}
                  </span>
                )}
              </Fragment>
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
        /* 작성일(input)과 성명 표기(select)가 같은 칸으로 보여야 한다 — 한 줄에 나란히 서는 형제다 */
        .rc-field input, .rc-field select { padding: 4px 8px; border: 1px solid var(--warm-border); border-radius: 6px; font-size: 12px; background: #fff; color: inherit; font-family: inherit; }
        .rc-field select { cursor: pointer; }
        .rc-issue { padding: 6px 14px; background: var(--coral); color: var(--on-solid); border: 0; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .rc-issue:disabled { opacity: 0.6; }
        .rc-btn-secondary { padding: 6px 12px; background: var(--cream); color: var(--ink); border: 1px solid var(--warm-border); border-radius: 8px; font-weight: 500; font-size: 12px; cursor: pointer; }
        .rc-btn-secondary:disabled { opacity: 0.6; }
        /* 계약서 툴바 배지(.toolbar-badge)와 같은 토큰 — 같은 뜻이 두 화면에서 다르게 보이면 안 된다 */
        .rc-badge { padding: 3px 8px; background: var(--warning-bg); color: var(--warning-fg); border: 1px solid var(--warning-ring); border-radius: 999px; font-size: 11px; font-weight: 600; }
        .rc-hint { width: min(595px, 100% - 24px); font-size: 12px; color: var(--ink-m); margin: 0 0 12px; line-height: 1.5; }
        .rc-note { width: min(595px, 100% - 24px); font-size: 12px; color: var(--ink-m); margin: 0 0 12px; line-height: 1.5; }
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
        /* 자동값과 다른 칸 — 어느 칸을 손댔는지 종이 위에서 바로 보인다 */
        .rc-in.edited { background: rgba(255,214,0,0.12); border-radius: 2px; box-shadow: inset 0 -1px 0 var(--warning-ring); }
        .rc-auto {
          position: absolute; font-size: 7px; line-height: 9px; color: var(--ink-m);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
        }
        .rc-auto b { margin-right: 4px; padding: 0 4px; border-radius: 999px; font-weight: 600;
          background: var(--warning-bg); color: var(--warning-fg); border: 1px solid var(--warning-ring); }

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
          /* 커서가 있던 칸·수정한 칸만 노란 박스로 찍히는 것을 막는다 */
          .rc-in:hover, .rc-in:focus, .rc-in.edited { background: transparent !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  )
}
