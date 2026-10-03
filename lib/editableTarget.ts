// 소프트 키보드를 부르는 요소인지 판정하는 술어 — 키보드 축이 이 하나만 쓴다.
//
// 왜 따로 뺐나. 종전에는 ViewportOffsetGuard 안에만 있었는데, 복귀 재동기화가 "포커스가 없으면
// 키보드도 없다"를 함께 물어야 해서 소비자가 둘이 됐다. 판정이 두 곳에 생기면 한쪽만 참인
// 구간에서 어긋난다(ViewportOffsetGuard 주석의 '판정은 한 곳'과 같은 이유).

export function isEditableTarget(t: EventTarget | null): t is HTMLElement {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
    // select 도 포함한다 — iOS 피커 휠도 visual viewport 를 줄인다
    || t instanceof HTMLSelectElement
    || (t instanceof HTMLElement && t.isContentEditable)
}

/**
 * 지금 편집 요소에 포커스가 있는가 — 없으면 키보드도 없다.
 *
 * 복귀 재동기화가 이것을 묻는다. 앱 전환·잠금에서 돌아온 직후 프레임의 visualViewport 는 아직
 * 옛 값을 내는데, 그때 아무 칸에도 서 있지 않다면 작게 온 띠는 전부 낡은 값이다.
 */
export function editableFocused(): boolean {
  if (typeof document === 'undefined') return false
  return isEditableTarget(document.activeElement)
}

/**
 * 지금 소프트 키보드가 떠 있을 **수 있는가** — 편집 요소, 또는 iframe 에 포커스가 있다.
 *
 * editableFocused 와 다른 점은 iframe 하나다. iframe 안쪽 칸에 선 포커스는 바깥 문서에서
 * `activeElement === <iframe>` 으로만 보인다(PeekSheet). 띠 타당성 관문(lib/modalViewport
 * phantomKeyboardGap)이 이것을 묻는다 — iframe 을 '칸 없음'으로 치면 그 안에서 키보드가 서는
 * 진짜 축소를 낡은 값으로 거부해 키보드가 칸을 덮는다. 거부를 피하는 쪽으로만 넓힌다(2026-10-03).
 */
export function keyboardCapableFocus(): boolean {
  if (typeof document === 'undefined') return false
  const a = document.activeElement
  return isEditableTarget(a) || a instanceof HTMLIFrameElement
}
