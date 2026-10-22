'use client'
// 사유 목록(입실 취소·퇴실·보증금 미반환, 2차 여섯)을 영업장 설정에서 읽어 오는 훅. 사유 고르는 칸(CategorySelect addMode 'ask')이 쓴다.

import { useEffect, useState } from 'react'
import {
  getCancelReasons, getCheckoutReasons, getWithholdReasons,
  getDueDayReasons, getCleaningReasons, getStockDisposalReasons, getStockSourceOptions, getAssetDisposalReasons, getVisitRouteOptions,
} from '@/app/(app)/settings/actions'
import type { ReasonListField } from '@/lib/optionLists'

const READ: Record<ReasonListField, () => Promise<string[]>> = {
  cancelReasons: getCancelReasons,
  checkoutReasons: getCheckoutReasons,
  withholdReasons: getWithholdReasons,
  dueDayReasons: getDueDayReasons,
  cleaningReasons: getCleaningReasons,
  stockDisposalReasons: getStockDisposalReasons,
  stockSourceOptions: getStockSourceOptions,
  assetDisposalReasons: getAssetDisposalReasons,
  visitRouteOptions: getVisitRouteOptions,
}

/**
 * field 가 null 이면 빈 목록이다(사유를 받지 않는 전이). 읽기 전에는 빈 목록이라, 이미 골라 둔 값(이어받은 사유·
 * 미리 고른 '청소비')은 그동안 칸에 그 글자 그대로 서고 목록이 오면 같은 항목으로 이어진다.
 * 읽기에 실패하면 빈 목록에 '기타(직접 입력)' 만 남는다. 저장은 서버가 목록으로 다시 재므로 틀린 값이 남지 않는다.
 */
export function useReasonOptions(field: ReasonListField | null): string[] {
  return useReasonOptionList(field) ?? []
}

/**
 * useReasonOptions 와 같되 읽기 전에는 null 이다(실패하면 빈 목록). 목록 첫 항목을 기본값으로 세우는 등록 폼이
 * 읽는 동안 칸을 잠그고 비워 둘 때 쓴다. 빈 목록으로 그리면 '기록 안 함' 이 섰다가 첫 항목으로 바뀌어 깜빡이고,
 * 그사이 저장하면 운영자가 고르지 않은 '기록 안 함' 이 남는다(2차 독립 검수).
 */
export function useReasonOptionList(field: ReasonListField | null): string[] | null {
  const [byField, setByField] = useState<Partial<Record<ReasonListField, string[]>>>({})
  useEffect(() => {
    if (!field) return
    let live = true
    const put = (list: string[]) => { if (live) setByField(prev => ({ ...prev, [field]: list })) }
    void READ[field]().then(put).catch(() => put([]))
    return () => { live = false }
  }, [field])
  return field ? byField[field] ?? null : []
}
