// §16 적용취소 아이콘 정본 — rotate-ccw 14px. 원위치 진입점이 모두 이 하나를 쓴다.
//
// 왜 정본이 따로 서는가. 같은 SVG 가 화면마다 손으로 베껴져 있었다. 한 벌이 크기나 stroke 를
// 바꾸면 같은 뜻의 아이콘이 두 모양으로 서고, 그 어긋남은 눈에 안 띄는 채로 남는다.
// 여기가 유일한 출처이고, 그물(scripts/test-field-override-list.ts 등)이 다시 베끼는 것을 막는다.

/** §16 적용취소 아이콘 — rotate-ccw 14px. Btn 안에 넣으면 BASE 의 gap-1.5 가 §16 의 6px 간격이다. */
export const RotateCcw = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
  </svg>
)
