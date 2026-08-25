'use client'

// 서류 메일 확인 화면 — 받는사람·보내는사람·답장 주소·제목·본문·첨부·미리보기를 모두 확인한 뒤에야
// 발송된다(운영자 요구 2026-08-25: "모두 확인한 후 최종 결정으로 발송").
//
// 버튼 한 번에 나가던 종전 구조를 버렸다 — '메일 쓰기'는 이 화면을 열 뿐이고, 발송은 여기의
// '메일 보내기'와 danger 확인창을 지나야 한다. 나간 메일은 되돌릴 수 없어서다(§14·§16).
//
// 미리보기는 발송과 같은 renderDocMail(서버)이 만든다 — 화면이 따로 그리면 거짓말이 된다.
// 수정(제목·본문·답장 주소)은 이 한 통에만 적용되고 저장되지 않는다. 저장 자리는 환경설정
// '서류 메일 문안' 카드 하나다. 문안이 직접 HTML 모드면 본문 편집을 잠근다(htmlLocked) —
// 모바일에서 HTML 원문을 만지다 사고 나기 좋고, 클라이언트가 HTML 을 서버로 보내는 길을 안 연다.
//
// 답장 주소는 열거(환경설정 메일 주소·내 로그인 주소)에서 고른다. 자유 입력 칸이 아니다 —
// 오타 한 글자가 답장을 허공에 보낸다. 발신 주소는 도메인 인증 때문에 no-reply@stayeum.com
// 고정이고, 화면이 그 사실을 그대로 말한다(lib/mailSend).

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import {
  getTenantDocMailDraft, previewTenantDocMail, sendTenantDocBundleMail,
  type TenantDocMailDraftInfo,
} from '@/app/(app)/tenants/docBundle'

// 용량 표기 — 안내용이라 한 자리면 충분하다. 크기를 못 읽은 파일은 표기를 비운다(합계도 '이상').
function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  return `${Math.max(1, Math.round(n / 1024))}KB`
}

const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'

