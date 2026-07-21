'use server'
// 전역 통합 검색 서버 액션 — 입주자·호실·지출·재고를 영업장 스코프로 병렬 조회해 유형별 그룹으로 반환.
// 자동 라우팅 없음: 질의 종류(kind)는 그룹 표시 순서만 바꾸고, 모호성은 그룹 병렬 표시로 해소한다.

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { normalizeSearchQuery, type SearchQueryKind } from '@/lib/searchQuery'
import { STATUS_LABEL } from '@/lib/statusColors'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { isVacancyExcluded } from '@/lib/vacancy'

export type SearchGroupType = 'tenant' | 'room' | 'expense' | 'item' | 'request' | 'doc'
export type SearchBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
export type SearchHit = {
  group: SearchGroupType
  id: string
  title: string
  right: string | null                                   // 우측 보조(금액·거주자명 등)
  badge: { label: string; tone: SearchBadgeTone } | null // 상태 배지
  caption: string | null                                 // 하단 캡션(서버에서 문자열 조립)
  action:
    | { type: 'modal'; kind: 'room' | 'tenant'; roomId?: string; tenantId?: string }
    | { type: 'href'; href: string }
}
export type SearchGroup = { type: SearchGroupType; label: string; hits: SearchHit[]; hasMore: boolean; moreHref: string }
export type GlobalSearchResult = { queryKind: SearchQueryKind; groups: SearchGroup[] }

const fmtRoomNo = (no: string | null | undefined) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : null)

// 입주자 상태 배지 톤 — StatusBadge 의미색과 동일 방향(거주=success, 퇴실예정=warning, 예약·비거주=info)
const STATUS_TONE: Record<string, SearchBadgeTone> = {
  ACTIVE: 'success', CHECKOUT_PENDING: 'warning', NON_RESIDENT: 'info', RESERVED: 'info',
  WAITING_TOUR: 'neutral', TOUR_DONE: 'neutral', CHECKED_OUT: 'neutral', CANCELLED: 'neutral',
}
// 그룹 내 랭킹 — 현 거주자 우선(take 절단으로 거주자가 밀리지 않게 서버에서 가중치 정렬)
const STATUS_WEIGHT: Record<string, number> = {
  ACTIVE: 0, CHECKOUT_PENDING: 1, NON_RESIDENT: 2, RESERVED: 3, WAITING_TOUR: 3, TOUR_DONE: 3,
  CHECKED_OUT: 4, CANCELLED: 5,
}

const TAKE_SHOW = 5

