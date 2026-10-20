// 납부 확인서·보증금 영수증 한 장 발급의 정본 경로(서버 전용) — 채번·PDF·Drive 업로드·발급 이력 저장.
//
// 한 장 발급(/api/rent-receipt/generate)과 여러 달 묶음 발급(/api/rent-receipt/generate-batch)이 issueRentReceiptsInTx 하나를
// 지난다(2026-10-20, 운영자 승인 '기존 한 장 발급 정본 경로를 달마다 재사용'). 묶음이 제 채번·저장을 따로 두면
// 발행번호 규칙이나 귀속월 기록이 한쪽만 고쳐지는 날이 온다. 그물 scripts/check-rent-receipt-batch-wiring.mjs.
import prisma from '@/lib/prisma'
import { uploadToDrive, downloadDriveBytes, trashInDrive } from '@/lib/google-drive'
import { buildRentReceiptPdf, type RentReceiptFields } from '@/lib/rentReceiptPdf'
import { ymdToDbDate } from '@/lib/kstDate'
import { signUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import {
  RENT_RECEIPT_UNDO_DOMAIN, canonicalRentReceiptUndo,
  type RentReceiptIssueRow, type RentReceiptIssueUndo,
} from '@/lib/rentReceiptMonths'

/** 영업장 머리말·도장·로고 — 한 번 읽어 여러 장에 쓴다. */
export type RentReceiptIssueContext = {
  propertyId: string
  businessName: string
  bizLine1: string
  bizLine2: string
  logoBytes: Uint8Array | null
  stampBytes: Uint8Array | null
}

/** 영업장 머리말과 도장·로고를 읽는다. 도장을 못 읽으면 발급하지 않는다(인감 누락은 무효 주장의 빌미). */
export async function loadRentReceiptIssueContext(
  propertyId: string,
): Promise<{ ok: true; ctx: RentReceiptIssueContext } | { ok: false; error: string; status: number }> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { name: true, phone: true, businessInfo: true, stampDriveFileId: true, logoDriveFileId: true },
  })
  let stampBytes: Uint8Array | null = null
  if (property?.stampDriveFileId) {
    // 인감 누락은 법적 서류에서 무효 주장의 빌미다. 조용히 삼키지 않는다(E페이즈 2026-08-03).
    try { stampBytes = new Uint8Array(await downloadDriveBytes(property.stampDriveFileId)) } catch (e) {
      console.error('[rent-receipt] 도장 내려받기 실패', e)
      return { ok: false, status: 502, error: '도장 이미지를 불러오지 못했습니다. 잠시 후 다시 시도하거나 설정에서 도장을 다시 등록해 주세요.' }
    }
  }
  let logoBytes: Uint8Array | null = null
  if (property?.logoDriveFileId) {
    try { logoBytes = new Uint8Array(await downloadDriveBytes(property.logoDriveFileId)) } catch { logoBytes = null }
  }
  // 브랜드 헤더 — 영업장 사업자 정보 (v2.0 §26)
  const biz = (property?.businessInfo as { name?: string; registrationNo?: string; ceoName?: string; address?: string } | null) ?? {}
  return {
    ok: true,
    ctx: {
      propertyId,
      businessName: biz.name || property?.name || '',
      bizLine1: [biz.registrationNo ? `사업자등록번호 ${biz.registrationNo}` : null, biz.ceoName ? `대표 ${biz.ceoName}` : null].filter(Boolean).join(' · '),
      bizLine2: [biz.address, property?.phone ? `T. ${property.phone}` : null].filter(Boolean).join(' · '),
      logoBytes,
      stampBytes,
    },
  }
}

/** 미리보기 바이트 — 번호를 찍지 않는다(소비되지 않은 번호가 종이로 나가지 않게, E페이즈 2026-08-03). */
export async function buildRentReceiptPreview(ctx: RentReceiptIssueContext, fields: RentReceiptFields): Promise<Uint8Array> {
  return buildRentReceiptPdf(fields, { businessName: ctx.businessName, bizLine1: ctx.bizLine1, bizLine2: ctx.bizLine2, receiptNo: '미리보기' }, ctx.logoBytes, ctx.stampBytes)
}

export type RentReceiptIssueInput = {
  tenantId: string
  /** 파일 이름에 쓰는 고객 정보의 이름(표기 적용 전). */
  tenantName: string
  /** 이 영업장의 계약으로 확인된 id. 확인 못 했으면 null. */
  leaseTermId: string | null
  fields: RentReceiptFields
  nameStyle: string | null
  /** 귀속월 'YYYY-MM'. rent 만 적는다. 형식이 어긋나면 안 적는다. */
  targetMonth: string | null
}

/** 발급 정본이 쓰는 DB 면 — 발급 이력 모델과 영업장 줄 세우기(advisory lock) 하나. */
export type RentReceiptIssueDb = Pick<typeof prisma, 'rentReceiptFile' | '$executeRaw'>

const ISSUED_SELECT = {
  id: true, driveFileId: true, fileName: true, receiptNo: true, issuedAt: true, kind: true,
  targetMonth: true, tenantId: true, leaseTermId: true, nameStyle: true,
} as const

