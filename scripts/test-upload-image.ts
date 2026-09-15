// 업로드 정규화 규칙 회귀 — lib/uploadImage. 실패 시 exit 1.
// 실행: npx tsx scripts/test-upload-image.ts
//
// 왜 고정하는가(2026-09-16). 아이폰 HEIC 가 그대로 저장되면 사업자등록증은 열리지 않는 첨부로
// 나가고, 도장은 실거주 확인서 **발급 자체를 실패시킨다**. 그래서 이 파일이 지켜야 할 것은
// "바꿨는가" 가 아니라 **"못 바꿨을 때 원본이 새어 나가지 않는가"** 다.
//
// node 에는 createImageBitmap·canvas 가 없다. 그 덕에 디코드 실패 분기를 공짜로 재현할 수 있어
// **"실패하면 던진다"** 를 여기서 그대로 못 박는다(원본을 돌려주는 순간 빨개진다). 픽셀을 만드는
// 단계는 못 보지만, 그 뒤 pdf-lib 단계는 node 에서도 진짜로 돈다 — 1장 고정과 용지 비율은 실물로 잰다.
import {
  fileToUploadPdf, fileToUploadImage, imageToSinglePagePdf, uploadPdfPageSize, swapExt,
  UPLOAD_DECODE_FAIL, UPLOAD_DOC_MAX_EDGE, UPLOAD_IMAGE_MAX_EDGE,
} from '../lib/uploadImage'
import { PDFDocument } from 'pdf-lib'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const near = (name: string, got: number, want: number, tol = 0.01) => eq(name, Math.abs(got - want) < tol, true)

// 4x2 짜리 진짜 JPEG(메타데이터 제거, 640바이트). pdf-lib 의 embedJpg 는 파서라 가짜 바이트로는
// 못 돈다 — 한 장 고정·용지 비율을 실물로 재려면 진짜 JPEG 이 하나 있어야 한다.
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAACAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwDxeiiivx8/0YP/2Q=='
const TINY_JPEG = new Uint8Array(Buffer.from(TINY_JPEG_B64, 'base64'))

const pdfFile = (name = 'a.pdf', type = 'application/pdf') =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])], name, { type })

// ── 이름 ──────────────────────────────────────────────────────────
// 바이트를 바꿔 놓고 이름이 .HEIC 로 남으면 Drive 저장 이름이 거짓말을 한다.
eq('확장자를 갈아 끼운다', swapExt('IMG_0042.HEIC', 'pdf'), 'IMG_0042.pdf')
eq('확장자가 없으면 붙인다', swapExt('스캔본', 'pdf'), '스캔본.pdf')
eq('점이 여럿이면 마지막만', swapExt('a.b.heic', 'png'), 'a.b.png')
eq('이름이 비면 기본 이름', swapExt('', 'pdf'), 'upload.pdf')

// ── 용지 비율 ─────────────────────────────────────────────────────
// **비율은 이미지 그대로다.** A4 에 억지로 끼우면 흰 띠가 생기거나 잘린다.
{
  const p = uploadPdfPageSize(2048, 1536)
  near('가로가 길면 긴 변이 A4 긴 변', p.w, 841.89)
  near('비율 보존(가로)', p.w / p.h, 2048 / 1536)
  const q = uploadPdfPageSize(1536, 2048)
  near('세로가 길면 세로가 A4 긴 변', q.h, 841.89)
  near('비율 보존(세로)', q.w / q.h, 1536 / 2048)
  const s = uploadPdfPageSize(1000, 1000)
  near('정사각은 정사각 용지', s.w / s.h, 1)
}

// ── 한 장 고정 ────────────────────────────────────────────────────
async function pdfPins() {
  const out = await imageToSinglePagePdf(TINY_JPEG, 2048, 1536)
  const doc = await PDFDocument.load(out)
  // 사진 한 장은 종이 한 장이다 — 장수가 늘면 스캔 계약서 판본 수까지 흔들린다.
  eq('페이지는 언제나 하나', doc.getPageCount(), 1)
  const page = doc.getPages()[0]
  near('용지 긴 변이 A4 긴 변', page.getWidth(), 841.89)
  near('용지 비율 = 이미지 비율', page.getWidth() / page.getHeight(), 2048 / 1536)
}

