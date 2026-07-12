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

export function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">{label}</p>
      <div className="text-sm text-[var(--warm-dark)]">{value}</div>
    </div>
  )
}
