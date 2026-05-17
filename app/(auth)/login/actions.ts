'use server'

import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function syncUserToDB(extra?: {
  realName?: string
  phone?: string
  address?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await prisma.user.upsert({
    where:  { id: user.id },
    create: {
      id:        user.id,
      email:     user.email!,
      name:      user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
      realName:  extra?.realName || null,
      phone:     extra?.phone    || null,
      address:   extra?.address  || null,
    },
    update: {
      name:      user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
      ...(extra?.realName !== undefined && { realName: extra.realName || null }),
      ...(extra?.phone    !== undefined && { phone:    extra.phone    || null }),
      ...(extra?.address  !== undefined && { address:  extra.address  || null }),
    },
  })
}
