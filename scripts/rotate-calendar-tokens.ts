// 캘린더 구독 토큰 재발급 — 약한 난수로 만들어진 기존 토큰 폐기 (D페이즈 2026-08-03, 운영자 승인).
//
// 왜
//   genCalToken 이 Math.random 두 번 + Date.now 였다. 암호학적으로 안전하지 않고 뒷부분은 공개값이다.
//   이 토큰 하나가 /api/calendar/[token] 을 **무인증으로** 열어 전 입주자 실명·호실·월 이용료·
//   퇴실 예정일·투어 일정·잠재고객 연락처를 ICS 로 내보낸다. 만료도 없다.
//   생성 함수는 randomBytes(32) 로 바꿨다. 이미 발급된 토큰은 바꿔도 여전히 약한 값이라 여기서 폐기한다.
//
// 대가
//   **기존 구독 링크가 즉시 죽는다.** 구글 캘린더 등에 등록해 둔 구독은 갱신이 멈춘다.
//   새 주소는 앱의 설정 화면에서 다시 받는다. 되돌리기는 약한 토큰으로 돌아가는 것이라 제공하지 않는다.
//   대신 설정 화면의 재발급 버튼으로 언제든 다시 뽑을 수 있다.
//
// 토큰 값은 출력하지 않는다 — 이 값 자체가 명부 열쇠다.
//
// 실행: npx tsx --env-file=.env.local scripts/rotate-calendar-tokens.ts [--apply]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'crypto'

const apply = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const props = await prisma.property.findMany({ select: { id: true, name: true, calendarToken: true } })
  const targets = props.filter(p => p.calendarToken && p.calendarToken.length < 43)

  console.log(`영업장 ${props.length}곳 · 발급된 토큰 ${props.filter(p => p.calendarToken).length}건`)
  for (const p of targets) console.log(`  재발급 대상 — ${p.name} (약한 난수로 생성된 길이 ${p.calendarToken!.length} 토큰)`)
  if (targets.length === 0) { console.log('재발급할 토큰이 없습니다.'); await prisma.$disconnect(); return }
  if (!apply) { console.log('\n실제 반영: --apply'); await prisma.$disconnect(); return }

  for (const p of targets) {
    await prisma.property.update({ where: { id: p.id }, data: { calendarToken: randomBytes(32).toString('base64url') } })
  }
  console.log(`\n${targets.length}건 재발급 완료. 기존 구독 링크는 죽었습니다.`)
  console.log('새 주소는 앱 설정 화면의 캘린더 구독 카드에서 확인하고 다시 등록하세요.')
  await prisma.$disconnect()
}

void main()
