// 동의서 서명 게이트 회귀 — lib/disposalSignGate. 실패 시 exit 1.
// 실행: npx tsx scripts/test-disposal-sign-gate.ts
//
// 왜 고정하는가. 이 판정이 흔들리면 반쪽 서명이 다시 '완료'로 불리고, 운영자가 그것을 믿고
// 서명란이 빈 동의서를 발급한다(신고 2026-09-03, 413호). 법적 근거가 없는 종이가 나가는 길이다.
import { disposalSignatureMissing, signProgressLabel } from '../lib/disposalSignGate'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 이번 사건 재현 ────────────────────────────────────────────────
// 413호. 동의서 켜짐 + 계약서 서명 + 동의서 없음.
eq('반쪽 서명은 걸린다', disposalSignatureMissing({ disposalEnabled: true, hasContractSignature: true, hasDisposalSignature: false }), true)
eq('반쪽 서명은 반쪽이라고 말한다', signProgressLabel({ disposalEnabled: true, hasContractSignature: true, hasDisposalSignature: false }), '계약서만 서명됨 · 동의서 서명 대기')

// ── 정상 흐름 보호 ────────────────────────────────────────────────
// 동의서가 꺼진 영업장은 계약서 서명만으로 끝이다. 여기서 막으면 멀티테넌트가 깨진다.
eq('동의서 꺼진 영업장은 안 걸린다', disposalSignatureMissing({ disposalEnabled: false, hasContractSignature: true, hasDisposalSignature: false }), false)
// 아무 서명도 없는 빈 종이 인쇄 — 출력 후 손으로 받는 정당한 경로다.
eq('서명 전 빈 종이는 안 걸린다', disposalSignatureMissing({ disposalEnabled: true, hasContractSignature: false, hasDisposalSignature: false }), false)
eq('꺼진 영업장의 빈 종이도 안 걸린다', disposalSignatureMissing({ disposalEnabled: false, hasContractSignature: false, hasDisposalSignature: false }), false)
// 둘 다 받은 정상 완료.
eq('둘 다 서명되면 안 걸린다', disposalSignatureMissing({ disposalEnabled: true, hasContractSignature: true, hasDisposalSignature: true }), true === false)
eq('완료는 완료라고 말한다', signProgressLabel({ disposalEnabled: true, hasContractSignature: true, hasDisposalSignature: true }), '원격 서명 완료 · 계약서 발급 필요')
// 동의서만 받고 계약서를 안 한 상태 — 2026-08-31 봉합이 다룬 그 비대칭이다. 여기서는 안 걸린다.
eq('동의서만 있고 계약서가 없으면 안 걸린다', disposalSignatureMissing({ disposalEnabled: true, hasContractSignature: false, hasDisposalSignature: true }), false)

console.log(`\n동의서 서명 게이트 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const m of fails) console.error(`  - ${m}`)
if (fails.length) process.exit(1)
