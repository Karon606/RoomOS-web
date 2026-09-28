// 공개 첫 화면 묶음(첫 화면·가이드·글 모음·공지)의 상단 바 — 로고, 글 검색, 공지·문의, 휴대폰 로그인
//
// 검색은 스크립트 없이 도는 GET 폼이다(/articles?q=). 앱 안의 /search 는 로그인 뒤 화면이라 쓰지 않는다.

import Link from 'next/link'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'

function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

export function PortalHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--warm-border)] bg-[var(--cream)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1184px] items-center justify-between gap-6 pl-4 pr-2 lg:grid lg:h-[72px] lg:grid-cols-[1fr_480px_1fr] lg:px-8">
        <Link href="/" aria-label="스테이음 첫 화면" className="inline-flex min-h-[44px] items-center justify-self-start">
          <StayeumWordmark height={24} />
        </Link>

        <form action="/articles" role="search" className="relative hidden lg:block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]">
            <SearchIcon />
          </span>
          <input
            type="search"
            name="q"
            placeholder="고시원 운영 글 검색"
            aria-label="고시원 운영 글 검색"
            className="h-11 w-full rounded-[10px] border border-[var(--warm-border)] bg-[var(--canvas)] pl-[42px] pr-4 text-sm text-[var(--ink)] placeholder:text-[var(--warm-muted)] focus-visible:border-[var(--tc-text)] focus-visible:outline-none"
          />
        </form>

        <nav aria-label="바로가기" className="flex items-center justify-end gap-1">
          <Link href="/articles" aria-label="고시원 운영 글 검색"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ink)] lg:hidden">
            <SearchIcon size={20} />
          </Link>
          <Link href="/updates" className="hidden min-h-[44px] items-center px-3 text-sm font-medium text-[var(--ink)] lg:inline-flex">공지</Link>
          <Link href="/#contact" className="hidden min-h-[44px] items-center px-3 text-sm font-medium text-[var(--ink)] lg:inline-flex">문의</Link>
          <Link href="/login"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-3 text-sm font-semibold text-[var(--ink)] lg:hidden">
            로그인
          </Link>
        </nav>
      </div>
    </header>
  )
}
