// 현금영수증 발행 줄 데이터 점검의 판정 정본. DB 를 모르는 순수 함수라 축마다 단위 테스트로 역주입한다.
//
// 왜 따로 두나(2026-10-14, 생애주기 정비 3단계). 점검 스크립트(scripts/check-cash-receipt-orphan.ts)가 읽은
// 재료로 축을 판정하고, 정리 스크립트(scripts/fix-cash-receipt-422-519.ts)의 예행도 같은 판정으로 '정리 뒤
// 점검 결과'를 보여 준다. 판정이 스크립트 안에 인라인으로 있으면 두 자리가 따로 놀고, DB 사본 없이는 축이
// 정말 우는지 확인할 길도 없다. 키·몫·대기 판정은 lib/cashReceipt 를, 받은 몫 기준은 화면과 같은
// lib/cashReceiptCopy crCoveredRent 를 그대로 쓴다. 여기 사본을 두면 화면과 점검이 다른 말을 한다.
//
// 축(앞 다섯은 2026-08-25·09-21 부터, 뒤는 2026-10-14 승인 규칙에 맞춰 붙었다).
//   (가) 살아 있는 줄을 받치는 발행 표시 수납이 없다. 유령 줄(408호). 환불 대기는 비켜 간다.
//   (나) 발행 표시 수납인데 그 키의 줄이 없다. 합계에서 통째로 빠진다.
//   (라) 살아 있는 줄이 보증금·청소비를 들었다. 받을 때 발행 대상은 이용료 몫뿐이다(2026-09-21).
//   (마) 보증금 수납에 도장이 있는데 그 키의 줄이 보증금을 안 들었다.
//   (바) 줄 금액이 도장 찍힌 이용료 몫보다 크다. 2026-10-14 부터 기준이 키 전체 합이 아니라 화면 캡션과 같은
//        crCoveredRent 다. 일부만 도장 찍힌 키에서 줄이 안 덮인 돈까지 든 경우를 전체 합 기준은 못 잡았다.
//   (사) 도장 날짜(KST)가 그 키의 줄 발행일과 다르다. 수납 행 배지와 발행 합계가 다른 날을 말한다. 기준선 0.
//   (아) 줄이 있는 키에서 일부만 도장. **정상 상태다**(발행 없이 받은 앞 입금은 뒤 발행이 덮지 않는다, 검수 R4b).
//        위반이 아니라 정보로 덮이지 않은 금액·건수만 낸다. 도장 찍힌 합과 줄 금액이 다르면 (바)·(카)가 잡는다.
//   (자) 줄이 만들어질 때 그 키의 수납이 이미 전부 지워져 있었다. 태어날 때부터 받친 적이 없는 줄(519호,
//        2026-08-24 백필). 알려진 줄은 부르는 쪽이 넘기고, 알려진 줄이 더는 안 보이면 기준선이 낡았다고 운다.
//   (차) 환불 대기가 30일을 넘겼다. 경고만 낸다(실패 아님). 홈택스 취소·재발행이 끝났는지 볼 때다.
//   (카) 줄 금액이 도장 찍힌 이용료 몫보다 적은데 줄 메모에 의도가 없다. 일부만 끊은 발행이면 메모로 남긴다.
//
// 날짜는 KST 로 읽는다. 발행일·도장은 타임스탬프(KST 자정을 UTC 로 저장)라 UTC 날짜부로 자르면 하루 앞이 나온다.
import { cashReceiptKey, receiptRowVerdict, summarizeCashReceiptKey } from './cashReceipt'
import { crCoveredRent } from './cashReceiptCopy'
import { kstYmdStr } from './kstDate'
import { withParticle } from './koParticle'

/** 환불 대기가 이 날수를 넘기면 (차) 경고를 낸다. */
export const CASH_RECEIPT_REFUND_PENDING_WARN_DAYS = 30

/** 살아 있는 발행 줄 한 줄(deletedAt 이 null 인 것만 넘긴다). */
export type AuditLine = {
  id: string; leaseTermId: string; payDate: Date; payMethod: string | null
  amount: number; issuedAt: Date; createdAt: Date
  inclDeposit: boolean; inclCleaning: boolean; memo: string | null
}

/** 수납 한 건. **지워진 것과 조정 전표까지 전부** 넘긴다. 축마다 필요한 것만 골라 쓴다. */
export type AuditRecord = {
  id: string; leaseTermId: string; payDate: Date; payMethod: string | null
  actualAmount: number; isDeposit: boolean; isBillingAdjust: boolean
  cashReceiptIssuedAt: Date | null; deletedAt: Date | null
}

