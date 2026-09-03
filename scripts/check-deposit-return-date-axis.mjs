// 보증금 정산일 축이 경로마다 갈리는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 미반환 보증금은 ExtraIncome(부가수익)으로 잡히고 그 행의 date 가 **귀속월을
// 정한다.** 그런데 네 경로가 넘기는 날짜가 갈렸다. 퇴실 처리 화면과 상태 전환은 퇴실일,
// 입주자 수정 폼과 보증금 카드는 기본 '오늘'이었다. 오늘은 정산일도 퇴실일도 아닌 **클릭한
// 날**이다 — 현금영수증 발행일 사건에서 이미 진단한 병과 같은 클래스다("클릭한 순간이지
// 발행한 날이 아니다"). 413호가 퇴실 09-02 인데 기타수익이 09-03 에 앉았다.
//
// 확정(운영자 2026-09-03). 축은 '정산일'(반환하지 않기로 확정한 날)이고 **기본값은 퇴실일**이다.
// 이 사업장에서 정산은 퇴실 처리의 일부라 두 판정이 충돌하지 않는다. 칸은 남긴다 — 진짜로
// 늦게 확정한 정산을 사실대로 적을 길이 있어야 한다.
//
//   ⓐ 서버가 미래 정산일을 거부한다. 화면 넷이 다 맞아도 다섯째 경로가 생기면 여기가 받친다.
//   ⓑ 두 폼의 기본값이 퇴실일이다. kstYmdStr 단독이면 클릭한 날로 되돌아간 것이다.
//   ⓒ 라벨은 '정산일'이다. '처리일'은 클릭한 날로 읽히고, '반환일'은 0원 반환(전액 미반환)
//      기록에서 이름 자체가 모순이다.
//   ⓓ 확인창의 귀속월은 **저장에 실리는 날짜**로 센다. 오늘의 달로 세면 두 값이 갈릴 때
//      확인창이 틀린 달을 약속한다.
//
// 실행: node scripts/check-deposit-return-date-axis.mjs
import { readFileSync } from 'node:fs'

const ACTIONS = 'app/(app)/tenants/actions.ts'
const FORM = 'app/(app)/tenants/TenantClient.tsx'
const CARD = 'components/entity-modal/widgets/DepositStatusPanel.tsx'
const violations = []
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// ⓐ 서버 미래 가드.
{
  const src = strip(readFileSync(ACTIONS, 'utf8'))
  const fn = src.match(/export async function recordDepositReturn[\s\S]*?\n\}\n/)
  if (!fn) violations.push(`${ACTIONS} — recordDepositReturn 을 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  else if (!/> kstYmdStr\(\)/.test(fn[0]) || !/정산일이 미래입니다/.test(fn[0])) {
    violations.push(`${ACTIONS} — recordDepositReturn 에 미래 정산일 가드가 없다. 아직 하지 않은 정산이 기록된다.`)
  }
}

// ⓑ 두 폼의 기본값.
{
  const form = strip(readFileSync(FORM, 'utf8'))
  if (!/setDepositReturnDate\(moveOutYmd\)/.test(form)) {
    violations.push(`${FORM} — 정산일 기본값이 퇴실일이 아니다. 클릭한 날이 곧 기타수익의 귀속월이 된다.`)
  }
  const card = strip(readFileSync(CARD, 'utf8'))
  if (!/setRecDate\(moveOutYmd \?\? kstYmdStr\(\)\)/.test(card)) {
    violations.push(`${CARD} — 정산일 기본값이 퇴실일이 아니다(setRecDate).`)
  }
  if (!/moveOutYmd\?: string \| null/.test(card)) {
    violations.push(`${CARD} — 퇴실일 prop 이 사라졌다. 기본값을 세울 근거가 없어진다.`)
  }
}

// ⓒ 라벨 어휘.
for (const f of [FORM, CARD]) {
  const src = strip(readFileSync(f, 'utf8'))
  for (const bad of ['>처리일<', '>반환일<']) {
    if (src.includes(bad)) {
      violations.push(`${f} — 라벨이 '${bad.slice(1, -1)}'이다. 축 이름은 '정산일' 하나다(0원 반환에서 '반환일'은 모순).`)
    }
  }
}

// ⓓ 확인창 귀속월.
{
  const src = strip(readFileSync(FORM, 'utf8'))
  if (!/const mon = \(depositReturnDate \|\| kstYmdStr\(\)\)\.slice\(0, 7\)/.test(src)) {
    violations.push(`${FORM} — 전액 미반환 확인창이 저장 날짜로 귀속월을 안 센다. 틀린 달을 약속하게 된다.`)
  }
}

console.log(`[보증금 정산일 축] 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
