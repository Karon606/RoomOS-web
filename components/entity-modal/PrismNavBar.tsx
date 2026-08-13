'use client'

// Prism 공통 하단 네비 — 어느 상세 팝업에서 보든 같은 자리·같은 모양·같은 순서.
// 현재 면(호실/입주자/수납)은 Terracotta 강조, 연결 대상이 없으면 disabled.
//
// 두 가지 모드:
//  · onSelect 제공 → "인플레이스 전환" — 같은 셸 안에서 body 만 갈아끼움 (2중 스택 X). PrismShell 안에서 쓰인다.
//  · onSelect 미제공 → entityModal.open() 호출 — 페이지 자체 팝업 위에 셸이 새로 뜸 (현재 페이지 팝업의 기본 동작).
// Phase 2.3/2.4 에서 페이지 팝업들이 PrismShell 로 이주하면 onSelect 모드만 남는다.

import { useEntityModal } from './EntityModal'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { useCanReadScope } from '@/components/RoleContext'

export type PrismCurrent = 'room' | 'tenant' | 'payment'
export type PrismLinks = {
  roomId?: string | null
  tenantId?: string | null
  leaseTermId?: string | null
}

export function PrismNavBar({ current, links, onSelect }: {
  current: PrismCurrent
  links: PrismLinks
  onSelect?: (kind: PrismCurrent) => void
}) {
  const entityModal = useEntityModal()
  const canSeeMoney = useCanReadScope('money')   // 제한 스태프는 수납 정보 탭 미표시(서버는 A-5에서 이미 차단)

  const handle = (kind: PrismCurrent) => {
    if (onSelect) { onSelect(kind); return }
    if (kind === 'room')         entityModal.open({ kind: 'room',    roomId:      links.roomId ?? undefined })
    else if (kind === 'tenant')  entityModal.open({ kind: 'tenant',  tenantId:    links.tenantId ?? undefined })
    else                          entityModal.open({ kind: 'payment', leaseTermId: links.leaseTermId ?? undefined })
  }

  // '정보' 접미 — 액션 버튼이 아니라 '다른 면 보기' 라는 점을 명확히 (사용자 피드백 2026-05-31).
  const items: { kind: PrismCurrent; label: string; enabled: boolean }[] = [
    { kind: 'room',    label: '호실 정보', enabled: !!links.roomId },
    { kind: 'tenant',  label: '입주자 정보', enabled: !!links.tenantId },
    ...(canSeeMoney ? [{ kind: 'payment' as const, label: '수납 정보', enabled: !!links.leaseTermId }] : []),
  ]

  return (
    <ViewTabs
      fill
      ariaLabel="상세 정보 전환"
      activeId={current}
      // 현재 면 재선택은 무변경(원래 현재 탭은 비활성이라 클릭 불가였음).
      onChange={id => { if (id !== current) handle(id as PrismCurrent) }}
      // 연결 대상이 없는 면은 disabled. 단, 현재 면은 항상 활성(코랄 채움)으로 유지.
      tabs={items.map(it => ({
        id: it.kind,
        label: it.label,
        disabled: !it.enabled && it.kind !== current,
      }))}
    />
  )
}
