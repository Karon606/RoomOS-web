// 사유 목록 하네스 전용 영업장 관문 대역. cr-flow 대역과 같고 사용자 id 만 uuid 다(상태 이력 changedById 칸이 uuid 라서).
// scripts/tsconfig.reason-flow.json 이 '@/lib/auth/propertyAccess' 를 이 파일로 가리킨다. 앱 코드는 절대 이 파일을 import 하지 않는다.
import type { Role } from '@/lib/role-types'

export type PropertyAccess = { userId: string; email: string | null; propertyId: string; role: Role; isSuperAdmin: boolean }

const g = globalThis as unknown as { __CR_FLOW_PID?: string }
const HARNESS_USER = '00000000-0000-4000-8000-00000000f10e'

export async function requirePropertyAccess(): Promise<PropertyAccess> {
  if (!g.__CR_FLOW_PID) throw new Error('reason-flow: 영업장을 고르지 않았습니다')
  return { userId: HARNESS_USER, email: null, propertyId: g.__CR_FLOW_PID, role: 'OWNER' as Role, isSuperAdmin: false }
}

export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  return g.__CR_FLOW_PID ? requirePropertyAccess() : null
}
