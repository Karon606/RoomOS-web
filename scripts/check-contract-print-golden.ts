// 계약서 종이 HTML 이 공용 브랜딩 조각을 실제로 쓰고, 표본 입력에서 바이트가 안 바뀌었는지 지키는 감지망. 읽기 전용, 위반이면 exit 1 (2026-10-26).
//
// 왜 필요한가. 계약서 종이의 머리띠·꼬리말·워드마크·쪽 번호 틀을 lib/printBrandHtml 로 옮겨 결산 보고서
// 종이와 함께 쓰게 했다(가이드 §26.2). 그 뒤로 위험은 두 방향이다.
//   ① 계약서가 공용 조각을 버리고 제 마크업으로 돌아간다. 두 종이 머리가 조용히 갈린다.
//   ② 보고서 쪽 필요로 공용 조각을 고치면 **법적 효력이 있는 계약서 종이도 같이 바뀐다.** 계약서는
//      서명 시점 본문을 박제해 다시 뽑는 종이라, 모르고 바뀌면 같은 계약의 종이가 발급 시점마다 다르다.
//
//   축 1. 표본 계약서 HTML 에 공용 조각 다섯(머리띠 CSS · 꼬리말 CSS · 워드마크 CSS · 워드마크 · 머리띠 마크업)과
//          사업자 꼬리말 마크업이 그대로 들어 있다. import 만 남기고 호출을 지우면 운다.
//   축 1-b. 소스가 조각을 **부른다.** 계약서·결산 보고서 빌더와 계약서 라우트의 구문 트리에서 조각 이름의 사용 횟수를
//          세고, 문자열 안에 머리띠·꼬리말 마크업이나 CSS 를 손으로 다시 쓴 흔적(class="doc-header" 등)이 없는지 본다.
//          같은 바이트의 마크업을 인라인으로 되돌리면 출력만으로는 못 가른다. 그러면 다음에 조각을 고칠 때 한쪽 종이만 바뀐다.
//   축 2. 표본 입력 세 벌의 계약서 HTML 과 계약서 쪽 번호 꼬리말 틀의 sha256 이 골든(scripts/golden/contract-print.json)과
//          같다. 골든은 공용 조각 추출 **전** 코드(885597ea)의 출력과 같은 값이다.
//
// 골든이 깨졌을 때. 계약서 종이를 일부러 바꾼 것이면(문안·조판 변경) 바뀐 종이를 눈으로 확인한 뒤
// `npx tsx scripts/check-contract-print-golden.ts --write` 로 골든을 다시 쓰고, 그 커밋에 이유를 적는다.
// 공용 조각을 보고서 때문에 고쳤는데 여기가 울었다면 계약서 종이가 같이 바뀐 것이다. 운영자에게 먼저 묻는다
// (계약서 작업 규칙, knowledge/domain-contracts.md 체크리스트).
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { buildContractPrintHtml, type PrintContractData } from '../lib/contractPrintHtml'
import { DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent } from '../lib/contract'
import {
  printBrandHeaderHtml, printBrandFootBizHtml, printPageNumberFooterTemplate,
  PRINT_BRAND_HEADER_CSS, PRINT_BRAND_FOOTER_CSS, PRINT_WORDMARK_CSS, PRINT_WORDMARK_HTML,
} from '../lib/printBrandHtml'

