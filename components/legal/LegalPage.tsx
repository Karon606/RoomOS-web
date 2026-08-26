'use client'

// 법적 고지 문서(처리방침·약관)의 공통 셸 — 두 문서가 같은 문법으로 서게 한다.
//
// 왜 셸을 따로 두나. 처리방침과 약관은 로그인 전에도 열려야 하고(법 제30조는 홈페이지 게재를
// 원칙으로 한다), 앱 셸(사이드바·헤더)이 없는 단독 라우트다. 두 문서가 각자 레이아웃을 들면
// 한쪽만 고쳐진 채 서로 다른 모양이 되고, 나중에 문서가 늘 때마다 같은 마크업을 또 짓게 된다.
//
// 인쇄를 염두에 둔다 — 개인정보위 상담이나 변호사 검토에 종이로 들고 갈 수 있어야 한다.
// 화면 밖 장식을 두지 않고 본문 폭을 읽기 좋은 65자 안팎으로 묶는 이유다.

export function LegalPage({ title, effectiveDate, intro, children }: {
  title: string
  /** 시행일 'YYYY년 M월 D일' — 개정 이력의 기준이라 문서 머리에 상시 노출한다. */
  effectiveDate: string
  /** 첫 문단 — 이 문서가 누구에게 무엇을 말하는지 한 단락. */
  intro: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-[var(--canvas)] px-5 py-10">
      <div className="mx-auto w-full max-w-[42rem]">
        {/* 복귀 경로 — 로그인 전(로그인 화면에서 온 사람)과 로그인 후(환경설정에서 온 사람)가
            같은 문서를 본다. 뒤로가기가 둘 다에게 맞는 유일한 답이라 브라우저 이력을 쓴다.
            홈화면 앱에는 뒤로가기 버튼이 없어 이 줄이 곧 복귀 경로다(§27.7). */}
        <button type="button" onClick={() => history.back()}
          className="text-xs text-[var(--warm-mid)] underline underline-offset-2">
          돌아가기
        </button>
        <h1 className="mt-4 text-xl font-bold text-[var(--warm-dark)]">{title}</h1>
        <p className="mt-1 text-xs text-[var(--warm-mid)]">시행일 {effectiveDate}</p>
        <div className="mt-5 rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-5 sm:p-6">
          <p className="text-sm leading-relaxed text-[var(--warm-dark)]">{intro}</p>
        </div>
        <div className="mt-6 space-y-7 pb-16">{children}</div>
      </div>
    </main>
  )
}

/** 조 단위 묶음 — 제목과 본문의 간격·크기를 여기서만 정한다. */
export function LegalSection({ no, title, children }: {
  no: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)]">제{no}조 ({title})</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--warm-mid)]">{children}</div>
    </section>
  )
}

/** 번호 목록 — 조 안의 항. 들여쓰기와 번호 문법을 한 곳에 둔다. */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-1.5 pl-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">{i + 1}.</span>
          <span className="min-w-0 flex-1">{it}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * 표 — 수탁자·국외이전 목록처럼 항목이 여럿인 자리.
 * 좁은 화면에서 가로 스크롤로 흘린다(문서 본문이 가로로 밀리지 않게).
 */
export function LegalTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-xs">
        <thead>
          <tr className="border-b border-[var(--warm-border)]">
            {head.map(h => (
              <th key={h} className="px-2 py-2 text-left font-semibold text-[var(--warm-dark)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--warm-border)]/60 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-2 leading-relaxed text-[var(--warm-mid)]">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
