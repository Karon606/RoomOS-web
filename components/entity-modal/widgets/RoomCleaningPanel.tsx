'use client'

// 방 작업 이력 위젯 — 청소와 그 밖의 작업(도배·장판 등)을 **한 목록**으로 (2026-08-05 신설,
// 2026-08-25 작업 확장. 신고 b21e4e98).
//
// 위젯을 둘로 나누지 않은 이유. '청소 이력'과 '작업 이력'이 방 모달에 형제로 서면 운영자가
// 매번 "도배는 어느 쪽이지"를 판단해야 한다. 그 방에 무슨 일이 있었나는 하나의 물음이다.
// 등록 버튼도 하나다 — 종류를 고르는 것이 곧 어느 폼을 여는가다(디자인 패널 판정 2026-08-25).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다.
// 이 위젯은 돈을 만들지 않는다. 비용 연결은 2단계다.
//
// 행의 표시·조작과 예정 등록 폼은 components/cleaning 정본을 부른다(2026-08-12). 호실 관리
// '청소' 뷰가 같은 것을 부르므로, 확인창·토스트·적용취소가 두 벌로 갈릴 자리가 없다.
// 여기 남는 것은 이 위젯만의 것 — 그 방의 이력 조회, 받은 청소비 잔고 줄, 예정 남음 경고.

import { useEffect, useState } from 'react'
import { Btn } from '@/components/ui/Btn'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useCanEdit } from '@/components/RoleContext'
import { fmtWon } from '@/lib/fmtMoney'
import { CleaningRowBody } from '@/components/cleaning/CleaningRowBody'
import { CleaningPlanForm } from '@/components/cleaning/CleaningPlanForm'
import { RoomWorkRowBody } from '@/components/work/RoomWorkRowBody'
import { RoomWorkPlanForm } from '@/components/work/RoomWorkPlanForm'
import { listRoomWorks, type RoomWorkRow } from '@/app/(app)/room-manage/workActions'
import {
  getRoomCleanings, getCleaningFundStatus, getRecentCleaningPerformers,
} from '@/app/(app)/room-manage/cleaningActions'
import type {
  CleaningRow, CleaningFundStatus, CleaningFundLease,
} from '@/app/(app)/room-manage/cleaningConstants'

