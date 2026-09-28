// 공개 첫 화면 묶음의 푸터 — 약관·처리방침·문의 링크와 저작권 줄
//
// 사업자 정보 줄은 운영자 결정 전이라 비워 둔다(등록번호가 영업장 것과 부딪힌다, 2026-09-28).

import Link from 'next/link'

const LINK = 'inline-flex min-h-[44px] items-center px-2 first:pl-0'

export function PortalFooter() {
  return (
    <footer className="mt-12 border-t border-[var(--warm-border)] pb-[calc(40px+env(safe-area-inset-bottom))] pt-6 lg:mt-16 lg:pt-8">
      <div className="mx-auto flex max-w-[1184px] flex-col gap-1 px-4 text-xs font-medium text-[var(--ink)] lg:px-8">
        <nav aria-label="약관과 문의" className="flex flex-wrap items-center">
          <Link href="/terms" className={LINK}>이용약관</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className={`${LINK} font-semibold text-[var(--ink)]`}>개인정보 처리방침</Link>
          <span aria-hidden="true">·</span>
          <Link href="/#contact" className={LINK}>문의</Link>
        </nav>
        <p>© 2026 stayeum</p>
      </div>
    </footer>
  )
}
