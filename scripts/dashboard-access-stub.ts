// 대시보드 패리티 하네스 전용 인증 관문 스텁 — cookies() 없이 대상 영업장을 그대로 통과시킨다.
// scripts/tsconfig.dashboard.json 이 '@/lib/auth/propertyAccess' 를 이 파일로 가리켜,
// getDashboardData 가 부르는 액션들(getExpenseCategories·getMoveCalendarMonth 등)이
// 요청 컨텍스트 없이도 돈다. 앱 코드는 절대 이 파일을 import 하지 않는다(선례: server-only-stub).
import type { Role } from '@/lib/role-types'

export type PropertyAccess = {
  userId: string
  email: string | null
  propertyId: string
  role: Role
  isSuperAdmin: boolean
}

function current(): PropertyAccess {
  const propertyId = process.env.PARITY_PROPERTY_ID
  if (!propertyId) throw new Error('PARITY_PROPERTY_ID 가 설정되지 않았다')
  // 소유주 시점 고정 — 금액 마스킹(canReadScope money)이 걸리면 비교 대상이 달라진다.
  return { userId: 'parity-harness', email: null, propertyId, role: 'OWNER' as Role, isSuperAdmin: false }
}

export async function requirePropertyAccess(): Promise<PropertyAccess> {
  return current()
}

export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  return current()
}
