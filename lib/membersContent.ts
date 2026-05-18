// 공개 공실 안내 페이지 콘텐츠 — /members/[slug]
// ─────────────────────────────────────────────────────────────
// 1단계: 이 파일에 직접 입력해 페이지를 채운다.
// 2단계(추후): 앱 환경설정의 "웹페이지 관리" 편집기로 대체 예정.
//
// 사진 경로는 public/ 기준 절대경로. 예) public/members/thestayjegi/room-1.jpg
//   → photos: ['/members/thestayjegi/room-1.jpg']
// 값을 비워두면(빈 배열·빈 문자열) 페이지가 "준비 중" 상태로 자연스럽게 표시된다.

export type ListingRoom = {
  /** 방 이름·호실 — 예: "201호", "미니룸 A" */
  name: string
  /** 방 타입 — 예: "원룸형", "미니룸", "복층" */
  type: string
  /** 월세 (원) */
  monthlyRent: number
  /** 보증금 (원) */
  deposit: number
  /** 창문 유무 */
  hasWindow: boolean
  /** 층 — 예: "2층" (선택) */
  floor?: string
  /** 한 줄 설명 (선택) */
  description?: string
  /** 입주 가능 여부 */
  available: boolean
  /** 사진 경로 목록 (public/ 기준) */
  photos: string[]
}

export type ListingContent = {
  /** 영업장 이름 */
  propertyName: string
  /** 짧은 한 줄 소개 */
  tagline: string
  /** 소개 문단 */
  intro: string
  /** 주소 — 비우면 위치 섹션 숨김 */
  address: string
  /** 대표 전화 — 비우면 전화 버튼 숨김 */
  phone: string
  /** 카카오톡 채널/오픈채팅 URL (선택) */
  kakaoUrl?: string
  /** 위치 한 줄 — 예: "서울 1호선 제기동역 인근" (선택) */
  locationNote?: string
  /** 상단 대표 사진 경로 목록 */
  heroPhotos: string[]
  /** 편의시설·특징 목록 */
  amenities: string[]
  /** 방 목록 */
  rooms: ListingRoom[]
}

export const MEMBERS_CONTENT: Record<string, ListingContent> = {
  // ── 더스테이원룸텔 제기역점 ──────────────────────────────────
  thestayjegi: {
    propertyName: '더스테이원룸텔 제기역점',
    tagline: '1인 주거 원룸텔 · 제기동역 인근',
    intro:
      '깔끔하게 관리되는 1인 주거 공간입니다. 각 방에 개인 화장실과 냉난방이 갖춰져 있어 바로 입주하실 수 있습니다. 자세한 공실·가격은 전화로 문의해 주세요.',
    address: '', // 입력 필요 — 비우면 위치 섹션 숨김
    phone: '', // 입력 필요 — 비우면 전화 버튼 숨김
    kakaoUrl: '', // 선택
    locationNote: '서울 지하철 1호선 제기동역 인근',
    heroPhotos: [], // 입력 필요 — public/members/thestayjegi/ 에 사진 추가 후 경로 입력
    amenities: [
      '개인 화장실·샤워실',
      '냉난방 완비',
      '무선 인터넷',
      '냉장고·옷장',
      '공용 세탁실',
      '24시간 자유 출입',
    ],
    rooms: [], // 입력 필요 — 아래 형식으로 방 추가
    // 예시:
    // rooms: [
    //   {
    //     name: '201호', type: '원룸형', monthlyRent: 400000, deposit: 100000,
    //     hasWindow: true, floor: '2층', description: '창측 채광 좋은 방',
    //     available: true, photos: ['/members/thestayjegi/room-201-1.jpg'],
    //   },
    // ],
  },
}
