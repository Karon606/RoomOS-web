// 입주자 대표 전화번호 고르기 회귀 테스트 — 실행: npx tsx scripts/test-tenant-phone.ts
//
// 여기서 고정하는 것 여섯(2026-09-16, 서류·문자 수신 번호 정본화).
//   · **주 연락처가 먼저다** — isPrimary 가 국내 번호를 가리키면 그것이 답이다.
//   · **본국 번호는 마지막 폴백** — 국내 번호가 하나라도 있으면 해외 번호를 안 고른다.
//     종전 규칙(primary ?? 비비상 아무거나)은 본국 번호를 서류와 문자에 그대로 실었다.
//   · **비상 연락처는 어떤 경우에도 안 잡는다** — 그 번호는 입주자 본인 것이 아니다.
//   · **메신저 계정은 전화번호가 아니다** — KAKAO·LINE 은 건너뛴다.
//   · **문자 갈래는 LANDLINE 을 뺀다** — 유선전화로는 문자가 안 간다(kinds 인자).
//   · **같은 조건이면 먼저 만든 것** — createdAt asc 로 답이 흔들리지 않는다.

// 2026-09-17 에 둘이 더 붙었다(대체·예약 확정 게이트). **위 여섯은 한 글자도 안 바뀐다** —
// 종이에 찍히는 번호의 규칙이 그대로여야 아래 두 문이 얹힐 수 있다.
//   · pickTenantPhoneWithFallback — 본인 번호가 없을 때만 비상 연락처로 문자를 돌린다.
//   · reservationConfirmPhoneDenial — 본인 전화번호 없이는 예약을 확정 못 한다(메신저 아이디도 불가).

import {
  pickTenantPhone, pickTenantPhoneWithFallback, reservationConfirmPhoneDenial,
  type TenantPhoneContact, type TenantPhoneContactWithOwner,
} from '../lib/tenantContact'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
let seq = 0
const c = (o: Partial<TenantPhoneContactWithOwner> & { contactValue: string }): TenantPhoneContactWithOwner => ({
  // id 는 안 주면 만든 순서대로 매긴다 — 동률 케이스만 직접 지정한다.
  id: `c${String(++seq).padStart(3, '0')}`,
  contactType: 'PHONE', isPrimary: false, isEmergency: false, isHomeCountry: false,
  createdAt: D('2026-01-01'), ...o,
})

// ── 주 연락처 우선 ──────────────────────────────────────────────
{
  const list = [
    c({ contactValue: '010-1111-1111', createdAt: D('2026-03-01') }),
    c({ contactValue: '010-2222-2222', isPrimary: true, createdAt: D('2026-05-01') }),
  ]
  eq('주 연락처 · 먼저 만든 번호보다 세다', pickTenantPhone(list), '010-2222-2222')
}
{
  // 주 연락처가 없으면 비비상 국내 번호 중 먼저 만든 것.
  const list = [
    c({ contactValue: '010-2222-2222', createdAt: D('2026-05-01') }),
    c({ contactValue: '010-1111-1111', createdAt: D('2026-03-01') }),
  ]
  eq('주 연락처 없음 · 먼저 만든 국내 번호', pickTenantPhone(list), '010-1111-1111')
}
{
  eq('연락처가 없으면 null', pickTenantPhone([]), null)
}

// ── 본국(해외) 번호는 마지막 폴백 ────────────────────────────────
{
  // 본국 번호가 주 연락처로 찍혀 있어도 국내 번호가 있으면 국내가 답이다.
  // 종전 규칙은 여기서 +998 번호를 골라 서류와 문자에 실었다.
  const list = [
    c({ contactValue: '+998-90-000-0000', isPrimary: true, isHomeCountry: true, createdAt: D('2026-01-02') }),
    c({ contactValue: '010-3333-3333', createdAt: D('2026-04-01') }),
  ]
  eq('본국 · 국내 번호가 있으면 국내를 고른다', pickTenantPhone(list), '010-3333-3333')
}
{
  // 국내 번호가 아예 없으면 본국 번호라도 고른다 — 번호 없음보다 낫다.
  const list = [c({ contactValue: '+998-90-000-0000', isHomeCountry: true })]
  eq('본국 · 국내 번호가 없으면 본국으로 폴백', pickTenantPhone(list), '+998-90-000-0000')
}
{
  const list = [
    c({ contactValue: '+7-900-000-0002', isHomeCountry: true, createdAt: D('2026-06-01') }),
    c({ contactValue: '+7-900-000-0001', isHomeCountry: true, createdAt: D('2026-02-01') }),
  ]
  eq('본국 · 둘이면 먼저 만든 것', pickTenantPhone(list), '+7-900-000-0001')
}
{
  // 폴백 안에서도 손으로 고른 것이 만든 순서보다 세다(①과 ②의 관계를 그대로 옮긴다).
  const list = [
    c({ contactValue: '+7-900-000-0001', isHomeCountry: true, createdAt: D('2026-02-01') }),
    c({ contactValue: '+7-900-000-0002', isHomeCountry: true, isPrimary: true, createdAt: D('2026-06-01') }),
  ]
  eq('본국 · 주 연락처가 있으면 그것', pickTenantPhone(list), '+7-900-000-0002')
}

