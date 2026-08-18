// 환경설정 탭 키 정본 — 서버(page.tsx 딥링크 검증)와 클라이언트(SettingsForm)가 공유한다.
// 'use client' 파일이 내보낸 함수를 서버가 호출하면 빌드는 통과하고 실행에서만 터진다
// (2026-08-18 /settings 전면 불능 사고 — isSettingsTab 이 SettingsForm 안에 있었다).
// 라벨은 화면 몫이라 SettingsForm 의 TABS 에 남는다. 키를 더할 때 두 곳을 함께 고친다.
export type SettingsTab = 'basic' | 'room' | 'finance' | 'members' | 'contract' | 'website' | 'appearance' | 'data'

export const SETTINGS_TAB_KEYS: readonly SettingsTab[] = [
  'basic', 'room', 'finance', 'members', 'contract', 'website', 'appearance', 'data',
]

/** ?tab= 딥링크 검증 — 서버가 첫 탭을 정할 때 쓴다. */
export function isSettingsTab(v: string | undefined): v is SettingsTab {
  return !!v && (SETTINGS_TAB_KEYS as readonly string[]).includes(v)
}
