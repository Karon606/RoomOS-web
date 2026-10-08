// 제목 + 자식 콘텐츠 — entity body 안 구획용. Grid/Item 과 함께 쓴다.

// action — 제목 줄 오른쪽 버튼 자리(호실 면의 메모·도어락 '수정'·'등록', 2026-10-08).
// undefined 면 종전 마크업 그대로다(기존 호출부 픽셀 무변동). 슬롯을 쓰는 위젯은 편집 중에 null 을 넘겨
// 버튼만 비우고 행 높이(44px, Btn sm 터치 타겟)는 지킨다 — 버튼이 사라지며 제목 줄이 28px 줄면 그 아래
// 폼이 손가락 밑에서 튄다(웹디자이너 지적 2026-10-08).
export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {action !== undefined ? (
        <div className="flex min-h-[44px] items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-[var(--warm-mid)]">{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className="text-xs font-semibold text-[var(--warm-mid)] mb-2">{title}</h3>
      )}
      {children}
    </div>
  )
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
}

// 긴 값이 이웃 칸을 침범하거나 잘리던 자리(신고 d03a6c1f, 2026-09-06).
// 이메일처럼 끊을 자리가 없는 긴 토큰은 grid 자식의 기본 min-width:auto 때문에 셀 밖으로
// 그려진다 — 실측에서 'caocuong2007cc@gmail.com' 이 오른쪽 성별 칸을 덮었다.
// min-w-0 이 트랙 안에서 줄어들게 하고, anywhere 가 넘칠 때만 끊는다.
// break-all 은 쓰지 않는다 — 일반 문장까지 아무 데서나 쪼갠다.
export function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">{label}</p>
      <div className="text-sm text-[var(--warm-dark)] [overflow-wrap:anywhere]">{value}</div>
    </div>
  )
}
