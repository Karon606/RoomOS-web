// 카드·타일에 부를 이름 정본 — 한글 이름·별칭·영문 이름 중 무엇을 보여줄지 한 곳에서 정한다.
//
// 홈 방 현황 타일은 한 칸 글자 폭이 70px 남짓이라 긴 이름이 온전히 들어가지 않는다. 종전엔
// 이름을 공백으로 쪼개 두 번째 토큰만 세웠는데, 그 규칙은 '성 이름' 두 토큰짜리 한국식 표기를
// 가정한 것이라 다중 토큰 이름에서 무너졌다 — 502호 '응우옌 티 타오 아인'이 타일에서 '티'가 됐다
// (Thị 는 베트남 여성 이름의 중간 표지라 사람을 하나도 특정하지 못한다). 운영자 신고 2026-08-11.
//
// 추측으로 줄이는 대신 **부르는 이름을 적을 칸**을 만든다. 별칭('안아', 'Maruf')은 운영자가
// 실제로 그 사람을 부르는 말이고, 줄임말이 필요한 이유의 정답이다. 자동 축약 규칙은 폐기하고
// 길면 CSS 말줄임에 맡긴다 — 앞머리부터 잘린 이름이 엉뚱한 중간 토큰보다 늘 더 많이 알려 준다.
//
// **저장하는 것은 이름이 아니라 선택이다**(lib/documentName 과 같은 설계). 이름 문자열을 복사해
// 두면 고객 정보에서 철자를 고쳐도 카드만 옛 값에 붙박인다. 'nickname' | 'en' 한 낱말만 남기면
// 표시값은 언제나 지금의 고객 정보에서 다시 조립된다.
//
// **서류는 이 축을 읽지 않는다.** 계약서·실거주 확인서·납부확인서·보증금영수증의 성명 표기는
// lib/documentName 이 정본이고 별개 축이다(관청에 별칭이 나가면 그 서류는 틀린 서류다).
// 이 파일의 소비처는 화면 카드뿐이다.

/** 표시 선택지. 저장·전송되는 값이라 짧은 코드로 두고, 사람 말은 아래 라벨이 맡는다. */
export const DISPLAY_NAME_STYLES = ['ko', 'nickname', 'en'] as const
export type DisplayNameStyle = (typeof DISPLAY_NAME_STYLES)[number]

/** 고르지 않았을 때의 표기. 기존 입주자 전원이 이 값이라 화면이 1비트도 안 바뀐다. */
export const DEFAULT_DISPLAY_NAME_STYLE: DisplayNameStyle = 'ko'

/** 화면 라벨. '영어이름'은 같은 폼의 입력 칸(TenantClient)이 쓰는 낱말 그대로다. */
export const DISPLAY_NAME_STYLE_LABEL: Record<DisplayNameStyle, string> = {
  ko: '한글 이름', nickname: '별칭', en: '영어이름',
}

/** 표시 이름 조립에 필요한 최소 모양 — 고객 정보의 세 칸. */
export type DisplayNameSource = {
  name: string
  englishName?: string | null
  nickname?: string | null
}

/**
 * 저장·폼 값에서 표기를 읽는다. 화이트리스트 밖(널·빈 문자열·모르는 값)은 전부 기본 'ko'.
 * DB 는 기본을 NULL 로 두므로(칸이 생기기 전과 같은 상태) 여기서 되살린다.
 */
export function asDisplayNameStyle(v: unknown): DisplayNameStyle {
  return v === 'nickname' || v === 'en' ? v : DEFAULT_DISPLAY_NAME_STYLE
}

/**
 * 저장값 — 기본(한글)은 NULL 로 남긴다. 'ko' 라는 글자를 굳이 적어 두면 "고른 적 없음"과
 * "한글을 골랐음"이 갈라지고, 두 상태를 구분해 봐야 화면은 똑같다.
 */
export function toStoredDisplayNameStyle(v: unknown): 'nickname' | 'en' | null {
  const s = asDisplayNameStyle(v)
  return s === 'ko' ? null : s
}

/**
 * 이 입주자에게 띄울 표기 선택지.
 *
 * **선택 UI 를 그릴지 말지의 유일한 기준이다.** 한글 이름밖에 없는 입주자는 길이 1 을 받아
 * 아무것도 안 그린다 — 고를 수 없는 칸을 띄우면 왜 안 되는지 설명할 자리가 또 필요해진다.
 */
export function displayNameStyles(src: DisplayNameSource): DisplayNameStyle[] {
  const out: DisplayNameStyle[] = ['ko']
  if (src.nickname?.trim()) out.push('nickname')
  if (src.englishName?.trim()) out.push('en')
  return out
}

/**
 * 카드에 그릴 이름.
 * 고른 표기의 원천이 비어 있으면 한글 이름으로 돌아온다 — 고객 정보에서 별칭·영문 이름을
 * 지운 뒤 옛 선택이 남아 있는 경우가 그것이다. 선택 자체는 지우지 않는다(원천을 다시 채우면
 * 되살아나야 한다).
 */
export function displayName(src: DisplayNameSource, style: unknown): string {
  const s = asDisplayNameStyle(style)
  if (s === 'nickname') {
    const nick = src.nickname?.trim()
    if (nick) return nick
  }
  if (s === 'en') {
    const en = src.englishName?.trim()
    if (en) return en
  }
  return src.name
}

/** 별칭 길이 상한 — 부르는 말이라 짧다. 넘치면 저장하지 않는다(잘린 이름은 틀린 이름이다). */
export const NICKNAME_MAX = 30

/**
 * 별칭 입력 정리 — 저장 직전 한 곳에서만 부른다. 공백을 하나로 줄이고, 남는 것이 없거나
 * 상한을 넘으면 null 이다.
 * 현지 표기 이름(sanitizeNativeName)처럼 보이지 않는 글자까지 훑지는 않는다 — 그쪽은 비로그인
 * 원격 서명 화면이 쓰는 칸이고, 별칭은 로그인한 운영자가 고객 정보에서만 적는 화면 전용 값이다.
 */
export function sanitizeNickname(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/\s+/g, ' ').trim()
  if (!cleaned || Array.from(cleaned).length > NICKNAME_MAX) return null
  return cleaned
}
