'use server'

import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function syncUserToDB() {
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
    },
    update: {
      name:      user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    },
  })
}
