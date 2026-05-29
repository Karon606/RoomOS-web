'use client'

// Prism 공통 하단 네비 — 어느 상세 팝업에서 보든 같은 자리·같은 모양·같은 순서.
// 현재 면(호실/고객/수납)은 Terracotta 강조, 연결 대상이 없으면 disabled.
// 클릭 시 entityModal.open() — Phase 2에서 각 페이지의 풀 상세 팝업 추출 후
// 클릭 대상이 진짜 풀 팝업으로 바뀐다. 현재는 간이 EntityModal 로 폴백.

import { useEntityModal } from './EntityModal'

export type PrismCurrent = 'room' | 'tenant' | 'payment'
export type PrismLinks = {
  roomId?: string | null
  tenantId?: string | null
  leaseTermId?: string | null
}

export function PrismNavBar({ current, links }: { current: PrismCurrent; links: PrismLinks }) {
  const entityModal = useEntityModal()

  const items: { kind: PrismCurrent; label: string; enabled: boolean; onClick: () => void }[] = [
    {
      kind: 'room', label: '호실',
      enabled: !!links.roomId,
      onClick: () => entityModal.open({ kind: 'room', roomId: links.roomId ?? undefined }),
    },
    {
      kind: 'tenant', label: '고객',
      enabled: !!links.tenantId,
      onClick: () => entityModal.open({ kind: 'tenant', tenantId: links.tenantId ?? undefined }),
    },
    {
      kind: 'payment', label: '수납',
      enabled: !!links.leaseTermId,
      onClick: () => entityModal.open({ kind: 'payment', leaseTermId: links.leaseTermId ?? undefined }),
    },
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
            onClick={it.onClick}
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
