// 계약 단위 패널(보증금·이용료 정산)의 인라인 폼 스타일 정본 — 두 카드가 같은 문자열을 쓴다.
//
// 원래 DepositStatusPanel 안에 있던 상수를 그대로 옮겼다(문자열 불변). 이용료 정산 카드가 바로
// 아래에 서면서 같은 폼 문법이 둘이 됐고, 한쪽에만 복사해 두면 다음 패스에서 갈린다.
//
// min-h 만으로 44/40 을 만드는 문법은 inventory/assets 의 DATE_FIELD_CLS 가 쓰는 검증된 자다
// (inline-flex 를 얹으면 DatePicker 트리거의 truncate 가 죽는다).
// 포커스는 focus 가 아니라 focus-visible 이다 — 트리거가 button 이라 손가락으로 열고 닫은 뒤에도
// 링이 남는다. 보더 색과 링을 둘 다 거는 이유는 링(rgba 코랄 12%)이 다크 배경에서 안 보이기 때문이다.
// 보더 **색**은 베이스에 넣지 않는다. 같은 속성 유틸리티 둘을 한 className 에 나란히 두면
// 승자가 문자열 순서가 아니라 스타일시트 순서로 정해진다 — 빌드된 CSS 에서 warm-border 가
// tc 보다 뒤에 있어 오류 보더가 **항상** 졌다(§12 에러 표기가 죽은 코드였다).
export const inputBase = 'w-full bg-[var(--canvas)] border rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors'
export const inputCls = `${inputBase} border-[var(--warm-border)]`
export const inputErrCls = `${inputBase} border-[var(--tc)]`
// 폼 라벨 정본(§12 — 12px / 500 / --ink-s). 종전 10.5px --warm-muted 는 크기·굵기·색 셋 다 어긋났다.
export const labelCls = 'text-xs font-medium text-[var(--warm-mid)]'
// 인라인 폼 껍데기 — 표면을 한 단 올린다. 종전 --canvas 는 안의 입력과 같은 토큰이라
// 다크에서 페이지·컨테이너·입력이 셋 다 #000 이고 보더 대비가 1.11:1 이었다(폼이 안 보인다).
// --cream-soft 는 토큰 쌍이 갖춰져 있어(라이트 #f5ede0 · 다크 #261C14) 양 모드에서 산다.
// 부수 효과로 라벨(--warm-mid) 대비가 4.12:1 에서 4.74:1 로 올라 §28 본문 기준을 넘긴다.
export const formBoxCls = 'space-y-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream-soft)] px-2.5 py-2'
