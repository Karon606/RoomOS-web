// 환경설정 폼(FormData)을 Property 갱신 패치로 옮기는 순수 정본 — 실려 온 필드만 쓴다.
//
// 왜 이 파일이 따로 있나. updatePropertySettings 는 예전에 기본정보 폼 하나를 통짜로 받아
// 모든 칼럼을 한 번에 덮었다. 2026-08-18 IA 1단계에서 슬러그가 웹사이트 탭으로 떠나자
// "폼에 없는 필드를 그냥 읽으면 null 이 된다"는 함정이 드러났고(영업장명만 고쳐 저장해도
// 소개 페이지 주소가 조용히 지워졌다), 2026-08-19 IA 2단계에서 요금·서류 필드가 세 탭으로
// 흩어지면서 같은 함정이 필드 수만큼 늘어났다.
//
// 그래서 저장 경로를 필드 단위로 분해했다. 규칙은 하나다 — **폼이 그 필드를 실어 보냈을 때만
// 그 칼럼을 쓴다.** 어느 탭에서 저장하든 그 탭이 담당하지 않는 칼럼은 패치에 아예 등장하지
// 않으므로 덮일 수가 없다. 옛 폼(캐시된 번들)이 전 필드를 통째로 보내도 종전대로 저장되므로
// 배포 경계에서도 안전하다.
//
// 순수 함수인 이유는 두 가지다. 서버 액션(actions.ts) 안에 두면 회귀 테스트가 prisma·인증을
// 통째로 끌고 와야 하고, 감지망(check-settings-slug-guard)이 볼 자리도 흐려진다.
// 저장 범위 회귀는 scripts/test-settings-save-scope.ts 가 이 함수로 전수 대조한다.

/** 임의처분 동의서는 칼럼 하나(JSON)라 네 칸이 한 벌로 움직인다. */
import { normalizeMailFromLocal } from './mailFrom'

export type DisposalConsentPatch = {
  enabled: boolean
  days: number
  title: string
  body: string
}

/**
 * 추가 호실(창고) 특약 — 제목 한 줄과 항목 여러 줄이 칼럼 하나(JSON)로 간다.
 *
 * **항목을 비우는 것이 곧 '이 영업장은 이 특약을 안 쓴다'이다.** 그래서 빈 배열도 저장한다 —
 * lib/contract resolveSubLeaseAddendum 이 null(미설정, 기본 문안)과 빈 배열(안 씀)을 가른다.
 * 비었다고 저장을 건너뛰면 지운 문안이 다음 발급에서 되살아난다.
 */
export type SubLeaseAddendumPatch = {
  title: string
  items: string[]
}

/** 실려 온 필드만 담긴 부분 패치 — 없는 키는 prisma.update 가 건드리지 않는다. */
export type PropertySettingsPatch = {
  name?: string
  address?: string | null
  phone?: string | null
  replyToEmail?: string | null
  mailFromLocal?: string | null
  mailCopyToSelf?: boolean
  acquisitionDate?: Date | null
  prevOwnerCutoffDate?: Date | null
  defaultDeposit?: number | null
  defaultCleaningFee?: number | null
  defaultAreaM2?: number | null
  reservationDepositMode?: string
  bankAccount?: string | null
  contactLeadDays?: number
  checkoutLeadShortDays?: number
  checkoutLeadMonths?: number
  refundPenaltyPct?: number | null
  refundClauseInContract?: boolean
  cleaningFeeInDeposit?: boolean
  multiContractVersions?: boolean
  disposalConsentTemplate?: DisposalConsentPatch
  subLeaseAddendum?: SubLeaseAddendumPatch
  shortStayAddendum?: SubLeaseAddendumPatch
  earlyCheckoutAddendum?: SubLeaseAddendumPatch
  roomScheduleAddendum?: SubLeaseAddendumPatch
  publicSlug?: string | null
}

/** 소개 페이지 주소(슬러그) — 소문자·숫자·하이픈만. 통짜 저장과 전용 저장이 같은 규칙을 써야
 *  어느 쪽으로 들어와도 같은 값이 남는다. */
export function normalizePublicSlug(raw: string | null): string {
  return raw ? raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : ''
}

/** 체크박스는 꺼져 있으면 FormData 에 아예 안 실린다 — 그대로 두면 has 판정이 "이 탭은 이 필드를
 *  담당하지 않는다"와 "담당하는데 껐다"를 구분하지 못해 체크를 풀 길이 사라진다.
 *  그래서 폼마다 같은 이름의 hidden '0' 을 체크박스 앞에 세워 두고, 값은 '1' 이 함께 실렸는지로 읽는다.
 *  감지망 축 ⓔ 가 체크박스마다 그 hidden 짝이 있는지 지킨다. */
