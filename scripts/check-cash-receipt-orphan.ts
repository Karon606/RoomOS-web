// 발행 줄이 가리키는 수납이 실제로 있는지 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가 (2026-08-25 신고). 발행 줄은 (계약·수납일·수단)으로 찾는다. 그 축이 움직이거나
// 수납이 지워지면 옛 줄은 **아무도 안 가리키는 채 남고 합계에 계속 든다.** 실제로 408호에
// 수납이 없는 8/22 줄이 하나 생겨 8월 합계를 764만에서 811만으로 부풀렸다.
//
// 두 방향.
//   (가) 발행 줄에 대응하는 살아 있는 수납이 없다 — 유령 줄.
//   (나) 발행 표시가 켜진 수납인데 발행 줄이 없다 — 합계에서 통째로 빠진다.
//
// 2026-09-21 운영자 확정("보증금은 돌려주는 금액, 청소비 또한 퇴실할 때 처리하는 금액이므로
// 받을 때는 현금영수증 처리하면 안되는 건들이야")으로 세 축이 붙었다. 기준선은 전부 0 이고
// **래칫**이다 — 지금 0 인 것을 실측으로 확인했으니, 1 이 되는 날은 규칙이 뚫린 날이다.
//   (라) 살아 있는 줄이 보증금·청소비를 들었다 — 예외 발행이거나 규칙이 뚫린 것이다.
//   (마) 보증금 record 에 도장이 있는데 그 키의 줄이 없거나 보증금을 안 들었다 — 도장과 줄이 갈렸다.
//   (바) 줄 금액이 그 키의 이용료 몫보다 큰데 보증금·청소비를 안 들었다고 말한다.
//        **(바)가 소스 그물을 우회한 회귀를 데이터에서 잡는다** — 소스는 통과하는데 값만 틀린 경우다.
//
// 2026-10-14 생애주기 정비 3단계(운영자 승인 규칙: 한 키 한 장, 끈 뒤 켜기는 새 발행, 살아 있는 줄 위 새 돈은
// 덧셈, 발행 없이 받은 앞 입금은 덮지 않음)로 축이 넷 붙고 (바)의 기준이 바뀌었다. 판정은 전부
// lib/cashReceiptAudit 의 순수 함수가 하고(scripts/test-cash-receipt-audit.ts 가 축마다 역주입), 여기는 읽고 찍는다.
//   (바) 기준이 키 전체 이용료 합에서 **도장 찍힌 이용료 몫**(화면 캡션과 같은 crCoveredRent)으로. 일부만 도장
//        찍힌 키에서 줄이 안 덮인 돈까지 든 경우를 전체 합 기준은 못 잡았다.
//   (사) 도장 날짜(KST)와 그 키의 줄 발행일 불일치. 기준선 0.
//   (아) 줄이 있는 키의 일부만 도장. 정상 상태라 위반이 아니라 정보(덮이지 않은 금액·건수)로 찍는다.
//        도장 찍힌 합과 줄 금액이 다르면 위로는 (바), 아래로는 (카)가 잡는다.
//   (자) 줄이 만들어질 때 그 키의 수납이 이미 전부 지워져 있었다(519호, 2026-08-24 백필). 아래 KNOWN_BORN_DEAD 가
//        정리 전 한시 기준선이고, 정리(scripts/fix-cash-receipt-422-519.ts)가 끝나면 그 줄이 (자)에서 빠져
//        '기준선이 낡았다'로 운다. 그때 목록을 비워 기준선을 0 으로 내린다.
//   (차) 환불 대기 30일 경과. 경고만 찍고 실패로 세지 않는다. 운영자 화면 쪽 알림은 별건이다.
//   (카) 줄 금액이 도장 찍힌 이용료 몫보다 적은데 줄 메모에 의도가 없다. 기준선 0.
//
// 삭제 표시된 발행 줄은 대상이 아니다. 다만 **집계가 그것을 세면 안 된다** — CashReceipt 는
// 소프트삭제 익스텐션 대상이 아니라(lib/prisma) 조회마다 손으로 걸러야 한다. 그 규율이
// 무너지면 (다)로 잡는다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-cash-receipt-orphan.ts
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { auditCashReceipts, CASH_RECEIPT_REFUND_PENDING_WARN_DAYS } from '../lib/cashReceiptAudit'
import { kstYmdStr } from '../lib/kstDate'
import { loadCashReceiptAuditDataReadOnly } from './cash-receipt-audit-data'

