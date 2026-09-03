// 서버 액션이 FormData 로 받은 AI 인식 사진을 꺼내 Gemini 용 base64 로 되읽는 정본.
//
// 사진 바이트는 클라이언트에서 문자열 인자로 오지 않는다(lib/ocrImage 머리 참고 — 서버 액션 인자
// 디코더가 문자열 1,000,000 자에서 터진다). 대신 FormData 파일로 와서 여기서 한 번만 base64 로
// 바뀐다. 이 파일에 'use server' 를 붙이면 안 된다 — 붙이는 순간 클라이언트가 직접 부를 수 있는
// 액션이 되고, check-server-action-exports 가 지키는 그 사고 계열에 들어간다.

import 'server-only'
import { OCR_FORM_FIELD, OCR_FALLBACK_MAX_BYTES } from './ocrImage'

export async function readOcrImageForm(formData: FormData):
  Promise<{ ok: true; b64: string; mime: string } | { ok: false; error: string }> {
  const f = formData.get(OCR_FORM_FIELD)
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
  if (f.size > OCR_FALLBACK_MAX_BYTES) return { ok: false, error: '사진이 너무 커서 분석할 수 없습니다. 화면을 캡처해 다시 올려 주세요.' }
  return { ok: true, b64: Buffer.from(await f.arrayBuffer()).toString('base64'), mime: f.type || 'image/jpeg' }
}
