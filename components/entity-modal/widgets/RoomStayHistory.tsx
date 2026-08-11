'use client'

// 이 방을 쓴 사람과 쓸 사람 — RoomStay 구간 이력에 아직 안 들어온 입실 예약을 이어 붙인 한 목록.
// "누가 언제부터 언제까지 쓰는가"를 위(미래)에서 아래(과거)로 읽는다.
// 현재 구간(endDate null)은 종료일 자리에 '현재', 미래 예약은 우측에 '입실 예약'/'예약 확정' 라벨.
//
// 지금 사는 사람과 들어올 사람은 **항상 펼쳐서** 보여준다. 이 위젯이 기본정보 바로 아래로
// 올라오면서 없어진 '예약자' 줄의 자리를 대신하기 때문이다(운영자 지시 2026-08-11).
// 접히는 것은 지나간 거주뿐이다 — 당장 볼 일이 없고, 방 하나에 수십 건까지 쌓인다.

import { useEffect, useState } from 'react'
import { getRoomStayHistory } from '@/app/(app)/rooms/actions'
import { useEntityModal } from '@/components/entity-modal/EntityModal'

import { fmtDateDot } from '@/lib/fmtDate'   // 날짜 표기 정본

type StayItem = Awaited<ReturnType<typeof getRoomStayHistory>>['items'][number]

export function RoomStayHistory({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomStayHistory>> | null>(null)
  const [showPast, setShowPast] = useState(false)
  useEffect(() => {
    let active = true
    // 실패해도 스켈레톤이 영구 잔존하지 않게 빈 목록으로 떨어뜨린다(§27.2).
    // 상태 이력 위젯을 만들면서 형제 둘도 같은 결함인 것이 드러나 함께 봉합했다(2026-08-03).
    getRoomStayHistory(roomId)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setData({ items: [] }) })
    return () => { active = false }
  }, [roomId])

  if (!data || data.items.length === 0) return null

  // 목록은 이미 최신순이라 미래 예약이 위, 현재 구간이 그 아래로 선다.
  const live = data.items.filter(it => it.kind !== 'past')
  const past = data.items.filter(it => it.kind === 'past')

  return (
    <section className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
      {/* 제목은 더 이상 누르는 것이 아니다 — 아래 내용이 항상 보이므로 토글이 할 일이 없다.
          형제 위젯 중 청소 이력이 같은 문법(h3 + 항상 보이는 본문)이다. */}
      <h3 className="text-xs font-semibold text-[var(--warm-dark)]">거주 이력 및 예정</h3>
      <div className="mt-2 border-t border-[var(--warm-border)]/60 pt-2">
        {live.length > 0 && (
          <ul className="space-y-1.5">
            {live.map(it => <StayRow key={it.id} item={it} />)}
          </ul>
        )}
        {past.length > 0 && (
          <div className={live.length > 0 ? 'mt-2' : ''}>
            <button type="button" onClick={() => setShowPast(v => !v)}
              className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
              이전 거주 {past.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showPast ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {showPast && (
              <ul className="mt-2 space-y-1.5">
                {past.map(it => <StayRow key={it.id} item={it} />)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function StayRow({ item }: { item: StayItem }) {
  const entityModal = useEntityModal()
  // 지금 사는 사람은 굵게, 아직 안 들어온 사람은 한 톤 옅게 — 같은 목록 안에서 '이미'와 '아직'을 가른다.
  const nameTone = item.kind === 'current' ? 'font-semibold text-[var(--warm-dark)]'
    : item.kind === 'upcoming' ? 'text-[var(--warm-mid)]'
    : 'text-[var(--warm-dark)]'
  const { tenantId } = item
  return (
    <li className="flex items-baseline justify-between gap-2 text-[0.6875rem]">
      {/* 이름을 누르면 같은 모달 안에서 그 사람의 면으로 바뀐다 — 계약서함·납부 확인서·실거주 확인서의
          이름 클릭과 같은 문법(평시 행 색, hover 코랄). 밑줄·화살표는 붙이지 않는다.
          py-1 -my-1 은 히트 영역만 세로로 넓힌다 — 11px 글자 높이로는 손가락이 닿지 않는다.
          계약이 지워져 사람을 못 찾는 행은 버튼이 아니라 평문이다(눌리는데 아무 일도 안 일어나면 고장이다). */}
      {tenantId ? (
        <button type="button" onClick={() => entityModal.open({ kind: 'tenant', tenantId })}
          className={`min-w-0 truncate text-left py-1 -my-1 transition-colors hover:text-[var(--coral)] ${nameTone}`}>
          {item.tenantName}
        </button>
      ) : (
        <span className={`min-w-0 truncate ${nameTone}`}>{item.tenantName}</span>
      )}
      <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">
        {fmtDateDot(item.startDate)} ~ {item.endDate
          ? fmtDateDot(item.endDate)
          : item.kind === 'upcoming'
            // 퇴실일을 안 잡은 예약 — 지나간 구간의 '—'(값 없음)와 다르다. 언제 나갈지 아직 안 정한 것이다.
            ? '미정'
            : <span className="font-medium text-[var(--coral)]">현재</span>}
        {/* 예약 확정 여부 — 기본정보 '예약자' 줄의 뱃지가 갖고 있던 사실이다. 11px 행에 뱃지를
            넣으면 320px 폭에서 이름이 밀리므로 어휘로만 가른다(고객 관리와 같은 두 말). */}
        {item.kind === 'upcoming' && <span className="ml-1.5">{item.confirmed ? '예약 확정' : '입실 예약'}</span>}
      </span>
    </li>
  )
}
