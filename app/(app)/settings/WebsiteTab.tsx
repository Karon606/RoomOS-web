'use client'

// 환경설정 '웹사이트' 탭 — 손님에게 내보이는 소개 페이지를 한 자리에서 손본다(2026-08-18 IA 1단계).
// 담는 것은 넷이다. ① 소개 페이지 주소(슬러그) ② 소개 페이지 반영 대기(올릴 방·내릴 방)
// ③ 공용·외관 사진 ④ 바로가기. 홈에 있던 카드 두 장이 여기로 옮겨 왔다 — 홈은 "반영 대기 N건" 한 줄만 말한다.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { useCanEdit } from '@/components/RoleContext'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { fmtRoomNo } from '@/lib/roomNo'
import { publicSiteUrl } from '@/lib/publicSite'
import { setRoomShowOnSite } from '@/app/(app)/room-manage/actions'
import { updatePublicSlug } from './actions'
import type { SiteRoomCandidate, SiteRoomCandidates } from '@/lib/siteCandidates'

// 공용·외관 사진 관리 모달 — 호실 관리 헤더가 여는 것과 **같은 정본**을 그대로 연다(손사본 금지).
// 지연 로드라 웹사이트 탭을 열어도 누르기 전에는 내려받지 않는다.
const PropertyPhotosManager = dynamic(() => import('@/app/(app)/room-manage/PropertyPhotosManager'), { ssr: false })

