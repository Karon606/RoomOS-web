// 영업장 역할 판정 정본(lib/auth/resolveRole) 진리표. 종 알림의 관문과 크론 푸시가 같은 답을 내는지 지킨다. 실패 시 exit 1.
// 실행: npx tsx scripts/test-resolve-role.ts
//
// 왜(2026-10-15 비품 수령 3차 검수 권장 ①). 크론은 역할을 손으로 정해 env 슈퍼관리자 승격이 빠져 있었고, 글자 대조
// 그물만 있어 역주입(M4)이 안 잡혔다. 판정을 한 함수로 모으고 그 함수의 답을 여기서 고정한다.
import { resolvePropertyRole, pushRoleMap, type RoleFacts } from '../lib/auth/resolveRole'
import type { Role } from '../lib/role-types'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}
const f = (o: Partial<RoleFacts>): RoleFacts => ({ membershipRole: null, isOwner: false, superByEnv: false, ...o })

// 역할 줄이 있는 갈래
const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'LIMITED_STAFF']
for (const r of ROLES) {
  eq(`일반 멤버 ${r} 는 그 역할`, resolvePropertyRole(f({ membershipRole: r })), r)
  eq(`env 슈퍼관리자 + 낮은 줄 ${r} 는 소유자`, resolvePropertyRole(f({ membershipRole: r, superByEnv: true })), 'OWNER')
  eq(`DB 슈퍼관리자 표식은 역할 줄을 올리지 않는다(${r})`, resolvePropertyRole(f({ membershipRole: r, superByDb: true })), r)
  eq(`소유주라도 역할 줄이 있으면 그 줄(${r})`, resolvePropertyRole(f({ membershipRole: r, isOwner: true })), r)
}
eq('제한 스태프는 제한 스태프', resolvePropertyRole(f({ membershipRole: 'LIMITED_STAFF' })), 'LIMITED_STAFF')

// 역할 줄이 없는 갈래
eq('줄 없는 소유주는 소유자', resolvePropertyRole(f({ isOwner: true })), 'OWNER')
eq('줄 없는 env 슈퍼관리자는 소유자', resolvePropertyRole(f({ superByEnv: true })), 'OWNER')
eq('줄 없는 DB 슈퍼관리자는 소유자', resolvePropertyRole(f({ superByDb: true })), 'OWNER')
eq('줄도 소유도 슈퍼도 없으면 접근 없음', resolvePropertyRole(f({})), null)
eq('DB 표식 false 는 없음과 같다', resolvePropertyRole(f({ superByDb: false })), null)

// ── 크론 푸시의 영업장별 역할 묶음(pushRoleMap). env 슈퍼관리자 판정을 이 함수 안에서 하므로 상승 역주입이 여기서 걸린다(검수 inj6)
const SUPER = 'boss@example.com'
const isSuper = (e: string | null) => e === SUPER
const asObj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort())
eq('크론: 일반 이메일 + 낮은 줄은 그 줄(상승 없음)', asObj(pushRoleMap({ roleRows: [{ propertyId: 'P1', role: 'STAFF' }], ownedIds: [], email: 'staff@example.com', isSuperEmail: isSuper })), { P1: 'STAFF' })
eq('크론: 제한 스태프는 제한 스태프', asObj(pushRoleMap({ roleRows: [{ propertyId: 'P1', role: 'LIMITED_STAFF' }], ownedIds: [], email: 'x@example.com', isSuperEmail: isSuper })), { P1: 'LIMITED_STAFF' })
eq('크론: env 슈퍼관리자 + 낮은 줄은 소유자(종과 같다)', asObj(pushRoleMap({ roleRows: [{ propertyId: 'P1', role: 'STAFF' }], ownedIds: [], email: SUPER, isSuperEmail: isSuper })), { P1: 'OWNER' })
eq('크론: 줄 없는 소유 영업장은 소유자, 줄 있는 소유 영업장은 그 줄', asObj(pushRoleMap({ roleRows: [{ propertyId: 'P2', role: 'MANAGER' }], ownedIds: ['P1', 'P2'], email: null, isSuperEmail: isSuper })), { P1: 'OWNER', P2: 'MANAGER' })
eq('크론: 이메일이 없으면 슈퍼관리자가 아니다', asObj(pushRoleMap({ roleRows: [{ propertyId: 'P1', role: 'STAFF' }], ownedIds: [], email: null, isSuperEmail: isSuper })), { P1: 'STAFF' })
eq('크론: 소유도 줄도 없는 영업장은 없다', asObj(pushRoleMap({ roleRows: [], ownedIds: [], email: SUPER, isSuperEmail: isSuper })), {})

// ── 크론 전수 대조(2단계 독립 검수 권장 1). 관문 행동 그물과 같은 방식으로, 정본을 부르지 않는 독립 기대 함수와 조합 전부를 견준다.
// 기대 함수는 32d87d95 관문의 역할 줄 갈래(env 슈퍼관리자면 소유자, 아니면 그 줄)와 줄 없는 소유 영업장(소유자)을 사용자 행
// 이메일로 옮긴 것이다(1단계 A1 결정, 크론은 승인 수신자만 돌고 소유하거나 줄이 있는 영업장만 본다). 영업장 둘 x (줄 5 x 소유 2) x 이메일 3.
{
  const ROLES = [null, 'LIMITED_STAFF', 'STAFF', 'MANAGER', 'OWNER'] as const
  const expectedCron = (rows: Record<string, string | null>, owned: Record<string, boolean>, email: string | null) => {
    const out: Record<string, string> = {}
    for (const pid of ['P1', 'P2']) {
      if (rows[pid]) out[pid] = isSuper(email) ? 'OWNER' : rows[pid]!
      else if (owned[pid]) out[pid] = 'OWNER'
    }
    return out
  }
  let n = 0, bad = 0
  for (const r1 of ROLES) for (const o1 of [false, true]) for (const r2 of ROLES) for (const o2 of [false, true])
    for (const email of [SUPER, 'x@example.com', null]) {
      const rows = { P1: r1, P2: r2 }, owned = { P1: o1, P2: o2 }
      const got = asObj(pushRoleMap({
        roleRows: (['P1', 'P2'] as const).flatMap(p => rows[p] ? [{ propertyId: p, role: rows[p] as Role }] : []),
        ownedIds: (['P1', 'P2'] as const).filter(p => owned[p]), email, isSuperEmail: isSuper,
      }))
      const want = expectedCron(rows, owned, email)
      n++
      if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; if (bad <= 5) console.log(`  크론 전수 불일치 ${JSON.stringify({ rows, owned, email })}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`) }
    }
  eq(`크론 전수 대조 ${n}조합이 관문 판정(사용자 행 이메일)과 같다`, bad, 0)
}

console.log(`[역할 판정 진리표] 통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
