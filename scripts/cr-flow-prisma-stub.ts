// 현금영수증 흐름 하네스 전용 lib/prisma 대역. 메모리 PGlite 소켓에만 붙고 운영 DB 주소는 거부한다.
// scripts/tsconfig.cash-receipt-flow.json 이 '@/lib/prisma' 를 이 파일로 가리킨다. 앱 코드는 절대
// 이 파일을 import 하지 않는다(선례: dashboard-access-stub).
//
// 소프트삭제 익스텐션은 lib/prisma.ts 와 같은 규칙이어야 한다. 하네스가 시작할 때 두 파일의 모델·조회
// 목록을 글자로 대조해 갈리면 멈춘다(scripts/test-cash-receipt-flow.ts 머리).
//
// 연결은 하나다(max 1). 인터랙티브 트랜잭션 안에서 전역 클라이언트를 부르면 연결을 못 얻어 시간 초과로
// 실패한다. 운영에서는 다른 연결로 새어 트랜잭션 밖 쓰기가 되는 결함을 여기서는 실패로 드러낸다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const url = process.env.CR_FLOW_DATABASE_URL
if (!url || !/^postgresql:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres$/.test(url) || process.env.DATABASE_URL !== url) {
  throw new Error('cr-flow: 하네스 PGlite 주소가 아니어서 연결하지 않습니다')
}

export const SOFT_DELETE_MODELS = new Set(['PaymentRecord', 'ExtraIncome'])
export const SOFT_DELETE_READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])

function create() {
  const adapter = new PrismaPg({ connectionString: url, max: 1 })
  return new PrismaClient({ adapter, omit: { room: { doorMasterKeyEnc: true } } }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model) && SOFT_DELETE_READ_OPS.has(operation)) {
            const a = args as { where?: Record<string, unknown> }
            if (!(a.where && 'deletedAt' in a.where)) a.where = { ...(a.where ?? {}), deletedAt: null }
          }
          return query(args)
        },
      },
    },
  })
}

const prisma = create()
export type PrismaDb = typeof prisma
export default prisma
