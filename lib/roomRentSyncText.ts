// 방 이용료 저장의 계약 동기화 문장 정본(순수). 확인창·저장 토스트·적용취소 토스트·호실 수정 폼 한 줄. 승인 계획 문장 그대로다.
//
// 2026-10-27 운영자 승인 '추천대로'(홍은주 602호 사건). 값이 바뀌는 문장은 '~에서 ~으로' 문형이고 화살표를 쓰지 않는다(§29).
import { fmtRoomNo } from '@/lib/roomNo'
import { withParticle } from '@/lib/koParticle'

export type RentAxisKey = 'resident' | 'nonResident'
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const LIST_MAX = 5

/** 저장 전 확인창. 기준가와 다른 계약(협의가·기준가 없던 계약)에 새 금액을 적용할지 묻는다. */
export function rentSyncDialogCopy(p: {
  roomNo: string; axis: RentAxisKey; nextRent: number
  differing: { name: string; rentAmount: number; unrecordedPastMonths?: number }[]
  /** 기준가 그대로라 묻지 않고 함께 바뀌는 계약 수. */
  followers?: number
}): { title: string; message: string; confirmLabel: string; altLabel: string } {
  const R = fmtRoomNo(p.roomNo)
  const axisRent = p.axis === 'nonResident' ? '비거주 이용료' : '기본 이용료'
  const axisWord = p.axis === 'nonResident' ? '비거주' : '거주'
  // 기록 없는 지난 달(미납 등)도 락이 없어 새 금액으로 계산된다. 있을 때만 미리 말한다(독립 검수 권고 4).
  const past = p.differing.reduce((n, d) => n + (d.unrecordedPastMonths ?? 0), 0)
  const tail = [
    `적용하면 이미 청구된 달은 그대로이고 기록이 없는 달부터 ${withParticle(won(p.nextRent), '으로/로')} 청구됩니다.`,
    past > 0 ? `기록이 없는 지난 달 ${past}개도 새 금액으로 계산됩니다.` : null,
    '특정 달부터 적용하려면 예약 가격변경을 쓰면 됩니다.',
    (p.followers ?? 0) > 0 ? `기준가 그대로인 계약 ${p.followers}건은 함께 바뀝니다.` : null,
  ].filter(Boolean).join(' ')
  if (p.differing.length === 1) {
    const d = p.differing[0]
    return {
      title: `${R} ${withParticle(axisRent, '을/를')} ${d.name} 계약에도 적용할까요?`,
      message: `${d.name} 계약 이용료는 지금 ${won(d.rentAmount)}입니다. ${tail}`,
      confirmLabel: '계약에 적용', altLabel: '호실만 저장',
    }
  }
  const shown = p.differing.slice(0, LIST_MAX).map(d => `${d.name} ${won(d.rentAmount)}`).join(', ')
  const more = p.differing.length > LIST_MAX ? ` 외 ${p.differing.length - LIST_MAX}건` : ''
  return {
    title: `${R} ${axisWord} 계약 ${p.differing.length}건에도 적용할까요?`,
    message: `지금 계약 이용료는 ${shown}${more}입니다. ${tail}`,
    confirmLabel: '계약에 적용', altLabel: '호실만 저장',
  }
}

export type RentSyncSummaryLike = {
  roomNo: string
  resident?: { next: number; leases: { name: string; from: number; to: number }[] }
  nonResident?: { next: number; leases: { name: string; from: number; to: number }[] }
}

/** 저장 토스트. 계약 한 건이면 이름과 전후 금액, 여럿이면 건수(둘째 줄에 세 건까지). */
export function rentSyncToastText(s: RentSyncSummaryLike): { message: string; detail?: string } {
  const R = fmtRoomNo(s.roomNo)
  // 첫 줄은 어느 축을 저장했는지(독립 검수 권고 5), 둘째 줄은 계약 쪽. 토스트 글자 칸은 320px 에서 약 143px 이라
  // 금액을 첫 줄에도 적으면 4줄이 된다(실측). 새 금액은 둘째 줄에 한 번만 적어 §15 3줄 안에 둔다.
  const head = s.resident && s.nonResident ? `${R} 기본·비거주 이용료 저장.` : `${R} ${s.resident ? '기본' : '비거주'} 이용료 저장.`
  const leases = [...(s.resident?.leases ?? []), ...(s.nonResident?.leases ?? [])]
  if (leases.length === 1) {
    const l = leases[0]
    return { message: head, detail: `${l.name} ${won(l.from)}에서 ${withParticle(won(l.to), '으로/로')}` }
  }
  if (s.resident && s.nonResident) return { message: head, detail: `계약 ${leases.length}건에도 적용됨` }
  return { message: head, detail: `계약 ${leases.length}건에도 ${won((s.resident ?? s.nonResident)!.next)} 적용됨` }
}

/** 적용취소 토스트. leases 는 되돌린 계약(from 쓴 직후, to 되돌린 금액). */
export function rentSyncUndoText(leases: { from: number; to: number }[]): string {
  if (leases.length === 1) return `적용취소했습니다. 계약 이용료 ${won(leases[0].to)}`
  return `적용취소했습니다. 계약 ${leases.length}건 이용료를 되돌렸습니다`
}

/** 호실 수정 폼 이용료 칸 아래 한 줄(원위치). queued 는 '계약에 적용' 을 누른 뒤(저장하면 적용). */
export function rentDriftCaption(count: number, queued: boolean): { text: string; actionLabel: string } {
  return queued
    ? { text: `저장하면 계약 ${count}건에도 이 금액이 적용됩니다`, actionLabel: '그대로 두기' }
    : { text: `계약 ${count}건이 이 금액과 다릅니다`, actionLabel: '계약에 적용' }
}