// ── 비상 연락처는 어떤 경우에도 안 잡는다 ────────────────────────
{
  const list = [c({ contactValue: '010-9999-9999', isEmergency: true, isPrimary: true })]
  eq('비상 · 그것뿐이면 null', pickTenantPhone(list), null)
}
{
  const list = [
    c({ contactValue: '010-9999-9999', isEmergency: true, createdAt: D('2026-01-01') }),
    c({ contactValue: '010-4444-4444', createdAt: D('2026-07-01') }),
  ]
  eq('비상 · 본인 번호가 있으면 본인 것', pickTenantPhone(list), '010-4444-4444')
}
{
  // 비상이면서 본국인 번호도 폴백에 안 걸린다.
  const list = [c({ contactValue: '+84-90-000-0000', isEmergency: true, isHomeCountry: true })]
  eq('비상 · 본국 폴백에도 안 걸린다', pickTenantPhone(list), null)
}

// ── 메신저 계정은 전화번호가 아니다 ──────────────────────────────
{
  const list = [
    c({ contactValue: 'kakao-id', contactType: 'KAKAO', isPrimary: true, createdAt: D('2026-01-01') }),
    c({ contactValue: '010-5555-5555', createdAt: D('2026-02-01') }),
  ]
  eq('KAKAO · 주 연락처여도 건너뛴다', pickTenantPhone(list), '010-5555-5555')
}
{
  const list = [c({ contactValue: 'line-id', contactType: 'LINE', isPrimary: true })]
  eq('LINE · 그것뿐이면 null', pickTenantPhone(list), null)
}

// ── kinds — 문자 갈래는 유선전화를 뺀다 ──────────────────────────
{
  const list = [c({ contactValue: '02-000-0000', contactType: 'LANDLINE', isPrimary: true })]
  eq('기본 · 유선전화도 전화번호다(서류 칸)', pickTenantPhone(list), '02-000-0000')
  eq('문자 · 유선전화는 뺀다', pickTenantPhone(list, ['PHONE']), null)
}
{
  const list = [
    c({ contactValue: '02-000-0000', contactType: 'LANDLINE', isPrimary: true, createdAt: D('2026-01-01') }),
    c({ contactValue: '010-6666-6666', createdAt: D('2026-03-01') }),
  ]
  eq('문자 · 유선 주 연락처를 건너뛰고 휴대폰', pickTenantPhone(list, ['PHONE']), '010-6666-6666')
  eq('기본 · 그때는 주 연락처가 그대로 답', pickTenantPhone(list), '02-000-0000')
}

