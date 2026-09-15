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

import { pickTenantPhone, type TenantPhoneContact } from '../lib/tenantContact'

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
const c = (o: Partial<TenantPhoneContact> & { contactValue: string }): TenantPhoneContact => ({
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
  // 호출부가 넘긴 배열을 뒤집지 않는다 — 같은 배열을 다른 용도로 또 쓰는 자리가 있다.
  const list = [
    c({ contactValue: '010-2222-2222', createdAt: D('2026-05-01') }),
    c({ contactValue: '010-1111-1111', createdAt: D('2026-03-01') }),
  ]
  pickTenantPhone(list)
  eq('안정성 · 인자 배열을 제자리에서 정렬하지 않는다',
    list.map(x => x.contactValue), ['010-2222-2222', '010-1111-1111'])
}

console.log(`\n입주자 전화번호 정본 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
