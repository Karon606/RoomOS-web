// 서류 발급 문의 판정이 사본으로 갈라지는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. '이번 달 확인서 작성' 문은 두 사실의 곱으로 열린다. 최신 발급본이 이번 달 것이
// 아니고, 그 계약에 이번 달 실입금이 있을 때다. 그 둘의 판정이 각각 두 자리에서 필요해졌다.
//   · 실입금 — 발급 화면이 금액을 채울 때, 서류 시트가 문을 열지 정할 때.
//   · 이번 달 것인가 — 서류 시트의 보조 문구와 문 판정.
// 사본을 두면 한 자리만 고쳐지는 날이 오고, 그때 **문은 열렸는데 금액은 0** 이거나 그 반대가 된다.
//
//   ⓐ 실입금 판정은 lib/rentPaid 정본만 한다. 소비처가 where 를 손으로 다시 적으면 위반.
//   ⓑ 문 판정(canWriteNew)은 lib/docBundle 정본만 세운다. 화면이 직접 계산하면 위반.
//   ⓒ stale 판정은 귀속월을 본다. 발행일 단독으로 되돌아가면 위반(선납 중복 발급이 되살아난다).
//   ⓓ 보조 문구 리터럴은 정본 상수(DOC_STALE_NOTE) 하나다. 화면이 같은 문장을 손으로 적으면
//      닫힘 문단이 그 조각을 못 걷어내 겹말이 된다.
//
// 실행: node scripts/check-doc-write-gate.mjs
import { readFileSync } from 'node:fs'

const violations = []
const read = f => readFileSync(f, 'utf8')
// 줄 수를 보존한다(`\s*` 는 m 플래그에서 줄바꿈을 먹는다).
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

const LIB = 'lib/rentPaid.ts'
const BUNDLE = 'lib/docBundle.ts'
const SHEET = 'components/doc/TenantDocBundleSheet.tsx'
// 실입금을 세는 소비처들 — 정본을 import 해야 한다.
const CONSUMERS = ['app/rent-receipt/[tenantId]/actions.ts', 'app/(app)/tenants/docBundle.ts']

// ⓐ 정본이 살아 있고, 소비처가 그것을 쓴다.
{
  const lib = strip(read(LIB))
  for (const name of ['isRealRentPayment', 'rentPaidWhere']) {
    if (!new RegExp(`export function ${name}\\b`).test(lib)) {
      violations.push(`${LIB} — ${name} 이 사라졌다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
    }
  }
  for (const f of CONSUMERS) {
    const src = strip(read(f))
    if (!/from '@\/lib\/rentPaid'/.test(src)) {
      violations.push(`${f} — 실입금 판정을 lib/rentPaid 에서 안 가져온다. 사본이 검증하는 것은 사본 자신이다.`)
    }
    // where 를 손으로 다시 적었는가 — 조정 전표 제외가 정본의 핵심 조각이다.
    src.split('\n').forEach((line, i) => {
      if (/isBillingAdjust:\s*false/.test(line) && /isDeposit:\s*false/.test(line)) {
        violations.push(`${f}:${i + 1} 실입금 where 를 손으로 다시 적었다. rentPaidWhere 를 쓴다.`)
      }
    })
  }
}

// ⓑ 문 판정은 정본만 세운다.
{
  const bundle = strip(read(BUNDLE))
  if (!/canWriteNew = paidThisMonth\.has\(/.test(bundle)) {
    violations.push(`${BUNDLE} — canWriteNew 를 정본이 안 세운다. 문 판정이 화면으로 새면 자리마다 갈린다.`)
  }
  if (!/!l\.isShortTerm/.test(bundle)) {
    violations.push(`${BUNDLE} — 단기 계약 제외가 사라졌다. 발급 화면이 대상월을 입주월로 고정해 링크 라벨이 거짓이 된다.`)
  }
  const sheet = strip(read(SHEET))
  if (/canWriteNew\s*=[^=]/.test(sheet)) {
    violations.push(`${SHEET} — 화면이 문 판정을 직접 계산한다. 정본이 내린 값을 읽기만 한다.`)
  }
}

// ⓒ stale 은 귀속월을 본다.
{
  const bundle = strip(read(BUNDLE))
  const fn = bundle.match(/const staleNote = [^\n]*\n?[^\n]*/)
  if (!fn) violations.push(`${BUNDLE} — staleNote 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  else if (!/targetMonth/.test(fn[0])) {
    violations.push(`${BUNDLE} — stale 판정이 귀속월을 안 본다. 8월에 발급한 9월분이 9월에 stale 로 떠 같은 달 확인서가 두 장 나간다.`)
  }
  // 발급 저장 경로가 귀속월을 적는가 — 안 적으면 위 판정이 영영 폴백만 탄다.
  const route = strip(read('app/api/rent-receipt/generate/route.ts'))
  if (!/targetMonth:/.test(route)) {
    violations.push(`app/api/rent-receipt/generate/route.ts — 발급본에 귀속월을 안 적는다. stale 판정이 영영 발행일 폴백만 탄다.`)
  }
}

// ⓓ 보조 문구는 정본 상수 하나.
{
  if (!/export const DOC_STALE_NOTE\b/.test(strip(read(BUNDLE)))) {
    violations.push(`${BUNDLE} — DOC_STALE_NOTE 상수가 사라졌다.`)
  }
  const sheet = strip(read(SHEET))
  // 따옴표를 요구하면 안 된다 — JSX 본문의 맨 텍스트에는 따옴표가 없다(첫 판이 그걸로 놓쳤다).
  if (/이번 달 발급본이 아닙니다/.test(sheet)) {
    violations.push(`${SHEET} — 보조 문구를 리터럴로 적었다. 정본 상수를 쓴다(닫힘 문단이 그 조각을 걷어낸다).`)
  }
}

console.log(`[서류 발급 문] 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