/**
 * 요청 id 를 파일 이름 꼬리 표식으로. 같은 요청이 다시 오면(응답 유실 뒤 재클릭) 이 표식으로 앞서 낸 장을 찾아 그대로 돌려준다.
 * 화면이 안 실으면 그때그때 새 표식이라 종전처럼 매번 새로 낸다. 영숫자만 남기고 12자로 자른다.
 */
export function receiptRequestTag(requestId: unknown): string {
  const clean = typeof requestId === 'string' ? requestId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) : ''
  return `q${clean || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`
}

/**
 * 발급 — 부르는 쪽 트랜잭션 안에서 영업장 단위로 줄을 세우고, 장마다 채번·PDF 를 만든 뒤 한꺼번에 올리고 이력을 남긴다.
 * 한 장 발급은 길이 1 인 묶음이다(한 장 라우트와 묶음 본체가 이 함수 하나를 부른다).
 *
 * 줄 세우기(검수 2026-10-20). 번호는 '이 영업장의 번호 있는 행 수 + 1' 이라, 긴 묶음 트랜잭션이 도는 동안 다른 발급이 같은
 * 수를 세어 같은 번호를 냈다(유니크에 막혀 한쪽이 통째로 실패). 첫머리에 영업장 키의 pg_advisory_xact_lock 을 잡아 같은
 * 영업장 발급을 차례로 세운다. 트랜잭션이 끝나면 저절로 풀린다. (propertyId, receiptNo) 유니크는 그대로 최종 방어선이다.
 *
 * 순서. PDF 를 다 그린 뒤 업로드를 한꺼번에(병렬) 하고 마지막에 행을 쓴다. 업로드가 끝날 때까지 행이 없으니, 도중에 함수가
 * 잘려도 DB 에는 반쪽이 안 남는다. 올린 파일 id 는 uploaded 에 쌓여 부르는 쪽이 실패 때 휴지통으로 보낸다.
 *
 * 멱등. 같은 요청 표식(requestTag)의 살아 있는 행이 이미 있으면 새로 만들지 않고 그 행들을 돌려준다. 다만 앞서 낸 행의
 * (사람·계약·종류·귀속월 집합·장수)가 지금 입력과 다르면 같은 표식으로 다른 요청이 온 것이라 거절한다(재검수 2026-10-20:
 * 묶음 id 를 한 장 라우트로 보내거나 달 목록을 바꿔 재전송하면, 대조 없이는 엉뚱한 종이를 '발급됨'으로 돌려준다).
 */
