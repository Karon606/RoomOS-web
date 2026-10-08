'use server'

// 호실 프리즘의 메모 인라인 편집과 도어락 마스터키(소유자 전용) 서버 액션 (2026-10-08, 운영자 승인).
//
// 마스터키는 호실 정보 가운데 유일하게 평문으로 담지 않는 값이다. 저장은 lib/pii 의 AES-256-GCM
// 암호문(AAD = 방 id)이고, 평문이 나오는 길은 아래 revealRoomMasterKey 하나뿐이다. 그 길은 값을
// 돌려주기 전에 열람 기록(room_master_key_views)을 남긴다.
//
// 권한은 화면 가드(useCanReadScope)가 아니라 여기서 끊는다. 서버 액션은 requireRouteAccess 가 못
// 막는 자리라 액션마다 역할을 직접 묻는다. 'security' 스코프는 소유자만이다(lib/auth/routeScope).
//
// 마스터키 값은 어떤 오류 문구·로그에도 싣지 않는다. 오류는 고정 문장만 돌려준다.

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { requireEdit } from '@/lib/role'
import { PII_PREFIX, readStoredRoomMasterKey, storeRoomMasterKey } from '@/lib/pii'

const MASTER_KEY_MAX = 40

type Fail = { ok: false; error: string }

export type RoomMemoUndo = { roomId: string; prevMemo: string | null }
// prevEnc 는 암호문이다. 평문을 토큰에 실으면 적용취소 6초 동안 브라우저 메모리에 평문이 남는다.
export type RoomMasterKeyUndo = { roomId: string; prevEnc: string | null }

// 서버 액션 경계를 넘는 오류를 고정 문장으로 바꾼다. redirect 는 그대로 던져야 로그인 이동이 산다.
// 한국어 문장(권한·키 없음처럼 이 앱이 직접 던진 것)만 통과시킨다. Prisma 오류는 영어이고 질의 인자를
// 그대로 찍어 암호문이 문장에 실릴 수 있어, 통째로 고정 문장으로 바꾼다(lib/saveStatus humanError 와 같은 판정).
function failOf(err: unknown, fallback: string): Fail {
  if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
  const msg = (err as Error)?.message
  return { ok: false, error: typeof msg === 'string' && /[가-힣]/.test(msg) ? msg : fallback }
}

// ── 메모 ───────────────────────────────────────────────────────

/**
 * 호실 메모 저장. 빈 문자열은 null(지움)이다. 적용취소는 같은 액션에 prevMemo 를 넘겨 다시 부른다.
 * 호실 관리 폼(updateRoom)과 같은 칸을 쓴다. 이 액션은 메모 한 칸만 바꾸므로 이용료 동기화·락인
 * 되쓰기 같은 updateRoom 의 부수 경로를 타지 않는다.
 */
export async function updateRoomMemo(roomId: string, memo: string | null): Promise<
  { ok: true; undo: RoomMemoUndo } | Fail
> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, memo: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const next = memo?.trim() ? memo.trim() : null
    await prisma.room.update({ where: { id: room.id }, data: { memo: next }, select: { id: true } })
    revalidatePath('/room-manage')
    return { ok: true, undo: { roomId: room.id, prevMemo: room.memo } }
  } catch (err) {
    return failOf(err, '메모를 저장하지 못했습니다.')
  }
}

// ── 도어락 마스터키 ────────────────────────────────────────────

/**
 * 저장된 마스터키의 평문을 꺼내는 유일한 문. 호실 프리즘의 [보기] 가 이 액션을 부른다.
 * 값을 돌려주기 전에 열람 기록을 남긴다. 뒤에 두면 기록 실패가 곧 기록 없는 열람이 된다
 * (입주자 화면 revealForeignRegNo 와 같은 순서).
 */
