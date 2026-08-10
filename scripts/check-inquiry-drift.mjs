// 입실 문의 시각 +9h 래칫 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 왜 있나 (신고 54bce9c5, 2026-08-10)
//   폼이 오프셋 없는 "2026-08-05T14:46" 을 보내고 서버(UTC)가 그걸 UTC 로 저장하던 시절,
//   고객 정보를 저장할 때마다 inquiryAt 이 정확히 9시간씩 뒤로 밀렸다. 지문은 뚜렷하다 —
//   inquiryAt 이 그 계약의 createdAt 보다 **9시간의 배수만큼 미래**에 있는 것.
//   (문의 시각을 '지금'으로 적은 등록 건이 대다수라 createdAt 이 사실상 원본 기준선이다.)
//
// 판정: drift = inquiryAt − createdAt 이 9시간의 k 배(k>=1) 에서 ±1시간 이내.
//
// 기준선 — 기존 오염이 남아 있다(백필은 운영자 대조 후 별도 실행).
//   그래서 '총 건수 0' 을 기준으로 삼을 수 없다. 두 가지만 실패로 본다.
//     ① 봉합 이후 만들어진 계약(createdAt >= CUTOFF)에서 지문이 나옴 = 쓰기 경로 재오염.
//     ② 봉합 이전 계약의 지문 건수가 기준선을 넘음 = 멀쩡하던 옛 건이 새로 밀림.
//   백필이 끝나면 ②의 기준선을 그때 건수로 내려 잡으면 된다(줄어드는 쪽은 통과).

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const HOUR = 3600000
const KST_SHIFT = 9 * HOUR
const TOLERANCE = 1 * HOUR

// 쓰기 봉합 배포 시점(KST 2026-08-10). 이 이후에 만들어진 계약은 새 경로로만 저장된다.
const CUTOFF = new Date('2026-08-10T00:00:00+09:00')
// 봉합 시점의 실측 기준선(2026-08-10, 문의 시각 있는 계약 32건 중 13건). 늘어나면 실패.
// 개별 건이 오염인지 우연인지는 운영자 대조로 가린다 — 여기서는 '늘지 않음'만 지킨다.
const KNOWN_BASELINE = 13

const kstStr = (d) => {
  const k = new Date(d.getTime() + KST_SHIFT)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')} `
    + `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
}

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { inquiryAt: { not: null } },
    select: {
      id: true, status: true, inquiryAt: true, createdAt: true, updatedAt: true,
      tenant: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const before = []
  const after = []
  for (const l of leases) {
    const drift = l.inquiryAt.getTime() - l.createdAt.getTime()
    if (drift <= 0) continue                       // 과거에 온 문의를 나중에 기록 — 정상
    const k = Math.round(drift / KST_SHIFT)
    if (k < 1) continue
    if (Math.abs(drift - k * KST_SHIFT) > TOLERANCE) continue
    const row = `${l.tenant.name} [${l.status}] — 문의 ${kstStr(l.inquiryAt)} · 등록 ${kstStr(l.createdAt)} · +${k}회분(${k * 9}시간)`
    ;(l.createdAt >= CUTOFF ? after : before).push(row)
  }

  console.log(`\n[봉합 이후 등록 계약의 래칫 지문] ${after.length}건`)
  for (const r of after) console.log(`  - ${r}`)
  console.log(`[봉합 이전 계약의 래칫 지문] ${before.length}건 (기준선 ${KNOWN_BASELINE} · 백필 대기)`)
  for (const r of before) console.log(`  - ${r}`)

  const overBaseline = Math.max(0, before.length - KNOWN_BASELINE)
  console.log(`\n문의 시각 있는 계약 ${leases.length}건 검사 · 신규 오염 ${after.length}건 · 기준선 초과 ${overBaseline}건`)
  await prisma.$disconnect()
  if (after.length > 0 || overBaseline > 0) {
    console.error('\n쓰기 경로가 KST 를 UTC 로 저장하고 있습니다 — lib/kstDate.ts 의 kstDateTimeToUtc 를 쓰세요.')
    process.exit(1)
  }
}
main()
