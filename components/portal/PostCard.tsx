// 원장님들의 글 한 장 — 제목·요약·블로그명·날짜·출처만 보이고 누르면 원래 블로그가 새 창으로 열린다
//
// 썸네일을 두지 않는다. 남의 블로그 사진을 가져오지 않기 위해서다(저작권).

import type { BlogPost } from '@/lib/portal/blogFeed'

export function PostCard({ post, source = '네이버 블로그' }: { post: BlogPost; source?: string }) {
  return (
    <a
      href={post.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-2 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream)] p-4 text-[var(--ink)] transition-colors hover:border-[var(--camel)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)] lg:p-5"
    >
      <span className="line-clamp-2 text-lg font-semibold leading-[1.3] tracking-[-0.02em]">{post.title}</span>
      {post.summary && (
        <span className="line-clamp-2 text-sm leading-[1.6] tracking-[-0.01em] text-[var(--ink-3)]">{post.summary}</span>
      )}
      <span className="mt-auto flex flex-wrap items-center gap-x-2 pt-1 text-xs font-medium text-[var(--ink-3)]">
        <span className="tabular-nums">{post.blog} · {post.date}</span>
        <span className="ml-auto inline-flex items-center gap-1">
          {source}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="새 창에서 열림">
            <path d="M14 4h6v6" /><path d="M20 4l-9 9" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </span>
      </span>
    </a>
  )
}