export type CashReceiptAuditInput = {
  lines: AuditLine[]
  records: AuditRecord[]
  /** 계약 환불 스냅샷(checkoutProrationUndo.refund.deletedRecordIds)이 지운 수납 id. 환불 대기 판별 재료다. */
  refundDeletedIds: ReadonlySet<string>
  /** KST 오늘 'YYYY-MM-DD'. (차) 경과 일수의 기준. */
  todayYmd: string
  /** 알려진 (자) 줄. 줄 id 에서 사유로. 정리 전 한시 기준선이다. */
  knownBornDead: Readonly<Record<string, string>>
}

export type CashReceiptAuditAxis = '가' | '나' | '라' | '마' | '바' | '사' | '자' | '카'

export type CashReceiptAuditReport = {
  lineCount: number
  stampedCount: number
  violations: { axis: CashReceiptAuditAxis; text: string }[]
  /** 환불 대기 줄. ageDays 는 환불 확정(원 수납이 지워진 날, KST)부터 오늘까지. */
  pending: { lineId: string; amount: number; issuedYmd: string; ageDays: number }[]
  /** (차) 환불 대기 30일 경과. 경고다. */
  warnings: { axis: '차'; text: string }[]
  /** (아) 줄이 있는 키의 일부만 도장. 정보다. */
  partial: { lineId: string; payYmd: string; amount: number; unstampedRows: number; unstampedRent: number }[]
  /** 알려진 (자)로 넘어간 줄. */
  bornDeadKnown: { lineId: string; reason: string }[]
}

const won = (n: number) => `${n.toLocaleString()}원`
const payYmdOf = (d: Date) => d.toISOString().slice(0, 10)   // @db.Date 는 UTC 자정 저장이라 UTC 날짜부가 달력 날짜다
const daysBetween = (fromYmd: string, toYmd: string) =>
  Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000)

/**
 * (사) 줄 발행일과 다른 날을 말하는 도장. 그 키의 살아 있는 도장 중 줄이 덮는 행만 본다. 보증금 행은 줄이
 * 보증금을 들었을 때만 대상이다(안 들었는데 도장이 있으면 그건 (마)다). 0원 행도 본다. 엔진은 0원 행 도장을
 * 지우거나 줄 날짜로 맞추므로, 다른 날이 남았다면 엔진 밖에서 쓴 것이다.
 */
export function stampDateMismatches(line: Pick<AuditLine, 'issuedAt' | 'inclDeposit'>, stampedInKey: Pick<AuditRecord, 'isDeposit' | 'cashReceiptIssuedAt'>[]): string[] {
  const want = kstYmdStr(line.issuedAt)
  const out: string[] = []
  for (const r of stampedInKey) {
    if (!r.cashReceiptIssuedAt) continue
    if (r.isDeposit && !line.inclDeposit) continue
    const got = kstYmdStr(r.cashReceiptIssuedAt)
    if (got !== want) out.push(got)
  }
  return out
}

/**
 * (자) 이 줄이 만들어질 때 그 키의 수납(조정 전표 제외)이 이미 전부 지워져 있었나. 수납이 하나도 없으면
 * 아니다(키가 어긋난 유령이고 (가)가 말한다). 만들어진 뒤에 지워진 수납은 여기 안 든다(그건 (가)나 환불 대기다).
 */
export function isBornDeadLine(line: Pick<AuditLine, 'createdAt'>, keyRecords: Pick<AuditRecord, 'deletedAt' | 'isBillingAdjust'>[]): boolean {
  const rs = keyRecords.filter(r => !r.isBillingAdjust)
  return rs.length > 0 && rs.every(r => !!r.deletedAt && r.deletedAt.getTime() <= line.createdAt.getTime())
}

/** (카)의 의도 표시. 공백만 있는 메모는 의도가 아니다. */
export function hasCashReceiptIntentMemo(memo: string | null | undefined): boolean {
  return !!memo && memo.trim().length > 0
}

/**
 * 발행 줄 데이터 점검 전체. 위반(가·나·라·마·바·사·자·카), 경고(차), 정보(아·환불 대기·알려진 자)를 한 번에 낸다.
 * 순서는 축 차례다. 부르는 쪽은 위반이 하나라도 있으면 실패로 끝낸다.
 */
