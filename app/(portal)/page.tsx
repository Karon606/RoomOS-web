// stayeum.com 첫 화면 — 로그인 칸과 서비스 소개, 원장님들의 글, 운영 가이드를 한 화면에 모은 포털형 공개 페이지
//
// 로그인한 사람은 이 화면을 보지 않는다. proxy.ts 가 '/' 에서 세션이 있으면 앱으로 307 을 보낸다.
// 화면은 DB 를 읽지 않는다. 바깥에서 오는 것은 블로그 글 목록 하나이고 FEED_REVALIDATE 주기로 다시 모은다.
//
// 칸 배치(디자인 캔버스 '스테이음 첫 화면', 2026-09-28). PC 는 두 열, 휴대폰은 한 열이다. 휴대폰 순서가
// PC 와 달라서 두 열 상자를 휴대폰에서 display:contents 로 풀고 칸마다 order 를 준다.

import type { Metadata } from 'next'
import Link from 'next/link'
import { BtnLink } from '@/components/ui/Btn'
import EmailLoginForm from '@/app/(auth)/login/EmailLoginForm'
import LoginButton from '@/app/(auth)/login/LoginButton'
import { CopyEmailButton } from '@/components/portal/CopyEmailButton'
import { PostCard } from '@/components/portal/PostCard'
import { getOperatorPosts } from '@/lib/portal/blogFeed'
import { GUIDES } from '@/lib/portal/guides'
import { NOTICES } from '@/lib/portal/notices'

export const revalidate = 21600 // lib/portal/blogFeed 의 FEED_REVALIDATE 와 같은 값. 세그먼트 설정은 리터럴만 받는다

export const metadata: Metadata = {
  title: '스테이음 · 고시원을 운영하며 직접 만든 관리 앱',
  description: '이용료와 미수, 입실과 퇴실, 재고, 서류 발급과 계약서 원격 서명까지. 고시원을 운영하는 사람이 매일 쓰려고 만든 관리 앱이에요.',
}

const CONTACT_EMAIL = 'contact@stayeum.com'
const CONTACT_TEL = '02-923-6002'

const CARD = 'rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)]'
const LABEL = 'text-xs font-medium text-[var(--tc-text)]'
const H2 = 'text-[22px] font-bold leading-[1.2] tracking-[-0.025em]'
const H3 = 'text-lg font-semibold leading-[1.3] tracking-[-0.02em]'
const BODY = 'text-sm leading-[1.6] tracking-[-0.01em]'
const SMALL = 'text-xs font-medium leading-[1.5]'
const TEXT_LINK = 'inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--tc-text)]'

type TileState = '완납' | '예정' | '미납' | '연체' | '공실'
const TILE_BG: Record<TileState, string> = {
  완납: 'var(--band-paid-bg)', 예정: 'var(--band-await-bg)', 미납: 'var(--band-unpaid-bg)',
  연체: 'var(--band-overdue-bg)', 공실: 'var(--cream-soft)',
}
// 브리프의 배분(완납 7, 예정 2, 미납 1, 연체 1, 공실 1). 이름·연락처는 예시에도 넣지 않는다.
const TILES: [string, TileState][] = [
  ['301', '완납'], ['302', '완납'], ['303', '예정'], ['304', '완납'],
  ['401', '미납'], ['402', '완납'], ['403', '공실'], ['404', '완납'],
  ['501', '연체'], ['502', '예정'], ['503', '완납'], ['504', '완납'],
]

const FEATURES: { title: string; text: string; note?: string }[] = [
  { title: '수납·미수', text: '방마다 이용료와 미수를 기록하고, 현금영수증 발행도 함께 챙겨요.' },
  { title: '계약서 원격 서명', text: '링크를 보내면 입실자가 휴대폰으로 읽고 서명해요. 외국인 입실자에게는 7개 언어의 참고용 번역본을 함께 보여 줄 수 있어요.', note: '번역본은 이해를 돕는 참고 자료이고, 계약서는 한국어 원본이에요.' },
  { title: '서류 발급', text: '실거주 확인서와 납부 확인서를 앱에서 바로 만들어 보내요.' },
  { title: '지출·카드 정산', text: '영수증 사진으로 지출을 입력하고, 카드별·청구월별로 정산해요.' },
  { title: '재고', text: '창고와 위치별 남은 양, 점검, 떨어지기 전 알림, 방마다 들어간 비품까지 기록해요.' },
  { title: '결산·시세', text: '월 결산 보고서와 주변 시세 조사를 한 곳에서 봐요.' },
]

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[var(--ink-3)]">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function SectionHead({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className={H2}>{title}</h2>
      {sub && <p className={BODY}>{sub}</p>}
    </div>
  )
}

