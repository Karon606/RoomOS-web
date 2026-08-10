// 외국인등록번호 순수 로직. 형식 검증, 하이픈 표기, 마스킹, 생년월일 파생을 한 곳에 둔다.
// 암복호와 저장 형식은 lib/pii 가 맡는다. 이 파일에는 키도 평문 저장도 없다.
//
// 체크섬은 보지 않는다. 2020.10 부터 발급되는 번호는 검증식이 없는 임의번호라, 체크섬을 걸면
// 실제 등록증을 든 입주자가 저장을 못 한다. 막아야 할 것은 오타가 아니라 잘못된 번호 종류다.

const DIGITS = 13

/** 주민등록번호를 이 칸에 넣으려 할 때의 거절 문구. 서버와 화면이 같은 문장을 쓴다. */
export const RESIDENT_REG_NO_REJECT = '주민등록번호는 저장할 수 없습니다.'

/** 입력에서 숫자만 추려 13자리로 자른다. */
export function foreignRegNoDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, DIGITS)
}

/** 타이핑 중 표시용 부분 포맷. 6자리를 넘어서면 하이픈을 끼운다. */
export function formatForeignRegNo(raw: string | null | undefined): string {
  const d = foreignRegNoDigits(raw)
  return d.length <= 6 ? d : `${d.slice(0, 6)}-${d.slice(6)}`
}

/**
 * 뒤 7자리의 첫 숫자로 생년월일을 파생한다.
 *   5, 6 = 1900년대 출생 / 7, 8 = 2000년대 출생
 * 1~4 는 주민등록번호라 여기서 null 이다(거절 문구는 validate 가 붙인다).
 */
export function birthdateFromForeignRegNo(raw: string | null | undefined): string | null {
  const d = foreignRegNoDigits(raw)
  if (d.length !== DIGITS) return null
  const c = d[6]
  const century = c === '5' || c === '6' ? 1900 : c === '7' || c === '8' ? 2000 : null
  if (century === null) return null
  const mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${century + Number(d.slice(0, 2))}-${d.slice(2, 4)}-${d.slice(4, 6)}`
}

/** 화면에 남기는 표기. 뒤 7자리는 절대 보이지 않는다. 13자리가 아니면 빈 문자열이다. */
export function maskForeignRegNo(raw: string | null | undefined): string {
  const d = foreignRegNoDigits(raw)
  if (d.length !== DIGITS) return ''
  return `${d.slice(0, 6)}-*******`
}

export type ForeignRegNoCheck =
  | { ok: true; value: string; birthdate: string }
  | { ok: false; error: string }

/** 저장 전 검증. 통과하면 숫자 13자리와 파생 생년월일을 함께 돌려준다. */
export function validateForeignRegNo(raw: string | null | undefined): ForeignRegNoCheck {
  const d = foreignRegNoDigits(raw)
  if (d.length !== DIGITS) return { ok: false, error: '외국인등록번호는 숫자 13자리입니다.' }
  const c = d[6]
  if (c >= '1' && c <= '4') return { ok: false, error: RESIDENT_REG_NO_REJECT }
  if (c < '5' || c > '8') {
    return { ok: false, error: '외국인등록번호 형식이 올바르지 않습니다. 뒤 7자리는 5, 6, 7, 8 중 하나로 시작합니다.' }
  }
  const birthdate = birthdateFromForeignRegNo(d)
  if (!birthdate) return { ok: false, error: '외국인등록번호 앞 6자리의 생년월일이 올바르지 않습니다.' }
  return { ok: true, value: d, birthdate }
}
