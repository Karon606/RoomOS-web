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
        '- 퇴실 시 입실료 환불은 관계 법령 및 공정거래위원회 기준에 따릅니다.{{환불규정}}',
        '- 퇴실 7일 전 본 사업자에게 알려주어야 합니다. 퇴실의사 전달 시 1개월 자동연장 됩니다. (구두 불가, 문자로)',
        '- 퇴실 후 실내 청소 상태와 입실 시 상태 동일해야 합니다.',
        '- 퇴실 시 보증금 중 청소비 2만원 공제하며, 집기파손, 기물파손, 오물 시 책임 소재가 분명한 경우 차후 3만원이 더 청구됩니다.',
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

// 계약서 환불 조항({{환불규정}}) — 공정거래위원회 기준 고정 문구.
// 위약금율(10%)·기간 조건은 법적으로 임의 설정이 불가하므로 환경설정에서 제거하고 문구로 고정한다.
export function buildRefundClause(): string {
  return '중도 퇴실 시 환불액은 「총 결제금액 − (1일 이용요금 × 실제 이용일수) − 위약금(총 결제금액의 10%)」으로 산정하며, 1일 이용요금은 월 이용료의 30분의 1로 합니다.'
}

// 조항 섹션을 2단(좌/우)으로 분배 — ⚠️ 문서 순서 보존이 절대 원칙(계약서 조항 순서를 바꾸면 안 됨).
// 앞에서부터 '순서대로' 채우되, 누적 높이가 절반에 가장 가까워지는 한 지점에서만 좌→우로 나눈다.
// → 왼쪽 단을 위에서 아래로, 그다음 오른쪽 단을 위에서 아래로 읽으면 원래 순서(1,2,3,4…) 그대로.
// CSS 멀티컬럼(column-count)은 Chrome 인쇄(고정 페이지)에서 1단으로 흐르므로 명시적 2단(flex)으로 렌더.
export function splitClauseColumns<T extends { items: string[] }>(sections: T[]): [T[], T[]] {
  if (sections.length <= 1) return [sections.slice(), []]
  const w = sections.map(s => (s.items?.length ?? 0) + 1.5)   // 헤더 가중치 포함
  const total = w.reduce((a, b) => a + b, 0)
  let bestK = 1
  let bestDiff = Infinity
  let acc = 0
  for (let k = 1; k < sections.length; k++) {
    acc += w[k - 1]
    const diff = Math.abs(acc - (total - acc))
    if (diff < bestDiff) { bestDiff = diff; bestK = k }
  }
  return [sections.slice(0, bestK), sections.slice(bestK)]
}

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
