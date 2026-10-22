// 사유 목록(입실 취소·퇴실·보증금 미반환, 2차 여섯 lib/optionLists REASON_LIST_FIELDS)의 '기타' 저장 규약 정본. 고르는 칸·수정 화면·서버 저장 검증이 이 한 벌을 쓴다.
//
// 규약(2026-10-22 운영자 승인).
//   · '기타' 는 목록 항목이 아니다. 고르는 칸 맨 끝에 늘 붙는다(CategorySelect addMode).
//   · '기타' 를 골라 글을 적으면 '기타 · 글' 로 남는다. 글이 없으면 '기타'.
//   · '이 사유를 목록에 추가' 를 체크하면 그 글이 영업장 목록에 들어가고 기록은 맨 글자('글')로 남는다.
//   · 서버는 화면을 믿지 않는다. 목록(과 코드가 쓰는 보호 이름)에 없는 맨 글자는 '기타 · 글' 로 바꿔 남긴다.
//     단 고치는 기록의 지금 값과 같으면(목록에서 뺀 항목·옛 이름 그대로 저장) 그대로 둔다.
//   · 이미 쌓인 '기타 · 공실 없음' 류 기록은 손대지 않는다(운영자 결정 4).
//
// 종전에는 build/parse 가 lib/statusReasons(buildReason·parseReason)와 lib/depositWithholdReasons(buildWithholdReason)에
// 두 벌 있었다. 목록이 영업장 설정으로 가면서 한 벌로 모았다.
import { normalizeOptionName, PROTECTED_OPTION_NAMES, FIXED_OPTION_VALUES, LEGACY_FIXED_VALUES, reservedOptionNameError, type ReasonListField } from '@/lib/optionLists'

export const OTHER_REASON = '기타'
export const OTHER_REASON_PREFIX = '기타 · '

/** 저장 글자가 '기타' 직접 입력이면 그 글(빈 글이면 ''), 아니면 null. */
export function otherReasonText(stored: string | null | undefined): string | null {
  const v = stored ?? ''
  if (v.trim() === OTHER_REASON) return ''
  if (v.startsWith(OTHER_REASON_PREFIX)) return v.slice(OTHER_REASON_PREFIX.length)
  return null
}

/** 직접 입력 칸의 글을 저장 글자로. 글이 비면 '기타'. 고르는 칸이 글자 그대로 되읽도록 다듬지 않는다(다듬기는 서버). */
export function otherReason(text: string): string {
  return text === '' ? OTHER_REASON : OTHER_REASON_PREFIX + text
}

/**
 * 저장 글자를 고르는 칸의 상태로 읽는다. 수정 화면이 저장값을 다시 칸으로 되돌리는 정본이다.
 *   empty  · 기록 없음
 *   option · 지금 목록에 있는 항목
 *   other  · '기타' 또는 '기타 · 글'(text 는 글)
 *   legacy · 목록에서 뺀 항목·옛 이름처럼 둘 다 아닌 글자. 칸은 그 글자를 그대로 보여 주고, 손대지 않으면 그대로 저장된다.
 */
export type ReasonPick =
  | { kind: 'empty' }
  | { kind: 'option'; value: string }
  | { kind: 'other'; text: string }
  | { kind: 'legacy'; value: string }
export function reasonPickOf(stored: string | null | undefined, options: readonly string[]): ReasonPick {
  const v = stored ?? ''
  if (v.trim() === '') return { kind: 'empty' }
  const text = otherReasonText(v)
  if (text !== null) return { kind: 'other', text }
  if (options.includes(v)) return { kind: 'option', value: v }
  return { kind: 'legacy', value: v }
}

/**
 * 서버 저장 검증. raw 는 화면이 보낸 저장 글자, list 는 지금 영업장 목록이다.
 * reason 은 실제로 남길 글자(null = 기록 안 함), add 는 저장이 끝난 뒤 목록 끝에 더할 이름(null = 안 더함)이다.
 *
 *   · 고치는 기록의 지금 값(prev)과 같으면 그대로. 목록에서 뺀 항목·옛 이름을 그대로 저장해도 '기타 · ' 가 붙지 않는다.
 *   · 목록이나 보호 이름(청소비·인수 승계 보증금)에 있는 맨 글자는 그대로. 보호 이름은 목록에서 빼도 코드가 미리 고른다.
 *   · '기타' 직접 입력의 글이 목록 이름과 같으면 그 항목으로 남긴다(같은 사유가 두 꼴로 갈리지 않게).
 *   · addToList 면 글을 목록 이름 정규화로 다듬어 맨 글자로 남기고 목록에 더한다. 목록에 넣을 수 없는 이름
 *     ('기타'·'기타 · …'·시스템 라벨)은 더하지 않고 '기타 · 글' 로 남긴다.
 *   · 그 밖의 글은 '기타 · 글'. 화면이 맨 글자를 보내도(옛 화면·위조) 목록 밖 글자가 목록 항목인 척 남지 않는다.
 *   · 앱 고정 값(청소 사유 코드 셋, 옛 코드 'OTHER')은 맨 값 그대로 받는다. 직접 입력 글과는 견주지 않는다
 *     (글에 'CHECKOUT' 을 적어도 퇴실 청소가 되지 않는다, 2026-10-22 2차).
 */
export function planReasonSave(
  field: ReasonListField,
  list: readonly string[],
  raw: string | null | undefined,
  opts: { addToList?: boolean; prev?: string | null } = {},
): { reason: string | null; add: string | null } {
  const v = (raw ?? '').trim()
  if (!v) return { reason: null, add: null }
  if (opts.prev != null && v === opts.prev.trim()) return { reason: v, add: null }
  const known = [...list, ...(PROTECTED_OPTION_NAMES[field]?.names ?? [])]
  const fixed = [...(FIXED_OPTION_VALUES[field] ?? []), ...(LEGACY_FIXED_VALUES[field] ?? [])]
  // 앞 공백만 걷고 본다. 다 걷으면 '기타 · ' 가 '기타 ·' 가 돼 직접 입력으로 안 읽힌다.
  const other = otherReasonText((raw ?? '').trimStart())
  if (other === null && (known.includes(v) || fixed.includes(v))) return { reason: v, add: null }
  const text = (other ?? v).trim()
  if (!text) return { reason: OTHER_REASON, add: null }
  const name = normalizeOptionName(field, text)
  if (name && known.includes(name)) return { reason: name, add: null }
  if (opts.addToList && name && !reservedOptionNameError(field, name)) return { reason: name, add: name }
  return { reason: OTHER_REASON_PREFIX + text, add: null }
}
