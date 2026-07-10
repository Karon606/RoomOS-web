'use client'

// AI 기능 사용 전 잔여 무료 횟수 + 본인 키 발급 안내 — 모든 AI 트리거 버튼 옆에 붙이는 정본.
// 본인 키(BYOK) 등록 영업장에는 아무것도 표시하지 않는다. AI 실행 후 잔여가 바뀌면
// notifyAiQuota가 쏘는 'ai-quota-changed' 이벤트로 즉시 갱신된다.

import { useEffect, useState } from 'react'
import { InfoHint } from '@/components/ui/InfoHint'
import { getAiQuotaStatus } from '@/app/(app)/settings/actions'

// 발급 안내 정본 — 단계는 한 줄씩(가독성, 운영자 지적 2026-07-11). 환경설정 AI 카드와 동일 출처.
export function AiKeyGuide() {
  return (
    <span className="block space-y-1">
      <span className="block">제미나이 유료 구독과 무관하게 누구나 무료로 발급됩니다.</span>
      <span className="block mt-1">① aistudio.google.com 접속</span>
      <span className="block">② 구글 계정 로그인</span>
      <span className="block">③ &lsquo;API 키 만들기(Get API key)&rsquo; 클릭</span>
      <span className="block">④ 만들어진 키를 복사해 환경설정의 AI 설정에 붙여넣기</span>
      <span className="block mt-1">등록하면 월 무료 한도(10회) 제한 없이 사용됩니다. 구글 무료 한도로 충분히 쓸 수 있고, 그 이상 쓰려면 구글에 종량제 결제를 등록해야 합니다. 키 사용 요금은 본인 구글 계정으로 청구되며 이 앱과는 무관합니다.</span>
    </span>
  )
}

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
      <InfoHint title="API 키 무료 발급"><AiKeyGuide /></InfoHint>
    </span>
  )
}
