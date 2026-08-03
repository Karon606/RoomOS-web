// 서류 뷰어 로딩 — 셸 밖 라우트라 자체 loading 이 없으면 app/loading.tsx(전체화면 브랜드 스플래시)를
// 상속한다. 그건 콜드 부트용이라 한 번 뜨면 최소 1.4초를 채워, 목록에서 '보기'를 누를 때마다
// "앱을 다시 켰다"는 잘못된 신호를 준다(형제 서류 화면과 같은 판정).
// 이 라우트는 소유 검증에 조회를 최대 3번 순차로 돌아 확실히 서스펜드한다.
export default function DocLoading() {
  const rail = 'min(210mm, 100% - 24px)'
  return (
    <div className="h-dvh overflow-y-auto" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'var(--canvas)',
      padding: '16px 0 calc(16px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div className="animate-pulse" style={{
        width: rail, flex: 'none', height: 64, marginBottom: 10, borderRadius: 10,
        background: 'var(--cream)', border: '1px solid var(--warm-border)',
      }} />
      <div style={{ width: rail, height: 12, marginBottom: 12 }} />
      <div className="animate-pulse" style={{
        flex: 1, minHeight: 0, width: rail, borderRadius: 10, background: 'var(--cream)',
      }} />
    </div>
  )
}
