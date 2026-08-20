// 메일 발송 문 정본 — 앱에서 메일이 나가는 유일한 자리다(lib/pushSend 와 같은 축).
//
// 왜 한 문인가. 웹푸시가 정확히 이 자리에서 한 번 샜다 — 설정 화면이 web-push 를 직접 들고 있어
// 테스트 사이트 차단 밖에서 실기기로 알림이 나갔다(scripts/check-env-isolation.mjs 2번 항목).
// 메일은 그보다 나쁘다. 첨부에 이름·호실·금액·신원번호가 실려 있고, 나간 메일은 되돌릴 수 없다.
// 그래서 문을 하나만 두고, 테스트 사이트 차단을 이 함수의 **첫 문장**으로 박는다.
//
// 발신 도메인은 stayeum.com 하나다(DKIM/SPF/DMARC 인증 완료, docs/email-templates/README.md).
// 영업장마다 도메인을 갖는 구조가 아니므로 멀티테넌트 구분은 표시 이름과 회신 주소가 진다 —
// 받는 사람에게는 '<영업장 이름> <no-reply@stayeum.com>' 으로 도착하고, 답장은 보낸 운영자에게 간다.
//
// 키가 없으면 'disabled' 를 돌려준다. 던지지 않는다 — 부르는 화면이 안내를 띄우고 종전 경로로
// 돌아갈 수 있어야 한다. 빌드도 이 키를 읽지 않는다.

import { isStagingEnv } from './env'

/** Resend 는 40MB(base64 인코딩 후)까지 받는다. 받는 쪽 사서함이 먼저 막히므로 원본 기준으로 더 좁게 건다. */
export const MAIL_MAX_TOTAL_BYTES = 15 * 1024 * 1024

export type MailAttachment = {
  filename: string
  bytes: Uint8Array
  contentType: string
}

export type MailSendOutcome =
  | { result: 'sent'; id: string | null }
  /** 테스트 사이트·로컬 — 실제로 내보내지 않았다. */
  | { result: 'staging' }
  /** RESEND_API_KEY 미설정 — 기능이 안 켜졌다. */
  | { result: 'disabled' }
  | { result: 'failed'; reason: string }

/** 메일 기능이 켜져 있는가. 화면이 진입점을 그릴지 가르는 데 쓴다(서버에서만 호출). */
export function isMailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

/**
 * 메일 한 통. 실패해도 던지지 않고 결과로 답한다 — 부르는 쪽이 사람에게 할 말을 골라야 한다.
 *
 * 본문·제목·파일명에 무엇을 담을지는 부르는 쪽이 정한다. 여기서는 아무 문안도 짓지 않는다.
 */
export async function sendMail(input: {
  to: string
  subject: string
  text: string
  /** 표시 이름(영업장 이름). 주소는 항상 no-reply@stayeum.com 이다. */
  fromName: string
  /** 답장이 갈 주소 — 보낸 운영자. 없으면 답장이 no-reply 로 사라진다. */
  replyTo?: string
  attachments?: MailAttachment[]
}): Promise<MailSendOutcome> {
  // 테스트 사이트에서는 실제로 내보내지 않는다. 테스트 DB 는 운영 복사본이라 여기 to 가
  // 진짜 입주자 주소다 — 한 통만 새도 남의 서류가 도착한다.
  // 가드는 반드시 이 함수 첫 문장이다. 호출부에 두면 새 호출부가 생겼을 때 뚫린다.
  if (isStagingEnv()) return { result: 'staging' }

  const key = process.env.RESEND_API_KEY
  if (!key) return { result: 'disabled' }

  const attachments = input.attachments ?? []
  const total = attachments.reduce((s, a) => s + a.bytes.byteLength, 0)
  if (total > MAIL_MAX_TOTAL_BYTES) {
    return { result: 'failed', reason: '첨부 용량이 한도를 넘었습니다.' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // 표시 이름에 꺾쇠가 들어가면 주소 파싱이 깨진다. 영업장 이름은 자유 입력값이라 걸러 둔다.
        from: `${input.fromName.replace(/[<>"]/g, '').trim() || '스테이음'} <no-reply@stayeum.com>`,
        to: [input.to],
        ...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
        subject: input.subject,
        text: input.text,
        attachments: attachments.map(a => ({
          filename: a.filename,
          content: Buffer.from(a.bytes).toString('base64'),
          content_type: a.contentType,
        })),
      }),
    })
    if (!res.ok) {
      // 응답 본문에는 받는 주소가 그대로 되비쳐 오는 경우가 있다. 사유만 남기고 본문은 안 남긴다.
      return { result: 'failed', reason: `메일 서버가 요청을 거절했습니다 (${res.status}).` }
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null
    return { result: 'sent', id: body?.id ?? null }
  } catch {
    // 예외 메시지에 주소·본문이 섞여 나올 수 있어 그대로 올리지 않는다.
    return { result: 'failed', reason: '메일을 보내지 못했습니다.' }
  }
}
