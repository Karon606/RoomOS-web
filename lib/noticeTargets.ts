// 단체 공지 대상 정본 — 입주자/문의·예약 두 그룹 분할, 문의 단계, 문의일 범위(KST 일 경계), 선착순 순번.
//
// 배경 (2026-10-06, 운영자 승인 · 두 패널 합의)
//   "단체문자 보내는 기능에서 문의예약했던 사람들도 조건에 들어가면 좋겠어. 목적은 일괄 발송해서
//    선착순 예약(예약금 입금한 예약확정)을 받을 수 있도록 … 먼저 문의한 사람에게 우선권을 줘야 하니까"
//   방이 나면 문의자 전원에게 한 번에 알리고 예약금 입금 순으로 확정한다. 우선권은 순서 안에서
//   주는 것이 아니라(모두에게 같은 본문이 간다) **문의일 범위로 나눠 먼저 보내는 것**으로 준다
//   — 9월 문의자에게 먼저, 며칠 뒤 10월 문의자에게(웨이브).
//
// 그룹은 둘이다.
//   입주자   = 지금 방에 사는 계약(CURRENT_OCCUPANCY_STATUSES · 방 있음) — 종전 단체 공지 모집단 그대로
//   문의·예약 = 아직 방이 정해지지 않은 리드(WISH_LEAD_STATUSES · 예약 확정 아님) — 입주자 관리 '문의·예약' 그룹
// 예약 확정자는 이미 예약금을 낸 사람이라 선착순 안내의 대상이 아니고, 취소자는 두 집합 어디에도 없다
// (취소자 재안내는 2차 후보, knowledge/notice-sms-targets).
//
// 확정 제외는 **리드 갈래에만** 건다. 거주중 계약도 reservationConfirmedAt 을 그대로 들고 있다
// (예약 확정 뒤 입실한 사람 — 2026-10-06 실측 제기역점 ACTIVE 3건). 모집단 전체에 걸면 그 입주자가 빠진다.

import { CURRENT_OCCUPANCY_STATUSES } from './leaseStatus'
import { WISH_LEAD_STATUSES, inquiryStageOf, type LeadStage } from './wishMatch'
import { kstYmdStr } from './kstDate'
import { fmtMDYearIfOther } from './fmtDate'

export type NoticeGroup = 'resident' | 'lead'

export const NOTICE_GROUP_LABEL: Record<NoticeGroup, string> = { resident: '입주자', lead: '문의·예약' }

/**
 * 이 계약이 단체 공지의 어느 그룹인가. 어느 쪽도 아니면 null(확정 예약·취소·퇴실·비거주·방 없는 거주).
 * 서버 조회의 where 와 같은 판정이다 — 조회가 넓어져도 여기서 한 번 더 가른다.
 */
export function classifyNoticeTarget(l: {
  status: string
  roomId: string | null
  reservationConfirmedAt: Date | string | null
  tourDate?: Date | string | null
}): { group: NoticeGroup; stage: LeadStage | null } | null {
  if ((CURRENT_OCCUPANCY_STATUSES as readonly string[]).includes(l.status)) {
    return l.roomId ? { group: 'resident', stage: null } : null
  }
  if ((WISH_LEAD_STATUSES as readonly string[]).includes(l.status) && !l.reservationConfirmedAt) {
    return { group: 'lead', stage: inquiryStageOf(l) }
  }
  return null
}

/** 순번·범위가 읽는 최소 모양. */
export type NoticeTargetRow = {
  leaseTermId: string
  group: NoticeGroup
  inquiryAt: Date | string | null
  createdAt: Date | string
}

/** 선착순 기준 시각 — 문의 일시, 없으면 등록 일시(lib/wishMatch orderAt 과 같은 정의). */
export function leadOrderAt(r: Pick<NoticeTargetRow, 'inquiryAt' | 'createdAt'>): number {
  return new Date(r.inquiryAt ?? r.createdAt).getTime()
}

/** 문의일 'YYYY-MM-DD'(KST). 범위 필터가 이 값으로 자른다. */
export function leadInquiryYmd(r: Pick<NoticeTargetRow, 'inquiryAt' | 'createdAt'>): string {
  return kstYmdStr(new Date(r.inquiryAt ?? r.createdAt))
}