const GOLDEN = 'scripts/golden/contract-print.json'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 표본 셋. 머리띠·꼬리말이 갈라지는 갈래(로고·전화·사업자정보 유무, 동의서·추가 서류 꼬리말, 합본 행)를 나눠 덮는다.
const full: PrintContractData = {
  template: DEFAULT_CONTRACT_TEMPLATE,
  businessInfo: { name: '검사<영업장>&', registrationNo: '000-00-00000', ceoName: '검사대표', address: '검사 주소 1층' },
  phone: '010-0000-0000', contractNo: '20260810-001', logoImageUrl: PNG, stampImageUrl: PNG,
  refundClauseInContract: true, disposalConsent: resolveDisposalConsent({ enabled: true }), disposalSignatureImageDataUrl: PNG,
  registrationHead: { ko: '체류지 변경신고', en: 'Residence Change' },
  tenant: { name: '검사입실자', birthdate: '1990-01-01', foreignRegNo: null, gender: '남', job: '회사원', primaryPhone: '010-0000-0000' },
  lease: { moveInDate: '2026-08-01', expectedMoveOut: '2026-09-01', rentAmount: 450000, depositAmount: 200000, cleaningFee: 20000, dueDay: '1', roomNo: '520', registrationStatus: '미신고' },
  smoking: '비흡연', emergencyContactText: '검사보호자 / 010-0000-0000 / 부', signDate: '2026년 8월 10일', disposalSignDate: '2026년 8월 11일',
  signatureImageDataUrl: PNG, pretendardBase64: 'ZHVtbXk=',
  signDocuments: [{ key: 'x', title: '추가 서류', body: '첫 줄\n둘째 줄' }],
  documentSignatures: { x: { image: PNG, signedAt: '2026년 8월 12일' } },
}
const minimal: PrintContractData = {
  ...full,
  businessInfo: { name: '', registrationNo: '', ceoName: '', address: '' },
  phone: null, logoImageUrl: null, stampImageUrl: null, refundClauseInContract: false,
  disposalConsent: resolveDisposalConsent({ enabled: false }), disposalSignatureImageDataUrl: null,
  registrationHead: undefined, signDocuments: [], documentSignatures: undefined, pretendardBase64: '',
}
const merged: PrintContractData = {
  ...full,
  businessInfo: { name: '합본영업장', registrationNo: '', ceoName: '', address: '서울 어딘가 2층' },
  phone: '02-000-0000', logoImageUrl: null,
  subLeases: [{ roomNo: '521', rentAmount: 300000 }],
  signDocuments: [],
}
const samples: Record<string, PrintContractData> = { full, minimal, merged }

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const outputs: Record<string, string> = {}
for (const [k, d] of Object.entries(samples)) outputs[`contract:${k}`] = buildContractPrintHtml(d)
outputs['footer:14mm'] = printPageNumberFooterTemplate('ZHVtbXk=', '검사<영업장>&', 14)
outputs['footer:no-font'] = printPageNumberFooterTemplate('', '', 14)

const violations: string[] = []

// ── 축 1. 공용 조각을 실제로 쓰는가
const fullHtml = outputs['contract:full']
const issueHtml = `계약번호 <span class="num">No. ${full.contractNo}</span><br>\n        계약일 ${full.signDate}`
for (const [piece, what] of [
  [PRINT_BRAND_HEADER_CSS, '머리띠 CSS(PRINT_BRAND_HEADER_CSS)'],
  [PRINT_BRAND_FOOTER_CSS, '꼬리말 CSS(PRINT_BRAND_FOOTER_CSS)'],
  [PRINT_WORDMARK_CSS, '워드마크 CSS(PRINT_WORDMARK_CSS)'],
  [PRINT_WORDMARK_HTML, '워드마크(PRINT_WORDMARK_HTML)'],
  [printBrandHeaderHtml(full, issueHtml), '머리띠 마크업(printBrandHeaderHtml)'],
  [printBrandFootBizHtml(full), '사업자 꼬리말(printBrandFootBizHtml)'],
] as const) {
  if (!fullHtml.includes(piece)) {
    violations.push(`계약서 종이 HTML 에 공용 ${what} 이 없다. 계약서는 lib/printBrandHtml 조각을 그대로 써야 결산 보고서 종이와 머리가 안 갈린다`)
  }
}

