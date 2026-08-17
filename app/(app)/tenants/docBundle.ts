'use server'

// 입주자 한 사람의 '서류 보내기' 후보 조립 — 사람 단위로 열되 **행은 계약 축**이다(신고 44501308, 1단계).
//
// 왜 계약 축인가. 한 사람이 방을 둘 쓰면(509호 거주 + 601호 창고) 납부 확인서는 계약마다 다른 종이다.
// 사람 하나로 눕히는 순간 어느 계약의 종이인지 화면이 말할 수 없고, 그러면 받지도 않은 돈의 종이가
// 나가거나 그 반대가 된다 — 서류 지목(lib/documentLease)이 이미 정리한 클래스와 같은 뿌리다.
// 그래서 모든 행이 leaseTermId 를 명시하고, 말할 수 없는 파일은 중립 그룹에 둔다(단정 배치 금지).
//
// 이 함수는 **아무것도 발급하지 않는다.** 미발급 칸은 후보로 세우되 파일이 없다고만 말하고,
// 화면이 작성 화면으로 보낸다. 발행번호 원장·서명이 걸려 있어 자동 발급은 금지다(패널 확정).

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { CONTRACT_ISSUE_STATUSES, CURRENT_OCCUPANCY_STATUSES, roomLeaseRowOrder } from '@/lib/leaseStatus'
import { kstMonthOf } from '@/lib/fmtDate'

export type DocBundleDocType = 'contract' | 'rent' | 'deposit' | 'residence'

export type DocBundleRow = {
  /** 화면 선택 키 — 계약과 종류로 만든다(파일이 없어도 행은 존재한다). */
  key: string
  docType: DocBundleDocType
  /** 이 행이 말하는 계약. null 은 '어느 계약인지 앱이 말할 수 없다'는 뜻이다(추론해 붙이지 않는다). */
  leaseTermId: string | null
  /** 보관된 최신 발급본. null 이면 미발급 — 화면이 체크박스를 잠그고 '작성'으로 보낸다. */
  driveFileId: string | null
  /** 계약서는 서명일, 나머지는 발급일(ISO). 화면이 fmtDateDot 으로 그린다. */
  issuedAt: string | null
  /** 회색 보조 문구 — '스캔본' · '계약 표시 없음' · '지난 계약' · '이번 달 발급본이 아닙니다'. */
  note: string | null
}

export type DocBundleGroup = {
  /** 'lease' = 진행 중 계약 하나 · 'other' = 그 계약들에 걸리지 않은 보관본 */
  kind: 'lease' | 'other'
  leaseTermId: string | null
  roomNo: string | null
  status: string | null
  rows: DocBundleRow[]
}

export type TenantDocBundle = {
  tenantName: string
  groups: DocBundleGroup[]
}

type FileRow = { driveFileId: string; leaseTermId: string | null; at: Date; note: string | null }

/** 종류별 최신 한 건 — 호출부가 이미 최신순으로 정렬해 넘긴다(첫 건이 곧 최신). */
const latestFor = (files: FileRow[], leaseTermId: string | null): FileRow | undefined =>
  files.find(f => f.leaseTermId === leaseTermId)

