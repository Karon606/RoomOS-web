// 투어일 비움 메모 진리표(lib/tourClearLog). 만들기·읽기·화면 글자, 이어받기 판정이 메모 행을 사유로 오인하지 않는지. 실패 시 exit 1.
// 실행: npx tsx scripts/test-tour-clear-log.ts
import { tourClearedMemo, parseTourClearedMemo, statusLogMemoText, tourClearedValueText } from '../lib/tourClearLog'
import { inheritableCheckoutReason } from '../lib/checkoutReason'
import { isSystemStatusReason } from '../lib/statusReasons'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

const D = new Date('2026-09-28T00:00:00Z')   // @db.Date 는 그 날짜의 UTC 자정
// ── 만들기: 비울 때만 ──
eq('비움 + 시각 없음', tourClearedMemo({ tourDate: D, tourTime: null }, ''), '투어일 2026-09-28 비움')
eq('비움 + 시각', tourClearedMemo({ tourDate: D, tourTime: '14:00' }, ''), '투어일 2026-09-28 14:00 비움')
eq('직렬화된 날짜 글자도 같다', tourClearedMemo({ tourDate: '2026-09-28T00:00:00.000Z', tourTime: '09:30' }, ''), '투어일 2026-09-28 09:30 비움')
eq('칸이 없는 저장(null)은 보존이라 없음', tourClearedMemo({ tourDate: D, tourTime: '14:00' }, null), null)
eq('undefined 도 없음', tourClearedMemo({ tourDate: D, tourTime: null }, undefined), null)
eq('새 날짜로 바꾸는 저장은 없음', tourClearedMemo({ tourDate: D, tourTime: '14:00' }, '2026-10-02'), null)
eq('같은 날짜 그대로 저장도 없음', tourClearedMemo({ tourDate: D, tourTime: null }, '2026-09-28'), null)
eq('원래 투어일이 없으면 비울 것이 없다', tourClearedMemo({ tourDate: null, tourTime: null }, ''), null)
eq('시각 칸의 이상한 글자는 붙이지 않는다', tourClearedMemo({ tourDate: D, tourTime: '오후 2시' }, ''), '투어일 2026-09-28 비움')
eq('깨진 날짜는 없음', tourClearedMemo({ tourDate: 'not-a-date', tourTime: null }, ''), null)

// ── 읽기·화면 글자 ──
eq('읽기: 시각 없음', parseTourClearedMemo('투어일 2026-09-28 비움'), { ymd: '2026-09-28', time: null })
eq('읽기: 시각', parseTourClearedMemo('투어일 2026-09-28 14:00 비움'), { ymd: '2026-09-28', time: '14:00' })
eq('읽기: 다른 메모는 null', parseTourClearedMemo('입주자 요청으로 메모'), null)
eq('읽기: null', parseTourClearedMemo(null), null)
eq('화면: 목록 날짜 표기', statusLogMemoText('투어일 2026-09-28 14:00 비움'), '투어일 2026.09.28 14:00 비움')
eq('화면: 시각 없음', statusLogMemoText('투어일 2026-09-28 비움'), '투어일 2026.09.28 비움')
eq('화면: 다른 메모는 그대로', statusLogMemoText('그냥 메모'), '그냥 메모')
eq('화면: 지운 값만(같은 상태 행의 메모 줄)', [tourClearedValueText('투어일 2026-09-28 14:00 비움'), tourClearedValueText('투어일 2026-09-28 비움'), tourClearedValueText('그냥 메모'), tourClearedValueText(null)],
  ['2026.09.28 14:00', '2026.09.28', null, null])
eq('화면: 빈 메모는 없음', [statusLogMemoText(''), statusLogMemoText('  '), statusLogMemoText(null)], [null, null, null])
const made = tourClearedMemo({ tourDate: D, tourTime: '14:00' }, '')
eq('만든 메모는 읽힌다(왕복)', parseTourClearedMemo(made), { ymd: '2026-09-28', time: '14:00' })

// ── 오인 방지: 메모 행은 사유가 아니다 ──
eq('메모 글자는 시스템 라벨이 아니고 사유 칸에 안 들어간다', isSystemStatusReason(made), false)
// 퇴실 예정 그대로 메모 행이 끼어도(reason null) 이어받기는 그 앞 예정 사유를 고른다.
eq('이어받기: 같은 상태 메모 행은 건너뛴다', inheritableCheckoutReason([
  { fromStatus: 'CHECKOUT_PENDING', toStatus: 'CHECKOUT_PENDING', reason: null },
  { fromStatus: 'ACTIVE', toStatus: 'CHECKOUT_PENDING', reason: '개인 사정' },
]), '개인 사정')
eq('이어받기: 투어 예정 그대로 메모 행은 예정 구간을 끊지 않는다', inheritableCheckoutReason([
  { fromStatus: 'WAITING_TOUR', toStatus: 'WAITING_TOUR', reason: null },
  { fromStatus: 'ACTIVE', toStatus: 'CHECKOUT_PENDING', reason: '개인 사정' },
]), '개인 사정')

console.log(`[투어일 비움 메모] 통과 ${pass} / 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
