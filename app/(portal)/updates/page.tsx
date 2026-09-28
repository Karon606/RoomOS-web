// 공지·새 기능 전체 목록 — 첫 화면 공지 칸의 '전체 보기'가 여는 공개 화면

import type { Metadata } from 'next'
import { NOTICES } from '@/lib/portal/notices'

export const metadata: Metadata = {
  title: '공지·새 기능 · 스테이음',
  description: '스테이음에 새로 들어간 기능과 바뀐 점이에요.',
}

export default function UpdatesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-5 px-4 pt-6 lg:pt-10">
      <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.03em]">공지·새 기능</h1>
      <ul className="rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] px-4 lg:px-6">
        {NOTICES.map(n => (
          <li key={n.date + n.text} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-[var(--warm-border)] py-3 last:border-b-0">
            <span className="text-xs font-medium leading-[1.9] text-[var(--ink-3)]">{n.date}</span>
            <span className="text-sm leading-[1.6] tracking-[-0.01em]">{n.text}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
