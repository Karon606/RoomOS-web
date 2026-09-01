// 입퇴실 캘린더 조립 — 방별 체류 구간을 하나의 날짜 범위에 잘라 행·바·공백·충돌로 세운다.
//
// 왜 조립을 여기 두는가. 화면은 이 결과를 배치만 한다. 겹침·충돌·라벨을 화면이 다시 세면
// 감지망(check-room-availability-drift)이 사고라 부르는 상태와 화면이 갈린다.
//
// 범위는 둘이다.
//   · buildMoveCalendar — 한 달 창. 홈 '이달 입퇴실 N건'이 딛는 수를 낸다.
//   · buildMoveRange    — 여러 달을 잇는 연속 창(2026-08-17 운영자 오더). 호실 관리 입퇴실 탭이 쓴다.
// 기하는 한 벌(assemble)이다. 좌표를 '범위 첫날부터 며칠'로 세므로 한 달 창에서는 그 값이
// 곧 '그 달 며칠'이라, 달을 넘겨도 같은 코드가 같은 그림을 그린다.
//
// 판정은 전부 정본을 부른다.
//   · 겹침 여부 = lib/roomAssignment occupancyOverlaps.
//   · 당일 회전 = isSameDayTurnover — 겹치되 충돌이 아니다(2026-08-19 개정). 층 분리 기하는 그대로
//     두어 같은 칸에 선 두 막대가 회전 자체를 말하게 하고, 빨간 밴드와 요약 줄만 세우지 않는다.
//   · 확인된 겹침 = findOverlapAck — 조회가 넘긴 확인 목록(acks)으로 중립 톤을 가른다. 줄은 지우지
//     않는다. 사라지면 해제할 길이 없고, 한 방에 두 사람이 있다는 사실도 함께 사라진다.
//   · 다음 예약 = lib/leaseStatus roomReservationQueue.
//   · 날짜 문구 = checkoutDateLabel · moveInDateLabel · moveInSubText.
//
// 날짜는 전부 'YYYY-MM-DD' 문자열이다. 사전순 비교가 곧 날짜 비교라 비교에 Date 를 만들지 않고,
// 날짜 덧셈이 필요한 자리만 UTC 자정으로 다룬다(lib/kstDate 규약 — 서버 UTC·기기 KST 가 하루
// 다른 오늘을 보는 함정을 애초에 열지 않는다).

import { findOverlapAck, isSameDayTurnover, occupancyOverlapSpan, occupancyOverlaps, type OverlapAckSpan } from './roomAssignment'
import { OCCUPYING_STATUSES, checkoutDateLabel, moveDateLabel, moveInDateLabel, moveInSubText, primaryRoomLease, roomReservationQueue } from './leaseStatus'
import { fmtRoomNo } from './roomNo'
import { fmtMD } from './fmtDate'

/**
 * 이 계약이 실제로 머문 방 한 칸 — RoomStay 구간 하나다.
 *
 * 계약의 roomId 는 '지금 방' 한 칸뿐이라 방을 옮긴 계약은 옛 방의 거주가 통째로 사라지고
 * 새 방에 최초 입주일부터 그려진다. 막대의 방·기간은 그래서 계약이 아니라 이 구간에서 나온다.
 * 상태·금액·예약은 계속 계약이 정본이다 — 구간은 "어디에 언제 있었나"만 안다.
 */
export type MoveStaySpan = {
  id: string
  roomId: string
  roomNo: string
  /** 최초 구간은 입주일, 이후 구간은 이사일이다(lib/roomStay 의 입주 구간·이동 구간 구분). */
  startDate: string | null
  /** 열린 구간(아직 그 방에 있다)은 null — 그 끝은 계약이 말한다. */
  endDate: string | null
}

/** 조립이 필요한 계약 한 줄 — 서버가 select 최소로 뽑아 이름까지 붙여 넘긴다. */
export type MoveCalendarLease = {
  id: string
  status: string
  /** 단기 여부. 기하에는 안 쓴다 — 단기의 퇴실 예정일도 expectedMoveOut 에 들어 있어 분기가 필요 없다. */
  isShortTerm: boolean
  moveInDate: string | null
  moveOutDate: string | null
  expectedMoveOut: string | null
  roomId: string
  roomNo: string
  tenantId: string
  /** lib/displayName 이 고른 표기. 조립은 이름을 다시 고르지 않는다. */
  tenantName: string
  /**
   * 거주 구간 전부(시작일 오름차순이 아니어도 된다 — 조립이 다시 세운다).
   *
   * 선택 칸이 아니라 **필수**다. 없어도 되는 칸으로 두면 조회 한 곳이 빠뜨렸을 때 타입이 안 잡고
   * 그 순간 이 화면은 다시 계약의 roomId 한 칸만 보는 상태로 돌아간다.
   * 예약(RESERVED)은 구간을 만들지 않는 것이 설계라 비어 있고, 그때만 계약이 구간을 대신한다.
   */
  stays: MoveStaySpan[]
}

export type MoveBarKind = 'resident' | 'reserved'

/** 트랙 위 막대 하나 — 그 범위에 보이는 구간만큼 잘린 체류. */
export type MoveBar = {
  /**
   * 막대 하나의 고유 키. 계약 id 로는 부족하다 — 한 계약이 나갔다 같은 방으로 돌아오면
   * 그 방 행에 같은 계약 id 의 막대가 둘 선다.
   */
  id: string
  leaseId: string
  tenantId: string
  tenantName: string
  kind: MoveBarKind
  /** 이사로 시작했다면 그 전 방 번호 — 다른 방에서 옮겨 온 것이라 입실이 아니다. 아니면 null. */
  movedFromRoomNo: string | null
  /** 이사로 끝났다면 옮겨 간 방 번호 — 다른 방으로 간 것이라 퇴실이 아니다. 아니면 null. */
  movedToRoomNo: string | null
  /** 겹치는 막대끼리 세로로 비켜 앉는 층. 0부터. */
  lane: number
  startDay: number
  endDay: number
  /** 범위 밖에서 이어져 들어온 쪽 — 그 모서리는 직각으로 그린다. */
  clippedStart: boolean
  clippedEnd: boolean
  /** 퇴실일이 아예 없다(무기한 점유·무기한 예약). */
  openEnded: boolean
  /** 입주·퇴실이 이 범위 안에 있는가. 라벨이 무엇을 말할지가 여기서 갈린다. */
  startsInRange: boolean
  endsInRange: boolean
  /** 세 조각을 종전과 같은 한 문자열로 이은 것. title·aria·회귀가 이 값을 딛는다. */
  label: string
  /**
   * 막대 **시작 지점**에 못 박을 사건 문구. 시작이 이 범위 안일 때만 선다.
   *
   * 조각을 조립이 내주는 이유. 화면이 label 을 ' · ' 로 다시 쪼개면 그 사본이 곧 두 번째 진실이 된다
   * (이 파일 머리의 원칙). 게다가 기계적으로도 깨진다 — 호실번호는 숫자라는 보장이 없고
   * (등록 폼이 'A동-3'·'옥탑방'을 권한다) 라벨 문자열 안에 같은 구분자가 섞일 여지가 있다.
   */
  startLabel: string | null
  /** 막대 **끝 지점**에 못 박을 사건 문구. 끝이 이 범위 안일 때만 선다. */
  endLabel: string | null
  /**
   * 사건이 하나도 없는 막대의 상태 문구('퇴실일 미정' 등) — 두 조각이 다 비었을 때만 선다.
   *
   * 이것은 사건이 아니라 상태다. 날짜 칸에 못 박으면 안 되고(그 픽셀이 그 날짜를 뜻하게 된다)
   * 이름과 함께 sticky 로 흘러야 한다. 종전 표시가 정확히 그것이었다.
   */
  stateLabel: string | null
  stayFrom: string | null
  stayTo: string | null
  /** 이 막대가 충돌에 걸려 있다 — 행 좌측 팁과 짝이다. */
  conflicted: boolean
  /**
   * 아직 확인 안 된 이사 계획에서 나온 막대(합성 구간 plan-). 확정 거주와 같은 색이면
   * 이사 확인을 잊어도 화면이 이미 산 것처럼 보인다(운영자 승인 2026-09-01, 방식 가) —
   * 색은 예약과 같은 대기 톤을 쓰고, 예약과의 구분은 글자('예정')가 진다.
   */
  planned: boolean
}

