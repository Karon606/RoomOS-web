// 공개 추적 엔드포인트 보호 — slug 화이트리스트 + IP 레이트리밋 (D페이즈 잔여, 2026-08-03).
//
// 왜
//   /api/track/* 다섯 종이 인증도 레이트리밋도 없고 slug 가 실존 영업장인지 검증하지 않았다.
//   slug 는 공개 URL(/members/<slug>/)에 그대로 드러나 있어 누구나 안다. 그래서 셋이 동시에 가능했다.
//     1) 지표 오염 — 남의 영업장 slug 로 방문 기록을 무한 주입해 /marketing 통계를 조작
//     2) 저장공간 고갈 — 요청마다 PageView 행이 생기고 상한이 없다
//     3) 유료 API 소진 — 봇이 아니면 매 요청 ipinfo 를 호출한다
//   개인정보 열람은 안 된다(쓰기 전용). 하지만 운영자가 보는 숫자가 남의 손에 있으면 안 된다.
//
// 레이트리밋은 인스턴스 메모리다. 서버리스라 인스턴스가 여럿이면 한도가 그만큼 늘어난다 —
// 완전한 차단이 아니라 **무한 주입을 유한하게 만드는 것**이 목적이다. 정확한 한도가 필요해지면
// Redis 같은 공유 저장소로 옮긴다. 지금 단계에서 그걸 도입할 이유는 없다.
import prisma from '@/lib/prisma'

// slug 캐시 — 영업장 목록은 거의 안 바뀌는데 매 요청 DB 를 치면 그것 자체가 증폭 통로가 된다
let slugCache: { at: number; set: Set<string> } | null = null
const SLUG_TTL_MS = 5 * 60 * 1000

export async function isKnownSlug(slug: string): Promise<boolean> {
  const now = Date.now()
  if (!slugCache || now - slugCache.at > SLUG_TTL_MS) {
    const rows = await prisma.property.findMany({
      where: { publicSlug: { not: null } },
      select: { publicSlug: true },
    })
    slugCache = { at: now, set: new Set(rows.map(r => r.publicSlug!)) }
  }
  return slugCache.set.has(slug)
}

// IP 별 고정창 카운터. 창이 지나면 통째로 비운다(엔트리 누수 방지).
const buckets = new Map<string, number>()
let windowStart = Date.now()
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 120   // 한 사람이 1분에 120건을 넘길 일이 없다(방문 1건 + 후속 이벤트 몇 개)

export function rateLimited(ip: string | null): boolean {
  const now = Date.now()
  if (now - windowStart > WINDOW_MS) { buckets.clear(); windowStart = now }
  const key = ip ?? 'unknown'
  const n = (buckets.get(key) ?? 0) + 1
  buckets.set(key, n)
  return n > MAX_PER_WINDOW
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null
}
