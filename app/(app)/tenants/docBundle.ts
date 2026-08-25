'use server'

// 입주자 한 사람의 '서류 보내기' 후보 조회 — 행 규칙은 lib/docBundle 정본이 정하고 여기는 읽어 넘긴다.
// 규칙과 조회를 가른 이유는 실데이터 대조·회귀 케이스가 화면과 같은 함수를 통과하게 하려는 것이다.
//
// 조회 범위 — 이 영업장, 이 사람, deletedAt null. 발급 대상 상태(CONTRACT_ISSUE_STATUSES)의 계약만
// 연다(투어 단계 계약에는 뽑을 종이가 없다). 파일은 종류마다 최신순으로 넘기고 정본이 계약별 최신을 고른다.

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { CONTRACT_ISSUE_STATUSES } from '@/lib/leaseStatus'
import {
  buildDocBundle, DOC_TYPE_FILE_LABEL, DOC_TYPE_TITLE,
  type DocBundleFile, type TenantDocBundle,
} from '@/lib/docBundle'
import { currentIssueIds } from '@/lib/contractCurrentIssue'
import { downloadDriveBytes } from '@/lib/google-drive'
import { shareFileNames } from '@/lib/docShareQueue'
import { isMailConfigured, sendMail, MAIL_MAX_TOTAL_BYTES } from '@/lib/mailSend'
import { fmtDateDot } from '@/lib/fmtDate'
import { docMailSubject, docMailText } from '@/lib/docMail'

// 한 번에 보낼 수 있는 건수 — 시트의 선택 상한과 같은 숫자다. 메일은 브라우저 다중 공유의
// 10개 하드 리밋과 무관하지만, 두 경로가 다른 수를 말하면 화면이 거짓말을 하게 된다.
const MAIL_MAX_DOCS = 10

/** 메일로 보내기가 이 화면에서 가능한지 — 켜짐 여부와 프리필 주소. 주소는 이 사람 것 하나뿐이다. */
export type TenantDocBundleMail = { enabled: boolean; to: string | null }

export async function getTenantDocBundle(
  tenantId: string,
): Promise<(TenantDocBundle & { mail: TenantDocBundleMail }) | null> {
  const { propertyId } = await requirePropertyAccess()
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, propertyId },
    select: { name: true, email: true },
  })
  if (!tenant) return null

  const [leases, contractRows, receiptRows, certRows] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { tenantId, propertyId, status: { in: CONTRACT_ISSUE_STATUSES } },
      select: {
        id: true, status: true, moveInDate: true, depositAmount: true, parentLeaseTermId: true,
        room: { select: { roomNo: true } },
      },
    }),
    prisma.contractFile.findMany({
      where: { tenantId, propertyId, deletedAt: null, driveFileId: { not: '' } },
      orderBy: [{ createdAt: 'desc' }],
      // 폐기본·구버전·파생 판본을 가리려면 판정 축을 함께 읽어야 한다. 종전에는 voidedAt 을
      // select 조차 안 해서 **폐기된 계약서가 그 사람의 계약서로 발송 후보에 올랐다.**
      select: {
        id: true, driveFileId: true, leaseTermId: true, signedAt: true, source: true,
        createdAt: true, voidedAt: true, supersededAt: true, issuePurpose: true,
      },
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

  const representativeIds = new Set(currentIssueIds(contractRows).values())

  const receipt = (kind: 'rent' | 'deposit'): DocBundleFile[] => receiptRows
    .filter(r => (kind === 'deposit' ? r.kind === 'deposit' : r.kind !== 'deposit'))
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null }))

  return withMail(buildDocBundle({
    tenantName: tenant.name,
    leases: leases.map(l => ({
      id: l.id, status: l.status, moveInDate: l.moveInDate, depositAmount: l.depositAmount,
      parentLeaseTermId: l.parentLeaseTermId, roomNo: l.room?.roomNo ?? null,
    })),
    // 계약서 행은 **대표 한 부**만 후보다(lib/contractCurrentIssue 정본). 폐기본을 보내는 일도,
    // 제출용·번역본이 실계약 자리에 서는 일도 여기서 막힌다. 화면 둘과 같은 판정을 쓴다.
    contracts: contractRows.filter(r => representativeIds.has(r.id)).map(r => ({
      driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.signedAt,
      note: r.source === 'UPLOADED' ? '스캔본' : null,
    })),
    rents: receipt('rent'),
    deposits: receipt('deposit'),
    certs: certRows.map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null })),
    now: new Date(),
  }), tenant.email)
}

/** 규칙 정본이 만든 묶음에 메일 정보만 얹는다 — lib/docBundle 은 발송을 모른다(순수 규칙). */
function withMail(bundle: TenantDocBundle, email: string | null): TenantDocBundle & { mail: TenantDocBundleMail } {
  return { ...bundle, mail: { enabled: isMailConfigured(), to: email?.trim() || null } }
}

