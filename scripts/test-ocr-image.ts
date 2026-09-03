// AI 인식 사진 축소 규칙 회귀 — lib/ocrImage. 실패 시 exit 1.
// 실행: npx tsx scripts/test-ocr-image.ts
//
// 왜 고정하는가. 이 규칙이 흔들리면 큰 사진이 그대로 서버 액션에 실려 요청이 거부되고, 모바일에서는
// 탭이 죽어 **등록 폼에 입력하던 값이 통째로 사라진다**(긴급 신고 2026-09-03). 캔버스는 node 에
// 없으므로 인코딩 자체는 안 보고, 치수 계산과 폴백 상한만 못 박는다.
import { ocrTargetSize, ocrFallbackAllowed, ocrForm, fileToOcrImage, OCR_PRESET, OCR_FALLBACK_MAX_BYTES, OCR_FORM_FIELD } from '../lib/ocrImage'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 프리셋 ────────────────────────────────────────────────────────
// 값을 셋으로 늘리지 않는다 — 두 값이 왜 다른지는 lib/ocrImage 주석에 있다.
eq('프리셋은 둘뿐', Object.keys(OCR_PRESET).sort(), ['document', 'receipt'])
eq('신분증·계약서는 2048', OCR_PRESET.document.maxEdge, 2048)
eq('영수증은 1600', OCR_PRESET.receipt.maxEdge, 1600)
eq('신분증 품질이 영수증보다 높다(잔글자)', OCR_PRESET.document.quality > OCR_PRESET.receipt.quality, true)

// ── 치수 ──────────────────────────────────────────────────────────
eq('가로가 긴 사진은 가로를 최대 변에 맞춘다', ocrTargetSize(4032, 3024, 2048), { w: 2048, h: 1536 })
eq('세로가 긴 사진은 세로를 맞춘다', ocrTargetSize(3024, 4032, 2048), { w: 1536, h: 2048 })
eq('정사각도 그대로 비율', ocrTargetSize(3000, 3000, 2048), { w: 2048, h: 2048 })
// **원본이 작으면 키우지 않는다** — 확대는 글자를 뭉갤 뿐 정보를 안 늘린다.
eq('작은 사진은 그대로', ocrTargetSize(800, 600, 2048), { w: 800, h: 600 })
eq('최대 변과 같으면 그대로', ocrTargetSize(2048, 1000, 2048), { w: 2048, h: 1000 })
// 0 으로 떨어지는 변이 없어야 한다 — 캔버스 폭 0 은 그리기 자체가 실패한다.
eq('극단적으로 납작해도 최소 1', ocrTargetSize(10000, 3, 2048), { w: 2048, h: 1 })

// ── 크기 상한 ─────────────────────────────────────────────────────
// FormData 는 base64 팽창 없이 실리므로 본문 상한 10MB 아래의 보수 여유선이다. 서버가 Gemini 에
// 넣을 때의 팽창 1.37배를 얹어도 8.2MB 라 Gemini 인라인 상한 아래에 남는다.
eq('상한은 6MB', OCR_FALLBACK_MAX_BYTES, 6 * 1024 * 1024)
eq('상한 아래는 허용', ocrFallbackAllowed(5 * 1024 * 1024), true)
eq('상한과 같으면 허용', ocrFallbackAllowed(OCR_FALLBACK_MAX_BYTES), true)
eq('상한을 넘으면 거부', ocrFallbackAllowed(OCR_FALLBACK_MAX_BYTES + 1), false)
eq('8MB 사진은 거부', ocrFallbackAllowed(8 * 1024 * 1024), false)
eq('상한 * 1.37 이 Gemini 인라인 상한 20MB 아래', OCR_FALLBACK_MAX_BYTES * 1.37 < 20 * 1024 * 1024, true)

// ── 전송 형태 ─────────────────────────────────────────────────────
// **여기가 이번 신고의 본체다.** 사진 바이트가 문자열 인자로 돌아오면 서버 액션 인자 디코더가
// 슬롯 1,000,000 개에서 던진다(base64 로 원본 약 730KB). FormData 파일로만 실어야 한다.
const small = new File([new Uint8Array(1024)], 'a.jpg', { type: 'image/jpeg' })
const fd = ocrForm(small)
eq('ocrForm 이 싼 것은 FormData', fd instanceof FormData, true)
// 리터럴로 못박는다. 상수를 통해 읽으면 필드명을 바꿔도 자기 일관성이라 안 걸리는데,
// 이 이름은 서버(readOcrImageForm)와 맺은 계약이라 한쪽만 바뀌면 사진이 조용히 사라진다.
eq('필드명은 image 고정', OCR_FORM_FIELD, 'image')
eq('그 이름으로 File 이 실린다', fd.get('image') instanceof File, true)
eq('실린 것은 넣은 File 그대로', fd.get('image') === small, true)

let threw = ''
try { ocrForm(new File([new Uint8Array(OCR_FALLBACK_MAX_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' })) }
catch (e) { threw = (e as Error).message }
eq('상한 초과는 사람 말로 던진다', /사진이 너무 커서/.test(threw), true)

// node 에는 createImageBitmap 이 없어 fileToOcrImage 가 항상 폴백 분기를 탄다. 그 분기가
// **원본 File 을 그대로** 돌려주는지 본다. 문자열화가 부활하면 여기서 걸린다.
async function asyncPins() {
  const back = await fileToOcrImage(small, 'document')
  eq('폴백은 원본 File 동일 객체', back.file === small, true)
  eq('폴백 mime 은 원본 것', back.mime, 'image/jpeg')
  // 파일 앱에서 고른 파일은 type 이 빈 문자열이라 HEIC 가 image/jpeg 로 잘못 라벨링됐다.
  const heic = new File([new Uint8Array(16)], 'IMG_0042.HEIC', { type: '' })
  eq('빈 type 은 확장자로 메운다', (await fileToOcrImage(heic, 'document')).mime, 'image/heic')
}

void asyncPins().then(() => {
  console.log(`\nAI 인식 사진 축소 회귀: ${pass} 통과 / ${fails.length} 실패`)
  for (const m of fails) console.error(`  - ${m}`)
  if (fails.length) process.exit(1)
})
