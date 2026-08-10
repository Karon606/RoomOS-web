// 발급 서류에 찍을 성명 정본 — 한글 이름과 영문 이름 중 무엇을 인쇄할지 한 곳에서 정한다.
//
// 고객 정보에 `Tenant.englishName` 칸이 있는데 어떤 서류도 읽지 않았다. 502호에서 출입국 제출용
// 영문 계약서가 필요해지자 운영자가 `Tenant.name` 자체를 영문으로 갈아엎었고, 그 순간 앱 전체에서
// 한글 이름이 사라졌다(2026-08-11). 서류가 표기를 고를 수 있으면 원천을 갈아엎을 이유가 없다.
//
// **저장하는 것은 이름이 아니라 선택이다.** 이름 문자열을 서류 칸에 복사해 두면 고객 정보에서
// 철자를 고쳐도 서류만 옛 값에 붙박인다(표시값 오버라이드가 늘 안고 있는 위험). 'ko' | 'en' 한
// 글자만 남기면 인쇄값은 언제나 지금의 고객 정보에서 다시 조립된다.
//
// 세 서류(계약서·실거주 확인서·납부확인서·보증금영수증)가 이 파일 하나를 쓴다. 표기 규칙을
// 서류마다 두면 같은 사람이 서류마다 다른 이름으로 나간다.

/** 표기 선택지. 저장·전송되는 값이라 짧은 코드로 두고, 사람 말은 아래 라벨이 맡는다. */
export const DOC_NAME_STYLES = ['ko', 'en'] as const
export type DocNameStyle = (typeof DOC_NAME_STYLES)[number]

/** 고르지 않았을 때의 표기. 기존 입주자 전원이 이 값이라 화면·종이가 1비트도 안 바뀐다. */
export const DEFAULT_DOC_NAME_STYLE: DocNameStyle = 'ko'

/** 화면 라벨. 세 서류가 같은 낱말을 써야 같은 기능으로 읽힌다. */
export const DOC_NAME_STYLE_LABEL: Record<DocNameStyle, string> = { ko: '한글', en: '영문' }

/** 성명 조립에 필요한 최소 모양 — 고객 정보의 두 칸. */
export type DocumentNameSource = {
  name: string
  englishName?: string | null
}

/** 저장된 값·폼 값에서 표기를 읽는다. 알 수 없는 값은 undefined 로 버린다(화이트리스트). */
export function asDocNameStyle(v: unknown): DocNameStyle | undefined {
  return v === 'ko' || v === 'en' ? v : undefined
}

/**
 * 영문 이름이 등록돼 있는가. **선택 UI 를 그릴지 말지의 유일한 기준이다.**
 * 영문 이름이 없는 입주자(실측 103명 중 85명)의 화면은 이 기능이 들어오기 전과 완전히 같아야 한다.
 */
export function hasEnglishName(src: DocumentNameSource): boolean {
  return !!src.englishName?.trim()
}

/**
 * 서류에 찍을 성명.
 * 영문을 골랐는데 영문 이름이 비어 있으면 한글로 되돌린다 — 성명 칸이 빈 서류가 관청에 나가는 것이
 * 표기가 틀린 서류보다 나쁘다. 고객 정보에서 영문 이름을 지운 뒤 옛 선택이 남아 있는 경우가 그것이다.
 */
export function documentName(src: DocumentNameSource, style: DocNameStyle | null | undefined): string {
  if (style === 'en') {
    const en = src.englishName?.trim()
    if (en) return en
  }
  return src.name
}
