'use client'

// 계약서 모아보기 로드 실패 시 표시되는 오류 경계 — 원인 불명 기본 화면 대신 재시도 안내(ID-21).
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      title="문서를 불러오지 못했습니다"
      description="잠시 후 다시 시도해 주세요."
      action={<Btn variant="secondary" size="sm" onClick={() => reset()}>다시 시도</Btn>}
    />
  )
}
