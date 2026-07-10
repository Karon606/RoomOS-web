'use client'

// AI 기능 사용 전 잔여 무료 횟수 + 본인 키 발급 안내 — 모든 AI 트리거 버튼 옆에 붙이는 정본.
// 본인 키(BYOK) 등록 영업장에는 아무것도 표시하지 않는다. AI 실행 후 잔여가 바뀌면
// notifyAiQuota가 쏘는 'ai-quota-changed' 이벤트로 즉시 갱신된다.

import { useEffect, useState } from 'react'
import { InfoHint } from '@/components/ui/InfoHint'
import { getAiQuotaStatus } from '@/app/(app)/settings/actions'

// 발급 안내 정본 문구 — 환경설정 AI 카드와 동일 출처
export const AI_KEY_GUIDE =
  '제미나이 유료 구독과 무관하게 누구나 무료로 발급됩니다. ① aistudio.google.com 접속 ② 구글 계정 로그인 ③ ‘API 키 만들기(Get API key)’ 클릭 ④ 만들어진 키를 복사해 환경설정의 AI 설정에 붙여넣기. 등록하면 월 무료 한도 없이 제한 없이 사용됩니다. 무료 한도로 충분히 사용 가능하며, 한도를 넘겨 쓰려면 구글에 종량제 결제를 등록해야 합니다. 키 사용 요금은 본인 구글 계정으로 청구되며 이 앱과는 무관합니다.'

type Quota = { own: boolean; remaining: number; limit: number }

export function AiQuotaHint({ className = '' }: { className?: string }) {
  const [q, setQ] = useState<Quota | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => getAiQuotaStatus().then(r => { if (alive) setQ(r) }).catch(() => { /* 표시 생략 */ })
    void load()
    const onChanged = () => void load()
    window.addEventListener('ai-quota-changed', onChanged)
    return () => { alive = false; window.removeEventListener('ai-quota-changed', onChanged) }
  }, [])
  if (!q || q.own) return null
  return (
    <span className={`inline-flex items-center text-[0.6875rem] text-[var(--warm-muted)] ${className}`}>
      <span className={q.remaining === 0 ? 'text-[var(--danger-fg)] font-medium' : ''}>
        무료 AI {q.remaining}회 남음
      </span>
      <InfoHint title="본인 API 키로 제한 없이 쓰기">{AI_KEY_GUIDE}</InfoHint>
    </span>
  )
}