export function WebsiteTab({
  initialSlug,
  candidates,
}: {
  initialSlug: string
  candidates: SiteRoomCandidates
}) {
  const router = useRouter()
  const canEditUi = useCanEdit()   // 뷰어(STAFF) 편집 진입 숨김(감사 D3) — 호실 관리 쪽 같은 버튼과 같은 가드
  const [slug, setSlug] = useState(initialSlug)
  const [savedSlug, setSavedSlug] = useState(initialSlug)
  const [savingSlug, setSavingSlug] = useState(false)
  const [showPropPhotos, setShowPropPhotos] = useState(false)
  const [busy, startSiteTransition] = useTransition()

  const savedUrl = publicSiteUrl(savedSlug)

  const handleSaveSlug = async () => {
    setSavingSlug(true)
    const release = trackSave()
    try {
      const res = await updatePublicSlug(slug)
      if (!res.ok) { pushToast('error', res.error); return }
      // 서버가 정규화(소문자·숫자·하이픈)한 결과와 화면을 맞춰 둔다 — 대문자를 넣고 저장한 뒤
      // 입력칸만 대문자로 남아 있으면 아래 미리보기 URL 이 거짓말을 한다.
      const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
      setSlug(normalized)
      setSavedSlug(normalized)
      pushToast('success', normalized ? '소개 페이지 주소 저장됨' : '소개 페이지 주소 지움')
      router.refresh()
    } finally { release(); setSavingSlug(false) }
  }

  // 올리기·내리기 — 정본은 room-manage 의 setRoomShowOnSite(사진 0장이면 켜기 거부).
  // 되돌리기는 반대 값으로 한 번 더 부르면 끝이라 토스트에 적용취소를 단다.
  const toggleShowOnSite = (roomId: string, show: boolean, opts?: { undo?: boolean }) => {
    startSiteTransition(async () => {
      const res = await setRoomShowOnSite(roomId, show)
      if (!res.ok) { pushToast('error', res.error); return }
      const msg = show ? '소개 페이지에 올렸어요' : '소개 페이지에서 내렸어요'
      pushToast('success', msg, opts?.undo === false ? undefined : {
        action: { label: '적용취소', run: () => toggleShowOnSite(roomId, !show, { undo: false }) },
      })
      router.refresh()
    })
  }

  const total = candidates.publish.length + candidates.unpublish.length

  const Row = ({ room, show }: { room: SiteRoomCandidate; show: boolean }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-[var(--warm-border)] last:border-b-0">
      {/* 썸네일 바탕은 --cream-soft — 다크에서 --canvas 는 #000 이라 카드에 검은 구멍이 뚫린다(§28,
          계약서 탭 사업자등록증 미리보기가 같은 함정에서 쓴 토큰). */}
      <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-[var(--cream-soft)]">
        {room.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={room.thumbUrl} alt={fmtRoomNo(room.roomNo)} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.4 }}>
              <path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[var(--warm-dark)] truncate">{fmtRoomNo(room.roomNo)}{room.tier ? ` ${room.tier}` : ''}</p>
        <p className="text-[0.65625rem] font-medium text-[var(--warm-muted)] mt-0.5">{fmtKorMoney(room.baseRent)}</p>
      </div>
      <button type="button" disabled={busy}
        onClick={() => toggleShowOnSite(room.id, show)}
        className="min-h-[44px] shrink-0 inline-flex items-center text-[0.65625rem] px-2.5 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-50">
        {show ? '올리기' : '내리기'}
      </button>
    </div>
  )

  return (
    <>
      {/* ① 소개 페이지 주소(슬러그) — 기본정보에서 옮겨 왔다(2026-08-18) */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">소개 페이지 주소</h2>
        <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
          손님에게 보여 주는 소개 페이지의 주소입니다. 마지막 부분(슬러그)만 정하면 됩니다 (예: <code>thestayjegi</code>).
          소문자·숫자·하이픈만 쓸 수 있고, 채워 두면 <strong>방문 분석</strong>에서 이 페이지의 방문 기록이 보입니다.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center rounded-sm bg-[var(--canvas)] border border-[var(--warm-border)] focus-within:border-[var(--coral)] transition-colors">
            <span className="pl-3 py-2.5 text-sm text-[var(--warm-muted)] shrink-0 hidden sm:inline">stayeum.com/members/</span>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="예: mygosiwon"
              autoComplete="off"
              aria-label="소개 페이지 주소(슬러그)"
              className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-transparent outline-none text-[var(--warm-dark)] num"
            />
          </div>
          <Btn variant="primary" size="md" onClick={handleSaveSlug} disabled={savingSlug || slug === savedSlug}>
            {savingSlug ? '저장 중…' : '저장'}
          </Btn>
        </div>
        {savedUrl && (
          // nolog=1 — 운영자가 자기 페이지를 열어 본 것이 방문 기록에 섞이지 않게(방문 분석과 같은 처방)
          <a href={`${savedUrl}?nolog=1`} target="_blank" rel="noopener noreferrer"
            className="inline-block mt-2 text-xs break-all hover:underline" style={{ color: 'var(--persimmon-d)' }}>
            {savedUrl} ›
          </a>
        )}
      </div>

      {/* ② 소개 페이지 반영 대기 — 홈에 있던 카드 두 장을 한 장으로 합쳤다(운영자 확정).
          한 장 안의 두 구획이라 올릴 방과 내릴 방이 같은 일의 양면이라는 것이 보인다. */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)]">소개 페이지 반영 대기</h2>
          {total > 0 && (
            <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>
              <span className="tnum">{total}</span>건
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
          소개 페이지에 실린 방과 실제 운영이 어긋난 곳입니다. 창고·사무실처럼 집계에서 뺀 방은 여기 오지 않습니다.
        </p>
        {total === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] py-2">어긋난 방이 없습니다. 소개 페이지가 지금 운영 상태와 같습니다.</p>
        ) : (
          <div className="space-y-4">
            {candidates.publish.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--warm-mid)] mb-1">
                  올릴 방 <span className="tnum">{candidates.publish.length}</span>건
                  <span className="font-normal text-[var(--warm-muted)]"> · 공실이고 사진도 있는데 아직 안 올라가 있어요</span>
                </p>
                <div>
                  {candidates.publish.map(r => <Row key={r.id} room={r} show={true} />)}
                </div>
              </div>
            )}
            {candidates.unpublish.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--warm-mid)] mb-1">
                  내릴 방 <span className="tnum">{candidates.unpublish.length}</span>건
                  <span className="font-normal text-[var(--warm-muted)]"> · 입주 중인데 아직 올라가 있어요</span>
                </p>
                <div>
                  {candidates.unpublish.map(r => <Row key={r.id} room={r} show={false} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ③ 공용·외관 사진 — 방이 아닌 공간의 사진. 여는 모달은 호실 관리 헤더가 여는 것과 같은 정본이라
          두 자리가 같은 작업대로 수렴한다(정주소는 버튼이 아니라 모달이다 — ConsultToolsModal·ReceiptScanModal 과 같은 문법).
          카드 ②(방 축) 바로 뒤에 두어 방·공용 두 축이 나란히 읽히게 하고, 떠나는 문인 ④ 바로가기는 마지막을 지킨다.
          버튼만 두고 썸네일은 두지 않는다 — 여기서 내릴 판단이 없는 미리보기이고, 넣으면 모달의 지연 로딩이 무의미해진다.
          카드 ②의 '올리기·내리기'와 달리 이 진입은 canEditUi 로 가린다(감사 D3, 호실 관리와 같은 처방). */}
      {canEditUi && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">공용·외관 사진</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            건물 외관, 복도, 주방처럼 방이 아닌 공간의 사진입니다. 카테고리별로 올리고 공개 여부를 정합니다.
          </p>
          <Btn variant="secondary" size="md" onClick={() => setShowPropPhotos(true)}>사진 관리</Btn>
        </div>
      )}

      {/* ④ 바로가기 — 소개 페이지에 실리는 것들의 실제 작업대는 다른 화면에 있다.
          여기서 그 화면을 다시 만들지 않고 문만 낸다(데이터·도구 탭의 '발생주의 데이터 진단' 줄과 같은 문법). */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">바로가기</h2>
        <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
          방마다 사진을 올리고 공개 여부를 정하는 일, 소개 페이지에 누가 다녀갔는지 보는 일은 각자 제 화면에서 합니다.
        </p>
        <div className="flex flex-col items-start gap-2">
          <Link href="/room-manage"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
            방별 공개·사진 관리 ›
          </Link>
          <Link href="/marketing"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
            방문 분석 ›
          </Link>
        </div>
      </div>

      {showPropPhotos && <PropertyPhotosManager onClose={() => setShowPropPhotos(false)} />}
    </>
  )
}
