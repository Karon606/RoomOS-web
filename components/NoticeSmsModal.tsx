'use client'

// 단체 공지 문자 — 조건(전체·층·창) 그룹핑으로 수신자 선별 → 문구 작성(템플릿·AI 다듬기) → 그룹 sms: 발송 준비.
// (R4, 신고 4fad73fa) 실제 발송은 운영자 폰 문자앱에서 완료되므로 이력은 '발송 시도' 기록이다.

import { useEffect, useMemo, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { getNoticeSmsTargets, logNoticeSmsAttempt, polishNoticeText, type NoticeSmsTarget } from '@/app/(app)/tenants/noticeSms'
import { getSmsTemplates, saveSmsTemplate, type SmsTemplateRow } from '@/app/(app)/settings/actions'

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창', WINDOW: '창문', NO_WINDOW: '무창' }
const BATCH_SIZE = 20   // sms: URL 길이 제한 대비 수신자 분할 단위

type Filter = { type: 'all' } | { type: 'floor'; value: string } | { type: 'window'; value: string }

const filterLabelOf = (f: Filter) =>
  f.type === 'all' ? '전체' : f.type === 'floor' ? `${f.value}층` : (WINDOW_LABEL[f.value] ?? f.value)

export function NoticeSmsModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'pick' | 'compose'>('pick')
  const [targets, setTargets] = useState<NoticeSmsTarget[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<Filter>({ type: 'all' })
  const [checked, setChecked] = useState<Set<string>>(new Set())   // leaseTermId 기준

  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [body, setBody] = useState('')
  const [prevDraft, setPrevDraft] = useState<string | null>(null)  // AI 다듬기 전 원문(원래대로 복귀용)
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
  }, [])

  // 필터 칩 목록 — 현재 영업장 데이터에서 도출(하드코딩 금지)
  const floors = useMemo(() => {
    const set = new Set((targets ?? []).map(t => t.floor).filter(Boolean))
    return [...set].sort((a, b) => Number(a) - Number(b))
  }, [targets])
  const windows = useMemo(() => {
    const set = new Set((targets ?? []).map(t => t.windowType).filter((w): w is string => !!w))
    return [...set].sort()
  }, [targets])

  const matchesFilter = (t: NoticeSmsTarget, f: Filter) =>
    f.type === 'all' ? true : f.type === 'floor' ? t.floor === f.value : t.windowType === f.value

  const applyFilter = (f: Filter) => {
    setFilter(f)
    setChecked(new Set((targets ?? []).filter(t => t.phone && matchesFilter(t, f)).map(t => t.leaseTermId)))
  }

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

  // iOS는 sms:번호들&body=, 그 외는 ?body= (미납 문자와 동일한 UA 분기). 수신자 구분자는 iOS 콤마, 그 외 세미콜론.
  const smsHref = (list: NoticeSmsTarget[]) => {
    const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
    const nums = list.map(t => (t.phone ?? '').replace(/[^0-9+]/g, '')).join(isIos ? ',' : ';')
    return `sms:${nums}${isIos ? '&' : '?'}body=${encodeURIComponent(body)}`
  }

  const logBatch = (idx: number, list: NoticeSmsTarget[]) => {
    if (loggedBatches.has(idx)) return
    setLoggedBatches(prev => new Set(prev).add(idx))
    logNoticeSmsAttempt({ tenantIds: list.map(t => t.tenantId), body, filterLabel: filterLabelOf(filter) })
      .then(r => { if (!r.ok) pushToast('error', r.error) })
      .catch(() => pushToast('error', '이력 기록에 실패했습니다'))
  }

  const runPolish = () => {
    if (aiPending || !body.trim()) return
    setAiPending(true)
    polishNoticeText(body)
      .then(r => {
        if (!r.ok) { pushToast('error', r.error); return }
        setPrevDraft(body)
        setBody(r.text)
      })
      .catch(() => pushToast('error', 'AI 다듬기 중 통신 오류가 발생했습니다'))
      .finally(() => setAiPending(false))
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

  if (step === 'pick') {
    return (
      <Modal open onClose={onClose} title="단체 공지 문자" width="sm"
        subtitle="조건으로 수신자를 고르고, 목록에서 개별 조정할 수 있습니다"
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
              <div className="flex flex-wrap gap-1.5">
                {([{ type: 'all' } as Filter])
                  .concat(floors.map(f => ({ type: 'floor', value: f }) as Filter))
                  .concat(windows.map(w => ({ type: 'window', value: w }) as Filter))
                  .map(f => {
                    const active = filterLabelOf(filter) === filterLabelOf(f)
                    return (
                      <button key={filterLabelOf(f)} type="button" onClick={() => applyFilter(f)}
                        className={[
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'border-[var(--coral)] bg-[var(--coral)]/10 text-[var(--warm-dark)]'
                            : 'border-[var(--warm-border)] bg-[var(--cream)] text-[var(--warm-mid)]',
                        ].join(' ')}>
                        {filterLabelOf(f)}
                      </button>
                    )
                  })}
              </div>
              <ul className="max-h-72 overflow-y-auto divide-y divide-[var(--warm-border)] rounded-xl border border-[var(--warm-border)]">
                {targets.filter(t => matchesFilter(t, filter)).map(t => (
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
                {targets.filter(t => matchesFilter(t, filter)).length === 0 && (
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
      subtitle={`${filterLabelOf(filter)} · ${recipients.length}명에게 보냅니다 · 여기 기록은 '발송 시도'입니다`}
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
        <label className="block">
          <span className="flex items-center justify-between text-xs font-medium text-[var(--warm-mid)] mb-1">
            <span>보낼 내용 <span className="font-normal text-[var(--warm-muted)]">(모두에게 같은 내용이 갑니다)</span></span>
            <span className="flex items-center gap-2">
              {prevDraft != null && (
                <button type="button" className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline underline-offset-2"
                  onClick={() => { setBody(prevDraft); setPrevDraft(null) }}>
                  다듬기 전으로
                </button>
              )}
              <button type="button" disabled={aiPending || !body.trim()} onClick={runPolish}
                className="text-[var(--coral)] disabled:text-[var(--warm-muted)] font-medium">
                {aiPending ? '다듬는 중…' : 'AI 다듬기'}
              </button>
            </span>
          </span>
          <textarea value={body} rows={6} onChange={e => setBody(e.target.value)}
            placeholder="예: 7월 15일(수) 오전 10시부터 12시까지 전 층 수도 점검이 있습니다."
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] leading-relaxed" />
        </label>
        <div className="flex items-center justify-between">
          <button type="button" onClick={saveAsTemplate}
            className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline underline-offset-2">
            이 내용을 템플릿으로 저장
          </button>
          <span className="text-[0.625rem] text-[var(--warm-muted)] tabular-nums">{body.trim().length}자</span>
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
