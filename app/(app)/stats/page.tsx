// 옛 '통계' 경로 — 홈 대시보드로 되돌리는 호환 리다이렉트만 남긴 자리.
//
// 화면 본체(StatsClient)는 2026-08-12 에 지웠다. 앱 어디에도 /stats 로 가는 링크가 없어
// 그 파일은 도달 불가였고, 그 안에 홈과 갈린 수납률 분모가 살아 있었다 — 도달 불가 코드에
// 남은 옛 산식은 언젠가 참고본으로 다시 베껴진다.
//
// 이 리다이렉트는 남긴다. 네 줄이고, 옛 북마크·홈 화면 바로가기가 404 대신 홈으로 온다.
import { redirect } from 'next/navigation'

export default function StatsPage() {
  redirect('/dashboard')
}