// 알려진 (자) 줄. 건수가 아니라 줄 id 와 사유다(건수로 두면 하나가 고쳐지고 하나가 새로 생겨도 초록이다).
// 519호 1건은 scripts/fix-cash-receipt-422-519.ts 적용으로 정리되어 비웠다. 기준선 0 이다.
const KNOWN_BORN_DEAD: Record<string, string> = {}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  // 이 스크립트는 확장 없는 PrismaClient 를 직접 만들어 소프트삭제 필터를 안 지난다. 살아 있는 것만 볼 자리는
  // 판정이 deletedAt 으로 직접 고른다(독립 검수 2026-09-22, 지워진 수납이 발행 줄을 받치는 것으로 세어지면 안 된다).
  // 읽기는 READ ONLY 트랜잭션 안에서 한다. 운영 DB 를 보는 점검이라 쓰기를 구조로 막는다.
  const data = await loadCashReceiptAuditDataReadOnly(prisma)
  const report = auditCashReceipts({ ...data, todayYmd: kstYmdStr(), knownBornDead: KNOWN_BORN_DEAD })
  const violations = report.violations.map(v => v.text)

  for (const p of report.pending) {
    console.log(`  [환불 대기] ${p.amount.toLocaleString()}원 (발행 ${p.issuedYmd}) · 환불 확정 뒤 ${p.ageDays}일째. 이용료 환불로 표시가 꺼져 있다. 홈택스 취소·재발행 후 표시를 다시 켜면 풀린다`)
  }
  for (const w of report.warnings) console.log(`  ${w.text}`)
  for (const k of report.bornDeadKnown) console.log(`  [알려진 (자)] ${k.lineId.slice(0, 8)} · ${k.reason}`)

  // (아) 정보. 덮이지 않은 이용료는 발행 없이 받은 앞 입금이라 정상 상태다.
  const unRows = report.partial.reduce((s, p) => s + p.unstampedRows, 0)
  const unSum = report.partial.reduce((s, p) => s + p.unstampedRent, 0)
  console.log(`  [정보 (아)] 줄이 있는 키의 일부만 도장 ${report.partial.length}키 · 덮이지 않은 이용료 ${unRows}건 ${unSum.toLocaleString()}원 (정상 상태, 위반 아님)`)
  for (const p of report.partial.slice(0, 20)) {
    console.log(`    수납일 ${p.payYmd} · 발행 ${p.amount.toLocaleString()}원 · 덮이지 않은 ${p.unstampedRows}건 ${p.unstampedRent.toLocaleString()}원`)
  }

  // (다) 집계가 삭제 표시를 거르는가 — 소스 대조
  const src = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  const agg = src.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)
  if (!agg) violations.push('[발행 줄] getMonthPaymentAggregates 를 못 찾았다 — 대조가 건너뛰어졌다. 감지망을 고칠 것')
  else if (!/prisma\.cashReceipt\.findMany\(\{[\s\S]{0,400}?deletedAt: null/.test(agg[0])) {
    violations.push('[발행 줄] 집계가 삭제 표시된 발행 줄을 안 거른다 — CashReceipt 는 소프트삭제 익스텐션 대상이 아니라 손으로 걸러야 한다. 껐다 켠 건이 두 번 세어진다')
  }

  console.log(`[발행 줄] 발행 ${report.lineCount}건 · 발행 표시 수납 ${report.stampedCount}건 · 환불 대기 ${report.pending.length}건(${CASH_RECEIPT_REFUND_PENDING_WARN_DAYS}일 경과 ${report.warnings.length}건) · 알려진 (자) ${report.bornDeadKnown.length}건 검사 (축 가·나·다·라 예외 몫·마 보증금 도장·바 이용료 몫 초과·사 도장 날짜·자 태어날 때부터 죽은 줄·카 의도 없는 미달, 정보 아·차) / 위반 ${violations.length}건`)
  if (violations.length > 0) {
    console.error('')
    for (const v of violations.slice(0, 20)) console.error(`  - ${v}`)
    if (violations.length > 20) console.error(`  ... 외 ${violations.length - 20}건`)
  }
  await prisma.$disconnect()
  process.exit(violations.length > 0 ? 1 : 0)
}

void main()
