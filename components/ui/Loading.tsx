// 인라인 로딩 인디케이터 — 데이터 로딩 중 모달·패널 내부에 사용
// 전체 페이지 로딩은 app/(app)/loading.tsx (SplashScreen) 참고

export function Loading({ py = 8 }: { py?: number }) {
  return (
    <div className={`flex items-center justify-center py-${py}`}>
      <div
        className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}
