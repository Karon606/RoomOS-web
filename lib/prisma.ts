import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL!

// 소프트삭제 대상 모델 — 이 모델들의 '조회'는 자동으로 deletedAt:null 필터가 붙는다.
// (수납·부가수익 삭제 적용취소 MF-3b. 완납·미수·통계·리포트 등 모든 합산 조회에서 삭제분 제외.)
// findUnique/쓰기(update·delete)는 미필터 — 복구는 update(id, deletedAt:null), 삭제는 update(id, deletedAt=now).
const SOFT_DELETE_MODELS = new Set(['PaymentRecord', 'ExtraIncome'])
const SOFT_DELETE_READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model) && SOFT_DELETE_READ_OPS.has(operation)) {
            const a = args as { where?: Record<string, unknown> }
            // opt-out: 호출부가 where에 deletedAt를 이미 명시하면 자동주입 안 함.
            // (seqNo 채번·전체 백업 등 삭제분까지 봐야 하는 곳은 deletedAt: undefined 를 넘긴다.)
            if (!(a.where && 'deletedAt' in a.where)) {
              a.where = { ...(a.where ?? {}), deletedAt: null }
            }
          }
          return query(args)
        },
      },
    },
  })
}

type ExtendedPrisma = ReturnType<typeof createPrismaClient>

// prisma를 인자로 받는 헬퍼 함수의 param 타입 — 익스텐션 적용된 클라이언트 타입.
export type PrismaDb = ExtendedPrisma

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrisma | undefined
}

const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
