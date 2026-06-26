// ipinfo 기반 위치 조회 — Vercel x-vercel-ip-* 헤더보다 한국 도시 정확도가 높다.
// (한국 ISP는 IP 대역을 물리적 위치와 무관하게 중앙 할당해, Vercel/MaxMind 계열이
//  서울 사용자를 '대구 수성구' 등으로 오판정하는 일이 흔하다. ipinfo 가 더 정확.)
//
// 설계 원칙: ipinfo 가 실패/타임아웃/사설IP/봇이면 Vercel 헤더(fallback)를 그대로 쓴다.
// 즉 geo 조회가 페이지뷰 기록을 막거나 느리게 해서는 안 된다(최대 1.5s, 비차단 폴백).

export type Geo = { country: string | null; region: string | null; city: string | null }

// localhost·사설망·IPv6 링크로컬 — ipinfo 조회 무의미(서버 자기 IP가 잡힘). 폴백 사용.
const PRIVATE_IP = /^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::$|fc|fd|fe80:)/i

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, 120) : null
}

// ipinfo 응답 형태: { country: 'KR', region: 'Seoul', city: 'Seoul', bogon?: true, ... }
export async function lookupGeo(ip: string | null, fallback: Geo): Promise<Geo> {
  if (!ip || PRIVATE_IP.test(ip)) return fallback
  const token = process.env.IPINFO_TOKEN
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${encodeURIComponent(token)}` : ''}`
  try {
    const res = await fetch(url, {
      // Next 16: fetch 는 기본 비캐시지만, IP별 응답이 절대 공유되지 않도록 명시.
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { country?: string; region?: string; city?: string; bogon?: boolean }
    if (data.bogon) return fallback
    // 각 항목은 ipinfo 우선, 누락 시 Vercel 폴백 — 부분 실패에도 최대한 채운다.
    return {
      country: clean(data.country) ?? fallback.country,
      region:  clean(data.region)  ?? fallback.region,
      city:    clean(data.city)    ?? fallback.city,
    }
  } catch {
    return fallback // 타임아웃·네트워크 오류 등 — 조용히 폴백
  }
}
