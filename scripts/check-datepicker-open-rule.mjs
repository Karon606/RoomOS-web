// DatePicker 열기 규칙 감지망 — 열 때마다 지금 값의 달(값이 없으면 기준 달, 그것도 없으면 오늘의 달)을 여는가.
// 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 2026-10-19 납부 확인서 발행일 "다른 월로 넘어가면 해당 달력이 먼저 떠야 하는데 오늘 날짜의
// 달력이 떠"). 뿌리가 둘이었다. 화면이 발행일을 대상월과 무관하게 오늘로 두었고(RentReceiptView), 공용 DatePicker 가
// 보던 달을 마운트 때 한 번만 잡아 달을 넘겨 보다 닫으면 다음에 그 달이 다시 떴다. 둘째는 공용 컨트롤이라 호출부
// 전부(98곳)가 같은 결함을 나눠 가졌다. 정본에서 고쳤고, 이 그물은 그 규칙이 조용히 풀리는 것과 손수 만든 달력이
// 새로 서는 것을 잡는다.
//
//   ⓐ handleOpen 이 여는 순간 보는 달(연·월·연도 범위)을 다시 잡는다. 화면이 여는 달(openMonth) → 값 → 기준 달(defaultMonth) → 오늘 순서다.
//      openMonth 는 화면이 채운 기본값을 사용자가 아직 안 고친 동안만 넘긴다(2026-10-21).
//   ⓑ 날짜 격자 달력은 DatePicker 하나다. 7칸 격자(grid-cols-7)에 날짜 칸을 그리는 파일이 또 서면 손수 만든 달력이다.
//      요일 배열만으로는 안 본다. 날짜 표기 '(화)'를 만드는 형식 함수가 여럿이다(달력이 아니다).
//   ⓒ 브라우저 기본 날짜 입력(type="date"·"month")은 명단에 있는 자리뿐이다(사유는 명단에 적는다).
//   ⓓ 가이드 §12 에 'DatePicker 열기 규칙' 한 줄이 있다.
//
// 실행: node scripts/check-datepicker-open-rule.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
const PICKER = 'components/ui/DatePicker.tsx'

// ⓐ 열기 규칙.
{
  const s = strip(readFileSync(PICKER, 'utf8'))
  const open = s.match(/const handleOpen = \(\) => \{[\s\S]*?\n {2}\}/)
  if (!open) violations.push(`${PICKER} — handleOpen 을 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  else {
    for (const need of ['openAnchor()', 'setViewYear(', 'setViewMonth(', 'setYearBase(']) {
      if (!open[0].includes(need)) violations.push(`${PICKER} — 열 때 ${need} 로 보는 달을 다시 잡지 않는다(지난번에 넘겨 보던 달이 뜬다).`)
    }
  }
  const anchor = s.match(/const openAnchor = [\s\S]*?\n {2}\}/)
  if (!anchor || !/ym\(openMonth\) \|\| value \|\| ym\(defaultMonth\)/.test(anchor[0]) || !/todayYear/.test(anchor[0])) {
    violations.push(`${PICKER} — 여는 달의 순서(여는 달 → 값 → 기준 달 → 오늘)가 아니다.`)
  }
  if (!/defaultMonth\?: string/.test(s)) violations.push(`${PICKER} — 기준 달(defaultMonth) 프롭이 사라졌다.`)
}

// ⓑ·ⓒ 손수 만든 달력·기본 날짜 입력.
// 기본 날짜 입력 명단 — 왜 정본이 아닌지 적는다. 늘릴 때도 사유를 적는다.
const NATIVE_OK = new Map([
  // 툴바 칩이다. 옆 성명 select 와 한 규칙(.rc-field input, .rc-field select)으로 같은 모양을 받는다(그 파일 주석).
  ['app/residence-cert/[tenantId]/ResidenceCertView.tsx', 'date'],
  // 계약서 툴바의 계약일 칩. 실거주 확인서 툴바와 같은 문법(.toolbar-field).
  ['app/contract/[tenantId]/ContractView.tsx', 'date'],
  // 귀속월 점검 도구(관리자 전용)의 행 안 월 입력. 운영 화면이 아니다.
  ['app/(app)/accrual-check/AccrualCheckClient.tsx', 'month'],
])
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}
for (const f of [...walk('app'), ...walk('components')]) {
  if (f === PICKER) continue
  const s = strip(readFileSync(f, 'utf8'))
  if (/grid-cols-7\b/.test(s)) violations.push(`${f} — 7칸 격자 달력이 있다. 손수 만든 달력은 열기 규칙을 따로 가진다. 정본 DatePicker 를 쓴다.`)
  // <input> 태그의 type 만 본다. 정본을 감싼 Field(type="date")는 안에서 DatePicker 를 그린다(TenantClient DateFieldInner).
  for (const m of s.matchAll(/<input\b[^>]*\btype=["'](date|month)["']/g)) {
    if (NATIVE_OK.get(f) !== m[1]) violations.push(`${f} — 브라우저 기본 ${m[1]} 입력이 명단 밖에 있다. 정본 DatePicker 를 쓰거나 명단에 사유를 적는다.`)
  }
}

// ⓓ 가이드 등재.
if (!/DatePicker 열기 규칙/.test(readFileSync('docs/brand-guide-v2.0.md', 'utf8'))) {
  violations.push(`docs/brand-guide-v2.0.md — §12 에 'DatePicker 열기 규칙' 등재가 없다.`)
}

if (violations.length) {
  console.error(`[DatePicker 열기 규칙] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  · ' + v)
  process.exit(1)
}
console.log('[DatePicker 열기 규칙] 위반 0건')
