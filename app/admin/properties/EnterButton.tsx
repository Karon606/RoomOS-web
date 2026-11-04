'use client'

import { useFormStatus } from 'react-dom'
import { Btn } from '@/components/ui/Btn'

// 슈퍼관리자 영업장 진입 제출 버튼 — 클릭 후 서버 액션 + 리다이렉트 동안 pending 표시. 정본 Btn(§10, raw button 걷음).
export default function EnterButton() {
  const { pending } = useFormStatus()
  return (
    <Btn type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? '들어가는 중…' : '들어가기 ›'}
    </Btn>
  )
}
