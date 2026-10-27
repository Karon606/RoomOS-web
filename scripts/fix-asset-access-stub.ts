// 일회성 비품 정리 스크립트 전용 영업장 관문 대역. 스크립트가 고른 영업장(globalThis.__FIX_PID)을 소유주로 통과시킨다.
// scripts/tsconfig.fix-asset-combine.json 이 '@/lib/auth/propertyAccess' 를 이 파일로 가리킨다. 앱 코드는 절대 이 파일을 import 하지 않는다.
// 하네스 대역(cr-flow-access-stub)과 달리 DB 는 진짜(lib/prisma)다. 그래서 영업장을 고르지 않으면 바로 던진다.
import type { Role } from '@/lib/role-types'

export type PropertyAccess = { userId: string; email: string | null; propertyId: string; role: Role; isSuperAdmin: boolean }

const g = globalThis as unknown as { __FIX_PID?: string }

export async function requirePropertyAccess(): Promise<PropertyAccess> {
  if (!g.__FIX_PID) throw new Error('fix-asset: 영업장을 고르지 않았습니다')
  return { userId: 'fix-asset-script', email: null, propertyId: g.__FIX_PID, role: 'OWNER' as Role, isSuperAdmin: false }
}

export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  return g.__FIX_PID ? requirePropertyAccess() : null
}