// ── 작업(청소) ────────────────────────────────────────────────────
//
// 1단계는 **청소(RoomCleaning)만** 싣는다. 도배·장판 같은 일반 작업 모델은 별도 승인 항목이다.
//
// 왜 막대(bars)와 다른 배열인가. 공실 캡션(gaps)·충돌 판정·홈 '이달 입퇴실 N건'이 전부
// bars·events 를 딛는다. 작업을 거기 섞으면 도배 중인 빈 방이 공실이 아니게 되어 'N일 공실'이
// 거짓이 되고, 충돌 판정이 거주와 청소가 겹쳤다고 빨간 밴드를 세우며, 최악은 운영자가
// [겹침 확인]을 눌러 LeaseOverlapAck 로 그 거짓을 영구화하는 것이다.

/** 조립이 읽는 작업 한 줄 — 조회가 넘긴다(acks 와 같은 문법). 판정은 여기서 한 번만 한다. */
export type MoveWorkInput = {
  id: string
  roomId: string
  roomNo: string
  /** 그 작업이 서는 날 'YYYY-MM-DD'. 예정 건은 예정일, 완료 건은 완료일이다. */
  date: string
  /** 완료된 작업인가. 지연 여부는 조립이 오늘과 견줘 낸다 — 사실이 아니라 계산이다. */
  done: boolean
  /** 종류 문구('퇴실 청소'). **색이 아니라 글자가 종류를 말한다** — viz 로 종류를 가르는 안은 실측 기각. */
  kindLabel: string
  /** 담당자 문구. 아직 안 정했으면 null. */
  performerLabel: string | null
  /**
   * 그 방이 공실 집계에서 제외되는 방인가(lib/vacancy isVacancyExcluded 와 같은 사실).
   * 창고·사무실은 세를 놓는 방이 아니라, 비어 있어도 '입주 가능'이 아니다. 거기 청소가 잡혔다고
   * 행을 세우면 그 행이 곧 거짓 입주 가능 신호가 된다(실데이터: 601호 옥탑 창고).
   */
  vacancyExcluded: boolean
}

/** 예정 · 지연(예정일이 지났는데 미완료) · 완료. 표면 농도로 가르고 지연만 --tc 계열이다. */
export type MoveWorkStatus = 'planned' | 'overdue' | 'done'

/** 작업 레인의 띠 하나 — 거주 막대와 **다른 배열 · 다른 레인 풀**이다. */
export type MoveWork = {
  id: string
  /** 범위 첫날부터 며칠. 작업은 하루짜리라 startDay·endDay 를 따로 두지 않는다. */
  day: number
  date: string
  status: MoveWorkStatus
  kindLabel: string
  performerLabel: string | null
  /**
   * 그날 그 방에 사람이 있었는가. 화면은 여기에 **색을 얹지 않는다** — 작업 띠가 거주 막대와
   * 세로로 겹쳐 서면 그것이 곧 거주 중이다. 다만 aria 문장에는 반드시 들어간다(시각적 겹침은
   * 소리로 안 들린다).
   *
   * 이름이 '거주 중'이 아닌 이유. 퇴실 당일 청소는 그날 사람이 있어도 퇴실 청소이고, 예약
   * 첫날 청소는 입실 직전 청소다 — 그것을 '거주 중 청소'라 부르면 표준 운영이 오분류된다
   * (도메인 패널 2026-08-20). 이 칸은 분류가 아니라 관찰이다.
   */
  occupied: boolean
  /** 작업끼리만 겹치는 층. 거주 laneCount 와 섞지 않는다. */
  lane: number
}

/** 요약 줄이 쓰는 작업 한 줄 — 트랙 밖이라 어느 방인지가 함께 있어야 한다. */
export type MoveWorkEvent = MoveWork & { roomId: string; roomNo: string }

/**
 * 작업 상태의 낱말 — 화면이 각자 고르면 트랙·요약 줄·소리가 같은 상태를 다르게 부른다.
 *
 * '예정일 경과'는 **이 앱이 이미 쓰는 낱말**이다(대시보드 알림의 "퇴실 예정일 경과 N일",
 * §18 진행형 알림의 "경과 N일 · 처리 필요"). 같은 사실을 부르는 말이 화면마다 다르면
 * 운영자가 두 낱말을 서로 다른 상태로 읽는다. '지남'·'지연'은 여기서 새로 지어낸 말이었다.
 * '경과' 한 낱말로 줄이지 않는 이유는 뜻이 갈리기 때문이다 — 그 말만으로는 '진행 경과'로도 읽힌다.
 */
export const MOVE_WORK_STATUS_LABEL: Record<MoveWorkStatus, string> = {
  planned: '예정', overdue: '예정일 경과', done: '완료',
}

/**
 * 트랙 레일에 세울 한 마디 — 종류와 상태를 잇는다.
 *
 * **'청소'를 여기서 지어내지 않는다.** 종전에는 화면이 `청소 ${상태}` 를 박아 놓아, 종목이
 * 늘면 도배가 '청소 예정'으로 읽히게 되어 있었다. 종류를 말하는 것은 `kindLabel` 하나이고
 * 그 값은 종목의 공급자가 낸다(청소는 `lib/moveCalendarData` 안에서).
 *
 * 조립이 이 함수를 부르지는 않는다 — 이건 화면이 쓰는 문구다. 그런데도 여기에 두는 이유는
 * 회귀가 순수 함수만 딛기 때문이다. 컴포넌트 안에 두면 "종목이 늘어도 낱말이 안 갈린다"를
 * 감지망이 한 글자도 못 본다.
 */
export const moveWorkRailLabel = (w: { kindLabel: string; status: MoveWorkStatus }): string =>
  `${w.kindLabel} ${MOVE_WORK_STATUS_LABEL[w.status]}`.trim()

export type MoveDaySpan = { startDay: number; endDay: number }
export type MoveGap = MoveDaySpan & { days: number }
/** 겹친 구간 — 확인된 겹침은 중립 톤으로 그린다(빨강은 아직 답하지 않은 것에만 쓴다). */
export type MoveOverlapSpan = MoveDaySpan & { acked: boolean }

export type MoveConflictKind = 'overlap' | 'indefinite' | 'reversed'

/** 조립이 읽는 확인 한 줄 — 판정에 필요한 칸만. 실물은 LeaseOverlapAck 이다. */
export type MoveOverlapAck = OverlapAckSpan & { id: string }

export type MoveConflict = {
  kind: MoveConflictKind
  roomId: string
  roomNo: string
  /** '계약 보기' 진입 대상 — 손봐야 할 쪽 계약이다. */
  leaseId: string
  tenantId: string
  text: string
  /**
   * 의도된 겹침으로 확인된 상태인가 — kind:'overlap' 만 대상이다.
   * 무기한(indefinite)은 '퇴실일을 넣으라'는 다른 처방이고 역전(reversed)은 데이터 사고라
   * 확인으로 덮을 것이 아니다. 확인되면 중립 톤으로 내려가고 감지망 축 ②에서도 빠진다.
   */
  acked: boolean
  /** 확인 줄의 id — [확인 해제] 가 이 값을 쓴다. 확인 전이면 null. */
  ackId: string | null
  /** [겹침 확인] 이 지목할 두 계약(앞=입주일이 이른 쪽). 확인 대상이 아닌 충돌은 null. */
  pair: { frontLeaseTermId: string; backLeaseTermId: string } | null
}

