'use client'

// 방 청소 이력 위젯 — 예정 등록·날짜 변경·완료 처리·적용취소 (2026-08-05, 신고 b21e4e98).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다.
// 이 위젯은 돈을 만들지 않는다. 비용 연결은 2단계다.
//
// 행의 표시·조작과 예정 등록 폼은 components/cleaning 정본을 부른다(2026-08-12). 호실 관리
// '청소' 뷰가 같은 것을 부르므로, 확인창·토스트·적용취소가 두 벌로 갈릴 자리가 없다.
// 여기 남는 것은 이 위젯만의 것 — 그 방의 이력 조회, 받은 청소비 잔고 줄, 예정 남음 경고.

import { useEffect, useState } from 'react'
import { Btn } from '@/components/ui/Btn'
import { useCanEdit } from '@/components/RoleContext'
import { fmtWon } from '@/lib/fmtMoney'
import { CleaningRowBody } from '@/components/cleaning/CleaningRowBody'
import { CleaningPlanForm } from '@/components/cleaning/CleaningPlanForm'
import {
  getRoomCleanings, getCleaningFundStatus, getRecentCleaningPerformers,
} from '@/app/(app)/room-manage/cleaningActions'
import type {
  CleaningRow, CleaningFundStatus, CleaningFundLease,
} from '@/app/(app)/room-manage/cleaningConstants'

export function RoomCleaningPanel({ roomId }: { roomId: string }) {
  const canEdit = useCanEdit()
  const [rows, setRows] = useState<CleaningRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  // 최근에 맡긴 업체·사람 — 완료 폼 이름 칸 선택지. 없는 영업장은 손으로 적는다.
  const [recentPerformers, setRecentPerformers] = useState<string[]>([])

  const [loadFailed, setLoadFailed] = useState(false)
  const [fund, setFund] = useState<CleaningFundStatus | null>(null)
  // 실패를 빈 목록으로 삼키지 않는다. 그러면 고장이 '기록 없음' 과 똑같이 보인다.
  const reload = () => {
    void Promise.all([
      getRoomCleanings(roomId),
      getCleaningFundStatus(roomId),
      // 추천 목록만 실패를 삼킨다. 이름 칸 편의값 하나 때문에 이력 전체가 '불러오지 못했습니다'가 되면 안 된다.
      getRecentCleaningPerformers().catch(() => [] as string[]),
    ])
      .then(([v, f, p]) => { setRows(v); setFund(f); setRecentPerformers(p); setLoadFailed(false) })
      .catch(() => { setRows([]); setFund(null); setLoadFailed(true) })
  }
  useEffect(reload, [roomId])

  const fundOf = (leaseTermId: string | null): CleaningFundLease | null =>
    (leaseTermId && fund?.leases.find(l => l.leaseTermId === leaseTermId)) || null

  const open = rows?.find(r => r.status === 'PLANNED') ?? null

  // 받은 청소비로 부담한 건이 있는 계약만 잔고를 보여준다. 부담이 없으면 보여줄 잔고도 없다.
  const fundedLeases = [...new Set((rows ?? [])
    .filter(r => r.status === 'DONE' && r.fromCleaningFund && r.leaseTermId)
    .map(r => r.leaseTermId as string))]
    .map(id => fundOf(id))
    .filter((f): f is CleaningFundLease => !!f && f.fundedExpenseTotal > 0)

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">청소 이력</h3>
        {canEdit && !adding && (
          <Btn variant="secondary" size="sm" onClick={() => setAdding(true)}>청소 예정 등록</Btn>
        )}
      </div>

      {adding && (
        <div className="rounded-lg p-2.5 mb-2" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <CleaningPlanForm roomId={roomId} dense
            onDone={() => { setAdding(false); reload() }} onCancel={() => setAdding(false)} />
        </div>
      )}

      {rows === null ? (
        <p className="text-xs text-[var(--warm-muted)]">불러오는 중…</p>
      ) : loadFailed ? (
        <p className="text-xs text-[var(--danger-fg)]">청소 이력을 불러오지 못했습니다.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--warm-muted)]">청소 기록이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--cream)' }}>
              <CleaningRowBody row={r} fund={fund} recentPerformers={recentPerformers}
                canEdit={canEdit} onChanged={reload} />
            </li>
          ))}
        </ul>
      )}

      {/* 잔고는 파생값이라 저장하지 않는다 — 수납·몰취·지출을 그때그때 합해 보여줄 뿐이다.
          초과분은 운영 부담이고, 받은 청소비를 더 받아내는 근거가 아니다. */}
      {fundedLeases.map(f => (
        <p key={f.leaseTermId} className="mt-2 text-xs text-[var(--warm-muted)] num">
          {f.fundedExpenseTotal <= f.realizedIncome
            ? `받은 청소비 ${fmtWon(f.realizedIncome)} 중 ${fmtWon(f.fundedExpenseTotal)} 부담, 잔여 ${fmtWon(f.realizedIncome - f.fundedExpenseTotal)}.`
            : `받은 청소비 ${fmtWon(f.realizedIncome)} 중 ${fmtWon(f.fundedExpenseTotal)} 부담, 초과 ${fmtWon(f.fundedExpenseTotal - f.realizedIncome)}은 운영 부담.`}
        </p>
      ))}

      {open && (
        <p className="mt-2 text-xs text-[var(--warning-fg)]">청소 예정이 남아 있습니다. 호실 목록에도 표시됩니다.</p>
      )}
    </div>
  )
}