// ── 축 1-b. 소스가 조각을 부르는가(구문 트리, 주석·import 줄은 안 센다)
const USES: Record<string, Record<string, number>> = {
  'lib/contractPrintHtml.ts': {
    printBrandHeaderHtml: 1, printBrandFootBizHtml: 2, PRINT_WORDMARK_HTML: 2,
    PRINT_BRAND_HEADER_CSS: 1, PRINT_BRAND_FOOTER_CSS: 1, PRINT_WORDMARK_CSS: 1,
  },
  'lib/reportPrintHtml.ts': {
    printBrandHeaderHtml: 1, printBrandFootBizHtml: 1, PRINT_WORDMARK_HTML: 1,
    PRINT_BRAND_HEADER_CSS: 1, PRINT_BRAND_FOOTER_CSS: 1, PRINT_WORDMARK_CSS: 1,
  },
  'app/api/contract/generate/route.ts': { printPageNumberFooterTemplate: 1 },
  'app/api/report/pdf/route.ts': { printPageNumberFooterTemplate: 1 },
}
// 손으로 다시 그린 흔적. 조각 정의 파일(lib/printBrandHtml.ts)만 이 글자를 가질 수 있다.
const REDRAWN = [/class="doc-header"/, /class="foot-biz"><span class="nm">/, /<span class="nm">/, /class="wm-stay"/, /\.doc-header\s*\{/, /\.foot-biz\s*\{/, /\.wordmark\s*\{/, /class="pageNumber"/]
for (const [file, want] of Object.entries(USES)) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const got: Record<string, number> = {}
  const texts: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return
    if (ts.isIdentifier(n) && n.text in want) got[n.text] = (got[n.text] ?? 0) + 1
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texts.push(n.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  for (const [name, n] of Object.entries(want)) {
    if ((got[name] ?? 0) !== n) violations.push(`${file} 가 ${name} 을 ${got[name] ?? 0}번 쓴다(${n}번이라야 한다). 공용 조각을 부르는 자리가 사라졌거나 늘었다`)
  }
  const joined = texts.join('\n')
  for (const re of REDRAWN) {
    if (re.test(joined)) violations.push(`${file} 의 문자열에 ${re.source} 가 있다. 머리띠·꼬리말을 손으로 다시 그리지 말고 lib/printBrandHtml 조각을 부른다`)
  }
}

// ── 축 2. 골든
const current: Record<string, { sha256: string; length: number }> = {}
for (const [k, html] of Object.entries(outputs)) current[k] = { sha256: sha(html), length: html.length }

if (process.argv.includes('--write')) {
  if (violations.length) { console.error(violations.join('\n')); process.exit(1) }
  mkdirSync('scripts/golden', { recursive: true })
  writeFileSync(GOLDEN, JSON.stringify(current, null, 2) + '\n')
  console.log(`[계약서 종이 골든] ${Object.keys(current).length}벌을 ${GOLDEN} 에 썼다`)
  process.exit(0)
}

if (!existsSync(GOLDEN)) {
  violations.push(`${GOLDEN} 가 없다. 감지망이 판정 불가다`)
} else {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof current
  for (const k of new Set([...Object.keys(golden), ...Object.keys(current)])) {
    const g = golden[k]; const c = current[k]
    if (!g || !c) { violations.push(`표본 ${k} 가 골든과 짝이 안 맞는다(표본 목록이 바뀌었다)`); continue }
    if (g.sha256 !== c.sha256) {
      violations.push(`표본 ${k} 의 바이트가 골든과 다르다(길이 ${g.length} → ${c.length}). 계약서 종이가 바뀌었다. 공용 조각(lib/printBrandHtml)을 보고서 때문에 고쳤다면 운영자에게 먼저 묻고, 일부러 바꾼 것이면 확인 뒤 --write 로 골든을 다시 쓴다`)
    }
  }
}

if (violations.length) {
  console.error(`\n[계약서 종이 골든] 표본 ${Object.keys(current).length}벌 / 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`[계약서 종이 골든] 표본 ${Object.keys(current).length}벌 바이트 동일 · 공용 조각 출력 6곳 · 소스 사용 ${Object.keys(USES).length}파일 / 위반 0건`)
