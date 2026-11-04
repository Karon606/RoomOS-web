'use server'

import { createClient } from '@/lib/supabase/server'
import { ensureAppUser, identityFromAuthUser, type SignupExtra } from '@/lib/auth/ensureAppUser'

// 로그인 직후 본인 사용자 행 동기화. 행 보장·메타데이터 회수·초대코드 적용은 정본 lib/auth/ensureAppUser 가 한다.
// 이메일 인증이 켜져 있으면 signUp 직후엔 세션이 없어 이 함수가 no-op 이 된다. 그래서 가입 폼이 실명·연락처·초대코드를
// user_metadata 에 실어 두고, 첫 로그인(또는 인증 링크 콜백·계정 관문) 때 정본이 회수한다.
// 이 함수가 빠져도(통신 실패 등) 계정 관문 getAccessContext 가 행이 없는 신원을 보면 같은 정본으로 만든다.
export async function syncUserToDB(extra?: SignupExtra) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await ensureAppUser(identityFromAuthUser(user), { extra, refreshProfile: true })
}
