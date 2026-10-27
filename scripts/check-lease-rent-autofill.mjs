// 입주자 폼 월 이용료 자동 채움 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 입주자 수정 폼에서 호실을 바꾸자 호실 칸 onChange 가 저장된 계약 금액을
// 묻지 않고 '비거주 이용료가 없으면 기본 이용료' 로 칸을 덮었고(15만 원이 3만 원), 경고 문장은 값이 바뀐 뒤에 떠서 저장을 못 막았다.
// 판정 정본은 lib/leaseRentAutofill(진리표 test-lease-rent-autofill)이다. 이 그물은 정본을 우회하는 덮어쓰기가 다시 서지 않게 본다.
//
// 축 다섯.
//   ⓐ 폼은 방 기준가로 칸을 직접 덮지 않는다. TenantClient 에 setRentAmount(… baseRent / nonResidentRent …) 가 없다.
//   ⓑ 호실 칸 onChange 와 거주·비거주 전환 effect 가 정본 nextRentOnChange 를 지난다(저장된 금액 조건).
//   ⓒ 칸 아래 한 줄은 정본 WhyCaption 이고 rentFieldCaption 이 문장을 정한다. MoneyInput 이 그 id 를 aria-describedby 로 가리킨다.
//      종전 경고 p('이 호실에 비거주 이용료가 설정되어 있지 않습니다') 는 다시 서지 않는다.
//   ⓓ 정본은 비거주 이용료가 빈 방을 기본 이용료로 대체하지 않는다(roomStdRent 에 baseRent 폴백 없음).
//   ⓔ 저장(updateTenant)은 같은 모양을 nrRentEqualsBaseNotice 로 한 번 알린다(거부 아님).
//
// 실행: node scripts/check-lease-rent-autofill.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1')
const read = f => strip(readFileSync(f, 'utf8'))

const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

const FORM = 'app/(app)/tenants/TenantClient.tsx'
const LIB = 'lib/leaseRentAutofill.ts'
const ACT = 'app/(app)/tenants/actions.ts'
const form = read(FORM)
const lib = read(LIB)
const act = read(ACT)

// ⓐ 직접 덮어쓰기 금지
{
  const hits = [...form.matchAll(/setRentAmount\(([^)]*)\)/g)].filter(m => /baseRent|nonResidentRent/.test(m[1]))
  for (const h of hits) need(false, `${FORM}: setRentAmount(${h[1]}) 는 방 기준가로 칸을 직접 덮는다. lib/leaseRentAutofill nextRentOnChange 를 지나야 한다(저장된 금액은 그대로).`)
}

// ⓑ 정본 경유
{
  const fn = form.match(/const applyRentAutofill = \([^)]*\) => \{([\s\S]*?)\n  \}/)
  need(!!fn, `${FORM}: applyRentAutofill(정본 경유 한 자리)이 없다.`)
  if (fn) {
    need(/nextRentOnChange\(\{ saved: savedRent, current: rentAmount, room, isNR, autoFilled: autoRentRef\.current \}\)/.test(fn[1]), `${FORM}: applyRentAutofill 이 nextRentOnChange 에 저장된 금액(savedRent)·지금 칸 값·자동으로 채운 값을 넘기지 않는다.`)
    need(/if \(next\.kind === 'set'\) \{ setRentAmount\(next\.value\); autoRentRef\.current = next\.value \}/.test(fn[1]), `${FORM}: applyRentAutofill 이 정본 판정(kind 'set')과 상관없이 칸을 쓰거나 자동으로 채운 값을 기억하지 않는다.`)
  }
  need(/const savedRent = savedLeaseRent\(lease\)/.test(form), `${FORM}: 저장된 금액을 savedLeaseRent(lease) 로 정하지 않는다.`)
  const onChange = form.match(/const handleRoomChange = [\s\S]*?\n  \}/)
  need(!!onChange && /applyRentAutofill\(roomId, /.test(onChange[0]), `${FORM}: 호실 칸 onChange 가 applyRentAutofill 을 부르지 않는다.`)
  const eff = form.match(/useEffect\(\(\) => \{\n    const first = statusEffectFirst\.current\n    statusEffectFirst\.current = false\n    if \(first && lease\?\.id\) return\n    if \(!selectedRoomId\) return\n    applyRentAutofill\(selectedRoomId, statusVal === 'NON_RESIDENT'\)\n  \}, \[statusVal\]\)/)
  need(!!eff, `${FORM}: 거주·비거주 전환 effect 가 applyRentAutofill 을 지나지 않거나, 수정 폼을 여는 첫 실행에서도 칸을 채운다.`)
}

