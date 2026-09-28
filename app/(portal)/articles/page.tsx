// 고시원 운영 글 모음과 검색 결과 — 검색어가 없으면 원장님들의 글을 더 보여 주고, 있으면 가이드와 블로그 글을 함께 찾는다

import type { Metadata } from 'next'
import Link from 'next/link'
import { Btn } from '@/components/ui/Btn'
import { PostCard } from '@/components/portal/PostCard'
import { getOperatorPosts, searchPosts } from '@/lib/portal/blogFeed'
import { searchGuides } from '@/lib/portal/guides'

export const metadata: Metadata = {
  title: '고시원 운영 글 · 스테이음',
  description: '고시원을 운영하는 원장님들의 블로그 글과 스테이음 운영 가이드를 모아 봐요.',
}

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 50)
  const guides = q ? searchGuides(q) : []
  const posts = q ? await searchPosts(q) : await getOperatorPosts(24)
  const empty = q && guides.length === 0 && posts.length === 0

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 pt-6 lg:px-8 lg:pt-10">
      <form action="/articles" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="고시원 운영 글 검색"
          aria-label="고시원 운영 글 검색"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--warm-muted)] focus-visible:border-[var(--tc-text)] focus-visible:outline-none"
        />
        <Btn type="submit" variant="secondary">검색</Btn>
      </form>

      <h1 className="text-[22px] font-bold leading-[1.2] tracking-[-0.025em]">
        {q ? `'${q}' 검색 결과` : '원장님들의 글'}
      </h1>
      {!q && <p className="-mt-3 text-sm leading-[1.6]">고시원을 운영하는 원장님들이 블로그에 쓴 글을 모았어요.</p>}

      {empty && (
        <p className="rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] p-5 text-sm leading-[1.6] text-[var(--ink-3)]">
          &apos;{q}&apos;에 맞는 글이 없어요. 다른 말로 찾아보세요.
        </p>
      )}

      {guides.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {guides.map(g => (
            <li key={g.slug}>
              <Link href={`/guide/${g.slug}`}
                className="flex h-full flex-col gap-2 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream)] p-4 lg:p-5">
                <span className="text-lg font-semibold leading-[1.3] tracking-[-0.02em]">{g.title}</span>
                <span className="text-sm leading-[1.6] text-[var(--ink-3)]">{g.description}</span>
                <span className="mt-auto pt-1 text-xs font-medium text-[var(--tc-text)]">운영 가이드</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {posts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {posts.map(p => <PostCard key={p.link} post={p} />)}
        </div>
      )}
      {!q && posts.length === 0 && (
        <p className="rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] p-5 text-sm text-[var(--ink-3)]">아직 모은 글이 없어요.</p>
      )}
    </main>
  )
}