export type MoveCalendarRow = {
  roomId: string
  roomNo: string
  /**
   * 범위 안 첫 변동일(입주·퇴실 중 이른 것). 월 창의 행 정렬 키다.
   * **작업은 여기 안 들어간다** — 청소는 입퇴실 변동이 아니다.
   */
  firstChangeDay: number
  laneCount: number
  bars: MoveBar[]
  /** 그 범위의 작업(청소). bars 와 별도 배열·별도 레인 풀이다(위 MoveWork 머리 주석). */
  works: MoveWork[]
  /**
   * 작업 레인의 층 수. 거주 laneCount 와 **따로 센다** — 같은 풀에 넣으면 하루짜리 작업 하나가
   * 그 방 행 높이를 통째로 한 단 늘려 행 높이가 데이터에 따라 들쭉날쭉해진다.
   * 작업이 없으면 0 이라, 청소가 없는 행은 종전과 한 픽셀도 다르지 않다.
   */
  workLaneCount: number
  gaps: MoveGap[]
  overlaps: MoveOverlapSpan[]
  conflicts: MoveConflict[]
  /** 범위 밖(오른쪽)의 다음 예약을 한 줄로. 트랙 안에 들어온 예약은 막대가 말하므로 null 이다. */
  tail: string | null
  tailLeaseId: string | null
  tailTenantId: string | null
}

/** 날짜순 한 줄 — 간트와 같은 조립에서 나온 다른 편성이다. */
export type MoveEvent = {
  day: number
  /** 그 변동의 실제 날짜 'YYYY-MM-DD'. 여러 달을 잇는 범위에서는 day 만으로 날짜를 못 만든다. */
  date: string
  type: 'in' | 'out'
  /**
   * 이 변동이 이사인가 — 그 방을 기준으로 하면 나가고 들어오는 것이 맞지만(그래서 type 은 그대로),
   * 사람을 기준으로 하면 퇴실도 입실도 아니다. 문구를 가르는 것은 이 칸이다.
   */
  moved: boolean
  /**
   * 이사일 때 상대 방 번호 — 나가는 줄이면 갈 방, 드는 줄이면 온 방. 이사가 아니면 null.
   *
   * 없으면 요약 줄에서 이사 두 건이 호실 빼고 완전히 같은 글자가 된다("9/1 402호 이사 박정후"와
   * "9/1 404호 이사 박정후"). 어느 쪽이 떠난 방이고 어느 쪽이 든 방인지 화면이 답을 못 한다.
   * 짝은 여기 조립 단계에서 싣는다 — 화면이 out·in 쌍을 다시 세는 것은 이 파일이 금지한다.
   */
  otherRoomNo: string | null
  /** 이 변동을 낸 막대 — 한 계약이 같은 날 두 방에서 변동을 내므로 계약 id 는 유일 키가 아니다. */
  barId: string
  roomId: string
  roomNo: string
  leaseId: string
  tenantId: string
  tenantName: string
  kind: MoveBarKind
  stayFrom: string | null
  stayTo: string | null
}

export type MoveCalendarMonth = {
  month: string
  daysInMonth: number
  /** 보고 있는 달이 오늘의 달일 때만 1~N, 아니면 null. */
  todayDay: number | null
  rows: MoveCalendarRow[]
  events: MoveEvent[]
  conflicts: MoveConflict[]
  /** 그 달 입실·퇴실 건수. 홈 현황 탭의 '이달 입퇴실 N건'이 딛는 수다. */
  eventCount: number
}

/** 연속 트랙 위의 한 달 — 월 밴드 라벨과 경계선, 빈 달 표시가 이 조각을 딛는다. */
export type MoveRangeMonth = {
  month: string
  /** 범위 좌표에서 이 달이 시작하는 날짜 번호. */
  startDay: number
  days: number
  /** 이 달의 입퇴실 건수. 0 이면 '변동 없음'으로 적어 빈 구간이 고장으로 안 읽히게 한다. */
  eventCount: number
}

export type MoveCalendarRange = {
  /** 범위 첫날·마지막날 'YYYY-MM-DD'. 날짜 번호 1 이 곧 from 이다. */
  from: string
  to: string
  days: number
  today: string
  /** 오늘이 범위 안일 때만 1~days, 아니면 null. */
  todayDay: number | null
  /** URL ?month= 가 가리키는 달. 첫 착지 위치와 탭 접미 N 이 이 달을 딛는다. */
  focusMonth: string
  /** 보고 있는 달의 입퇴실 건수 — 홈 '이달 입퇴실 N건'과 같은 수라야 두 화면이 안 갈린다. */
  focusEventCount: number
  months: MoveRangeMonth[]
  rows: MoveCalendarRow[]
  /** 오늘부터 UPCOMING_DAYS 일 안의 변동. 트랙은 넓고 '다음 일정'은 매일 묻는 질문이라 따로 낸다. */
  upcoming: MoveEvent[]
  /**
   * 아직 안 끝난 청소 중 UPCOMING_DAYS 일 안의 것 — **지난 예정(지연)도 포함한다.**
   * 지연은 '다가오는' 것은 아니지만 앞으로 해야 할 일이고, 이 화면에서 가장 급한 사실이다.
   * 완료분은 안 넣는다 — 끝난 일은 다음에 할 일이 아니다(트랙과 행 아래 줄이 이미 말한다).
   */
  upcomingWorks: MoveWorkEvent[]
  conflicts: MoveConflict[]
  /** 범위 오른쪽 밖에 남은 예정. 천장에 걸려 안 보이는 것이 있다는 사실을 말한다. */
  beyond: { count: number; firstDate: string } | null
  /** 범위 왼쪽 밖에 더 과거 변동이 있는가. '이전 달 더 보기'가 이 값으로 선다. */
  canExtendPast: boolean
}

/** 고정 요약 줄이 담는 날수. 운영자의 하루 질문("다음에 뭐가 있나")이 닿는 거리다. */
export const UPCOMING_DAYS = 14

/** 그 달의 일수. Date 를 UTC 로만 만져 실행 환경 시간대를 배제한다. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 'YYYY-MM' 에 n 개월을 더한다(음수면 뺀다). 범위 경계 계산의 정본이다. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** 그 달 마지막 날 'YYYY-MM-DD'. */
export function monthLastDay(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
}

/** 연속 창의 경계 상수 — 과거는 한 달, 미래는 데이터가 정하되 바닥 +2 · 천장 +6 개월. */
export const RANGE_PAST_MONTHS = 1
export const RANGE_MIN_AHEAD = 2
export const RANGE_MAX_AHEAD = 6
/** 창 밖으로 점프했을 때의 창 폭(개월). 먼 달을 골라도 트랙이 이보다 길어지지 않는다. */
export const RANGE_JUMP_MONTHS = 4

