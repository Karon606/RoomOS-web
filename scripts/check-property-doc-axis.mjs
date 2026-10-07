// 영업장 서류(사업자등록증·통장사본 국문·영문) 축의 잠금이 풀리는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-07, 통장사본 신설). 통장사본은 예금주·계좌번호가 한 장에 찍힌 서류다.
// 사업자등록증과 같은 업로드 축을 쓰지만 읽기 문이 하나 더 있다 — 입금 계좌(bankAccount)와 같은
// money 스코프. 이 문은 세 자리(인증 프록시·상담 도구 값·환경설정 적용취소)에 흩어져 있어 한 자리만
// 풀려도 금액 읽기가 막힌 역할에게 계좌가 찍힌 종이가 나간다. 그래서 자리마다 꼴을 못박는다.
//
//   ⓐ /api/bank-book 이 canReadScope(…, 'money') 로 막고, 그 문이 바이트를 내려받기 전에 있다.
//   ⓑ 상담 도구 값(consultInfo)의 통장사본 둘이 canReadScope(…, 'money') 삼항 안에서만 값을 낸다.
//   ⓒ 영업장 서류 경로에 Drive 공개 권한(setDrivePublicReadable)이 없다. 로고는 공개가 설계라
//      settings/actions.ts 전체가 아니라 서류 함수 본문만 잰다.
//   ⓓ 적용취소(restorePropertyDoc)가 클라이언트에서 Drive ID 를 받지 않고, 되살리기 전에
//      `${접두}_${영업장ID}_` 이름 대조를 지난다. 소유만으로는 다른 영업장의 파일과 갈리지 않는다.
//   ⓔ 사업자등록증 수출 셋(createBizCertUploadSession·finalizeBizCert·deleteBizCert)이 살아 있다.
//      배포 직후 이미 열려 있는 옛 화면이 이 이름으로 액션을 부른다.
//   ⓕ /api/bank-book 이 lang 을 'ko'|'en' 밖이면 400 으로 거절하고, Drive ID 를 요청에서 받지 않는다.
//
// 주석은 지우고 본다 — "문이 있다"고 적힌 설명이 검사를 통과시키면 그물이 아니라 장식이다.
//
// 실행: node scripts/check-property-doc-axis.mjs
import { readFileSync } from 'node:fs'

