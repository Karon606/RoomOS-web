'use client'

// 서류 문자 확인 화면 — 받는 사람·문구를 확인하고 고친 뒤 문자앱으로 넘긴다.
//
// 운영자 요구는 "단체공지문자 보내듯 문구가 미리 보이고 거기서 수정한 뒤, 받는 사람까지 다
// 지정되어서 send만 누르면 되도록"이었다. 번호와 문구는 그대로 된다. **파일만 안 된다.**
//
// 웹에서 첨부와 본문은 배타적이다. `navigator.share({files})` 는 첨부는 되지만 수신자·본문을
// 못 정하고(본문을 함께 넘겼다가 카카오톡 공유가 실패해 되돌린 적이 있다), `sms:` 는 번호와
// 본문은 채우지만 첨부 API 자체가 없다. 그래서 이 화면은 릴레이다 — 서류를 사진첩에 먼저
// 저장해 두고, 번호와 문구가 채워진 문자앱에서 첨부로 그 사진을 고른다.
//
// 그 사실을 감추지 않고 맨 위 안내 상자가 먼저 말한다. 저장 버튼을 문구보다 위에 두는 것도
// 같은 이유다 — 순서가 곧 설명이라, 읽는 순서대로 하면 빠뜨릴 수 없다.
//
// **안드로이드는 다른 길을 탄다(2026-11-03 운영자 승인, 신고 5·6).** 안드로이드의 사진 저장은
// a[download] 라 다운로드 폴더로 가고, 문자앱 첨부에서 그 사진을 찾아 붙이는 길이 길었다.
// 그래서 주 버튼 '문자 보내기'가 문구를 클립보드에 복사한 뒤 공유 창에 **사진만** 싣는다
// (files 와 text 를 함께 넘기면 카카오톡 공유가 실패한 이력, lib/shareFile shareFiles).
// 받는 사람은 공유 창이 못 채우므로 문자앱에서 직접 넣는다 — 안내 상자가 그 사실을 먼저 말한다.
// 이력은 공유가 성공했을 때(앱을 골랐을 때)만 남긴다. 취소하면 아무것도 안 남는다.
// 버튼은 파일 준비가 끝난 뒤에만 켠다 — 누른 뒤 준비를 기다리면 제스처가 만료돼 공유 창이 거부된다.
// 아이폰과 공유를 못 하는 기기는 종전 흐름(사진 저장 + sms: 링크) 그대로다.
//
// §14 발송 확인창은 세우지 않는다. 메일과 달리 앱이 보내지 않고 문자앱이 최종 확인 면이다
// (형제 문자 모달 셋과 같은 판정). 여기 기록은 '발송'이 아니라 '발송 시도'다.

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn, BtnLink } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { singleSmsHref, blockSmsIfStaging } from '@/lib/smsHref'
import { photoSaveNeedsShareSheet, canShareFiles } from '@/lib/shareFile'
import { DOC_SMS_DEFAULT_BODY, renderDocSms } from '@/lib/docSms'
import { logDocSmsAttempt } from '@/app/(app)/tenants/docBundle'
import type { PickedPhone } from '@/lib/tenantContact'

// 브라우저 다중 공유 하드 리밋 — 형제 알약(DocMultiShareBar)·서류 보내기 시트와 같은 숫자다.
const MAX_SHARE_FILES = 10

// 안드로이드 판정 — 공유 흐름을 안드로이드에만 연다(운영자 승인 범위). 실패하면 종전 흐름이다.
function isAndroid(): boolean {
  try { return /Android/i.test(navigator.userAgent) } catch { return false }
}

