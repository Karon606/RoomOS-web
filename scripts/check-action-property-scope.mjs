// 서버 액션이 화면에서 온 id 를 영업장 범위로만 읽고 쓰는지 지키는 정적 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. updateTenant·updateExpense 가 입주자·계약·지출을 id 만으로 읽고 써서, 다른 영업장 id 를
// 넣으면 그 행이 바뀌었다(78bb0141 후속 B7, 운영자 승인 2026-10-13). 고친 뒤 누가 findUnique({ where: { id } })
// 로 되돌려도 아무 그물도 안 울었다(독립 검수 2026-10-13). 같은 클래스 43곳은 별건 감사 대상이고
// (stayeum development/오류신고-정비/권한-영업장범위-감사.md), 봉합하는 함수마다 여기에 축을 더한다.
//
// 실행: node scripts/check-action-property-scope.mjs
import { readFileSync } from 'node:fs'

const violations = []

/** export async function 이름( 부터 다음 export 직전까지. 못 찾으면 null. */
function bodyOf(src, name) {
  const start = src.indexOf(`export async function ${name}(`)
  if (start < 0) return null
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}

const AXES = [
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'updateTenant',
    must: [
      [/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId,\s*tenantId\s*\}/, '계약을 영업장·입주자 범위로 먼저 읽지 않는다'],
      [/tenant\.findFirst\(\{\s*where:\s*\{\s*id:\s*tenantId,\s*propertyId\s*\}/, '입주자를 영업장 범위로 확인하지 않는다'],
      [/room\.findFirst\(\{\s*where:\s*\{\s*id:\s*newRoomId,\s*propertyId\s*\}/, '새로 고른 호실이 이 영업장 것인지 보지 않는다'],
    ],
    mustNot: [
      [/leaseTerm\.findUnique\(\{\s*where:\s*\{\s*id:\s*leaseTermId\s*\}/, '계약을 id 만으로 읽는다'],
      [/tenant\.findUnique\(\{\s*where:\s*\{\s*id:\s*tenantId\s*\}/, '입주자를 id 만으로 읽는다'],
    ],
  },
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'updateExpense',
    must: [
      [/expense\.findFirst\(\{\s*where:\s*\{\s*id,\s*propertyId\s*\}/, '지출을 영업장 범위로 먼저 읽지 않는다'],
      [/room\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*formRoomIds\s*\},\s*propertyId\s*\}/, '폼의 호실·방별 분배 id 를 영업장 범위로 보지 않는다'],
      [/financialAccount\.findFirst\(\{\s*where:\s*\{\s*id:\s*financialAccountId,\s*propertyId\s*\}/, '결제 계정을 영업장 범위로 보지 않는다'],
    ],
    mustNot: [
      [/expense\.findUnique\(\{\s*where:\s*\{\s*id\s*\}/, '지출을 id 만으로 읽는다'],
    ],
  },
]

for (const ax of AXES) {
  let src = ''
  try { src = readFileSync(ax.file, 'utf8') } catch { violations.push(`${ax.file} — 파일을 못 읽었다. 못 읽으면 통과가 아니라 위반이다`); continue }
  const body = bodyOf(src, ax.fn)
  if (body == null) { violations.push(`${ax.file} — ${ax.fn} 를 못 찾았다. 이름이 바뀌었으면 이 축도 함께 고친다`); continue }
  for (const [re, msg] of ax.must) if (!re.test(body)) violations.push(`${ax.file} ${ax.fn} — ${msg}. 다른 영업장 id 로 그 행을 읽거나 바꿀 수 있다`)
  for (const [re, msg] of ax.mustNot) if (re.test(body)) violations.push(`${ax.file} ${ax.fn} — ${msg}. 영업장 범위를 지나야 한다`)
}

console.log(`[영업장 범위] 함수 ${AXES.length}개 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.log(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
