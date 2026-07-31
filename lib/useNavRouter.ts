'use client'

// 페이지 이동용 라우터 정본 — 상단 진행바가 함께 도는 useRouter.
//
// 왜 필요한가: 진행바(next-nprogress-bar)는 <a> 클릭에만 리스너를 붙인다. 버튼에서 router.push 로
// 이동하는 경로(알림·전역 검색·프리즘·서류 발급 등)는 클릭 후 아무 표시가 없다가 화면이 바뀐다.
// 스켈레톤은 300ms 뒤에야 나오므로 그 사이가 무반응 구간이 된다(F페이즈).
//
// 쓰는 곳: 다른 페이지로 이동하는 컴포넌트. 같은 페이지 내 갱신(router.refresh)만 하는 곳은 굳이 바꾸지 않는다.
// 시그니처는 next/navigation 의 useRouter 와 호환된다(push·replace·back·refresh·forward·prefetch).
export { useRouter as useNavRouter } from 'next-nprogress-bar'
