'use client'

// 단체 공지 문자 — 방·고객·수납 정보의 조건 조합으로 수신자 선별 → 문구 작성(템플릿·AI 다듬기) → 그룹 sms: 발송 준비.
// (R4, 신고 4fad73fa · 조건 조합 확장 운영자 요청 2026-07-10)
// 조합 규칙: 같은 줄(조건 축) 안에서 여러 개 = 그중 하나만 맞아도 포함(OR), 줄이 다르면 모두 만족(AND).
// 예: '4층·5층 + 외창' = 4층이거나 5층이면서 외창인 사람. 실제 발송은 폰 문자앱에서 완료(이력은 '발송 시도').

import { useEffect, useMemo, useState } from 'react'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { getNoticeSmsTargets, logNoticeSmsAttempt, polishNoticeText, switchAiModelForQuota, getAiModelRestorePrompt, resolveAiModelRestore, type NoticeSmsTarget } from '@/app/(app)/tenants/noticeSms'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { getSmsTemplates, saveSmsTemplate, type SmsTemplateRow } from '@/app/(app)/settings/actions'

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창', WINDOW: '창문', NO_WINDOW: '무창' }
const GENDER_LABEL: Record<string, string> = { MALE: '남성', FEMALE: '여성' }
const STAY_ORDER = ['6개월 미만', '6개월~1년', '1년 이상']
const BATCH_SIZE = 20   // sms: URL 길이 제한 대비 수신자 분할 단위

// 조건 축 — 값은 영업장 데이터에서 도출(하드코딩 금지). 값이 2종 미만인 축은 걸러도 의미가 없어 숨긴다.
type Dim = {
  key: string
  label: string
  get: (t: NoticeSmsTarget) => string | null
  fmt?: (v: string) => string
  order?: (a: string, b: string) => number
}
const DIMS: Dim[] = [
  { key: 'floor', label: '층', get: t => t.floor || null, fmt: v => `${v}층`, order: (a, b) => Number(a) - Number(b) },
  { key: 'window', label: '창문', get: t => t.windowType, fmt: v => WINDOW_LABEL[v] ?? v },
  { key: 'direction', label: '방향', get: t => t.direction },
  { key: 'tier', label: '방 등급', get: t => t.tier },
  { key: 'roomType', label: '방 타입', get: t => t.roomType },
  { key: 'gender', label: '성별', get: t => (t.gender === 'MALE' || t.gender === 'FEMALE' ? t.gender : null), fmt: v => GENDER_LABEL[v] ?? v },
  { key: 'smoking', label: '흡연', get: t => (t.smoking ? '흡연' : '비흡연') },
  { key: 'nationality', label: '국적', get: t => t.nationality },
  { key: 'welfare', label: '기초수급', get: t => (t.isBasicRecipient ? '수급자' : '해당 없음') },
  { key: 'stay', label: '거주기간', get: t => t.stayBucket, order: (a, b) => STAY_ORDER.indexOf(a) - STAY_ORDER.indexOf(b) },
  { key: 'job', label: '직업', get: t => t.job },
  { key: 'pay', label: '결제수단', get: t => t.payMethod },
]