// ── 정렬 안정성 — 입력 순서가 답을 흔들지 않는다 ─────────────────
{
  // 같은 조건 둘. 호출부마다 orderBy 가 달라도(어떤 자리는 isPrimary desc, 어떤 자리는 createdAt asc)
  // 같은 사람에게 같은 번호가 가야 한다 — 그래서 여기서 다시 세운다.
  const a = c({ contactValue: '010-1111-1111', createdAt: D('2026-03-01') })
  const b = c({ contactValue: '010-2222-2222', createdAt: D('2026-05-01') })
  eq('안정성 · 입력 순서가 바뀌어도 같은 답 (1)', pickTenantPhone([a, b]), '010-1111-1111')
  eq('안정성 · 입력 순서가 바뀌어도 같은 답 (2)', pickTenantPhone([b, a]), '010-1111-1111')
}
{
  // createdAt 동률 — 입주자 등록 폼이 본인·비상·본국을 한 트랜잭션에 넣으면 실제로 같은 값이
  // 박힌다. 2차 키가 없으면 DB 가 돌려주는 순서에 답이 끌려간다.
  const same = D('2026-04-01')
  const a = c({ id: 'z-late', contactValue: '010-8888-8888', createdAt: same })
  const b = c({ id: 'a-early', contactValue: '010-7777-7777', createdAt: same })
  eq('동률 · id 오름차순이 가른다 (1)', pickTenantPhone([a, b]), '010-7777-7777')
  eq('동률 · 입력 순서가 바뀌어도 같은 답 (2)', pickTenantPhone([b, a]), '010-7777-7777')
}
{
  // 호출부가 넘긴 배열을 뒤집지 않는다 — 같은 배열을 다른 용도로 또 쓰는 자리가 있다.
  const list = [
    c({ contactValue: '010-2222-2222', createdAt: D('2026-05-01') }),
    c({ contactValue: '010-1111-1111', createdAt: D('2026-03-01') }),
  ]
  pickTenantPhone(list)
  eq('안정성 · 인자 배열을 제자리에서 정렬하지 않는다',
    list.map(x => x.contactValue), ['010-2222-2222', '010-1111-1111'])
}

// ══ 대체(비상 연락처)로 가는 문자 ═══════════════════════════════
// 여기서 고정하는 것: 본인이 있으면 대체를 안 쓴다 · 대체는 비상 중에서 **정본과 같은 순서**로
// 고른다 · 메신저는 대체로도 안 잡는다 · 주인 표기는 네 갈래.

{
  // 본인 번호가 있으면 대체 문은 열리지 않는다. 주인 표기도 안 붙는다(본인이니까).
  const list = [
    c({ contactValue: '010-9999-9999', isEmergency: true, emergencyName: '김철수', createdAt: D('2026-01-01') }),
    c({ contactValue: '010-4444-4444', createdAt: D('2026-07-01') }),
  ]
  eq('대체 · 본인이 있으면 본인 것(source self)',
    pickTenantPhoneWithFallback(list), { value: '010-4444-4444', source: 'self', ownerLabel: null })
}
{
  const list = [c({ contactValue: '010-9999-9999', isEmergency: true, emergencyName: '김철수', emergencyRelation: '부모님' })]
  eq('대체 · 비상만이면 비상으로 간다',
    pickTenantPhoneWithFallback(list), { value: '010-9999-9999', source: 'emergency', ownerLabel: '김철수(부모님)' })
}
{
  // 비상이 둘이면 정본과 같은 규칙 — 먼저 만든 것.
  const list = [
    c({ contactValue: '010-9999-0002', isEmergency: true, createdAt: D('2026-06-01') }),
    c({ contactValue: '010-9999-0001', isEmergency: true, createdAt: D('2026-02-01') }),
  ]
  eq('대체 · 비상 둘이면 먼저 만든 것', pickTenantPhoneWithFallback(list)?.value, '010-9999-0001')
}
{
  // createdAt 동률이면 id 오름차순 — 정본과 같은 2차 키다(등록 폼이 한 트랜잭션에 넣는다).
  const same = D('2026-04-01')
  const a = c({ id: 'z-late', contactValue: '010-9999-8888', isEmergency: true, createdAt: same })
  const b = c({ id: 'a-early', contactValue: '010-9999-7777', isEmergency: true, createdAt: same })
  eq('대체 · 동률은 id 가 가른다 (1)', pickTenantPhoneWithFallback([a, b])?.value, '010-9999-7777')
  eq('대체 · 입력 순서가 바뀌어도 같은 답 (2)', pickTenantPhoneWithFallback([b, a])?.value, '010-9999-7777')
}
{
  eq('대체 · 연락처가 없으면 null', pickTenantPhoneWithFallback([]), null)
}
{
  // 해외 번호는 본인 것이다 — 대체 문까지 안 간다(source 가 self 여야 화면이 꼬리표를 안 단다).
  const list = [
    c({ contactValue: '+998-90-000-0000', isHomeCountry: true, createdAt: D('2026-01-01') }),
    c({ contactValue: '010-9999-9999', isEmergency: true, createdAt: D('2026-02-01') }),
  ]
  eq('대체 · 해외 본인 번호는 self 다',
    pickTenantPhoneWithFallback(list), { value: '+998-90-000-0000', source: 'self', ownerLabel: null })
}
{
  // 비상 연락처가 메신저 아이디뿐이면 보낼 데가 없다 — 대체도 kinds 를 지킨다.
  const list = [c({ contactValue: 'kakao-mom', contactType: 'KAKAO', isEmergency: true })]
  eq('대체 · 비상이 메신저뿐이면 null', pickTenantPhoneWithFallback(list), null)
}
{
  // 주인 표기 네 갈래.
  const mk = (o: { emergencyName?: string; emergencyRelation?: string }) =>
    pickTenantPhoneWithFallback([c({ contactValue: '010-9999-9999', isEmergency: true, ...o })])?.ownerLabel
  eq('주인 표기 · 둘 다', mk({ emergencyName: '김철수', emergencyRelation: '부모님' }), '김철수(부모님)')
  eq('주인 표기 · 이름만', mk({ emergencyName: '김철수' }), '김철수')
  eq('주인 표기 · 관계만', mk({ emergencyRelation: '부모님' }), '부모님')
  eq('주인 표기 · 둘 다 없으면 null', mk({}), null)
}
{
  // 문자 갈래(kinds=['PHONE'])는 유선을 뺀다 — 비상 유선전화로는 문자가 안 간다.
  const list = [c({ contactValue: '02-000-0000', contactType: 'LANDLINE', isEmergency: true })]
  eq('대체 · 문자 갈래에서 비상 유선은 null', pickTenantPhoneWithFallback(list, ['PHONE']), null)
  eq('대체 · 서류 갈래에서는 유선도 번호다', pickTenantPhoneWithFallback(list)?.value, '02-000-0000')
}

