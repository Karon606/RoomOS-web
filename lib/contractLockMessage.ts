// 서명 잠금 안내 정본 — 화면과 서버가 **같은 문장**을 쓰게 한다.
//
// 왜 한 벌인가. 종전 문구는 "서명란의 X 버튼으로 지우면" 이라고 단수로 말했는데 잠금은 서명 네 칸
// OR 이라, 서명이 둘 있는 계약에서는 그 말대로 해도 안 풀렸다. 운영자는 그 화면을 보고 발급본을
// 지웠고 그것은 잠금과 무관한 조작이었다(긴급 신고 63cd1049). 안내가 **실제로 열려 있는 길**을
// 말하지 않으면 사람은 열려 있지도 않은 문을 민다.
//
// 이제 길이 둘이 될 수 있다. 폐기는 언제나 있고, 여러 판본 만들기가 켜진 영업장에는 '새 버전
// 작성' 이 더 있다. 꺼져 있는데 그 길을 말하면 없는 버튼을 찾게 되고, 켜져 있는데 안 말하면
// 폐기가 유일한 길이라는 거짓이 된다. 그래서 토글이 문장을 가른다.

/** 안내를 읽는 자리가 그 버튼과 같은 화면인가. 같은 화면이면 '위' 로 지목한다. */
export type LockHintWhere = 'here' | 'contractScreen'

const anchor = (where: LockHintWhere) => (where === 'here' ? "위 '이 계약서 폐기'" : "계약서 화면 툴바의 '이 계약서 폐기'")

const exitTail = (multiVersion: boolean, where: LockHintWhere) =>
  multiVersion
    ? `${anchor(where)} 로 이 버전을 폐기하고 다시 작성하거나, 내용이 다른 판본이 필요하면 그 옆 '새 버전 작성' 을 눌러 주세요.`
    : `${anchor(where)} 로 이 버전을 폐기하고 다시 작성한 뒤 서명을 다시 받아 주세요.`

const KEEP = '지금까지 받은 서명과 발급본은 기록으로 남습니다.'

/** 본문 편집 잠금 — 계약서 본문(조항)을 고치려 할 때. */
export function bodyLockMessage(multiVersion: boolean, where: LockHintWhere): string {
  return `서명이 완료된 계약서는 본문을 고칠 수 없습니다. 내용을 바꾸려면 ${exitTail(multiVersion, where)} ${KEEP}`
}

/** 표시값 잠금 — 정보 표의 값(성명 표기·금액 표기 등)을 고치려 할 때. */
export function fieldLockMessage(multiVersion: boolean, where: LockHintWhere): string {
  return `서명이 완료된 계약서라 표시값을 고칠 수 없습니다. 내용을 바꾸려면 ${exitTail(multiVersion, where)} ${KEEP}`
}

/** 계약일 잠금 — 서명이 끝난 뒤에는 계약일이 서명일로 확정된다. */
export function signDateLockMessage(multiVersion: boolean, where: LockHintWhere): string {
  return `서명이 끝난 계약서라 계약일은 고칠 수 없습니다. 날짜를 바꾸려면 ${exitTail(multiVersion, where)} ${KEEP}`
}
