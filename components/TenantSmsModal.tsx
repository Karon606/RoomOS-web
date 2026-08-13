'use client'

// 입주자 문자 — 저장된 템플릿 선택 또는 직접 작성(AI 다듬기) 후 문자앱(sms:)으로 넘기는 단일 스텝 컴포즈 모달.
// (입주자 상세 '문자' 버튼, 신고 962c65d2) 실제 발송은 운영자 폰의 문자앱에서 이뤄지므로 여기 이력은 '발송 시도'다.
// UnpaidSmsModal/NoticeSmsModal 을 복제해 만든 별도 경로 — 검증된 두 모달은 이번에 건드리지 않는다.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { singleSmsHref, blockSmsIfStaging } from '@/lib/smsHref'
import { polishNoticeText, switchAiModelForQuota } from '@/app/(app)/tenants/noticeSms'
import { getPersonalSmsContext, logPersonalSmsAttempt, type PersonalSmsContext } from '@/app/(app)/dashboard/actions'

export function TenantSmsModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [ctx, setCtx] = useState<PersonalSmsContext | null>(null)
  const [templateId, setTemplateId] = useState('')   // '' = 직접 입력
  const [body, setBody] = useState('')
  const [prevDraft, setPrevDraft] = useState<string | null>(null)   // AI 다듬기 전 원문(원래대로 복귀용)
  const [aiPending, setAiPending] = useState(false)
  const [logged, setLogged] = useState(false)

  // 변수 치환 — 입주자 문자는 이름·호수·계좌번호 3종만(청구 정보 없음)
  const render = (tpl: string, c: Extract<PersonalSmsContext, { ok: true }>) => tpl
    .replaceAll('{이름}', c.tenantName)
    .replaceAll('{호수}', c.roomNo)
    .replaceAll('{계좌번호}', c.bankAccount)

  useEffect(() => {
    getPersonalSmsContext(tenantId)
      .then(setCtx)
      .catch(() => setCtx({ ok: false, error: '불러오지 못했습니다. 다시 열어 주세요.' }))
  }, [tenantId])

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    setPrevDraft(null)
    if (!ctx?.ok) return
    if (!id) { setBody(''); return }   // 직접 입력
    const t = ctx.templates.find(x => x.id === id)
    if (t) setBody(render(t.body, ctx))
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

  const onSend = () => {
    if (logged) return
    setLogged(true)
    logPersonalSmsAttempt({ tenantId, renderedBody: body, templateId: templateId || null })
      .then(r => {
        if (r.ok) pushToast('info', '발송 시도로 기록했습니다', { detail: '실제 발송은 문자앱에서 보내기를 눌러야 완료됩니다.' })
        else pushToast('error', r.error)
      })
      .catch(() => pushToast('error', '이력 기록에 실패했습니다'))
  }

  return (
    <Modal open onClose={onClose} title="입주자 문자" width="sm" z={260}
      subtitle="템플릿을 고르거나 직접 작성한 뒤 문자앱으로 보냅니다 · 여기 기록은 '발송 시도'입니다"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Btn variant="secondary" size="md" onClick={onClose}>닫기</Btn>
          {ctx?.ok && ctx.phone && body.trim() ? (
            <a href={singleSmsHref(ctx.phone, body)} onClick={e => { if (blockSmsIfStaging(e)) return; onSend() }}
              className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-[var(--coral)] text-[var(--on-solid)] text-sm font-semibold hover:opacity-90 transition-opacity">
              문자앱으로 보내기
            </a>
          ) : (
            <Btn variant="primary" size="md" disabled>문자앱으로 보내기</Btn>
          )}
        </div>
      }>
      <div className="space-y-3">
        {!ctx ? (
          <SkeletonRows rows={3} />
        ) : !ctx.ok ? (
          <p className="text-xs text-[var(--danger-fg)]">{ctx.error}</p>
        ) : (
          <>
            <p className="text-xs text-[var(--warm-mid)]">
              받는 사람: <span className="font-semibold text-[var(--warm-dark)]">{ctx.tenantName}</span>
              {ctx.phone
                ? <span className="tabular-nums"> · {ctx.phone}</span>
                : <span className="text-[var(--danger-fg)]"> · 전화번호가 없습니다 (입주자 연락처를 먼저 등록하세요)</span>}
            </p>
            <label className="block">
              {/* 관리(추가·수정·삭제)는 설정에 있다 — 발송 흐름엔 고르기만 둔다(NoticeSmsModal 문법) */}
              <span className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-[var(--warm-mid)]">템플릿</span>
                <Link href="/settings" onClick={onClose}
                  className="text-[0.6875rem] text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">설정에서 관리 ›</Link>
              </span>
              <select value={templateId} onChange={e => pickTemplate(e.target.value)}
                className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">직접 입력</option>
                {ctx.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">보낼 내용 <span className="font-normal text-[var(--warm-muted)]">(자유롭게 수정 가능)</span></span>
              <textarea value={body} rows={6}
                onChange={e => setBody(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] leading-relaxed" />
            </label>
            {/* AI 다듬기 — 버튼은 label 밖(본문 드래그가 클릭으로 이어지지 않게, NoticeSmsModal 문법) */}
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
              <span className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums shrink-0">{body.trim().length}자</span>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              &lsquo;문자앱으로 보내기&rsquo;를 누르면 발송 시도로 기록되고 폰 메시지 앱이 열립니다. 실제 발송은 메시지 앱에서 완료하세요.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
