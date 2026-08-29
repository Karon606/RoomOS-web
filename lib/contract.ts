// 계약서 템플릿 타입 + 기본값.
// 영업장별로 prisma.property.contractTemplate 에 JSON으로 저장.
// 헤더 표(입주자 정보)와 서명/사업자 정보 영역은 출력 페이지가 자동 생성하고,
// 본문 섹션(이용 규칙·해지 등)만 여기 템플릿에 담는다.

export type ContractSection = {
  id: string
  title: string         // "1. 입실 계약" 등
  items: string[]       // 각 줄 (- 으로 시작 가능, 그대로 표기)
}

export type ContractTemplate = {
  title: string         // "도시하이 원룸텔 단기숙소계약서"
  emergencyContactNote?: string  // "* 비상연락망(이름/전화번호/관계-위급상황시 통보):"
  sections: ContractSection[]
  oathText: string      // "상기 규칙을 숙지하였으며 ..."
}

export type BusinessInfo = {
  name: string          // 상호 (예: 도시하이 원룸텔 단기숙소)
  registrationNo: string  // 사업자번호 (예: 718-08-03079)
  ceoName: string       // 대표자명
  address: string       // 사업장 주소
}

// 도시하이 원룸텔 단기숙소 — 기본 템플릿(사용자 양식 반영).
// 새 영업장은 이 값을 시작점으로 보여주고, 환경설정에서 자유롭게 편집한다.
export const DEFAULT_CONTRACT_TEMPLATE: ContractTemplate = {
  title: '단기숙소계약서',
  emergencyContactNote: '* 비상연락망(이름/전화번호/관계-위급상황시 통보):',
  sections: [
    {
      id: 'lease',
      title: '1. 입실 계약',
      items: [
        '- 1인 1실을 원칙으로 하며, 입실권리를 타인에게 양도/대여 할 수 없습니다.',
        '- 기본 계약기간은 1개월로 합니다. (입실료는 별도될 수 있습니다.)',
        '- 입실료는 매월 선납을 원칙으로 합니다. (반드시 입실일 기준 전일까지 납부해야 합니다.)',
        '- 1개월 미만으로 연장할 경우 일 단위 결제하며 1일당 30,000원 입니다.',
        '- 입실료 납부일 3일 경과 후에도 별 다른 협의 없이 미납할 경우 방을 회수하고 방안의 짐은 창고에 보관하며 2주 이내 찾아가지 않을 경우 임의로 폐기합니다.',
        '- 화재발생, 방역 및 긴급수리, 비상 상황 시 마스터키를 사용해 룸을 출입할 수 있습니다.',
        '- 연락두절 시 창고에 룸안의 모든 짐을 3일간 보관하며, 찾아가지 않을 시 폐기처리합니다. (보관료 1일 3만원)',
      ],
    },
    {
      id: 'checkout',
      title: '2. 퇴실 및 환불',
      items: [
        // {{환불규정}} 은 기본 템플릿에만 있다. 운영자가 §2 를 직접 다시 쓴 영업장에는 자리표시자가
        // 없어 토글을 켜도 아무 데도 안 나온다. 그 상태를 '환불 조항은 넣지 않는다'로 확정했다
        // (운영자 판단 2026-08-03). 설정 화면이 거짓을 말하지 않도록 안내를 함께 고쳤다.
        '- 퇴실 시 입실료 환불은 관계 법령 및 공정거래위원회 기준에 따릅니다.{{환불규정}}{{청소비공제}}',
        '- 퇴실 7일 전 본 사업자에게 알려주어야 합니다. 퇴실의사 전달 시 1개월 자동연장 됩니다. (구두 불가, 문자로)',
        '- 퇴실 후 실내 청소 상태와 입실 시 상태 동일해야 합니다.',
        // 청소비는 계약별 설정값 치환({{청소비}}) — 특정 영업장 금액 하드코딩 금지(상용화 감사 A5)
        //
        // 문구에 '청소 용역의 대가'와 두 징수 방식을 명시한다(회계 패널 2026-08-02).
        // 성격이 애매하면 (a) 수익 인식 시점이 입실월인지 퇴실월인지 근거가 없고
        // (b) 부가세에서 용역 대가(과세)인지 손해배상(불과세)인지 판정이 갈린다.
        // 보증금 없는 단기는 입실 때 따로 받는데 종전 문구는 그 경우를 아예 다루지 않았다.
        // 조항 **전체**를 변수로 올린다(2026-08-03). 금액만 치환하면 청소비 0원 계약에서
        // 화면은 '청소비 0원은 ...', 인쇄는 '청소비 은 ...' 이 되어 비문이 되고,
        // 없는 금액에 대해 '공제하겠다'는 채무를 선언한다. 실측 거주 계약 41건 중 29건이 0원이다.
        '- {{청소비조항}}',
        '- 집기파손, 기물파손, 오물 등 책임 소재가 분명한 경우 별도 비용이 청구될 수 있습니다.',
      ],
    },
    {
      id: 'rules',
      title: '3. 생활 수칙',
      items: [
        '- 공동시설/비품 사용 후 항상 원상태로 정리하며, 개인소지품은 개인보관함에 보관합니다.',
        '- 공용세탁기/건조기 사용 전 외출 전 옷가지 가져가지 않은 타인의 세탁물 발견 시 세탁바구니에 넣은 후 사용합니다.',
        '- 전기히터, 가스버너 등 개별 온열/취사용품은 화재위험으로 절대로 사용 불가하며, 적발 시 퇴실 조치합니다.\n  (지정 장소에서만 취사 가능함)',
        '- 타인에게 피해를 줄 수 있는 화기 및 폭발성과 휘발성물건 또는 위해동물 등의 소내 반입을 금합니다.',
        '- 택배물은 본인 직접 수령하며 본 사업자는 단지 수령 장소만을 제공합니다.',
        '- 본인의 쓰레기는 반드시 직접 분리 수거하며 음식물 제거 후 배출합니다.',
        '- 상호 간 쾌적한 주거 환경을 위하여 소음 발생을 최소화하는데 협조합니다.',
        '- 개인물품은 각자의 책임관리를 원칙으로 하며, 개인의 부주의로 인한 파손/분실 시 본 사업자는 책임지지 않습니다.',
        '- 실내의 시설, 변기, 화장구마학, 등교체, 콘크롤, 벽지/장판 손상, 침실(가구 등), 사후처일, 물품(주방기기) 등에 대한 분실 및\n  파손에 대해서는 원상복구 하거나 변상해야 합니다.',
      ],
    },
    {
      id: 'forced',
      title: '4. 강제 퇴실(환불없음)',
      items: [
        '- 외부인 데려옴, 흡연, 실내음주, 소동, 쓰레기투척, 실내흡연, 폭력행위, 절도, 물품훼손, 위생상태 불량시 즉시 퇴실 조치',
        '- 정신 질환(조현병 등) 및 전염병, 해충 질환자로서 타인에게 해를 끼치는 경우 즉시 퇴실 조치.',
        '- 상기 생활 수칙, 관리자의 주의사항 지시 및 경고를 임의로 거부할 경우 퇴실 조치합니다.',
      ],
    },
  ],
  oathText: '상기 규칙을 숙지하였으며 위반 시 어떠한 조치에도 이의를 제기하지 않을 것에 대해 서약합니다.',
}