function checkboxOn(formData: FormData, key: string): boolean {
  return formData.getAll(key).includes('1')
}

const str = (formData: FormData, key: string) => (formData.get(key) as string | null) ?? ''
const digits = (v: string) => v.replace(/[^0-9]/g, '')

export function buildPropertySettingsPatch(
  formData: FormData,
  opts: { isOwner: boolean },
): PropertySettingsPatch {
  const patch: PropertySettingsPatch = {}

  // ── 기본정보 탭 ────────────────────────────────────────────────
  // 영업장명은 빈 값이면 안 쓴다(종전 `name || undefined` 문법 유지) — 필수 칸이 비어 온 저장으로
  // 이름이 지워지지 않게.
  if (formData.has('name')) {
    const name = str(formData, 'name')
    if (name) patch.name = name
  }
  if (formData.has('address')) patch.address = str(formData, 'address') || null
  if (formData.has('phone')) patch.phone = str(formData, 'phone') || null
  // 서류 메일의 답장 받을 주소 — 형식 검증은 폼(type=email)이 하고 여기는 공백만 턴다.
  if (formData.has('replyToEmail')) patch.replyToEmail = str(formData, 'replyToEmail').trim() || null
  // 발신 주소 앞부분 — 규칙은 lib/mailFrom 정본 하나다(저장·발송·표시가 같은 규칙을 지난다).
  // 여기서 다시 적으면 저장된 값과 실제로 나가는 주소가 갈린다.
  if (formData.has('mailFromLocal')) {
    patch.mailFromLocal = normalizeMailFromLocal(str(formData, 'mailFromLocal')) || null
  }
  // 사본 받기 — 체크박스라 hidden '0' 짝과 함께 읽는다(감지망 축 ⓔ).
  if (formData.has('mailCopyToSelf')) patch.mailCopyToSelf = checkboxOn(formData, 'mailCopyToSelf')
  if (formData.has('acquisitionDate')) {
    const v = str(formData, 'acquisitionDate')
    patch.acquisitionDate = v ? new Date(v) : null
  }
  if (formData.has('prevOwnerCutoffDate')) {
    const v = str(formData, 'prevOwnerCutoffDate')
    patch.prevOwnerCutoffDate = v ? new Date(v) : null
  }
  if (formData.has('contactLeadDays')) {
    patch.contactLeadDays = Math.min(90, Math.max(1, Number(digits(str(formData, 'contactLeadDays'))) || 14))
  }
  // 퇴실 예정 자동 전환 리드 — 판정은 lib/autoCheckout. 0 은 '퇴실 당일에 바꾼다'는 뜻이라 허용한다.
  if (formData.has('checkoutLeadShortDays')) {
    patch.checkoutLeadShortDays = Math.min(60, Math.max(0, Number(digits(str(formData, 'checkoutLeadShortDays')))))
  }
  if (formData.has('checkoutLeadMonths')) {
    patch.checkoutLeadMonths = Math.min(6, Math.max(0, Number(digits(str(formData, 'checkoutLeadMonths')))))
  }

  // ── 요금·정책 탭 ───────────────────────────────────────────────
  if (formData.has('defaultDeposit')) {
    const v = str(formData, 'defaultDeposit')
    patch.defaultDeposit = v ? Number(digits(v)) : null
  }
  if (formData.has('defaultCleaningFee')) {
    const v = str(formData, 'defaultCleaningFee')
    patch.defaultCleaningFee = v ? Number(digits(v)) : null
  }
  // 예약금 기본 처리 — 'deposit'(보증금 대체)|'prepaid'(이용료 선납)|'none'(안 받음). 미허용값은 기본으로.
  if (formData.has('reservationDepositMode')) {
    const raw = str(formData, 'reservationDepositMode')
    patch.reservationDepositMode = ['deposit', 'prepaid', 'none'].includes(raw) ? raw : 'deposit'
  }
  // 퇴실 환불 규정: 기간·1일당·청소비 차감은 여전히 미사용(법정 산식 고정).
  // 위약금율만 설정 가능 — 공정위 기준(10%)을 상한 캡으로(운영자 결정 2026-07-20).
  if (formData.has('refundPenaltyPct')) {
    const raw = str(formData, 'refundPenaltyPct')
    patch.refundPenaltyPct = raw.trim() !== '' ? Math.min(10, Math.max(0, Number(digits(raw)) || 0)) : null
  }
  if (formData.has('refundClauseInContract')) {
    patch.refundClauseInContract = checkboxOn(formData, 'refundClauseInContract')
  }
  // 청소비 수령 방식 — 돈의 구성을 바꾸는 설정이라 소유자만 고칠 수 있다.
  // 체크박스는 소유자에게만 렌더되지만, 역할을 안 보고 저장하면 위조된 폼 한 번에 뒤집힌다.
  if (formData.has('cleaningFeeInDeposit') && opts.isOwner) {
    patch.cleaningFeeInDeposit = checkboxOn(formData, 'cleaningFeeInDeposit')
  }

  // ── 계약서·서류 탭 ─────────────────────────────────────────────
  // 여러 판본 만들기 — 법적 위험이 걸린 설정이라 소유자만 고친다(청소비 토글과 같은 이유).
  // 체크박스는 소유자에게만 렌더되지만, 역할을 안 보고 저장하면 위조된 폼 한 번에 뒤집힌다.
  if (formData.has('multiContractVersions') && opts.isOwner) {
    patch.multiContractVersions = checkboxOn(formData, 'multiContractVersions')
  }
  if (formData.has('defaultAreaM2')) {
    const v = str(formData, 'defaultAreaM2')
    patch.defaultAreaM2 = v.trim() ? Number(v.replace(/[^0-9.]/g, '')) || null : null
  }
  if (formData.has('bankAccount')) patch.bankAccount = str(formData, 'bankAccount').trim() || null
  // 잔여 소지품 임의처분 동의서 — 네 칸이 칼럼 하나(JSON)라 넷이 다 실려 왔을 때만 쓴다.
  // 하나라도 빠지면 안 쓰는 쪽으로 기운다(덜 쓰는 것은 되돌릴 수 있고, 덮는 것은 못 되돌린다).
  if (formData.has('disposalEnabled') && formData.has('disposalDays')
    && formData.has('disposalTitle') && formData.has('disposalBody')) {
    const daysRaw = str(formData, 'disposalDays')
    patch.disposalConsentTemplate = {
      enabled: checkboxOn(formData, 'disposalEnabled'),
      days: daysRaw.trim() ? Number(digits(daysRaw)) || 7 : 7,
      title: str(formData, 'disposalTitle').trim() || '잔여 소지품 임의처분 동의서',
      body: str(formData, 'disposalBody'),
    }
  }

  // 추가 호실 특약 — 두 칸이 칼럼 하나(JSON)라 둘 다 실려 왔을 때만 쓴다(위 동의서와 같은 규칙).
  // 항목은 한 줄에 하나. 빈 줄은 버리고, 남는 것이 없으면 빈 배열로 저장한다 — 그것이
  // "이 영업장은 이 특약을 안 쓴다"는 뜻이고, 미설정(null, 기본 문안)과 다른 상태다.
  // 조건부 특약 셋이 같은 규칙을 쓴다 — 한 벌만 다르게 저장하면 그 절만 되살아나거나 사라진다.
  const addendum = (titleKey: string, itemsKey: string): SubLeaseAddendumPatch | undefined =>
    formData.has(titleKey) && formData.has(itemsKey)
      ? {
        title: str(formData, titleKey).trim(),
        items: str(formData, itemsKey).split('\n').map(v => v.trim()).filter(Boolean),
      }
      : undefined
  const sub = addendum('subLeaseTitle', 'subLeaseItems')
  if (sub) patch.subLeaseAddendum = sub
  const short = addendum('shortStayTitle', 'shortStayItems')
  if (short) patch.shortStayAddendum = short
  const early = addendum('earlyCheckoutTitle', 'earlyCheckoutItems')
  if (early) patch.earlyCheckoutAddendum = early
  const roomSched = addendum('roomScheduleTitle', 'roomScheduleItems')
  if (roomSched) patch.roomScheduleAddendum = roomSched

  // ── 웹사이트 탭 ────────────────────────────────────────────────
  // 지금 이 폼에는 슬러그 입력이 없다(정주소는 웹사이트 탭의 updatePublicSlug). 옛 번들이 계속
  // 보내오는 경우에만 종전대로 저장된다 — 감지망 축 ⓒ 가 폼 부활을 막는다.
  if (formData.has('publicSlug')) {
    patch.publicSlug = normalizePublicSlug(formData.get('publicSlug') as string | null) || null
  }

  return patch
}
