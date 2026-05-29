'use client'

// Prism 공통 하단 네비 — 어느 상세 팝업에서 보든 같은 자리·같은 모양·같은 순서.
// 현재 면(호실/고객/수납)은 Terracotta 강조, 연결 대상이 없으면 disabled.
//
// 두 가지 모드:
//  · onSelect 제공 → "인플레이스 전환" — 같은 셸 안에서 body 만 갈아끼움 (2중 스택 X). PrismShell 안에서 쓰인다.
//  · onSelect 미제공 → entityModal.open() 호출 — 페이지 자체 팝업 위에 셸이 새로 뜸 (현재 페이지 팝업의 기본 동작).
// Phase 2.3/2.4 에서 페이지 팝업들이 PrismShell 로 이주하면 onSelect 모드만 남는다.

import { useEntityModal } from './EntityModal'

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

  const handle = (kind: PrismCurrent) => {
    if (onSelect) { onSelect(kind); return }
    if (kind === 'room')         entityModal.open({ kind: 'room',    roomId:      links.roomId ?? undefined })
    else if (kind === 'tenant')  entityModal.open({ kind: 'tenant',  tenantId:    links.tenantId ?? undefined })
    else                          entityModal.open({ kind: 'payment', leaseTermId: links.leaseTermId ?? undefined })
  }

  const items: { kind: PrismCurrent; label: string; enabled: boolean }[] = [
    { kind: 'room',    label: '호실', enabled: !!links.roomId },
    { kind: 'tenant',  label: '고객', enabled: !!links.tenantId },
    { kind: 'payment', label: '수납', enabled: !!links.leaseTermId },
  ]

  return (
    <div className="flex gap-2">
      {items.map(it => {
        const isCurrent = it.kind === current
        return (
          <button
            key={it.kind}
            type="button"
            disabled={!it.enabled || isCurrent}
            onClick={() => handle(it.kind)}
            aria-current={isCurrent ? 'page' : undefined}
            className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-colors disabled:cursor-default ${
              isCurrent
                ? 'bg-[var(--coral)] text-white'
                : it.enabled
                ? 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'
                : 'bg-[var(--canvas)] text-[var(--warm-muted)] opacity-40'
            }`}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