// 변수 치환: {{key}} 형태를 실제 값으로 교체.
// 본문 섹션 items, title, oathText 모두에 적용 가능.
export function renderContractText(text: string, vars: Record<string, string>): string {
  // {{key}} — key 는 영문/한글 모두 허용(공백 trim). 매칭 없으면 원문 유지.
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[String(key).trim()] ?? `{{${String(key).trim()}}}`)
}

// 이 기본 템플릿의 고정 금액(1일 연장 3만·보관료 3만 등)은 시드 예시 — 각 영업장이 환경설정 > 계약서에서 자기 기준으로 수정해 쓰는 값이다(상용화 감사 A5 주석).
// 계약서 환불 조항({{환불규정}}) — 공정거래위원회 기준 고정 문구.
// 위약금율(10%)·기간 조건은 법적으로 임의 설정이 불가하므로 환경설정에서 제거하고 문구로 고정한다.
export function buildRefundClause(): string {
  return '중도 퇴실 시 환불액은 「총 결제금액 − (1일 이용요금 × 실제 이용일수) − 위약금(총 결제금액의 10%)」으로 산정하며, 1일 이용요금은 월 이용료의 30분의 1로 합니다.'
}

// ── 추가 호실 특약(보관 용도) ────────────────────────────────────────
//
// 창고·사무실처럼 거주용이 아닌 방을 추가 호실로 딸고 있는 계약서에만 코드가 붙이는 절이다.
// 환불 조항·신원번호 동의문과 같은 방식이다 — 영업장 템플릿에 넣으면 운영자가 지울 수 있고,
// 지워진 채로 창고 호실만 인쇄된다. 그러면 그 방을 주거로 쓰지 말라는 근거가 종이 어디에도 없다.
//
// **template 객체에 주입하지 않는다.** 본문 템플릿은 박제·드리프트 비교의 축(printedFacts.template)
// 이라, 코드가 만든 절을 그 안에 섞으면 조항을 한 글자도 안 고친 계약서가 통째로 드리프트로 뜬다.
// 그래서 ContractData 의 별도 칸으로 내려가고, 렌더 직전에 절 배열 뒤에 붙는다.
//
// 문안은 전 영업장 공통 고정이다(운영자 위임 확정 2026-08-19). 영업장별 편집은 별도 백로그다.
export type SubLeaseAddendum = { title: string; items: string[] }