// ── 디코드 실패는 던진다(원본 통과 금지) ────────────────────────────
// **이 절이 이번 작업의 본체다.** node 에 createImageBitmap 이 없어 여기 오면 반드시 던져야 한다.
// 원본 File 을 돌려주는 분기가 부활하면 그 바이트가 그대로 Drive 에 저장된다.
async function throwPins() {
  const heic = new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])], 'IMG_0042.HEIC', { type: '' })
  let threw = ''
  let leaked: unknown = null
  try { leaked = await fileToUploadPdf(heic) } catch (e) { threw = (e as Error).message }
  eq('HEIC 를 못 바꾸면 던진다(PDF 입구)', threw, UPLOAD_DECODE_FAIL)
  eq('원본이 새어 나가지 않는다(PDF 입구)', leaked, null)

  threw = ''; leaked = null
  try { leaked = await fileToUploadImage(heic) } catch (e) { threw = (e as Error).message }
  eq('HEIC 를 못 바꾸면 던진다(이미지 입구)', threw, UPLOAD_DECODE_FAIL)
  eq('원본이 새어 나가지 않는다(이미지 입구)', leaked, null)

  // 사람 말이어야 한다 — humanError 가 한글이 아닌 메시지를 버리고 폴백으로 갈아 끼운다.
  eq('안내 문구는 한국어', /[가-힣]/.test(UPLOAD_DECODE_FAIL), true)
}

// ── 이미 옳은 형식은 그대로 ────────────────────────────────────────
async function passThroughPins() {
  const same = await fileToUploadPdf(pdfFile())
  eq('PDF 는 변환하지 않는다', same.converted, false)
  eq('PDF 는 같은 File 그대로', same.file instanceof File, true)
  eq('PDF 형식 유지', same.file.type, 'application/pdf')

  // 파일 앱에서 고른 파일은 type 이 빈 문자열이다 — 그대로 올리면 Content-Type 이 빈다.
  const noType = await fileToUploadPdf(pdfFile('스캔본', ''))
  eq('type 이 비어도 PDF 로 채운다', noType.file.type, 'application/pdf')
  eq('빈 type 도 변환은 아니다', noType.converted, false)
  eq('이름에 확장자가 붙는다', noType.file.name, '스캔본.pdf')

  const jpg = new File([TINY_JPEG], 'stamp.jpg', { type: 'image/jpeg' })
  const keep = await fileToUploadImage(jpg)
  eq('JPEG 도장은 다시 그리지 않는다', keep.converted, false)
  eq('JPEG 도장은 같은 File', keep.file === jpg, true)

  // **바이트가 권위다** — 이름·type 이 PNG 라고 우겨도 내용이 JPEG 이면 JPEG 이다.
  const lying = new File([TINY_JPEG], 'stamp.png', { type: 'image/png' })
  const fixed = await fileToUploadImage(lying)
  eq('거짓 이름은 바이트가 이긴다', fixed.file.type, 'image/jpeg')
  eq('거짓 이름도 다시 그리지는 않는다', fixed.converted, false)

  // PDF 를 도장 자리에 넣으면 디코드 단계에서 걸린다(그림이 될 수 없는 바이트다).
  let threw = ''
  try { await fileToUploadImage(pdfFile()) } catch (e) { threw = (e as Error).message }
  eq('도장 자리에 PDF 는 못 들어간다', threw, UPLOAD_DECODE_FAIL)
}

// ── 최대 변 ───────────────────────────────────────────────────────
// 종이가 될 사진은 잔글자(사업자번호·업태)를 남겨야 해서 크고, 그림으로 얹힐 사진은 PNG 로
// 나가므로 작아야 한다(2048px PNG 는 5MB 상한을 넘는다).
eq('종이용 최대 변은 2048', UPLOAD_DOC_MAX_EDGE, 2048)
eq('그림용 최대 변은 1024', UPLOAD_IMAGE_MAX_EDGE, 1024)
eq('그림용이 종이용보다 작다', UPLOAD_IMAGE_MAX_EDGE < UPLOAD_DOC_MAX_EDGE, true)

void (async () => {
  await pdfPins()
  await throwPins()
  await passThroughPins()
  console.log(`\n업로드 정규화 회귀: ${pass} 통과 / ${fails.length} 실패`)
  for (const m of fails) console.error(`  - ${m}`)
  if (fails.length) process.exit(1)
})()
