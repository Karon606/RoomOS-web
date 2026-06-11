// 페이지 이동 중 콘텐츠 영역에 표시되는 스켈레톤 로더.
// AppShell(사이드바·헤더·하단바)은 그대로 유지되고 본문만 잠깐 스켈레톤이 된다.
// 빈 화면/작은 스피너 대신 자리만 잡힌 박스가 깜빡여 "곧 뜬다"는 신호를 준다.
// (전체 화면 SplashScreen 은 앱 최초 진입 app/loading.tsx 에만)
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton'

export default function AppLoading() {
  return (
    // delayed-fallback: 300ms 안에 끝나는 전환에선 스켈레톤이 아예 안 보임 (§18.3)
    <div className="delayed-fallback px-4 sm:px-6 py-5 space-y-4" aria-busy="true" aria-label="불러오는 중">
      {/* 제목 영역 */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      {/* 칩·버튼 행 */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
      </div>
      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  )
}