export function auditCashReceipts(input: CashReceiptAuditInput): CashReceiptAuditReport {
  const { lines, records, refundDeletedIds, todayYmd, knownBornDead } = input
  const key = cashReceiptKey
  const ymd = (d: Date) => kstYmdStr(d)
  const violations: CashReceiptAuditReport['violations'] = []
  const push = (axis: CashReceiptAuditAxis, text: string) => violations.push({ axis, text })

  const live = records.filter(r => !r.deletedAt)
  // 발행 표시 수납. 종전 점검과 같은 모집단이다(살아 있고 도장이 있는 것, 조정 전표 포함).
  const stamped = live.filter(r => r.cashReceiptIssuedAt)
  const stampedKeys = new Set(stamped.map(key))
  const lineKeys = new Set(lines.map(key))

  // 환불 대기. 환불 스냅샷이 지운 수납 중 도장이 있던 것의 키. 환불 확정 시각은 그 수납들이 지워진 가장 늦은 때다.
  const pendingKeys = new Set<string>()
  const refundAt = new Map<string, number>()
  for (const r of records) {
    if (!r.deletedAt || !r.cashReceiptIssuedAt || !refundDeletedIds.has(r.id)) continue
    const k = key(r)
    pendingKeys.add(k)
    refundAt.set(k, Math.max(refundAt.get(k) ?? 0, r.deletedAt.getTime()))
  }

  const group = <T extends { leaseTermId: string; payDate: Date; payMethod: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return m
  }
  const stampedByKey = group(stamped)
  // 몫은 살아 있고 조정 전표가 아닌 수납으로 센다(summarizeCashReceiptKey 의 약속, 화면 cashReceiptKey.rent 와 같다).
  const shareRowsByKey = group(live.filter(r => !r.isBillingAdjust))
  const allRowsByKey = group(records)
  const partsOf = (k: string) => summarizeCashReceiptKey(shareRowsByKey.get(k) ?? [])
  const verdictOf = (k: string) => receiptRowVerdict(k, stampedKeys, pendingKeys)

  // (가) 유령 줄, 그리고 환불 대기와 (차)
  const pending: CashReceiptAuditReport['pending'] = []
  const warnings: CashReceiptAuditReport['warnings'] = []
  for (const l of lines) {
    const k = key(l)
    const v = verdictOf(k)
    if (v === 'ok') continue
    if (v === 'refundPending') {
      const ageDays = daysBetween(ymd(new Date(refundAt.get(k) ?? 0)), todayYmd)
      pending.push({ lineId: l.id, amount: l.amount, issuedYmd: ymd(l.issuedAt), ageDays })
      if (ageDays > CASH_RECEIPT_REFUND_PENDING_WARN_DAYS) {
        warnings.push({ axis: '차', text: `[환불 대기 ${CASH_RECEIPT_REFUND_PENDING_WARN_DAYS}일 경과] ${won(l.amount)} (발행 ${ymd(l.issuedAt)} · 수납일 ${payYmdOf(l.payDate)})은 환불 확정 뒤 ${ageDays}일째다. 홈택스 취소·재발행이 끝났는지 확인할 것(실패로 세지 않는다)` })
      }
      continue
    }
    push('가', `[발행 줄] 유령 · ${won(l.amount)} (수납일 ${payYmdOf(l.payDate)} · 발행 ${ymd(l.issuedAt)})에 대응하는 발행 표시 수납이 없다. 합계에 그대로 든다`)
  }

  // (나) 빠진 줄
  const seen = new Set<string>()
  for (const p of stamped) {
    const k = key(p)
    if (seen.has(k)) continue
    seen.add(k)
    if (!lineKeys.has(k)) {
      push('나', `[발행 줄] 누락 · 수납(${payYmdOf(p.payDate)} ${won(p.actualAmount)})에 발행 표시가 켜져 있는데 발행 줄이 없다. 그 금액이 합계에서 통째로 빠진다`)
    }
  }

  // (라) 살아 있는 줄이 보증금·청소비를 들었다.
  for (const l of lines) {
    if (!l.inclDeposit && !l.inclCleaning) continue
    const what = [l.inclDeposit ? '보증금' : '', l.inclCleaning ? '청소비' : ''].filter(Boolean).join('·')
    push('라', `[발행 몫] 예외 · ${won(l.amount)} (발행 ${ymd(l.issuedAt)})이 ${what} 을(를) 포함한다. 받을 때는 발행 대상이 아니다`)
  }

  // (마) 보증금 수납에 도장이 있는데 줄이 그것을 안 받친다.
  const lineByKey = new Map(lines.map(l => [key(l), l]))
  for (const p of stamped) {
    if (!p.isDeposit) continue
    const line = lineByKey.get(key(p))
    if (line?.inclDeposit) continue
    push('마', `[발행 몫] 도장 · 보증금 수납(${payYmdOf(p.payDate)} ${won(p.actualAmount)})에 발행 표시가 있는데 ${line ? '그 발행 줄은 보증금을 안 들었다' : '발행 줄이 없다'}`)
  }

  // (바) 줄 금액이 도장 찍힌 이용료 몫을 넘는데 보증금·청소비는 안 들었다고 말한다. 소스 그물을 우회한 회귀를
  //      데이터에서 잡는 자리다. 환불 대기는 비켜 간다(원 수납이 지워져 몫이 0 인 것이 정상 중간 상태다).
  for (const l of lines) {
    if (l.inclDeposit || l.inclCleaning) continue
    const k = key(l)
    if (verdictOf(k) === 'refundPending') continue
    const parts = partsOf(k)
    const covered = crCoveredRent(parts)
    if (l.amount <= covered) continue
    const basis = parts.stampedRentRows > 0 && parts.stampedRentRows < parts.rentRows ? '도장 찍힌 이용료 몫' : '이용료 몫'
    push('바', `[발행 몫] 초과 · 발행 ${won(l.amount)} (발행 ${ymd(l.issuedAt)} · 수납일 ${payYmdOf(l.payDate)})이 ${basis} ${withParticle(won(covered), '을/를')} 넘는데 보증금·청소비를 안 들었다고 적혀 있다`)
  }

  // (사) 도장 날짜와 줄 발행일. 키 단위로 한 줄.
  for (const l of lines) {
    const off = stampDateMismatches(l, stampedByKey.get(key(l)) ?? [])
    if (off.length === 0) continue
    push('사', `[도장 날짜] 어긋남 · 발행 ${won(l.amount)} (발행 ${ymd(l.issuedAt)} · 수납일 ${payYmdOf(l.payDate)})인데 그 입금의 도장 ${off.length}건이 다른 날(${[...new Set(off)].join(', ')})을 말한다. 수납 행 배지와 발행 합계가 다른 날을 가리킨다`)
  }

  // (아) 줄이 있는 키의 일부만 도장. 정보다.
  const partial: CashReceiptAuditReport['partial'] = []
  for (const l of lines) {
    const k = key(l)
    if (verdictOf(k) !== 'ok') continue
    const p = partsOf(k)
    if (p.stampedRentRows === 0 || p.stampedRentRows >= p.rentRows) continue
    partial.push({ lineId: l.id, payYmd: payYmdOf(l.payDate), amount: l.amount, unstampedRows: p.rentRows - p.stampedRentRows, unstampedRent: p.unstampedRent })
  }

  // (자) 태어날 때부터 죽은 줄. 알려진 줄은 넘기고, 알려진 줄이 안 보이면 기준선이 낡았다고 운다.
  const bornDeadKnown: CashReceiptAuditReport['bornDeadKnown'] = []
  const bornDeadIds = new Set<string>()
  for (const l of lines) {
    if (!isBornDeadLine(l, allRowsByKey.get(key(l)) ?? [])) continue
    bornDeadIds.add(l.id)
    const reason = knownBornDead[l.id]
    if (reason) { bornDeadKnown.push({ lineId: l.id, reason }); continue }
    push('자', `[발행 줄] 태어날 때부터 죽은 줄 · ${won(l.amount)} (수납일 ${payYmdOf(l.payDate)} · 발행 ${ymd(l.issuedAt)})은 만들어진 날(${ymd(l.createdAt)}) 전에 그 입금의 수납이 전부 지워져 있었다. 받친 적이 없는 줄이 합계에 든다`)
  }
  for (const [id, reason] of Object.entries(knownBornDead)) {
    if (bornDeadIds.has(id)) continue
    push('자', `[발행 줄] 기준선이 낡았다 · 알려진 (자) 줄 ${id} (${reason})이 이제 (자)가 아니다. 정리가 끝났으면 점검의 알려진 목록에서 지울 것`)
  }

  // (카) 도장 찍힌 이용료 몫보다 적게 끊었는데 메모에 의도가 없다. 도장이 하나도 없는 줄은 (가)·환불 대기가 말한다.
  for (const l of lines) {
    if (l.inclDeposit || l.inclCleaning) continue
    const k = key(l)
    if (verdictOf(k) !== 'ok') continue
    const parts = partsOf(k)
    const covered = crCoveredRent(parts)
    if (l.amount >= covered || hasCashReceiptIntentMemo(l.memo)) continue
    push('카', `[발행 몫] 미달 · 발행 ${won(l.amount)} (발행 ${ymd(l.issuedAt)} · 수납일 ${payYmdOf(l.payDate)})이 도장 찍힌 이용료 몫 ${won(covered)}보다 적은데 발행 줄 메모에 이유가 없다. 일부만 끊은 발행이면 메모로 남길 것`)
  }

  return { lineCount: lines.length, stampedCount: stamped.length, violations, pending, warnings, partial, bornDeadKnown }
}
