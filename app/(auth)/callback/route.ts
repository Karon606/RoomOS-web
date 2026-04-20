import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const returnTo = searchParams.get('returnTo') ?? '/property-select'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const { id, email, user_metadata } = data.user

      await prisma.user.upsert({
        where:  { id },
        create: {
          id,
          email:     email!,
          name:      user_metadata?.full_name ?? null,
          avatarUrl: user_metadata?.avatar_url ?? null,
        },
        update: {
          name:      user_metadata?.full_name ?? null,
          avatarUrl: user_metadata?.avatar_url ?? null,
        },
      })

      return NextResponse.redirect(`${origin}${returnTo}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`)
}