export function RoomCleaningPanel({ roomId }: { roomId: string }) {
  const canEdit = useCanEdit()
  const [rows, setRows] = useState<CleaningRow[] | null>(null)
  const [works, setWorks] = useState<RoomWorkRow[] | null>(null)
  // 무엇을 등록할지 — null 이면 닫힘. 청소와 그 밖의 작업은 받는 칸이 달라 폼이 갈린다.
  const [adding, setAdding] = useState<null | 'cleaning' | 'work'>(null)
  // 접힘 — 형제 카드(지출 내역·요청 내역)와 같은 A형이다. 운영자 지적 2026-08-27 —
  // "작업이력은 그게 없어서 너무 길어보여. 통일감있게 수정 필요."
  //
  // **상태를 기억하지 않는다.** 이 저장소의 접힘 열다섯 곳 중 기억하는 곳이 하나도 없고,
  // 기억하면 "방마다 따로인가 전 방 공통인가"라는 답 없는 물음이 따라온다.
  //
  // 대신 규칙으로 연다 — **예정이 남아 있으면 펴진다.** 작업 예정은 호실 목록 배지에도 안 떠서
  // (§11 최대 2개를 이미 넘겼다) 이 위젯 말고는 앱 어디에도 안 뜬다. 접어서 숨기면 그 사실이
  // 앱에서 사라진다. 손으로 접거나 편 것은 그 세션 동안 규칙보다 강하다.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  // 최근에 맡긴 업체·사람 — 완료 폼 이름 칸 선택지. 없는 영업장은 손으로 적는다.
  const [recentPerformers, setRecentPerformers] = useState<string[]>([])

  const [loadFailed, setLoadFailed] = useState(false)
  const [fund, setFund] = useState<CleaningFundStatus | null>(null)
  // 실패를 빈 목록으로 삼키지 않는다. 그러면 고장이 '기록 없음' 과 똑같이 보인다.
  const reload = () => {
    void Promise.all([
      getRoomCleanings(roomId),
      getCleaningFundStatus(roomId),
      listRoomWorks(roomId),
      // 추천 목록만 실패를 삼킨다. 이름 칸 편의값 하나 때문에 이력 전체가 '불러오지 못했습니다'가 되면 안 된다.
      getRecentCleaningPerformers().catch(() => [] as string[]),
    ])
      .then(([v, f, w, p]) => { setRows(v); setFund(f); setWorks(w); setRecentPerformers(p); setLoadFailed(false) })
      .catch(() => { setRows([]); setFund(null); setWorks([]); setLoadFailed(true) })
  }
  useEffect(reload, [roomId])

  const fundOf = (leaseTermId: string | null): CleaningFundLease | null =>
    (leaseTermId && fund?.leases.find(l => l.leaseTermId === leaseTermId)) || null

  const open = rows?.find(r => r.status === 'PLANNED') ?? null
  const openWork = works?.find(w => w.status === 'PLANNED') ?? null
  // 접힘 판정 — 예정이 하나라도 있으면 펴진다. 손으로 접거나 편 것이 규칙보다 강하다.
  // 로딩 중에는 예정 수를 모르므로 접힘으로 열었다가 데이터가 오면 펴진다(reload 가 돌아도
  // userOpen 은 안 지운다 — 그러면 완료 처리 한 번에 운영자가 접어 둔 것이 다시 펴진다).
  const plannedCount = (rows?.filter(r => r.status === 'PLANNED').length ?? 0)
    + (works?.filter(w => w.status === 'PLANNED').length ?? 0)
  const panelOpen = userOpen ?? plannedCount > 0

  // 두 표를 **한 목록**으로 세운다. 정렬 축은 그 행이 화면에서 말하는 날짜다 — 완료 건은 완료일,
  // 예정 건은 예정일. 날짜가 없는 행(예정일 미정)은 맨 뒤로 민다. 날짜가 같으면 청소를 먼저 둔다
  // (퇴실 청소가 도배·장판보다 앞서는 것이 실제 순서다).
  type Merged =
    | { sort: 'c'; id: string; at: string; cleaning: CleaningRow; work?: undefined }
    | { sort: 'w'; id: string; at: string; work: RoomWorkRow; cleaning?: undefined }
  const merged: Merged[] = [
    ...(rows ?? []).map((r): Merged => ({
      sort: 'c', id: r.id, at: (r.status === 'DONE' ? r.doneDate : r.scheduledDate) ?? '', cleaning: r,
    })),
    ...(works ?? []).map((w): Merged => ({
      sort: 'w', id: w.id, at: (w.status === 'DONE' ? w.doneDate : w.scheduledDate) ?? '', work: w,
    })),
  ].sort((a, b) => {
    if (!a.at && !b.at) return 0
    if (!a.at) return 1
    if (!b.at) return -1
    if (a.at !== b.at) return a.at < b.at ? 1 : -1
    return a.sort === b.sort ? 0 : a.sort === 'c' ? -1 : 1
  })

  // 받은 청소비로 부담한 건이 있는 계약만 잔고를 보여준다. 부담이 없으면 보여줄 잔고도 없다.
  const fundedLeases = [...new Set((rows ?? [])
    .filter(r => r.status === 'DONE' && r.fromCleaningFund && r.leaseTermId)
    .map(r => r.leaseTermId as string))]
    .map(id => fundOf(id))
    .filter((f): f is CleaningFundLease => !!f && f.fundedExpenseTotal > 0)

  return (
    <section className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
      {/* 껍데기·제목 크기를 형제 카드(지출 내역·요청 내역)와 맞춘다. 종전에는 rounded-xl p-3 에
          인라인 style 이고 제목이 text-sm 이라, 셋이 세로로 붙어 있을 때 넷째만 살짝 크고
          두툼했다. 토큰을 인라인 style 로 쓰는 것도 이 폴더에서 여기뿐이라 다크 모드 회귀
          위험이 있었다.

          **토글과 등록 버튼은 형제다.** 버튼 안에 버튼은 HTML 상 무효이고 hydration 경고가 난다. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => setUserOpen(!panelOpen)}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left">
          <span className="text-xs font-semibold text-[var(--warm-dark)]">작업 이력</span>
          <span className="text-xs">
            {plannedCount > 0 && <strong className="text-[var(--coral)]">예정 {plannedCount}</strong>}
            <span className="text-[var(--warm-muted)] inline-flex items-center gap-1">
              {plannedCount > 0 ? ' · ' : ''}{merged.length}건
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${panelOpen ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </span>
          </span>
        </button>
        {/* 버튼이 둘인 것은 받는 칸이 다르기 때문이다. 청소는 사유 4종·받은 청소비 부담을 더 묻고,
            그 밖의 작업은 환경설정에서 만든 종류를 고른다. §23 은 헤더 CTA 1~2개를 허용한다.
            **접혀 있으면 감춘다** — 안 보이는 목록에 뭘 더하는 문만 서 있으면 안 된다. */}
        {canEdit && !adding && panelOpen && (
          <div className="flex gap-1.5">
            <Btn variant="secondary" size="sm" onClick={() => setAdding('cleaning')}>청소 등록</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setAdding('work')}>작업 등록</Btn>
          </div>
        )}
      </div>

      {panelOpen && (<div className="mt-2">

      {adding && (
        <div className="rounded-lg p-2.5 mb-2" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          {adding === 'cleaning' ? (
            <CleaningPlanForm roomId={roomId} dense
              onDone={() => { setAdding(null); reload() }} onCancel={() => setAdding(null)} />
          ) : (
            <RoomWorkPlanForm roomId={roomId} dense
              onDone={() => { setAdding(null); reload() }} onCancel={() => setAdding(null)} />
          )}
        </div>
      )}

      {/* 첫 조회는 뼈대다 — 인라인 '불러오는 중…' 은 §17 원칙 금지고, 같은 폴더 형제 위젯
          아홉 곳(상태 이력·수납 기록·보증금·이사 이력·입주 가능한 방 등)이 전부 이 문법이다.
          행 두 개는 그 형제들이 쓰는 수치 그대로 — 이 목록도 보통 한두 행으로 열린다. */}
      {rows === null || works === null ? (
        <SkeletonRows rows={2} className="py-1" />
      ) : loadFailed ? (
        <p className="text-xs text-[var(--danger-fg)]">작업 이력을 불러오지 못했습니다.</p>
      ) : merged.length === 0 ? (
        <p className="text-xs text-[var(--warm-muted)]">작업 기록이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {merged.map(m => (
            <li key={`${m.sort}-${m.id}`} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--cream)' }}>
              {m.sort === 'c' ? (
                <CleaningRowBody row={m.cleaning} fund={fund} recentPerformers={recentPerformers}
                  canEdit={canEdit} onChanged={reload} />
              ) : (
                <RoomWorkRowBody row={m.work} canEdit={canEdit} onChanged={reload} />
              )}
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
      {/* 작업 예정은 호실 목록 배지에 아직 안 뜬다. 그 자리는 §11 최대 2개를 이미 넘겼다
          (상태·전입신고 불가·청소 필요). 배지를 넷째로 더하는 것은 별건이라 여기서는 사실만 적는다. */}
      {openWork && (
        <p className="mt-2 text-xs text-[var(--warning-fg)]">{openWork.kind} 예정이 남아 있습니다.</p>
      )}
      </div>)}
    </section>
  )
}
