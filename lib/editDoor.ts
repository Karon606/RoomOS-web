// 상세 셸 [수정] 이 페이지 편집 폼을 여는 문 — 같은 페이지면 등록된 opener 를 바로 부르고, 다른 페이지면 클릭마다 다른 edit 값으로 push 한다.
//
// 왜 이렇게 바꿨나(신고 352716da, 2026-11-02). 종전 문은 같은 페이지 안에서도 '/tenants?tenantId=X&edit=1'
// 로 내비게이션했고, 목적지 훅은 'tenantId 가 지난번과 같으면 건너뛴다'(handledEditRef)로 한 번만 열었다.
// 저장 없이 닫은 뒤 URL 정리를 훅이 못 보면 ref 가 남아, 다음 [수정]은 같은 URL·같은 키라 건너뛰고
// 1.5초 상한 타이머가 상세 창만 닫았다. 운영자 눈에는 [수정]을 누르면 창이 튕겨 나가는 것으로 보였다.
//
// 처방 두 갈래.
//  1) 같은 페이지 — 내비게이션을 하지 않는다. 그 페이지가 등록한 opener 를 부르면 폼이 서고, 페이지가
//     상세 창을 닫는다(종 알림의 openEntityModal 과 같은 모듈 pub/sub 문법).
//  2) 다른 페이지 — push 하되 edit 값을 클릭마다 다르게(nonce) 싣고, 목적지 훅은 'id:nonce' 를 키로 본다.
//     그러면 정리 신호를 놓쳐도 다음 클릭은 늘 새 요청이다.

export type EditDoorKind = 'tenant' | 'room'

type Opener = (id: string) => boolean
const openers: Partial<Record<EditDoorKind, Opener>> = {}

/** 편집 폼이 있는 페이지가 마운트 동안 opener 를 건다. 돌려준 함수로 푼다(다른 opener 가 덮었으면 건드리지 않는다). */
export function registerEditOpener(kind: EditDoorKind, fn: Opener): () => void {
  openers[kind] = fn
  return () => { if (openers[kind] === fn) delete openers[kind] }
}

/** 지금 화면에 그 편집 폼이 있으면 바로 연다. 열었으면 true, 페이지가 없거나 대상을 못 찾으면 false(호출부가 push 로 폴백). */
export function openEditInPlace(kind: EditDoorKind, id: string): boolean {
  const fn = openers[kind]
  return fn ? fn(id) : false
}

let seq = 0
/** 클릭마다 다른 edit 값. 같은 대상을 연달아 눌러도 URL 과 목적지 키가 매번 달라진다. */
export function editNonce(): string {
  seq = (seq + 1) % 1_000_000
  return `${Date.now().toString(36)}${seq.toString(36)}`
}

const EDIT_PATH: Record<EditDoorKind, (id: string, nonce: string) => string> = {
  tenant: (id, n) => `/tenants?tenantId=${encodeURIComponent(id)}&edit=${n}`,
  room: (id, n) => `/room-manage?roomId=${encodeURIComponent(id)}&edit=${n}`,
}

/** 다른 페이지에서 편집 폼으로 가는 주소 — edit 값은 늘 새 nonce 다. */
export function editHref(kind: EditDoorKind, id: string): string {
  return EDIT_PATH[kind](id, editNonce())
}

export type EditDecision = {
  /** 훅이 다음 판정에 들고 갈 키. 못 찾은 경우에는 이전 키를 그대로 둔다(목록이 도착하면 다시 판정). */
  key: string | null
  open: boolean
  reason: 'no-param' | 'same-request' | 'not-found' | 'open'
}

/**
 * 목적지 훅의 판정 — 순수 함수(진리표 scripts/test-edit-door.ts).
 * 키는 'id:edit' 다. edit 이 nonce 이므로 같은 대상을 다시 눌러도 키가 달라 다시 연다.
 * 같은 키는 한 요청이 effect 재실행(저장 뒤 refresh, 검색어 변경)으로 다시 들어온 것이라 건너뛴다.
 */
export function shouldOpenEdit(
  prevKey: string | null,
  params: { id: string | null; edit: string | null },
  exists: boolean,
): EditDecision {
  if (!params.id || !params.edit) return { key: null, open: false, reason: 'no-param' }
  const key = `${params.id}:${params.edit}`
  if (key === prevKey) return { key: prevKey, open: false, reason: 'same-request' }
  if (!exists) return { key: prevKey, open: false, reason: 'not-found' }
  return { key, open: true, reason: 'open' }
}
