import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MEMBERS_CONTENT, type ListingRoom } from '@/lib/membersContent'

// 콘텐츠가 const 라 정적 생성 가능 — 공개 페이지이므로 빠른 로딩 우선
export function generateStaticParams() {
  return Object.keys(MEMBERS_CONTENT).map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const c = MEMBERS_CONTENT[slug]
  if (!c) return { title: '페이지를 찾을 수 없습니다 · 스테이음' }
  return {
    title: `${c.propertyName} · 공실 안내`,
    description: c.tagline || `${c.propertyName} 공실 안내`,
    openGraph: {
      title: `${c.propertyName} · 공실 안내`,
      description: c.tagline || `${c.propertyName} 공실 안내`,
    },
  }
}

const fmtMoney = (n: number) => n.toLocaleString('ko-KR') + '원'

// 사진 없을 때 자리표시 블록
function PhotoPlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 text-center ${className}`}
      style={{ background: 'var(--cream-soft)', color: 'var(--ink-mute)' }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="11" r="2" />
        <path d="m21 15-4-4-9 9" />
      </svg>
      <span className="text-[0.6875rem] font-medium">{label}</span>
    </div>
  )
}

function RoomCard({ room }: { room: ListingRoom }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)' }}
    >
      {room.photos.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto">
          {room.photos.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`${room.name} 사진 ${i + 1}`}
              className="h-44 w-auto shrink-0 object-cover first:rounded-tl-2xl last:rounded-tr-2xl"
            />
          ))}
        </div>
      ) : (
        <PhotoPlaceholder label="사진 준비 중" className="h-44 w-full" />
      )}

      <div className="space-y-2.5 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
            {room.name}
          </h3>
          <span
            className="rounded-full px-2 py-0.5 text-[0.625rem] font-bold mono uppercase tracking-wider"
            style={
              room.available
                ? { background: 'var(--status-paid-bg)', color: 'var(--status-paid-fg)' }
                : { background: 'var(--cream-3)', color: 'var(--ink-3)' }
            }
          >
            {room.available ? '입주 가능' : '만실'}
          </span>
        </div>

        <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
          {[room.type, room.floor, room.hasWindow ? '창문 있음' : '창문 없음']
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-0.5">
          <div>
            <p className="text-[0.625rem]" style={{ color: 'var(--ink-mute)' }}>월세</p>
            <p className="text-sm font-bold mono tnum" style={{ color: 'var(--persimmon)' }}>
              {fmtMoney(room.monthlyRent)}
            </p>
          </div>
          <div>
            <p className="text-[0.625rem]" style={{ color: 'var(--ink-mute)' }}>보증금</p>
            <p className="text-sm font-bold mono tnum" style={{ color: 'var(--ink-2)' }}>
              {fmtMoney(room.deposit)}
            </p>
          </div>
        </div>

        {room.description && (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            {room.description}
          </p>
        )}
      </div>
    </div>
  )
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const c = MEMBERS_CONTENT[slug]
  if (!c) notFound()

  const availableCount = c.rooms.filter((r) => r.available).length
  const hasPhone = c.phone.trim().length > 0
  const telHref = 'tel:' + c.phone.replace(/[^0-9+]/g, '')

  return (
    <div
      className="min-h-dvh"
      style={{ background: 'var(--cream-2)', paddingBottom: hasPhone ? '5.5rem' : '2rem' }}
    >
      <div className="mx-auto w-full max-w-[600px]">
        {/* ── Hero ───────────────────────────────────────── */}
        <header
          className="px-6 pt-12 pb-8 text-center"
          style={{ background: 'linear-gradient(180deg, var(--cream) 0%, var(--cream-2) 100%)' }}
        >
          <p
            className="mono text-[0.6875rem] font-bold uppercase tracking-[0.2em]"
            style={{ color: 'var(--persimmon)' }}
          >
            공실 안내
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-snug" style={{ color: 'var(--ink)' }}>
            {c.propertyName}
          </h1>
          {c.tagline && (
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-3)' }}>
              {c.tagline}
            </p>
          )}
          {c.locationNote && (
            <p
              className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: 'var(--cream-soft)', color: 'var(--ink-3)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {c.locationNote}
            </p>
          )}
        </header>

        {/* ── 대표 사진 ──────────────────────────────────── */}
        <section className="px-4 pt-4">
          {c.heroPhotos.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto rounded-2xl">
              {c.heroPhotos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`${c.propertyName} 사진 ${i + 1}`}
                  className="h-56 w-auto shrink-0 rounded-2xl object-cover"
                />
              ))}
            </div>
          ) : (
            <PhotoPlaceholder label="대표 사진 준비 중" className="h-56 w-full rounded-2xl" />
          )}
        </section>

        {/* ── 소개 ──────────────────────────────────────── */}
        {c.intro && (
          <section className="px-6 pt-7">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {c.intro}
            </p>
          </section>
        )}

        {/* ── 편의시설 ───────────────────────────────────── */}
        {c.amenities.length > 0 && (
          <section className="px-6 pt-7">
            <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              편의시설
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {c.amenities.map((a) => (
                <span
                  key={a}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: 'var(--cream)',
                    borderColor: 'var(--cream-3)',
                    color: 'var(--ink-2)',
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── 공실 안내 ──────────────────────────────────── */}
        <section className="px-4 pt-8">
          <div className="flex items-baseline justify-between px-2">
            <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              방 안내
            </h2>
            {c.rooms.length > 0 && (
              <span className="text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
                입주 가능 {availableCount}실 / 전체 {c.rooms.length}실
              </span>
            )}
          </div>

          {c.rooms.length > 0 ? (
            <div className="mt-3 space-y-3">
              {c.rooms.map((room) => (
                <RoomCard key={room.name} room={room} />
              ))}
            </div>
          ) : (
            <div
              className="mt-3 rounded-2xl border p-6 text-center"
              style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                공실 정보를 준비 중입니다
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                현재 입주 가능한 방은 전화로 문의해 주세요.
              </p>
            </div>
          )}
        </section>

        {/* ── 위치 ──────────────────────────────────────── */}
        {c.address.trim() && (
          <section className="px-6 pt-8">
            <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              위치
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              {c.address}
            </p>
            <a
              href={`https://map.kakao.com/?q=${encodeURIComponent(c.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-semibold"
              style={{ color: 'var(--persimmon)' }}
            >
              지도에서 보기 →
            </a>
          </section>
        )}

        {/* ── 문의 ──────────────────────────────────────── */}
        <section className="px-6 pt-8">
          <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
            문의
          </h2>
          {hasPhone || c.kakaoUrl ? (
            <div className="mt-3 flex flex-col gap-2">
              {hasPhone && (
                <a
                  href={telHref}
                  className="flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white"
                  style={{ background: 'var(--persimmon)' }}
                >
                  전화 문의 · {c.phone}
                </a>
              )}
              {c.kakaoUrl && (
                <a
                  href={c.kakaoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border py-3.5 text-sm font-bold"
                  style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)', color: 'var(--ink-2)' }}
                >
                  카카오톡 문의
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-3)' }}>
              연락처를 준비 중입니다.
            </p>
          )}
        </section>

        {/* ── Footer ────────────────────────────────────── */}
        <footer
          className="mt-10 border-t px-6 py-6 text-center"
          style={{ borderColor: 'var(--cream-3)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
            {c.propertyName}
          </p>
          <p className="mt-1 text-[0.625rem]" style={{ color: 'var(--ink-mute)' }}>
            스테이음으로 운영되는 공실 안내 페이지입니다
          </p>
        </footer>
      </div>

      {/* ── 모바일 하단 고정 전화 바 ───────────────────────── */}
      {hasPhone && (
        <div
          className="fixed inset-x-0 bottom-0 z-10 border-t px-4 py-3"
          style={{
            background: 'var(--cream)',
            borderColor: 'var(--cream-3)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          }}
        >
          <a
            href={telHref}
            className="mx-auto flex w-full max-w-[568px] items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white"
            style={{ background: 'var(--persimmon)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
            </svg>
            전화 문의
          </a>
        </div>
      )}
    </div>
  )
}
