// 격리 강화 회귀 시뮬레이션: 모든 (user × property) 조합에 대해
// 구 로직(STAFF 폴백)과 신 로직(멤버십 필수)의 판정 diff 를 출력.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const superEmails = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const users = await prisma.user.findMany({ select: { id: true, email: true, isSuperAdmin: true } })
const props = await prisma.property.findMany({ select: { id: true, name: true, ownerId: true, isActive: true } })
const roles = await prisma.userPropertyRole.findMany({ select: { userId: true, propertyId: true, role: true } })
const roleMap = new Map(roles.map(r => [`${r.userId}:${r.propertyId}`, r.role]))

let diffs = 0, denies = 0, allows = 0
for (const u of users) {
  const isSuper = superEmails.includes((u.email ?? '').toLowerCase()) || u.isSuperAdmin
  for (const p of props) {
    const row = roleMap.get(`${u.id}:${p.id}`)
    const oldRole = isSuper ? 'OWNER' : (row ?? (p.ownerId === u.id ? 'OWNER' : 'STAFF'))  // 구: 항상 통과
    const newAllow = !!row || p.ownerId === u.id || isSuper
    if (newAllow) allows++
    if (!newAllow) {
      denies++
      if (oldRole !== 'STAFF') { diffs++; console.log('UNEXPECTED', u.email, p.name, oldRole) }
    }
  }
}
console.log(`users=${users.length} properties=${props.length} roleRows=${roles.length}`)
console.log(`신규 허용 조합=${allows} / 신규 차단 조합=${denies} (전부 구 STAFF 폴백 = 무단 접근이던 것)`)
console.log(`정상 사용자 잠김(구 OWNER/MANAGER/STAFF 행 보유인데 차단)=${diffs} — 0 이어야 함`)
// 각 영업장 소유주의 역할 행 존재 여부 (레거시 폴백 의존도)
for (const p of props) {
  const hasRow = roleMap.has(`${p.ownerId}:${p.id}`)
  console.log(`property "${p.name}" active=${p.isActive} ownerRoleRow=${hasRow}`)
}
await prisma.$disconnect()
