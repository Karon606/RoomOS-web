// 납부 확인서 여러 달 발급 배선 감지망 — 묶음이 한 장 정본 경로만 쓰는지, 적용취소·최신 판정·발행일 기본값이
// 정본에 붙어 있는지 모양으로 본다. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 2026-10-19, 운영자 승인 2026-10-20). 묶음 발급은 '한 장 발급 정본 경로를 달마다 재사용'이 승인
// 조건이다. 묶음이 제 채번·PDF·저장을 따로 두면 발행번호 규칙이나 귀속월 기록이 한쪽만 고쳐지는 날이 온다.
// 진리표·통합 하네스는 지금의 동작을 보고, 이 그물은 그 동작이 정본 한 길에서 나온다는 모양을 본다.
//
//   ⓐ 발급 이력 행을 만드는 곳은 lib/rentReceiptIssue 하나다(rentReceiptFile.create · uploadToDrive · 번호 찍는 PDF).
//   ⓑ 한 장 라우트와 묶음 본체가 둘 다 issueRentReceiptsInTx 를 부른다. 묶음은 달마다 getRentReceiptData 자동값을
//      autoFormFields 로 옮기고, 요청은 batchRequestError 로 검사한다. 화면 첫 값도 autoFormFields 를 지난다.
//   ⓒ 적용취소는 서명 대조(용도 라벨) + 행 모양 CAS + 영업장 범위 + 지움 수 확인을 다 건다.
//   ⓓ 고를 수 있는 달·발행일 기본값은 정본(issuableRentMonths·defaultIssueDate)이 내고 화면 발행일 첫 값은 서버 값이다.
//   ⓔ 서류 시트의 납부 확인서 최신은 귀속월 기준(latestRentFor)이다.
//   ⓕ 전역 발급 이력 '다시 작성'이 그 장의 귀속월을 싣는다.
//   ⓖ 발급 뒤 화면에 머물고 토스트에 적용취소를 단다(종전 router.push(back.href) 로 되돌아가면 적용취소 자리가 사라진다).
//   ⓗ 정본 경로가 영업장 단위로 줄을 세우고(pg_advisory_xact_lock) 요청 표식으로 멱등이며, 두 입구가 요청 id 를 넘기고
//      번호 충돌을 한국어로 돌려준다. 화면은 실패해도 다시 읽는다(응답 유실 뒤 재클릭 중복, 검수 2026-10-20).
//
// 실행: node scripts/check-rent-receipt-batch-wiring.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const read = f => readFileSync(f, 'utf8')
// 주석을 지우되 줄 수는 보존한다. '://' 는 URL 이라 줄 주석으로 보지 않는다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
const src = f => strip(read(f))

const CORE = 'lib/rentReceiptIssue.ts'
const ONE = 'app/api/rent-receipt/generate/route.ts'
const BATCH_ROUTE = 'app/api/rent-receipt/generate-batch/route.ts'
const BATCH = 'app/rent-receipt/[tenantId]/issueBatch.ts'
const ACTIONS = 'app/rent-receipt/[tenantId]/actions.ts'
const VIEW = 'app/rent-receipt/[tenantId]/RentReceiptView.tsx'
const BUNDLE = 'lib/docBundle.ts'
const LIST = 'app/(app)/rent-receipts/RentReceiptsClient.tsx'

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

