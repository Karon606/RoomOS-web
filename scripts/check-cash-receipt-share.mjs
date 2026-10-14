// 받을 때 발행 대상은 이용료뿐이라는 규칙이 코드에 살아 있는지. 읽기 전용, 위반 시 exit 1.
//
// 왜 있나 (운영자 확정 2026-09-21). 원문 — "보증금은 돌려주는 금액, 청소비 또한 퇴실할 때
// 처리하는 금액이므로 받을 때는 현금영수증 처리하면 안되는 건들이야". 실측으로는 이미 지켜지고
// 있었다(살아 있는 발행 줄 49건 전부 inclRent 만 참). **앱의 기본값만 반대로 서 있었고**
// 운영자가 매번 손으로 체크를 풀어 왔다. 그 기본값이 조용히 되돌아가면 되돌아간 줄도 모른 채
// 없는 매출이 국세청에 올라간다.
//
// 이 그물의 규율 둘.
//   1. **주석을 먼저 걷는다.** 이 저장소는 주석에 "왜 이렇게 됐나"를 길게 적어서, 낱말만 보면
//      주석 속 설명이 코드로 오인된다(실제로 난 사고다).
//   2. **함수 몸통을 이름으로 잘라 그 안만 본다.** 파일 전역을 보면 다른 함수의 같은 낱말에
//      걸려 헛통과한다. 앵커를 못 찾으면 그 자체가 위반이다 — 침묵 통과 금지.
//
// 실행: node scripts/check-cash-receipt-share.mjs
import { readFileSync } from 'node:fs'

const violations = []

/**
 * 줄 수를 보존하며 주석을 걷는다(`\s*` 는 m 플래그에서 줄바꿈을 먹는다).
 *
 * **줄 끝 주석도 걷는다**(독립 검수 2026-09-22). 종전 정규식은 `^[^\S\n]*\/\/` 라 줄 **머리**의
 * 주석만 지웠다. 그래서 무관한 코드 줄 끝에 `// 이용료 몫` 을 붙이기만 하면 낱말 존재 검사가
 * 전부 통과했다 — 이 파일이 규율 1로 "주석을 먼저 걷는다"고 적어 놓고 절반만 구현한 자리다.
 * URL 의 `//` 를 안 먹게 앞 글자가 `:` 가 아닐 때만 자른다.
 */
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

