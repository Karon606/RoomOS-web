// 공개 공실 안내 페이지 콘텐츠 — /members/[slug]
// ─────────────────────────────────────────────────────────────
// 1단계: 이 파일에 직접 입력해 페이지를 채운다.
// 2단계(추후): 앱 환경설정의 "웹페이지 관리" 편집기로 대체 예정.
//
// 사진 경로는 public/ 기준 절대경로. 예) public/members/thestayjegi/IMG_8945.jpg
//   → '/members/thestayjegi/IMG_8945.jpg'

/** 객실 타입 — 개별 호실이 아닌 타입 단위 안내 */
export type RoomType = {
  /** 타입 이름 — 예: "원룸형", "미니룸형" */
  name: string
  /** 가격 표기 — 예: "월 35만원", "월 42~60만원" */
  priceLabel: string
  /** 보증금 표기 — 예: "보증금 5만원 (청소비 2만원 포함)" */
  depositLabel: string
  /** 설명 */
  description: string
}

/** 편의시설·혜택 항목 */
export type Amenity = {
  /** 이모지 아이콘 */
  icon: string
  title: string
  desc: string
}

export type ListingContent = {
  /** 영업장 이름 */
  propertyName: string
  /** 이름 보조 표기 — 예: "프리미엄 원룸텔" */
  brandLine?: string
  /** 히어로 상단 짧은 태그 — 예: "새로운 품격의 시작" */
  heroTag: string
  /** 히어로 부제 문장 */
  heroSubtitle: string
  /** 로고 이미지 경로 (선택) */
  logo?: string
  /** 대표 사진 경로 목록 */
  heroPhotos: string[]
  /** 강조 색 (hex) — 영업장별 브랜드 컬러 */
  accent: string
  /** 객실 타입 목록 */
  roomTypes: RoomType[]
  /** 편의시설·혜택 */
  amenities: Amenity[]
  /** 시설 소개 영상 — YouTube embed URL (선택) */
  videoEmbedUrl?: string
  /** 주소 */
  address: string
  /** 지도 embed URL — Google/Kakao 지도 (선택) */
  mapEmbedUrl?: string
  /** 찾아오는 길 단계 안내 */
  directions: string[]
  /** 대표 전화 — 비우면 전화 버튼 숨김 */
  phone: string
  /** 카카오톡 오픈채팅/채널 URL (선택) */
  kakaoUrl?: string
  /** 카카오톡 ID (선택) */
  kakaoId?: string
  /** 기타 안내 문구 (선택) */
  notes?: string[]
}

export const MEMBERS_CONTENT: Record<string, ListingContent> = {
  // ── 더스테이 제기역점 ───────────────────────────────────────
  thestayjegi: {
    propertyName: '더스테이 제기역점',
    brandLine: '프리미엄 원룸텔',
    heroTag: '새로운 품격의 시작',
    heroSubtitle:
      '제기동역 도보 2분, 완벽한 소방 시설과 철저한 위생 관리가 돋보이는 프리미엄 공간',
    logo: '/members/thestayjegi/IMG_8664.jpeg',
    heroPhotos: [
      '/members/thestayjegi/IMG_8945.jpg',
      '/members/thestayjegi/IMG_8909.jpg',
      '/members/thestayjegi/IMG_8959.jpg',
    ],
    accent: '#C5A059',
    roomTypes: [
      {
        name: '미니룸형',
        priceLabel: '월 35만원',
        depositLabel: '보증금 5만원 (청소비 2만원 포함)',
        description:
          '합리적인 가격으로 더스테이의 쾌적한 시설을 이용할 수 있는 가성비 객실입니다.',
      },
      {
        name: '원룸형',
        priceLabel: '월 42~60만원',
        depositLabel: '보증금 5만원 (청소비 2만원 포함)',
        description:
          '개별 화장실과 샤워실이 완비된 풀옵션 객실입니다. 넓은 수납공간으로 쾌적합니다.',
      },
    ],
    amenities: [
      {
        icon: '🧹',
        title: '철저한 위생 관리',
        desc: '외주 전문 청소업체를 이용하여 주 3회 꼼꼼하게 청소하며 최상의 위생 상태를 유지합니다.',
      },
      {
        icon: '🛡️',
        title: '신소방 완벽 안전시설',
        desc: '1.5m 넓은 복도, 전 구역 스프링클러, 난연소재 내벽 시공으로 화재 걱정이 없습니다.',
      },
      {
        icon: '🍚',
        title: '풍성한 편의 제공',
        desc: '국내산 쌀, 김치, 라면, 세제 등 비품을 상시 무료로 제공하여 생활비를 절감해 드립니다.',
      },
      {
        icon: '📹',
        title: '철통 보안 시스템',
        desc: '24시간 CCTV 녹화 및 전 객실 전자도어락 설치로 여성분들도 안심하고 생활 가능합니다.',
      },
      {
        icon: '📶',
        title: '무료 인터넷·TV',
        desc: '전 호실 끊김 없는 무료 기가 와이파이 및 개별 IPTV가 완벽하게 구비되어 있습니다.',
      },
      {
        icon: '📋',
        title: '맞춤 행정 지원',
        desc: '전입신고 완벽 지원은 물론, LH 및 주거급여(수급) 입주 상담도 도와드리고 있습니다.',
      },
    ],
    videoEmbedUrl: 'https://www.youtube.com/embed/yAyMLERUMMM?rel=0',
    address: '서울 동대문구 왕산로16길 9',
    mapEmbedUrl:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3162.045513827894!2d127.02979399298547!3d37.57754593548977!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x357cbcadaf7e5579%3A0x611c0197adc60cc8!2z7ISc7Jq47Yq567OE7IucIOuPmeuMgOusuOq1rCDsmZXsgrDroZwxNuq4uCA5!5e0!3m2!1sko!2skr!4v1776387675513!5m2!1sko!2skr',
    directions: [
      '제기동역 6번 출구에서 150m 직진 (도보 1분)',
      "'iclass부동산'과 '템포커피' 사이 골목으로 좌회전",
      "'임오네쭈꾸미' 건물 4, 5층 도착",
    ],
    phone: '010-9218-7935',
    kakaoUrl: 'https://open.kakao.com/o/s9QRRKqi',
    kakaoId: 'TheStayJegi',
    notes: ['English inquiries welcome'],
  },
}