/**
 * 연속 창의 경계 — **넓히지 않고 옮긴다**(2026-08-20).
 *
 * 종전에는 focusMonth 가 범위 밖이면 그쪽으로 창을 **넓히기만** 했다. 2028년 1월을 고르면
 * 2026-07 부터 2028-01 까지 19개월(578일 · 트랙 폭 약 13,900px)이 된다. 상한이 없어서 월 피커로
 * 2035년을 고르면 100개월을 넘고, 그 기간 전부를 조회한다. "빈 트랙을 수천 px 끌지 않게"라던
 * 천장 규칙(RANGE_MAX_AHEAD)이 정확히 그 반대로 작동하고 있었다.
 *
 * **기본 창(오늘 근처)은 한 글자도 안 바꾼다.** 오른쪽 끝을 '마지막 변동이 있는 달'에 두는 규칙은
 * "다음에 무엇이 오는가"라는 이 화면의 존재 이유에 직접 답하는 자리라, 여기를 4개월로 깎으면
 * 매일 아침의 기본 화면이 바뀌고 종전에 막대로 보이던 예약이 beyond 한 줄로 강등된다.
 * 문제였던 것은 기본 창이 아니라 **점프**다.
 *
 * 불변식 넷(회귀가 못 박는다).
 *   ① startMonth ≤ focusMonth ≤ endMonth — 언제나. focusMonth 가 창 밖이면 그 달의 건수를
 *      아무도 모르는데 `?? 0` 이 "0건"으로 출력해 탭 접미가 통째로 사라진다.
 *   ② 창의 개월 수 ≤ max(RANGE_JUMP_MONTHS, 1 + RANGE_MAX_AHEAD + RANGE_PAST_MONTHS) = 8.
 *   ③ focusMonth 가 오늘 달이면 결과가 종전 산식과 완전히 같다.
 *   ④ 과거 점프를 반복하면 startMonth 가 **정확히 한 달씩** 줄어든다 — focus 를 창의 첫 달에
 *      두기 때문이다. 가운데에 두면 '이전 달 더 보기' 한 번에 두 달씩 튀어 낱말이 거짓이 된다.
 */
export function moveRangeWindow(input: {
  todayMonth: string
  focusMonth: string
  /** 이 영업장의 마지막 변동이 있는 달. 기본 창의 오른쪽 끝을 정한다. */
  lastChangeMonth: string
}): { startMonth: string; endMonth: string } {
  const { todayMonth, focusMonth, lastChangeMonth } = input
  const minEnd = shiftMonth(todayMonth, RANGE_MIN_AHEAD)
  const maxEnd = shiftMonth(todayMonth, RANGE_MAX_AHEAD)
  const baseStart = shiftMonth(todayMonth, -RANGE_PAST_MONTHS)
  const baseEnd = lastChangeMonth < minEnd ? minEnd : lastChangeMonth > maxEnd ? maxEnd : lastChangeMonth
  if (focusMonth >= baseStart && focusMonth <= baseEnd) return { startMonth: baseStart, endMonth: baseEnd }
  if (focusMonth < baseStart) {
    // 과거 점프 — focus 가 창의 첫 달이다(불변식 ④).
    return { startMonth: focusMonth, endMonth: shiftMonth(focusMonth, RANGE_JUMP_MONTHS - 1) }
  }
  // 미래 점프 — 앞머리로 한 달을 붙인다. '그때로 이동'으로 닿은 예약 앞에 누가 나가는지 보여야 한다.
  return { startMonth: shiftMonth(focusMonth, -1), endMonth: shiftMonth(focusMonth, RANGE_JUMP_MONTHS - 2) }
}

/**
 * 창 오른쪽 밖에 남은 **앞으로의** 예정.
 *
 * `today` 가드가 필요한 이유. 창을 과거로 미끄러뜨리면 창의 끝이 오늘보다 이전이 될 수 있는데,
 * 그때 오른쪽 밖을 그대로 세면 이미 지난 변동이 "이후 예정 62건 · 최초 7/2"로 적힌다.
 * 지난 일이 앞으로의 일로 읽히고, 그 수를 보고 광고·청소·계약 준비를 건다.
 */
export function beyondWindow(
  changeDates: string[],
  to: string,
  today: string,
): { count: number; firstDate: string } | null {
  const rest = changeDates.filter(d => d > to && d > today).sort()
  return rest.length > 0 ? { count: rest.length, firstDate: rest[0] } : null
}

