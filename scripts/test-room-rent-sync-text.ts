// 방 이용료 저장의 계약 동기화 문장 진리표. 실행: npx tsx scripts/test-room-rent-sync-text.ts
//
// 승인 계획 문장 그대로인지 고정한다(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 호실·이름·금액은 실제 값이다.
import { rentSyncDialogCopy, rentSyncToastText, rentSyncUndoText, rentDriftCaption } from '../lib/roomRentSyncText'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

eq('확인창 한 건(비거주)', rentSyncDialogCopy({ roomNo: '602', axis: 'nonResident', nextRent: 150000, differing: [{ name: '홍은주', rentAmount: 30000 }] }), {
  title: '602호 비거주 이용료를 홍은주 계약에도 적용할까요?',
  message: '홍은주 계약 이용료는 지금 30,000원입니다. 적용하면 이미 청구된 달은 그대로이고 기록이 없는 달부터 150,000원으로 청구됩니다. 특정 달부터 적용하려면 예약 가격변경을 쓰면 됩니다.',
  confirmLabel: '계약에 적용', altLabel: '호실만 저장',
})
eq('확인창: 기록 없는 지난 달·함께 바뀌는 계약을 미리 말한다', rentSyncDialogCopy({ roomNo: '602', axis: 'nonResident', nextRent: 150000, followers: 2, differing: [{ name: '홍은주', rentAmount: 30000, unrecordedPastMonths: 2 }] }).message,
  '홍은주 계약 이용료는 지금 30,000원입니다. 적용하면 이미 청구된 달은 그대로이고 기록이 없는 달부터 150,000원으로 청구됩니다. 기록이 없는 지난 달 2개도 새 금액으로 계산됩니다. 특정 달부터 적용하려면 예약 가격변경을 쓰면 됩니다. 기준가 그대로인 계약 2건은 함께 바뀝니다.')
eq('확인창 두 건 제목(비거주)', rentSyncDialogCopy({ roomNo: '602', axis: 'nonResident', nextRent: 150000, differing: [{ name: '홍은주', rentAmount: 30000 }, { name: '박둘', rentAmount: 20000 }] }).title, '602호 비거주 계약 2건에도 적용할까요?')
eq('확인창 두 건 본문', rentSyncDialogCopy({ roomNo: '602', axis: 'nonResident', nextRent: 150000, differing: [{ name: '홍은주', rentAmount: 30000 }, { name: '박둘', rentAmount: 20000 }] }).message.startsWith('지금 계약 이용료는 홍은주 30,000원, 박둘 20,000원입니다. 적용하면'), true)
eq('확인창 거주 축 같은 문형', rentSyncDialogCopy({ roomNo: '510', axis: 'resident', nextRent: 500000, differing: [{ name: '김협의', rentAmount: 450000 }] }).title, '510호 기본 이용료를 김협의 계약에도 적용할까요?')
eq('확인창 거주 여러 건', rentSyncDialogCopy({ roomNo: '510', axis: 'resident', nextRent: 500000, differing: [{ name: 'a', rentAmount: 1 }, { name: 'b', rentAmount: 2 }, { name: 'c', rentAmount: 3 }] }).title, '510호 거주 계약 3건에도 적용할까요?')
eq('확인창 여섯 건이면 다섯까지 + 외 1건', rentSyncDialogCopy({ roomNo: '510', axis: 'resident', nextRent: 9, differing: [1, 2, 3, 4, 5, 6].map(i => ({ name: `n${i}`, rentAmount: i })) }).message.includes('n5 5원 외 1건입니다.'), true)

eq('저장 토스트 한 건(첫 줄에 축)', rentSyncToastText({ roomNo: '602', nonResident: { next: 150000, leases: [{ name: '홍은주', from: 30000, to: 150000 }] } }),
  { message: '602호 비거주 이용료 저장.', detail: '홍은주 30,000원에서 150,000원으로' })
eq('저장 토스트 여러 건', rentSyncToastText({ roomNo: '606', resident: { next: 420000, leases: [{ name: '정기준', from: 400000, to: 420000 }, { name: '최협의', from: 380000, to: 420000 }] } }),
  { message: '606호 기본 이용료 저장.', detail: '계약 2건에도 420,000원 적용됨' })
eq('저장 토스트 두 축', rentSyncToastText({ roomNo: '606', resident: { next: 420000, leases: [{ name: 'a', from: 1, to: 2 }] }, nonResident: { next: 100000, leases: [{ name: 'b', from: 1, to: 2 }, { name: 'c', from: 1, to: 2 }] } }),
  { message: '606호 기본·비거주 이용료 저장.', detail: '계약 3건에도 적용됨' })
eq('적용취소 토스트 한 건', rentSyncUndoText([{ from: 150000, to: 30000 }]), '적용취소했습니다. 계약 이용료 30,000원')
eq('적용취소 토스트 여러 건', rentSyncUndoText([{ from: 1, to: 2 }, { from: 3, to: 4 }]), '적용취소했습니다. 계약 2건 이용료를 되돌렸습니다')
eq('호실 수정 폼 한 줄', rentDriftCaption(1, false), { text: '계약 1건이 이 금액과 다릅니다', actionLabel: '계약에 적용' })
eq('호실 수정 폼 한 줄(누른 뒤)', rentDriftCaption(1, true), { text: '저장하면 계약 1건에도 이 금액이 적용됩니다', actionLabel: '그대로 두기' })
{
  const all = JSON.stringify([
    rentSyncDialogCopy({ roomNo: '602', axis: 'nonResident', nextRent: 150000, differing: [{ name: '홍은주', rentAmount: 30000 }] }),
    rentSyncToastText({ roomNo: '602', nonResident: { next: 150000, leases: [{ name: '홍은주', from: 30000, to: 150000 }] } }),
    rentSyncUndoText([{ from: 1, to: 2 }]), rentDriftCaption(2, false), rentDriftCaption(2, true),
  ])
  eq('em dash·화살표·느낌표 없음', /[—→!]/.test(all), false)
}

if (fails.length) {
  console.log(`[방 이용료 동기화 문장] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.log('  ' + f)
  process.exit(1)
}
console.log(`[방 이용료 동기화 문장] 통과 ${pass} / 실패 0`)
