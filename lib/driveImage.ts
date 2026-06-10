// 클라이언트 안전 Drive 이미지 유틸 — 서버 전용(googleapis) 의존 없음.
// lib/google-drive.ts 는 googleapis 를 import 하므로 클라이언트 컴포넌트에서 못 가져옴 → 순수 유틸만 분리.

// 고해상도 직접 URL — lh3.googleusercontent.com 은 리디렉트 없이 `access-control-allow-origin: *` 를
// 보내므로 WebGL(360 파노라마) 텍스처 로드에 안전. drive.google.com/thumbnail 은 302 리디렉트라 부적합.
export function driveImageUrl(fileId: string, sizePx = 2048): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${sizePx}`
}

// 파일명에 360/파노라마 단서가 있으면 360(equirectangular) 사진으로 추정.
export function looksLike360(name: string | null | undefined): boolean {
  return /360|파노라마|pano|equirect/i.test(name ?? '')
}