// ⓐ 발급 이력 행·업로드·번호 PDF 는 정본 한 곳.
for (const f of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  if (f === CORE) continue
  const s = src(f)
  if (/rentReceiptFile\.create\b/.test(s)) violations.push(`${f} — 발급 이력 행을 정본 밖에서 만든다. issueRentReceiptsInTx 를 쓴다.`)
  if (/buildRentReceiptPdf\(/.test(s) && f !== 'lib/rentReceiptPdf.ts') violations.push(`${f} — 납부 확인서 PDF 를 정본 밖에서 그린다(번호·미리보기 규칙이 갈린다).`)
}
for (const f of [ONE, BATCH_ROUTE, BATCH]) {
  if (/uploadToDrive\b/.test(src(f))) violations.push(`${f} — Drive 업로드를 직접 한다. 정본 경로가 올리고 실패 시 휴지통으로 보낸다.`)
}
{
  const s = src(CORE)
  for (const need of ['export async function issueRentReceiptsInTx', 'rentReceiptFile.count', 'rentReceiptFile.create', 'uploaded.push', 'targetMonth:',
    'pg_advisory_xact_lock', 'fileName: { contains: `_${requestTag}-` }']) {
    if (!s.includes(need)) violations.push(`${CORE} — 정본 경로에 '${need}' 가 없다.`)
  }
}

// ⓑ 두 입구가 같은 정본을 지난다.
{
  const one = src(ONE)
  if (!/issueRentReceiptsInTx\(/.test(one)) violations.push(`${ONE} — 한 장 발급이 정본 경로를 안 지난다.`)
  if (!/trashUploaded\(/.test(one)) violations.push(`${ONE} — 실패 시 올린 파일을 안 치운다.`)
  if (!/signRentReceiptUndo\(/.test(one)) violations.push(`${ONE} — 한 장 발급이 적용취소 토큰을 안 낸다(§16).`)
  const route = src(BATCH_ROUTE)
  if (!/issueRentReceiptBatch\(/.test(route)) violations.push(`${BATCH_ROUTE} — 묶음 본체(issueRentReceiptBatch)를 안 부른다.`)
  if (!/requireEdit\(/.test(route)) violations.push(`${BATCH_ROUTE} — 편집 권한 관문이 없다.`)
  const b = src(BATCH)
  for (const [need, why] of [
    ['issueRentReceiptsInTx(', '달마다 한 장 정본 경로'],
    ['getRentReceiptData(', '달마다 자동값(한 달 화면과 같은 함수)'],
    ['autoFormFields(', '자동값을 종이 칸으로 옮기는 정본'],
    ['batchRequestError(', '고를 수 있는 달 검사'],
    ['prisma.$transaction(', '한 트랜잭션(한 장이라도 실패하면 전부 되감는다)'],
    ['trashUploaded(', '실패 시 올린 파일 정리'],
    ['signRentReceiptUndo(', '묶음 적용취소 토큰'],
  ]) if (!b.includes(need)) violations.push(`${BATCH} — ${why}(${need})가 없다.`)
  // 묶음 루프 밖에서 따로 채번하면 정본을 우회한 것이다.
  if (/rentReceiptFile\.count/.test(b)) violations.push(`${BATCH} — 묶음이 제 채번을 한다. 번호는 정본 경로가 붙인다.`)
  if (!/buildInitial[\s\S]{0,200}autoFormFields\(/.test(src(VIEW))) violations.push(`${VIEW} — 화면 첫 값이 autoFormFields 를 안 지난다(묶음 종이와 표기가 갈린다).`)
}

// ⓒ 적용취소.
{
  const a = src(ACTIONS)
  const m = a.match(/export async function undoRentReceiptIssue[\s\S]*?\n}\n/)
  if (!m) violations.push(`${ACTIONS} — undoRentReceiptIssue 가 없다.`)
  else {
    const body = m[0]
    for (const [re, why] of [
      [/requireEdit\(\)/, '편집 권한 관문'],
      [/verifyUndoBody\(RENT_RECEIPT_UNDO_DOMAIN,\s*propertyId/, '용도 라벨·영업장 서명 대조'],
      [/parseRentReceiptUndo\(/, '토큰 모양 검사'],
      [/rentReceiptRowUnchanged\(/, '행 모양 CAS'],
      [/where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*propertyId,\s*deletedAt:\s*null\s*\}/, '영업장 범위 + 살아 있는 행만 지움'],
      [/res\.count !== ids\.length/, '지운 수 확인(반쪽 적용취소 금지)'],
    ]) if (!re.test(body)) violations.push(`${ACTIONS} — 적용취소에 ${why}가 없다.`)
  }
  if (!/RENT_RECEIPT_UNDO_DOMAIN = 'rent-receipt-issue'/.test(src('lib/rentReceiptMonths.ts'))) {
    violations.push(`lib/rentReceiptMonths.ts — 적용취소 용도 라벨이 바뀌었다. 다른 토큰과 서명이 섞이지 않게 고유 라벨을 둔다.`)
  }
}

// ⓓ 달·발행일 기본값.
{
  const a = src(ACTIONS)
  if (!/issuableRentMonths\(/.test(a)) violations.push(`${ACTIONS} — 고를 수 있는 달을 정본으로 안 낸다.`)
  if (!/defaultIssueDate\(/.test(a)) violations.push(`${ACTIONS} — 발행일 기본값을 정본으로 안 낸다.`)
  const v = src(VIEW)
  if (!/useState\(data\.defaultIssueDate\)/.test(v)) violations.push(`${VIEW} — 발행일 첫 값이 서버 기본값(그 달 몫 마지막 입금일)이 아니다.`)
  if (/useState\(kstYmdStr\(\)\)/.test(v)) violations.push(`${VIEW} — 발행일 첫 값이 오늘로 되돌아갔다(신고 2026-10-19 달력 결함의 뿌리).`)
  if (!/defaultIssueDate\(lastPayDate/.test(v)) violations.push(`${VIEW} — 여러 달의 달마다 발행일 기본값이 정본을 안 지난다.`)
}

// ⓔ 시트 최신 판정.
{
  const b = src(BUNDLE)
  if (!/const rent = latestRentFor\(rents, l\.id\)/.test(b)) violations.push(`${BUNDLE} — 납부 확인서 최신이 귀속월 기준(latestRentFor)이 아니다.`)
  if (!/latestByTargetMonth/.test(b)) violations.push(`${BUNDLE} — 최신 판정이 정본(latestByTargetMonth)을 안 쓴다.`)
}

// ⓕ '다시 작성' 귀속월.
if (!/c\.targetMonth \? `month=\$\{c\.targetMonth\}`/.test(src(LIST))) violations.push(`${LIST} — '다시 작성'이 그 장의 귀속월을 안 싣는다.`)

// ⓖ 발급 뒤 머문다 + 토스트 적용취소.
{
  const v = src(VIEW)
  if (/router\.push\(back\.href\)/.test(v)) violations.push(`${VIEW} — 발급 뒤 화면을 떠난다. 적용취소 자리(결과 칸·토스트)가 사라진다.`)
  if (!/action:\s*\{\s*label:\s*'적용취소'/.test(v)) violations.push(`${VIEW} — 발급 토스트에 적용취소가 없다(§16 1순위 진입점).`)
  if (!/undoRentReceiptIssue\(/.test(v)) violations.push(`${VIEW} — 화면이 적용취소 액션을 안 부른다.`)
}

// ⓘ 납부 확인서 PDF 글꼴은 통째로 싣는다. pdf-lib 서브셋은 이 TTF 에서 한글·숫자 대부분을 빠뜨린다(2026-10-20 렌더 실측:
//    '입실료 납부 확인서'가 '서' 한 글자로 남음). 장당 2.3MB 를 줄이려고 다시 켜면 종이가 백지가 된다.
if (/subset:\s*true/.test(src('lib/rentReceiptPdf.ts'))) violations.push(`lib/rentReceiptPdf.ts — 글꼴 서브셋을 켰다. 이 TTF 에서는 글자가 빠진 종이가 나간다(렌더 실측).`)

// ⓗ 줄 세우기·멱등·실패 새로고침.
{
  // 잠금은 정본의 **첫 문장**이어야 한다. 셈(count)·멱등 조회보다 뒤에 오면 그 사이 다른 발급이 같은 번호를 센다(재검수 2026-10-20).
  // 하네스는 PGlite 한 연결이라 동시성을 실제로 못 만든다. 그래서 이 모양 검사가 잠금의 증거다.
  const core = src(CORE)
  const body = core.match(/export async function issueRentReceiptsInTx\([\s\S]*?\): Promise<RentReceiptIssueRow\[\]> \{\n([^\n]*)/)
  if (!body || !/^\s*await tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(/.test(body[1])) {
    violations.push(`${CORE} — issueRentReceiptsInTx 첫 문장이 영업장 잠금(pg_advisory_xact_lock)이 아니다. 같은 영업장 발급이 같은 번호를 센다.`)
  }
  if (!/shape\(prior\) !== want/.test(core)) violations.push(`${CORE} — 멱등 재전송이 앞서 낸 행과 지금 입력을 대조하지 않는다.`)
  if (!/\.then\(r => \{ uploaded\.push\(r\.fileId\)/.test(core)) violations.push(`${CORE} — 업로드가 끝나는 대로 uploaded 에 안 적는다(시간 초과 때 고아 파일).`)
  if (!/code === 'P2028'/.test(core)) violations.push(`${CORE} — 잠금 대기 시간 초과(P2028)를 화면 문장으로 안 돌려준다.`)
  for (const f of [ONE, BATCH]) {
    const s = src(f)
    if (!/receiptRequestTag\(body\.requestId\)/.test(s)) violations.push(`${f} — 요청 id 를 정본에 안 넘긴다(응답 유실 뒤 재클릭이 새 장을 또 만든다).`)
    if (!/rentReceiptIssueErrorMessage\(err\)/.test(s)) violations.push(`${f} — 번호 충돌(P2002)을 화면 문장으로 안 돌려준다.`)
  }
  const v = src(VIEW)
  if (!/requestId: requestIdFor\(/.test(v)) violations.push(`${VIEW} — 발급 요청에 요청 id 를 안 싣는다.`)
  if (!/const failIssue = [^\n]*router\.refresh\(\)/.test(v)) violations.push(`${VIEW} — 발급이 실패해도 화면을 다시 안 읽는다(발급본 경고가 안 선다).`)
}

if (violations.length) {
  console.error(`[납부 확인서 묶음 배선] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  · ' + v)
  process.exit(1)
}
console.log('[납부 확인서 묶음 배선] 위반 0건')
