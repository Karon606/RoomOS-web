// 재고 추적 단위 전환 배선 감지(정적) · 실행: node scripts/check-track-unit-switch-wiring.mjs. 위반 시 exit 1
//
// 왜(운영자 승인 2026-11-02). 진리표(test-track-unit-switch)·통합(test-track-unit-switch-flow)은 판정과 서버 액션만 본다.
// 품목 설정이 다시 updateTrackedItem 으로 trackUnit 을 보내거나, 서버가 그 길로 단위만 바꾸면 둘 다 통과한 채로
// 옛 단위 점검 위에 새 단위 구매가 더해지는 결함이 돌아온다. 그 자리들이 꽂혀 있는지 모양으로 본다.
//
// 축
//   ⓐ updateTrackedItem 은 단위가 다르면 거부하고 trackUnit 을 쓰지 않는다
//   ⓑ switchTrackUnit 은 정본 배수(planTrackUnitSwitch)로 한 트랜잭션에서 값을 바꾸고 카드 단위를 CAS 로 고친다
//   ⓒ 적용취소는 배수를 다시 세고(토큰을 믿지 않는다) 전환 뒤 기록·합계 변화를 거부한다
//   ⓓ 품목 설정 화면은 토글에서 미리보기를, 저장에서 전환 + 적용취소 토스트를 부르고 설정 저장에 trackUnit 을 싣지 않는다
//   ⓔ 거부 까닭은 토글 아래 WhyCaption 한 줄이다
import { readFileSync } from 'node:fs'

const inv = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
const ic = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')
const fails = []
const need = (name, cond) => { if (!cond) fails.push(name) }
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const next = src.indexOf('\nexport async function', start + header.length)
  return src.slice(start, next < 0 ? src.length : next)
}
function fn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const next = src.indexOf('\nfunction ', start + header.length)
  return src.slice(start, next < 0 ? src.length : next)
}

const upd = body(inv, 'export async function updateTrackedItem(')
need('ⓐ updateTrackedItem 이 다른 단위를 거부한다', /if \(data\.trackUnit && data\.trackUnit !== it\.trackUnit\) return \{ ok: false, error: TRACK_UNIT_VIA_SWITCH \}/.test(upd))
need('ⓐ updateTrackedItem 이 trackUnit 을 쓰지 않는다', !/trackUnit:\s+data\.trackUnit/.test(upd))

const sw = body(inv, 'export async function switchTrackUnit(')
need('ⓑ 전환이 정본 배수를 쓴다', /planTrackUnitSwitch\(\{/.test(sw))
need('ⓑ 읽기·판정·쓰기가 한 트랜잭션', /prisma\.\$transaction\(async tx =>/.test(sw) && /trackUnitFacts\(tx,/.test(sw))
need('ⓑ 값은 그 트랜잭션에서 바꾼다', /scaleStockValues\([\s\S]{0,200}?plan\.factor, tx\)/.test(sw))
need('ⓑ 카드 단위는 CAS(화면이 본 단위일 때만)', /tx\.trackedItem\.updateMany\(\{ where: \{ id, propertyId, trackUnit: expect\.from \}/.test(sw))

const un = body(inv, 'export async function undoSwitchTrackUnit(')
need('ⓒ 적용취소가 배수를 다시 센다', /const back = planTrackUnitSwitch\(\{ from: u\.to, to: u\.from/.test(un) && /close\(back\.factor \* u\.factor, 1\)/.test(un))
need('ⓒ 전환 뒤 기록이 있으면 거부', /createdAt > at/.test(un))
need('ⓒ 합계가 바뀌었으면 거부', /close\(sums\.checks, u\.sums\.checks\)/.test(un))

const form = fn(ic, 'function SettingsForm(')
need('ⓓ 토글이 미리보기를 부른다', /previewTrackUnitSwitch\(row\.id, v\)/.test(form) && /onChange=\{v => \{ if \(!unitAskPending\) pickTrackUnit\(v\) \}\}/.test(form))
need('ⓓ 저장이 전환을 부르고 적용취소를 단다', /switchTrackUnit\(row\.id, trackUnit, \{ from: row\.trackUnit \}\)/.test(form) && /undoSwitchTrackUnit\(undo\)/.test(form))
const updCall = form.slice(form.indexOf('await updateTrackedItem(row.id, {'), form.indexOf('})', form.indexOf('await updateTrackedItem(row.id, {')))
need('ⓓ 설정 저장에 trackUnit 을 싣지 않는다', updCall.length > 0 && !/trackUnit/.test(updCall))
need('ⓔ 거부 까닭은 WhyCaption', /unitAsk && !unitAsk\.ok && <WhyCaption id=\{`track-unit-why-\$\{row\.id\}`\}>\{unitAsk\.error\}<\/WhyCaption>/.test(form))

if (fails.length) {
  console.error(`[추적 단위 전환 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.error(`  ${f}`)
  process.exit(1)
}
console.log('[추적 단위 전환 배선] 축 ⓐ 설정 저장은 단위를 못 바꿈 · ⓑ 정본 배수·한 트랜잭션·CAS · ⓒ 적용취소 재계산·거부 · ⓓ 화면 미리보기·전환·적용취소 · ⓔ WhyCaption / 위반 0건')
