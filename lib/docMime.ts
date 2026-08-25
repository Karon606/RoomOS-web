// 저장 서류 바이트의 실제 형식 판정 정본 — 메일 첨부·기기 공유·뷰어·파일 응답이 같은 판정을 쓴다.
//
// 왜 있나 (긴급 신고 2026-08-25, 419호). 저장 서류를 소비하는 자리가 전부 "서류는 PDF다"를
// 전제하고 있었다. 스캔 업로드본은 JPEG 인데 메일이 그것을 application/pdf · .pdf 이름으로
// 실어 보내 **받는 사람에게 깨진 계약서가 도착했다.** 같은 전제가 보기 화면(pdfjs 파싱 실패)·
// 기기 공유 사진 변환·단건 내보내기·인쇄·/api/doc-file 헤더까지 여섯 자리에 깔려 있었다.
// 한 자리만 고치면 나머지 다섯이 그대로 남는다 — 그래서 판정을 여기 하나로 모은다.
//
// **판정은 파일 이름이 아니라 바이트다.** 업로드 파일명은 사용자 입력이라 거짓일 수 있고
// 확장자가 없을 수도 있다. 이름 기반 추정은 아직 바이트를 손에 쥐지 않은 자리(초안 화면의
// 첨부 표기)에서만 쓰고, 실제로 내보내는 순간에는 언제나 이 스니핑이 최종 권위다.
//
// **화이트리스트 밖은 전부 application/octet-stream 이다.** text/html·image/svg+xml 을 절대
// 만들지 않는다 — /api/doc-file 이 그 헤더로 바이트를 돌려주면 인라인 렌더에서 스크립트가
// 실행되는 면이 생긴다(저장 파일은 업로드된 것이라 내용이 신뢰 대상이 아니다).
//
// 서버 쪽 lib/google-drive.sniffImageMime 과 논리가 겹치지만 그 파일은 googleapis 를 물고 있어
// 클라이언트가 임포트할 수 없다. 여기는 순수 함수만 둔다(브라우저·서버 공용).

export const DOC_MIME_PDF = 'application/pdf'
export const DOC_MIME_UNKNOWN = 'application/octet-stream'

/** 화면 표기용 짧은 이름 — 첨부 목록의 'PDF' 자리에 그린다. */
const LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/heic': 'HEIC',
  'image/gif': 'GIF',
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
}

const u8 = (bytes: ArrayBuffer | Uint8Array): Uint8Array =>
  bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)

const ascii = (b: Uint8Array, at: number, len: number): string =>
  Array.from(b.slice(at, at + len), c => String.fromCharCode(c)).join('')

/**
 * 바이트 앞머리의 매직 넘버로 실제 형식을 판정한다. 모르면 application/octet-stream.
 *
 * PDF 는 앞에 BOM·공백이 붙어 오는 실물이 있어 앞 4바이트 안에서 '%PDF' 를 찾는다(관대하게).
 * 나머지는 정확한 시그니처만 인정한다 — 애매하면 모른다고 답하는 쪽이 안전하다.
 */
export function sniffDocMime(bytes: ArrayBuffer | Uint8Array): string {
  const b = u8(bytes)
  if (b.length < 4) return DOC_MIME_UNKNOWN
  for (let off = 0; off <= 4 && off + 4 <= b.length; off++) {
    if (ascii(b, off, 4) === '%PDF') return DOC_MIME_PDF
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
  // HEIC 는 ftyp 박스 뒤 브랜드로 가른다(heic·heix·hevc·mif1).
  if (ascii(b, 4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1'].includes(ascii(b, 8, 4))) return 'image/heic'
  if (ascii(b, 0, 3) === 'GIF') return 'image/gif'
  return DOC_MIME_UNKNOWN
}

/** 이 형식의 파일 확장자 — 모르는 형식은 bin(가짜 .pdf 를 붙이지 않는다). */
export function extForDocMime(mime: string): string {
  return EXT[mime] ?? 'bin'
}

/** 화면에 적는 형식 이름 — 모르는 형식은 '파일'. */
export function docMimeLabel(mime: string): string {
  return LABEL[mime] ?? '파일'
}

/** 래스터 이미지인가 — 뷰어·공유가 PDF 경로 대신 이미지 경로로 갈지 가른다. */
export function isImageDocMime(mime: string): boolean {
  return mime.startsWith('image/')
}

/**
 * 파일 이름으로 형식을 추정한다 — **바이트가 아직 없는 자리 전용**(초안 화면의 첨부 표기).
 * 확장자가 없거나 모르는 값이면 PDF 로 본다: 앱 발급본이 전부 PDF 라 표기 기본값으로 맞고,
 * 실제 내보내기는 언제나 sniffDocMime 이 다시 판정하므로 이 추정이 틀려도 파일은 옳게 나간다.
 */
export function guessDocMimeByName(fileName: string | null | undefined): string {
  const ext = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (!ext) return DOC_MIME_PDF
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  const hit = Object.entries(EXT).find(([, e]) => e === ext)
  return hit ? hit[0] : DOC_MIME_PDF
}
