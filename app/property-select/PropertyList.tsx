'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { selectProperty, signOut, createProperty, requestJoinByCode, reactivateProperty } from './actions'

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  OWNER:   { bg: 'rgba(244,98,58,0.12)', color: 'var(--persimmon-d)' },
  MANAGER: { bg: 'rgba(122,106,90,0.12)', color: 'var(--ink-3)' },
  STAFF:   { bg: 'var(--neutral-bg)', color: 'var(--neutral-fg)' },
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
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  // 참여 코드 입력
  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinMsg, setJoinMsg] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinSuccess, setJoinSuccess] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    setCreateError('')
    const result = await createProperty(newName)
    if (!result.ok) {
      setCreateError(result.error)
      setIsCreating(false)
      return
    }
    router.push('/dashboard')
  }

  const handleJoin = async () => {
    if (!joinCode.trim()) return
    setIsJoining(true); setJoinError(''); setJoinSuccess('')
    const result = await requestJoinByCode(joinCode, joinMsg || undefined)
    setIsJoining(false)
    if (!result.ok) { setJoinError(result.error); return }
    setJoinSuccess(`'${result.propertyName}' 운영자에게 참여 요청이 전송됐습니다. 승인되면 영업장 목록에 표시됩니다.`)
    setJoinCode(''); setJoinMsg('')
  }

  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const handleReactivate = (propertyId: string) => {
    setReactivatingId(propertyId)
    startTransition(async () => {
      const res = await reactivateProperty(propertyId)
      if (res.ok) router.refresh()
      setReactivatingId(null)
    })
  }

  const handleSelect = (propertyId: string) => {
    if (selectingId) return  // 이미 선택 중이면 무시
    setSelectingId(propertyId)
    startTransition(async () => {
      const result = await selectProperty(propertyId)
      if (result.ok) {
        router.push('/dashboard')
      } else {
        setSelectingId(null)
      }
    })
  }

  // JSX 상수(함수 컴포넌트 X) — 함수 컴포넌트로 두면 부모 리렌더(입력 한 글자)마다
  // 새 컴포넌트 타입으로 인식돼 input 이 매번 리마운트되고, 한글 IME 조합이 끊겨
  // 자모가 분리됨(운영자 신고, iOS·Android). 상수 엘리먼트는 이 문제가 없다.
  const joinForm = (
    <div className="rounded-xl p-6 space-y-3"
         style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>참여 코드로 영업장 참여</p>
      <input
        autoFocus
        type="text"
        value={joinCode}
        onChange={e => setJoinCode(e.target.value.toUpperCase())}
        placeholder="영업장 운영자에게 받은 6자 코드"
        autoComplete="off"
        className="w-full rounded-sm px-3 py-2.5 text-sm outline-none num"
        style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}
      />
      <textarea
        value={joinMsg}
        onChange={e => setJoinMsg(e.target.value)}
        rows={2}
        placeholder="간단한 메시지 (선택) — 본인 소개 등"
        className="w-full rounded-sm px-3 py-2.5 text-sm outline-none resize-none"
        style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}
      />
      {joinError && <p className="text-xs" style={{ color: 'var(--danger-fg)' }}>{joinError}</p>}
      {joinSuccess && <p className="text-xs leading-relaxed" style={{ color: 'var(--persimmon-d)' }}>{joinSuccess}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => { setShowJoin(false); setJoinCode(''); setJoinMsg(''); setJoinError(''); setJoinSuccess('') }}
          className="flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: 'var(--canvas)', color: 'var(--warm-muted)', border: '1px solid var(--warm-border)' }}>
          닫기
        </button>
        <button
          onClick={handleJoin}
          disabled={isJoining || !joinCode.trim()}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--coral)', color: 'var(--warm-dark)' }}>
          {isJoining ? '요청 중...' : '참여 요청 보내기'}
        </button>
      </div>
    </div>
  )

  const createForm = (
    <div className="rounded-xl p-6 space-y-3"
         style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>새 영업장 개설</p>
      <input
        autoFocus
        type="text"
        value={newName}
        onChange={e => setNewName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleCreate()}
        placeholder="영업장 이름 (예: 강남 고시원)"
        className="w-full rounded-sm px-3 py-2.5 text-sm outline-none"
        style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}
      />
      {createError && <p className="text-xs text-[var(--danger-fg)]">{createError}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => { setShowCreate(false); setNewName(''); setCreateError('') }}
          className="flex-1 py-2.5 rounded-xl text-sm"
          style={{ background: 'var(--canvas)', color: 'var(--warm-muted)', border: '1px solid var(--warm-border)' }}>
          취소
        </button>
        <button
          onClick={handleCreate}
          disabled={isCreating || !newName.trim()}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--coral)', color: 'var(--warm-dark)' }}>
          {isCreating ? '개설 중...' : '개설하기'}
        </button>
      </div>
    </div>
  )

  if (properties.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl p-8 text-center space-y-3"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <svg className="mx-auto" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 21 V8 L12 3 L21 8 V21 M9 21 V13 H15 V21" />
          </svg>
          <p className="font-medium" style={{ color: 'var(--warm-dark)' }}>소속된 영업장이 없습니다</p>
          <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>
            영업장 오너로부터 초대를 받거나<br />새 영업장을 직접 개설하세요.
          </p>
          {!showCreate && !showJoin && (
            <div className="flex flex-col gap-2 items-center mt-2">
              <button
                onClick={() => setShowCreate(true)}
                className="px-6 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: 'var(--coral)', color: 'var(--warm-dark)' }}>
                + 새 영업장 개설
              </button>
              <button
                onClick={() => setShowJoin(true)}
                className="text-sm"
                style={{ color: 'var(--persimmon-d)' }}>
                참여 코드로 영업장 참여 →
              </button>
            </div>
          )}
        </div>
        {showCreate && createForm}
        {showJoin && joinForm}
        <form action={signOut}>
          <button type="submit"
            className="w-full text-sm py-2 transition-colors"
            style={{ color: 'var(--warm-muted)' }}>
            다른 계정으로 로그인
          </button>
        </form>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-3">
        {properties.map(p => {
          const isLoading = selectingId === p.propertyId
          const roleStyle = ROLE_STYLE[p.role] ?? ROLE_STYLE.STAFF
          return (
            <li key={p.propertyId}>
              <button
                onClick={() => handleSelect(p.propertyId)}
                disabled={!p.isActive || isPending}
                className="w-full text-left rounded-xl p-5 transition-all touch-manipulation
                  disabled:opacity-40 disabled:cursor-not-allowed
                  hover:border-[var(--coral)] active:scale-[0.98] active:opacity-80"
                style={{ background: 'var(--cream)', border: `1px solid ${isLoading ? 'var(--coral)' : 'var(--warm-border)'}` }}
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
              {/* 운영 종료된 영업장은 진입 불가 → 오너에게 '운영 재개' 노출(재개해야 들어가 관리 가능) */}
              {!p.isActive && p.role === 'OWNER' && (
                <button
                  onClick={() => handleReactivate(p.propertyId)}
                  disabled={isPending}
                  className="mt-1.5 w-full py-2 rounded-xl text-xs font-medium disabled:opacity-40"
                  style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--coral)' }}>
                  {reactivatingId === p.propertyId ? '재개 중...' : '운영 재개'}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {showCreate ? (
        createForm
      ) : showJoin ? (
        joinForm
      ) : (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowCreate(true)}
            disabled={isPending}
            className="w-full py-3 rounded-xl text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-mid)' }}>
            + 새 영업장 개설
          </button>
          <button
            onClick={() => setShowJoin(true)}
            disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm disabled:opacity-40"
            style={{ background: 'transparent', border: '1px dashed var(--warm-border)', color: 'var(--persimmon-d)' }}>
            참여 코드로 영업장 참여
          </button>
        </div>
      )}

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