// ⓒ 칸 아래 한 줄
{
  need(/const caption = isShortTerm \? null : rentFieldCaption\(\{/.test(form), `${FORM}: 월 이용료 칸 아래 문장을 rentFieldCaption 이 정하지 않는다.`)
  need(/<MoneyInput name="rentAmount" value=\{rentAmount\} onChange=\{setRentAmount\} placeholder="0원" describedBy=\{caption \? rentWhyId : undefined\} \/>/.test(form),
    `${FORM}: 월 이용료 칸이 안내 한 줄을 aria-describedby 로 가리키지 않는다.`)
  need(/<WhyCaption id=\{rentWhyId\} action=\{caption\.kind === 'keep'/.test(form), `${FORM}: 안내 한 줄이 정본 WhyCaption(링크 포함)이 아니다.`)
  need(!/이 호실에 비거주 이용료가 설정되어 있지 않습니다/.test(form), `${FORM}: 종전 경고 문장이 남아 있다(값이 바뀐 뒤 뜨고 저장을 못 막던 자리, WhyCaption 으로 옮겼다).`)
  const mi = read('components/ui/MoneyInput.tsx')
  need(/aria-describedby=\{describedBy\}/.test(mi), 'components/ui/MoneyInput.tsx: describedBy 를 입력칸의 aria-describedby 로 달지 않는다.')
}

// ⓓ 정본에 기본 이용료 폴백 없음
{
  const std = lib.match(/export function roomStdRent\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)
  need(!!std, `${LIB}: roomStdRent 가 없다.`)
  if (std) {
    need(/return isNR \? room\.nonResidentRent : room\.baseRent/.test(std[1]), `${LIB}: roomStdRent 가 비거주면 비거주 이용료만 돌려주지 않는다.`)
    need(!/\?\?\s*room\.baseRent/.test(std[1]), `${LIB}: roomStdRent 가 비거주 이용료 없는 방을 기본 이용료로 대체한다.`)
  }
  const nx = lib.match(/export function nextRentOnChange\([\s\S]*?\n\}\n(?=\n)/)
  need(!!nx && /if \(p\.saved != null && \(p\.current \?\? 0\) > 0\) return \{ kind: 'keep' \}/.test(nx[0]), `${LIB}: nextRentOnChange 가 저장된 금액이 있는 칸을 그대로 두지 않는다.`)
  need(!!nx && /if \(std == null\) \{\n    const auto = p\.saved == null && \(p\.current \?\? 0\) > 0 && p\.current === p\.autoFilled\n    return auto \? \{ kind: 'set', value: undefined \} : \{ kind: 'keep' \}/.test(nx[0]), `${LIB}: nextRentOnChange 가 기준가 없는 방에서 자동으로 채웠던 값만 비우지 않는다(기본 이용료 대체 금지·손으로 적은 값 보존).`)
}

// ⓔ 저장 안내
{
  const up = act.match(/export async function updateTenant\([\s\S]*?\n\}\n/)
  need(!!up, `${ACT}: updateTenant 를 못 찾았다.`)
  if (up) {
    need(/nrRentEqualsBaseNotice\(\{ status, isShortTerm, rentAmount:/.test(up[0]), `${ACT}: updateTenant 가 nrRentEqualsBaseNotice 로 사건 모양을 알리지 않는다.`)
    need(/staleCleared \? '입주일이 바뀌어 거주 호실 일정을 지웠습니다\.' : null, nrNotice\]/.test(up[0]), `${ACT}: updateTenant 의 안내(notice)에 nrNotice 가 실리지 않는다.`)
  }
}

if (violations.length) {
  console.log(`[월 이용료 자동 채움] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  ' + v)
  process.exit(1)
}
console.log('[월 이용료 자동 채움] 축 ⓐ 직접 덮어쓰기 금지 · ⓑ 정본 경유 · ⓒ WhyCaption 결선 · ⓓ 기본 이용료 폴백 없음 · ⓔ 저장 안내 / 위반 0건')