// ══ 예약 확정 게이트 ═════════════════════════════════════════════
// 본인 전화번호가 있어야 방을 잡아 둔다. 유선·해외는 통과, 메신저 아이디와 비상 연락처는 거부.

const EMERGENCY_ONLY = '예약 확정 시 본인 연락처는 필수입니다. 지금은 비상 연락처만 등록돼 있습니다.'
const NO_CONTACT     = '예약 확정 시 본인 연락처는 필수입니다. 등록된 연락처가 없습니다.'
const MESSENGER_ONLY = '예약 확정 시 본인 전화번호는 필수입니다. 지금은 메신저 연락처만 등록돼 있습니다.'
const gate = (contacts: TenantPhoneContact[], alreadyConfirmed = false) =>
  reservationConfirmPhoneDenial({ contacts, alreadyConfirmed })

{
  eq('게이트 · 국내 휴대폰이면 통과', gate([c({ contactValue: '010-1111-1111' })]), null)
}
{
  // 유선전화도 전화다 — 문자가 안 갈 뿐 연락은 된다(그 사정은 폼 안내가 말한다).
  eq('게이트 · 유선전화도 통과', gate([c({ contactValue: '02-000-0000', contactType: 'LANDLINE' })]), null)
}
{
  eq('게이트 · 해외 번호만 있어도 통과',
    gate([c({ contactValue: '+998-90-000-0000', isHomeCountry: true })]), null)
}
{
  eq('게이트 · 비상만이면 거부', gate([c({ contactValue: '010-9999-9999', isEmergency: true })]), EMERGENCY_ONLY)
}
{
  eq('게이트 · 연락처가 없으면 거부', gate([]), NO_CONTACT)
}
{
  // 운영자 결정 — 메신저 아이디는 연락 수단으로 안 센다.
  eq('게이트 · 메신저 아이디만이면 거부',
    gate([c({ contactValue: 'kakao-id', contactType: 'KAKAO', isPrimary: true })]), MESSENGER_ONLY)
}
{
  // 본인은 메신저뿐이고 비상 전화가 있는 사람 — 고칠 곳은 본인 칸이므로 메신저 문구가 맞다.
  const list = [
    c({ contactValue: 'kakao-id', contactType: 'KAKAO', isPrimary: true }),
    c({ contactValue: '010-9999-9999', isEmergency: true }),
  ]
  eq('게이트 · 본인 메신저 + 비상 전화는 메신저 문구', gate(list), MESSENGER_ONLY)
}
{
  // 이미 확정된 계약은 소급해서 막지 않는다 — 이름만 고치는 저장이 문에 걸리면 안 된다.
  eq('게이트 · 이미 확정됐으면 비상만이어도 통과',
    gate([c({ contactValue: '010-9999-9999', isEmergency: true })], true), null)
  eq('게이트 · 이미 확정됐으면 연락처가 없어도 통과', gate([], true), null)
}

console.log(`\n입주자 전화번호 정본 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
