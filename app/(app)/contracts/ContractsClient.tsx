'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteContractFile, type getAllContractsForProperty } from '@/app/(app)/tenants/actions'
import { trackSave, pushToast } from '@/lib/saveStatus'

type Contract = Awaited<ReturnType<typeof getAllContractsForProperty>>[number]

const fmtDate = (d: Date | string | null) => d
  ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  : '—'

export default function ContractsClient({ initialContracts }: { initialContracts: Contract[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filterSource, setFilterSource] = useState<'all' | 'GENERATED' | 'UPLOADED'>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'date' | 'tenant'>('date')

  const filtered = useMemo(() => {
    return initialContracts.filter(c => {
      if (filterSource !== 'all' && c.source !== filterSource) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = `${c.tenant?.name ?? ''} ${c.fileName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [initialContracts, filterSource, search])

  const grouped = useMemo(() => {
    if (groupBy === 'tenant') {
      const map = new Map<string, Contract[]>()
      for (const c of filtered) {
        const key = c.tenant?.id ?? '_unknown'
        const arr = map.get(key) ?? []
        arr.push(c)
        map.set(key, arr)
      }
      return Array.from(map.entries()).map(([id, items]) => ({
        id,
        label: items[0]?.tenant?.name ?? '입실자 미상',
        roomNo: items[0]?.tenant?.leaseTerms[0]?.room?.roomNo ?? null,
        items,
      }))
    }
    return null
  }, [filtered, groupBy])

  const handleDelete = (id: string) => {
    if (!confirm('이 계약서 파일을 삭제할까요?\n\n· Google Drive 에서도 삭제됩니다.')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteContractFile(id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '삭제됨')
        router.refresh()
      } finally { release() }
    })
  }

  const sourceCount = {
    all: initialContracts.length,
    GENERATED: initialContracts.filter(c => c.source === 'GENERATED').length,
    UPLOADED: initialContracts.filter(c => c.source === 'UPLOADED').length,
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">계약서</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            전체 {sourceCount.all}건 · 서명 {sourceCount.GENERATED} / 스캔 {sourceCount.UPLOADED}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="입실자/파일명 검색..."
          className="text-sm px-3 py-2 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] min-w-[220px]"
        />
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* source */}
        {(['all', 'GENERATED', 'UPLOADED'] as const).map(s => (
          <button key={s} onClick={() => setFilterSource(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filterSource === s
                ? 'bg-[var(--coral)] text-white'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
            }`}>
            {s === 'all' ? '전체' : s === 'GENERATED' ? '서명 생성' : '스캔 업로드'}
          </button>
        ))}
        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />
        {/* group */}
        <span className="text-[10px] text-[var(--warm-muted)] mr-1">정렬</span>
        {(['date', 'tenant'] as const).map(g => (
          <button key={g} onClick={() => setGroupBy(g)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              groupBy === g
                ? 'bg-[var(--ink-2)] text-white'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]'
            }`}>
            {g === 'date' ? '최신순' : '입실자별'}
          </button>
        ))}
      </div>

      {/* 리스트 */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-10 text-center text-sm text-[var(--warm-muted)]">
          조건에 맞는 계약서가 없습니다.
        </div>
      ) : groupBy === 'tenant' && grouped ? (
        <div className="space-y-4">
          {grouped.map(g => (
            <div key={g.id}>
              <Link href={g.id !== '_unknown' ? `/tenants?tenantId=${g.id}&tab=info` : '#'}
                className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] inline-flex items-center gap-1.5 mb-2">
                {g.label}{g.roomNo && ` · ${g.roomNo}호`}
                <span className="text-[10px] text-[var(--warm-muted)]">{g.items.length}건</span>
              </Link>
              <ul className="space-y-1.5">
                {g.items.map(c => <ContractRow key={c.id} c={c} onDelete={handleDelete} pending={pending} />)}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map(c => <ContractRow key={c.id} c={c} onDelete={handleDelete} pending={pending} showTenant />)}
        </ul>
      )}
    </div>
  )
}

function ContractRow({ c, onDelete, pending, showTenant }: { c: Contract; onDelete: (id: string) => void; pending: boolean; showTenant?: boolean }) {
  const isGen = c.source === 'GENERATED'
  const roomNo = c.tenant?.leaseTerms[0]?.room?.roomNo
  return (
    <li className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)]">
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
        isGen
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      }`}>
        {isGen ? '서명' : '스캔'}
      </span>
      {showTenant && c.tenant && (
        <Link href={`/tenants?tenantId=${c.tenant.id}&tab=info`}
          className="text-xs font-medium text-[var(--warm-dark)] hover:text-[var(--coral)] shrink-0">
          {c.tenant.name}{roomNo && ` · ${roomNo}호`}
        </Link>
      )}
      <span className="text-[11px] text-[var(--warm-muted)] shrink-0">{fmtDate(c.signedAt)}</span>
      <a href={c.viewUrl} target="_blank" rel="noreferrer"
        className="flex-1 min-w-0 text-xs text-[var(--warm-mid)] hover:text-[var(--coral)] truncate">
        {c.fileName}
      </a>
      <button onClick={() => onDelete(c.id)} disabled={pending}
        className="text-[11px] text-red-500 hover:text-red-600 shrink-0">
        삭제
      </button>
    </li>
  )
}
