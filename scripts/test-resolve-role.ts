// 영업장 역할 판정 정본(lib/auth/resolveRole) 진리표. 종 알림의 관문과 크론 푸시가 같은 답을 내는지 지킨다. 실패 시 exit 1.
// 실행: npx tsx scripts/test-resolve-role.ts
//
// 왜(2026-10-15 비품 수령 3차 검수 권장 ①). 크론은 역할을 손으로 정해 env 슈퍼관리자 승격이 빠져 있었고, 글자 대조
// 그물만 있어 역주입(M4)이 안 잡혔다. 판정을 한 함수로 모으고 그 함수의 답을 여기서 고정한다.
import { resolvePropertyRole, type RoleFacts } from '../lib/auth/resolveRole'
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

console.log(`[역할 판정 진리표] 통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
