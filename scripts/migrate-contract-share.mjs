// 계약서 원격 서명 링크 테이블(contract_share_links) 생성 — 비파괴(create table if not exists), 멱등.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('→ create table contract_share_links')
  await prisma.$executeRawUnsafe(`
    create table if not exists contract_share_links (
      id uuid primary key default gen_random_uuid(),
      token text not null unique,
      "propertyId" uuid not null references properties(id) on delete cascade,
      "tenantId" uuid not null references tenants(id) on delete cascade,
      "leaseTermId" uuid not null references lease_terms(id) on delete cascade,
      "templateSnapshot" jsonb not null,
      "expiresAt" timestamptz not null,
      "closedAt" timestamptz,
      "signedAt" timestamptz,
      "disposalSignedAt" timestamptz,
      "birthdateAttempts" integer not null default 0,
      "lockedAt" timestamptz,
      "createdBy" uuid,
      "createdAt" timestamptz not null default now()
    )
  `)
  console.log('→ create index contract_share_links_tenant_idx')
  await prisma.$executeRawUnsafe(
    `create index if not exists contract_share_links_tenant_idx on contract_share_links("tenantId","createdAt")`
  )
  console.log('→ create index contract_share_links_property_idx')
  await prisma.$executeRawUnsafe(
    `create index if not exists contract_share_links_property_idx on contract_share_links("propertyId","createdAt")`
  )
  console.log('migration applied')
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