export async function globalSearch(rawQuery: string): Promise<GlobalSearchResult> {
  const { propertyId, role } = await requirePropertyAccess()
  const hideMoney = !canReadScope(role, 'money')   // 제한 스태프 — 지출 그룹·금액 인라인 제거
  const { q, qDigits, roomCore, kind, valid } = normalizeSearchQuery(rawQuery)
  if (!valid) return { queryKind: kind, groups: [] }

  const isDigits = kind !== 'text'
  const enc = encodeURIComponent(q)

  // ── 병렬 조회 — 숫자 질의는 호실+전화 2쿼리로 축소(최빈 시나리오 최소 비용) ──
  const [textTenants, phoneTenantIds, rooms, expenses, items, requests, contractFiles, rentReceiptFiles, residenceCertFiles] = await Promise.all([
    // 입주자 텍스트 매칭(이름·영문명·국적·직업) — 텍스트 질의에서만
    !isDigits
      ? prisma.tenant.findMany({
          where: {
            propertyId,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { englishName: { contains: q, mode: 'insensitive' } },
              { nationality: { contains: q, mode: 'insensitive' } },
              { job: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 20,
          select: tenantSelect,
        })
      : Promise.resolve([]),
    // 전화 뒷자리 매칭 — 숫자 4자리 이상(3자리 이하는 방번호 전용, '010' 전 행 오탐 차단)
    qDigits.length >= 4
      ? prisma.$queryRaw<{ tenantId: string }[]>`
          SELECT DISTINCT tc."tenantId"
          FROM tenant_contacts tc
          JOIN tenants t ON t.id = tc."tenantId"
          WHERE t."propertyId" = ${propertyId}
            AND regexp_replace(tc."contactValue", '\\D', '', 'g') LIKE ${'%' + qDigits + '%'}
          LIMIT 20`
      : Promise.resolve([]),
    // 호실 — 방번호(질의의 '호' 제거값) contains, 텍스트 질의는 타입도
    roomCore.length >= 1
      ? prisma.room.findMany({
          where: {
            propertyId,
            OR: [
              { roomNo: { contains: roomCore } },
              ...(!isDigits ? [{ type: { contains: q, mode: 'insensitive' as const } }] : []),
            ],
          },
          take: 6,
          select: {
            id: true, roomNo: true, type: true, floor: true, baseRent: true, isVacant: true, nonResidentVacant: true,
            leaseTerms: {
              where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: { status: true, tenant: { select: { name: true } } },
            },
          },
        })
      : Promise.resolve([]),
    // 지출 — 텍스트 질의에서만(품목·내역·구매처·카테고리·메모)
    !isDigits
      ? prisma.expense.findMany({
          where: {
            propertyId,
            OR: [
              { itemLabel: { contains: q, mode: 'insensitive' } },
              { detail: { contains: q, mode: 'insensitive' } },
              { vendor: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { memo: { contains: q, mode: 'insensitive' } },
            ],
          },
          orderBy: { date: 'desc' }, take: 6,
          select: { id: true, date: true, amount: true, category: true, detail: true, itemLabel: true, vendor: true, room: { select: { roomNo: true } } },
        })
      : Promise.resolve([]),
    // 재고 추적품목 — 텍스트 질의에서만(보관 제외)
    !isDigits
      ? prisma.trackedItem.findMany({
          where: {
            propertyId, isArchived: false,
            OR: [
              { label: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 6,
          select: { id: true, label: true, category: true, reorderMemo: true },
        })
      : Promise.resolve([]),
    // 요청·컴플레인 — 텍스트 질의, 소프트삭제 제외, 미처리 우선(1.5차)
    !isDigits
      ? prisma.tenantRequest.findMany({
          where: {
            propertyId, deletedAt: null,
            OR: [
              { content: { contains: q, mode: 'insensitive' } },
              { commonPlace: { contains: q, mode: 'insensitive' } },
            ],
          },
          orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
          take: 6,
          select: { id: true, content: true, commonPlace: true, resolvedAt: true, requestDate: true, tenant: { select: { name: true } } },
        })
      : Promise.resolve([]),
    // 서류 3종 — 파일명 매칭, 소프트삭제 제외(1.5차)
    !isDigits
      ? prisma.contractFile.findMany({
          where: { propertyId, deletedAt: null, fileName: { contains: q, mode: 'insensitive' } },
          orderBy: { signedAt: 'desc' }, take: 3,
          select: { id: true, fileName: true, signedAt: true, tenant: { select: { name: true } } },
        })
      : Promise.resolve([]),
    !isDigits
      ? prisma.rentReceiptFile.findMany({
          where: { propertyId, deletedAt: null, fileName: { contains: q, mode: 'insensitive' } },
          orderBy: { issuedAt: 'desc' }, take: 3,
          select: { id: true, fileName: true, issuedAt: true, tenant: { select: { name: true } } },
        })
      : Promise.resolve([]),
    !isDigits
      ? prisma.residenceCertFile.findMany({
          where: { propertyId, deletedAt: null, fileName: { contains: q, mode: 'insensitive' } },
          orderBy: { issuedAt: 'desc' }, take: 3,
          select: { id: true, fileName: true, issuedAt: true, tenant: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ])

  // 전화 매칭 입주자 상세 조회 + 텍스트 매칭과 병합·dedupe
  const phoneIds = phoneTenantIds.map(r => r.tenantId).filter(id => !textTenants.some(t => t.id === id))
  const phoneTenants = phoneIds.length > 0
    ? await prisma.tenant.findMany({ where: { id: { in: phoneIds }, propertyId }, select: tenantSelect })
    : []
  const phoneMatchedSet = new Set(phoneTenantIds.map(r => r.tenantId))

  // 입주자 랭킹 — 상태 가중치 → 이름 정확일치·접두 → 최신
  const allTenants = [...textTenants, ...phoneTenants]
  const lq = q.toLowerCase()
  const tenantRank = (t: typeof allTenants[number]) => {
    const status = t.leaseTerms[0]?.status ?? 'CHECKED_OUT'
    const w = STATUS_WEIGHT[status] ?? 4
    const name = t.name.toLowerCase()
    const nameRank = name === lq ? 0 : name.startsWith(lq) ? 1 : 2
    return w * 10 + nameRank
  }
  allTenants.sort((a, b) => tenantRank(a) - tenantRank(b))

  const tenantHits: SearchHit[] = allTenants.slice(0, TAKE_SHOW).map(t => {
    const lease = t.leaseTerms[0]
    const status = lease?.status
    const matchedPhone = phoneMatchedSet.has(t.id)
      ? t.contacts.find(c => c.contactValue.replace(/\D/g, '').includes(qDigits))?.contactValue ?? null
      : null
    // 매칭 사유 캡션 — 전화가 맞았으면 전화, 아니면 국적·직업 매칭값
    const reason = matchedPhone
      ?? (!isDigits && t.nationality?.toLowerCase().includes(lq) ? t.nationality : null)
      ?? (!isDigits && t.job?.toLowerCase().includes(lq) ? t.job : null)
    return {
      group: 'tenant', id: t.id,
      title: t.englishName?.toLowerCase().includes(lq) ? `${t.name} (${t.englishName})` : t.name,
      right: null,
      // 파생 라벨 — 목록 StatusChip과 동일 규칙(문의/입실 예약/예약 확정, e1b81629)
      badge: status ? {
        label: status === 'RESERVED' && lease?.reservationConfirmedAt ? '예약 확정'
          : status === 'WAITING_TOUR' && !lease?.tourDate ? '문의'
          : STATUS_LABEL[status] ?? status,
        tone: STATUS_TONE[status] ?? 'neutral',
      } : null,
      caption: [fmtRoomNo(lease?.room?.roomNo) ?? '방 미배정', reason].filter(Boolean).join(' · ') || null,
      action: { type: 'modal', kind: 'tenant', tenantId: t.id },
    }
  })

  // 호실 랭킹 — 완전일치 → 접두 → 포함
  const roomRank = (r: typeof rooms[number]) =>
    r.roomNo === roomCore ? 0 : r.roomNo.startsWith(roomCore) ? 1 : 2
  const sortedRooms = [...rooms].sort((a, b) => roomRank(a) - roomRank(b))
  const roomHits: SearchHit[] = sortedRooms.slice(0, TAKE_SHOW).map(r => ({
    group: 'room', id: r.id,
    title: fmtRoomNo(r.roomNo) ?? r.roomNo,
    // 집계 제외 방(비거주 점유 + 공실 표시 안 함, lib/vacancy 정본)은 '공실' 대신 점유자 이름(신고 9d844226 잔여)
    right: isVacancyExcluded(r, r.leaseTerms[0]?.status === 'NON_RESIDENT')
      ? (r.leaseTerms[0]?.tenant.name ?? null)
      : r.isVacant ? '공실' : (r.leaseTerms[0]?.tenant.name ?? null),
    badge: null,
    caption: [r.floor ? `${r.floor}층` : null, r.type, (!hideMoney && r.baseRent > 0) ? fmtWon(r.baseRent) : null].filter(Boolean).join(' · ') || null,
    action: { type: 'modal', kind: 'room', roomId: r.id },
  }))

  // 지출 그룹은 금액 차단 시 전면 제외(빈 그룹은 하단 filter가 제거)
  const expenseHits: SearchHit[] = hideMoney ? [] : expenses.slice(0, TAKE_SHOW).map(e => {
    const month = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`
    return {
      group: 'expense', id: e.id,
      title: e.itemLabel ?? e.detail ?? e.category,
      right: fmtWon(e.amount),
      badge: null,
      caption: [fmtDateDot(e.date), e.vendor, fmtRoomNo(e.room?.roomNo)].filter(Boolean).join(' · ') || null,
      action: { type: 'href', href: `/finance?month=${month}&q=${enc}` },
    }
  })

  const itemHits: SearchHit[] = items.slice(0, TAKE_SHOW).map(i => ({
    group: 'item', id: i.id,
    title: i.label,
    right: i.category,
    badge: null,
    caption: i.reorderMemo || null,
    action: { type: 'href', href: `/inventory?q=${encodeURIComponent(i.label)}` },
  }))

  const requestHits: SearchHit[] = requests.slice(0, TAKE_SHOW).map(r => ({
    group: 'request', id: r.id,
    title: r.content.length > 80 ? `${r.content.slice(0, 80)}…` : r.content,
    right: null,
    badge: r.resolvedAt ? { label: '처리됨', tone: 'neutral' } : { label: '미처리', tone: 'warning' },
    caption: [r.tenant?.name ?? r.commonPlace ?? '공용', fmtDateDot(r.requestDate)].filter(Boolean).join(' · ') || null,
    action: { type: 'href', href: `/requests?q=${enc}` },
  }))

  // 서류 — 3모델 병합 후 최신순, 종류 라벨로 구분. 착지는 종류별 페이지에 파일명 시딩.
  const docsMerged = [
    ...contractFiles.map(f => ({ id: f.id, fileName: f.fileName, date: f.signedAt, tenantName: f.tenant.name, kindLabel: '계약서', page: '/contracts' })),
    ...rentReceiptFiles.map(f => ({ id: f.id, fileName: f.fileName, date: f.issuedAt, tenantName: f.tenant.name, kindLabel: '입실료 확인서', page: '/rent-receipts' })),
    ...residenceCertFiles.map(f => ({ id: f.id, fileName: f.fileName, date: f.issuedAt, tenantName: f.tenant.name, kindLabel: '실거주 확인서', page: '/residence-certs' })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())
  const docHits: SearchHit[] = docsMerged.slice(0, TAKE_SHOW).map(d => ({
    group: 'doc', id: d.id,
    title: d.fileName,
    right: d.kindLabel,
    badge: null,
    caption: [d.tenantName, fmtDateDot(d.date)].filter(Boolean).join(' · ') || null,
    action: { type: 'href', href: `${d.page}?q=${encodeURIComponent(d.fileName)}` },
  }))

  const groupDefs: Record<SearchGroupType, SearchGroup> = {
    tenant:  { type: 'tenant',  label: '입주자', hits: tenantHits,  hasMore: allTenants.length > TAKE_SHOW, moreHref: `/tenants?q=${enc}` },
    room:    { type: 'room',    label: '호실',   hits: roomHits,    hasMore: rooms.length > TAKE_SHOW,      moreHref: `/room-manage?q=${enc}` },
    expense: { type: 'expense', label: '지출',   hits: expenseHits, hasMore: expenses.length > TAKE_SHOW,   moreHref: `/finance?q=${enc}` },
    item:    { type: 'item',    label: '재고',   hits: itemHits,    hasMore: items.length > TAKE_SHOW,      moreHref: `/inventory?q=${enc}` },
    request: { type: 'request', label: '요청',   hits: requestHits, hasMore: requests.length > TAKE_SHOW,   moreHref: `/requests?q=${enc}` },
    doc:     { type: 'doc',     label: '서류',   hits: docHits,     hasMore: docsMerged.length > TAKE_SHOW,  moreHref: `/contracts?q=${enc}` },
  }
  // 그룹 순서 — kind는 순서만 조정(자동 라우팅 없음). 텍스트 질의는 품목 원장(재고)을 거래(지출)보다 앞에.
  const order: SearchGroupType[] =
    kind === 'room' ? ['room', 'tenant', 'expense', 'item', 'request', 'doc']
    : kind === 'phone' ? ['tenant', 'room', 'expense', 'item', 'request', 'doc']
    : ['tenant', 'room', 'item', 'expense', 'request', 'doc']

  return { queryKind: kind, groups: order.map(k => groupDefs[k]).filter(g => g.hits.length > 0) }
}

const tenantSelect = {
  id: true, name: true, englishName: true, nationality: true, job: true,
  contacts: { select: { contactValue: true }, take: 3 },
  leaseTerms: {
    orderBy: { createdAt: 'desc' as const }, take: 1,
    // tourDate·reservationConfirmedAt — 파생 라벨(문의/예약 확정) 분기용 (e1b81629)
    select: { status: true, tourDate: true, reservationConfirmedAt: true, room: { select: { roomNo: true } } },
  },
}
