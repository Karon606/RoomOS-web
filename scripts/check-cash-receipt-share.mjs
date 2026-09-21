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

const form = read(FORM)
const list = read(LIST)
const srv  = read(SRV)
const home = read(HOME)
const tab  = read(TAB)
const lib  = read(LIB)

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
  const em = list.match(/setEditCrIncl\(line[\s\S]{0,300}?\}\)/)
  if (!em) {
    violations.push(`${LIST} — setEditCrIncl(line …) 를 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else {
    if (!/CASH_RECEIPT_DEFAULT_INCL/.test(em[0])) {
      violations.push(`${LIST} — 발행 줄이 없을 때의 기본 구성이 정본 상수가 아니다.`)
    }
    if (/deposit:\s*(true|!!)/.test(em[0])) {
      violations.push(`${LIST} — 기본 구성이 받은 몫을 보고 보증금을 켠다. 그것이 2026-09-21 에 닫힌 옛 규칙이다.`)
    }
  }
}

// ── ⓑ 저장 세 문이 이용료 몫을 기본값으로 쓰는가 ────────────────────────
//
// 셋이 각자 폴백을 갖고 있어 하나만 옛 모양으로 남아도 그 경로로 들어온 입금은 전액이 적힌다.
for (const fn of ['touchCashReceiptIssuedAt', 'setPaymentCashReceipt', 'batchSetCashReceipts']) {
  const b = fnBody(srv, `function ${fn}(`)
  if (!b) { violations.push(`${SRV} — ${fn} 몸통을 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`); continue }
  if (!/paymentCompositionFor\(/.test(b)) {
    violations.push(`${SRV} ${fn} — 입금 구성을 안 읽는다. 몫을 모르면 이용료 몫만 적을 수가 없다.`)
  }
  if (!/cashReceiptIssuableAmount\(/.test(b)) {
    violations.push(`${SRV} ${fn} — 발행 대상 금액 정본(cashReceiptIssuableAmount)을 안 쓴다.`)
  }
  if (/amount[^\n]*[:=][^\n]*c\.total/.test(b)) {
    violations.push(`${SRV} ${fn} — 발행 금액에 입금 전액(c.total)이 되살아났다. 보증금·청소비가 함께 올라간다.`)
  }
  if (/c\.deposit\s*>\s*0/.test(b)) {
    violations.push(`${SRV} ${fn} — 받은 몫이 있으면 켜는 옛 incl 조립이 되살아났다. 기본은 꺼짐이다.`)
  }
  if (!/CASH_RECEIPT_DEFAULT_INCL/.test(b)) {
    violations.push(`${SRV} ${fn} — 몫 기본값이 정본 상수가 아니다. 서버와 화면이 갈린다.`)
  }
  // **정본을 부르되 결과를 안 쓰는 길을 막는다**(독립 검수 2026-09-22). 호출 존재만 보면
  // `cashReceiptIssuableAmount(c) + c.deposit + c.cleaning` 도 통과하고, `c.deposit > 0` 을
  // `!!c.deposit` 으로 적기만 해도 옛 조립이 되살아난다. 이 세 문에서 몫을 직접 만지는 길을
  // 통째로 닫는다 — 몫 판단은 lib/cashReceipt 정본 한 자리에서만 한다.
  for (const m of b.match(/c\.(deposit|cleaning|total)\b/g) ?? []) {
    violations.push(`${SRV} ${fn} — 입금 구성을 직접 만진다(${m}). 발행 대상 금액은 정본 함수가 정한다.`)
  }
}
{
  const n = (srv.match(/cashReceiptIssuableAmount\(/g) ?? []).length
  if (n < 3) violations.push(`${SRV} — cashReceiptIssuableAmount 호출이 ${n}곳뿐이다. 저장 세 문이 다 지나야 한다.`)
  // **넷째 저장 문이 생기면 여기서 걸린다**(독립 검수 2026-09-22). 위 루프는 이름 셋을 박아
  // 두므로, `syncCashReceiptLine` 을 부르는 새 액션을 만들면 검사 대상 밖에서 전액을 적을 수
  // 있었다. 부르는 자리 수를 못박아 새 문이 생기면 이 그물부터 고치게 한다.
  const calls = (srv.match(/\bawait syncCashReceiptLine\(/g) ?? []).length
  if (calls !== 3) {
    violations.push(`${SRV} — syncCashReceiptLine 을 부르는 자리가 ${calls}곳이다(기대 3). 저장 문이 늘었으면 위 이름 목록과 이 수를 함께 고친다.`)
  }
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
  // **분기마다 세야 한다.** 두 함수 모두 줄을 지우는 분기와 쓰는 분기가 따로 있어, 존재만 보면
  // 한쪽을 지워도 통과한다(역주입에서 실제로 통과했다). 지우는 쪽만 남으면 예외 발행에 도장이
  // 안 따라가고, 쓰는 쪽만 남으면 줄을 내려도 도장이 남는다.
  for (const fn of ['syncCashReceiptLine', 'touchCashReceiptIssuedAt']) {
    const b = fnBody(srv, `function ${fn}(`)
    if (!b) { violations.push(`${SRV} — ${fn} 몸통을 못 찾았다(침묵 통과 금지).`); continue }
    const n = (b.match(/alignDepositReceiptStamp\(/g) ?? []).length
    if (n < 2) {
      violations.push(`${SRV} ${fn} — 보증금 도장 정렬 호출이 ${n}곳뿐이다. 줄을 지우는 분기와 쓰는 분기 둘 다 맞춰야 도장과 줄이 안 갈린다.`)
    }
    // **개수만 세면 인자를 뒤집어도 통과한다**(독립 검수 2026-09-22). 지우는 분기는 반드시
    // `issuedAt: null, inclDeposit: false` 여야 하고, 쓰는 분기는 그 줄의 구성을 따라야 한다.
    // 한쪽에 `inclDeposit: true` 를 박으면 줄은 이용료만인데 도장은 보증금에 남는다.
    for (const call of b.match(/alignDepositReceiptStamp\(\{[^}]*\}/g) ?? []) {
      if (/issuedAt:\s*null/.test(call) && !/inclDeposit:\s*false/.test(call)) {
        violations.push(`${SRV} ${fn} — 줄을 내리면서 도장을 안 내린다: ${call.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
      if (/inclDeposit:\s*true\b/.test(call)) {
        violations.push(`${SRV} ${fn} — 도장 정렬에 inclDeposit: true 가 박혀 있다. 그 값은 줄의 구성에서 와야 한다.`)
      }
    }
  }
  // **줄을 내리는 문마다 도장도 내려야 한다**(독립 검수 2026-09-22). 종전에는 정렬이 두 함수에만
  // 걸려 있어, 수납 이동·일괄 적용취소·수납 삭제 셋은 줄만 내리고 도장을 남겼다. 줄을 내리는
  // 자리 수와 도장을 내리는 자리 수를 맞춰 새 경로가 생기면 여기서 걸리게 한다.
  {
    const drops = (srv.match(/cashReceipt\.update\([^)]*deletedAt: new Date\(\)/g) ?? []).length
    const aligns = (srv.match(/alignDepositReceiptStamp\(\{[^}]*inclDeposit:\s*false[^}]*\}/g) ?? []).length
    if (drops !== aligns) {
      violations.push(`${SRV} — 발행 줄을 내리는 자리 ${drops}곳에 도장을 내리는 자리가 ${aligns}곳이다. 줄만 내리면 도장이 남아 화면이 '발행됨'을 계속 말한다.`)
    }
  }
  const sib = fnBody(srv, 'export async function setCashReceiptIssued(')
  if (!sib) {
    violations.push(`${SRV} — setCashReceiptIssued 몸통을 못 찾았다(침묵 통과 금지).`)
  } else {
    const find = argBlock(sib, 'prisma.paymentRecord.findMany(')
    if (!find || !/isDeposit:\s*true/.test(find)) {
      violations.push(`${SRV} setCashReceiptIssued — 형제 조회가 isDeposit 을 안 읽는다. 보증금 형제를 가려낼 수 없다.`)
    }
    // 값을 읽기만 하고 안 쓰는 길을 막는다 — `const x = t.isDeposit; void x` 로도 통과했다.
    if (!/if \(t\.isDeposit\) continue/.test(sib)) {
      violations.push(`${SRV} setCashReceiptIssued — 보증금 형제를 건너뛰는 continue 가 없다. 토글 한 번에 보증금에도 도장이 찍힌다.`)
    }
    // **건너뛴 뒤 남는 null 이 켜기를 지우기로 만든다**(독립 검수 2026-09-22). 형제가 전부
    // 보증금이면 lastNext 가 null 인 채로 내려가 있던 줄을 소프트삭제하고, 화면에는 성공
    // 토스트가 뜬다. 다른 저장 문 셋처럼 실패를 돌려줘야 한다.
    if (!/issued && lastNext == null/.test(sib)) {
      violations.push(`${SRV} setCashReceiptIssued — 이용료 형제가 없을 때의 가드가 없다. 켜기가 있던 줄을 지우고 성공이라 답한다.`)
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

console.log(`[받을 때 발행 대상] 축 ⓐ 폼 기본값 · ⓑ 저장 세 문 · ⓒ 보증금 도장 · ⓓ 후보 필터 · ⓔ 홈 의무 기준 · ⓕ 경고 두 종 · ⓖ 탭 문구 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  받을 때 발행 대상은 이용료 몫뿐이다(운영자 확정 2026-09-21). 보증금은 돌려줄 돈이고')
  console.error('  청소비는 퇴실 정산에서 보증금에서 떼는 몫이라, 받는 시점에는 아직 이 사업장의 대가가 아니다.')
  process.exit(1)
}
