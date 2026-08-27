// 지출과 방 작업이 같은 건인지 판정하는 정본 — 작업 완료·지출 저장·상시 줄·감지망이 같이 쓴다.
//
// 무엇을 푸는가(실측 2026-08-27, 413호). 07:30 에 지출 화면에서 두 방 시공비를 한 번에 넣었는데
// 작업 이력은 그 사실을 몰라 여전히 '예정'이었고, 거기서 완료 처리하니 같은 돈이 한 번 더 생겼다.
// 방 지출이 190,000원이 아니라 470,000원으로 부풀었다. 한 방향(작업 -> 지출)만 있고 반대가 없어서다.
//
// **네 축이다. 금액과 업체명은 일부러 뺐다.**
//   · 금액을 넣으면 413호 장판을 놓친다 — 실제 50,000원인데 작업 쪽에 140,000원으로 잘못 적혔다.
//     즉 금액이 갈린 쪽이 오히려 틀린 값이라, 금액 일치를 요구하면 **가장 나쁜 경우만 골라서 빠진다.**
//   · 업체명은 예정 작업에 아직 없는 칸이다(완료할 때 적는다). 넣으면 실측 4건 중 3건이 빠진다.
//     일치하면 확신을 높이는 근거로 화면에 적을 뿐, 판정 조건이 아니다.
//
// 실측 검산 — 미연결 지출 204건 x 작업 34건 = 6,936 조합에 걸어 4건 발화, 오탐 0건.
// 그 4건이 문제의 전부였다(413호 중복 2건 + 514호 미연결 2건).
//
// **종류를 정규식으로 박지 않는다.** 작업 종류는 영업장마다 자유 입력이라
// /장판|도배/ 같은 것을 정본에 올리면 멀티테넌트가 깨진다. 그 계약의 kind 문자열이
// 지출 글자에 들어 있는가로 묻는다(scripts/check-room-work-link.mjs 가 쓰는 그 방식).
//
// **자재는 후보가 아니다.** 자재는 살 때 이미 지출로 잡혔고 작업 완료가 만드는 것은 공임뿐이다.
// 자재가 작업에 안 걸린 것은 '중복'이 아니라 '연결 누락'이라 성질이 다르다(별건).
import { isLaborItem } from '@/lib/roomWorkCost'

export type MatchExpense = {
  roomId: string | null
  date: Date | string
  itemLabel: string | null
  detail: string | null
  roomWorkId: string | null
}
export type MatchWork = {
  roomId: string
  kind: string
  doneDate: Date | string | null
  scheduledDate: Date | string | null
}

const ymd = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)

/** 이 지출이 이 작업에 걸릴 만한가 — 걸려 있으면 후보가 아니다(이미 이어진 것은 물을 것이 없다). */
export function matchesWork(e: MatchExpense, w: MatchWork): boolean {
  if (e.roomWorkId) return false
  if (!e.roomId || e.roomId !== w.roomId) return false
  const wd = w.doneDate ?? w.scheduledDate
  if (!wd) return false
  // 시공은 하루다 — 같은 날만 본다. 넓혀도 실측에서 얻는 것이 없었고 자재가 새어 든다.
  if (ymd(e.date) !== ymd(wd)) return false
  if (!`${e.itemLabel ?? ''} ${e.detail ?? ''}`.includes(w.kind)) return false
  return isLaborItem(e.itemLabel, e.detail)
}
