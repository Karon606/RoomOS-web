// 실거주 확인서 좌표맵 — 출력 PDF overlay 와 편집 화면이 공유하는 단일 소스. (서식 원본은 서울형이나 항목 구성이 표준적이라 공용, 제출처는 주소 기반 유추 + 편집 가능)
// 좌표는 원본(public/forms/residence-cert-seoul.pdf, A4 595.3×841.9pt, 원점 좌하단)에서
// 라벨 baseline 을 추출해 매핑. 양식이 바뀌면 이 파일만 갱신.

export const RC_PAGE = { w: 595.3, h: 841.9 }

export type RcAlign = 'left' | 'center' | 'right'

export type RcTextField = {
  key: string        // 채울 값의 필드 키
  x: number          // align=left: 좌측 시작 / center: 중심 / right: 우측 끝 (pt)
  y: number          // baseline (pt, 원점 좌하단)
  size: number       // pt
  align?: RcAlign    // 기본 left
  width: number      // 편집 입력칸 폭(pt) = overlay 자동축소 최대폭
  cover?: { x: number; y: number; w: number; h: number }  // 글자 전 흰 박스(인쇄된 빈칸 덮기)
}

// 단순 텍스트 칸
export const RC_TEXT_FIELDS: RcTextField[] = [
  { key: 'siteAddress',          x: 140, y: 700.4, size: 11, width: 240 },
  { key: 'areaM2',               x: 448, y: 700.4, size: 11, align: 'center', width: 46 },
  { key: 'tenantName',           x: 252, y: 671.6, size: 11, width: 285 },
  { key: 'tenantAddress',        x: 252, y: 643.8, size: 11, width: 285 },
  { key: 'tenantBirth',          x: 252, y: 615.8, size: 11, width: 200 },
  { key: 'tenantPhone',          x: 252, y: 588.0, size: 11, width: 200 },
  { key: 'periodText',           x: 147, y: 556.3, size: 10.5, width: 184, cover: { x: 143, y: 550, w: 188, h: 16 } },
  { key: 'rentText',             x: 241, y: 520.8, size: 11, align: 'right', width: 85 },
  { key: 'depositText',          x: 366, y: 520.8, size: 11, align: 'right', width: 85 },
  { key: 'landlordBusinessName', x: 180, y: 349.0, size: 11, width: 350 },
  { key: 'landlordName',         x: 180, y: 322.2, size: 11, width: 120 },
  { key: 'landlordAddress',      x: 180, y: 295.2, size: 11, width: 350 },
  { key: 'landlordIdNo',         x: 180, y: 271.6, size: 11, width: 200 }, // 생년월일 또는 사업자등록번호
  { key: 'landlordPhone',        x: 180, y: 228.9, size: 11, width: 200 },
]

// 작성일 — 인쇄된 '20 [  ]년 [  ]월 [  ]일' 의 빈칸 (중심 좌표)
export const RC_ISSUE_GAPS = [
  { part: 'yy' as const, cx: 258.8, y: 420.3, size: 11 },
  { part: 'mm' as const, cx: 292.8, y: 420.3, size: 11 },
  { part: 'dd' as const, cx: 337.0, y: 420.3, size: 11 },
]

// 도장 — 인쇄된 '(인)' 을 덮고 그 자리에 합성
export const RC_STAMP = { cx: 319, cy: 326, size: 46, cover: { x: 308, y: 318, w: 22, h: 16 } }
