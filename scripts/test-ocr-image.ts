// AI 인식 사진 축소 규칙 회귀 — lib/ocrImage. 실패 시 exit 1.
// 실행: npx tsx scripts/test-ocr-image.ts
//
// 왜 고정하는가. 이 규칙이 흔들리면 큰 사진이 그대로 서버 액션에 실려 요청이 거부되고, 모바일에서는
// 탭이 죽어 **등록 폼에 입력하던 값이 통째로 사라진다**(긴급 신고 2026-09-03). 캔버스는 node 에
// 없으므로 인코딩 자체는 안 보고, 치수 계산과 폴백 상한만 못 박는다.
import { ocrTargetSize, ocrFallbackAllowed, OCR_PRESET, OCR_FALLBACK_MAX_BYTES } from '../lib/ocrImage'

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

// ── 폴백 상한 ─────────────────────────────────────────────────────
// 디코드를 못 하는 형식(구형 사파리 HEIC)에서만 원본을 보낸다. base64 팽창 1.37배를 얹어도
// 서버 액션 상한 10MB 아래에 남는 선이다.
eq('상한은 6MB', OCR_FALLBACK_MAX_BYTES, 6 * 1024 * 1024)
eq('상한 아래는 허용', ocrFallbackAllowed(5 * 1024 * 1024), true)
eq('상한과 같으면 허용', ocrFallbackAllowed(OCR_FALLBACK_MAX_BYTES), true)
eq('상한을 넘으면 거부', ocrFallbackAllowed(OCR_FALLBACK_MAX_BYTES + 1), false)
// 실제 위험 구간 — 8MB 사진은 base64 로 약 11MB 라 10MB 한도를 넘는다.
eq('8MB 사진은 거부(base64 로 한도 초과)', ocrFallbackAllowed(8 * 1024 * 1024), false)
eq('상한 * 1.37 이 10MB 아래', OCR_FALLBACK_MAX_BYTES * 1.37 < 10 * 1024 * 1024, true)

console.log(`\nAI 인식 사진 축소 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const m of fails) console.error(`  - ${m}`)
if (fails.length > 0) process.exit(1)
