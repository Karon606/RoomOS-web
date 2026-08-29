// 추가 호실 특약 문안이 어디서 오는지를 지키는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 이 문안은 이제 세 곳에 살 수 있다. 코드 기본값 · 영업장 저장값 · 발급 요청이 실어 온 값.
// 셋의 우선순위가 흐트러지면 종이와 기록이 갈린다. 그 순서를 코드로 못 박는다.
//
//   ⓐ 화면·발급이 같은 정본을 쓴다. 문안 해석은 resolveSubLeaseAddendum 하나이고, 붙일지 말지의
//     판정은 contractSubLeaseAddendum 하나다. 어느 한쪽이 제 규칙을 만들면, 창고가 안 딸린
//     계약에 절이 서거나 딸린 계약에 안 서는 일이 화면과 종이에서 따로 벌어진다.
//
//   ⓑ **서명이 끝난 계약에는 요청 문안이 안 먹는다.** 서명본은 박제가 정본이라, 클라이언트가
//     보낸 문안을 그대로 받으면 이미 서명한 종이의 본문을 사후에 바꾸는 길이 열린다.
//     발급 API 가 body_.source !== 'SNAPSHOT' 를 함께 보는지 확인한다.
//
//   ⓒ 문안을 계약에 저장하지 않는다. 발급본·서명 스냅샷에 박제되므로 종이에는 남고, 영구
//     변경은 환경설정 자리 하나뿐이다. 계약별 오버라이드가 생기면 같은 문안이 네 곳에 살게 되고
//     어느 것이 정본인지 다음 사람이 못 찾는다.
//
// 실행: node scripts/check-sublease-addendum-source.mjs
import { readFileSync } from 'node:fs'

const violations = []
const read = (f) => readFileSync(f, 'utf8')

// ⓐ 해석 정본이 하나인가 — 문안을 손으로 조립하는 자리가 생기면 잡는다.
const CONSUMERS = ['lib/contractData.ts', 'app/api/contract/generate/route.ts', 'app/contract/[tenantId]/ContractView.tsx']
for (const f of CONSUMERS) {
  const src = read(f)
  // DEFAULT_SUB_LEASE_ADDENDUM 를 직접 쓰면 저장값을 건너뛴 것이다(정본은 resolve 가 폴백한다).
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (/DEFAULT_SUB_LEASE_ADDENDUM/.test(line)) {
      violations.push(`${f}:${i + 1} — 기본 문안을 직접 쓴다. resolveSubLeaseAddendum 이 저장값을 폴백한다.`)
    }
  })
}

// ⓑ 발급 API 가 서명본을 지키는가.
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  const m = src.match(/const subLeaseAddendum = \([\s\S]{0,400}?\n\s*: subLeaseBase/)
  if (!m) {
    violations.push(`${f} — 발급 API 의 특약 선택 블록을 못 찾았다. 모양이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  } else {
    if (!/source !== 'SNAPSHOT'/.test(m[0])) {
      violations.push(`${f} — 요청 문안이 서명본에도 먹는다. 이미 서명한 종이의 본문을 사후에 바꾸는 길이다.`)
    }
    if (!/subLeaseBase &&/.test(m[0])) {
      violations.push(`${f} — 붙일지 판정 없이 요청 문안만 보고 절을 세운다. 창고가 안 딸린 계약에 절이 선다.`)
    }
  }
}

// ⓒ 문안이 계약에 저장되지 않는가.
{
  const f = 'app/contract/[tenantId]/actions.ts'
  const src = read(f)
  if (/subLeaseAddendum/.test(src)) {
    violations.push(`${f} — 특약 문안이 계약 저장 경로에 등장한다. 영구 변경 자리는 환경설정 하나다.`)
  }
}

console.log(`[특약 문안 출처] 소비자 ${CONSUMERS.length}곳 검사 · 축 ⓐ 해석 정본 · ⓑ 서명본 격리 · ⓒ 계약 저장 금지 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  문안은 코드 기본값 → 영업장 저장값 → 이번 발급 요청 순으로 덮인다.')
  console.error('  서명이 끝난 계약은 박제가 정본이라 어느 것도 안 덮는다.')
  process.exit(1)
}
