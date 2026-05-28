'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

// Google OAuth 가입자처럼 가입 시 실명·연락처를 수집할 폼이 없는 케이스용 후처리.
// (app)/layout 가 (승인된 일반 사용자 + realName null + 스킵 쿠키 없음) 일 때 /profile-setup 으로 보냄.

const SKIP_COOKIE = 'profile_setup_skipped'

export async function saveProfileSetup(input: { realName: string; phone: string; address: string }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const uid = data?.claims?.sub as string | undefined
  if (!uid) redirect('/login')

  await prisma.user.update({
    where: { id: uid },
    data: {
      realName: input.realName.trim() || null,
      phone:    input.phone.trim()    || null,
      address:  input.address.trim()  || null,
    },
  })
  revalidatePath('/admin/users')
  // 채워졌으니 다시 안 뜨도록 skip 쿠키도 정리
  const cookieStore = await cookies()
  cookieStore.delete(SKIP_COOKIE)
  redirect('/property-select')
}

export async function skipProfileSetup() {
  const cookieStore = await cookies()
  cookieStore.set(SKIP_COOKIE, '1', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30, // 30일 — 그 후 다시 안내
  })
  redirect('/property-select')
}
