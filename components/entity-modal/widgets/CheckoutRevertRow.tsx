'use client'

// 퇴실 적용취소의 상시 진입점 — 수납 정보 '퇴실 정산' 우산 아래. 퇴실 완료 계약에만 선다.
//
// 왜 여기인가. 상태 전환 위젯(TenantStatusTransitions)에는 세울 수 없다. 그 위젯을 그리는 조회
// (getTenantDetail)가 CHECKED_OUT 계약을 안 싣고, 싣는 순간 primaryTenantLease 폴백이 죽은 계약을
// 집는다. 이용료 정산 카드가 같은 이유로 이 화면에 온 전례를 그대로 따른다.
//
// 왜 토스트가 없나. 퇴실 제출은 보증금 반환·이용료 환불을 먼저 적는다. 6초 되감기가 그 셋을 한꺼번에
// 되감아야 하는데 돈 되돌리기는 홈택스 안내가 붙는 별개 결정이라, 상태만 무르는 토스트는 가짜 적용취소다.
//
// 목적지(거주중 · 퇴실 예정)는 이 화면이 고르지 않는다. 서버 술어(lib/checkoutRevert)가 정하고
// 여기는 라벨만 받아 문장에 넣는다.

import { useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { RotateCcw } from '@/components/ui/RotateCcw'
import { confirmDialog, alertDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { roomNoWithI } from '@/lib/roomNo'
import { applyStatusTransition, getCheckoutRevertInfo } from '@/app/(app)/tenants/actions'

export function CheckoutRevertRow({
  leaseTermId, tenantId, tenantName, status, roomNo, canEdit, onChanged,
}: {
  leaseTermId: string
  tenantId?: string | null
  tenantName?: string | null
  status: string | null
  roomNo?: string | null
  canEdit: boolean
  onChanged?: () => void
}) {
  const [pending, startTransition] = useTransition()
  /**
   * 창을 여는 중 — 누른 뒤 확인창이 뜨기까지의 서버 왕복을 덮는다. 목적지·차단은 누른 그 순간의
   * 사실이라야 해서 미리 안 읽는다(자정을 넘기면 답이 바뀌고, 옆 카드에서 반환을 되돌리면 풀린다).
   */
  const [opening, setOpening] = useState(false)

  // 이름 없이는 확인창 제목도 서버 호출도 못 세운다 — 그럴 땐 눌러야 거절되는 버튼을 두지 않는다(§22).
  if (status !== 'CHECKED_OUT' || !canEdit || !tenantId || !tenantName) return null

  const subject = roomNo ? roomNoWithI(roomNo) : '이 계약이'

  const run = async () => {
    if (opening || pending) return
    setOpening(true)
    let info: Awaited<ReturnType<typeof getCheckoutRevertInfo>>
    try { info = await getCheckoutRevertInfo(leaseTermId) } finally { setOpening(false) }
    if (!info.ok) { pushToast('error', info.error); return }
    // 돈이 이미 움직인 계약 — 여기서 함께 되돌리지 않고 그 기록을 되돌릴 자리를 가리킨다.
    if (info.blocked) { await alertDialog(`${tenantName}님 · 퇴실을 적용취소할 수 없습니다`, info.blocked); return }
    // §14 주의 등급 — 막지 않고 무엇이 일어나는지 먼저 읽힌다. 되돌리지 않는 것도 여기서 말한다.
    const ok = await confirmDialog({
      title: `${tenantName}님 · 퇴실을 적용취소할까요?`,
      // 화면의 말로만 적는다. '걷다'는 저장소 주석에서 쓰는 말이지 운영자가 화면에서 배운 말이
      // 아니고, 호실에 걸어 두는 그 금액의 화면 이름은 호실 관리의 '예약 이용료'다.
      // 청소 쪽 명사도 기존 화면(퇴실 청소 예정일 칸)의 '퇴실 청소 예정'을 그대로 쓴다.
      message: `${subject} 다시 ${info.label}이 되고 퇴실일이 지워집니다. 잡힌 퇴실 청소 예정은 지웁니다. 끝난 청소·발급한 서류·호실에 적용된 예약 이용료는 되돌리지 않습니다.`,
      level: 'caution',
      confirmLabel: '퇴실 적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const release = trackSave()
      try {
        // toStatus 는 '거주계로 돌아간다'는 뜻일 뿐이다 — 어느 자리로 갈지는 서버가 같은 술어로
        // 다시 정해 덮어쓴다. 화면이 목적지를 고르면 두 자리의 답이 갈린다.
        const res = await applyStatusTransition({ leaseTermId, tenantId, toStatus: 'ACTIVE' })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('info', `${tenantName}님 · 퇴실을 적용취소했습니다 · ${info.label}으로 복귀`)
        if (res.notice) pushToast('info', res.notice)
        onChanged?.()
      } finally { release() }
    })
  }

  return (
    <div className="flex">
      {/* §16 진입점 2 원위치 — '적용취소' 단독이면 바로 위 두 카드(보증금 반환·이용료 환불)의
          적용취소와 갈린다. 무엇을 무르는지 명사를 붙인다. */}
      <Btn variant="subtle" size="sm" disabled={pending || opening} onClick={() => { void run() }}>
        <RotateCcw />
        퇴실 적용취소
      </Btn>
    </div>
  )
}