export function NoticeSmsModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'pick' | 'compose'>('pick')
  const [targets, setTargets] = useState<NoticeSmsTarget[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [sel, setSel] = useState<Record<string, Set<string>>>({})   // 축별 선택 값
  // 조건 추가/수정 인라인 편집기 — null=닫힘, 'pick-dim'=축 목록, 그 외=해당 축 값 선택 중
  const [editing, setEditing] = useState<null | 'pick-dim' | string>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())    // leaseTermId 기준(개별 보정)

  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [body, setBody] = useState('')
  const [prevDraft, setPrevDraft] = useState<string | null>(null)   // AI 다듬기 전 원문(원래대로 복귀용)
  const [aiPending, setAiPending] = useState(false)
  const [loggedBatches, setLoggedBatches] = useState<Set<number>>(new Set())

  useEffect(() => {
    getNoticeSmsTargets()
      .then(r => {
        if (!r.ok) { setLoadError(r.error); return }
        setTargets(r.targets)
        setChecked(new Set(r.targets.filter(t => t.phone).map(t => t.leaseTermId)))
      })
      .catch(() => setLoadError('대상을 불러오지 못했습니다. 다시 열어 주세요.'))
    getSmsTemplates('notice').then(setTemplates).catch(() => { /* 템플릿은 없어도 진행 가능 */ })
    // pro 한도로 flash 전환했던 사용자 — 무료 한도 초기화가 지났으면 복귀 제안(승인 시에만 변경)
    getAiModelRestorePrompt().then(async p => {
      if (!p.due) return
      const yes = await confirmDialog({
        title: '고급 모델 무료 한도가 초기화됐습니다',
        message: `다듬기 모델을 다시 고급(${p.model})으로 바꿀까요? 아니요를 누르면 기본(빠름)을 유지합니다.`,
        confirmLabel: '고급으로 변경',
        cancelLabel: '기본 유지',
      })
      const r = await resolveAiModelRestore(yes)
      if (!r.ok) pushToast('error', r.error)
      else if (yes) pushToast('success', '다듬기 모델을 고급으로 되돌렸습니다')
    }).catch(() => { /* 제안 실패는 무시 */ })
  }, [])

  // 축별 선택지 — 실데이터에서 도출. 2종 미만이면 그 축은 숨김(걸러지는 게 없음).
  const dimOptions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const d of DIMS) {
      const vals = new Set<string>()
      for (const t of targets ?? []) { const v = d.get(t); if (v != null) vals.add(v) }
      const arr = [...vals].sort(d.order ?? ((a, b) => a.localeCompare(b, 'ko')))
      if (arr.length >= 2) map.set(d.key, arr)
    }
    return map
  }, [targets])
  const visibleDims = DIMS.filter(d => dimOptions.has(d.key))
  const activeDims = visibleDims.filter(d => sel[d.key]?.size)
  const addableDims = visibleDims.filter(d => !sel[d.key]?.size)

  const matches = (t: NoticeSmsTarget, s: Record<string, Set<string>>) =>
    DIMS.every(d => {
      const set = s[d.key]
      if (!set || set.size === 0) return true
      const v = d.get(t)
      return v != null && set.has(v)
    })

  // 조건 적용/삭제 — 바꿀 때마다 수신자 체크를 조건 일치자(번호 있는)로 재설정
  const applySel = (next: Record<string, Set<string>>) => {
    setSel(next)
    setChecked(new Set((targets ?? []).filter(t => t.phone && matches(t, next)).map(t => t.leaseTermId)))
  }
  const applyDraft = (dimKey: string) => {
    const next = { ...sel }
    if (draft.size === 0) delete next[dimKey]
    else next[dimKey] = new Set(draft)
    applySel(next)
    setEditing(null)
  }
  const removeCond = (dimKey: string) => {
    const next = { ...sel }
    delete next[dimKey]
    applySel(next)
  }
  const openDimEditor = (dimKey: string) => {
    setDraft(new Set(sel[dimKey] ?? []))
    setEditing(dimKey)
  }

  const hasCond = DIMS.some(d => sel[d.key]?.size)
  // 조건 요약 — '4층·5층 + 외창 + 흡연' (이력 메모·작성 화면 부제로 사용)
  const condLabel = hasCond
    ? DIMS.filter(d => sel[d.key]?.size)
        .map(d => [...sel[d.key]].sort(d.order ?? ((a, b) => a.localeCompare(b, 'ko'))).map(v => (d.fmt ? d.fmt(v) : v)).join('·'))
        .join(' + ')
    : '전체'

  const shownTargets = (targets ?? []).filter(t => matches(t, sel))

  const toggle = (t: NoticeSmsTarget) => {
    if (!t.phone) return
    setChecked(prev => {
      const n = new Set(prev)
      if (n.has(t.leaseTermId)) n.delete(t.leaseTermId); else n.add(t.leaseTermId)
      return n
    })
  }

  const recipients = useMemo(
    () => (targets ?? []).filter(t => checked.has(t.leaseTermId) && t.phone),
    [targets, checked],
  )
  const batches = useMemo(() => {
    const out: NoticeSmsTarget[][] = []
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) out.push(recipients.slice(i, i + BATCH_SIZE))
    return out
  }, [recipients])

  // 다중 수신자 — 애플(아이폰·아이패드·맥 전부 메시지앱)은 'sms:번호1,번호2' 형식에서 첫 번호만
  // 인식(운영자 실기기 확인 2026-07-10~11). sms://open?addresses=번호1,번호2&body= 형식만 다중 수신 지원.
  // 그 외(안드로이드)는 세미콜론 나열.
  const smsHref = (list: NoticeSmsTarget[]) => {
    const isApple = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    const enc = encodeURIComponent(body)
    if (isApple) {
      const nums = list.map(t => (t.phone ?? '').replace(/[^0-9+]/g, '')).join(',')
      return `sms://open?addresses=${nums}&body=${enc}`
    }
    const nums = list.map(t => (t.phone ?? '').replace(/[^0-9+]/g, '')).join(';')
    return `sms:${nums}?body=${enc}`
  }

  const logBatch = (idx: number, list: NoticeSmsTarget[]) => {
    if (loggedBatches.has(idx)) return
    setLoggedBatches(prev => new Set(prev).add(idx))
    logNoticeSmsAttempt({ tenantIds: list.map(t => t.tenantId), body, filterLabel: condLabel })
      .then(r => { if (!r.ok) pushToast('error', r.error) })
      .catch(() => pushToast('error', '이력 기록에 실패했습니다'))
  }

  const runPolish = async () => {
    if (aiPending || !body.trim()) return
    setAiPending(true)
    try {
      let r = await polishNoticeText(body)
      // 고급 모델 무료 한도 도달 — 그 자리에서 기본 모델 전환을 승인받고 즉시 재시도(운영자 설계)
      if (!r.ok && r.code === 'model-quota') {
        const yes = await confirmDialog({
          title: '고급 모델의 무료 한도에 도달했습니다',
          message: '기본 모델(빠름)로 바꿔서 지금 바로 다듬을까요? 무료 한도가 초기화되면 다시 고급으로 바꿀지 물어봅니다.',
          confirmLabel: '기본 모델로 계속',
        })
        if (!yes) return
        const sw = await switchAiModelForQuota(r.model ?? 'gemini-2.5-pro')
        if (!sw.ok) { pushToast('error', sw.error); return }
        r = await polishNoticeText(body)
      }
      if (!r.ok) { pushToast('error', r.error); return }
      setPrevDraft(body)
      setBody(r.text)
      void notifyAiQuota()
    } catch {
      pushToast('error', 'AI 다듬기 중 통신 오류가 발생했습니다')
    } finally {
      setAiPending(false)
    }
  }

  const saveAsTemplate = () => {
    const text = body.trim()
    if (!text) { pushToast('error', '저장할 내용을 먼저 입력하세요'); return }
    const name = `공지 ${new Date().getMonth() + 1}/${new Date().getDate()}`
    saveSmsTemplate({ name, body: text, kind: 'notice' })
      .then(r => {
        if (!r.ok) { pushToast('error', r.error); return }
        pushToast('success', `'${name}' 템플릿으로 저장했습니다`)
        getSmsTemplates('notice').then(setTemplates).catch(() => { /* 목록 갱신 실패는 무시 */ })
      })
      .catch(() => pushToast('error', '템플릿 저장에 실패했습니다'))
  }

  const valueChip = (active: boolean) => [
    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
    active
      ? 'border-[var(--coral)] bg-[var(--coral)]/10 text-[var(--warm-dark)]'
      : 'border-[var(--warm-border)] bg-[var(--cream)] text-[var(--warm-mid)]',
  ].join(' ')
  const fmtVal = (d: Dim, v: string) => (d.fmt ? d.fmt(v) : v)

  if (step === 'pick') {
    const editingDim = editing && editing !== 'pick-dim' ? visibleDims.find(d => d.key === editing) : null
    return (
      <Modal open onClose={onClose} title="단체 공지 문자" width="sm"
        subtitle="필요한 조건만 추가해 수신자를 좁히고, 목록에서 개별 조정할 수 있습니다"
        footer={
          <div className="flex items-center gap-2 justify-between w-full">
            <span className="text-xs text-[var(--warm-muted)]">수신 {recipients.length}명</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="md" onClick={onClose}>취소</Btn>
              <Btn variant="primary" size="md" disabled={recipients.length === 0} onClick={() => setStep('compose')}>
                문구 작성
              </Btn>
            </div>
          </div>
        }>
        <div className="px-5 sm:px-6 py-4 space-y-3">
          {loadError ? (
            <p className="text-xs text-[var(--danger-fg)]">{loadError}</p>
          ) : !targets ? (
            <SkeletonRows rows={4} />
          ) : (
            <>
              {/* 보낼 대상 문장 — 조건이 없으면 '전체'임을 명시(모호함 제거) */}
              <p className="text-sm">
                <span className="text-[var(--warm-muted)]">보낼 대상 · </span>
                <span className="font-semibold text-[var(--warm-dark)]">
                  {hasCond ? condLabel : '전체 입주자'}
                </span>
                <span className="text-[var(--warm-muted)]"> · {shownTargets.length}명</span>
              </p>

              {/* 걸어둔 조건 칩 — 몸통 탭=수정, ×=삭제 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {activeDims.map(d => (
                  <span key={d.key} className="inline-flex items-center gap-1 rounded-full border border-[var(--coral)] bg-[var(--coral)]/10 pl-3 pr-1.5 py-1 text-xs font-medium text-[var(--warm-dark)]">
                    <button type="button" onClick={() => openDimEditor(d.key)}>
                      {d.label}: {[...sel[d.key]].sort(d.order ?? ((a, b) => a.localeCompare(b, 'ko'))).map(v => fmtVal(d, v)).join('·')}
                    </button>
                    <button type="button" aria-label={`${d.label} 조건 삭제`} onClick={() => removeCond(d.key)}
                      className="grid place-items-center w-5 h-5 rounded-full text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--coral)]/15">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="11" height="11" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </span>
                ))}
                {editing === null && addableDims.length > 0 && (
                  <button type="button" onClick={() => setEditing('pick-dim')}
                    className="rounded-full border border-dashed border-[var(--warm-border)] px-3 py-1.5 text-xs font-medium text-[var(--coral)] hover:border-[var(--coral)] transition-colors">
                    + 조건 추가
                  </button>
                )}
              </div>

              {/* 인라인 편집기 1단계 — 조건 축 고르기 */}
              {editing === 'pick-dim' && (
                <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-3 space-y-2">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">어떤 조건으로 좁힐까요?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {addableDims.map(d => (
                      <button key={d.key} type="button" onClick={() => openDimEditor(d.key)} className={valueChip(false)}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setEditing(null)}
                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline underline-offset-2">닫기</button>
                </div>
              )}

              {/* 인라인 편집기 2단계 — 값 고르기(여러 개 가능) */}
              {editingDim && (
                <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-3 space-y-2">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">
                    {editingDim.label} 선택 <span className="font-normal text-[var(--warm-muted)]">(여러 개를 고르면 그중 하나만 맞아도 포함됩니다)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(dimOptions.get(editingDim.key) ?? []).map(v => (
                      <button key={v} type="button" className={valueChip(draft.has(v))}
                        onClick={() => setDraft(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })}>
                        {fmtVal(editingDim, v)}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="primary" size="sm" onClick={() => applyDraft(editingDim.key)}>적용</Btn>
                    <Btn type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>취소</Btn>
                    <span className="text-[0.625rem] text-[var(--warm-muted)]">아무것도 안 고르고 적용하면 이 조건이 빠집니다.</span>
                  </div>
                </div>
              )}

              {activeDims.length >= 2 && (
                <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
                  조건이 여러 개면 모두 만족하는 사람에게만 보냅니다.
                </p>
              )}
              <ul className="max-h-60 overflow-y-auto divide-y divide-[var(--warm-border)] rounded-xl border border-[var(--warm-border)]">
                {shownTargets.map(t => (
                  <li key={t.leaseTermId}>
                    <label className={`flex items-center gap-2.5 px-3 py-2 text-sm ${t.phone ? 'cursor-pointer' : 'opacity-45'}`}>
                      <input type="checkbox" className="accent-[var(--coral)]"
                        checked={checked.has(t.leaseTermId)} disabled={!t.phone} onChange={() => toggle(t)} />
                      <span className="font-medium text-[var(--warm-dark)] shrink-0">{t.roomNo}호</span>
                      <span className="text-[var(--warm-mid)] truncate">{t.name}</span>
                      <span className="ml-auto text-xs text-[var(--warm-muted)] tabular-nums shrink-0">
                        {t.phone ?? '연락처 없음'}
                      </span>
                    </label>
                  </li>
                ))}
                {shownTargets.length === 0 && (
                  <li className="px-3 py-4 text-xs text-[var(--warm-muted)]">조건에 맞는 입주자가 없습니다.</li>
                )}
              </ul>
            </>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="단체 공지 문자" width="sm"
      subtitle={`${condLabel} · ${recipients.length}명에게 보냅니다 · 여기 기록은 '발송 시도'입니다`}
      footer={
        <div className="flex items-center gap-2 justify-between w-full">
          <Btn variant="secondary" size="md" onClick={() => setStep('pick')}>수신자 다시 선택</Btn>
          <Btn variant="secondary" size="md" onClick={onClose}>닫기</Btn>
        </div>
      }>
      <div className="px-5 sm:px-6 py-4 space-y-3">
        {templates.length > 0 && (
          <label className="block">
            <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">공지 템플릿</span>
            <select defaultValue=""
              onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) { setPrevDraft(null); setBody(t.body) } }}
              className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">직접 입력</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <div>
          <label htmlFor="notice-sms-body" className="block text-xs font-medium text-[var(--warm-mid)] mb-1">
            보낼 내용 <span className="font-normal text-[var(--warm-muted)]">(모두에게 같은 내용이 갑니다)</span>
          </label>
          <textarea id="notice-sms-body" value={body} rows={6} onChange={e => setBody(e.target.value)}
            placeholder="예: 7월 15일(수) 오전 10시부터 12시까지 전 층 수도 점검이 있습니다."
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] leading-relaxed" />
        </div>
        {/* 버튼은 label 밖에 — label 안에 두면 본문 드래그 선택이 버튼 클릭으로 이어질 수 있다 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Btn type="button" variant="secondary" size="sm" disabled={aiPending || !body.trim()} onClick={runPolish}>
              {aiPending ? '다듬는 중…' : 'AI 다듬기'}
            </Btn>
            {prevDraft != null && (
              <Btn type="button" variant="ghost" size="sm" onClick={() => { setBody(prevDraft); setPrevDraft(null) }}>
                다듬기 전으로
              </Btn>
            )}
            <AiQuotaHint />
          </div>
          <span className="text-[0.625rem] text-[var(--warm-muted)] tabular-nums shrink-0">{body.trim().length}자</span>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={saveAsTemplate}
            className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline underline-offset-2">
            이 내용을 템플릿으로 저장
          </button>
        </div>
        <div className="space-y-1.5">
          {batches.map((list, i) => (
            <a key={i} href={body.trim() ? smsHref(list) : undefined} onClick={() => body.trim() && logBatch(i, list)}
              aria-disabled={!body.trim()}
              className={[
                'flex items-center justify-center h-10 px-4 rounded-xl text-sm font-semibold transition-opacity',
                body.trim()
                  ? 'bg-[var(--coral)] text-white hover:opacity-90'
                  : 'bg-[var(--cream-soft)] text-[var(--warm-muted)] pointer-events-none',
              ].join(' ')}>
              문자앱으로 보내기{batches.length > 1 ? ` (${i + 1}/${batches.length} · ${list.length}명)` : ` (${list.length}명)`}
              {loggedBatches.has(i) ? ' · 기록됨' : ''}
            </a>
          ))}
        </div>
        <p className="text-[0.625rem] text-[var(--warm-muted)]">
          버튼을 누르면 발송 시도로 기록되고 폰 메시지 앱이 단체 대화로 열립니다. 실제 발송은 메시지 앱에서 완료하세요.
        </p>
      </div>
    </Modal>
  )
}
