// 제목 + 자식 콘텐츠 — entity body 안 구획용. Grid/Item 과 함께 쓴다.

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[var(--warm-mid)] mb-2">{title}</h3>
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
