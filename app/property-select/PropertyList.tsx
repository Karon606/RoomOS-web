'use client'

import { useTransition, useState } from 'react'
import { selectProperty, signOut } from './actions'

const ROLE_STYLE: Record<string, string> = {
  OWNER:   'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  MANAGER: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  STAFF:   'bg-gray-500/20 text-gray-400 border border-gray-500/30',
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
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
        <p className="text-4xl">🏗️</p>
        <p className="text-white font-medium">소속된 영업장이 없습니다</p>
        <p className="text-sm text-gray-500">
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
          return (
            <li key={p.propertyId}>
              <button
                onClick={() => handleSelect(p.propertyId)}
                disabled={!p.isActive || isPending}
                className="w-full text-left bg-gray-900 hover:bg-gray-800 active:bg-gray-800
                           border border-gray-800 hover:border-indigo-500/50
                           rounded-2xl p-5 transition-all group
                           disabled:opacity-40 disabled:cursor-not-allowed
                           touch-manipulation"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white group-hover:text-indigo-300
                                  transition-colors truncate">
                      {p.propertyName}
                      {!p.isActive && <span className="text-xs text-gray-600 ml-2">(운영 종료)</span>}
                    </p>
                    {p.address && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">{p.address}</p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_STYLE[p.role]}`}>
                    {ROLE_LABEL[p.role]}
                  </span>
                </div>
                <div className="mt-3 flex justify-end items-center gap-2">
                  {isLoading ? (
                    <span className="text-indigo-400 text-sm flex items-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      이동 중...
                    </span>
                  ) : (
                    <span className="text-gray-600 group-hover:text-indigo-400 transition-colors text-sm">
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
          className="w-full text-sm text-gray-600 hover:text-gray-400 transition-colors py-2 disabled:opacity-40 touch-manipulation"
        >
          다른 계정으로 로그인
        </button>
      </form>
    </>
  )
}