/**
 * 조항 항목의 글머리를 벗긴다 — 기호와 **손으로 박은 번호**를 모두 걷는다.
 *
 * 번호는 자리에서 매긴다(CSS counter). 본문 글자 안에 번호가 박혀 있으면 두 가지가 어긋난다.
 *   · 안 박힌 항목은 번호가 없다 — 추가 호실 특약 8개 전부, '[청소비]', '[강제 퇴실 시 정산 규정]'
 *     이 그랬다. 운영자가 "몇 조 몇 항"으로 가리켜야 하는데 가리킬 번호가 없었다(2026-08-27).
 *   · 운영자가 템플릿에서 항목을 끼워 넣으면 그 뒤 번호를 전부 손으로 고쳐야 한다.
 *
 * **화면과 인쇄본이 이 함수 하나를 쓴다.** 종전에는 규칙이 두 벌이었고 인쇄본만 번호를 벗겨서,
 * 화면은 '· 1. 1인 1실을'로 이중 표기가 됐다. 화면 쪽 주석에는 "동일 규칙"이라고 적혀 있었지만
 * 사실이 아니었다 — 손사본은 언젠가 갈린다.
 */
export function stripClauseBullet(s: string): string {
  return s.replace(/^\s*(?:[-–•·]\s?|\d+[.)]\s*|[가-힣][.)]\s+)/, '')
}

