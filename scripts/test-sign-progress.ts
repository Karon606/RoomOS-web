// 서명 진행 판정 회귀 — lib/disposalSignGate 의 signStage·missingSignatures. 실패 시 exit 1.
//
// 왜 고정하는가(2026-09-04). 어제 두 입주자가 각각 한쪽만 서명하고 끝났는데, 계약서만 서명한
// 쪽에는 "원격 서명 완료" 알림이 뜨고 동의서만 서명한 쪽은 화면 어디에도 안 나왔다.
// 판정이 계약서 서명 하나만 봤기 때문이다. 여덟 칸 진리표를 통째로 못박는다.
import { signStage, missingSignatures, signProgressLabel, disposalSignatureMissing, signAlertDue, signProgressLabelSlots, toSlots, signStageSlots } from '../lib/disposalSignGate'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const S = (d: boolean, c: boolean, p: boolean) =>
  ({ disposalEnabled: d, hasContractSignature: c, hasDisposalSignature: p })

// ── 동의서를 쓰는 영업장 (네 칸) ──────────────────────────────────
eq('둘 다 없으면 none', signStage(S(true, false, false)), 'none')
eq('계약서만 = partial (413호)', signStage(S(true, true, false)), 'partial')
eq('동의서만 = partial (506호)', signStage(S(true, false, true)), 'partial')
eq('둘 다 있으면 complete', signStage(S(true, true, true)), 'complete')

// ── 동의서를 안 쓰는 영업장 (네 칸) ───────────────────────────────
// **여기가 멀티테넌트 축이다.** 계약서 하나로 완료여야 하고, 이 변경 전과 화면이 같아야 한다.
eq('꺼짐 · 둘 다 없으면 none', signStage(S(false, false, false)), 'none')
eq('꺼짐 · 계약서만으로 complete', signStage(S(false, true, false)), 'complete')
eq('꺼짐 · 동의서만 = partial', signStage(S(false, false, true)), 'partial')
eq('꺼짐 · 둘 다 있어도 complete', signStage(S(false, true, true)), 'complete')

// ── 두 함수의 관계 (여덟 칸 전부) ─────────────────────────────────
// disposalSignatureMissing 은 발급 축이고 signStage 는 알림 축이다. 갈라지면 한 화면이
// 다른 화면과 다른 사실을 말하게 된다.
for (const d of [true, false]) for (const c of [true, false]) for (const p of [true, false]) {
  const s = S(d, c, p)
  eq(`항등 d=${d} c=${c} p=${p}`,
    disposalSignatureMissing(s), signStage(s) === 'partial' && s.hasContractSignature)
}

// ── 남은 서명 ─────────────────────────────────────────────────────
eq('계약서만 서명 → 동의서가 남는다', missingSignatures(S(true, true, false)), ['disposal'])
eq('동의서만 서명 → 계약서가 남는다', missingSignatures(S(true, false, true)), ['contract'])
eq('아무것도 안 하면 둘 다', missingSignatures(S(true, false, false)), ['contract', 'disposal'])
eq('꺼진 영업장은 동의서를 안 센다', missingSignatures(S(false, false, false)), ['contract'])
eq('완료면 빈 배열', missingSignatures(S(true, true, true)), [])

// ── 문구 ──────────────────────────────────────────────────────────
eq('완료 문구', signProgressLabel(S(true, true, true)), '원격 서명 완료 · 계약서 발급 필요')
eq('계약서만 문구', signProgressLabel(S(true, true, false)), '계약서만 서명됨 · 동의서 서명 대기')
eq('동의서만 문구', signProgressLabel(S(true, false, true)), '동의서만 서명됨 · 계약서 서명 대기')
eq('없음 문구', signProgressLabel(S(true, false, false)), '서명 대기')

// ── 언제 말할 때인가 (운영자 신고 09da7f29, 2026-09-05) ──────────
// "하나만 서명되었을 때 알림이 오는 것은 사실 필요 없고 제출되었을 때만 와도 돼."
// 판정 한 문장은 "입주자가 스스로 마칠 수 있는 동안은 침묵한다" 이다.
const A = (d: boolean, c: boolean, p: boolean, submitted: boolean, linkDead: boolean) =>
  ({ disposalEnabled: d, hasContractSignature: c, hasDisposalSignature: p, submitted, linkDead })

