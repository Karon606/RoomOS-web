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

// 조항을 2단(좌/우)으로 분배 — ⚠️ 문서 순서 보존이 절대 원칙(계약서 조항 순서를 바꾸면 안 됨).
// 규칙(내용 무관·운영자가 바꿔도 동일 적용):
//  1) 항목을 '순서대로' 흘려 담는다. 왼쪽 단을 위→아래로, 그다음 오른쪽 단을 위→아래로 읽으면 원래 순서.
//  2) 누적 높이(글자수로 줄 수 추정)가 절반을 넘는 첫 항목에서 오른쪽 단으로 전환 → 좌/우 높이 균형(빈칸 최소).
//  3) 한 섹션이 두 단에 걸치면 오른쪽엔 헤더 없이 이어진다(멀티컬럼과 동일). 단, 헤더만 덜렁 남는 건 방지
//     (전환 직전 헤더에 항목이 하나도 안 들어갔으면 그 헤더를 오른쪽 단으로 옮긴다).
// CSS 멀티컬럼(column-count)은 Chrome 인쇄(고정 페이지)에서 1단으로 흐르므로 명시적 2단(flex)으로 렌더.
export type ClauseFragment = { title: string | null; items: string[] }
export function splitClauseColumns<T extends { title: string; items: string[] }>(sections: T[]): [ClauseFragment[], ClauseFragment[]] {
  const COL_CHARS = 28          // 한 단(≈87mm)의 한 줄 글자 수 추정(한글 8.7pt 기준)
  const HEADER_LINES = 1.6      // 섹션 헤더 1개의 높이(줄 환산)
  const estLines = (s: string) => Math.max(1, Math.ceil((s?.length ?? 0) / COL_CHARS))

  let total = 0
  for (const sec of sections) { total += HEADER_LINES; for (const it of sec.items) total += estLines(it) }
  const target = total / 2

  const left: ClauseFragment[] = []
  const right: ClauseFragment[] = []
  let acc = 0
  let switched = false
  for (const sec of sections) {
    let frag: ClauseFragment = { title: sec.title, items: [] }
    ;(switched ? right : left).push(frag)
    acc += HEADER_LINES
    for (const it of sec.items) {
      if (!switched && acc >= target) {
        switched = true
        if (frag.items.length === 0) {
          // 헤더만 들어간 채 전환 → 고아 헤더 방지: 그 헤더를 오른쪽 단으로 이동
          left.pop()
          frag = { title: frag.title, items: [] }
        } else {
          frag = { title: null, items: [] }   // 섹션이 이어짐(오른쪽엔 헤더 반복 안 함)
        }
        right.push(frag)
      }
      frag.items.push(it)
      acc += estLines(it)
    }
  }
  const clean = (arr: ClauseFragment[]) => arr.filter(f => f.title !== null || f.items.length > 0)
  return [clean(left), clean(right)]
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