export const DEFAULT_SUB_LEASE_ADDENDUM: SubLeaseAddendum = {
  title: '추가 호실 특약(보관 용도)',
  items: [
    '추가 호실은 위 표에 적힌 별도 계약에 따라 이용하는 공간이며, 주거 용도로 사용할 수 없습니다. 취침, 취사, 난방기구 사용을 금하며 물품 보관 등 계약 시 정한 용도로만 이용합니다.',
    '추가 호실에는 화기 및 인화성/폭발성/휘발성 물질, 부패하거나 악취를 유발하는 물품, 동식물, 법령상 보관이 금지된 물품을 보관할 수 없습니다.',
    '현금, 귀중품, 유가증권 등 고가품은 보관하지 않는 것을 원칙으로 하며, 보관물의 도난/훼손/멸실에 대해 본 사업자의 고의 또는 중대한 과실이 없는 한 책임지지 않습니다.',
    '보관물의 관리 책임은 입실자 본인에게 있으며, 보관물로 인하여 화재/누수/해충/악취 등 시설 또는 타인의 피해가 발생한 경우 원상복구 하거나 변상해야 합니다.',
    '화재발생, 방역 및 긴급수리, 비상 상황 시 마스터키 출입 규정은 추가 호실에도 동일하게 적용됩니다.',
    '추가 입실료는 본 계약 입실료와 같은 방법으로 매월 선납하며, 환불과 미납 시 처리, 연락두절 시 처리는 본 계약서의 해당 조항을 추가 호실에 동일하게 적용합니다.',
    '추가 호실 이용을 중단할 때는 7일 전에 알려주어야 하며, 종료일까지 보관물을 전부 반출하고 호실을 처음 상태로 반환해야 합니다. 기한 내 반출하지 않은 물품은 연락두절 시 처리 조항에 따라 보관 후 폐기될 수 있습니다.',
    '본 계약이 종료되는 경우 추가 호실 이용 계약도 함께 종료됩니다. 추가 호실만 계속 이용하려면 별도 계약을 새로 체결해야 합니다.',
  ],
}

/**
 * 저장된 JSON(부분·구버전 가능)을 특약으로 해석 — 폐기 동의서(resolveDisposalConsent)와 같은 문법.
 *
 * **null 과 빈 항목은 다른 말이다.**
 *   · 저장값 자체가 없으면 아직 손댄 적 없는 영업장이라 기본 문안을 그대로 쓴다.
 *   · 항목을 전부 지웠으면 운영자가 "이 영업장은 이 특약을 안 쓴다"고 정한 것이라 절을 안 붙인다.
 * 이 둘을 같게 다루면, 문안을 지운 영업장에 기본값이 되살아나 지운 적 없는 조항이 종이에 실린다.
 *
 * 종전에는 문안이 코드 상수 하나였다. 지워지면 그 방을 주거로 쓰지 말라는 근거가 종이에서
 * 사라진다는 이유였는데, 운영자 판단으로 연다(2026-08-29) — "영업장 관리 주체에 따라 운영방식이
 * 다를 수도 있으니". 멀티테넌트에서 이 문안은 한 영업장의 운영 방식이지 법이 아니다.
 */
export function resolveSubLeaseAddendum(raw: unknown): SubLeaseAddendum | null {
  if (raw == null) return DEFAULT_SUB_LEASE_ADDENDUM
  const d = (typeof raw === 'object' ? raw : {}) as Partial<SubLeaseAddendum>
  const items = Array.isArray(d.items) ? d.items.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  if (items.length === 0) return null
  const title = typeof d.title === 'string' && d.title.trim() ? d.title : DEFAULT_SUB_LEASE_ADDENDUM.title
  return { title, items }
}

// ── 거주 호실 일정 절 ────────────────────────────────────────────────
//
// 계약 호실이 빌 때까지 다른 방에 머무는 계약에만 붙는 절이다. 운영자 요구 그대로다 —
// "계약서 어딘가에 몇일까지는 어느호실 그 다음부터는 어느호실이 다 적혀있으면 더 확실하고".
//
// 종이에 일정이 다 적혀 있으면 방이 옮겨질 때마다 계약서를 다시 뽑을 일이 없다("기록 갱신도
// 필요없지"). 추가 호실 특약과 같은 방식으로 절 배열 뒤에 붙고, 일정이 없으면 null 이라
// 그 계약서의 렌더가 이 기능 전과 문자 단위로 같다.
export function buildRoomScheduleAddendum(scheduleText: string | null | undefined): SubLeaseAddendum | null {
  if (!scheduleText) return null
  return {
    title: '거주 호실 일정',
    items: [
      `입실자는 다음 일정에 따라 호실에 거주합니다. ${scheduleText}`,
      '위 일정의 마지막 호실이 계약 호실이며, 그 전까지 머무는 호실은 임시로 제공되는 공간입니다. 이용료와 계약 조건은 호실이 바뀌어도 달라지지 않습니다.',
    ],
  }
}

