// 보관 위치 숨김 정본(lib/locationClose) 진리표 — 허브 승격 값·수량 조사·숨김 이관 메모 읽기. DB 불필요.
//
// 허브 승격 값은 값 대조로 잘 안 잡힌다. 새 창고가 영업장 기본 창고일 때 명시값을 박아도 오늘 잔량은 똑같고, 나중에
// 영업장 기본 창고를 바꾸는 날 이 품목만 옛 곳에 남아서야 드러난다(쌀처럼 기본 창고를 따르던 품목). 그래서 박제한다.
import { hubAfterClose, withQtyParticle, parseHideTransferMemo, HIDE_MEMO_PREFIX, stockedHideDenied } from '../lib/locationClose'

let pass = 0
const fails: string[] = []
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else fails.push(`${label}: 기대 ${w} / 실제 ${g}`)
}

// ── ① 허브 승격 값(결정 7) ───────────────────────────────────────────
const DEF = 'loc-603'   // 영업장 기본 창고
eq('①-1 새 창고가 기본 창고면 null(따라가기 유지)', hubAfterClose(DEF, DEF), null)
eq('①-2 새 창고가 기본 창고가 아니면 명시', hubAfterClose('loc-office', DEF), 'loc-office')
eq('①-3 영업장 기본 창고가 없으면 명시', hubAfterClose('loc-office', null), 'loc-office')
// 쌀 시나리오: hubLocationId null 로 415(기본 창고)를 따르던 품목이 415 를 숨기고 603 으로 옮긴다.
// 603 이 기본 창고가 아니면 603 을 명시해야 한다(null 이면 폴백이 닫힌 415 를 건너뛰어 엉뚱한 곳이 창고가 될 수 있다).
eq('①-4 쌀 415 숨김, 603 이 기본 창고 아님', hubAfterClose('loc-603', 'loc-415'), 'loc-603')

// ── ② 수량 뒤 조사 ───────────────────────────────────────────────────
eq('②-1 kg 은 킬로그램(받침 있음)', withQtyParticle('20kg', '이/가'), '20kg이')
eq('②-2 kg 을/를', withQtyParticle('20kg', '을/를'), '20kg을')
eq('②-3 kg 은/는', withQtyParticle('20kg', '은/는'), '20kg은')
eq('②-4 L 는 리터(받침 없음)', withQtyParticle('3L', '이/가'), '3L가')
eq('②-5 ml 을/를', withQtyParticle('500ml', '을/를'), '500ml를')
eq('②-6 한글 단위는 정본 그대로(개)', withQtyParticle('12개', '이/가'), '12개가')
eq('②-7 한글 단위는 정본 그대로(롤)', withQtyParticle('4롤', '은/는'), '4롤은')
eq('②-8 단위 없는 숫자는 소리(삼)', withQtyParticle('3', '이/가'), '3이')
eq('②-9 모르는 영문 단위는 정본 규칙(받침 없음)', withQtyParticle('2box', '이/가'), '2box가')
eq('②-10 대문자 KG 도 같다', withQtyParticle('20KG', '이/가'), '20KG이')

// ── ③ 숨김 이관 메모 읽기 ────────────────────────────────────────────
eq('③-1 기본 꼴', parseHideTransferMemo(`${HIDE_MEMO_PREFIX}4층 415호 창고에서 603호 창고로 20 이관`), { toPathName: '603호 창고', qty: 20 })
eq('③-2 으로', parseHideTransferMemo(`${HIDE_MEMO_PREFIX}4층 주방에서 4층 사무실으로 1.5 이관`), { toPathName: '4층 사무실', qty: 1.5 })
eq('③-3 공백 든 경로', parseHideTransferMemo(`${HIDE_MEMO_PREFIX}4층 김치냉장고 상단에서 5층 주방 김치냉장고 하단으로 7 이관`), { toPathName: '5층 주방 김치냉장고 하단', qty: 7 })
eq('③-4 다른 메모는 null(이동)', parseHideTransferMemo('이동: 4층 주방 → 5층 주방 3'), null)
eq('③-5 빈 메모 null', parseHideTransferMemo(null), null)
eq('③-6 꼬리 없는 꼴 null', parseHideTransferMemo(`${HIDE_MEMO_PREFIX}4층 415호 창고`), null)

// ── ④ 재고 남은 위치 거부 문장(캡션·서버 한 벌, 독립 검수 차단 1) ───────────────
// 옮길 위치가 없을 때 안내대로 하면 실제로 숨길 수 있어야 한다. 칸을 끈 채 저장하라고 하면 서버가 거부한다.
eq('④-1 옮길 위치 없음: 켠 채로 저장한 뒤 여기서 옮긴다', stockedHideDenied('4층 415호 창고', '20kg이', false),
  '4층 415호 창고에 20kg이 남아 있어 숨길 수 없습니다 · 이 칸은 켠 채로 옮길 위치를 하나 더 켜고 저장하면 여기서 옮길 수 있습니다')
eq('④-2 옮길 위치 있음(서버): 옮기고 숨기기 링크를 가리킨다', stockedHideDenied('4층 415호 창고', '재고가', true),
  "4층 415호 창고에 재고가 남아 있어 뗄 수 없습니다 · 보관 위치 칩 아래 '옮기고 숨기기'로 옮기면 됩니다")
eq('④-3 끈 채로 저장하라는 옛 거짓 안내가 없다', /켜고 저장하면 됩니다$/.test(stockedHideDenied('A', '3개가', false)), false)

if (fails.length) {
  for (const f of fails) console.error(`FAIL  ${f}`)
  console.error(`\n[위치 숨김 정본] 통과 ${pass} / 실패 ${fails.length}`)
  process.exit(1)
}
console.log(`[위치 숨김 정본] 통과 ${pass} / 실패 0`)