export async function revealRoomMasterKey(roomId: string): Promise<{ ok: true; value: string } | Fail> {
  try {
    const { userId, propertyId, role } = await requirePropertyAccess()
    if (!canReadScope(role, 'security')) return { ok: false, error: '마스터키를 볼 권한이 없습니다.' }
    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, doorMasterKeyEnc: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (!room.doorMasterKeyEnc) return { ok: false, error: '등록된 마스터키가 없습니다.' }
    const plain = readStoredRoomMasterKey(room.doorMasterKeyEnc, room.id)
    if (!plain) return { ok: false, error: '저장된 마스터키를 읽지 못했습니다. 다시 입력해 주세요.' }
    await prisma.roomMasterKeyView.create({
      data: { roomId: room.id, propertyId, viewedById: userId },
    })
    return { ok: true, value: plain }
  } catch (err) {
    return failOf(err, '마스터키를 불러오지 못했습니다.')
  }
}

// 쓰기 쪽 공통 관문 — 편집 권한(소유자·관리자)과 'security' 스코프(소유자)를 둘 다 본다.
// 지금 프리셋에서는 security 가 곧 소유자라 앞 검사가 중복처럼 보이지만, 스코프가 나중에 사용자별로
// 넓어져도 '읽기 권한만으로 쓰기' 가 생기지 않게 둘을 따로 묻는다.
async function masterKeyWriteAccess(): Promise<{ propertyId: string } | Fail> {
  await requireEdit()
  const { propertyId, role } = await requirePropertyAccess()
  if (!canReadScope(role, 'security')) return { ok: false, error: '마스터키를 바꿀 권한이 없습니다.' }
  return { propertyId }
}

/**
 * 마스터키 저장. 빈 값(공백뿐 포함)은 지움이다. 이전 암호문을 적용취소 토큰으로 돌려준다.
 * 키(STAYEUM_PII_KEY)가 없으면 lib/pii 가 저장을 명시적으로 실패시킨다. 평문으로 떨어지는 길은 없다.
 */
export async function updateRoomMasterKey(roomId: string, value: string | null): Promise<
  { ok: true; undo: RoomMasterKeyUndo } | Fail
> {
  try {
    const gate = await masterKeyWriteAccess()
    if ('ok' in gate) return gate
    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId: gate.propertyId },
      select: { id: true, doorMasterKeyEnc: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const plain = value?.trim() ?? ''
    if (plain.length > MASTER_KEY_MAX) return { ok: false, error: '마스터키는 40자까지입니다.' }
    const nextEnc = plain ? storeRoomMasterKey(plain, room.id) : null
    await prisma.room.update({ where: { id: room.id }, data: { doorMasterKeyEnc: nextEnc }, select: { id: true } })
    return { ok: true, undo: { roomId: room.id, prevEnc: room.doorMasterKeyEnc } }
  } catch (err) {
    return failOf(err, '마스터키를 저장하지 못했습니다.')
  }
}

/**
 * 마스터키 변경·삭제의 적용취소. 토큰의 이전 암호문을 그대로 되쓴다.
 * 토큰은 브라우저를 거쳐 돌아오므로 모양을 확인한다 — null(원래 미등록)이거나 v1: 암호문일 때만 받는다.
 * 다른 방의 암호문을 끼워 넣어도 AAD 가 방 id 라 복호 단계에서 실패하고 평문은 안 나온다.
 */
export async function undoUpdateRoomMasterKey(u: RoomMasterKeyUndo): Promise<{ ok: true } | Fail> {
  try {
    const gate = await masterKeyWriteAccess()
    if ('ok' in gate) return gate
    if (u.prevEnc !== null && !(typeof u.prevEnc === 'string' && u.prevEnc.startsWith(PII_PREFIX))) {
      return { ok: false, error: '되돌릴 값이 올바르지 않습니다.' }
    }
    const room = await prisma.room.findFirst({
      where: { id: u.roomId, propertyId: gate.propertyId },
      select: { id: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    await prisma.room.update({ where: { id: room.id }, data: { doorMasterKeyEnc: u.prevEnc }, select: { id: true } })
    return { ok: true }
  } catch (err) {
    return failOf(err, '마스터키를 되돌리지 못했습니다.')
  }
}
