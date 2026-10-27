'use client'

// 환경설정 '품명 병합' (A) — 비품·자재·소모품·부식의 유사 품명을 AI로 묶어 한 이름으로 통일.
// 통일 후엔 자동완성·영수증 인식(별칭)도 통일명 사용. 각 병합은 적용취소(완전 원복) 가능.

import { useState, useEffect } from 'react'
import {
  clusterItemNamesWithAI, mergeItemNames, getItemNameMergeRuns, undoItemNameMerge,
  type ItemNameCluster, type ItemNameMergeRunRow,
} from '@/app/(app)/finance/actions'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

export function ItemNameMergePanel() {
  const [clusters, setClusters] = useState<ItemNameCluster[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [canonEdits, setCanonEdits] = useState<Record<number, string>>({})
  const [runs, setRuns] = useState<ItemNameMergeRunRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { getItemNameMergeRuns().then(setRuns).catch(() => {}) }, [])

  const analyze = async () => {
    setLoading(true); setCanonEdits({})
    const res = await clusterItemNamesWithAI()
    setLoading(false)
    if (!res.ok) { pushToast('error', res.error); return }
    setClusters(res.clusters)
    if (res.clusters.length === 0) pushToast('info', '통일할 만한 유사 품명 그룹을 찾지 못했습니다.')
  }

  const doMerge = async (idx: number, c: ItemNameCluster) => {
    const canon = (canonEdits[idx] ?? c.canonical).trim()
    if (!canon) { pushToast('error', '대표명을 입력하세요.'); return }
    setBusy(`m${idx}`)
    const res = await mergeItemNames(canon, c.members)
    setBusy(null)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', `'${canon}'(으)로 통일됨 · ${c.members.length}개 이름`)
    setClusters(prev => prev?.filter((_, i) => i !== idx) ?? null)
    getItemNameMergeRuns().then(setRuns).catch(() => {})
  }

  const doUndo = async (id: string, canonical: string, kind: ItemNameMergeRunRow['kind']) => {
    // 비품 행별 규격 수정 기록은 이름이 아니라 그 행의 규격을 되돌린다(2026-10-27 D1).
    const ask = kind === 'row-spec'
      ? { title: '이 규격 수정을 적용취소할까요?', message: `'${canonical}' 구매 행의 규격을 고치기 전으로 되돌립니다.` }
      : kind === 'split'
        ? { title: '이 나누기를 적용취소할까요?', message: `'${canonical}'(으)로 바꿨던 기존 품목과 지출 이름을 나누기 전으로 되돌립니다.` }
        : { title: '이 병합을 적용취소할까요?', message: `'${canonical}'(으)로 통일했던 지출·소모품 이름을 병합 전으로 되돌립니다.` }
    if (!(await confirmDialog({ ...ask, confirmLabel: '적용취소' }))) return
    setBusy(`u${id}`)
    const res = await undoItemNameMerge(id)
    setBusy(null)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', kind === 'row-spec' ? '규격 수정 적용취소됨 · 규격 원복' : kind === 'split' ? '나누기 적용취소됨 · 이름 원복' : '병합 적용취소됨 · 이름 원복')
    setRuns(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">
        품명 병합 <span className="text-[0.65625rem] font-normal text-[var(--tc-text)]">AI 정리</span>
      </h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
        비슷한 품목명(비품·자재·소모품·부식)을 AI로 묶어 한 이름으로 통일합니다. 통일하면 지출·재고의 기존 이름이 바뀌고,
        이후 자동완성·영수증 인식도 통일명을 씁니다. 각 병합은 아래에서 <strong>적용취소</strong>로 되돌릴 수 있습니다.
      </p>
      <Btn variant="secondary" size="sm" onClick={analyze} disabled={loading}>
        {loading ? 'AI 분석 중… (10~20초)' : '유사 품명 찾기'}
      </Btn>

      {clusters && clusters.length > 0 && (
        <div className="mt-3 space-y-2">
          {clusters.map((c, idx) => (
            <div key={idx} className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">통일할 이름</label>
                <input
                  value={canonEdits[idx] ?? c.canonical}
                  onChange={e => setCanonEdits(prev => ({ ...prev, [idx]: e.target.value }))}
                  className="flex-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <Btn variant="primary" size="sm" onClick={() => doMerge(idx, c)} disabled={busy === `m${idx}`}>
                  {busy === `m${idx}` ? '통일 중…' : '이 이름으로 통일'}
                </Btn>
              </div>
              <p className="text-[0.6875rem] text-[var(--warm-muted)]">
                묶을 이름 {c.members.length}개: <span className="text-[var(--warm-dark)]">{c.members.join(' · ')}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--warm-border)]">
          <p className="text-[0.6875rem] font-semibold text-[var(--warm-mid)] mb-1.5">최근 병합 ({runs.length})</p>
          <ul className="space-y-1">
            {runs.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--warm-dark)] truncate">
                  {r.canonical} <span className="text-[var(--warm-muted)]">· {r.kind === 'row-spec' ? '규격 수정' : r.kind === 'split' ? '규격별 나누기' : `${r.memberCount}개 통일`}</span>
                </span>
                <button type="button" onClick={() => doUndo(r.id, r.canonical, r.kind)} disabled={busy === `u${r.id}`}
                  className="shrink-0 text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                  {busy === `u${r.id}` ? '취소 중…' : '적용취소'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
