// 입주자별 발급 서류 이력 — 세 모델에 흩어진 종이를 시간축 하나로 세우는 규칙 정본.
//
// 왜 필요한가. 발급본은 모델 셋에 나뉘어 산다(RentReceiptFile 이 kind 로 납부 확인서와 보증금
// 영수증을, ResidenceCertFile 이 실거주 확인서를). 그래서 "이 사람에게 언제 무엇이 나갔나"를
// 한 눈에 볼 자리가 없었다(운영자 2026-09-03).
//
// **계약서는 여기 안 온다.** 바로 위 계약서 파일 패널이 판본·폐기·구버전이라는 제 개념으로
// 이미 그 종이를 다룬다. 여기 다시 그리면 같은 파일이 두 자리에 보이고 두 표현이 갈라진다.
//
// 규칙과 조회를 가르는 이유는 docBundle 과 같다 — 규칙은 순수 함수라 회귀로 못 박고, 조회는
// 화면 옆에 둔다.

import { fmtRoomNo } from './roomNo'

/** 이 목록이 다루는 서류 — 계약서는 제외다(위 주석). */
export type DocHistoryType = 'rent' | 'deposit' | 'residence'

export const DOC_HISTORY_LABEL: Record<DocHistoryType, string> = {
  rent: '입실료 납부 확인서',
  deposit: '보증금 영수증',
  residence: '실거주 확인서',
}

export type DocHistoryFile = {
  id: string
  docType: DocHistoryType
  driveFileId: string
  /** 발행일. 이 목록의 정렬 축이다. */
  issuedAt: Date
  /** 발행번호 YYYYMMDD-NNN — 확인서·영수증만 갖는다. 실거주 확인서에는 없다. */
  receiptNo?: string | null
  /** 이 종이가 증명하는 납부의 귀속월 'YYYY-MM' — 납부 확인서만. 발행일과 다를 수 있다(선납). */
  targetMonth?: string | null
  /** 어느 계약의 종이인가 — 한 사람이 방을 둘 쓰면 행이 그것을 말해야 한다. */
  leaseTermId: string | null
  roomNo?: string | null
}

/**
 * 시간축 하나로 세운다 — 최신이 위다.
 *
 * 종류별로 묶지 않는 이유. 이 목록이 답하는 물음은 "언제 무엇이 나갔나"이고 그것은 원장이라
 * 시간축이 맞다. 종류별 최신본은 이미 서류 시트가 보여 준다.
 *
 * 같은 날 여러 장이면 발행번호가 큰 것이 나중이다. 번호가 없는 실거주 확인서끼리는 id 로
 * 갈라 **순서를 안정시킨다** — 정렬이 흔들리면 같은 화면을 두 번 열 때 줄이 뒤바뀐다.
 */
export function sortDocHistory(files: readonly DocHistoryFile[]): DocHistoryFile[] {
  return [...files].sort((a, b) => {
    const d = b.issuedAt.getTime() - a.issuedAt.getTime()
    if (d !== 0) return d
    const n = (b.receiptNo ?? '').localeCompare(a.receiptNo ?? '')
    if (n !== 0) return n
    return a.id.localeCompare(b.id)
  })
}

/**
 * 행 아래에 붙는 보조 문구 — 없으면 null.
 *
 * 납부 확인서는 **귀속월**을 말한다. 발행일만 있으면 선납 발급본(8월에 낸 9월분)을 다른 종이와
 * 구별할 수 없다. 귀속월이 없는 옛 발급본은 침묵한다 — 표시 문자열에서 되짚는 것은 추측이다.
 * 방 번호는 계약이 둘 이상일 때만 붙인다(하나뿐이면 겹말이다).
 */
export function docHistoryNote(f: DocHistoryFile, opts: { showRoom: boolean }): string | null {
  const parts: string[] = []
  // '호'는 fmtRoomNo 가 붙인다 — 숫자가 아닌 호실('사무실'·'옥탑방')에는 안 붙는다.
  if (opts.showRoom && f.roomNo) parts.push(fmtRoomNo(f.roomNo))
  if (f.docType === 'rent' && f.targetMonth) {
    const [y, m] = f.targetMonth.split('-')
    parts.push(`${Number(y)}년 ${Number(m)}월분`)
  }
  // 맨숫자 12자는 무엇의 번호인지 말하지 않는다. 종이가 'No.' 로 찍고(lib/rentReceiptPdf)
  // 형제 계약서 패널도 번호에 라벨을 붙인다(디자이너 지적 2026-09-03).
  if (f.receiptNo) parts.push(`No. ${f.receiptNo}`)
  return parts.join(' · ') || null
}
