// 운영/테스트 환경 판정 정본 — 발송 차단과 화면 표시가 반드시 여기 한 곳에서 나온다.
//
// 왜 긍정형인가
//   계획서는 `STAGING=1` 이면 막는 방식을 전제했다. 그러면 변수가 없을 때 false 로 떨어지고,
//   그 기본값이 **실제 발송**이다. 환경변수 누락·Vercel 스코프 오지정·오타가 전부 실발송으로
//   수렴한다. 그래서 '운영일 때만 보낸다'로 뒤집었다. VERCEL_ENV 는 Vercel 이 직접 넣는 값이라
//   사람이 빠뜨릴 수 없다.
//
// 로컬(next dev)에는 VERCEL_ENV 가 없으므로 로컬도 테스트로 잡힌다. 그게 맞다 —
// 지금은 로컬에서 설정 화면의 테스트 푸시를 누르면 운영자 실기기로 진짜 알림이 간다.
//
// 왜 한 함수인가
//   배너와 발송 차단이 갈라지면 최악의 조합이 생긴다. **배너는 없는데 발송은 막힌 상태.**
//   운영자가 실제 사이트라고 믿고 보냈다고 생각하는데 아무것도 안 나간다.
//   그래서 둘 다 이 함수에서 파생시키고, 감지망이 여기 밖에서 환경변수를 직접 읽는 걸 잡는다.

// 로컬에서 실발송을 한 번 시험해야 할 때만 쓰는 탈출구. 배포 환경에는 넣지 않는다.
const FORCE_LIVE = 'STAYEUM_FORCE_LIVE'

export function isLiveEnv(): boolean {
  if (process.env[FORCE_LIVE] === '1') return true
  return process.env.VERCEL_ENV === 'production'
}

export function isStagingEnv(): boolean {
  return !isLiveEnv()
}
