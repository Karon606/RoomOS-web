import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MEMBERS_CONTENT } from '@/lib/membersContent'

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
  const title = `${c.propertyName}${c.brandLine ? ` | ${c.brandLine}` : ''}`
  return {
    title,
    description: c.heroSubtitle,
    openGraph: {
      title,
      description: c.heroSubtitle,
      images: c.heroPhotos[0] ? [c.heroPhotos[0]] : undefined,
    },
  }
}

// 공개 마케팅 페이지 — 방문자 테마와 무관하게 항상 라이트, 고정 팔레트
const INK = '#1A1A1A'
const INK_2 = '#555555'
const SURFACE = '#FDF7EC'
const BORDER = 'rgba(0,0,0,0.08)'

function SectionHeader({ label, title, accent }: { label: string; title: string; accent: string }) {
  return (
    <div className="mb-8 text-center">
      <p
        className="text-[0.75rem] font-bold uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        {label}
      </p>
      <h2 className="mt-2 text-[1.5rem] font-bold" style={{ color: INK }}>
        {title}
      </h2>
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

  const accent = c.accent
  const hasPhone = c.phone.trim().length > 0
  const telHref = 'tel:' + c.phone.replace(/[^0-9+]/g, '')
  const hero = c.heroPhotos[0]

  return (
    <div style={{ background: '#ffffff', paddingBottom: '5.25rem' }}>
      <div className="mx-auto w-full max-w-[760px]" style={{ background: '#ffffff' }}>
        {/* ── Header ─────────────────────────────────────── */}
        {c.logo && (
          <header
            className="sticky top-0 z-20 flex items-center justify-center px-6 py-3"
            style={{
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(12px)',
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.logo} alt={c.propertyName} className="h-11 w-11 rounded-lg object-contain" />
          </header>
        )}

        {/* ── Hero ───────────────────────────────────────── */}
        <section
          className="relative flex min-h-[560px] flex-col justify-end"
          style={{ height: '76vh' }}
        >
          {hero && (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url('${hero}')` }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.68) 58%, #ffffff 100%)',
            }}
          />
          <div className="relative z-[1] px-7 pb-12 text-center">
            <span
              className="inline-block rounded-full px-4 py-1.5 text-[0.75rem] font-bold tracking-wide text-white"
              style={{ background: accent }}
            >
              {c.heroTag}
            </span>
            <h1
              className="mt-5 font-bold leading-[1.18]"
              style={{ color: INK, fontSize: 'clamp(2.1rem, 8vw, 3.25rem)' }}
            >
              {c.propertyName}
            </h1>
            {c.brandLine && (
              <p className="mt-1.5 text-sm font-semibold tracking-wide" style={{ color: accent }}>
                {c.brandLine}
              </p>
            )}
            <p
              className="mx-auto mt-4 max-w-[30rem] text-sm leading-relaxed"
              style={{ color: INK_2 }}
            >
              {c.heroSubtitle}
            </p>
          </div>
        </section>

        {/* ── 공간 둘러보기 ──────────────────────────────── */}
        {c.heroPhotos.length > 1 && (
          <section className="px-5 pt-4">
            <div
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollSnapType: 'x mandatory' }}
            >
              {c.heroPhotos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`${c.propertyName} 공간 ${i + 1}`}
                  className="h-64 w-auto shrink-0 rounded-2xl object-cover"
                  style={{ scrollSnapAlign: 'start' }}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 객실 안내 ──────────────────────────────────── */}
        {c.roomTypes.length > 0 && (
          <section className="px-6 py-14">
            <SectionHeader label="Room & Price" title="객실 안내" accent={accent} />
            <div className="flex flex-col gap-4 sm:flex-row">
              {c.roomTypes.map((r) => (
                <div
                  key={r.name}
                  className="flex-1 rounded-2xl border p-6"
                  style={{ background: SURFACE, borderColor: BORDER }}
                >
                  <h3 className="text-lg font-bold" style={{ color: INK }}>
                    {r.name}
                  </h3>
                  <p className="mt-3 text-2xl font-bold" style={{ color: accent }}>
                    {r.priceLabel}
                  </p>
                  <p className="mt-1 text-xs font-medium" style={{ color: INK_2 }}>
                    {r.depositLabel}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: INK_2 }}>
                    {r.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 편의 시설 및 혜택 ──────────────────────────── */}
        {c.amenities.length > 0 && (
          <section className="px-6 py-14" style={{ background: SURFACE }}>
            <SectionHeader label="Amenities" title="편의 시설 및 혜택" accent={accent} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {c.amenities.map((a) => (
                <div
                  key={a.title}
                  className="rounded-2xl border p-5"
                  style={{ background: '#ffffff', borderColor: BORDER }}
                >
                  <span className="text-2xl" aria-hidden>
                    {a.icon}
                  </span>
                  <h4 className="mt-2 text-[0.95rem] font-bold" style={{ color: INK }}>
                    {a.title}
                  </h4>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed" style={{ color: INK_2 }}>
                    {a.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 시설 소개 영상 ────────────────────────────── */}
        {c.videoEmbedUrl && (
          <section className="px-6 py-14">
            <SectionHeader label="Room Tour" title="시설 소개 영상" accent={accent} />
            <div
              className="aspect-video w-full overflow-hidden rounded-2xl border"
              style={{ borderColor: BORDER }}
            >
              <iframe
                src={c.videoEmbedUrl}
                title="시설 소개 영상"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        )}

        {/* ── 오시는 길 ──────────────────────────────────── */}
        {c.address.trim() && (
          <section className="px-6 py-14" style={{ background: SURFACE }}>
            <SectionHeader label="Location" title="오시는 길" accent={accent} />
            <h3 className="text-center text-base font-bold" style={{ color: INK }}>
              {c.address}
            </h3>
            {c.mapEmbedUrl && (
              <div
                className="mt-4 overflow-hidden rounded-2xl border"
                style={{ borderColor: BORDER }}
              >
                <iframe
                  src={c.mapEmbedUrl}
                  title="지도"
                  className="h-[280px] w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}
            {c.directions.length > 0 && (
              <ol className="mt-5 flex flex-col gap-3">
                {c.directions.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ background: accent }}
                    >
                      {i + 1}
                    </span>
                    <p className="pt-0.5 text-sm leading-relaxed" style={{ color: INK_2 }}>
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {/* ── Footer ─────────────────────────────────────── */}
        <footer className="px-6 py-12 text-center">
          {c.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logo}
              alt={c.propertyName}
              className="mx-auto h-12 w-12 rounded-lg object-contain"
            />
          )}
          <p className="mt-3 text-sm font-bold" style={{ color: INK }}>
            {c.propertyName}
            {c.brandLine ? ` (${c.brandLine})` : ''}
          </p>
          {c.notes?.map((n) => (
            <p key={n} className="mt-1 text-xs" style={{ color: INK_2 }}>
              {n}
            </p>
          ))}
          {c.kakaoId && (
            <p className="mt-1 text-xs" style={{ color: INK_2 }}>
              카카오톡 ID: {c.kakaoId}
            </p>
          )}
          {hasPhone && (
            <p className="mt-1 text-xs" style={{ color: INK_2 }}>
              전화 문의: {c.phone}
            </p>
          )}
          <p className="mt-4 text-[0.625rem]" style={{ color: '#9a9a9a' }}>
            스테이음으로 운영되는 공실 안내 페이지입니다
          </p>
        </footer>
      </div>

      {/* ── 하단 고정 문의 바 ──────────────────────────────── */}
      {(hasPhone || c.kakaoUrl) && (
        <div
          className="fixed inset-x-0 bottom-0 z-30"
          style={{
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(12px)',
            borderTop: `1px solid ${BORDER}`,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="mx-auto flex w-full max-w-[760px] gap-2 px-4 py-3">
            {hasPhone && (
              <a
                href={telHref}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3.5 text-sm font-bold text-white"
                style={{ background: accent }}
              >
                📞 전화 문의
              </a>
            )}
            {c.kakaoUrl && (
              <a
                href={c.kakaoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3.5 text-sm font-bold"
                style={{ background: '#FEE500', color: '#191600' }}
              >
                💬 카톡 상담
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
