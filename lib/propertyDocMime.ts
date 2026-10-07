// 저장된 영업장 서류의 응답 형식 판정 — /api/biz-cert·/api/bank-book 이 같은 규칙으로 Content-Type 을 정한다.
//
// 저장된 mime 이 정본이다(업로드 마무리에서 Drive 판정값을 박아 둔다). 그 이전 저장분이나 빈 값이면
// 바이트로 되짚는다 — 형식을 모른 채 내려보내면 첨부가 확장자 없는 파일이 된다.
// 프록시가 둘이 되면서 판정이 두 자리에 손으로 적히지 않게 여기 하나로 모았다. 순수 함수다.

import { DOC_MIME_PDF, DOC_MIME_UNKNOWN, sniffDocMime, isImageDocMime } from './docMime'

/**
 * 저장 mime 이 있으면 그대로, 없으면 맨 앞 4바이트가 '%PDF' 일 때 PDF, 그 밖은 이미지 판정
 * (이미지가 아니면 application/octet-stream). /api/biz-cert 의 종전 판정과 한 글자도 다르지 않다.
 */
export function resolveStoredDocMime(bytes: Uint8Array, stored: string | null | undefined): string {
  if (stored) return stored
  // 앞 4바이트 '%PDF' — 종전 bytes.toString('ascii', 0, 4) 대조와 같은 문이다. Node 의 ascii 해독은
  // 각 바이트의 최상위 비트를 지우므로 여기서도 & 0x7f 로 같게 맞춘다.
  if (bytes.length >= 4
    && (bytes[0] & 0x7f) === 0x25 && (bytes[1] & 0x7f) === 0x50
    && (bytes[2] & 0x7f) === 0x44 && (bytes[3] & 0x7f) === 0x46) {
    return DOC_MIME_PDF
  }
  const mime = sniffDocMime(bytes)
  return isImageDocMime(mime) ? mime : DOC_MIME_UNKNOWN
}