/**
 * 절 배열 뒤에 특약을 붙인다. 화면·인쇄가 같은 함수를 쓴다.
 *
 * **null 이면 받은 배열을 그대로 돌려준다.** 특약이 없는 계약서의 렌더가 이 기능 전과
 * 문자 단위로 같아야 하고, 그 사실을 새 배열을 만들지 않는 것으로 보장한다.
 * 절 번호는 앞 절 개수로 정한다 — 운영자가 조항을 늘리거나 지워도 번호가 이어진다(기본 5).
 */
export function appendSubLeaseAddendum<T extends { title: string; items: string[] }>(
  sections: T[],
  ...addenda: (SubLeaseAddendum | null | undefined)[]
): Array<T | { title: string; items: string[] }> {
  const live = addenda.filter((a): a is SubLeaseAddendum => !!a)
  if (live.length === 0) return sections
  const out: Array<T | { title: string; items: string[] }> = [...sections]
  for (const a of live) out.push({ title: `${out.length + 1}. ${a.title}`, items: a.items })
  return out
}

// 조항 2단은 CSS(column-count)가 나눈다 — 분배 함수는 2026-08-26 에 걷었다.
//
// ⚠️ **조항 순서 절대 불변**은 그대로다. 다만 이제 DOM 이 선형이라 **구조적으로 자동 충족된다** —
// 순서를 뒤섞을 자리 자체가 없다.
//
// 종전에는 splitClauseColumns 가 글자 수로 높이를 추정해 좌우를 반반으로 갈랐다. 그 구조가
// 필요했던 이유는 "CSS 멀티컬럼이 Chrome 인쇄에서 1단으로 흐른다"는 2026-06-29 실측이었는데,
// **재실측에서 재현되지 않는다**(Chrome 151). 그 사이 flex 2단이 결함을 냈다 — 페이지 경계에서
// 각 단이 독립적으로 이어 그려져, 조항이 한 장을 넘치면 3조가 2페이지·4조가 1페이지가 됐다.
//
// 새로 2단을 손으로 나누는 코드를 만들지 마라. 경위와 실측은 knowledge/domain-contracts.md 에 있다.

// ── 잔여 소지품 임의처분 동의서 — 계약서와 함께 출력되는 별도 서류 ──────────
// body 는 {{성명}} {{호실}} {{연락처}} {{미납일수}} {{영업장명}} {{대표}} 등 변수 사용.
export type DisposalConsentTemplate = {
  enabled: boolean      // 계약서와 함께 출력할지
  days: number          // 미납 기준일 ({{미납일수}})
  title: string
  body: string          // 동의 내용 (줄바꿈으로 문단 구분)
}
export const DEFAULT_DISPOSAL_CONSENT: DisposalConsentTemplate = {
  enabled: false,
  days: 7,
  title: '잔여 소지품 임의처분 동의서',
  body:
    "본인(입실자)은 '{{영업장명}}' 이용 중, 입실료 납부일로부터 ({{미납일수}})일 이상 미납하고 사전 연락 없이 통신이 두절될 경우, 본 시설의 이용 계약을 포기한 것으로 간주함에 명시적으로 동의합니다.\n" +
    "또한, 타 입실자의 피해 예방 및 원활한 시설 운영을 위하여, 위 조건에 해당할 시 관리자가 임의로 호실을 개방하는 것에 동의합니다. 아울러 호실 내부에 남겨진 본인의 모든 잔여 물품을 관리자가 임의로 반출, 보관(보관료 1일 3만 원 청구), 처분 및 폐기하는 것에 일체 동의하며, 추후 이와 관련하여 민사상 손해배상 청구나 형사상 고소(절도, 주거침입, 재물손괴 등) 등 어떠한 이의도 제기하지 않을 것을 서약합니다.\n" +
    "본인은 위 특약의 의미와 법적 효력을 관리자로부터 충분히 설명을 듣고 이해하였으며, 자유로운 의사에 따라 본 서약에 동의합니다.",
}