export async function issueRentReceiptsInTx(
  tx: RentReceiptIssueDb,
  ctx: RentReceiptIssueContext,
  inputs: RentReceiptIssueInput[],
  uploaded: string[],
  requestTag: string,
): Promise<RentReceiptIssueRow[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rent-receipt-no:${ctx.propertyId}`}))`
  const prior = await tx.rentReceiptFile.findMany({
    where: { propertyId: ctx.propertyId, deletedAt: null, fileName: { contains: `_${requestTag}-` } },
    orderBy: { fileName: 'asc' },
    select: ISSUED_SELECT,
  })
  if (prior.length > 0) {
    const shape = (xs: { tenantId: string; leaseTermId: string | null; kind: string; targetMonth: string | null }[]) =>
      xs.map(x => `${x.tenantId}|${x.leaseTermId ?? ''}|${x.kind}|${x.targetMonth ?? ''}`).sort().join('\n')
    const want = shape(inputs.map(i => {
      const kind = i.fields.kind === 'deposit' ? 'deposit' : 'rent'
      return { tenantId: i.tenantId, leaseTermId: i.leaseTermId, kind, targetMonth: kind === 'rent' && /^\d{4}-\d{2}$/.test(i.targetMonth ?? '') ? i.targetMonth : null }
    }))
    if (shape(prior) !== want) throw new RentReceiptReplayMismatch()
    return prior.map(r => ({ ...r, issuedAt: r.issuedAt.toISOString() }))
  }

  // 발행번호 = 발행일-발행순서 (영업장별 일련, v2.0 §26). 지운 발급본도 번호를 쥐고 있어 셈에 든다.
  const issued = await tx.rentReceiptFile.count({ where: { propertyId: ctx.propertyId, receiptNo: { not: null } } })
  const drafts = await Promise.all(inputs.map(async (input, i) => {
    const issueDate = input.fields.issueDate
    const receiptKind = input.fields.kind === 'deposit' ? 'deposit' : 'rent'
    const safeTenantName = input.tenantName.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    // 종류 — kind 컬럼이 분류 정본, 파일명 접두는 사람이 파일만 보고도 알아보게 하는 보조 표기
    const docPrefix = receiptKind === 'deposit' ? '보증금영수증' : '입실료납부확인서'
    const fileName = `${docPrefix}_${safeTenantName}_${issueDate.replace(/-/g, '')}_${requestTag}-${String(i + 1).padStart(2, '0')}.pdf`
    const receiptNo = `${issueDate.replace(/-/g, '')}-${String(issued + i + 1).padStart(3, '0')}`
    const pdf = await buildRentReceiptPdf(input.fields, { businessName: ctx.businessName, bizLine1: ctx.bizLine1, bizLine2: ctx.bizLine2, receiptNo }, ctx.logoBytes, ctx.stampBytes)
    return { input, receiptKind, fileName, receiptNo, issueDate, pdf }
  }))
  // 업로드는 한꺼번에 — 묶음 시간의 대부분이 여기다. 끝나는 대로 곧장 uploaded 에 적는다. 모두 끝나길 기다렸다 적으면
  // 그 사이 트랜잭션 시간이 다해 catch 가 돌 때 먼저 끝난 파일이 목록에 없어 고아로 남는다(재검수 2026-10-20).
  const results = await Promise.allSettled(drafts.map(d => uploadToDrive(Buffer.from(d.pdf), d.fileName, 'application/pdf')
    .then(r => { uploaded.push(r.fileId); return r })))
  const failed = results.find(r => r.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason

  const rows: RentReceiptIssueRow[] = []
  for (const [i, d] of drafts.entries()) {
    const row = await tx.rentReceiptFile.create({
      data: {
        propertyId: ctx.propertyId,
        tenantId: d.input.tenantId,
        leaseTermId: d.input.leaseTermId,
        driveFileId: (results[i] as PromiseFulfilledResult<{ fileId: string }>).value.fileId,
        fileName: d.fileName,
        nameStyle: d.input.nameStyle,
        kind: d.receiptKind,
        // 귀속월은 rent 만 — 보증금 영수증은 월 개념이 없다(화면도 스테퍼를 안 그린다).
        // 형식이 어긋나면 안 적는다. 틀린 축이 박히면 stale 판정이 조용히 어긋난다.
        targetMonth: d.receiptKind === 'rent' && /^\d{4}-\d{2}$/.test(d.input.targetMonth ?? '') ? d.input.targetMonth : null,
        receiptNo: d.receiptNo,
        // 발급일은 '날짜'다 — 오프셋 없는 T00:00:00 은 실행 환경 타임존으로 읽혀 KST 기기에서
        // 하루 앞선 값이 박혔다. 저장 정본은 ymdToDbDate(UTC 자정), 읽기는 lib/fmtDate 와 짝.
        issuedAt: ymdToDbDate(d.issueDate),
      },
      select: ISSUED_SELECT,
    })
    rows.push({ ...row, issuedAt: row.issuedAt.toISOString() })
  }
  return rows
}

/** 같은 요청 표식으로 다른 내용이 왔다 — 앞서 낸 장을 돌려주지 않고 거절한다. */
export class RentReceiptReplayMismatch extends Error {
  readonly code = 'RR_REPLAY_MISMATCH'
  constructor() { super('같은 요청으로 다른 내용이 들어와 발급하지 않았습니다. 화면을 새로고침한 뒤 다시 발급해 주세요.'); this.name = 'RentReceiptReplayMismatch' }
}

/**
 * 발급 실패를 화면 문장으로. 모르는 오류는 null(부르는 쪽 기본 문구).
 *   · P2002 발행번호 유니크 충돌
 *   · P2028 트랜잭션 시간 초과 — 영업장 줄 세우기에서 앞 발급을 기다리다 시간이 다한 경우가 대부분이다
 *   · 같은 요청 표식으로 다른 내용(재전송 대조)
 */
export function rentReceiptIssueErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string })?.code
  if (code === 'P2002') return '발행번호가 다른 발급과 겹쳐 발급하지 않았습니다. 잠시 후 다시 발급해 주세요.'
  if (code === 'P2028') return '다른 발급이 진행 중이라 이번 발급은 하지 않았습니다. 잠시 후 다시 발급해 주세요.'
  if (code === 'RR_REPLAY_MISMATCH') return (err as Error).message
  return null
}

/** 트랜잭션이 되감겼을 때 이미 올린 파일을 휴지통으로. 실패는 로그만 남긴다(발급 실패 응답이 먼저다). */
export async function trashUploaded(fileIds: readonly string[]): Promise<void> {
  for (const id of fileIds) {
    try { await trashInDrive(id) } catch (e) { console.error('[rent-receipt] 고아 파일 정리 실패', id, e) }
  }
}

/**
 * 방금 발급한 행들의 적용취소 토큰. 서명 키가 없는 운영 환경이면 null(토큰을 내지 않고 화면이 적용취소를 숨긴다).
 * 개발·하네스는 서명 없이 낸다(signUndoBody 정본 규칙).
 */
export function signRentReceiptUndo(propertyId: string, rows: RentReceiptIssueRow[]): RentReceiptIssueUndo | null {
  const undo: RentReceiptIssueUndo = { v: 1, rows }
  const sig = signUndoBody(RENT_RECEIPT_UNDO_DOMAIN, propertyId, canonicalRentReceiptUndo(undo))
  if (sig === null) return null
  return sig === undefined ? undo : { ...undo, sig }
}
