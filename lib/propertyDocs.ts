// 영업장 서류(사업자등록증·통장사본 국문·영문) 종류 지도 — 칼럼·Drive 접두·이름·읽기 스코프의 단일 원천.
//
// 왜 지도인가. 통장사본이 사업자등록증과 같은 축(Drive 파일 ID + Drive 판정 mime, 저장 형식 PDF)으로
// 들어오면서 같은 업로드·삭제·적용취소 로직이 종류 셋에 걸리게 됐다. 종류마다 함수를 베끼면 한 벌만
// 고쳐지는 날이 온다. 그래서 다른 것(칼럼 이름·파일 접두·화면 이름·스코프)만 여기 적고 본문은 하나로 둔다.
//
// 순수 모듈이다(서버 액션·라우트·클라이언트 화면이 함께 읽는다). Prisma·Drive 를 물지 않는다.
// lib/docBundle 도 가져오지 않는다 — 타입만 가져와도 라우트 의존 그래프를 훑는 감지망
// (check-print-selfcontained)이 그 너머의 폰트 소비자까지 /api/bank-book 에 엮는다.
// docType 이 DocBundleDocType 의 부분집합인지는 docFileLabel 호출부에서 타입이 다시 잰다.

export type PropertyDocKind = 'bizcert' | 'bankbook_ko' | 'bankbook_en'

export type PropertyDocSpec = {
  idCol: 'bizCertDriveFileId' | 'bankBookKoDriveFileId' | 'bankBookEnDriveFileId'
  mimeCol: 'bizCertMimeType' | 'bankBookKoMimeType' | 'bankBookEnMimeType'
  /**
   * Drive 파일명 접두 — `${prefix}_${propertyId}_${Date.now()}.${ext}`. 적용취소가 휴지통의 파일을
   * 되살리기 전에 이 접두 + 영업장 ID 로 우리 영업장의 그 종류 파일인지 대조한다.
   * 사업자등록증은 기존 저장분과 같은 'bizcert' 그대로다(바꾸면 옛 파일이 대조에서 떨어진다).
   */
  prefix: PropertyDocKind
  /** 파일 이름 정본(lib/docBundle docFileLabel)의 서류 종류. */
  docType: 'bizcert' | 'bankbook'
  /** 파일 이름 표기 — 영문 통장사본만 영문 이름으로 나간다. */
  lang: 'ko' | 'en'
  /** 화면·토스트·확인창 라벨의 단일 원천. */
  title: string
  /**
   * 읽기 스코프 — 'money' 면 금액 읽기가 막힌 역할(제한 스태프)에게 파일도 존재도 안 내려간다.
   * 통장사본은 예금주·계좌번호가 찍힌 서류라 입금 계좌(bankAccount)와 같은 축으로 끊는다.
   */
  scope: null | 'money'
}

export const PROPERTY_DOCS = {
  bizcert: {
    idCol: 'bizCertDriveFileId', mimeCol: 'bizCertMimeType', prefix: 'bizcert',
    docType: 'bizcert', lang: 'ko', title: '사업자등록증', scope: null,
  },
  bankbook_ko: {
    idCol: 'bankBookKoDriveFileId', mimeCol: 'bankBookKoMimeType', prefix: 'bankbook_ko',
    docType: 'bankbook', lang: 'ko', title: '국문 통장사본', scope: 'money',
  },
  bankbook_en: {
    idCol: 'bankBookEnDriveFileId', mimeCol: 'bankBookEnMimeType', prefix: 'bankbook_en',
    docType: 'bankbook', lang: 'en', title: '영문 통장사본', scope: 'money',
  },
} as const satisfies Record<PropertyDocKind, PropertyDocSpec>

export const PROPERTY_DOC_KINDS = Object.keys(PROPERTY_DOCS) as PropertyDocKind[]

/** 서버 액션 인자는 클라이언트가 보낸 값이다 — 지도 키인지 서버에서 다시 본다. */
export function isPropertyDocKind(v: unknown): v is PropertyDocKind {
  return typeof v === 'string' && (PROPERTY_DOC_KINDS as string[]).includes(v)
}

/** 등록된 서류 한 칸 — null 이면 미등록. mimeType 으로 화면이 이미지·PDF 를 가른다(빈 값 = 옛 저장분). */
export type PropertyDocSlotValue = { driveFileId: string; mimeType: string }

/** '을/를' — 확인창·토스트 문장이 라벨 받침을 따라간다. */
export function withObjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0
  return `${word}${hasFinal ? '을' : '를'}`
}

// ── 적용취소 스냅샷(Property.propertyDocPrev) ─────────────────────
//
// 교체·삭제 직전에 서버가 같은 update 로 쓴다. replacedBy 는 교체면 새 파일 ID, 삭제면 null 이다.
// 되살릴 때는 지금 칼럼이 비었거나(삭제 취소) replacedBy 와 같을 때(교체 취소)만 진행한다 — 그 사이에
// 또 바뀌었으면 스냅샷이 말하는 '직전'이 이미 아니다.
export type PropertyDocPrevEntry = {
  driveFileId: string
  mimeType: string | null
  replacedBy: string | null
  at: string
}
export type PropertyDocPrev = Partial<Record<PropertyDocKind, PropertyDocPrevEntry>>

/** 적용취소가 설 수 있는 기간 — Drive 휴지통이 스스로 비우는 30일. 그 뒤엔 되살릴 파일이 없다. */
export const PROPERTY_DOC_UNDO_MS = 30 * 24 * 60 * 60 * 1000

/** DB JSON 을 믿지 않는다 — 모양이 어긋난 항목은 버린다(없는 것과 같게). */
export function parsePropertyDocPrev(raw: unknown): PropertyDocPrev {
  const out: PropertyDocPrev = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const kind of PROPERTY_DOC_KINDS) {
    const e = (raw as Record<string, unknown>)[kind]
    if (!e || typeof e !== 'object') continue
    const { driveFileId, mimeType, replacedBy, at } = e as Record<string, unknown>
    if (typeof driveFileId !== 'string' || !driveFileId) continue
    out[kind] = {
      driveFileId,
      mimeType: typeof mimeType === 'string' ? mimeType : null,
      replacedBy: typeof replacedBy === 'string' && replacedBy ? replacedBy : null,
      at: typeof at === 'string' ? at : '',
    }
  }
  return out
}
