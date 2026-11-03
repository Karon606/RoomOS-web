// 현금영수증 흐름 하네스 전용 영업장 관문 대역. 쿠키 없이 하네스가 고른 영업장을 소유주로 통과시킨다.
// scripts/tsconfig.cash-receipt-flow.json 이 '@/lib/auth/propertyAccess' 를 이 파일로 가리킨다.
// 영업장을 바꾸면(globalThis.__CR_FLOW_PID) 그 순간부터 모든 액션이 그 영업장 사용자로 돈다. 멀티테넌트
// 시나리오(남의 id 로는 아무것도 못 바꾼다)를 이 한 값으로 돌린다. 앱 코드는 절대 이 파일을 import 하지 않는다.
import type { Role } from '@/lib/role-types'

export type PropertyAccess = { userId: string; email: string | null; propertyId: string; role: Role; isSuperAdmin: boolean }

// __CR_FLOW_ROLE 을 두면 그 역할로 선다(문자 이력 절이 열람 역할 거부를 본다, 사유 하네스 대역과 같은 문법). 안 두면 종전대로 OWNER.
const g = globalThis as unknown as { __CR_FLOW_PID?: string; __CR_FLOW_ROLE?: Role }

export async function requirePropertyAccess(): Promise<PropertyAccess> {
  if (!g.__CR_FLOW_PID) throw new Error('cr-flow: 영업장을 고르지 않았습니다')
  return { userId: 'cr-flow-harness', email: null, propertyId: g.__CR_FLOW_PID, role: g.__CR_FLOW_ROLE ?? ('OWNER' as Role), isSuperAdmin: false }
}

export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  return g.__CR_FLOW_PID ? requirePropertyAccess() : null
}