const violations = []
// 줄 수를 보존한다. '://' 는 URL 이라 줄 주석으로 보지 않는다.
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = f => {
  try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f} 를 못 읽는다(대상 파일이 옮겨졌나).`); return '' }
}

// 함수 본문 — 선언부터 다음 최상위 선언(0열의 export·async function·function·const·type) 직전까지.
const fnBody = (src, name) => {
  const at = src.search(new RegExp(`(?:^|\\n)(?:export\\s+)?async\\s+function\\s+${name}\\s*\\(`))
  if (at < 0) return null
  const rest = src.slice(at + 1)
  const next = rest.search(/\n(?:export\s|async\s+function\s|function\s|const\s|type\s)/)
  return src.slice(at, next < 0 ? undefined : at + 1 + next)
}

const ROUTE = 'app/api/bank-book/route.ts'
const CONSULT = 'app/(app)/consultInfo.ts'
const ACTIONS = 'app/(app)/settings/actions.ts'

const route = read(ROUTE)
const consult = read(CONSULT)
const actions = read(ACTIONS)

// ⓐ 인증 프록시의 money 문 — 바이트를 받기 전에 403 으로 돌려보내야 한다.
{
  const gate = route.search(/if\s*\(\s*!\s*canReadScope\(\s*[\w.]+\s*,\s*'money'\s*\)\s*\)\s*return[^\n]*status:\s*403/)
  const dl = route.search(/downloadDriveBytes\s*\(/)
  if (gate < 0) {
    violations.push(`${ROUTE} — canReadScope(…, 'money') 로 403 을 내는 문이 없다. 금액 읽기가 막힌 역할에게 통장사본이 나간다.`)
  } else if (dl >= 0 && dl < gate) {
    violations.push(`${ROUTE} — money 문이 downloadDriveBytes 뒤에 있다. 막기 전에 파일을 이미 받는다.`)
  }
}

// ⓑ 상담 도구 값 — 통장사본 둘이 money 삼항 안에서만 값을 낸다(막힌 역할에게는 존재도 안 내린다).
for (const key of ['bankBookKoMimeType', 'bankBookEnMimeType']) {
  if (!new RegExp(`${key}\\s*:\\s*canReadScope\\(\\s*access\\.role\\s*,\\s*'money'\\s*\\)\\s*\\?`).test(consult)) {
    violations.push(`${CONSULT} — ${key} 가 canReadScope(access.role, 'money') 삼항 밖에서 값을 낸다. 막힌 역할 화면에 보내기 줄이 선다.`)
  }
}

// ⓒ 공개 권한 0 — 프록시 파일 전체, 그리고 환경설정 액션의 서류 함수 본문.
if (/setDrivePublicReadable\s*\(/.test(route)) {
  violations.push(`${ROUTE} — setDrivePublicReadable 을 부른다. 계좌가 찍힌 서류가 링크만 알면 열린다.`)
}
const DOC_FNS = [
  'uploadSessionFor', 'finalizeFor', 'deleteFor', 'restoreFor',
  'createBizCertUploadSession', 'finalizeBizCert', 'deleteBizCert',
  'createPropertyDocUploadSession', 'finalizePropertyDoc', 'deletePropertyDoc', 'restorePropertyDoc',
]
for (const fn of DOC_FNS) {
  const body = fnBody(actions, fn)
  if (body == null) { violations.push(`${ACTIONS} — ${fn} 가 없다(영업장 서류 함수가 옮겨졌나).`); continue }
  if (/setDrivePublicReadable\s*\(/.test(body)) {
    violations.push(`${ACTIONS} — ${fn} 가 setDrivePublicReadable 을 부른다. 영업장 서류에는 공개 권한을 붙이지 않는다.`)
  }
}

// ⓓ 적용취소 — 클라이언트는 종류만 보내고, 서버는 되살리기 전에 이름 접두로 영업장·종류를 대조한다.
{
  const exp = fnBody(actions, 'restorePropertyDoc')
  if (exp && !/export\s+async\s+function\s+restorePropertyDoc\s*\(\s*kind\s*:\s*PropertyDocKind\s*\)/.test(exp)) {
    violations.push(`${ACTIONS} — restorePropertyDoc 가 종류 외의 인자를 받는다. 되살릴 Drive ID 를 클라이언트가 고르게 하면 안 된다.`)
  }
  if (exp && !/restoreFor\s*\(\s*kind\s*\)/.test(exp)) {
    violations.push(`${ACTIONS} — restorePropertyDoc 가 restoreFor 를 안 지난다. 대조가 있는 길을 우회한다.`)
  }
  const body = fnBody(actions, 'restoreFor')
  if (body) {
    const own = body.search(/ownedDriveFile\(\s*[\w.]+\s*,\s*\{\s*allowTrashed:\s*true\s*\}\s*\)/)
    const name = body.search(/\.startsWith\(\s*`\$\{spec\.prefix\}_\$\{propertyId\}_`\s*\)/)
    const untrash = body.search(/untrashInDrive\s*\(/)
    if (own < 0) violations.push(`${ACTIONS} — restoreFor 가 ownedDriveFile(…, { allowTrashed: true }) 로 소유를 묻지 않는다.`)
    if (name < 0) {
      violations.push(`${ACTIONS} — restoreFor 에 \`\${spec.prefix}_\${propertyId}_\` 이름 대조가 없다. 다른 영업장의 파일이 우리 칼럼에 앉는다.`)
    } else if (untrash >= 0 && untrash < name) {
      violations.push(`${ACTIONS} — restoreFor 가 이름 대조 전에 untrashInDrive 를 부른다. 대조가 늦으면 남의 파일을 먼저 되살린다.`)
    }
  }
}

// ⓔ 옛 화면이 부르는 사업자등록증 수출 셋.
for (const fn of ['createBizCertUploadSession', 'finalizeBizCert', 'deleteBizCert']) {
  if (!new RegExp(`export\\s+async\\s+function\\s+${fn}\\s*\\(`).test(actions)) {
    violations.push(`${ACTIONS} — export async function ${fn} 가 없다. 배포 직후 열려 있던 화면의 사업자등록증 업로드·삭제가 깨진다.`)
  }
}

// ⓕ 프록시 입력 모양 — lang 은 'ko'|'en' 만, 그 밖은 400. Drive ID 는 요청에서 받지 않는다.
{
  // 문 바로 뒤(한 문장 안)에서 400 이 나와야 한다 — 멀리 떨어진 다른 400 에 헛걸리지 않게 거리를 묶는다.
  if (!/if\s*\(\s*lang\s*!==\s*'ko'\s*&&\s*lang\s*!==\s*'en'\s*\)\s*\{?\s*return\s+NextResponse\.json\([^\n]*status:\s*400/.test(route)) {
    violations.push(`${ROUTE} — lang 이 'ko'|'en' 밖일 때 400 으로 거절하는 문이 없다. 지도 밖 값으로 칼럼을 고르게 된다.`)
  }
  if (/searchParams\.get\(\s*['"](?:id|fileId|driveFileId|v)['"]\s*\)/.test(route)) {
    violations.push(`${ROUTE} — 요청에서 파일 ID 를 읽는다. 영업장당 한 건을 서버가 고르는 프록시라 끼워 넣을 자리가 없어야 한다.`)
  }
}

console.log(`[영업장 서류 축] 축 6개(ⓐ~ⓕ) 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  통장사본은 입금 계좌와 같은 money 스코프다. 문 하나가 풀리면 계좌가 찍힌 종이가 막힌 역할에게 나간다.')
  process.exit(1)
}
