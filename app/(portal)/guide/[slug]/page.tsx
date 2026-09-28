// 운영 가이드 한 편을 보여 주는 공개 화면 — 본문은 lib/portal/guides 의 정본을 읽어 빌드 때 정적으로 만든다

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUIDES, getGuide } from '@/lib/portal/guides'

export const dynamicParams = false

export function generateStaticParams() {
  return GUIDES.map(g => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = getGuide((await params).slug)
  return g ? { title: `${g.title} · 스테이음 운영 가이드`, description: g.description } : {}
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getGuide((await params).slug)
  if (!guide) notFound()
  const others = GUIDES.filter(g => g.slug !== guide.slug)

  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-8 px-4 pt-6 lg:pt-10">
      <article className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Link href="/#guide-title" className="inline-flex min-h-[44px] items-center self-start text-sm font-semibold text-[var(--tc-text)]">운영 가이드</Link>
          <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.03em] [text-wrap:balance]">{guide.title}</h1>
          <p className="text-xs font-medium">{guide.updated} 정리</p>
        </div>
        <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] p-5 lg:p-8">
          {guide.body.map((b, i) => {
            if (b.kind === 'h') return <h2 key={i} className="pt-2 text-lg font-semibold leading-[1.3] tracking-[-0.02em]">{b.text}</h2>
            if (b.kind === 'p') return <p key={i} className="text-sm leading-[1.7] tracking-[-0.01em]">{b.text}</p>
            if (b.kind === 'note') return <p key={i} className="rounded-[10px] bg-[var(--cream-soft)] px-4 py-3 text-sm leading-[1.6] text-[var(--ink-3)]">{b.text}</p>
            return (
              <ul key={i} className="flex list-disc flex-col gap-2 pl-5 text-sm leading-[1.7] tracking-[-0.01em] marker:text-[var(--ink-3)]">
                {b.items.map(t => <li key={t}>{t}</li>)}
              </ul>
            )
          })}
          {guide.source && (
            <p className="flex flex-wrap items-center gap-x-1 border-t border-[var(--warm-border)] pt-3 text-xs font-medium text-[var(--ink-3)]">
              출처{' '}
              <a href={guide.source.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                {guide.source.label}
              </a>
            </p>
          )}
        </div>
      </article>

      <nav aria-labelledby="more-guides" className="flex flex-col gap-3">
        <h2 id="more-guides" className="text-lg font-semibold leading-[1.3] tracking-[-0.02em]">다른 가이드</h2>
        <ul className="rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] px-4 lg:px-5">
          {others.map(g => (
            <li key={g.slug} className="border-b border-[var(--warm-border)] last:border-b-0">
              <Link href={`/guide/${g.slug}`} className="flex min-h-[56px] flex-col justify-center py-3">
                <span className="text-sm font-semibold">{g.title}</span>
                <span className="text-xs font-medium text-[var(--ink-3)]">{g.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  )
}
