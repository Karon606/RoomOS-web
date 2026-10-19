// 계약서의 반려동물 금지 항목을 알아보는 낱말 표. 그물(check-contract-unfair-clause)과 정정 스크립트(fix-contract-pet-clause)가 이 한 벌을 쓴다.
//
// 왜 한 벌인가(독립 검수 2026-10-19). 정정 스크립트의 '같은 취지 항목' 감지어와 그물의 반려동물 낱말이
// 따로 있으면 한쪽만 늘어 갈린다. 그러면 그물이 위반으로 잡는 항목을 스크립트가 못 알아보고, 같은 취지의
// 항목을 하나 더 붙인다.
//
// 공백을 걷고 대조한다. '반려 동물'·'애완 동물' 같은 띄어쓰기 변형을 같은 낱말로 본다.
// '개' 단독은 넣지 않는다. '개인'·'개별'·'1개월'이 다 걸린다.
export const PET_WORDS = ['반려동물', '애완동물', '반려견', '반려묘', '애완견', '강아지', '고양이'] as const

/** 공백을 걷은 문자열. 낱말 대조는 이 모양으로 한다. */
export function squash(s: string): string {
  return s.replace(/\s+/g, '')
}

/** 그 글에 반려동물 낱말이 있는가(띄어쓰기 무시). */
export function hasPetWord(text: string): boolean {
  const t = squash(text)
  return PET_WORDS.some(w => t.includes(w))
}
