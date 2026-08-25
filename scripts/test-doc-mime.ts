// 저장 서류 형식 판정 회귀 — 실행: npx tsx scripts/test-doc-mime.ts
//
// 여기서 고정하는 것 셋(긴급 신고 2026-08-25, 419호 계약서가 깨진 pdf 로 도착한 사고).
//   · **판정은 바이트다** — 파일 이름이 .pdf 여도 내용이 JPEG 이면 image/jpeg 다.
//   · **모르면 모른다고 답한다** — 알 수 없는 바이트에 application/pdf 를 붙이지 않는다.
//     가짜 확장자를 붙이는 것이 이번 사고의 실체였다.
//   · **화이트리스트 밖은 octet-stream** — text/html·image/svg+xml 을 절대 만들지 않는다
//     (/api/doc-file 인라인 렌더의 스크립트 실행 면 차단).
import {
  sniffDocMime, extForDocMime, docMimeLabel, isImageDocMime, guessDocMimeByName,
  DOC_MIME_PDF, DOC_MIME_UNKNOWN,
} from '../lib/docMime'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const bytes = (...v: number[]) => new Uint8Array(v)
const asciiBytes = (s: string, pad = 0) =>
  new Uint8Array([...Array.from(s, c => c.charCodeAt(0)), ...new Array(pad).fill(0)])

// ── 매직 넘버 판정 ──────────────────────────────────────────────────
eq('PDF', sniffDocMime(asciiBytes('%PDF-1.7\n...')), DOC_MIME_PDF)
eq('PDF 앞에 BOM 이 붙어도', sniffDocMime(new Uint8Array([0xef, 0xbb, 0xbf, ...asciiBytes('%PDF-1.4')])), DOC_MIME_PDF)
eq('JPEG', sniffDocMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)), 'image/jpeg')
eq('PNG', sniffDocMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)), 'image/png')
eq('WebP', sniffDocMime(new Uint8Array([...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('WEBP')])), 'image/webp')
eq('HEIC', sniffDocMime(new Uint8Array([0, 0, 0, 0x18, ...asciiBytes('ftyp'), ...asciiBytes('heic')])), 'image/heic')
eq('GIF', sniffDocMime(asciiBytes('GIF89a')), 'image/gif')

// ── 모르는 바이트는 모른다고 답한다 ─────────────────────────────────
eq('알 수 없는 바이트', sniffDocMime(bytes(0x01, 0x02, 0x03, 0x04, 0x05)), DOC_MIME_UNKNOWN)
eq('너무 짧은 바이트', sniffDocMime(bytes(0x25, 0x50)), DOC_MIME_UNKNOWN)
eq('빈 바이트', sniffDocMime(new Uint8Array(0)), DOC_MIME_UNKNOWN)
// 화이트리스트 밖 — HTML·SVG 로 시작해도 그 mime 을 만들어 주지 않는다(인라인 렌더 방어)
eq('HTML 바이트는 octet-stream', sniffDocMime(asciiBytes('<!doctype html><script>')), DOC_MIME_UNKNOWN)
eq('SVG 바이트는 octet-stream', sniffDocMime(asciiBytes('<svg xmlns="http://')), DOC_MIME_UNKNOWN)
// ftyp 이어도 모르는 브랜드는 인정하지 않는다(mp4 등)
eq('ftyp isom 은 octet-stream', sniffDocMime(new Uint8Array([0, 0, 0, 0x18, ...asciiBytes('ftyp'), ...asciiBytes('isom')])), DOC_MIME_UNKNOWN)

// ── ArrayBuffer 도 같은 답 ─────────────────────────────────────────
eq('ArrayBuffer 입력', sniffDocMime(asciiBytes('%PDF-1.7').buffer as ArrayBuffer), DOC_MIME_PDF)

// ── 확장자·라벨 ────────────────────────────────────────────────────
eq('pdf 확장자', extForDocMime(DOC_MIME_PDF), 'pdf')
eq('jpeg 확장자는 jpg', extForDocMime('image/jpeg'), 'jpg')
eq('png 확장자', extForDocMime('image/png'), 'png')
// 모르는 형식에 .pdf 를 붙이지 않는다 — 이번 사고의 재발 방지선
eq('모르는 형식 확장자는 bin', extForDocMime(DOC_MIME_UNKNOWN), 'bin')
eq('PDF 라벨', docMimeLabel(DOC_MIME_PDF), 'PDF')
eq('JPEG 라벨', docMimeLabel('image/jpeg'), 'JPG')
eq('모르는 형식 라벨', docMimeLabel(DOC_MIME_UNKNOWN), '파일')

// ── 이미지 판정 ────────────────────────────────────────────────────
eq('JPEG 은 이미지', isImageDocMime('image/jpeg'), true)
eq('PDF 는 이미지 아님', isImageDocMime(DOC_MIME_PDF), false)
eq('모르는 형식은 이미지 아님', isImageDocMime(DOC_MIME_UNKNOWN), false)

// ── 이름 추정(바이트 없는 자리 전용) ────────────────────────────────
eq('이름 추정 jpeg', guessDocMimeByName('419호-미로노바 엘레나.jpeg'), 'image/jpeg')
eq('이름 추정 jpg', guessDocMimeByName('scan.JPG'), 'image/jpeg')
eq('이름 추정 pdf', guessDocMimeByName('계약서_20260825.pdf'), DOC_MIME_PDF)
eq('확장자 없으면 pdf 로 본다(앱 발급본 기본)', guessDocMimeByName('계약서'), DOC_MIME_PDF)
eq('빈 이름도 pdf', guessDocMimeByName(null), DOC_MIME_PDF)

console.log(`\n서류 형식 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