/**
 * 메일 보내기가 켜져 있는가 — 서류 보내기 진입점이 이 답으로 자기를 그릴지 정한다.
 *
 * 화면이 환경변수를 직접 볼 방법은 없다. NEXT_PUBLIC_ 로 내보내면 키의 존재 여부가 아니라
 * 키 자체를 내보내게 되는 자리라, 켜짐 여부만 서버가 답한다. DB 는 안 본다.
 */
export async function getDocMailEnabled(): Promise<boolean> {
  await requirePropertyAccess()
  return isMailConfigured()
}

/**
 * 고른 서류를 메일 한 통으로 보낸다(신고 44501308 2단계).
 *
 * **클라이언트가 Drive 파일 ID 를 고르지 않는다.** 화면이 넘기는 것은 행 키(docType:leaseTermId)뿐이고,
 * 서버가 후보 조회를 다시 돌려 그 키가 지금 이 사람의 후보에 서 있을 때만 파일로 바꾼다. 임의 ID 를
 * 끼워 넣을 자리가 아예 없어야 멀티테넌트에서 남의 서류가 새지 않는다(/api/biz-cert 와 같은 판정).
 *
 * 받는 주소도 화면이 정하지 않는다. 저장된 이 사람의 메일 주소 하나로만 나간다 — 그 자리에서
 * 주소를 고쳐 보낼 수 있게 하면 오타 한 글자가 곧 남의 사서함에 신원번호를 배달하는 길이 된다.
 * 주소를 바꿔야 하면 입주자 정보에서 고치고 다시 연다(고친 사실이 기록에 남는 길이기도 하다).
 *
 * all-or-nothing 이다 — 첨부 하나라도 못 받으면 아무것도 보내지 않는다. 보낸 뒤에 빠진 것을
 * 알아채면 되돌릴 방법이 없다(클라이언트 공유 경로 lib/useDocShare 와 같은 정책).
 */
export async function sendTenantDocBundleMail(
  tenantId: string, keys: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { propertyId, email: operatorEmail } = await requirePropertyAccess()

  const bundle = await getTenantDocBundle(tenantId)
  if (!bundle) return { ok: false, error: '입주자를 찾을 수 없습니다.' }
  if (!bundle.mail.enabled) return { ok: false, error: '메일 보내기가 켜져 있지 않습니다.' }
  if (!bundle.mail.to) return { ok: false, error: '입주자의 메일 주소가 없습니다. 입주자 정보에 먼저 넣어 주세요.' }

  const wanted = new Set(keys)
  const rows = bundle.groups.flatMap(g => g.rows).filter(r => r.driveFileId && wanted.has(r.key))
  if (rows.length === 0) return { ok: false, error: '보낼 서류를 고르지 않았습니다.' }
  if (rows.length > MAIL_MAX_DOCS) return { ok: false, error: `한 번에 최대 ${MAIL_MAX_DOCS}건까지 보낼 수 있습니다.` }

  // 파일명은 공유 경로와 **같은 정본**이다 — 같은 서류가 어디로 나가든 같은 이름으로 도착해야 한다.
  const entries = rows.map(r => ({
    personName: bundle.tenantName, docLabel: DOC_TYPE_FILE_LABEL[r.docType], dateStr: fmtDateDot(r.issuedAt),
  }))
  const names = shareFileNames(entries, rows.map(() => 1), 'pdf')

  let bytesList: Buffer[]
  try {
    bytesList = await Promise.all(rows.map(r => downloadDriveBytes(r.driveFileId as string)))
  } catch {
    // 사유를 그대로 올리지 않는다 — Drive 오류 문자열에 파일 이름(이름이 들어간다)이 섞인다.
    return { ok: false, error: '서류를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  const total = bytesList.reduce((s, b) => s + b.byteLength, 0)
  if (total > MAIL_MAX_TOTAL_BYTES) {
    return { ok: false, error: '첨부 용량이 커서 한 번에 보낼 수 없습니다. 몇 건을 빼고 보내 주세요.' }
  }

  const property = await prisma.property.findUnique({
    where: { id: propertyId }, select: { name: true, phone: true },
  })
  const propertyName = property?.name ?? '스테이음'
  const docTitles = rows.map(r => DOC_TYPE_TITLE[r.docType])

  const outcome = await sendMail({
    to: bundle.mail.to,
    fromName: propertyName,
    replyTo: operatorEmail ?? undefined,
    subject: docMailSubject(propertyName),
    text: docMailText(propertyName, docTitles, property?.phone ?? null),
    attachments: bytesList.map((b, i) => ({
      filename: names[i], bytes: new Uint8Array(b), contentType: 'application/pdf',
    })),
  })

  if (outcome.result === 'sent') return { ok: true, count: rows.length }
  if (outcome.result === 'staging') return { ok: false, error: '테스트 사이트에서는 메일을 보내지 않습니다.' }
  if (outcome.result === 'disabled') return { ok: false, error: '메일 보내기가 켜져 있지 않습니다.' }
  return { ok: false, error: outcome.reason }
}
