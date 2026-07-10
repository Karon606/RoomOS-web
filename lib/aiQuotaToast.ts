// AI 실행 직후 무료 사용량 잔여를 표준 토스트로 안내 — 본인 키(BYOK) 사용 중이면 조용히 넘어간다.
// 모든 AI 사용처(영수증·계약서·신분증 OCR, 문자 다듬기, 재무 분석, 배치도 인식)가 같은 문구를 쓴다.

import { pushToast } from '@/lib/saveStatus'
import { getAiQuotaStatus } from '@/app/(app)/settings/actions'

export async function notifyAiQuota(): Promise<void> {
  try {
    const q = await getAiQuotaStatus()
    // 사용 전 잔여 배지(AiQuotaHint)들이 즉시 갱신되도록 알림
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ai-quota-changed'))
    if (q.own) return
    pushToast('info', `이번 달 무료 AI ${q.remaining}회 남음 (${q.used}/${q.limit} 사용)`, {
      detail: '환경설정의 AI 설정에서 본인 API 키를 등록하면 제한 없이 사용됩니다. 키는 aistudio.google.com에서 구독과 무관하게 무료 발급됩니다.',
    })
  } catch { /* 잔여 안내 실패는 기능에 영향 없음 */ }
}
