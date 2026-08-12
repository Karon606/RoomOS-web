// 매일 스케줄(Vercel Cron) — 적용일이 지난 예약 가격을 전 영업장에서 baseRent 로 옮긴다.
//
// 왜 생겼나 (2026-08-12 구조 부채 정리)
//   applyScheduledRents 는 종전에 **세 페이지 로드에만** 매달려 있었다(홈·고객 관리·호실 관리).
//   room-manage/actions 주석은 "API 라우트(/api/cron/apply-rents)에서도 호출됨"이라 적고 있었지만
//   그 라우트는 실재하지 않았고 vercel.json 의 크론도 push-alerts 하나뿐이었다.
//
//   청구 표시는 이 스케줄러와 무관하게 정확하다 — billForLeaseMonth 가 예약값을 달 단위로 직접
//   읽는다. 위험은 **baseRent 를 직접 읽는 자리**들이다.
//     · /api/public/gallery — 소개 페이지가 baseRent 로 등급 카드를 묶는다. 앱에 아무도 안 들어온
//       날이면 바깥 세상에 옛 가격이 걸려 있다. 로그인한 사람이 없어도 손님은 본다.
//     · 신규 계약 폼 — 방을 고르면 rentAmount 를 room.baseRent 로 채운다. 적용일 당일 첫 로드에
//       구가가 채워지면 그 값이 계약 협의가로 굳는다(청구 엔진이 rentAmount 를 권위로 삼으므로
//       나중에 방 가격을 고쳐도 그 계약만 구가에 남는다). 표시가 아니라 돈이 어긋나는 자리다.
//     · 공실 표 '기본 월이용료'·시세 분석 평균 — /rooms 는 트리거가 아니라 혼자 열면 갱신 안 된다.
//   홈·고객 관리는 after() 로 응답 뒤에 부르므로 **그 첫 로드 자체는 구가를 그린다.**
//
// 무엇을 하는가 — lib/scheduledRent applyScheduledRentsFor 를 부른다. 페이지 로드가 부르는
// **그 함수 그대로**다. 크론이 자기 규칙을 만들지 않는 것이 이 라우트의 유일한 설계 제약이다
// (운영자 오더: 자동 적용은 결제 마스터 변경 성격이라 새 규칙 신설 금지).
//
// 멱등 — 정본이 이미 멱등이다. 조건이 'scheduledRent 가 있고 적용일이 오늘 이하'인데 적용하면서
// 그 두 칸을 비우므로, 같은 날 두 번 돌아도 두 번째는 대상 0건이다. 하루 늦게 돌아도 조건이
// `lte` 라 놓친 건을 그대로 집는다(밀린 날짜가 건너뛰어지지 않는다).
//
// KST 기준 — 경계는 scheduledRentApplyCutoff(KST 오늘의 UTC 자정)이다. 크론은 KST 자정 직후에
// 돌도록 vercel.json 에서 15:00 UTC 로 잡았다. 적용일 당일 첫 시각부터 새 가격이 서 있게 된다.
//
// 인증 — push-alerts 와 같은 문법. Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 을 보낸다.
// 수동 테스트는 ?secret= 도 허용한다.
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { applyScheduledRentsFor } from '@/lib/scheduledRent'
import { kstYmdStr } from '@/lib/kstDate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = new URL(req.url).searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  const authorized = !!cronSecret && (auth === `Bearer ${cronSecret}` || secret === cronSecret)
  if (!authorized) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const kstToday = kstYmdStr()
  const properties = await prisma.property.findMany({ select: { id: true, name: true } })

  // 영업장 하나가 실패해도 나머지는 적용한다 — 한 곳의 사고로 전체 가격이 하루 멈추면 안 된다.
  const results: { propertyId: string; name: string; updated: number; error?: string }[] = []
  for (const p of properties) {
    try {
      const { updated } = await applyScheduledRentsFor(p.id)
      results.push({ propertyId: p.id, name: p.name, updated })
    } catch (err) {
      results.push({ propertyId: p.id, name: p.name, updated: 0, error: (err as Error).message })
    }
  }

  const totalUpdated = results.reduce((s, r) => s + r.updated, 0)
  const failed = results.filter(r => r.error)

  // 실행 로그 — 응답 본문과 서버 로그 양쪽에 남긴다. 대상 0건인 날도 남겨야 "안 돈 날"과
  // "돌았는데 대상이 없던 날"이 구분된다(크론이 조용히 멎은 것을 알아채는 유일한 단서다).
  console.log(`[cron:apply-rents] KST ${kstToday} · 영업장 ${properties.length} · 적용 ${totalUpdated}실 · 실패 ${failed.length}`)
  for (const r of results.filter(r => r.updated > 0 || r.error)) {
    console.log(`[cron:apply-rents]   ${r.name}: ${r.error ? `실패 ${r.error}` : `${r.updated}실`}`)
  }

  return NextResponse.json({
    ok: failed.length === 0,
    kstToday,
    properties: properties.length,
    totalUpdated,
    results,
  }, { status: failed.length > 0 ? 500 : 200 })
}