// 살아 있는 미제출 링크 — 반쪽이든 완료든 침묵한다.
eq('살아 있는 링크의 반쪽은 침묵', signAlertDue(A(true, true, false, false, false)), false)
eq('살아 있는 링크의 반대쪽 반쪽도 침묵', signAlertDue(A(true, false, true, false, false)), false)
eq('살아 있는 링크의 완료도 제출 전이면 침묵', signAlertDue(A(true, true, true, false, false)), false)

// 제출했으면 말한다 — 운영자 문면("제출되었을 때만") 그대로.
eq('제출하면 말한다', signAlertDue(A(true, true, true, true, false)), true)

// 링크가 죽으면 말한다 — 입주자가 더는 스스로 못 마친다. 506호가 침묵하지 않는 자리다.
eq('만료된 링크의 반쪽은 말한다', signAlertDue(A(true, true, false, false, true)), true)
eq('만료된 링크의 동의서만 반쪽도 말한다', signAlertDue(A(true, false, true, false, true)), true)

// 서명이 하나도 없으면 어느 경우에도 이 알림이 아니다.
eq('서명 전은 죽은 링크여도 침묵', signAlertDue(A(true, false, false, false, true)), false)
eq('서명 전은 제출됐어도 침묵', signAlertDue(A(true, false, false, true, false)), false)

// 동의서를 안 쓰는 영업장 — 계약서 하나로 완료이고, 제출 전이면 역시 침묵한다.
eq('꺼진 영업장의 완료도 제출 전이면 침묵', signAlertDue(A(false, true, false, false, false)), false)
eq('꺼진 영업장도 제출하면 말한다', signAlertDue(A(false, true, false, true, false)), true)

// ── 슬롯 배열 (제3 서류 1단계, 2026-09-06) ────────────────────────
// **동작이 한 비트도 안 바뀌어야 한다.** 위 진리표가 그대로 통과하는 것이 그 증거이고,
// 아래는 슬롯이 셋 이상일 때의 새 갈래만 못박는다.
{
  const S = (...signed: boolean[]) =>
    ({ slots: signed.map((v, i) => ({ key: `d${i}`, title: `서류${i + 1}`, signed: v })) })
  eq('슬롯 셋 전부 서명이면 complete', signStageSlots(S(true, true, true)), 'complete')
  eq('슬롯 셋 하나도 없으면 none', signStageSlots(S(false, false, false)), 'none')
  eq('슬롯 셋 중 하나만 있으면 partial', signStageSlots(S(true, false, false)), 'partial')
  // 셋 이상이면 낱낱이 세지 않고 건수로 말한다 — 이름을 다 나열하면 문장이 못 읽게 길어진다.
  eq('셋 중 하나 서명은 건수로 말한다', signProgressLabelSlots(S(true, false, false)), '1건 서명됨 · 남은 서명 2건')
  eq('셋 중 둘 서명도 건수로', signProgressLabelSlots(S(true, true, false)), '2건 서명됨 · 남은 서명 1건')
  // 둘일 때는 이름을 말한다(지금 화면 문법 유지).
  eq('둘일 때는 이름으로 말한다',
    signProgressLabelSlots({ slots: [{ key: 'contract', title: '입실계약서', signed: true }, { key: 'd', title: '동의서', signed: false }] }),
    '입실계약서만 서명됨 · 동의서 서명 대기')
  // 서류 이름은 코드가 아니라 슬롯에서 온다 — 이 값을 바꾸면 문구가 따라온다.
  eq('서류 이름을 슬롯에서 읽는다',
    signProgressLabelSlots({ slots: [{ key: 'contract', title: '입실계약서', signed: true }, { key: 'x', title: '차량 등록 동의서', signed: false }] }),
    '입실계약서만 서명됨 · 차량 등록 동의서 서명 대기')
  // 어댑터 — 꺼진 영업장이라도 받아 둔 서명이 있으면 슬롯을 세운다.
  eq('꺼진 영업장의 기존 서명은 슬롯으로 남는다',
    toSlots({ disposalEnabled: false, hasContractSignature: false, hasDisposalSignature: true }).length, 2)
  eq('꺼졌고 서명도 없으면 계약서 하나',
    toSlots({ disposalEnabled: false, hasContractSignature: true, hasDisposalSignature: false }).length, 1)
}

console.log(`\n서명 진행 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const m of fails) console.error(`  - ${m}`)
if (fails.length) process.exit(1)