const read = f => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f} — 읽을 수 없다.`); return '' } }

/** `open` 위치의 '{' 부터 짝이 맞는 '}' 까지. */
function braceBlock(src, open) {
  if (open < 0 || src[open] !== '{') return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}

/**
 * `anchor` 뒤 첫 '{' 블록 — **호출식**(`prisma.x.create({ … })`)을 자를 때 쓴다.
 * 못 찾으면 null 이고, 부르는 쪽이 그것을 **위반으로** 다룬다.
 */
function argBlock(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  return braceBlock(src, src.indexOf('{', at))
}

/**
 * 함수 **몸통**만. 인자 목록과 반환 타입을 건너뛴다.
 *
 * 그냥 '첫 {' 로 자르면 `function f(args: { … })` 의 인자 타입이 몸통으로 잡혀, 몸통에 있는
 * 낱말을 하나도 못 보고 통과·오탐을 둘 다 낸다. 인자 괄호를 짝으로 넘긴 뒤, 반환 타입
 * `: Promise<{ … }>` 의 중괄호는 꺾쇠 깊이로 걸러 낸다.
 */
function fnBody(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const lp = src.indexOf('(', at)
  if (lp < 0) return null
  let paren = 0, rp = -1
  for (let i = lp; i < src.length; i++) {
    if (src[i] === '(') paren++
    else if (src[i] === ')') { paren--; if (paren === 0) { rp = i; break } }
  }
  if (rp < 0) return null
  let angle = 0
  for (let i = rp + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '<') angle++
    else if (c === '>') angle = Math.max(0, angle - 1)
    else if (c === '{' && angle === 0) return braceBlock(src, i)
  }
  return null
}

const FORM = 'components/entity-modal/widgets/PaymentEntryForm.tsx'
const SRV  = 'app/(app)/rooms/actions.ts'
const HOME = 'app/(app)/dashboard/getDashboardData.ts'
const TAB  = 'components/rooms/CashReceiptTab.tsx'
const LIST = 'components/entity-modal/widgets/PaymentRecordList.tsx'
const LIB  = 'lib/cashReceipt.ts'
const ENG  = 'app/(app)/rooms/cashReceiptLine.ts'
const TEN  = 'app/(app)/tenants/actions.ts'

const form = read(FORM)
const list = read(LIST)
const srv  = read(SRV)
const home = read(HOME)
const tab  = read(TAB)
const lib  = read(LIB)
const eng  = read(ENG)
const ten  = read(TEN)

// ── ⓐ 수납 등록 폼의 몫 기본값이 정본 상수인가 ──────────────────────────
//
// 리터럴로 되돌리면 그 화면만 옛 규칙으로 산다. 정본 상수 하나를 보게 두는 것이 이 규칙의 전부다.
{
  const m = form.match(/const \[crIncl, setCrIncl\] = useState\(([^)]*)\)/)
  if (!m) {
    violations.push(`${FORM} — crIncl 의 useState 를 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else if (!/CASH_RECEIPT_DEFAULT_INCL/.test(m[1])) {
    violations.push(`${FORM} — crIncl 기본값이 정본 상수(CASH_RECEIPT_DEFAULT_INCL)가 아니다: ${m[1].trim().slice(0, 60)}`)
  }
  // useState 인자 어디에도 켜는 리터럴이 서면 안 된다 — 상수를 부르면서 덮어쓰는 길도 막는다.
  for (const u of form.matchAll(/useState\(([\s\S]{0,200}?)\)/g)) {
    if (/deposit:\s*true/.test(u[1])) {
      violations.push(`${FORM} — useState 인자에 deposit: true 리터럴이 있다. 받을 때 보증금은 발행 대상이 아니다.`)
      break
    }
  }
  // **수납 내역 수정 폼도 같은 자를 받는다.** 발행 줄이 없는 record 를 열 때의 기본 구성이다.
  // 이 목록이 서는 자리 둘은 scope='window' 라 보증금 행이 안 오지만 **기본 prop 은 'month'**
  // 이고 그쪽 집합에는 보증금이 든다 — scope 를 안 준 마운트 하나면 옛 규칙이 되살아난다.
  // 그래서 죽은 가지여도 정본을 쓰게 하고 그 사실을 여기서 못박는다.
  // 폼을 열 때의 구성은 prefillIncl 하나로 세운다. 칸을 고쳤는지 가르는 기준값과 같은 값이다(F1, 2026-10-14).
  const em = list.match(/const prefillIncl = line\n[^\n]*\n[^\n]*\n/)
  if (!em) {
    violations.push(`${LIST}: const prefillIncl = line … 를 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else {
    if (!/CASH_RECEIPT_DEFAULT_INCL/.test(em[0])) {
      violations.push(`${LIST} — 발행 줄이 없을 때의 기본 구성이 정본 상수가 아니다.`)
    }
    if (/deposit:\s*(true|!!)/.test(em[0])) {
      violations.push(`${LIST} — 기본 구성이 받은 몫을 보고 보증금을 켠다. 그것이 2026-09-21 에 닫힌 옛 규칙이다.`)
    }
  }
}

// ── ⓑ 저장 문들이 이용료 몫을 기본값으로 쓰는가 ────────────────────────
//
// 2026-10-13 부터 발행 줄을 쓰는 길은 하나다. 판정은 lib/cashReceipt 의 순수 함수(켜기
// planCashReceiptOn · 등록 planCashReceiptEntry · 수정 planCashReceiptEdit)가 하고, 줄·도장 쓰기는
// rooms/cashReceiptLine.ts 의 writeCrKey 한 자리가 한다. 그래서 기본 금액·기본 구성 규칙은 판정
// 함수 안에서, '다른 길로 줄을 쓰지 않는가'는 액션 파일 전체에서 본다. 종전 그물은 동기화 함수
// 셋(syncCashReceiptLine·touchCashReceiptIssuedAt·도장 정렬)의 몸통을 잘라 봤다. 그 셋이 경로마다
// 다른 규칙으로 줄을 덮은 것이 422호 결함(D1·D8)이었고, 그 자리를 하나로 모은 것이 이번 시공이다.
{
  // (1) 기본 금액·구성을 정하는 판정 둘이 정본을 쓰는가.
  //   켜기는 키의 몫에서 발행 대상 금액 정본으로 센다. 등록은 이번 입금의 이용료 몫(entry)을 받는다.
  //   그 몫을 세는 자리(setPaymentCashReceipt)가 보증금 행을 빼는지는 아래 (1-b)가 본다(F4, 2026-10-14).
  for (const fn of ['planCashReceiptOn', 'planCashReceiptEntry']) {
    const b = fnBody(lib, `export function ${fn}(`)
    if (!b) { violations.push(`${LIB}: ${fn} 몸통을 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`); continue }
    if (fn === 'planCashReceiptOn' && !/cashReceiptIssuableAmount\(parts\)/.test(b)) {
      violations.push(`${LIB} ${fn}: 발행 대상 금액 정본(cashReceiptIssuableAmount)을 안 쓴다. 보증금·청소비가 기본으로 올라갈 수 있다.`)
    }
    if (fn === 'planCashReceiptEntry' && !/const amount = given\.amount \?\? entry/.test(b)) {
      violations.push(`${LIB} ${fn}: 이번 입금의 발행 금액이 '폼 값, 없으면 이번 입금의 이용료 몫'이 아니다.`)
    }
    if (!/defaultIncl\(\)/.test(b)) {
      violations.push(`${LIB} ${fn}: 몫 기본값이 정본 상수가 아니다. 서버와 화면이 갈린다.`)
    }
    // 몫을 직접 만지는 길을 닫는다. 발행 대상 금액은 정본 함수만 정한다(독립 검수 2026-09-22 의 같은 처방).
    for (const m of b.match(/parts\.(deposit|cleaning|total)\b/g) ?? []) {
      violations.push(`${LIB} ${fn}: 입금 구성을 직접 만진다(${m}). 발행 대상 금액은 정본 함수가 정한다.`)
    }
  }
  // (1-b) 등록 경로가 이번 입금의 몫을 이용료 행으로만 센다.
  {
    const b = fnBody(srv, 'export async function setPaymentCashReceipt(')
    if (!b || !/mine\.has\(r\.id\) && !r\.isDeposit && r\.actualAmount > 0/.test(b)) {
      violations.push(`${SRV} setPaymentCashReceipt: 이번 입금의 몫을 이용료 행(보증금 제외·금액 있는 행)으로만 세지 않는다.`)
    }
  }
  if (!/const defaultIncl = \(\): CashReceiptIncl => \(\{ \.\.\.CASH_RECEIPT_DEFAULT_INCL \}\)/.test(lib)) {
    violations.push(`${LIB}: defaultIncl 이 정본 상수(CASH_RECEIPT_DEFAULT_INCL)의 사본이 아니다.`)
  }
  // (2) 구성을 읽는 자리가 청소비 몫까지 세고 정본 식으로 모으는가.
  const read = fnBody(eng, 'export async function readCrKey(')
  if (!read) {
    violations.push(`${ENG}: readCrKey 몸통을 못 찾았다(침묵 통과 금지).`)
  } else {
    if (!/CLEANING_FEE_CATEGORY/.test(read)) violations.push(`${ENG} readCrKey: 청소비 몫(ExtraIncome)을 안 센다. 분해 수납에서 몫이 작게 뜬다.`)
    if (!/summarizeCashReceiptKey\(/.test(read)) violations.push(`${ENG} readCrKey: 키의 몫을 정본 식(summarizeCashReceiptKey)으로 안 모은다. 점검 (바)와 갈린다.`)
    if (!/isBillingAdjust:\s*false/.test(read)) violations.push(`${ENG} readCrKey: 조정 전표를 안 거른다. 받은 돈이 아닌 것이 몫에 든다.`)
  }
  // (3) 액션들이 판정을 거쳐 엔진으로만 쓰는가.
  const DOORS = [
    ['setCashReceiptIssued', /planCashReceiptOn\(/],
    ['setPaymentCashReceipt', /planCashReceiptEntry\(/],
    ['batchSetCashReceipts', /planCashReceiptOn\(/],
    ['updatePayment', /planCashReceiptEdit\(/],
  ]
  for (const [fn, plan] of DOORS) {
    const b = fnBody(srv, `export async function ${fn}(`)
    if (!b) { violations.push(`${SRV} — ${fn} 몸통을 못 찾았다(침묵 통과 금지).`); continue }
    if (!plan.test(b)) violations.push(`${SRV} ${fn}: 줄을 어떻게 세울지 정본 판정을 안 거친다.`)
    if (!/writeCrKey\(/.test(b)) violations.push(`${SRV} ${fn}: 줄을 엔진(writeCrKey)으로 안 쓴다.`)
    if (/c\.total|\.deposit\s*>\s*0/.test(b)) violations.push(`${SRV} ${fn}: 입금 전액이나 '받은 몫이 있으면 켬' 조립이 되살아났다.`)
  }
  // (4) 엔진 밖에서 발행 줄을 직접 쓰는 자리가 없는가. 하나라도 서면 그 길만 다른 규칙으로 줄을 덮는다.
  for (const [f, src] of [[SRV, srv], [TEN, ten]]) {
    const w = src.match(/\bcashReceipt\.(create|update|updateMany|upsert|delete|deleteMany)\(/g) ?? []
    if (w.length > 0) violations.push(`${f}: 발행 줄을 엔진 밖에서 직접 쓴다(${w.join(', ')}). 줄 쓰기는 rooms/cashReceiptLine 의 writeCrKey 한 자리다.`)
  }
  // 엔진 안에서도 줄을 만드는 자리는 writeCrKey 하나다(적용취소 복원은 있던 줄만 되돌린다).
  const creates = (eng.match(/\bcashReceipt\.create\(/g) ?? []).length
  if (creates !== 1) violations.push(`${ENG}: 발행 줄을 만드는 자리가 ${creates}곳이다(기대 1, writeCrKey). 새 문이 생겼으면 이 그물부터 고친다.`)
}

// ── ⓒ 보증금 record 스탬프 규칙 ─────────────────────────────────────────
//
// 서버 기본값만 바꾸고 도장 규칙을 안 바꾸면, 보증금만 받으며 발행함을 켰을 때 도장은 찍히는데
// 줄은 0원이라 안 만들어져 verify:db 의 발행 줄 감사가 즉시 운다. 한 커밋이어야 하는 이유다.
{
  const dep = fnBody(srv, 'export async function saveDepositPayment(')
  if (!dep) {
    violations.push(`${SRV} — saveDepositPayment 몸통을 못 찾았다(침묵 통과 금지).`)
  } else {
    // 첫 create 블록만 본다 — 초과분 이용료 record 는 crStamp 를 그대로 받는 것이 맞다.
    const first = argBlock(dep, 'prisma.paymentRecord.create(')
    if (!first) {
      violations.push(`${SRV} saveDepositPayment — 보증금 record 를 만드는 create 블록을 못 찾았다(침묵 통과 금지).`)
    } else if (/isDeposit:\s*true/.test(first) && /cashReceiptIssuedAt:\s*crStamp/.test(first)) {
      violations.push(`${SRV} saveDepositPayment — 보증금 record 에 발행 도장을 찍는다. 받을 때 보증금은 발행 대상이 아니다.`)
    }
  }
  // **줄과 도장은 한 자리에서 함께 쓴다**(2026-10-13). 종전에는 도장 정렬 헬퍼를 줄을 내리는 문마다
  // 손으로 불러야 했고(내리는 자리 수와 정렬 자리 수를 맞추는 축이 있었다), 수납 이동·일괄 적용취소·
  // 수납 삭제 셋이 그것을 빠뜨렸었다. 이제는 writeCrKey 가 줄을 쓰는 같은 호출 안에서 도장을 맞춘다.
  // 보증금 행의 규칙은 하나다. 줄이 보증금을 들었을 때만 줄 발행일, 아니면(내릴 때 포함) null.
  {
    const w = fnBody(eng, 'export async function writeCrKey(')
    if (!w) {
      violations.push(`${ENG}: writeCrKey 몸통을 못 찾았다(침묵 통과 금지).`)
    } else {
      if (!/if \(r\.isDeposit\) \{\s*want\.set\(r\.id, next && next\.incl\.deposit \? next\.issuedAt : null\)/.test(w)) {
        violations.push(`${ENG} writeCrKey: 보증금 행 도장이 줄의 구성(incl.deposit)을 안 따른다. 토글 한 번에 보증금에도 도장이 찍히거나, 줄을 내려도 도장이 남는다.`)
      }
      if (!/stamp === 'key'\) want\.set\(r\.id, next && r\.actualAmount > 0 \? next\.issuedAt : null\)/.test(w)) {
        violations.push(`${ENG} writeCrKey: 키 단위 도장이 줄을 따르지 않는다(켜면 줄 발행일, 내리면 null). 행마다 '발행' 표시가 갈린다(결함 D7).`)
      }
      if (!/deletedAt: new Date\(\)/.test(w)) {
        violations.push(`${ENG} writeCrKey: 줄을 내리는 분기가 없다. 끄기가 줄을 못 내린다.`)
      }
    }
  }
  // **이용료 몫이 없으면 켤 수 없다**(독립 검수 2026-09-22). 0 원이면 판정이 none 을 내고 토글은
  // 실패를 돌려줘야 한다. 종전에는 켜기가 도리어 있던 줄을 지우고 성공 토스트를 띄웠다.
  {
    const on = fnBody(lib, 'export function planCashReceiptOn(')
    if (!on || !/if \(amount <= 0\) return \{ kind: 'none' \}/.test(on)) {
      violations.push(`${LIB} planCashReceiptOn: 이용료 몫이 0 일 때 none 을 안 낸다. 켜기가 0원 줄을 세우거나 있던 줄을 지운다.`)
    }
    const sib = fnBody(srv, 'export async function setCashReceiptIssued(')
    if (!sib) {
      violations.push(`${SRV}: setCashReceiptIssued 몸통을 못 찾았다(침묵 통과 금지).`)
    } else if (!/plan\.kind === 'none'\) return null/.test(sib) || !/이용료 몫이 없어 발행할 금액이 0원입니다/.test(sib)) {
      violations.push(`${SRV} setCashReceiptIssued: 이용료 몫이 없을 때의 가드가 없다. 켜기가 성공이라 답한다.`)
    }
  }
}

// ── ⓓ 후보 목록이 규칙으로 거르고 그 사실을 말하는가 ────────────────────
{
  const b = fnBody(srv, 'export async function getCashReceiptTabRows(')
  if (!b) {
    violations.push(`${SRV} — getCashReceiptTabRows 몸통을 못 찾았다(침묵 통과 금지).`)
  } else {
    if (!/isCashReceiptCandidate\(/.test(b)) {
      violations.push(`${SRV} getCashReceiptTabRows — 후보 판정 정본을 안 쓴다. 보증금·청소비만 받은 입금이 목록에 선다.`)
    }
    if (/g\.amount\s*>\s*0/.test(b)) {
      violations.push(`${SRV} getCashReceiptTabRows — 전액으로 후보를 가르는 옛 필터가 되살아났다.`)
    }
    if (!/return \{[^}]*excluded/.test(b)) {
      violations.push(`${SRV} getCashReceiptTabRows — 규칙으로 뺀 건수를 안 돌려준다. 화면이 "왜 이 입금이 없나"를 못 말한다.`)
    }
  }
  // 숫자를 화면에 싣기만 하고 '제외'라 말하지 않으면 운영자는 그 수를 반대로 읽는다.
  // **낱말은 그 숫자에 붙어 있어야 한다.** 같은 줄 아무 데나 있는 '제외'로 재면 바로 옆
  // '카드 결제 제외'에 걸려 통과한다(역주입에서 실제로 통과했다).
  const carrying = tab.split('\n').filter(l => /excluded\.count/.test(l))
  if (carrying.length === 0) {
    violations.push(`${TAB} — 제외 건수를 화면이 안 쓴다. 서버가 세어도 아무도 못 듣는다.`)
  } else if (!carrying.some(l => /excluded\.count\}건 제외/.test(l))) {
    violations.push(`${TAB} — 제외 건수 바로 뒤에 '제외'가 없다. 그 수가 무엇의 수인지 화면이 안 말한다: ${carrying[0].trim().slice(0, 60)}`)
  }
}

// ── ⓔ 홈 알림이 이용료 몫으로 의무를 재는가 ─────────────────────────────
{
  const start = home.indexOf('const crTodayYmd')
  const end = home.indexOf('} catch', start)
  if (start < 0 || end < 0) {
    violations.push(`${HOME} — 현금영수증 알림 블록을 못 찾았다(침묵 통과 금지).`)
  } else {
    const block = home.slice(start, end)
    const sel = argBlock(block, 'prisma.paymentRecord.findMany(')
    if (!sel || !/isDeposit:\s*true/.test(sel)) {
      violations.push(`${HOME} — crPays select 에 isDeposit 이 없다. 보증금 몫을 가를 수 없어 없는 의무를 조른다.`)
    }
    if (/amount\s*>=\s*CASH_RECEIPT_OBLIGATION_MIN/.test(block)) {
      violations.push(`${HOME} — 의무 기준액을 전액(amount)으로 잰다. 보증금 42만 + 이용료 8만이 발급 의무로 뜬다.`)
    }
    const cmp = block.match(/(\S+)\s*>=\s*CASH_RECEIPT_OBLIGATION_MIN/g) ?? []
    if (cmp.length === 0) {
      violations.push(`${HOME} — 의무 기준액 비교가 사라졌다. 기준액 미만 건까지 조른다.`)
    }
    for (const c of cmp) {
      if (!/issuable/.test(c)) violations.push(`${HOME} — 기준액 비교의 좌변이 발행 대상 금액이 아니다: ${c}`)
    }
    // **이름만 보면 그 값이 어디서 왔는지는 아무도 안 본다**(독립 검수 2026-09-22).
    // `g.issuable = g.deposit + g.cleaning + g.rent` 로 되돌려도 좌변 이름은 그대로라 통과했다.
    // 홈 블록이 정본 함수를 실제로 부르는지를 함께 본다.
    if (!/cashReceiptIssuableAmount\(/.test(block)) {
      violations.push(`${HOME} — 발행 대상 금액 정본(cashReceiptIssuableAmount)을 안 쓴다. issuable 이라는 이름만 남고 값은 전액일 수 있다.`)
    }
  }
  if (!/groups: ReadonlyMap<string, \{ issuable: number \}>/.test(lib)) {
    violations.push(`${LIB} — liveMutedReceiptKeys 의 groups 가 issuable 을 안 든다. 끈 건 라벨이 전액으로 되돌아간다.`)
  }
}

// ── ⓕ 경고 두 종이 '켰을 때만' 서는가 ───────────────────────────────────
//
// 호출만 있고 조건이 없으면 상시 오탐이고, 조건만 있고 호출이 없으면 침묵이다. 양쪽을 다 본다.
for (const kind of ['deposit', 'cleaning']) {
  const flag = kind === 'deposit' ? 'crIncl.deposit' : 'crIncl.cleaning'
  const call = `cashReceiptShareWarning('${kind}'`
  const at = form.indexOf(call)
  if (at < 0) { violations.push(`${FORM} — ${kind} 경고 정본 호출이 없다. 예외로 켜도 아무 말이 없다.`); continue }
  // 호출이 든 JSX 조건 안인가 — 바로 앞 조건절에 그 체크 상태가 있어야 한다.
  const before = form.slice(Math.max(0, at - 400), at)
  if (!before.includes(flag)) {
    violations.push(`${FORM} — ${kind} 경고가 ${flag} 조건 밖에 있다. 안 켠 사람에게도 상시로 뜬다.`)
  }
  if (!form.includes(`${flag} &&`)) {
    violations.push(`${FORM} — ${flag} 를 든 조건이 없다.`)
  }
}
{
  const at = form.indexOf('발행에 넣을 몫')
  if (at < 0) {
    violations.push(`${FORM} — 몫 체크 줄을 못 찾았다(침묵 통과 금지).`)
  } else if (!form.slice(Math.max(0, at - 500), at).includes('hasExcludedCashReceiptShare(')) {
    violations.push(`${FORM} — 몫 체크 줄의 조건이 '빠지는 몫이 있는가'가 아니다. 보증금만 받는 결제에서 예외로 켤 문이 사라진다.`)
  }
}

// ── ⓖ 탭 문구가 이용료 몫을 말하는가 ────────────────────────────────────
{
  if (/선택한 입금의 전액/.test(tab)) {
    violations.push(`${TAB} — 일괄 모달이 아직 '전액'을 적는다. 적히는 것은 이용료 몫이다.`)
  }
  // **낱말이 파일 어딘가에 있는지가 아니라 그 줄에 있는지를 본다**(독립 검수 2026-09-22).
  // 종전에는 파일 전체 검사라, 모달 본문에서 빼도 다른 문장(InfoHint)에 같은 낱말이 있어
  // 통과했다. 모달 본문은 '실제 발행은 홈택스' 로 시작하는 그 문단 하나다.
  const modalBody = tab.split('\n').find(l => l.includes('실제 발행은 홈택스'))
  if (!modalBody) {
    violations.push(`${TAB} — 일괄 모달 본문 문단을 못 찾았다(침묵 통과 금지).`)
  } else if (!/이용료 몫/.test(modalBody)) {
    violations.push(`${TAB} — 일괄 모달 본문이 무엇을 적는지 말하지 않는다. 적히는 것은 이용료 몫이다.`)
  }
  // 후보 행 메타 — '포함'이 아니라 '제외'다. 큰 숫자에 그 몫이 안 들어 있기 때문이다.
  for (const [col, label, josa] of [['deposit', '보증금', '을'], ['cleaning', '청소비', '를']]) {
    const re = new RegExp(`c\\.${col} > 0 \\? \`${label} \\$\\{fmtWon\\(c\\.${col}\\)\\} (포함|제외)\``)
    const m = tab.match(re)
    if (!m) {
      violations.push(`${TAB} — 후보 행의 ${label} 메타를 못 찾았다(침묵 통과 금지).`)
    } else if (m[1] !== '제외') {
      violations.push(`${TAB} — 후보 행이 ${label}${josa} '포함'이라 적는다. 큰 숫자는 이용료 몫이라 반대 사실이다.`)
    }
  }
  // 발행 내역 행의 구성 조각은 색으로 예외임을 말한다 — 낱말은 중립어 그대로다.
  const metaLine = tab.split('\n').find(l => l.includes('발행 {fmtMD(r.issuedYmd)}'))
  if (!metaLine) {
    violations.push(`${TAB} — 발행 내역 행의 메타 줄을 못 찾았다(침묵 통과 금지).`)
  } else if (!/incl\.join\(/.test(metaLine) || !/--warning-fg/.test(metaLine)) {
    violations.push(`${TAB} — 발행 내역 행의 구성 조각이 경고색을 안 든다. 규칙의 예외가 눈에 안 걸린다.`)
  }
}

// ── ⓗ 생애주기 배선(독립 검수 2026-10-14 W7) ─────────────────────────────
//
// 판정이 맞아도 그 판정을 **안 거치는 길** 하나면 422호가 다시 선다. 검수가 찾은 결함 넷(F1·F2·R6·R8)이
// 전부 그 모양이었다. 수정 폼이 서버 결과를 덮는 두 번째 호출, 적용취소 토큰을 버린 화면, 줄 정렬 없이
// 되살린 수납, 서명 없이 믿은 토큰. 통합 동작은 scripts/test-cash-receipt-flow.ts 가 실제 DB 위에서 보고,
// 여기서는 그 동작이 기대는 배선을 글자로 지킨다.
{
  const FN_RE = /export async function (\w+)\(/g
  /** 파일의 export 함수 몸통들. 이름으로 몸통을 찾는다. */
  const bodies = src => {
    const out = new Map()
    for (const m of src.matchAll(FN_RE)) {
      const b = fnBody(src.slice(m.index), `export async function ${m[1]}(`)
      if (b) out.set(m[1], b)
    }
    return out
  }
  const srvFns = bodies(srv), tenFns = bodies(ten)

  // ⓗ-1 수납 소프트삭제는 줄 정리(reconcileCrAfterRemoval)를 같은 함수 안에서 거친다.
  //     줄을 일부러 안 건드리는 길은 까닭과 함께 여기 적는다(늘리면 리뷰에 걸리게).
  const DELETE_EXEMPT = {
    finalizeRentRefund: '환불 대기. 줄은 홈택스 사실이라 안 내리고 taxNotice 로 취소·재발행을 말한다',
    undoShortStayExtension: '조정 전표 마커(isBillingAdjust): 받은 돈이 아니라 발행 키에 안 든다',
    undoRentRefund: '확정액 record 를 지우고 원 수납을 되살린다. ⓗ-2 의 정렬(alignRevivedStamps)이 맡는다',
  }
  // ⓗ-2 수납 복원(deletedAt: null)은 적용취소 스냅샷(applyCrUndo)이나 도장 정렬(alignRevivedStamps)을 거친다.
  const RESTORE_NEEDS = {
    restorePayment: ['applyCrUndo(', 'alignRevivedStamps('],
    undoReservationPrepaidCancel: ['applyCrUndo(', 'alignRevivedStamps('],
    undoRentRefund: ['alignRevivedStamps('],
  }
  for (const [file, fns] of [[SRV, srvFns], [TEN, tenFns]]) {
    for (const [name, b] of fns) {
      for (const m of b.matchAll(/paymentRecord\.(updateMany|update)\(/g)) {
        const call = braceBlock(b, b.indexOf('{', m.index))
        if (!call) continue
        const data = call.slice(call.indexOf('data:'))
        if (/deletedAt:\s*null/.test(data)) {
          const need = RESTORE_NEEDS[name]
          if (!need) violations.push(`${file} ${name}: 수납을 되살리는데 발행 줄 복원 규칙이 정해지지 않았다(applyCrUndo·alignRevivedStamps). 되살린 수납의 옛 도장이 줄 없이 남는다(검수 R6).`)
          else for (const n of need) if (!b.includes(n)) violations.push(`${file} ${name}: 수납 복원이 ${n.slice(0, -1)} 을 안 거친다.`)
        } else if (/deletedAt(:\s*(new Date\(\)|deletedAt|now|at)\b|\s*[,}])/.test(data)) {
          if (!b.includes('reconcileCrAfterRemoval(') && !DELETE_EXEMPT[name]) {
            violations.push(`${file} ${name}: 수납을 지우면서 발행 줄 정리(reconcileCrAfterRemoval)를 안 거친다. 아무 수납도 안 가리키는 줄이 합계에 남는다(결함 D10).`)
          }
        }
      }
    }
  }
  for (const n of Object.keys(DELETE_EXEMPT)) if (!tenFns.has(n) && !srvFns.has(n)) violations.push(`ⓗ-1 면제 목록의 ${n} 이 없다. 이름이 바뀌었으면 이 그물부터 고친다.`)

  // ⓗ-3 엔진의 모든 조회·쓰기가 영업장으로 걸린다. 적용취소 토큰은 화면을 거쳐 돌아온 값이라,
  //     한 자리만 빠져도 남의 영업장 줄·도장을 건드리는 문이 된다.
  {
    if (!/const where = \{ propertyId: ref\.propertyId,/.test(eng)) violations.push(`${ENG} readCrKey: 키 조회 조건(where)이 영업장으로 시작하지 않는다.`)
    let n = 0
    for (const m of eng.matchAll(/\b(db|prisma)\.(cashReceipt|paymentRecord|extraIncome)\.(findMany|findFirst|updateMany|update|create|deleteMany|count)\(/g)) {
      n++
      const call = braceBlock(eng, eng.indexOf('{', m.index))
      if (!call || !/propertyId|\.\.\.where\b/.test(call)) {
        const line = eng.slice(0, m.index).split('\n').length
        violations.push(`${ENG}:${line}: ${m[2]}.${m[3]} 가 영업장(propertyId)으로 안 걸린다.`)
      }
    }
    if (n < 10) violations.push(`${ENG}: 엔진의 표 접근을 ${n}곳밖에 못 찾았다(기대 10곳 이상). 모양이 바뀌었으면 이 그물부터 고친다.`)
  }

  // ⓗ-4 화면이 보낸 계약 id 로 줄을 만드는 두 문은 계약이 이 영업장 것인지 먼저 본다.
  {
    const set = srvFns.get('setPaymentCashReceipt') ?? ''
    if (!/prisma\.leaseTerm\.findFirst\(\{ where: \{ id: input\.leaseTermId, propertyId \}/.test(set)) {
      violations.push(`${SRV} setPaymentCashReceipt: 계약 소유(영업장) 확인이 없다. 남의 계약 키에 줄을 세울 수 있다.`)
    }
    const batch = srvFns.get('batchSetCashReceipts') ?? ''
    if (!/prisma\.leaseTerm\.findMany\(\{\s*where: \{ propertyId, id: \{ in:/.test(batch)) {
      violations.push(`${SRV} batchSetCashReceipts: 계약 소유(영업장) 확인이 없다. 남의 계약 키에 줄을 세울 수 있다.`)
    }
  }

  // ⓗ-5 키를 만지는 트랜잭션은 첫머리에서 키를 잠근다(W6). 잠금(lockCrKey·lockCrKeys, 또는 안에서 잠그는
  //     applyCrUndo)이 그 트랜잭션의 첫 엔진 호출·첫 쓰기보다 앞서야 한다.
  {
    const ENGINE = /\b(captureCr|readCrKey|writeCrKey|reconcileCrAfterRemoval|setStamps|alignRevivedStamps)\(|\btx\.\w+\.(update|updateMany|create|delete|deleteMany)\(/
    for (const [file, fns] of [[SRV, srvFns], [TEN, tenFns]]) {
      for (const [name, b] of fns) {
        for (const m of b.matchAll(/\$transaction\(async tx => \{/g)) {
          const tx = braceBlock(b, m.index + m[0].length - 1)
          if (!tx || !ENGINE.test(tx) || !/(captureCr|writeCrKey|reconcileCrAfterRemoval|alignRevivedStamps|applyCrUndo)\(/.test(tx)) continue
          const lock = tx.search(/\b(lockCrKeys?|applyCrUndo)\(/)
          const first = tx.search(ENGINE)
          if (lock < 0 || lock > first) violations.push(`${file} ${name}: 발행 키를 만지는 트랜잭션이 첫머리에서 키를 잠그지 않는다(lockCrKey). 같은 키의 동시 조작이 서로의 판정을 덮는다.`)
        }
      }
    }
    const apply = fnBody(eng, 'export async function applyCrUndo(')
    if (!apply || !/lockCrKeys\(db, undo\.keys/.test(apply)) violations.push(`${ENG} applyCrUndo: 토큰이 뜬 키를 잠그지 않는다.`)
    if (!/pg_advisory_xact_lock\(hashtext\(/.test(eng)) violations.push(`${ENG}: 키 잠금이 트랜잭션 단위 권고 잠금(pg_advisory_xact_lock)이 아니다.`)
  }

  // ⓗ-6 적용취소 토큰은 서버가 서명하고 복원 전에 대조한다(W4). 서명과 상관없이 미래 도장·키 밖 record 는 막는다.
  {
    const apply = fnBody(eng, 'export async function applyCrUndo(') ?? ''
    const verifyAt = apply.indexOf('verifyCrUndo(propertyId, undo)')
    const firstWrite = apply.search(/\.(updateMany|update|create)\(/)
    if (verifyAt < 0 || (firstWrite >= 0 && verifyAt > firstWrite)) violations.push(`${ENG} applyCrUndo: 쓰기 전에 토큰 서명을 대조하지 않는다(검수 R8).`)
    if (!/st\.before != null && new Date\(st\.before\)\.getTime\(\) > now \+ 60_000/.test(apply)) violations.push(`${ENG} applyCrUndo: 되돌릴 도장이 미래인 토큰을 거부하지 않는다.`)
    if (!/inKey\.has\(st\.id\)/.test(apply)) violations.push(`${ENG} applyCrUndo: 도장 record 가 토큰이 뜬 키의 것인지 대조하지 않는다.`)
    const finish = fnBody(eng, 'export async function finishCrUndo(') ?? ''
    if (!/signCrUndo\(/.test(finish)) violations.push(`${ENG} finishCrUndo: 적용취소 토큰에 서명하지 않는다.`)
    const parse = fnBody(lib, 'export function parseCashReceiptUndo(') ?? ''
    if (!/CASH_RECEIPT_UNDO_MAX_KEYS/.test(parse) || !/CASH_RECEIPT_UNDO_MAX_STAMPS/.test(parse)) violations.push(`${LIB} parseCashReceiptUndo: 토큰 길이 상한이 없다.`)
    if (!/l\.before && l\.after && l\.before\.id !== l\.after\.id/.test(parse)) violations.push(`${LIB} parseCashReceiptUndo: 한 줄의 쓰기 전·쓴 직후 id 가 같은지 안 본다.`)
    const undoEdit = srvFns.get('undoPaymentEdit') ?? ''
    if (!/verifyPaymentEditUndo\(propertyId, undo\)/.test(undoEdit)) violations.push(`${SRV} undoPaymentEdit: 수정 저장 토큰의 서명을 대조하지 않는다.`)
  }

  // ⓗ-7 화면 배선. 수정 폼은 한 번만 부르고 토큰 하나로 되돌린다(F1·W8), 등록 적용취소는 발행 토큰을 넘긴다(F2).
  {
    const save = list.slice(list.indexOf('const handleSaveEdit'), list.indexOf('const handleDelete'))
    if (!save || /setPaymentCashReceipt\(/.test(save)) violations.push(`${LIST} handleSaveEdit: 저장 뒤 발행 금액 문을 또 부른다. 서버가 합친 결과를 옛 금액으로 덮는다(검수 F1).`)
    if (!/cashReceiptAmount: editCrAmount/.test(save) || !/crChanged \?/.test(save)) violations.push(`${LIST} handleSaveEdit: 고친 발행 금액을 저장 한 번에 싣지 않는다(검수 F1).`)
    if (!/label: '적용취소'[\s\S]{0,300}undoPaymentEdit\(undo\)/.test(save)) violations.push(`${LIST} handleSaveEdit: 수정 저장 토스트에 적용취소(undoPaymentEdit)가 없다(검수 W8).`)
    const undoEditSig = srv.match(/export async function undoPaymentEdit\(([\s\S]*?)\):/)
    if (!undoEditSig || /crUndo/.test(undoEditSig[1])) violations.push(`${SRV} undoPaymentEdit: 토큰을 둘 받는다. 수정 저장의 적용취소 토큰은 하나다(검수 F1).`)
    const calls = [...form.matchAll(/undoOverpayExtraIncome\(([^)]*)\)/g)]
    if (calls.length < 2) violations.push(`${FORM}: 등록 적용취소(undoOverpayExtraIncome) 호출을 ${calls.length}곳밖에 못 찾았다(기대 2, 분해·과납).`)
    for (const c of calls) if (!/crUndo/.test(c[1])) violations.push(`${FORM}: 등록 적용취소가 발행 기록 토큰을 안 넘긴다: undoOverpayExtraIncome(${c[1]}) (검수 F2).`)
  }
}

// ── ⓘ 화면이 발행 금액을 말한다(2026-10-13 422호 2단계) ─────────────────────────────
//
// 422호는 판정이 아니라 화면에서 났다. 수납 행이 받은 금액 410,000 과 '발행'만 말해 420,000 발행이 410,000
// 발행으로 읽혔다. 문장은 lib/cashReceiptCopy 정본이 내고 scripts/test-cash-receipt 가 글자를 고정한다. 여기서는
// 화면이 그 정본을 **어떤 값으로** 부르는지(배선)를 본다. 판정이 맞아도 행 금액을 넘기거나 keep 을 성공으로
// 말하면 같은 거짓이 다시 선다.
{
  const TCL = 'app/(app)/tenants/TenantClient.tsx'
  const CONF = 'lib/paymentConfirm.ts'
  const COPY = 'lib/cashReceiptCopy.ts'
  const CAPC = 'components/entity-modal/widgets/CashReceiptCaption.tsx'
  const tcl = read(TCL), conf = read(CONF), copy = read(COPY), capc = read(CAPC)
  const need = (file, src, re, why) => { if (!(typeof re === 'string' ? src.includes(re) : re.test(src))) violations.push(`${file} — ${why}`) }
  const between = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return null; const j = src.indexOf(b, i + a.length); return j < 0 ? null : src.slice(i, j) }

  // ⓘ-1 행 캡션의 기준은 키(같은 날·같은 수단)의 이용료 합이다. 행 금액으로 되돌리면 분할 결제마다 거짓 경보가 선다(D12).
  const CAP_CALL = /cashReceiptRowCaption\(\{ stamped: !!p\.cashReceiptIssuedAt, key: p\.cashReceiptKey \}\)/
  need(LIST, list, CAP_CALL, '행 캡션이 서버 키 정보(p.cashReceiptKey)를 그대로 넘기지 않는다. 기준이 행 금액으로 갈 수 있다.')
  need(TCL, tcl, CAP_CALL, '입주자 수납 모달 행 캡션이 서버 키 정보(p.cashReceiptKey)를 그대로 넘기지 않는다.')
  const capFn = fnBody(copy, 'export function cashReceiptRowCaption(')
  if (!capFn) violations.push(`${COPY}: cashReceiptRowCaption 몸통을 못 찾았다(침묵 통과 금지).`)
  else {
    if (!capFn.includes('crCoveredRent(input.key)')) violations.push(`${COPY} cashReceiptRowCaption: 차이를 키의 도장 찍힌 이용료 몫(crCoveredRent)으로 재지 않는다.`)
    if (/actualAmount/.test(capFn)) violations.push(`${COPY} cashReceiptRowCaption: 행 금액(actualAmount)을 본다. 기준은 키의 이용료 합이다.`)
    // '합산'·'같은 날 입금 N건'의 N 은 도장 찍힌 행 수다(독립 검수 R-2). 금액이 든 행 수로 세면 도장 하나뿐인 키에도 '합산'이 선다.
    if (!/const n = input\.key\.stampedRentRows/.test(capFn)) violations.push(`${COPY} cashReceiptRowCaption: 합산 판정이 도장 찍힌 행 수(stampedRentRows)가 아니다(검수 R-2).`)
  }
  {
    const cov = fnBody(copy, 'export function crCoveredRent(')
    if (!cov || !/k\.stampedRentRows > 0 \? k\.rent - k\.unstampedRent : k\.rent/.test(cov)) violations.push(`${COPY} crCoveredRent: 일부만 도장 찍힌 키의 비교 기준이 도장 찍힌 몫이 아니다(검수 R-2).`)
    // 반환 타입이 객체 리터럴이라 fnBody 가 그 중괄호를 몸통으로 집는다. 함수 끝(줄머리 '}')까지 자른다.
    const tg = between(copy, 'export function cashReceiptTabGap(', '\n}\n')
    if (!tg || !tg.includes('crCoveredRent(') || !tg.includes('r.stampedRentRows >= 2')) violations.push(`${COPY} cashReceiptTabGap: 탭이 수납 행 캡션과 다른 기준(비교 몫·합산 행 수)을 쓴다(검수 R-2).`)
  }

  // ⓘ-2 자리와 접근성. 줄2 다음의 독립 줄이고(체크 label·왼쪽 묶음 안 금지), 체크 input 이 캡션을 aria-describedby 로 가리킨다.
  need(LIST, list, '<CashReceiptCaption caption={crCap} id={crCapId} />', '행 캡션이 id 를 달고 서지 않는다.')
  need(LIST, list, 'aria-describedby={crCap ? crCapId : undefined}', '체크 input 이 캡션을 aria-describedby 로 가리키지 않는다.')
  {
    const at = list.indexOf('onChange={() => handleToggleCashReceipt(p)}')
    const lab = at < 0 ? null : list.slice(list.lastIndexOf('<label', at), list.indexOf('</label>', at))
    if (!lab) violations.push(`${LIST} — 원터치 체크 label 을 못 찾았다(침묵 통과 금지).`)
    else if (lab.includes('CashReceiptCaption')) violations.push(`${LIST} — 캡션이 체크 label 안에 있다. 44px 히트영역 안이라 캡션을 눌러도 토글된다.`)
    const capAt = list.indexOf('<CashReceiptCaption'), row2End = list.indexOf('handleDelete(p)}>삭제</RowActionBtn>'), askAt = list.indexOf('{crAskId === p.id && (')
    if (capAt < 0 || row2End < 0 || askAt < 0 || !(capAt > row2End && capAt < askAt)) violations.push(`${LIST} — 캡션이 줄2 바로 뒤(삭제 버튼 묶음 뒤, 켜기 확인 줄 앞)에 서지 않는다.`)
    const tAt = tcl.indexOf('<CashReceiptCaption caption={crCap}'), tDel = tcl.indexOf('handleDeletePayRecord(p)}>삭제</RowActionBtn>')
    if (tAt < 0 || tDel < 0 || tAt < tDel) violations.push(`${TCL} — 입주자 수납 모달 캡션이 행 아래 한 줄(삭제 버튼 뒤)이 아니다. 왼쪽 칸 안이면 오른쪽 금액이 접힌다.`)
  }
  for (const [cls, why] of [
    ['num text-[0.65625rem]', '캡션 글자 크기·숫자 폰트'], ['flex flex-wrap gap-x-1', '덩이 사이에서만 접힘'], ['whitespace-nowrap', '덩이를 한 줄로 묶음'],
    ['font-semibold text-[var(--warm-dark)]', '숫자 강조'], ['text-[var(--warning-fg)]', '다를 때 경고색(목록 전용)'],
  ]) need(CAPC, capc, cls, `캡션 컴포넌트에 ${why}(${cls})가 없다.`)

  // ⓘ-3 켜기 확인 줄은 기록될 발행 금액을 읽기 전용으로 먼저 보이고(서버 미리보기) 발행일은 그다음이다.
  {
    const tog = between(list, 'const handleToggleCashReceipt', 'startTransition(')
    if (!tog || !tog.includes('previewCashReceiptOn(p.id)')) violations.push(`${LIST} — 켜기를 누를 때 발행 금액 미리보기(previewCashReceiptOn)를 안 부른다.`)
    const ask = between(list, '{crAskId === p.id && (', 'confirmCashReceiptOn(p, crShownYmd)')
    if (!ask) violations.push(`${LIST} — 켜기 확인 줄을 못 찾았다(침묵 통과 금지).`)
    else {
      if (!ask.includes('fmtWon(crPvOk.amount)')) violations.push(`${LIST} — 켜기 확인 줄이 기록될 발행 금액을 안 보인다.`)
      const amtAt = ask.indexOf('발행 금액'), dateAt = ask.indexOf('발행일')
      if (amtAt < 0 || dateAt < 0 || amtAt > dateAt) violations.push(`${LIST} — 켜기 확인 줄 순서가 '발행 금액 먼저, 발행일 다음'이 아니다(일괄 발행 모달과 같은 순서).`)
      if (!ask.includes('crAddPreviewChunks(crPvOk.current, crPvOk.added)')) violations.push(`${LIST} — 새 돈을 더하는 켜기(add)가 지켜지는 앞 발행일을 말하지 않는다.`)
      // 웹디자이너 F2: 고른 날짜가 안 쓰이는 켜기(add·keep·none)면 발행일 칸을 잠그고 지켜지는 날짜를 보인다.
      if (!/<DatePicker value=\{crShownYmd\}[^>]*disabled=\{crLocked\}/.test(ask)) violations.push(`${LIST} — 켜기 확인 줄 발행일 칸이 add·keep·none 에서 잠기지 않는다(웹디자이너 F2).`)
      if (!/const crLocked = !!crPvOk && crPvOk\.kind !== 'create' && crPvOk\.kind !== 'rebuild'/.test(list)) violations.push(`${LIST} — 발행일 칸 잠금 판정이 create·rebuild 밖 전부가 아니다(웹디자이너 F2).`)
      // 그물 구멍 U11(독립 검수 R-8): none·keep 에서 기록 버튼이 열려 있으면 눌러야 거절되거나 아무 일도 안 일어난다.
      if (!/const crOnBlocked = crPv === null \|\| \(crPv !== 'net' && \(!crPv\.ok \|\| crPv\.kind === 'none' \|\| crPv\.kind === 'keep'\)\)/.test(list)
        || !ask.includes('disabled={pending || crOnBlocked}')) violations.push(`${LIST} — 켜기 확인 줄 기록 버튼이 읽는 중·서버 거절·none·keep 에서 막히지 않는다(검수 R-8 U11).`)
      // 웹디자이너 R2·R3: 실패를 대시로만 보이지 않고(§29 em dash 금지) 이유를 말한다. 읽는 중은 스켈레톤, 금액 묶음은 aria-live.
      if (/'—'|'…'/.test(ask)) violations.push(`${LIST} — 켜기 확인 줄이 읽는 중·실패를 기호(…·—)로만 보인다(웹디자이너 R2·R3).`)
      if (!/const crPvFail = [^\n]*CR_PREVIEW_UNREAD : crPv\.error/.test(list) || !ask.includes('{crPvFail &&') || !ask.includes('<Skeleton') || !ask.includes('aria-live="polite"')) violations.push(`${LIST} — 켜기 확인 줄의 실패 이유·읽는 중 스켈레톤·aria-live 중 빠진 것이 있다(웹디자이너 R2·R3).`)
      // 독립 검수 R-5·R-1: 재발행이 바꾸는 앞 발행, 받은 금액과 다른 기록 금액을 누르기 전에 말한다.
      if (!ask.includes('crReplacePreview(crPvOk.current)')) violations.push(`${LIST} — 환불 확정 재발행이 바꿀 앞 발행을 확인 줄이 말하지 않는다(검수 R-5).`)
      if (!/cashReceiptGapSentence\(crPvOk\.amount, crPvOk\.keyRent\)/.test(list)) violations.push(`${LIST} — 확인 줄이 기록될 금액과 받은 금액의 차이를 말하지 않는다(검수 R-1).`)
      if (/<MoneyInput|<input/.test(ask)) violations.push(`${LIST} — 켜기 확인 줄에 금액 입력칸이 있다. 발행 금액을 고치는 자리는 수정 폼 하나다(2026-08-25).`)
    }
  }

  // ⓘ-4 삭제 확인창이 발행 기록에 일어날 일을 말한다(미리보기, 정본 한 줄, 끝 줄 앞).
  need(CONF, conf, 'crDeleteConfirmLine(cr)', '삭제 확인창이 발행 기록 한 줄(crDeleteConfirmLine)을 안 만든다.')
  need(CONF, conf, "[body, crLine, '삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.']", '발행 기록 한 줄이 본문 끝 줄(적용취소 안내) 앞에 서지 않는다.')
  if (/toLocaleString\(/.test(conf)) violations.push(`${CONF} — 금액을 toLocaleString 으로 적는다(가이드 §06, fmtWon 정본).`)
  for (const [file, src, fn] of [[LIST, list, 'const handleDelete = async'], [TCL, tcl, 'const handleDeletePayRecord = async']]) {
    const b = between(src, fn, 'startTransition(')
    if (!b) { violations.push(`${file} — 삭제 핸들러를 못 찾았다(침묵 통과 금지).`); continue }
    const pvAt = b.indexOf('previewPaymentDelete(p.id)'), cfAt = b.indexOf('confirmDeletePayment(p, pv?.ok ? pv : null)')
    if (pvAt < 0 || cfAt < 0 || pvAt > cfAt) violations.push(`${file} — 삭제 확인창 전에 미리보기(previewPaymentDelete)를 읽어 넘기지 않는다.`)
  }

  // ⓘ-5 토스트는 정본 문장을 지난다. keep(바뀐 것 없음)은 성공으로 말하지 않고 적용취소도 안 단다.
  {
    const onFn = between(list, 'const confirmCashReceiptOn', 'if (records === null)')
    if (!onFn) violations.push(`${LIST} — 켜기 확정 함수를 못 찾았다(침묵 통과 금지).`)
    else {
      if (!onFn.includes('crOnToast(res, ymd)') || !onFn.includes('pushToast(t.kind, t.message')) violations.push(`${LIST} — 켜기 토스트가 정본(crOnToast)의 종류·문장을 안 쓴다. keep 이 성공으로 나간다.`)
      if (!onFn.includes('...(t.undoable ?')) violations.push(`${LIST} — 켜기 토스트가 바뀐 것 없는 keep 에도 적용취소를 단다(가짜 적용취소).`)
      if (/pushToast\('success'/.test(onFn)) violations.push(`${LIST} — 켜기 토스트에 성공 종류를 손으로 박았다.`)
      if (!onFn.includes('crOnUndoneMessage(r.line)')) violations.push(`${LIST} — 켜기 적용취소 결과 토스트가 없거나 돌아온 앞 발행을 말하지 않는다(§16 적용취소 후에도 결과 토스트).`)
    }
    need(LIST, list, 'crOffToastDetail(res.dropped', '끄기 토스트가 발행 합계에서 빠지는 금액을 말하지 않는다.')
    need(LIST, list, 'crOffUndoneMessage(r.line)', '끄기 적용취소 결과 토스트가 없다.')
    for (const [file, src] of [[LIST, list], [TCL, tcl]]) {
      need(file, src, 'crDeleteToastDetail(res.cashReceipt)', '삭제 토스트가 발행 기록에 일어난 일을 말하지 않는다.')
      need(file, src, /pushToast\('info', CR_DELETE_UNDONE, /, '삭제 적용취소 결과 토스트가 없다.')
      need(file, src, 'crRestoreDetail(r.cashReceipt)', '삭제 적용취소 결과가 되살린 발행 기록을 말하지 않는다.')
      need(file, src, 'crEditToastDetail(res.cashReceipt', '수정 저장 토스트가 발행 줄에 일어난 일을 말하지 않는다.')
    }
  }

  // ⓘ-6 두 폼의 발행 금액 힌트는 한 정본 문장이고, 수정 폼의 기준은 키의 이용료 합이다.
  need(FORM, form, 'cashReceiptGapSentence(crShownAmount, payAmount)', '등록 폼 힌트가 정본 문장(cashReceiptGapSentence)을 안 쓴다.')
  need(LIST, list, 'cashReceiptGapSentence(editCrAmount, crBasis)', '수정 폼 힌트가 정본 문장(cashReceiptGapSentence)을 안 쓴다.')
  need(LIST, list, /const crBasis = editPvOk\s*\?\s*editPvOk\.keyRent\s*:\s*editAmount \+ \(sameKey \? \(p\.cashReceiptKey \? crCoveredRent\(p\.cashReceiptKey\)/, '수정 폼 힌트의 기준이 미리보기의 저장 뒤 몫이나 키의 도장 찍힌 이용료 몫(crCoveredRent)이 아니다(D12·R-2, 분할 결제 거짓 경보).')
  // 독립 검수 F-A: 수정 폼 발행 금액 칸·힌트가 저장 결과와 같은 말을 한다. 미발행 행을 켜거나 입금일·수단을 옮기면 서버
  // 미리보기(정본 판정 planCashReceiptEdit)를 불러 칸·프리필을 '기록될 금액'으로 옮기고, 옮김 갈래에서는 칸을 숨긴다.
  {
    const pvFn = fnBody(srv, 'export async function previewPaymentEditCr(')
    if (!pvFn || !pvFn.includes('planCashReceiptEdit(') || !pvFn.includes('resolveCashReceiptIssuedAt(')) violations.push(`${SRV} previewPaymentEditCr — 저장(updatePayment)과 같은 정본 판정을 안 지난다(검수 F-A).`)
    need(LIST, list, 'previewPaymentEditCr(editingId, {', '수정 폼이 기록될 발행 금액 미리보기를 안 부른다(검수 F-A, N2·N3).')
    need(LIST, list, /setEditCrAmount\(cur => \(cur === pf \? amt : cur\)\)\s*setEditCrPrefill\(prev => \(\{ \.\.\.prev, amount: amt \}\)\)/, '수정 폼 칸·프리필이 기록될 금액으로 안 옮겨진다. 칸과 저장 결과가 갈린다(검수 F-A).')
    need(LIST, list, /editPvMovedAway \? \(\s*<p[^>]*>\{CR_EDIT_MOVED_NOTE\}<\/p>/, '옮김 갈래(transfer·merge·unstamp)에서 칸을 숨기고 그 사실을 적지 않는다(검수 F-A).')
    need(LIST, list, "const editPvMovedAway = editPvOk?.kind === 'transfer' || editPvOk?.kind === 'merge' || editPvOk?.kind === 'unstamp'", '옮김 갈래 판정이 transfer·merge·unstamp 셋이 아니다. 서버가 안 쓰는 칸이 보인다(검수 F-A, 역주입 X26).')
    need(LIST, list, 'disabled={pending || editPvLoading}', '기록될 금액을 읽는 동안 수정 저장이 열려 있다(검수 F-A).')
    // 그물 구멍 U7(독립 검수 R-8): 입력 폼은 경고색을 안 쓴다(운영자 결정 2026-08-25). 수정 폼 블록 안에 경고색이 없어야 한다.
    const editBlock = between(list, 'if (editingId === p.id) {', 'className={`rounded-sm px-3 py-2.5 space-y-1.5 ${')
    if (!editBlock) violations.push(`${LIST} — 수정 폼 블록을 못 찾았다(침묵 통과 금지).`)
    else if (/--warning-fg/.test(editBlock)) violations.push(`${LIST} — 수정 폼(입력 폼)이 경고색(--warning-fg)을 쓴다. 경고색은 목록에만 쓴다(운영자 결정 2026-08-25, 검수 R-8 U7).`)
  }
  for (const [file, src] of [[FORM, form], [LIST, list]]) {
    if (/>\s*받은 금액 \{fmtWon\(/.test(src)) violations.push(`${file} — 발행 금액 힌트 문장을 손으로 적었다. 두 폼이 갈린다.`)
  }

  // ⓘ-7 탭 발행 내역 행이 받은 금액 대비를 말하고, 덩이 단위로만 한 줄로 묶는다(조각 전체를 묶으면 넘친다).
  need(TAB, tab, 'cashReceiptTabGap(r)', '탭 발행 내역 행이 받은 금액 대비(cashReceiptTabGap)를 안 쓴다.')
  {
    const g = between(tab, '{gap ?', 'gap.units.map(')
    if (!g) violations.push(`${TAB} — 받은 금액 대비 조각을 덩이(gap.units)로 그리지 않는다.`)
    else if (g.includes('whitespace-nowrap')) violations.push(`${TAB} — 받은 금액 대비 조각 전체를 한 줄로 묶었다. 메타 칸보다 길어 넘친다(하네스 실측).`)
  }
  const tabFn = fnBody(srv, 'export async function getCashReceiptTabRows(')
  if (!tabFn || !/received: p\.rent, rentRows: p\.rentRows, stampedRentRows: p\.stampedRentRows, unstampedRent: p\.unstampedRent/.test(tabFn)) violations.push(`${SRV} getCashReceiptTabRows — 발행 내역 행에 받은 몫·행 수·도장 찍힌 행 수·도장 없는 몫을 안 싣는다(검수 R-2).`)
  // 탭 숫자는 수납 행 캡션처럼 굵게·본문색(웹디자이너 F3), 구분점은 앞 낱말에 붙는다(R1).
  need(TAB, tab, '<strong key={j} className="num font-semibold text-[var(--warm-dark)]">', '탭 받은 금액 대비 숫자가 굵게·본문색이 아니다(웹디자이너 F3).')
  need(TAB, tab, "const SEP = '\\u00A0· '", "탭 메타 줄 구분점이 앞 낱말에 붙지 않는다. 접히면 둘째 줄이 '·' 로 시작한다(웹디자이너 R1).")
}

console.log(`[받을 때 발행 대상] 축 ⓐ 폼 기본값 · ⓑ 판정·쓰기 한 자리 · ⓒ 보증금 도장 · ⓓ 후보 필터 · ⓔ 홈 의무 기준 · ⓕ 경고 두 종 · ⓖ 탭 문구 · ⓗ 생애주기 배선 · ⓘ 화면의 발행 금액 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  받을 때 발행 대상은 이용료 몫뿐이다(운영자 확정 2026-09-21). 보증금은 돌려줄 돈이고')
  console.error('  청소비는 퇴실 정산에서 보증금에서 떼는 몫이라, 받는 시점에는 아직 이 사업장의 대가가 아니다.')
  process.exit(1)
}
