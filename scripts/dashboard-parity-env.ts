// 대시보드 패리티 하네스의 실행 환경 고정 — 시각 동결 + pg 쿼리 계수기.
// verify-dashboard-parity.ts 가 **맨 첫 줄에서** 부른다(다른 모듈보다 먼저 평가되어야 한다).
//
// 시각을 왜 얼리나. getDashboardData 는 Date.now()·new Date() 를 그대로 읽는 자리가 있다
// (임시저장 '3시간 전' 문구, 입주 확정 09:00 KST 판정). 두 번 돌리면 그 두 자리가 흔들려
// A/A 조차 바이트가 갈린다. 코드가 아니라 하네스에서 축을 고정한다.
import pg from 'pg'

const FIXED_MS = Date.parse(process.env.PARITY_NOW ?? '2026-09-11T04:00:00.000Z')
if (Number.isNaN(FIXED_MS)) throw new Error('PARITY_NOW 를 해석하지 못했다')

const RealDate = Date

class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED_MS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else super(...(args as [any, any, any, any, any, any, any]))
  }
  static now(): number {
    return FIXED_MS
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).Date = FrozenDate

// ── SQL 건수 ─────────────────────────────────────────────────
// Prisma 7 은 @prisma/adapter-pg 를 지나 pg 로 내려간다. Client.prototype.query 하나가
// Pool 경유분까지 전부 지나는 길목이라 여기 한 곳만 감싼다(BEGIN·COMMIT 도 함께 세진다).
let count = 0
const origQuery = pg.Client.prototype.query
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(pg.Client.prototype as any).query = function (this: unknown, ...args: unknown[]) {
  count++
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (origQuery as any).apply(this, args)
}

export function resetQueryCount(): void {
  count = 0
}

export function queryCount(): number {
  return count
}

export const FROZEN_NOW_ISO = new RealDate(FIXED_MS).toISOString()

/** 진짜 벽시계 — 소요 ms 측정용(Date.now 는 얼려 놨다). */
export function realNow(): number {
  return RealDate.now()
}