// 저장된 JSON(부분/구버전 가능)을 안전하게 DisposalConsentTemplate 로 해석(기본값 폴백).
export function resolveDisposalConsent(raw: unknown): DisposalConsentTemplate {
  const d = (raw && typeof raw === 'object' ? raw : null) as Partial<DisposalConsentTemplate> | null
  return {
    enabled: d?.enabled ?? DEFAULT_DISPOSAL_CONSENT.enabled,
    days:    typeof d?.days === 'number' ? d.days : DEFAULT_DISPOSAL_CONSENT.days,
    title:   d?.title ?? DEFAULT_DISPOSAL_CONSENT.title,
    body:    d?.body ?? DEFAULT_DISPOSAL_CONSENT.body,
  }
}

// 청소비 관련 치환값 정본 — 화면(ContractView)과 인쇄(contractPrintHtml)가 같은 문자열을 쓰게 한다.
//
// 종전에는 두 곳이 각자 규칙을 갖고 있었다. 인쇄는 `cln > 0 ? '20,000원' : ''`,
// 화면은 무조건 `toLocaleString() + '원'`. 청소비 0원 계약에서
//   화면 "청소비 0원은 퇴실 후 실내 청소 용역의 대가입니다"
//   인쇄 "청소비 은 퇴실 후 실내 청소 용역의 대가입니다"
// 로 갈렸고 둘 다 없는 금액에 대해 공제를 선언했다(운영자 확인 2026-08-03 — '청소비 없음'으로 명시).
export function cleaningFeeVars(cleaningFee: number | null | undefined): {
  청소비: string; 청소비조항: string; 청소비공제: string
} {
  const cln = cleaningFee ?? 0
  if (cln <= 0) {
    return {
      청소비: '없음',
      청소비조항: '[청소비] 이 계약은 청소비가 없습니다. 퇴실 시 청소비 명목으로 공제하지 않습니다.',
      청소비공제: '',
    }
  }
  const won = `${cln.toLocaleString()}원`
  return {
    청소비: won,
    // 성격을 '청소 용역의 대가'로 못박고 두 징수 방식을 함께 적는다(회계 패널 2026-08-02).
    // 애매하면 수익 인식 시점과 부가세 과세 여부 판정이 갈린다.
    청소비조항: `[청소비] 청소비 ${won}은 퇴실 후 실내 청소 용역의 대가입니다. 보증금이 있는 경우 퇴실 정산 시 보증금에서 공제하고, 보증금이 없는 경우 입실 시 이용료와 함께 받습니다.`,
    청소비공제: ` (보증금 내 청소비 ${won} 별도 공제)`,
  }
}

// ── 서명 시점 본문 격리 ──────────────────────────────────────────────
//
// 영업장 공통 계약서 본문을 고치면 **서명이 끝난 계약서 내용이 소급해서 바뀌었다.**
// 실측(2026-08-04) — 원격 서명 5건 전부가 서명 당시와 본문이 달랐다. 2026-08-03 청소비 조항
// 변수화가 원인이고, 서명 당시 없던 조항이 한 줄 늘어 있었다. 운영자 오더는 "절대로 바뀌면 안 된다" 다.
//
// 그래서 서명이 서버에 기록되는 그 트랜잭션에서 그때의 본문을 lease 에 박제하고, 이후 발급은
// 그 박제본만 읽는다. 이 함수가 '무엇을 읽을지'를 정하는 **유일한 자리**다.
// 화면·발급 API·감지망 셋이 같이 쓴다 — 규칙을 복제하면 그물과 코드가 따로 논다.