const DAY_MS = 86400000
const atUtc = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`)
/** a 에서 b 까지의 날수(b 가 뒤면 양수). 양쪽 다 UTC 자정이라 실행 환경 시간대가 안 섞인다. */
const daysBetween = (a: string, b: string): number => Math.round((atUtc(b) - atUtc(a)) / DAY_MS)
const addDays = (ymd: string, n: number): string => new Date(atUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)

/** 체류의 끝 — 퇴실 완료면 실제 퇴실일, 진행 중이면 퇴실 예정일. 둘 다 없으면 미정이다. */
function stayEnd(l: MoveCalendarLease): string | null {
  return l.moveOutDate ?? l.expectedMoveOut
}

/**
 * 계약 하나를 방별 체류 조각으로 편다 — 막대 하나가 곧 조각 하나다.
 *
 * 구간이 있으면 구간이 진실이다. 구간이 없는 계약은 예약뿐이고(RESERVED 는 점유가 아니라
 * 구간을 만들지 않는 것이 설계다) 그때만 계약 자체가 한 조각이 된다. 비예약인데 구간이 없으면
 * 기록 지점이 빠진 것이라 감지망(check-room-stay-drift ③)이 잡는다 — 여기서 계약으로 되돌아가
 * 그리면 그 사고가 화면에서 정상으로 보인다. 그래서 폴백은 조용히 넓히지 않는다.
 *
 * 조각의 앞뒤에 다른 구간이 있으면 그 경계는 퇴실·입실이 아니라 **이사**다. 이 한 사실이
 * 라벨과 이벤트 문구를 가른다.
 */
type StaySlice = {
  id: string
  roomId: string
  roomNo: string
  from: string | null
  to: string | null
  movedFromRoomNo: string | null
  movedToRoomNo: string | null
}

function slicesOf(l: MoveCalendarLease): StaySlice[] {
  if (l.stays.length === 0) {
    return [{ id: l.id, roomId: l.roomId, roomNo: l.roomNo, from: l.moveInDate, to: stayEnd(l), movedFromRoomNo: null, movedToRoomNo: null }]
  }
  // 시작일 없는 옛 구간은 맨 앞으로 — 그것이 그 사람이 이 계약과 얽힌 가장 이른 시점이다
  // (getRoomStayHistory 의 정렬 키와 같은 선).
  const sorted = [...l.stays].sort((a, b) => (a.startDate ?? '') < (b.startDate ?? '') ? -1 : (a.startDate ?? '') > (b.startDate ?? '') ? 1 : 0)
  return sorted.map((s, i) => ({
    id: s.id,
    roomId: s.roomId,
    roomNo: s.roomNo,
    from: s.startDate,
    // 열린 구간의 끝은 계약이 말한다(퇴실 완료면 실제일, 진행 중이면 예정일, 둘 다 없으면 미정).
    // 구간에서 읽으면 안 된다 — RoomStay 는 실제로 나간 날만 담아서 퇴실 예정일이 애초에 없다.
    // 그랬다가는 아직 안 나간 사람 전부가 무기한 관통 막대가 된다.
    to: s.endDate ?? stayEnd(l),
    movedFromRoomNo: i > 0 ? sorted[i - 1].roomNo : null,
    movedToRoomNo: i < sorted.length - 1 ? sorted[i + 1].roomNo : null,
  }))
}

/**
 * 막대 라벨 — 그 범위에 무엇이 바뀌었는가를 말한다.
 *
 * 입주·퇴실이 범위 안이면 그 날짜를 세우고, 둘 다 없을 때만 상태를 말한다. 퇴실일 미정을
 * 늘 붙이면 진행 중 거주 대부분이 같은 말을 달고 서서 정작 변동이 묻힌다 — 무기한 점유가
 * 정보가 되는 자리는 아무 변동도 없이 트랙을 관통하는 막대다(예약과 포개지는 바로 그 경우다).
 *
 * 이사 경계는 이름이 다르다. 옛 방에서 이사로 끝난 날을 '퇴실'이라 적으면 나가지 않은 사람이
 * 나간 것이 되고, 새 방에서 이사로 시작한 날을 '입실'이라 적으면 계약이 그날 시작한 것이 된다.
 *
 * 상대 호실까지 적는 이유. 이사는 두 행에 걸친 하나의 사건인데 행 정렬은 호실번호 고정이라
 * (:roomNo 정렬) 506호와 508호 사이에 507호가 낀다. 두 막대를 선으로 이을 수도 없다(가이드
 * 미등재). 게다가 범위가 이사일을 안 물면 한쪽 막대는 아예 안 선다. 어느 막대 하나만 봐도
 * 어디로 갔는지·어디서 왔는지 알아야 그 사건이 화면에서 사라지지 않는다.
 *
 * **조각을 따로 내는 이유**(2026-08-20). 종전에는 이 셋을 한 문자열로 이어 화면이 막대 안에서
 * sticky 로 들고 있었다. 그러면 트랙을 아무리 끌어도 "7/1 506호에서 이사"가 화면 왼쪽에 계속
 * 붙어 따라온다 — 8월 말을 보고 있는데 7/1 이 눈앞에 있다(운영자 신고 2026-08-20). 사건은
 * 날짜에 일어나므로 문구도 그 날짜 칸에 있어야 한다. 감쇠는 색이 아니라 **위치**로 한다
 * (§03 이 밴드 위 글자를 --ink-2 로 못박았고, 실측상 --ink-s 는 막대 위에서 AA 미달이다).
 *
 * 역전(reversed)은 조각을 안 낸다. 기하는 두 날짜를 뒤집어 그리는데(assemble 의 from/to swap)
 * 문구는 원본 날짜를 읽으므로, 문구를 날짜 칸에 못 박으면 8/10 칸 위에 "9/20 입실"이 앉는다.
 * 그 방을 9/20 에 광고에 올리면 실제 손실이다. 역전은 충돌 줄이 따로 말한다.
 */
type BarLabels = { label: string; startLabel: string | null; endLabel: string | null; stateLabel: string | null }

function barLabels(bar: { startsInRange: boolean; endsInRange: boolean; openEnded: boolean; reversed: boolean; movedFromRoomNo: string | null; movedToRoomNo: string | null; stayFrom: string | null; stayTo: string | null }): BarLabels {
  const startLabel = bar.movedFromRoomNo
    ? moveDateLabel(bar.stayFrom, { roomNo: bar.movedFromRoomNo, dir: 'from' })
    : moveInDateLabel(bar.stayFrom)
  const endLabel = bar.movedToRoomNo
    ? moveDateLabel(bar.stayTo, { roomNo: bar.movedToRoomNo, dir: 'to' })
    : checkoutDateLabel(bar.stayTo)
  const parts: string[] = []
  if (bar.startsInRange && startLabel) parts.push(startLabel)
  if (bar.endsInRange && endLabel) parts.push(endLabel)
  // 이 한 문자열은 종전과 한 글자도 다르지 않다 — title·aria·회귀 160 이 이 값을 딛는다.
  const label = parts.length > 0 ? parts.join(' · ')
    : bar.openEnded ? '퇴실일 미정'
      : endLabel ?? '퇴실일 미정'
  const pinned = !bar.reversed
  const start = pinned && bar.startsInRange ? startLabel : null
  const end = pinned && bar.endsInRange ? endLabel : null
  return { label, startLabel: start, endLabel: end, stateLabel: start || end ? null : label }
}

/**
 * 작업끼리만 층을 가른다 — **거주 packLanes 와 다른 풀이다.**
 *
 * 같은 풀에 넣으면 하루짜리 청소 하나가 그 방 행 높이를 통째로 한 단(36px) 늘려, 행 높이가
 * 데이터에 따라 들쭉날쭉해진다. 층이 갈리는 경우는 하나뿐이다 — 같은 방 같은 날 청소가 둘
 * (자동 생성 퇴실 청소의 중복 방지는 CHECKOUT 사유만 보므로 도배 후 청소와 같은 날이 될 수 있다).
 * 안 가르면 하나가 다른 하나를 덮어 두 건이 한 건으로 보인다.
 */
export function packWorkLanes(works: MoveWork[]): number {
  const laneEnd: number[] = []
  for (const w of [...works].sort((x, y) => x.day - y.day)) {
    let lane = laneEnd.findIndex(end => end < w.day)
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(w.day) }
    else laneEnd[lane] = w.day
    w.lane = lane
  }
  return laneEnd.length
}

/** 겹치지 않는 막대끼리 같은 층에 앉힌다. 같은 날 퇴실·입주는 한 칸을 함께 쓰므로 층이 갈린다. */
function packLanes(bars: MoveBar[]): number {
  const laneEnd: number[] = []
  for (const b of [...bars].sort((x, y) => x.startDay - y.startDay || x.endDay - y.endDay)) {
    let lane = laneEnd.findIndex(end => end < b.startDay)
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(b.endDay) }
    else laneEnd[lane] = b.endDay
    b.lane = lane
  }
  return Math.max(laneEnd.length, 1)
}

/**
 * 행 생존 술어 — 막대도 작업도 없으면 행이 아니다.
 *
 * 조립(assemble)과 화면 축 필터(filterMoveRows)가 **같은 술어**를 부른다. 화면이 "작업을
 * 걷어낸 행이 남는가"를 자기 식으로 다시 적으면 그 식이 두 번째 진실이 되어, 행 생성
 * 규칙이 바뀔 때 화면만 옛 규칙에 남는다.
 */
export const moveRowSurvives = (row: { bars: readonly unknown[]; works: readonly unknown[] }): boolean =>
  row.bars.length > 0 || row.works.length > 0

/** 축 필터 — 캘린더가 무엇을 보여줄지. 종목 필터(1단계)가 붙어도 이 축은 그대로다. */
export type MoveAxis = 'all' | 'moves' | 'works'

/**
 * 축 필터 적용 — 클라이언트가 부른다(서버 왕복 없음 — 토글 한 번에 페이지 재조회 금지).
 *
 * '전체'는 원본 배열 그대로다(참조 안정 — memo 아래에서 불필요한 재렌더를 안 만든다).
 * '입퇴실'은 작업을 걷어낸 뒤에도 서는 행만 남긴다 — 생존 판정은 조립과 같은 moveRowSurvives.
 *   작업 레인 수는 팩을 다시 돌려 센다(서버가 센 workLaneCount 는 걷기 전의 수다).
 * '작업'은 작업이 있는 행만 남긴다. **거주 막대는 그대로 둔다**(운영자 확정 2026-08-21) —
 *   막대가 남아야 공실 캡션·겹침 밴드·꼬리가 근거를 잃지 않고, 그 작업이 공실 회전의
 *   어느 자리에 서는지가 보인다.
 * 남기는 행은 행 객체 참조를 그대로 쓴다 — 원본은 어느 축에서도 변조하지 않는다.
 */
export function filterMoveRows(rows: MoveCalendarRow[], axis: MoveAxis): MoveCalendarRow[] {
  if (axis === 'all') return rows
  if (axis === 'works') return rows.filter(r => r.works.length > 0)
  return rows
    .filter(r => moveRowSurvives({ bars: r.bars, works: [] }))
    .map(r => {
      if (r.works.length === 0) return r
      const kept: MoveWork[] = []
      return { ...r, works: kept, workLaneCount: packWorkLanes(kept) }
    })
}

/** 날짜 번호 집합을 연속 구간으로 접는다. */
function toSpans(days: Set<number>, upTo: number): MoveDaySpan[] {
  const out: MoveDaySpan[] = []
  let start: number | null = null
  for (let d = 1; d <= upTo + 1; d++) {
    const on = d <= upTo && days.has(d)
    if (on && start == null) start = d
    if (!on && start != null) { out.push({ startDay: start, endDay: d - 1 }); start = null }
  }
  return out
}

/**
 * 범위 한 벌의 기하 — 월 창이든 연속 창이든 같은 코드가 그린다.
 *
 * @param changed 그 범위에 입주·퇴실·예약 시작이 있는 계약. 어느 방이 행이 되는지를 정한다.
 * @param context 그 방들의 점유 계약 전부. 행은 안 늘리고 막대만 늘린다 — 관통 점유를 함께
 *                그려야 그 위에 얹힌 예약이 충돌로 보이고, 연속 트랙에서 점유 띠가 안 끊긴다.
 * @param order   행 정렬. 한 달 창은 첫 변동일이 곧 그 달의 이야기 순서지만, 여러 달을 잇는
 *                트랙에서는 그 키가 의미를 잃어(같은 방이 여러 달에 걸쳐 여러 번 바뀐다) 호실번호로 센다.
 * @param acks    유효한 확인된 겹침. 조회가 넘긴다 — 조립은 DB 를 못 보고, 확인 여부는 사실이지 계산이 아니다.
 * @param works   그 범위의 작업(청소). acks 와 **같은 문법**으로 조회가 넘긴다(순수 함수 규약).
 *                bars·events·firstChangeDay 어디에도 안 들어간다 — 위 MoveWork 머리 주석.
 */
function assemble(input: {
  from: string
  to: string
  today: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
  order: 'firstChange' | 'roomNo'
  acks: MoveOverlapAck[]
  works: MoveWorkInput[]
}): { days: number; todayDay: number | null; rows: MoveCalendarRow[]; events: MoveEvent[]; conflicts: MoveConflict[] } {
  const { today, order } = input
  const first = input.from
  const last = input.to
  const days = daysBetween(first, last) + 1
  const dayNo = (ymd: string): number => daysBetween(first, ymd) + 1
  const ymdOfDay = (day: number): string => addDays(first, day - 1)

  // 계약을 방별 체류 조각으로 먼저 편다 — 이 아래로는 계약이 아니라 조각이 단위다.
  const changedSlices = input.changed.flatMap(l => slicesOf(l).map(s => ({ lease: l, slice: s })))
  const contextSlices = input.context.flatMap(l => slicesOf(l).map(s => ({ lease: l, slice: s })))

  // 행이 되는 방 — 그 범위에 **실제로** 입주·이사·퇴실이 있는 방만. 관통 점유는 행을 만들지 않는다.
  //
  // 조회는 세 날짜 중 하나만 창에 걸려도 가져오는 과대근사다(퇴실의 진짜 날짜가 moveOutDate 인지
  // expectedMoveOut 인지는 한 줄의 SQL 조건으로 못 적는다 — 퇴실 완료는 실제일이 이긴다).
  // 그 선을 여기서 한 번만 긋는다. 퇴실 예정일은 8/31 인데 실제로는 9/2 에 나간 계약처럼,
  // 조회에는 걸리지만 이 범위의 변동은 아닌 건이 빈 행으로 서는 것을 막는다.
  const changedIn = (s: StaySlice): boolean =>
    (!!s.from && s.from >= first && s.from <= last) || (!!s.to && s.to >= first && s.to <= last)
  const roomIds = new Set(changedSlices.filter(x => changedIn(x.slice)).map(x => x.slice.roomId))

  // ── 그날 그 방에 사람이 있었는가 ──
  //
  // 조각 전부를 본다(변동분 + 점유 맥락). 조회가 **작업이 있는 방의 점유 계약도 함께** 실어
  // 주므로, 행이 아닌 방도 여기서 판정할 수 있다. 날짜가 하나도 없는 조각은 아무 날도 안 덮는
  // 것으로 친다 — 열린 양끝으로 읽으면 입주일 없는 예약 하나가 그 방을 영원히 점유로 만든다.
  const allSlices = [...changedSlices, ...contextSlices]
  const coversDay = (sl: StaySlice, d: string): boolean => {
    const reversed = !!sl.from && !!sl.to && sl.from > sl.to
    const f = reversed ? sl.to : sl.from
    const t = reversed ? sl.from : sl.to
    if (!f && !t) return false
    return (!f || f <= d) && (!t || t >= d)
  }
  const occupiedOn = (roomId: string, d: string): boolean =>
    allSlices.some(x => x.slice.roomId === roomId && coversDay(x.slice, d))

  // ── 작업이 행을 만드는 자리 ──
  //
  // **공실 작업은 행을 만든다** — 그 방이 언제 다시 쓸 수 있게 되는지가 이 화면의 질문이다.
  // **거주 중 작업은 행을 안 만든다** — 50실에서 잡무까지 행이 되면 캘린더가 잡무 목록이 된다.
  //   이미 행이 있는 방에는 그대로 얹힌다(아래 rowWorks 는 점유 여부를 안 가린다).
  // **공실 집계 제외 방은 비어 있어도 행을 안 만든다** — 창고·사무실은 세를 놓는 방이 아니라
  //   비어 있는 것이 정상이다. 거기 청소가 잡혔다고 행을 세우면 그 행이 곧 거짓 입주 가능
  //   신호가 된다(실데이터 601호 옥탑 창고, lib/vacancy isVacancyExcluded 와 같은 선).
  const worksInRange = input.works.filter(w => w.date >= first && w.date <= last)
  for (const w of worksInRange) {
    if (w.vacancyExcluded || roomIds.has(w.roomId)) continue
    if (!occupiedOn(w.roomId, w.date)) roomIds.add(w.roomId)
  }

  // 막대가 되는 조각 — 변동분 + 그 방들의 점유 조각. 같은 조각이 양쪽에 있으면 한 번만.
  const byId = new Map<string, { lease: MoveCalendarLease; slice: StaySlice }>()
  for (const x of changedSlices) if (roomIds.has(x.slice.roomId)) byId.set(x.slice.id, x)
  for (const x of contextSlices) if (roomIds.has(x.slice.roomId)) byId.set(x.slice.id, x)

  const perRoom = new Map<string, { roomId: string; roomNo: string; slices: { lease: MoveCalendarLease; slice: StaySlice }[] }>()
  for (const x of byId.values()) {
    const g = perRoom.get(x.slice.roomId)
    if (g) g.slices.push(x)
    else perRoom.set(x.slice.roomId, { roomId: x.slice.roomId, roomNo: x.slice.roomNo, slices: [x] })
  }
  // 계약이 한 건도 없는 빈 방에 청소만 잡힌 자리 — 위에서 roomIds 에 들었어도 조각이 없어
  // perRoom 에는 안 선다. 호실번호는 작업이 들고 온다(조회가 room 조인을 안 하는 대신).
  for (const w of worksInRange) {
    if (!roomIds.has(w.roomId) || perRoom.has(w.roomId)) continue
    perRoom.set(w.roomId, { roomId: w.roomId, roomNo: w.roomNo, slices: [] })
  }

  const rows: MoveCalendarRow[] = []
  const allConflicts: MoveConflict[] = []
  const events: MoveEvent[] = []

  for (const g of perRoom.values()) {
    const bars: MoveBar[] = []
    const barLease = new Map<string, MoveCalendarLease>()

    for (const { lease: l, slice: sl } of g.slices) {
      const rawFrom = sl.from
      const rawTo = sl.to
      // 날짜 역전은 데이터 사고다. 기하는 뒤집힌 채로 두지 않고 두 날 사이를 칠해 눈에 세운다.
      const reversed = !!rawFrom && !!rawTo && rawFrom > rawTo
      const from = reversed ? rawTo : rawFrom
      const to = reversed ? rawFrom : rawTo
      // 범위와 겹치지 않는 조각은 이 트랙의 막대가 아니다(범위 밖 예약 등 — 꼬리가 따로 말한다).
      if ((to && to < first) || (from && from > last)) continue

      const startsInRange = !!from && from >= first && from <= last
      const endsInRange = !!to && to >= first && to <= last
      const bar: MoveBar = {
        id: sl.id,
        leaseId: l.id,
        tenantId: l.tenantId,
        tenantName: l.tenantName,
        kind: l.status === 'RESERVED' ? 'reserved' : 'resident',
        planned: sl.id.startsWith('plan-'),
        movedFromRoomNo: sl.movedFromRoomNo,
        movedToRoomNo: sl.movedToRoomNo,
        lane: 0,
        startDay: startsInRange ? dayNo(from!) : 1,
        endDay: endsInRange ? dayNo(to!) : days,
        clippedStart: !from || from < first,
        clippedEnd: !to || to > last,
        openEnded: !rawTo,
        startsInRange,
        endsInRange,
        label: '',
        startLabel: null,
        endLabel: null,
        stateLabel: null,
        stayFrom: rawFrom,
        stayTo: rawTo,
        conflicted: false,
      }
      Object.assign(bar, barLabels({ ...bar, reversed }))
      // 예정 막대는 글자에 '예정'을 단다 — 색(대기 톤)은 예약과 공유하므로 구분은 글자 몫이다.
      if (bar.planned) {
        if (bar.startLabel) bar.startLabel = `${bar.startLabel} 예정`
        else if (bar.stateLabel) bar.stateLabel = `${bar.stateLabel} · 이사 예정`
        else bar.stateLabel = '이사 예정'
      }
      bars.push(bar)
      barLease.set(bar.id, l)

      if (startsInRange) events.push({ day: bar.startDay, date: ymdOfDay(bar.startDay), type: 'in', moved: !!sl.movedFromRoomNo, otherRoomNo: sl.movedFromRoomNo, barId: bar.id, roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })
      if (endsInRange) events.push({ day: bar.endDay, date: ymdOfDay(bar.endDay), type: 'out', moved: !!sl.movedToRoomNo, otherRoomNo: sl.movedToRoomNo, barId: bar.id, roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })

      if (reversed) {
        bar.conflicted = true
        allConflicts.push({
          kind: 'reversed', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId,
          text: `${fmtRoomNo(g.roomNo)} ${l.tenantName}님 계약의 입주일이 퇴실일보다 뒤입니다.`,
          acked: false, ackId: null, pair: null,
        })
      }
    }

    // 막대도 작업도 없으면 행이 아니다. 작업만 있는 빈 방은 남긴다 — 그 방이 언제 다시
    // 쓸 수 있게 되는지가 이 행이 답하는 유일한 질문이다. 판정은 화면 축 필터와 같은
    // 술어(moveRowSurvives)다 — 두 자리가 각자 적으면 규칙이 바뀔 때 한쪽만 남는다.
    const rowWorks = worksInRange.filter(w => w.roomId === g.roomId)
    if (!moveRowSurvives({ bars, works: rowWorks })) continue

    // ── 충돌 ── 방을 잡고 있는 계약끼리만 본다. 퇴실 완료 계약은 방을 잡지 않으므로
    // (lib/roomAssignment roomAssignmentBlockReason 의 같은 선) 같은 날 인수인계는 사고가 아니다.
    const holding = bars.filter(b => (OCCUPYING_STATUSES as string[]).includes(barLease.get(b.id)!.status))
    const overlapDays = new Set<number>()
    const ackedDays = new Set<number>()
    const rowConflicts: MoveConflict[] = []
    for (let i = 0; i < holding.length; i++) {
      for (let j = i + 1; j < holding.length; j++) {
        const a = holding[i], b = holding[j]
        // 같은 계약의 두 조각은 같은 사람이다 — 나갔다 같은 방으로 돌아온 것을 겹침이라 부르지 않는다.
        if (a.leaseId === b.leaseId) continue
        const sa = { moveIn: a.stayFrom, moveOut: a.stayTo }
        const sb = { moveIn: b.stayFrom, moveOut: b.stayTo }
        if (!occupancyOverlaps(sa, sb)) continue
        // 당일 회전(앞이 나가는 그날 뒤가 들어온다)은 사고가 아니다 — 같은 칸에 선 두 막대가
        // 층으로 갈려 그 회전을 그대로 말한다. 빨간 밴드도 요약 줄도 세우지 않는다(2026-08-19 개정).
        if (isSameDayTurnover(sa, sb)) continue
        const lo = Math.max(a.startDay, b.startDay)
        const hi = Math.min(a.endDay, b.endDay)
        // 무기한 점유 위에 얹힌 예약은 겹침의 특수형이다 — 손봐야 할 곳이 예약이 아니라
        // 거주의 빈 퇴실일이라 문구도 진입 대상도 다르다(roomAssignmentDenial 과 같은 처방).
        const openResident = [a, b].find(x => x.kind === 'resident' && x.openEnded)
        const reserved = [a, b].find(x => x.kind === 'reserved')
        if (openResident && reserved && openResident !== reserved) {
          a.conflicted = true
          b.conflicted = true
          for (let d = lo; d <= hi; d++) overlapDays.add(d)
          rowConflicts.push({
            kind: 'indefinite', roomId: g.roomId, roomNo: g.roomNo, leaseId: openResident.leaseId, tenantId: openResident.tenantId,
            text: `${fmtRoomNo(g.roomNo)} ${openResident.tenantName}님 퇴실일이 미정인데 ${reserved.tenantName}님 입실 예약이 잡혀 있습니다.`,
            acked: false, ackId: null, pair: null,
          })
          continue
        }
        // 확인된 겹침인가 — 지금 구간이 확인 구간 안이어야 한다(벗어나면 자동 실효라 다시 빨강이다).
        const ack = findOverlapAck(input.acks, a.leaseId, b.leaseId, occupancyOverlapSpan(sa, sb))
        if (!ack) { a.conflicted = true; b.conflicted = true }
        for (let d = lo; d <= hi; d++) (ack ? ackedDays : overlapDays).add(d)
        const later = a.startDay >= b.startDay ? a : b
        const [front, back] = !a.stayFrom ? [a, b] : !b.stayFrom ? [b, a] : (a.stayFrom <= b.stayFrom ? [a, b] : [b, a])
        const when = `${fmtMD(ymdOfDay(lo))}~${fmtMD(ymdOfDay(hi))}`
        rowConflicts.push({
          kind: 'overlap', roomId: g.roomId, roomNo: g.roomNo, leaseId: later.leaseId, tenantId: later.tenantId,
          text: ack
            ? `${fmtRoomNo(g.roomNo)} ${a.tenantName}·${b.tenantName} ${when} 겹침 확인됨`
            : `${fmtRoomNo(g.roomNo)} ${a.tenantName}·${b.tenantName} 체류가 ${when} 겹칩니다.`,
          acked: !!ack,
          ackId: ack?.id ?? null,
          pair: { frontLeaseTermId: front.leaseId, backLeaseTermId: back.leaseId },
        })
      }
    }
    allConflicts.push(...rowConflicts)

    const laneCount = packLanes(bars)

    // ── 작업 레인 ── 거주와 **다른 배열 · 다른 레인 풀**이다.
    //
    // 자리가 여기인 이유. 충돌 루프가 이미 끝나 판정 대상(holding)이 안 변하고, 바로 아래
    // covered 루프 전이라 **작업 날짜가 공백 계산에 절대 못 섞인다.** 섞이면 하루짜리 청소가
    // 공실 구간을 둘로 쪼개 'N일 공실' 캡션이 통째로 거짓이 된다.
    const works: MoveWork[] = rowWorks
      .map(w => ({
        id: w.id,
        day: dayNo(w.date),
        date: w.date,
        // 지연은 사실이 아니라 계산이라 조립이 낸다. 예정일 **당일은 아직 지연이 아니다** —
        // 그날 하기로 한 일이라, 아침에 여는 화면이 오늘 할 일을 이미 늦었다고 말하면 안 된다.
        status: w.done ? 'done' as const : w.date < today ? 'overdue' as const : 'planned' as const,
        kindLabel: w.kindLabel,
        performerLabel: w.performerLabel,
        occupied: occupiedOn(g.roomId, w.date),
        lane: 0,
      }))
      .sort((a, b) => a.day - b.day)
    const workLaneCount = packWorkLanes(works)

    // ── 공백 ── 어느 층에도 막대가 없는 날. 캡션 'N일 공실'이 붙는 자리다.
    // **작업은 여기 안 들어간다**(바로 위 주석).
    const covered = new Set<number>()
    for (const b of bars) for (let d = b.startDay; d <= b.endDay; d++) covered.add(d)
    const free = new Set<number>()
    for (let d = 1; d <= days; d++) if (!covered.has(d)) free.add(d)
    const gaps = toSpans(free, days).map(s => ({ ...s, days: s.endDay - s.startDay + 1 }))

    // ── 꼬리 ── 범위 안에 퇴실이 있는 방인데 다음 사람이 트랙 밖이면, 그 사실을 한 줄로.
    // 연속 뷰에서 다음 달이 트랙 안에 들어오면 그 예약은 막대가 되므로 이 줄은 저절로 사라진다.
    //
    // 여기만은 계약이 단위다 — 다음 차례를 세우는 질문이라 **지금 이 방을 잡고 있는 계약**만 본다.
    // 옛 구간으로 이 행에 얹힌 계약(이미 다른 방으로 이사한 사람)은 이 방의 대기열이 아니다.
    const holdingLeases = [...new Map(g.slices.map(x => [x.lease.id, x.lease])).values()]
      .filter(l => l.roomId === g.roomId && (OCCUPYING_STATUSES as string[]).includes(l.status))
    const nextUp = roomReservationQueue(holdingLeases, primaryRoomLease(holdingLeases))
      .find(l => !!l.moveInDate && l.moveInDate > last)
    const hasExit = bars.some(b => b.endsInRange)
    // 문구의 날짜는 moveInSubText 정본이 만든다 — 이름은 그 뒤에 붙인다(reservationSubText 와 같은 ' · ' 이음).
    const tail = hasExit && nextUp ? `${moveInSubText(nextUp.moveInDate)} · ${nextUp.tenantName}` : null

    const changeDays = bars.flatMap(b => [b.startsInRange ? b.startDay : null, b.endsInRange ? b.endDay : null]).filter((d): d is number => d != null)
    rows.push({
      roomId: g.roomId,
      roomNo: g.roomNo,
      firstChangeDay: changeDays.length > 0 ? Math.min(...changeDays) : days + 1,
      laneCount,
      bars: bars.sort((a, b) => a.lane - b.lane || a.startDay - b.startDay),
      works,
      workLaneCount,
      gaps,
      // 확인 전 겹침이 이긴다 — 같은 날이 두 쌍에 걸려 있으면 아직 답하지 않은 쪽 색을 세운다.
      overlaps: [
        ...toSpans(overlapDays, days).map(s => ({ ...s, acked: false })),
        ...toSpans(new Set([...ackedDays].filter(d => !overlapDays.has(d))), days).map(s => ({ ...s, acked: true })),
      ].sort((x, y) => x.startDay - y.startDay),
      conflicts: rowConflicts.concat(allConflicts.filter(c => c.kind === 'reversed' && c.roomId === g.roomId)),
      tail,
      tailLeaseId: nextUp?.id ?? null,
      tailTenantId: nextUp?.tenantId ?? null,
    })
  }

  const byRoomNo = (a: MoveCalendarRow, b: MoveCalendarRow) => (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0)
  rows.sort(order === 'roomNo' ? byRoomNo : (a, b) => a.firstChangeDay - b.firstChangeDay || byRoomNo(a, b))
  // 날짜 오름차순, 같은 날은 퇴실 먼저(방이 비어야 다음 사람이 들어온다), 그다음 호실번호.
  events.sort((a, b) => a.day - b.day || (a.type === b.type ? 0 : a.type === 'out' ? -1 : 1) || (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0))

  return {
    days,
    todayDay: today >= first && today <= last ? dayNo(today) : null,
    rows,
    events,
    conflicts: allConflicts,
  }
}

/**
 * 한 달 창 한 벌 — 홈 '이달 입퇴실 N건'이 딛는 수의 정본이다.
 *
 * @param today KST 'YYYY-MM-DD'. 보고 있는 달과 같은 달일 때만 오늘 표시가 선다.
 */
export function buildMoveCalendar(input: {
  month: string
  today: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
  acks?: MoveOverlapAck[]
  works?: MoveWorkInput[]
}): MoveCalendarMonth {
  const { month } = input
  const dim = daysInMonth(month)
  const r = assemble({ from: `${month}-01`, to: monthLastDay(month), today: input.today, changed: input.changed, context: input.context, order: 'firstChange', acks: input.acks ?? [], works: input.works ?? [] })
  return {
    month,
    daysInMonth: dim,
    todayDay: r.todayDay,
    rows: r.rows,
    events: r.events,
    conflicts: r.conflicts,
    eventCount: r.events.length,
  }
}

/**
 * 연속 창 한 벌 — 여러 달을 이어 붙인 하나의 트랙(2026-08-17 운영자 오더).
 *
 * 범위의 경계(from·to)와 그 밖의 사실(beyond·canExtendPast)은 조회가 정한다. 이 함수는
 * 순수 함수라 스스로 DB 를 못 보고, 경계 계산을 여기 두면 조회가 두 번 필요해진다.
 */
export function buildMoveRange(input: {
  from: string
  to: string
  today: string
  focusMonth: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
  beyond: { count: number; firstDate: string } | null
  canExtendPast: boolean
  acks?: MoveOverlapAck[]
  works?: MoveWorkInput[]
}): MoveCalendarRange {
  const { from, to, today, focusMonth } = input
  const r = assemble({ from, to, today, changed: input.changed, context: input.context, order: 'roomNo', acks: input.acks ?? [], works: input.works ?? [] })

  const months: MoveRangeMonth[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
    const startDay = Math.max(1, daysBetween(from, `${m}-01`) + 1)
    const endDay = Math.min(r.days, daysBetween(from, monthLastDay(m)) + 1)
    months.push({ month: m, startDay, days: endDay - startDay + 1, eventCount: r.events.filter(e => e.date.slice(0, 7) === m).length })
  }

  const horizon = addDays(today, UPCOMING_DAYS)
  return {
    from,
    to,
    days: r.days,
    today,
    todayDay: r.todayDay,
    focusMonth,
    focusEventCount: months.find(m => m.month === focusMonth)?.eventCount ?? 0,
    months,
    rows: r.rows,
    upcoming: r.events.filter(e => e.date >= today && e.date <= horizon),
    // 아직 안 끝난 청소만. 지난 예정(지연)도 넣는다 — '다가오는' 것은 아니지만 앞으로 해야 할
    // 일이고, 트랙에서는 표면이 상태를 말하지 않기로 했으므로 지연이 글자로 서는 자리가 여기다.
    upcomingWorks: r.rows.flatMap(row => row.works
      .filter(w => w.status !== 'done' && w.date <= horizon)
      .map(w => ({ ...w, roomId: row.roomId, roomNo: row.roomNo })))
      .sort((a, b) => a.day - b.day || (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0)),
    conflicts: r.conflicts,
    beyond: input.beyond,
    canExtendPast: input.canExtendPast,
  }
}
