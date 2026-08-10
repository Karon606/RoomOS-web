// 외국인등록번호가 실린 계약서의 서명 링크 발급 확인창 정본 — 계약서 화면(ContractView)과
// 프리즘 계약서 파일 칸(ContractFilesPanel)이 같은 문안을 쓴다. 진입점이 둘인데 문안을 각자 두면
// 한쪽만 고쳐지고, 실제로 그렇게 갈렸던 자리가 이 파일 옆의 서명 요청 문자 본문이다.

import { confirmDialog } from '@/components/ui/ConfirmDialog'

/**
 * 등록번호가 실린 계약서면 한 번 묻는다. 없으면 묻지 않고 그대로 통과한다.
 *
 * 문자 한 통이 신원번호가 담긴 서류의 열쇠가 되는 순간이라, 번호를 누르기 전에 그 사실을 말한다.
 * 링크 자체의 방어는 따로 있다 — 생년월일 3회 한도(app/sign/[token]/actions)와 24시간 만료다.
 */
export function confirmForeignRegNoLink(hasForeignRegNo: boolean | undefined): Promise<boolean> {
  if (!hasForeignRegNo) return Promise.resolve(true)
  return confirmDialog({
    title: '이 계약서에는 외국인등록번호가 포함됩니다',
    message: '링크를 받은 사람은 생년월일 확인 후 번호가 적힌 계약서 전문을 볼 수 있습니다.\n'
      + '생년월일을 3번 틀리면 링크가 잠기고, 제출 전이라도 24시간 뒤 만료됩니다.\n'
      + '받는 번호가 본인 연락처가 맞는지 확인하고 보내 주세요.',
    level: 'caution', confirmLabel: '링크 만들기',
  })
}