export type SignedContractSnapshot = {
  origin: 'REMOTE_LINK' | 'IN_PERSON' | 'SCAN' | 'LEGACY_PDF'
  capturedAt: string
  // 앱이 만든 본문을 서명받은 경우에만 있다
  template?: ContractTemplate
  refundClauseInContract?: boolean
  disposalConsent?: unknown
  businessInfo?: BusinessInfo
  /**
   * 서명 당시 종이에 붙어 있던 추가 호실 특약. 이 칸이 생기기 전 박제에는 아예 없고(undefined),
   * 그때는 null 로 읽는다 — **이미 서명이 끝난 계약서에 특약을 소급해 끼워 넣지 않는다.**
   * 종이에 없던 절이 재발급에서 튀어나오면 그건 서명 시점 본문 격리를 스스로 깨는 것이다.
   */
  subLeaseAddendum?: SubLeaseAddendum | null
  // 서명 원본이 앱 밖에 있는 경우 그 증거 파일
  sourceContractFileId?: string
}

export type ResolvedBody = {
  source: 'SNAPSHOT' | 'ARCHIVED' | 'LIVE'
  template: ContractTemplate
  refundClauseInContract: boolean
  disposalConsent: unknown
  businessInfo: BusinessInfo | null
  /**
   * 박제본이 들고 있던 추가 호실 특약. **박제본(SNAPSHOT)일 때만 의미가 있다.**
   * 서명 전 계약(LIVE)·앱 밖 원본(ARCHIVED)은 null 이고, 지금 조건으로 붙일지 판정하는 것은
   * lib/contractData 의 contractSubLeaseAddendum 이 한다(딸린 계약과 방 설정을 봐야 하기 때문).
   */
  subLeaseAddendum: SubLeaseAddendum | null
  /** 앱이 서명 시점 본문을 모르는 계약. 새 발급본을 만들면 안 된다. */
  blockIssue: boolean
}

export function resolveSignedBody(
  lease: { signedContractSnapshot?: unknown; contractOverride?: unknown } | null,
  property: {
    contractTemplate?: unknown
    refundClauseInContract?: boolean | null
    disposalConsentTemplate?: unknown
    businessInfo?: unknown
  } | null,
): ResolvedBody {
  const live = {
    template: (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE,
    refundClauseInContract: property?.refundClauseInContract ?? true,
    disposalConsent: property?.disposalConsentTemplate ?? null,
    businessInfo: (property?.businessInfo as BusinessInfo | null) ?? null,
  }
  const snap = lease?.signedContractSnapshot as SignedContractSnapshot | null | undefined

  // 본문이 담긴 박제본 — 서명 당시 그대로 낸다. 공통 템플릿이 바뀌어도 여기는 안 움직인다.
  if (snap?.template) {
    return {
      source: 'SNAPSHOT',
      template: snap.template,
      refundClauseInContract: snap.refundClauseInContract ?? live.refundClauseInContract,
      disposalConsent: snap.disposalConsent ?? live.disposalConsent,
      businessInfo: snap.businessInfo ?? live.businessInfo,
      subLeaseAddendum: snap.subLeaseAddendum ?? null,
      blockIssue: false,
    }
  }
  // 본문 없는 박제본(종이 스캔·과거 발급본) — 앱은 그 본문을 모른다.
  // 미리보기는 현재값으로 그리되 **새 발급본은 만들지 않는다.** 그 계약의 원본은 앱 밖에 있다.
  if (snap) return { source: 'ARCHIVED', ...live, subLeaseAddendum: null, blockIssue: true }

  // 박제본이 없으면 지금까지와 완전히 같다 — 개별 수정본 우선, 없으면 공통 템플릿.
  return {
    source: 'LIVE',
    ...live,
    template: (lease?.contractOverride as ContractTemplate | null) ?? live.template,
    subLeaseAddendum: null,
    blockIssue: false,
  }
}
