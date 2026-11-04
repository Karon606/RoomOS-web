'use server'

import { getAccessContext } from '@/lib/auth/access'

export type MyAccessStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'SIGNED_OUT'

// 승인 대기 화면의 상태 재확인. 본인 상태만 읽는다(대기 계정도 지나야 하는 문이라 계정 승인 문을 걸지 않는다).
// 화면이 탭 복귀·30초마다·[승인 확인] 때 부르고, 승인이면 스스로 앱으로 넘어간다(2026-11-04 운영자 승인 '추천대로').
export async function checkMyAccess(): Promise<MyAccessStatus> {
  const ctx = await getAccessContext()
  if (!ctx) return 'SIGNED_OUT'
  return ctx.isSuperAdmin ? 'APPROVED' : ctx.status
}
