// 환경설정 탭 키 정본 — 서버(page.tsx 딥링크 검증)와 클라이언트(SettingsForm)가 공유한다.
// 'use client' 파일이 내보낸 함수를 서버가 호출하면 빌드는 통과하고 실행에서만 터진다
// (2026-08-18 /settings 전면 불능 사고 — isSettingsTab 이 SettingsForm 안에 있었다).
// 라벨은 화면 몫이라 SettingsForm 의 TABS 에 남는다. 키를 더할 때 두 곳을 함께 고친다.
//
// 2026-08-19 IA 2단계(운영자 승인) — 여덟 칸의 뜻이 바뀌었다. 'room'(호실 설정)과
// 'finance'(수익·지출) 두 탭이 'pricing'(요금·정책)과 'options'(분류 관리)로 다시 나뉘었다.
// 옛 키를 그대로 두면 결제 수단이 'room' 안에, 방타입이 'finance' 밖에 있는 셈이라
// 다음 사람이 코드를 거꾸로 읽는다. 앱 안에서 이 두 키를 가리키는 링크는 없었고
// (딥링크는 ?tab=website 둘뿐), 모르는 값은 종전대로 기본정보로 착지한다.
export type SettingsTab =
  | 'basic'      // 기본정보
  | 'pricing'    // 요금·정책
  | 'options'    // 분류 관리
  | 'contract'   // 계약서·서류
  | 'website'    // 웹사이트
  | 'members'    // 멤버 관리
  | 'data'       // 데이터·도구
  | 'appearance' // 화면

// 배열 순서가 곧 탭 줄 순서다 — SettingsForm 의 TABS 와 같은 순서를 지킨다.
export const SETTINGS_TAB_KEYS: readonly SettingsTab[] = [
  'basic', 'pricing', 'options', 'contract', 'website', 'members', 'data', 'appearance',
]

/** ?tab= 딥링크 검증 — 서버가 첫 탭을 정할 때 쓴다. */
export function isSettingsTab(v: string | undefined): v is SettingsTab {
  return !!v && (SETTINGS_TAB_KEYS as readonly string[]).includes(v)
}