export function TenantDocMailComposeSheet({ tenantId, keys, onClose, onSent }: {
  tenantId: string
  /** 서류 보내기 시트에서 고른 행 키 — 서버가 후보 조회를 다시 돌려 파일로 되바꾼다. */
  keys: string[]
  onClose: () => void
  /** 발송 성공 — 부모(서류 보내기 시트)가 선택을 비우고 토스트를 띄운다. */
  onSent: (count: number) => void
}) {
  const [draft, setDraft] = useState<TenantDocMailDraftInfo | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewStale, setPreviewStale] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let alive = true
    void getTenantDocMailDraft(tenantId, keys)
      .then(r => {
        if (!alive) return
        if (!r.ok) { setFailed(r.error); return }
        setDraft(r.draft)
        setSubject(r.draft.subject)
        setBodyText(r.draft.bodyText)
        setReplyTo(r.draft.replyToDefault)
        setPreviewHtml(r.draft.previewHtml)
      })
      .catch(() => { if (alive) setFailed('메일 내용을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') })
    return () => { alive = false }
  }, [tenantId, keys])

  // 본문 수정 반영 미리보기 — 서버 렌더(발송과 같은 코드)를 디바운스로 부른다. 제목은 HTML 본문에
  // 안 들어가므로(제목 칸이 곧 표시) 본문이 바뀔 때만 다시 그린다. 실패는 갱신 안 됨 캡션으로만
  // 말한다 — 타이핑마다 토스트가 서면 시끄럽다.
  const firstPreview = useRef(true)
  useEffect(() => {
    if (!draft || draft.htmlLocked) return
    if (firstPreview.current) { firstPreview.current = false; return }
    setPreviewStale(true)
    const t = setTimeout(() => {
      void previewTenantDocMail(tenantId, keys, { subject, bodyText })
        .then(r => { if (r.ok) { setPreviewHtml(r.html); setPreviewStale(false) } })
        .catch(() => {})
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyText])

  const knownTotal = draft ? draft.attachments.reduce((s, a) => s + (a.size ?? 0), 0) : 0
  const hasUnknownSize = !!draft?.attachments.some(a => a.size == null)
  const overLimit = !!draft && knownTotal > draft.maxBytes

  const send = async () => {
    if (!draft || sending) return
    if (subject.trim() === '') { pushToast('error', '제목을 입력해 주세요.'); return }
    if (!draft.htmlLocked && bodyText.trim() === '') { pushToast('error', '본문을 입력해 주세요.'); return }
    // level 은 danger 다 — 아무것도 지우지 않지만 나간 메일은 되돌릴 수 없다(§14·§16, 종전 확인창과
    // 같은 판정). 내용·첨부는 이 화면이 이미 다 보여줬으므로 확인창은 받는 주소만 되짚는다.
    const ok = await confirmDialog({
      title: `${draft.tenantName} 님에게 메일을 보냅니다`,
      message: `받는 사람은 ${draft.to} 입니다.`,
      level: 'danger',
      irreversibleNote: '보낸 메일은 되돌릴 수 없습니다.',
      confirmLabel: '메일 보내기',
    })
    if (!ok) return
    setSending(true)
    try {
      const r = await sendTenantDocBundleMail(tenantId, keys, { subject, bodyText, replyTo })
      if (!r.ok) { pushToast('error', r.error); return }
      onSent(r.count)
    } catch {
      pushToast('error', '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} z={280} width="md"
      title={draft ? `메일 확인 · ${draft.tenantName}` : '메일 확인'}>
      <div className="space-y-3">
        {!draft && !failed && <SkeletonRows rows={5} />}
        {failed && <p className="text-xs text-[var(--danger-fg)]">{failed}</p>}

        {draft && (
          <>
            {/* 받는 사람·보내는 사람 — 고칠 수 없는 표시다. 라벨은 --warm-mid(§28, 형제 시트와 같은 숫자). */}
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">받는 사람</p>
              <p className="mt-0.5 break-all text-sm text-[var(--warm-dark)]">{draft.to}</p>
            </div>
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">보내는 사람</p>
              <p className="mt-0.5 break-all text-sm text-[var(--warm-dark)]">{draft.fromName} &lt;{draft.fromAddress}&gt;</p>
              <p className="mt-1 text-[0.65625rem] leading-relaxed text-[var(--warm-muted)]">발신 주소는 도메인 인증 때문에 스테이음 주소로 고정됩니다. 답장은 아래 주소로 받습니다.</p>
            </div>

            {/* 답장 주소 — 열거에서만 고른다. 후보가 하나면 스위치를 세우지 않는다(가를 것이 없는
                컨트롤 금지 — 형제 시트의 보낼 곳 규칙과 같다). */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="docmail-replyto">답장 받을 주소</label>
              {draft.replyToOptions.length > 1 ? (
                <select id="docmail-replyto" value={replyTo} onChange={e => setReplyTo(e.target.value)}
                  className={inputCls}>
                  {draft.replyToOptions.map(o => (
                    <option key={o.email} value={o.email}>
                      {o.email}{o.kind === 'property' ? ' (영업장 메일 주소)' : ' (내 로그인 주소)'}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="rounded-sm border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5 text-sm break-all text-[var(--warm-dark)]">{replyTo || '답장 주소가 없습니다'}</p>
              )}
              {draft.replyToOptions.length <= 1 && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">환경설정 기본정보의 메일 주소를 등록하면 여기서 고를 수 있습니다.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="docmail-subject">제목</label>
              <input id="docmail-subject" value={subject} maxLength={150}
                onChange={e => setSubject(e.target.value)} className={inputCls} />
            </div>

            {draft.htmlLocked ? (
              <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
                <p className="text-[0.65625rem] text-[var(--warm-mid)]">본문</p>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">본문은 환경설정의 서류 메일 문안(직접 HTML)을 씁니다. 아래 미리보기로 확인해 주세요.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="docmail-body">본문</label>
                <textarea id="docmail-body" value={bodyText} rows={6} maxLength={4000}
                  onChange={e => setBodyText(e.target.value)}
                  className={`${inputCls} leading-relaxed resize-y`} />
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">여기서 고친 내용은 이 메일에만 적용됩니다. 기본 문구는 환경설정의 서류 메일 문안에서 바꿉니다.</p>
              </div>
            )}

            {/* 첨부 — 실제 선택에서 그린다(손으로 쓰는 목록이 아니다). 크기는 안내용이고
                실제 상한은 발송 직전 서버 합산이 지킨다. */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[var(--warm-mid)]">첨부 파일</p>
              <ul className="rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] divide-y divide-[var(--warm-border)]">
                {draft.attachments.map(a => (
                  <li key={a.name} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 break-all text-[0.75rem] text-[var(--warm-dark)]">{a.name}</span>
                    <span className="shrink-0 text-[0.65625rem] tabular-nums text-[var(--warm-muted)]">PDF{a.size != null ? ` · ${fmtBytes(a.size)}` : ''}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[0.65625rem] tabular-nums text-[var(--warm-muted)]">
                {draft.attachments.length}건 · 합계 {fmtBytes(knownTotal)}{hasUnknownSize ? ' 이상' : ''} (한도 {fmtBytes(draft.maxBytes)})
              </p>
              {overLimit && (
                <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
                  첨부 용량이 한도를 넘습니다. 이 화면을 닫고 몇 건을 빼 주세요.
                </p>
              )}
            </div>

            {/* 미리보기 — 발송과 같은 renderDocMail 산출을 그대로 띄운다. sandbox 빈 값 =
                스크립트·동일 오리진 불허. 메일은 어느 테마에서든 흰 종이라 배경을 흰색으로 못박는다. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--warm-mid)]">받는 사람에게 이렇게 보입니다</p>
                {previewStale && <p className="text-[0.65625rem] text-[var(--warm-muted)]">갱신 중</p>}
              </div>
              <iframe title="메일 미리보기" sandbox="" srcDoc={previewHtml}
                className="h-[360px] w-full rounded-lg border border-[var(--warm-border)]"
                style={{ background: '#FFFFFF' }} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Btn type="button" variant="secondary" size="md" onClick={onClose} disabled={sending}>취소</Btn>
              <Btn type="button" variant="primary" size="md" onClick={() => void send()}
                disabled={sending || overLimit}>
                {sending ? '보내는 중…' : '메일 보내기'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
