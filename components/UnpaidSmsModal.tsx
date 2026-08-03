'use client'

// 미납 안내 문자 — ① 입금내역 확인 스텝(오발송 방지) ② 템플릿 선택·변수 치환 미리보기 ③ 문자앱(sms:) 열기
// (/docs/stayeum_payment_spec.md Phase 1) 실제 발송은 운영자 폰의 문자앱에서 이뤄지므로
// 여기 남는 이력은 '발송 시도' 기록이다. API 발송(Phase 2)은 sentVia 확장으로 대비.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { getUnpaidSmsContext, logSmsAttempt, type UnpaidSmsContext } from '@/app/(app)/dashboard/actions'
import { blockSmsIfStaging } from '@/lib/smsHref'

export type UnpaidSmsTarget = {
  leaseId: string
  tenantId: string
  tenantName: string
  roomNo: string
  unpaidAmount: number
  daysOverdue: number | null
}

// z — 다른 모달(고객 상세 entity-modal z=280 등) 위에 겹쳐 띄울 때. 대시보드는 기본 200.
export function UnpaidSmsModal({ target, onClose, z = 200 }: { target: UnpaidSmsTarget; onClose: () => void; z?: 200 | 260 | 280 }) {
  const [step, setStep] = useState<'confirm' | 'compose'>('confirm')
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)
  const [ctx, setCtx] = useState<UnpaidSmsContext | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [body, setBody] = useState('')
  const [logged, setLogged] = useState(false)

  const render = (tpl: string, c: Extract<UnpaidSmsContext, { ok: true }>) => tpl
    .replaceAll('{이름}', c.tenantName || target.tenantName)
    .replaceAll('{호수}', c.roomNo || target.roomNo)
    .replaceAll('{미납금액}', target.unpaidAmount.toLocaleString('ko-KR'))
    .replaceAll('{납기일}', c.dueDayLabel)
    .replaceAll('{경과일수}', String(Math.max(0, target.daysOverdue ?? 0)))
    .replaceAll('{계좌번호}', c.bankAccount)

  useEffect(() => {
    if (step !== 'compose' || ctx) return
    getUnpaidSmsContext(target.leaseId)
      .then(c => {
        setCtx(c)
        if (c.ok && c.templates.length > 0) {
          setTemplateId(c.templates[0].id)
          setBody(render(c.templates[0].body, c))
        }
      })
      .catch(() => setCtx({ ok: false, error: '불러오지 못했습니다. 다시 열어 주세요.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    if (!ctx?.ok) return
    const t = ctx.templates.find(x => x.id === id)
    if (t) setBody(render(t.body, ctx))
  }

  // iOS 는 sms:번호&body=, 그 외는 sms:번호?body= (스펙: UA 분기)
  const smsHref = (phone: string) => {
    const sep = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'
    return `sms:${phone.replace(/[^0-9+]/g, '')}${sep}body=${encodeURIComponent(body)}`
  }

  const onSend = () => {
    if (logged || !confirmedAt) return
    setLogged(true)
    logSmsAttempt({
      tenantId: target.tenantId,
      leaseTermId: target.leaseId,
      templateId: templateId || null,
      renderedBody: body,
      overdueAmount: target.unpaidAmount,
      overdueDays: target.daysOverdue,
      paymentCheckConfirmedAt: confirmedAt,
    }).then(r => {
      if (r.ok) pushToast('info', '발송 시도로 기록했습니다', { detail: '실제 발송은 문자앱에서 보내기를 눌러야 완료됩니다.' })
      else pushToast('error', r.error)
    }).catch(() => pushToast('error', '이력 기록에 실패했습니다'))
  }

  if (step === 'confirm') {
    return (
      <Modal open onClose={onClose} title="보내기 전에 확인해 주세요" width="xs" z={z}
        footer={
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="md" onClick={onClose}>취소</Btn>
            {/* 목적어가 '입금내역'이면 '입금내역(이) 확인됐어요'로 읽힌다 — 운영자 지적 2026-08-03.
                '통장'은 확인의 대상이 될 수 없는 사물이라 그 오독 경로가 닫힌다.
                '· 문자 작성'을 본문으로 내린 이유는 폭이다. 종전 라벨은 360px 기기에서 이미 두 줄로
                접혔고(Btn 에 whitespace-nowrap 이 없다), 그러면 옆 취소 버튼까지 stretch 로 같이 늘어난다. */}
            <Btn variant="primary" size="md" onClick={() => { setConfirmedAt(new Date().toISOString()); setStep('compose') }}>
              통장 확인했어요
            </Btn>
          </div>
        }>
        <div className="space-y-2">
          {/* 질문의 목적어와 버튼의 목적어를 맞춘다 — 버튼만 읽어도 이 질문의 답이라는 게 확정된다.
              종전에는 여기가 '은행', 아래 문장이 '통장'이라 한 화면에서 같은 대상을 두 이름으로 불렀다. */}
          <p className="text-sm font-semibold text-[var(--warm-dark)]">통장 입금내역을 확인하셨나요?</p>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
            미처 확인하지 못한 입금이 있을 수 있습니다. 지금 눌러도 문자는 나가지 않고, 다음 화면에서 내용을 보고 보냅니다.
          </p>
          <p className="text-xs text-[var(--warm-mid)]">
            대상: <span className="font-semibold text-[var(--warm-dark)]">{target.roomNo && /^\d+$/.test(target.roomNo) ? `${target.roomNo}호 ` : ''}{target.tenantName}</span>
            {' · '}미납 {target.unpaidAmount.toLocaleString('ko-KR')}원
            {target.daysOverdue != null && target.daysOverdue > 0 ? ` · 납기 ${target.daysOverdue}일 경과` : ''}
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="미납 안내 문자" width="sm" z={z}
      subtitle="변수가 채워진 본문을 확인하고 문자앱으로 보냅니다 · 여기 기록은 '발송 시도'입니다"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Btn variant="secondary" size="md" onClick={onClose}>닫기</Btn>
          {ctx?.ok && ctx.phone && body.trim() ? (
            <a href={smsHref(ctx.phone)} onClick={e => { if (blockSmsIfStaging(e)) return; onSend() }}
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
              받는 사람: <span className="font-semibold text-[var(--warm-dark)]">{target.tenantName}</span>
              {ctx.phone
                ? <span className="tabular-nums"> · {ctx.phone}</span>
                : <span className="text-[var(--danger-fg)]"> · 전화번호가 없습니다 (입주자 연락처를 먼저 등록하세요)</span>}
            </p>
            {ctx.templates.length > 0 ? (
              <label className="block">
                <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">템플릿</span>
                <select value={templateId} disabled={!ctx.ok}
                  onChange={e => pickTemplate(e.target.value)}
                  className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  {ctx.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-xs text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5">
                저장된 템플릿이 없습니다. 환경설정의 &lsquo;미납 안내 문자 템플릿&rsquo;에서 만들어 두면 변수가 자동으로 채워집니다. 지금은 아래에 직접 입력해도 됩니다.
              </p>
            )}
            <label className="block">
              <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">보낼 내용 <span className="font-normal text-[var(--warm-muted)]">(자유롭게 수정 가능)</span></span>
              <textarea value={body} rows={6}
                onChange={e => setBody(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] leading-relaxed" />
            </label>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              &lsquo;문자앱으로 보내기&rsquo;를 누르면 발송 시도로 기록되고 폰 메시지 앱이 열립니다. 실제 발송은 메시지 앱에서 완료하세요.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
