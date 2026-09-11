// 홈 대시보드(getDashboardData) 성능 수술 전/후 결과 동일성·쿼리 수 검증 하네스.
//
// 사용:
//   npx tsx --tsconfig scripts/tsconfig.dashboard.json --env-file=.env.local \
//     scripts/verify-dashboard-parity.ts > /tmp/dash-before.json 2> /tmp/dash-before.log
//
// stdout = 영업장 × 월 별 DashboardData JSON 한 줄씩(바이트 비교 대상).
// stderr = 쿼리 수·소요 ms 표.
//
// 읽기 전용이다 — getDashboardData 가 부르는 경로에 쓰기가 없다.
// 인증 관문은 tsconfig paths 로 스텁한다(scripts/dashboard-access-stub.ts, 선례: tsconfig.pii.json).
//
// PARITY_CANONICAL=1 이면 배열을 값 기준으로 정렬해 비교한다 — orderBy 없는 조회가 실행마다
// 순서를 바꾸는 것이 A/A 에서 확인될 때만 켠다(기본은 원본 순서 그대로, 순서 회귀도 잡으려고).
import { resetQueryCount, queryCount, realNow, FROZEN_NOW_ISO } from './dashboard-parity-env'
import { getDashboardData } from '../app/(app)/dashboard/getDashboardData'
import prisma from '../lib/prisma'
import { kstMonthStr } from '../lib/kstDate'
import { shiftMonth } from '../lib/moveCalendar'

const CANONICAL = process.env.PARITY_CANONICAL === '1'

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) {
    const items = v.map(canonical)
    return items
      .map(x => ({ x, k: JSON.stringify(x) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map(e => e.x)
  }
  if (v instanceof Date) return v.toISOString()
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k])
    return out
  }
  return v
}

async function main() {
  const props = await prisma.property.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (props.length === 0) {
    console.error('NO PROPERTY')
    process.exit(1)
  }

  const thisMonth = kstMonthStr()
  const months = [shiftMonth(thisMonth, -1), thisMonth, shiftMonth(thisMonth, 1)]
  console.error(`FROZEN_NOW ${FROZEN_NOW_ISO}  canonical=${CANONICAL ? 'on' : 'off'}  months=${months.join(',')}  props=${props.length}`)
  console.error('property\tmonth\tqueries\tms')

  let totalQueries = 0
  let totalMs = 0
  for (const prop of props) {
    process.env.PARITY_PROPERTY_ID = prop.id
    for (const month of months) {
      resetQueryCount()
      const t0 = realNow()
      const data = await getDashboardData(prop.id, month)
      const ms = realNow() - t0
      const q = queryCount()
      totalQueries += q
      totalMs += ms
      console.error(`${prop.name}\t${month}\t${q}\t${ms}`)
      console.log(JSON.stringify({ property: prop.name, month, data: CANONICAL ? canonical(data) : data }))
    }
  }
  console.error(`TOTAL\t\t${totalQueries}\t${totalMs}`)
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