// 같은 시각이면 등록 순, 그것도 같으면 id — 화면을 다시 열어도 순번이 안 흔들린다.
function cmpLead(a: NoticeTargetRow, b: NoticeTargetRow): number {
  return (leadOrderAt(a) - leadOrderAt(b))
    || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    || (a.leaseTermId < b.leaseTermId ? -1 : a.leaseTermId > b.leaseTermId ? 1 : 0)
}

/**
 * 선착순 순번 — 리드 **전체** 기준 1..N(단계·문의일·다른 조건으로 거르기 전).
 * 조건을 바꿔도 같은 사람은 같은 번호다. 거른 목록 안에서 다시 세면 9월 문의자만 고른 화면의
 * '1번'과 전체 화면의 '1번'이 다른 사람이 되어, 운영자가 말하는 '몇 번째 문의'가 화면마다 갈린다.
 */
export function leadRanks(rows: readonly NoticeTargetRow[]): Map<string, number> {
  const leads = rows.filter(r => r.group === 'lead').sort(cmpLead)
  return new Map(leads.map((r, i) => [r.leaseTermId, i + 1]))
}

/** 문의일 범위 — 'YYYY-MM-DD' 양끝 포함(KST 시작일 00:00 ~ 끝일 23:59). 빈 끝은 열린 끝. */
export type InquiryRange = { from: string; to: string }

export function inInquiryRange(r: Pick<NoticeTargetRow, 'inquiryAt' | 'createdAt'>, range: InquiryRange | null): boolean {
  if (!range) return true
  const d = leadInquiryYmd(r)
  return (!range.from || d >= range.from) && (!range.to || d <= range.to)
}

/**
 * 한 그룹의 목록. 입주자는 받은 순서(호실순) 그대로, 리드는 문의일 범위로 거르고 선착순으로 세운다.
 * 문자 묶음(20명 단위)도 이 순서로 잘리므로 첫 묶음이 먼저 문의한 사람들이다.
 */
export function noticeGroupRows<T extends NoticeTargetRow>(rows: readonly T[], group: NoticeGroup, range: InquiryRange | null = null): T[] {
  const mine = rows.filter(r => r.group === group)
  if (group === 'resident') return mine
  return mine.filter(r => inInquiryRange(r, range)).sort(cmpLead)
}

// ── 표시 ──
// 날짜는 해가 다를 때만 연도를 붙인다(fmtMDYearIfOther). 지난해 문의를 '12/1'로만 쓰면 최근 문의처럼 읽힌다
// (웹디자이너 패스 2026-10-06). today 는 시험용 주입 자리다.

/** 문의일 칩·조건 요약 — '9/1~10/6', 해를 넘기면 '2025. 12/1~1/5'. 빈 끝은 비워 둔다. */
export function inquiryRangeLabel(r: InquiryRange, today: Date = new Date()): string {
  return `${r.from ? fmtMDYearIfOther(r.from, today) : ''}~${r.to ? fmtMDYearIfOther(r.to, today) : ''}`
}

/**
 * 문의·예약 행 보조줄 — '문의 9/9 · 투어 10/1 · 공지 9/20'(§11 보조줄 문법, '명사 날짜' 한 어순).
 * 문의 일시가 없으면 '등록'. 마지막 칸은 단체 공지 **발송 시도** 기록이라 '안내함' 같은 단정 어휘를 쓰지 않는다.
 */
export function leadSubLine(
  r: { inquiryAt: Date | string | null; createdAt: Date | string; tourDate: Date | string | null; lastNoticeAt: Date | string | null },
  today: Date = new Date(),
): string {
  const md = (d: Date | string) => fmtMDYearIfOther(d, today)
  return [
    r.inquiryAt ? `문의 ${md(r.inquiryAt)}` : `등록 ${md(r.createdAt)}`,
    r.tourDate ? `투어 ${md(r.tourDate)}` : null,
    r.lastNoticeAt ? `공지 ${md(r.lastNoticeAt)}` : null,
  ].filter(Boolean).join(' · ')
}
