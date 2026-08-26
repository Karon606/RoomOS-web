// 인쇄본 조항의 페이지별 읽기 순서 실측 — 수동 실행용.
//   실행: npx tsx scripts/probe-contract-print-order.ts
//
// **verify 에 넣지 않는다.** 눈으로 보는 절차라 자동화가 안 되고, 결정적으로 로컬 크롬과
// 프로덕션 크로미움(@sparticuz/chromium)의 버전이 다를 수 있다. 그래서 이 프로브가 통과해도
// **프리뷰 배포에서 PDF 를 실제로 떠 보는 절차를 대신하지 못한다.**
//
// 무엇을 보나. 과중 계약(특약 다 붙인 것)을 A4 로 인쇄해 **절 번호가 나오는 순서**가 문서 순서와
// 같은지 본다. 종전 flex 2단은 페이지 경계에서 각 단이 독립 분절돼
// `p1 왼 1·2 / 오른 4, p2 왼 3 / 오른 5·6` 처럼 읽는 순서가 페이지를 오갔다(2026-08-26).
//
// 레이아웃을 만질 때만 돌린다. 순수 축(CSS 구조·DOM 순서)은 test-contract-clause-order 가 본다.
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContractPrintHtml } from '../lib/contractPrintHtml'
import { DEFAULT_SUB_LEASE_ADDENDUM } from '../lib/contract'

const SECTIONS = [
  { title: '1. 입실 계약', items: ['가나다'.repeat(40), '라마바'.repeat(40)] },
  { title: '2. 퇴실 및 환불', items: ['사아자'.repeat(40), '차카타'.repeat(40)] },
  { title: '3. 생활 수칙', items: ['파하가'.repeat(40), '나다라'.repeat(40)] },
  { title: '4. 강제 퇴실', items: ['마바사'.repeat(40)] },
]

const html = buildContractPrintHtml({
  template: { title: '입실 계약서', sections: SECTIONS, oathText: '상기 규칙을 숙지하였습니다.' },
  businessInfo: { name: '테스트', registrationNo: '', ceoName: '', address: '' },
  phone: null, contractNo: 'T-1',
  disposalConsent: { enabled: false, title: '', body: '', signLabel: '' },
  logoImageUrl: null, stampImageUrl: null, refundClauseInContract: false,
  tenant: { name: '홍길동', birthdate: null, foreignRegNo: null, gender: '남', job: null, primaryPhone: null },
  lease: { moveInDate: '2026-08-31', expectedMoveOut: null, rentAmount: 470000, depositAmount: 50000, cleaningFee: 20000, dueDay: null, roomNo: '404', registrationStatus: '' },
  subLeaseAddendum: DEFAULT_SUB_LEASE_ADDENDUM,
  roomScheduleText: '2026.08.31 ~ 2026.08.31 402호 · 2026.09.01부터 404호',
  smoking: '비흡연', emergencyContactText: '', signDate: '2026년 8월 26일',
  signatureName: '홍길동', signatureImageDataUrl: '', pretendardBase64: '',
} as never)

const f = join(tmpdir(), 'contract-probe.html')
writeFileSync(f, html)
console.log(`\n인쇄본 HTML: ${f}`)
console.log('크롬으로 열어 인쇄 미리보기(A4·여백 14mm)에서 절 번호가')
console.log('  페이지1 왼쪽 위에서 아래, 페이지1 오른쪽 위에서 아래, 그다음 페이지2')
console.log('순서로 나오는지 확인한다. 번호가 페이지를 오가면 실패다.')
console.log(`\n확인 뒤: rm "${f}"`)
