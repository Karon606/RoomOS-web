'use client'

import { useTransition, useState } from 'react'
import { selectProperty, signOut } from './actions'

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  OWNER:   { bg: 'rgba(244,98,58,0.12)', color: '#d94d28' },
  MANAGER: { bg: 'rgba(122,106,90,0.12)', color: '#7a6a5a' },
  STAFF:   { bg: 'rgba(168,152,136,0.12)', color: '#a89888' },
}
const ROLE_LABEL: Record<string, string> = {
  OWNER: '오너', MANAGER: '매니저', STAFF: '스태프',
}

type Property = {
  propertyId: string
  propertyName: string
  address: string | null
  isActive: boolean
  role: string
}

export default function PropertyList({ properties }: { properties: Property[] }) {
  const [isPending, startTransition] = useTransition()
  const [selectingId, setSelectingId] = useState<string | null>(null)

  const handleSelect = (propertyId: string) => {
    setSelectingId(propertyId)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('propertyId', propertyId)
      await selectProperty(formData)
    })
  }

  if (properties.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center space-y-3"
           style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-4xl">🏗️</p>
        <p className="font-medium" style={{ color: 'var(--warm-dark)' }}>소속된 영업장이 없습니다</p>
        <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>
          영업장 오너로부터 초대를 받거나<br />새 영업장을 직접 개설하세요.
        </p>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-3">
        {properties.map(p => {
          const isLoading = isPending && selectingId === p.propertyId
          const roleStyle = ROLE_STYLE[p.role] ?? ROLE_STYLE.STAFF
          return (
            <li key={p.propertyId}>
              <button
                onClick={() => handleSelect(p.propertyId)}
                disabled={!p.isActive || isPending}
                className="w-full text-left rounded-2xl p-5 transition-all disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
                style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
                onMouseEnter={e => {
                  if (p.isActive && !isPending)
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--coral)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--warm-border)'
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: 'var(--warm-dark)' }}>
                      {p.propertyName}
                      {!p.isActive && <span className="text-xs ml-2" style={{ color: 'var(--warm-muted)' }}>(운영 종료)</span>}
                    </p>
                    {p.address && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--warm-muted)' }}>{p.address}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full"
                        style={{ background: roleStyle.bg, color: roleStyle.color }}>
                    {ROLE_LABEL[p.role]}
                  </span>
                </div>
                <div className="mt-3 flex justify-end items-center gap-2">
                  {isLoading ? (
                    <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--coral)' }}>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      이동 중...
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--warm-muted)' }}>
                      선택 →
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <form action={signOut}>
        <button
          type="submit"
          disabled={isPending}
          className="w-full text-sm transition-colors py-2 disabled:opacity-40 touch-manipulation"
          style={{ color: 'var(--warm-muted)' }}>
          다른 계정으로 로그인
        </button>
      </form>
    </>
  )
}
