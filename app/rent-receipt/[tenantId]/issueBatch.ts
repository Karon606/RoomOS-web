// 입실료 납부 확인서 여러 달 묶음 발급의 본체(서버 전용, 'use server' 아님) — 고른 귀속월마다 한 장씩,
// 한 장 발급 정본 경로(lib/rentReceiptIssue issueRentReceiptsInTx)를 그대로 지난다(한 장은 길이 1 인 묶음).
//
// 종이 칸은 서버가 달마다 자동값(getRentReceiptData)으로 채운다. 화면이 칸을 실어 보내면 달마다 다른 금액·기간을
// 화면이 지어내야 하고, 고친 값을 받으면 한 달 화면과 갈린다. 화면이 정하는 것은 이름 표기와 달마다의 발행일뿐이다.
// 고를 수 있는 달은 실입금이 있는 귀속월(lib/rentReceiptMonths 정본)이고, 하나라도 어긋나면 한 장도 안 낸다(한 트랜잭션).
//
// 관문(로그인·편집 권한)은 부르는 API 라우트가 지난다. 여기서는 영업장 범위를 진다 — 사람·계약을 그 영업장 안에서만 찾는다.
import prisma from '@/lib/prisma'
import { getRentReceiptData } from './actions'
import { asDocNameStyle, documentName } from '@/lib/documentName'
import { batchRequestError, autoFormFields, type RentReceiptIssueRow, type RentReceiptIssueUndo } from '@/lib/rentReceiptMonths'
import {
  loadRentReceiptIssueContext, issueRentReceiptsInTx, trashUploaded, signRentReceiptUndo,
  receiptRequestTag, rentReceiptIssueErrorMessage,
} from '@/lib/rentReceiptIssue'
import type { RentReceiptFields } from '@/lib/rentReceiptPdf'

export type RentReceiptBatchBody = {
  tenantId: string
  /** 계약 지목 — 묶음은 반드시 한 계약이다(어느 계약의 달인지 모르면 발급하지 않는다). */
  leaseTermId: string
  nameStyle?: 'ko' | 'en' | 'native' | null
  /** 화면에서 고친 수령인 성명. 비우면 표기 정본으로 짓는다. */
  name?: string
  /** 화면에서 고친 임대인 대표 성명. 비우면 자동값. */
  recipientName?: string
  months: { month: string; issueDate: string }[]
  /** 화면이 누를 때마다 정하는 요청 id — 응답 유실 뒤 같은 요청이 다시 오면 앞서 낸 묶음을 돌려준다. */
  requestId?: string
}

export type RentReceiptBatchResult =
  | { ok: true; files: Omit<RentReceiptIssueRow, 'kind' | 'tenantId' | 'leaseTermId' | 'nameStyle'>[]; undo: RentReceiptIssueUndo | null }
  | { ok: false; error: string; status: number }

/**
 * deadlineAt — 이 요청이 끝나야 하는 시각(ms). 함수 시간 상한에 잘리면 catch 가 안 돌아 올린 파일이 고아로 남는다.
 * 트랜잭션 시간 제한을 남은 시간보다 5초 짧게 잡아, 늦으면 함수가 잘리기 전에 트랜잭션이 먼저 실패하고 정리가 돈다.
 */
export async function issueRentReceiptBatch(propertyId: string, body: RentReceiptBatchBody, deadlineAt = Date.now() + 55_000): Promise<RentReceiptBatchResult> {
  if (!body?.tenantId || !body.leaseTermId || !Array.isArray(body.months)) {
    return { ok: false, status: 400, error: '필수 데이터 누락' }
  }
  const picks = body.months.map(m => ({ month: String(m?.month ?? ''), issueDate: String(m?.issueDate ?? '') }))

  // 이 영업장의 이 사람·이 계약인가 — getRentReceiptData 가 영업장 범위로 사람을 찾고, 계약 지목이 그 사람의
  // 발급 대상일 때만 그 계약을 고른다. 고른 계약이 지목과 다르면(남의 계약 id) 거절한다.
  const base = await getRentReceiptData(body.tenantId, picks[0]?.month, 'rent', body.leaseTermId)
  if (!base || base.leaseTermId !== body.leaseTermId) {
    return { ok: false, status: 404, error: '계약을 찾을 수 없습니다.' }
  }
  if (base.isShortTerm) {
    return { ok: false, status: 400, error: '단기 계약은 입주월 한 달만 발급합니다.' }
  }
  const invalid = batchRequestError(picks, base.issuable)
  if (invalid) return { ok: false, status: 400, error: invalid }

  const tenant = await prisma.tenant.findFirst({ where: { id: body.tenantId, propertyId }, select: { id: true, name: true } })
  if (!tenant) return { ok: false, status: 404, error: '입실자를 찾을 수 없습니다.' }

  const nameStyle = asDocNameStyle(body.nameStyle) ?? null
  const typedName = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  const name = typedName || documentName({ name: base.name, englishName: base.englishName, nativeName: base.nativeName }, nameStyle)
  const typedRecipient = typeof body.recipientName === 'string' ? body.recipientName.trim().slice(0, 60) : ''

  // 달마다 자동값 — 한 달 화면이 그 달을 열 때와 같은 함수다.
  const perMonth: { month: string; fields: RentReceiptFields }[] = []
  for (const p of picks) {
    const data = p.month === base.anchorMonth ? base : await getRentReceiptData(body.tenantId, p.month, 'rent', body.leaseTermId)
    if (!data || data.leaseTermId !== body.leaseTermId || data.anchorMonth !== p.month) {
      return { ok: false, status: 400, error: `${p.month} 자동값을 만들지 못했습니다.` }
    }
    const auto = autoFormFields(data, name)
    perMonth.push({
      month: p.month,
      fields: {
        ...auto,
        recipientName: typedRecipient || auto.recipientName,
        issueDate: p.issueDate, kind: 'rent' as const, preResidence: false, nonResident: data.nonResident,
      },
    })
  }

  const loaded = await loadRentReceiptIssueContext(propertyId)
  if (!loaded.ok) return { ok: false, status: loaded.status, error: loaded.error }

  // 한 트랜잭션 — 발행번호가 차례로 붙고, 한 장이라도 실패하면 전부 되감는다(올린 파일은 휴지통으로).
  const uploaded: string[] = []
  let rows: RentReceiptIssueRow[]
  try {
    const timeout = Math.max(5_000, Math.min(50_000, deadlineAt - Date.now() - 5_000))
    rows = await prisma.$transaction(tx => issueRentReceiptsInTx(tx, loaded.ctx, perMonth.map(m => ({
      tenantId: tenant.id, tenantName: tenant.name, leaseTermId: body.leaseTermId,
      fields: m.fields, nameStyle, targetMonth: m.month,
    // maxWait 를 따로 준다. 기본 2초는 연결이 바쁠 때 트랜잭션을 열지도 못하고 P2028 로 떨어진다(시험이 부하에서 들쭉날쭉 실패한 원인).
    })), uploaded, receiptRequestTag(body.requestId)), { timeout, maxWait: 10_000 })
  } catch (err) {
    await trashUploaded(uploaded)
    const msg = rentReceiptIssueErrorMessage(err)
    if (msg) return { ok: false, status: 409, error: msg }
    throw err
  }

  return {
    ok: true,
    files: rows.map(r => ({
      id: r.id, driveFileId: r.driveFileId, fileName: r.fileName, issuedAt: r.issuedAt,
      targetMonth: r.targetMonth, receiptNo: r.receiptNo,
    })),
    undo: signRentReceiptUndo(propertyId, rows),
  }
}
