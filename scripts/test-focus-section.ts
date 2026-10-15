// 알림 딥링크 훅(lib/useFocusSection) 행동 그물. 글자 대조가 아니라 훅을 그려 보고 몇 번 돌았는지 센다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.focus-section.json scripts/test-focus-section.ts
//
// 지키는 의미(2026-10-15 비품 수령 3차 검수 참고).
//   1. 부르는 쪽이 인라인 prepare 를 넘겨도 같은 URL 에서는 효과가 다시 돌지 않는다(replace·스크롤 두 번 금지).
//   2. prepare 는 replace 보다 먼저, 받은 id 로 불린다. 늘 최신 prepare 가 불린다.
//   3. 파라미터를 소진해 효과가 다시 도는 회차에는 기다리던 스크롤을 거두지 않는다(연 보기로 가는 스크롤이 산다).
//   4. 화면을 떠나거나 새 딥링크가 오면 기다리던 스크롤을 거둔다. 요소가 끝내 없으면 열한 프레임 뒤 그친다.
import { render, unmount, nav, setUrl } from './focus-section-stubs'
import { useFocusSection, runFocusSection } from '../lib/useFocusSection'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

// ── 화면 대역. 프레임 큐·요소 목록·스크롤 기록
let frames: { h: number; cb: () => void }[] = []
let nextH = 1
const cancelled: number[] = []
const present = new Set<string>()
const scrolled: string[] = []
const g = globalThis as unknown as Record<string, unknown>
g.requestAnimationFrame = (cb: () => void) => { const h = nextH++; frames.push({ h, cb }); return h }
g.cancelAnimationFrame = (h: number) => { cancelled.push(h); frames = frames.filter(f => f.h !== h) }
g.document = { getElementById: (id: string) => (present.has(id) ? { scrollIntoView: () => { scrolled.push(id) } } : null) }
const tick = (n = 1) => { for (let k = 0; k < n; k++) { const now = frames; frames = []; for (const f of now) f.cb() } }
const reset = () => { unmount(); frames = []; cancelled.length = 0; present.clear(); scrolled.length = 0; nav.replaced.length = 0 }

// ── 1·2. 인라인 prepare, 같은 URL 재렌더에서 다시 돌지 않는다
{
  reset()
  setUrl('focus=inventory-lowstock&month=2026-10')
  const prepared: string[] = []
  let view = 'location'
  const Comp = () => useFocusSection({ prepare: id => { prepared.push(`${view}:${id}`); if (id === 'inventory-lowstock') view = 'item' } })
  render(Comp)
  eq('1 첫 렌더에 prepare 한 번(받은 id 로)', prepared, ['location:inventory-lowstock'])
  eq('1 replace 한 번, 다른 파라미터는 지킨다', nav.replaced, ['?month=2026-10'])
  // prepare 가 상태를 바꿔 다시 그린다. URL 은 아직 그대로(새 함수 정체성의 인라인 prepare)
  render(Comp)
  render(Comp)
  eq('1 같은 URL 재렌더 두 번에도 prepare 는 한 번', prepared.length, 1)
  eq('1 같은 URL 재렌더 두 번에도 replace 는 한 번', nav.replaced.length, 1)
  // 보기가 열려 요소가 생긴 뒤 프레임이 돈다
  present.add('inventory-lowstock')
  tick()
  eq('2 연 보기의 요소로 한 번 스크롤', scrolled, ['inventory-lowstock'])
  tick(3)
  eq('2 스크롤은 한 번뿐', scrolled.length, 1)
}

// ── 3. 소진 회차(focus 없음)에는 기다리던 스크롤을 거두지 않는다
{
  reset()
  setUrl('focus=assets-pending')
  const Comp = () => useFocusSection({ prepare: () => {} })
  render(Comp)
  tick(2)                            // 아직 요소 없음(보기 그리는 중)
  setUrl(nav.replaced[0].slice(1))   // replace 가 URL 을 바꿔 효과가 다시 돈다(focus 없음)
  render(Comp)
  eq('3 소진 회차는 프레임을 거두지 않는다', cancelled.length, 0)
  present.add('assets-pending')
  tick()
  eq('3 소진 뒤에도 기다리던 스크롤이 닿는다', scrolled, ['assets-pending'])
  eq('3 replace 는 한 번', nav.replaced.length, 1)
}

// ── 2'. 최신 prepare 가 불린다
{
  reset()
  setUrl('')
  const calls: string[] = []
  let which = 'A'
  const Comp = () => useFocusSection({ prepare: id => { calls.push(`${which}:${id}`) } })
  render(Comp)
  which = 'B'
  setUrl('focus=x')
  render(Comp)
  eq("2' 새 딥링크에는 그 렌더의 prepare 가 불린다", calls, ['B:x'])
}

// ── 4. 화면을 떠나면 거둔다
{
  reset()
  setUrl('focus=inventory-pending')
  const Comp = () => useFocusSection()
  render(Comp)
  tick(2)
  unmount()
  present.add('inventory-pending')
  tick(5)
  eq('4 떠난 뒤에는 스크롤하지 않는다', scrolled, [])
  eq('4 떠날 때 기다리던 프레임을 거둔다', cancelled.length > 0, true)
}

// ── 4'. 새 딥링크가 오면 앞 것을 거둔다
{
  reset()
  setUrl('focus=a')
  const Comp = () => useFocusSection()
  render(Comp)
  setUrl('focus=b')
  render(Comp)
  present.add('a'); present.add('b')
  tick(3)
  eq("4' 새 딥링크만 스크롤한다", scrolled, ['b'])
}

// ── 4''. 요소가 끝내 없으면 열한 프레임 뒤 그친다(runFocusSection 단독)
{
  let n = 0
  const q: (() => void)[] = []
  const stop = runFocusSection({
    id: 'none', search: 'focus=none', prepare: () => {}, replace: () => {},
    find: () => { n++; return null }, raf: cb => { q.push(cb); return q.length }, cancelRaf: () => {},
  })
  while (q.length) q.shift()!()
  eq("4'' 요소가 없으면 열한 번 보고 그친다", n, 11)
  eq("4'' focus 가 있으면 정리 함수를 준다", typeof stop, 'function')
  eq("4'' focus 가 없으면 아무것도 안 한다", runFocusSection({ id: null, search: '', prepare: () => { throw new Error('불림') }, replace: () => { throw new Error('불림') }, find: () => null, raf: () => 0, cancelRaf: () => {} }), undefined)
}

// ── 2''. prepare 가 replace 보다 먼저
{
  const order: string[] = []
  runFocusSection({ id: 'z', search: 'focus=z', prepare: () => order.push('prepare'), replace: () => order.push('replace'), find: () => null, raf: () => 0, cancelRaf: () => {} })
  eq("2'' prepare 가 replace 보다 먼저", order, ['prepare', 'replace'])
}

console.log(`[딥링크 훅 행동] 통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