export function TenantDocSmsComposeSheet({
  tenantId, tenantName, propertyName, phone, docTitles, share, onClose,
}: {
  tenantId: string
  tenantName: string
  propertyName: string
  /** 받는 번호와 그 주인. 없으면 부모가 이 시트를 열지 않는다(알약이 잠긴다). */
  phone: PickedPhone
  /** 고른 서류 이름들 — 문구의 {서류목록} 이 된다. */
  docTitles: string[]
  /** 부모가 쥔 준비 큐 — 사진 저장이 이 손을 그대로 쓴다(같은 선택, 같은 파일명). */
  share: {
    done: number; fileCount: number; failedCount: number
    save: () => void | Promise<void>
    /** 안드로이드 '문자 보내기' — 문구를 복사하고 사진을 공유 창에 싣는다. 결과로 이력 기록을 가른다. */
    sendWithText: (text: string) => Promise<string>
  }
  onClose: () => void
}) {
  const initialBody = useMemo(() => renderDocSms(DOC_SMS_DEFAULT_BODY, {
    propertyName, tenantName, docList: docTitles.join(', '),
  }), [propertyName, tenantName, docTitles])
  const [body, setBody] = useState(initialBody)
  // 이력은 한 번만 남긴다 — 앵커를 두 번 누르면 같은 통이 두 줄로 기록된다(형제 셋과 같은 가드).
  const [logged, setLogged] = useState(false)

  // 준비 완료 판정은 **선택 수** 기준이다(형제 알약 DocMultiShareBar 와 같은 축).
  // fileCount 로 재면 안 된다 — 사진은 페이지마다 한 장이라 3쪽짜리 계약서 하나면 done 1 ·
  // fileCount 3 이 되어 조건이 영영 참이 안 되고, 저장 버튼이 '준비 중'에서 멈춘다.
  const settled = share.done + share.failedCount >= docTitles.length
  const tooMany = share.fileCount > MAX_SHARE_FILES
  const needsSheet = photoSaveNeedsShareSheet()
  const canSend = body.trim().length > 0
  // 안드로이드 공유 흐름 — 안드로이드이고 파일 공유가 되는 기기만. 아이폰은 사진 저장부터 공유 창이라
  // 종전 흐름을 지키고, 공유를 못 하는 기기는 sms: 링크로 자연스럽게 넘어간다. PC 크롬·맥 사파리도
  // 파일 공유는 되지만 '휴대폰 다운로드 폴더'·'메시지 앱' 안내가 거짓이 되므로 OS 로 가린다
  // (photoSaveNeedsShareSheet 와 같은 근거, 기능 탐지로 알 수 없는 OS 능력 차이).
  const shareFlow = isAndroid() && canShareFiles()
  // 공유 창은 준비가 다 끝난 뒤에만 연다. 실패가 섞이면 주 버튼이 '다시 시도'가 되어 큐를 다시 태운다
  // (deliver 가 실패 건을 다시 넣고 이름이 든 토스트를 띄운다, 공유 창은 안 연다).
  const ready = share.done >= docTitles.length && share.failedCount === 0
  const failed = share.failedCount > 0
  // 공유 창이 떠 있는 동안 다시 누르면 두 번째 share() 가 거부된다 — 누른 자리에서 막는다.
  const [sharing, setSharing] = useState(false)

  const handOff = () => {
    if (logged) return
    setLogged(true)
    void logDocSmsAttempt({ tenantId, renderedBody: body })
      .then(r => {
        if (r.ok) pushToast('info', '발송 시도로 기록했습니다', { detail: '실제 발송은 문자앱에서 보내기를 눌러야 완료됩니다.' })
        else pushToast('error', r.error)
      })
      .catch(() => pushToast('error', '이력 기록에 실패했습니다'))
  }

  const shareAndLog = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const r = await share.sendWithText(body)
      if (r === 'shared') handOff()
    } catch {
      pushToast('error', '공유 창을 열지 못했습니다. 서류 사진 저장으로 받아 문자에 첨부해 주세요.')
    } finally {
      setSharing(false)
    }
  }

  // 서류 사진 저장 — 종전 흐름에서는 문구보다 위(순서가 곧 설명), 안드로이드 공유 흐름에서는 주 동작이
  // 발끝의 '문자 보내기'라 보조로 문구 아래에 선다. 같은 버튼 하나를 자리만 옮긴다.
  const saveBlock = (
    <div className="space-y-1.5">
      {/* 실패해도 누를 수 있어야 한다 — save() 가 그 탭에서 큐를 다시 태운다(형제 알약과 같다).
          카운트를 라벨에 다는 것은 알약의 폭 제약에서 나온 금지라, full-width 버튼인 이 자리에는
          걸리지 않는다. 몇 장이 저장될지가 곧 다음 화면(사진첩)에서 고를 장수다. */}
      {/* 공유 흐름에서는 준비 중·실패 표시를 주 버튼 한 곳만 한다(같은 말이 두 자리에 서지 않게). */}
      <Btn type="button" variant="secondary" size="md" fullWidth
        disabled={shareFlow ? !ready || tooMany : (!settled && share.failedCount === 0) || tooMany}
        onClick={() => void share.save()}>
        {shareFlow
          ? (ready ? `서류 사진 저장 (${share.fileCount}장)` : '서류 사진 저장')
          : share.failedCount > 0
            ? '서류 준비 실패 · 다시 시도'
            : settled ? `서류 사진 저장 (${share.fileCount}장)` : '서류 준비 중…'}
      </Btn>
      {needsSheet && (
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
          저장을 누르면 공유 창이 열립니다. 공유 창에서 [이미지 저장]을 누르면 사진첩에 저장됩니다.
        </p>
      )}
      {/* 안드로이드 저장은 a[download] 라 다운로드 폴더로 간다. 갤러리 앱에서 찾는 이름을 그대로 말한다. */}
      {shareFlow && (
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
          공유 창 대신 메시지 앱 첨부에서 직접 고를 때 씁니다. 사진은 휴대폰의 다운로드 폴더에 저장됩니다.
        </p>
      )}
    </div>
  )

  return (
    <Modal open onClose={onClose} z={280} width="sm"
      title={`문자 확인 · ${tenantName}`}
      subtitle={shareFlow
        ? "문구를 고친 뒤 공유 창으로 넘깁니다 · 여기 기록은 '발송 시도'입니다"
        : "문구를 고친 뒤 문자앱으로 넘깁니다 · 여기 기록은 '발송 시도'입니다"}
      // 문안이 미리 차 있으므로 '비어 있지 않다'는 손댄 것이 아니다 — 그대로 두면 배경 클릭이
      // 영영 막히고 X·Esc 만 확인창을 타서 [닫기]와 다른 문법이 된다(§12 pristine 은 즉시 닫힘).
      dirty={body !== initialBody}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn variant="secondary" size="md" onClick={onClose}>닫기</Btn>
          {shareFlow ? (
            <Btn variant="primary" size="md"
              disabled={!canSend || !(ready || failed) || tooMany || sharing}
              onClick={() => void shareAndLog()}>
              {/* 준비 중·실패에는 왜 못 보내는지와 푸는 법을 이름이 말한다(§27.8). */}
              {failed ? '서류 준비 실패 · 다시 시도' : ready ? '문자 보내기' : '서류 준비 중…'}
            </Btn>
          ) : canSend ? (
            <BtnLink variant="primary" size="md" href={singleSmsHref(phone.value, body)}
              onClick={e => { if (blockSmsIfStaging(e)) return; handOff() }}>
              문자앱으로 보내기
            </BtnLink>
          ) : (
            <Btn variant="primary" size="md" disabled>문자앱으로 보내기</Btn>
          )}
        </div>
      }>
      <div className="space-y-3">
        {/* 받는 사람 — 고칠 수 없는 표시다(메일 시트의 같은 상자와 한 벌).
            번호를 바꾸려면 입주자 정보에서 고치고 다시 연다. */}
        <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
          <p className="text-[0.65625rem] text-[var(--warm-mid)]">받는 사람</p>
          <p className="mt-0.5 text-sm text-[var(--warm-dark)]">
            {tenantName} · <span className="tabular-nums">{phone.value}</span>
          </p>
          {/* 대체 고지 — 형제 문자 모달 둘과 같은 문장이다. 붉게 안 칠한다(운영자가 고른 대체). */}
          {phone.source === 'emergency' && (
            <p className="mt-[5px] text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
              본인 연락처가 없어 비상 연락처로 보냅니다.{phone.ownerLabel ? ` 받는 분은 ${phone.ownerLabel}.` : ''}
            </p>
          )}
        </div>

        {/* 못 하는 일을 먼저 말한다 — 종전 흐름은 순서대로 하면 빠뜨릴 수 없게 저장 버튼이 바로 아래
            선다. 안드로이드 공유 흐름은 공유 창이 못 채우는 받는 사람을 여기서 먼저 말한다.
            경고색을 쓰지 않는다. 이 줄은 정상 경로에서 100% 뜨는 설명이고, 같은 시트의 warning 은
            진짜 막힌 자리(장수 초과)에 배정돼 있다. 상시 경고색은 진짜 경고의 신호값을 깎는다. */}
        <p className="rounded-lg bg-[var(--cream-soft)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
          {shareFlow ? (
            <>
              {/* 공유 창은 번호를 못 채운다. 번호는 바로 위 받는 사람 상자에 있으므로 다시 적지 않고 가리킨다. */}
              '문자 보내기'를 누르면 문구가 복사되고 공유 창이 열립니다. 메시지 앱을 고르면 서류 사진이
              붙은 새 문자가 열립니다. 위 번호를 받는 사람에 넣고 문구를 붙여넣어 보내세요.
            </>
          ) : (
            <>
              문자에는 받는 사람과 문구가 미리 담깁니다. 다만 서류 파일은 문자에 함께 실리지 않습니다.
              아래에서 사진으로 저장해 두면 문자앱의 첨부에서 고르시면 됩니다.
            </>
          )}
        </p>

        {tooMany && (
          <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
            사진은 한 번에 {MAX_SHARE_FILES}장까지 {shareFlow ? '보낼' : '저장할'} 수 있습니다. 서류를 몇 건 빼고 다시 열어 주세요.
          </p>
        )}

        {!shareFlow && saveBlock}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="doc-sms-body">보낼 내용</label>
            <span className="text-[0.65625rem] tabular-nums text-[var(--warm-muted)]">{body.trim().length}자</span>
          </div>
          <textarea id="doc-sms-body" value={body} onChange={e => setBody(e.target.value)} rows={5}
            className="w-full resize-none rounded-sm border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5 text-sm leading-relaxed text-[var(--warm-dark)] outline-none transition-colors focus:border-[var(--coral)]" />
          <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
            고친 내용은 이번 한 통에만 적용됩니다.
          </p>
        </div>

        {shareFlow && saveBlock}

        {/* 무엇이 일어나는지 마지막으로 짚는다 — 형제 문자 모달 셋이 같은 자리에 같은 말을 둔다. */}
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
          {shareFlow ? (
            <>
              공유 창에서 앱을 고르면 발송 시도로 기록됩니다. 실제 발송은 메시지 앱에서 보내기를 눌러야
              완료됩니다.
            </>
          ) : (
            <>
              '문자앱으로 보내기'를 누르면 발송 시도로 기록되고 폰 메시지 앱이 열립니다.
              저장해 둔 서류 사진은 메시지 앱의 첨부에서 골라 붙인 뒤 보내세요.
            </>
          )}
        </p>
      </div>
    </Modal>
  )
}
