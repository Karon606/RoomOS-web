import { analyzePaymentTargetMonth } from './actions'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { getMyRole } from '@/lib/role'
import AccrualCheckClient from './AccrualCheckClient'

export default async function AccrualCheckPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프) — 형제 페이지 12곳과 같은 가드
  const [result, myRole] = await Promise.all([analyzePaymentTargetMonth(), getMyRole()])
  return <AccrualCheckClient initialResult={result} myRole={myRole} />
}
