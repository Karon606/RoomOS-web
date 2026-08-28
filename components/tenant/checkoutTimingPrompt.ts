'use client'

// "지금 퇴실 예정으로 둘까, 그날 되면 바뀌게 할까"를 묻는 자리 — 문답 정본.
//
// 왜 묻는가. 퇴실 예정은 '곧 나간다'는 뜻인데, 리드가 한 달이면 그 말이 한 달 내내 서 있게 된다.
// 522호는 넉 달을 그렇게 떠 있었다. 그렇다고 앱이 늘 미뤄 두면, 지금 당장 퇴실 예정으로 보고
// 싶은 운영자가 손으로 되돌릴 길이 필요해진다. 그래서 정할 사람에게 그 자리에서 묻는다.
//
// **전환일이 이미 지났으면 묻지 않는다.** 어느 쪽을 골라도 다음 크론이 바꾼다 — 답이 하나뿐인
// 물음은 방해다. 그 판정은 서버가 한다(리드가 영업장 설정이라 화면이 제 기본값으로 재면
// 적어 놓은 날과 실제가 갈린다).
//
// 두 갈래뿐이다(운영자 확정 2026-08-28). '거주중으로 두고 자동 전환도 안 함'이라는 셋째는
// 지금 요구에 없다 — 필요해지면 그때 칸을 하나 만든다.

import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { fmtDateKor } from '@/lib/fmtDate'

export type CheckoutTimingChoice = 'now' | 'auto' | null

export async function askCheckoutTiming(args: {
  tenantName: string
  moveOutYmd: string
  /** 자동으로 바뀌는 날 — 서버가 계약과 영업장 설정으로 계산한 값 */
  flipYmd: string
}): Promise<CheckoutTimingChoice> {
  const pick = await choiceDialog({
    title: `${args.tenantName}님을 지금 퇴실 예정으로 둘까요?`,
    message: `퇴실일은 ${fmtDateKor(args.moveOutYmd)}입니다. 아직 남아 있어서, 지금 바꾸면 그때까지 계속 퇴실 예정으로 보입니다.`
      + `\n\n거주중으로 두면 ${fmtDateKor(args.flipYmd)}에 앱이 알아서 퇴실 예정으로 바꿉니다. 그날부터 새 입실자를 찾고 청소를 잡으면 됩니다.`,
    level: 'caution',
    confirmLabel: '지금 퇴실 예정으로',
    altLabel: `${fmtDateKor(args.flipYmd)}에 자동으로`,
  })
  if (pick === 'confirm') return 'now'
  if (pick === 'alt') return 'auto'
  return null
}