export async function getTenantDocBundle(tenantId: string): Promise<TenantDocBundle | null> {
  const { propertyId } = await requirePropertyAccess()
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, propertyId }, select: { name: true } })
  if (!tenant) return null

  // 발급 대상 계약만 연다(CONTRACT_ISSUE_STATUSES) — 투어 단계 계약에는 뽑을 종이가 없다.
  const leases = await prisma.leaseTerm.findMany({
    where: { tenantId, propertyId, status: { in: CONTRACT_ISSUE_STATUSES } },
    select: {
      id: true, status: true, moveInDate: true, depositAmount: true, parentLeaseTermId: true,
      room: { select: { roomNo: true } },
    },
  })
  // 그룹 순서 정본 — 거주 · 예약 · 비거주(호실 면·프리즘과 같은 한 벌).
  const ordered = roomLeaseRowOrder(leases)

  const [contractRows, receiptRows, certRows] = await Promise.all([
    prisma.contractFile.findMany({
      where: { tenantId, propertyId, deletedAt: null, driveFileId: { not: '' } },
      orderBy: [{ createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, signedAt: true, source: true },
    }),
    prisma.rentReceiptFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true, kind: true },
    }),
    prisma.residenceCertFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true },
    }),
  ])

  const contracts: FileRow[] = contractRows.map(r => ({
    driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.signedAt,
    note: r.source === 'UPLOADED' ? '스캔본' : null,
  }))
  const rents: FileRow[] = receiptRows.filter(r => r.kind !== 'deposit')
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null }))
  const deposits: FileRow[] = receiptRows.filter(r => r.kind === 'deposit')
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null }))
  const certs: FileRow[] = certRows
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null }))

  // 이번 달 발급본인가 — 납부 확인서에만 붙이는 보조 문구다. 그 서류만 '그 달의 사실'을 증명하고,
  // 계약서·보증금 영수증·실거주 확인서는 달과 무관해 오래됐다는 말 자체가 성립하지 않는다.
  const nowMonth = kstMonthOf(new Date())
  const staleNote = (at: Date): string | null => (kstMonthOf(at) === nowMonth ? null : '이번 달 발급본이 아닙니다')

  const row = (
    docType: DocBundleDocType, leaseTermId: string | null, file: FileRow | undefined, extraNote?: string | null,
  ): DocBundleRow => ({
    key: `${docType}:${leaseTermId ?? 'none'}`,
    docType,
    leaseTermId,
    driveFileId: file?.driveFileId ?? null,
    issuedAt: file ? file.at.toISOString() : null,
    note: [file?.note ?? null, extraNote ?? null].filter(Boolean).join(' · ') || null,
  })

  const residing: string[] = CURRENT_OCCUPANCY_STATUSES
  const groups: DocBundleGroup[] = ordered.map(l => {
    const rows: DocBundleRow[] = []

    // 계약서는 **딸린 계약에 없다.** 그 계약의 종이는 부모 한 장이고 합본이 추가 호실을 이미 싣는다
    // (계약서 파일 칸의 extraLeases 와 문자 그대로 같은 규칙, 발급 자체도 서버가 막는다).
    if (!l.parentLeaseTermId) rows.push(row('contract', l.id, latestFor(contracts, l.id)))

    const rent = latestFor(rents, l.id)
    rows.push(row('rent', l.id, rent, rent ? staleNote(rent.at) : null))

    // 보증금 영수증은 보증금이 있는 계약만. 이미 발급된 건이 있으면 계약이 0원이 됐어도 남긴다 —
    // 존재하는 종이를 발송 화면에서 감추면 보낼 길이 사라진다.
    const deposit = latestFor(deposits, l.id)
    if (l.depositAmount > 0 || deposit) rows.push(row('deposit', l.id, deposit))

    // 실거주 확인서는 거주 계약만이다 — 실거주 사실이 없는 계약의 확인서는 존재해선 안 된다.
    // 다만 이미 발급된 건이 있으면 그것도 사실이라 행으로 세운다(보증금과 같은 이유).
    const cert = latestFor(certs, l.id)
    if (residing.includes(l.status) || cert) rows.push(row('residence', l.id, cert))

    return { kind: 'lease' as const, leaseTermId: l.id, roomNo: l.room?.roomNo ?? null, status: l.status, rows }
  })

  // 위 계약들에 걸리지 않은 보관본 — 계약 연결이 끊긴 옛 파일(null)과 끝난 계약의 발급본.
  // 어느 계약의 것인지 단정하지 않고 중립 그룹에 세운다. 파일이 있는 것만 담는다(작성 왕복 없음).
  const shown = new Set(ordered.map(l => l.id))
  const orphan = (files: FileRow[]): FileRow | undefined => files.find(f => !f.leaseTermId || !shown.has(f.leaseTermId))
  const otherRows: DocBundleRow[] = []
  const pushOther = (docType: DocBundleDocType, f: FileRow | undefined) => {
    if (!f) return
    otherRows.push({
      key: `other-${docType}`,
      docType,
      leaseTermId: null,
      driveFileId: f.driveFileId,
      issuedAt: f.at.toISOString(),
      note: [f.note, f.leaseTermId ? '지난 계약' : '계약 표시 없음'].filter(Boolean).join(' · '),
    })
  }
  pushOther('contract', orphan(contracts))
  pushOther('rent', orphan(rents))
  pushOther('deposit', orphan(deposits))
  pushOther('residence', orphan(certs))
  if (otherRows.length > 0) {
    groups.push({ kind: 'other', leaseTermId: null, roomNo: null, status: null, rows: otherRows })
  }

  return { tenantName: tenant.name, groups }
}
