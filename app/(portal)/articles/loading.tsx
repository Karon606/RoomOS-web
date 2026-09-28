// 글 검색 중 뼈대 — 루트 스플래시 대신 결과 자리에 카드 모양만 먼저 그린다

export default function ArticlesLoading() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 pt-6 lg:px-8 lg:pt-10" aria-busy="true" aria-label="글을 찾는 중">
      <div className="h-11 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream)]" />
      <div className="h-7 w-48 rounded-md bg-[var(--cream-soft)]" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-[140px] flex-col gap-3 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream)] p-5">
            <div className="h-5 w-4/5 rounded bg-[var(--cream-soft)]" />
            <div className="h-4 w-full rounded bg-[var(--cream-soft)]" />
            <div className="h-4 w-2/3 rounded bg-[var(--cream-soft)]" />
          </div>
        ))}
      </div>
    </main>
  )
}