export default async function PortalHome() {
  const posts = await getOperatorPosts(6)
  const featured = GUIDES.find(g => g.slug === 'cash-receipt') ?? GUIDES[0]

  return (
    <div className="mx-auto flex max-w-[1184px] flex-col gap-6 px-4 pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6 lg:px-8 lg:pt-6">
      {/* 왼쪽 열 — 휴대폰에서는 상자를 풀어 칸마다 order 로 줄을 세운다 */}
      <main className="contents lg:flex lg:flex-col lg:gap-8">

        {/* A 광고 자리. 광고가 없는 동안은 스테이음 안내를 둔다(광고 표기 없음). PC 728x90, 휴대폰 320x100 을 담는 크기 */}
        <section aria-label="안내"
          className="order-4 mx-auto flex h-[100px] w-full max-w-[320px] flex-col justify-center gap-1 rounded-[10px] bg-[var(--sand)] px-4 lg:order-none lg:mx-0 lg:h-[90px] lg:max-w-none lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:pl-7 lg:pr-6">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold leading-[1.6] lg:text-lg lg:leading-[1.3] lg:tracking-[-0.02em]">계약서 서명, 이제 링크 하나로</p>
            <p className={`${SMALL} lg:text-sm lg:font-normal lg:leading-[1.6]`}>입실자가 자기 휴대폰에서 읽고 서명해요.</p>
          </div>
          <Link href="/guide/remote-sign"
            className="-my-2 inline-flex min-h-[44px] items-center self-start text-xs font-semibold underline underline-offset-2 lg:min-h-[44px] lg:self-auto lg:rounded-[10px] lg:border lg:border-[var(--warm-border)] lg:bg-[var(--cream)] lg:px-4 lg:text-sm lg:no-underline">
            자세히 보기
          </Link>
        </section>

        {/* C 스테이음 소개 */}
        <section aria-labelledby="intro-title" className={`${CARD} order-1 flex flex-col gap-5 p-5 lg:order-none lg:gap-7 lg:p-8`}>
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
            <div className="flex flex-col gap-3 lg:gap-4">
              <p className={LABEL}>고시원·원룸텔 운영 관리</p>
              <h1 id="intro-title" className="text-[28px] font-bold leading-[1.15] tracking-[-0.03em] [text-wrap:balance]">
                고시원을 운영하며 직접 만든 관리 앱
              </h1>
              <p className={BODY}>
                오늘 받을 이용료, 오늘 나가고 들어오는 방, 창고에 모자란 물건. 아침마다 따로 챙기던 것들을 한 화면에 모았어요.
                서류는 앱에서 만들어 바로 보내고, 계약서 서명은 입실자가 휴대폰으로 해요.
              </p>
              <p className={`${SMALL} text-[var(--ink-3)]`}>지금은 승인제 베타로 운영하고 있어요. 가입하시면 확인을 거쳐 이용하실 수 있어요.</p>
              <div className="flex items-center gap-2 pt-1">
                <BtnLink href="/login?mode=signup" size="lg">사용 신청</BtnLink>
                <a href="#features" className={`${TEXT_LINK} px-3`}>기능 살펴보기</a>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- 미리 줄인 WebP 한 장(27KB), 이미지 최적화 함수 호출을 아낀다 */}
            <img src="/portal/room-wide.webp" width={1200} height={900}
              alt="고시원 방 내부. 침대와 책상, 옷장이 한 방에 놓여 있다."
              className="aspect-[4/3] w-full rounded-[10px] object-cover" />
          </div>

          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream-soft)] p-4 lg:p-5">
            <div className="flex items-center justify-between">
              <p className={H3}>방 현황</p>
              <span className={`${SMALL} rounded-md bg-[var(--card-neutral-bg)] px-2 text-[var(--ink-3)]`}>예시</span>
            </div>
            <ul className="grid grid-cols-4 gap-2 lg:grid-cols-6" aria-label="방 현황 예시 타일">
              {TILES.map(([no, state]) => (
                <li key={no} className="overflow-hidden rounded-md border border-[var(--warm-border)] bg-[var(--cream)]">
                  <p className={`${SMALL} px-2 py-0.5 text-[var(--ink-3)]`}>{no}</p>
                  <div className="flex flex-col px-2 pb-2 pt-1.5" style={{ background: TILE_BG[state] }}>
                    <span className="text-sm font-semibold leading-[1.6]">45만</span>
                    <span className={`text-xs leading-[1.5] ${state === '연체' ? 'font-bold' : 'font-medium'}`}>{state}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className={`${SMALL} flex flex-wrap gap-3 text-[var(--ink-3)]`} aria-hidden="true">
                {(['완납', '예정', '미납', '연체', '공실'] as TileState[]).map(s => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm border border-[var(--warm-border)]" style={{ background: TILE_BG[s] }} />
                    {s}
                  </span>
                ))}
              </div>
              <p className={`${SMALL} text-[var(--ink-3)]`}>앱 화면 예시예요. 실제 영업장 정보가 아니에요.</p>
            </div>
          </div>
        </section>

        {/* E 만든 사람 */}
        <section aria-labelledby="maker-title" className={`${CARD} order-2 flex flex-col gap-4 p-5 lg:order-none lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:p-8`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 미리 줄인 WebP 한 장(33KB) */}
          <img src="/portal/room-tall.webp" width={720} height={1075}
            alt="고시원 방 내부를 세로로 찍은 사진. 창가 쪽 침대와 책상이 보인다."
            className="h-[220px] w-full rounded-[10px] object-cover object-[50%_62%] lg:h-[432px]" />
          <div className="flex flex-col gap-3 lg:gap-4">
            <p className={LABEL}>만든 사람</p>
            <h2 id="maker-title" className={H2}>매일의 운영에서 나온 기능</h2>
            <p className={BODY}>
              스테이음은 고시원을 운영하는 사람이 자기 영업장에서 매일 쓰려고 만들었어요.
              화면에 있는 기능은 모두 실제 운영에서 필요해서 생겼고, 지금도 매일 그 현장에서 쓰이고 있어요.
            </p>
            <figure className="mt-1 flex flex-col gap-3 rounded-[10px] bg-[var(--cream-soft)] px-5 py-4 lg:px-6 lg:py-5">
              <blockquote className={BODY}>
                호실과 입주자, 재고 흐름과 소진 예정일, 서류 발급까지 한 화면에 보이니 관리에 드는 시간이 체감으로는 10분의 1로 줄었어요.
                가장 큰 건 서류예요. 예전에는 입실자가 계약서나 실거주 확인서 한 장이 필요하면, 그 한 장 때문에 제가 고시원까지 가야 했어요.
                지금은 앱에서 바로 만들어 보내고, 서명도 입실자가 휴대폰으로 해요.
              </blockquote>
              <figcaption className={`${SMALL} text-[var(--ink-3)]`}>
                <strong className="font-semibold text-[var(--ink)]">김건우</strong> · 고시원 운영자, 스테이음 개발자
              </figcaption>
            </figure>
          </div>
        </section>

        {/* G 원장님들의 글 */}
        <section aria-labelledby="posts-title" className="order-3 flex flex-col gap-4 lg:order-none">
          <SectionHead id="posts-title" title="원장님들의 글" sub="고시원을 운영하는 원장님들이 블로그에 쓴 글을 모았어요." />
          {posts.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {posts.map(p => <PostCard key={p.link} post={p} />)}
            </div>
          ) : (
            <p className={`${CARD} ${BODY} p-5 text-[var(--ink-3)]`}>아직 모은 글이 없어요.</p>
          )}
          <BtnLink href="/articles" variant="secondary" className="self-stretch lg:self-start">글 더 보기</BtnLink>
        </section>

        {/* I 운영 가이드 */}
        <section aria-labelledby="guide-title" className="order-5 flex flex-col gap-4 lg:order-none">
          <SectionHead id="guide-title" title="운영 가이드" sub="스테이음이 직접 정리한 고시원 운영 이야기예요." />
          <ul className={`${CARD} px-4 lg:px-5`}>
            {GUIDES.map(g => (
              <li key={g.slug} className="border-b border-[var(--warm-border)] last:border-b-0">
                <Link href={`/guide/${g.slug}`} className="flex min-h-[64px] items-center justify-between gap-3 py-3">
                  <span className="flex flex-col">
                    <span className={`${BODY} font-semibold`}>{g.title}</span>
                    <span className={`${SMALL} text-[var(--ink-3)]`}>{g.description}</span>
                  </span>
                  <Chevron />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* J 스테이음으로 하는 일 */}
        <section id="features" aria-labelledby="features-title" className="order-7 flex scroll-mt-20 flex-col gap-4 lg:order-none lg:gap-5">
          <h2 id="features-title" className={H2}>스테이음으로 하는 일</h2>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-x-6 lg:gap-y-7">
            {FEATURES.map(f => (
              <div key={f.title} className="flex flex-col gap-2 border-t border-[var(--warm-border)] pt-4">
                <h3 className={H3}>{f.title}</h3>
                <p className={BODY}>{f.text}</p>
                {f.note && <p className={SMALL}>{f.note}</p>}
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 오른쪽 열 */}
      <aside className="contents lg:flex lg:flex-col lg:gap-6">

        {/* B 로그인 — 휴대폰에서는 펼치지 않고 상단 바의 로그인 버튼으로 간다 */}
        <section aria-labelledby="login-title" className={`${CARD} hidden flex-col gap-4 p-6 lg:flex`}>
          <h2 id="login-title" className={H3}>스테이음 로그인</h2>
          <LoginButton />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--warm-border)]" />
            <span className={`${SMALL} text-[var(--ink-3)]`}>또는</span>
            <span className="h-px flex-1 bg-[var(--warm-border)]" />
          </div>
          <EmailLoginForm />
          <div className="flex flex-col gap-2 border-t border-[var(--warm-border)] pt-3">
            <p className={`${SMALL} text-[var(--ink-3)]`}>승인제 베타예요. 가입하시면 확인을 거쳐 이용하실 수 있어요.</p>
            <p className={`${SMALL} text-[var(--warm-muted)]`}>
              로그인 시 <Link href="/terms" className="underline underline-offset-2 text-[var(--ink-3)]">서비스 이용약관</Link> 및{' '}
              <Link href="/privacy" className="underline underline-offset-2 text-[var(--ink-3)]">개인정보 처리방침</Link>에 동의하게 됩니다.
            </p>
          </div>
        </section>

        {/* D 공지·새 기능 */}
        <section id="notice" aria-labelledby="notice-title" className={`${CARD} order-6 flex flex-col px-4 pb-1 pt-5 lg:order-none lg:px-6`}>
          <h2 id="notice-title" className={`${H3} mb-2`}>공지·새 기능</h2>
          <ul>
            {NOTICES.slice(0, 4).map(n => (
              <li key={n.date + n.text} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2 border-t border-[var(--warm-border)] py-2.5">
                <span className="text-xs font-medium leading-[1.8] text-[var(--ink-3)]">{n.date.slice(5)}</span>
                <span className={BODY}>{n.text}</span>
              </li>
            ))}
          </ul>
          <Link href="/updates" className={`${TEXT_LINK} self-start`}>전체 보기</Link>
        </section>

        {/* F 광고 자리(300x250). 광고가 없는 동안은 운영 가이드 한 편을 크게 보인다. 휴대폰에서는 없앤다 */}
        <section aria-labelledby="featured-title" className="hidden h-[250px] flex-col gap-2 rounded-[14px] border border-[var(--warm-border)] bg-[var(--cream)] p-6 lg:flex">
          <p className={LABEL}>운영 가이드</p>
          <h2 id="featured-title" className={`${H2} [text-wrap:balance]`}>{featured.title}</h2>
          <p className={`${BODY} text-[var(--ink-3)]`}>{featured.description}</p>
          <BtnLink href={`/guide/${featured.slug}`} variant="secondary" className="mt-auto self-start">읽기</BtnLink>
        </section>

        {/* H 문의 */}
        <section id="contact" aria-labelledby="contact-title" className={`${CARD} order-8 flex scroll-mt-20 flex-col gap-2 px-4 py-5 lg:order-none lg:px-6`}>
          <h2 id="contact-title" className={H3}>문의</h2>
          <p className={`${BODY} text-[var(--ink-3)]`}>도입이나 사용 중 궁금한 점이 있으면 편하게 보내 주세요.</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold">{CONTACT_EMAIL}</a>
            <CopyEmailButton email={CONTACT_EMAIL} />
          </div>
          <a href={`tel:${CONTACT_TEL.replace(/-/g, '')}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold">{CONTACT_TEL}</a>
        </section>
      </aside>
    </div>
  )
}

