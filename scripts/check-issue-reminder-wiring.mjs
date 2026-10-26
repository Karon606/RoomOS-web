// 발급 알림 계약 상태 축(issueReminderApplies)이 세 소비처에 배선돼 있는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 0fd00b7e, 2026-10-26). 입실을 취소한 계약에 '발급 대기'와 홈 알림 '원격 서명 완료 ·
// 계약서 발급 필요'가 그대로 남았다. 세 자리가 링크(closedAt: null)와 서명만 보고 판정했고 계약 상태를
// 보는 축이 없었다. 정본은 lib/contractIssue 의 issueReminderApplies 하나이고, 세 자리가 그것을 부른다.
//   ⓐ 발급 대기 목록(app/(app)/contracts/actions.ts getPendingIssueContracts)
//   ⓑ 홈 알림·푸시(app/(app)/dashboard/alerts.ts, signed·signpartial 두 카테고리가 같은 루프)
//   ⓒ 계약서 패널의 needsIssue(app/(app)/tenants/contractShare.ts getContractShareState)
//
// 축은 셋이다.
//   1. 정본 import 가 있다.
//   2. import 줄을 지운 본문에 호출이 있다. **import 만 남기고 호출을 지운 역주입**이 2026-09-04 에
//      실제로 그물을 뚫었다(knowledge/domain-contracts 체크리스트 F).
//   2-1. 호출 결과가 분기에 쓰인다(if (!…) · && … 꼴). 줄 끝 주석은 지우고 본다.
//   3. 호출이 '발급됐나'(isContractIssued) 판정보다 앞에 있고, 계약 상태(status)를 인자로 받으며,
//      쿼리가 그 상태를 실제로 읽는다(select 에 status: true). 안 읽으면 인자는 늘 undefined 이고
//      판정은 조용히 '말한다'로 떨어진다.
//
// 실행: node scripts/check-issue-reminder-wiring.mjs
import { readFileSync } from 'node:fs'

// 줄 끝 주석까지 지운다. 줄 머리 주석만 지우면 `foo() // issueReminderApplies(l.leaseTerm.status)` 처럼
// 호출을 줄 끝 주석으로 무력화한 역주입이 통과한다(독립 검수 2026-10-26). 앞에 공백이 있는 // 만 주석으로
// 본다 — 문자열 속 'https://' 는 콜론이 앞이라 안 걸린다.
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/(\s)\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

// documentSignatures: true 를 품은 가장 안쪽 중괄호 블록들 — 서명 칸을 읽는 leaseTerm select 다.
function signSelectBlocks(src) {
  const out = []
  for (const m of src.matchAll(/documentSignatures:\s*true/g)) {
    let depth = 0, open = -1
    for (let i = m.index; i >= 0; i--) {
      if (src[i] === '}') depth++
      else if (src[i] === '{') { if (depth === 0) { open = i; break } depth-- }
    }
    if (open < 0) continue
    depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { out.push(src.slice(open, i + 1)); break } }
    }
  }
  return out
}

const CONSUMERS = [
  ['app/(app)/contracts/actions.ts', 'ⓐ 발급 대기 목록'],
  ['app/(app)/dashboard/alerts.ts', 'ⓑ 홈 알림·푸시'],
  ['app/(app)/tenants/contractShare.ts', 'ⓒ 계약서 패널 needsIssue'],
]

const violations = []
for (const [f, label] of CONSUMERS) {
  const raw = strip(readFileSync(f, 'utf8'))
  const importRe = /^\s*import\s*\{[^}]*\bissueReminderApplies\b[^}]*\}\s*from\s*'@\/lib\/contractIssue'/m
  if (!importRe.test(raw)) violations.push(`${f} — ${label}: lib/contractIssue 의 issueReminderApplies 를 들여오지 않는다.`)
  const body = raw.replace(/^\s*import\s[^\n]*$/gm, '')
  const call = body.match(/\bissueReminderApplies\(\s*([^)]*)\)/)
  if (!call) {
    violations.push(`${f} — ${label}: issueReminderApplies 를 부르지 않는다. 입실 취소한 계약에 발급 알림이 다시 선다.`)
    continue
  }
  // 결과가 분기에 쓰여야 한다 — if (!issueReminderApplies(…)) 나 … && issueReminderApplies(…) 꼴.
  // 결과를 버리는 맨 호출은 부르기만 하고 아무것도 안 막는다(독립 검수 2026-10-26).
  const calls = [...body.matchAll(/\bissueReminderApplies\(/g)]
  const guarded = [...body.matchAll(/(?:\bif\s*\(\s*!?\s*|&&\s*!?\s*)issueReminderApplies\(/g)]
  if (guarded.length !== calls.length) {
    violations.push(`${f} — ${label}: issueReminderApplies 결과가 분기에 안 쓰이는 호출이 있다(가드 ${guarded.length} / 호출 ${calls.length}). if (!…) 나 && … 꼴로 건다.`)
  }
  if (!/\.status\b/.test(call[1])) {
    violations.push(`${f} — ${label}: issueReminderApplies 인자가 계약 상태(…status)가 아니다 (${call[1].trim()}).`)
  }
  const issued = body.indexOf('isContractIssued(')
  if (issued >= 0 && call.index > issued) {
    violations.push(`${f} — ${label}: issueReminderApplies 가 isContractIssued 판정 뒤에 있다. 상태 축이 먼저 걸러야 한다.`)
  }
  // 상태는 서명 칸을 읽는 바로 그 leaseTerm select 안에서 읽어야 한다. 파일 어딘가의 다른 쿼리가
  // status 를 읽는 것으로는 증명이 안 된다(발급 대기 파일에는 원래 다른 status: true 가 둘 있다).
  if (!signSelectBlocks(body).some(b => /\bstatus:\s*true\b/.test(b))) {
    violations.push(`${f} — ${label}: 서명 칸을 읽는 leaseTerm select 가 계약 상태(status: true)를 안 읽는다. 인자가 늘 undefined 라 판정이 눈을 감는다.`)
  }
}

// 정본 자체가 서 있는가 — 지워지면 세 자리의 import 가 타입 검사에서 먼저 깨지지만, 몸통을 비우는
// 역주입(늘 true)은 타입이 못 잡는다. 진리표는 scripts/test-issue-reminder.ts 가 본다.
{
  const lib = strip(readFileSync('lib/contractIssue.ts', 'utf8'))
  if (!/export function issueReminderApplies\(/.test(lib)) violations.push('lib/contractIssue.ts — issueReminderApplies 정본이 없다.')
}

console.log(`[발급 알림 상태 축] 소비처 ${CONSUMERS.length}곳 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
if (violations.length) process.exit(1)
