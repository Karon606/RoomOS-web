// 딥링크 훅(lib/useFocusSection) 행동 그물 전용 react·next/navigation 대역. 앱 코드는 이 파일을 import 하지 않는다.
//
// 훅을 진짜로 그리려면 DOM 이 필요한데 저장소에는 jsdom 이 없다. 그래서 훅이 쓰는 두 가지(useRef·useEffect)만
// React 규칙대로 흉내 낸다. 의존 배열을 Object.is 로 견주고, 바뀐 효과만 앞 정리를 돌린 뒤 다시 돌린다(배열이
// 없으면 매번). 효과는 선언 순서대로 돈다. 그물이 보는 것은 '어떤 렌더에서 효과가 다시 도는가' 하나다.
type EffectSlot = { kind: 'effect'; deps: unknown[] | undefined; cleanup?: (() => void) | void }
type RefSlot = { kind: 'ref'; value: { current: unknown } }
type Slot = RefSlot | EffectSlot
const state = { slots: [] as Slot[], i: 0, pending: [] as { slot: EffectSlot; fn: () => (() => void) | void }[] }

export function useRef<T>(init: T): { current: T } {
  const at = state.i++
  if (!state.slots[at]) state.slots[at] = { kind: 'ref', value: { current: init } }
  return (state.slots[at] as RefSlot).value as { current: T }
}
export function useEffect(fn: () => (() => void) | void, deps?: unknown[]): void {
  const at = state.i++
  const prev = state.slots[at] as EffectSlot | undefined
  const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => !Object.is(d, prev.deps![k]))
  const slot: EffectSlot = prev ?? { kind: 'effect', deps: undefined }
  state.slots[at] = slot
  if (changed) { slot.deps = deps; state.pending.push({ slot, fn }) }
}
/** 한 번 그린다(본문 실행 뒤 바뀐 효과를 선언 순서대로 돌린다). */
export function render(body: () => void): void {
  state.i = 0; state.pending = []
  body()
  for (const p of state.pending) { if (typeof p.slot.cleanup === 'function') p.slot.cleanup(); p.slot.cleanup = p.fn() }
}
/** 화면을 떠난다(모든 효과의 정리를 돈다). */
export function unmount(): void {
  for (const s of state.slots) if (s.kind === 'effect' && typeof s.cleanup === 'function') s.cleanup()
  state.slots = []
}

// ── next/navigation 대역. useSearchParams 는 URL 이 바뀔 때만 새 객체를 준다(Next 와 같다).
export const nav = { params: new URLSearchParams(''), replaced: [] as string[] }
const router = { replace: (url: string) => { nav.replaced.push(url) } }
export function useRouter() { return router }
export function useSearchParams() { return nav.params }
export function setUrl(search: string) { nav.params = new URLSearchParams(search) }
