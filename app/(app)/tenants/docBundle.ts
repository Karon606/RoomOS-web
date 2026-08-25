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
import { downloadDriveBytes, driveFileSize } from '@/lib/google-drive'
import { shareFileNames } from '@/lib/docShareQueue'
import { isMailConfigured, sendMail, MAIL_MAX_TOTAL_BYTES } from '@/lib/mailSend'
import { fmtDateDot } from '@/lib/fmtDate'
import {
  parseDocMailTemplate, renderDocMail, renderDocMailBodyPrefill, DOC_MAIL_LIMITS, type DocMailTemplate,
} from '@/lib/docMail'

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
 * 메일 확인 화면(컴포즈)의 초안 — 받는사람·보내는사람·답장 후보·제목·본문·첨부 목록·미리보기.
 *
 * 제목·본문은 **치환이 끝난 최종 문장**으로 내린다. 운영자가 확인 화면에서 보는 글자가 곧
 * 나가는 글자여야 하고(신고 원문: "어떤 내용이 발송되는지 확인하고 최종 결정"), 수정본은
 * 발송 draft 로만 쓰여 그 한 통에만 적용된다(저장 안 됨 — 저장 자리는 환경설정 하나).
 *
 * 문안이 직접 HTML 모드면 본문 편집을 잠근다(htmlLocked) — 모바일에서 HTML 원문을 만지다
 * 사고 나기 좋고, 클라이언트가 HTML 을 서버로 보내는 금지 축이 열린다. 미리보기로만 보여준다.
 */
export type TenantDocMailDraftInfo = {
  to: string
  tenantName: string
  /** 표시용 발신 — 주소는 도메인 인증 때문에 no-reply@stayeum.com 고정(lib/mailSend). */
  fromName: string
  fromAddress: string
  /** 답장 후보 열거 — 이 밖의 주소로는 보낼 수 없다(자유 입력 금지). */
  replyToOptions: { email: string; kind: 'property' | 'login' }[]
  replyToDefault: string
  subject: string
  bodyText: string
  /** 문안이 직접 HTML 모드 — 본문 편집을 잠그고 미리보기만 보여준다. */
  htmlLocked: boolean
  attachments: { name: string; size: number | null }[]
  /** 알려진 크기의 합 — 안내용. 실제 상한은 발송 직전 다운로드 합산이 다시 지킨다. */
  totalBytes: number
  maxBytes: number
  previewHtml: string
}

/** 세 액션(초안·미리보기·발송)이 같은 해석을 지나게 하는 내부 헬퍼 — 키 검증·파일명·문안까지. */
async function resolveDocMailContext(tenantId: string, keys: string[]) {
  const { propertyId, email: operatorEmail } = await requirePropertyAccess()

  const bundle = await getTenantDocBundle(tenantId)
  if (!bundle) return { ok: false as const, error: '입주자를 찾을 수 없습니다.' }
  if (!bundle.mail.enabled) return { ok: false as const, error: '메일 보내기가 켜져 있지 않습니다.' }
  if (!bundle.mail.to) return { ok: false as const, error: '입주자의 메일 주소가 없습니다. 입주자 정보에 먼저 넣어 주세요.' }

  const wanted = new Set(keys)
  const rows = bundle.groups.flatMap(g => g.rows).filter(r => r.driveFileId && wanted.has(r.key))
  if (rows.length === 0) return { ok: false as const, error: '보낼 서류를 고르지 않았습니다.' }
  if (rows.length > MAIL_MAX_DOCS) return { ok: false as const, error: `한 번에 최대 ${MAIL_MAX_DOCS}건까지 보낼 수 있습니다.` }

  // 파일명은 공유 경로와 **같은 정본**이다 — 같은 서류가 어디로 나가든 같은 이름으로 도착해야 한다.
  const entries = rows.map(r => ({
    personName: bundle.tenantName, docLabel: DOC_TYPE_FILE_LABEL[r.docType], dateStr: fmtDateDot(r.issuedAt),
  }))
  const names = shareFileNames(entries, rows.map(() => 1), 'pdf')

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { name: true, phone: true, replyToEmail: true, docMailTemplate: true },
  })
  const propertyName = property?.name ?? '스테이음'
  const tpl = parseDocMailTemplate(property?.docMailTemplate)

  // 답장 후보 열거 — 영업장 메일(환경설정) + 보낸 운영자의 로그인 주소. 이 밖은 없다.
  const replyToOptions: { email: string; kind: 'property' | 'login' }[] = []
  const propReply = property?.replyToEmail?.trim() || null
  if (propReply) replyToOptions.push({ email: propReply, kind: 'property' })
  if (operatorEmail && operatorEmail !== propReply) replyToOptions.push({ email: operatorEmail, kind: 'login' })

  return {
    ok: true as const,
    propertyId, operatorEmail,
    bundle, rows, names,
    docTitles: rows.map(r => DOC_TYPE_TITLE[r.docType]),
    propertyName, propertyPhone: property?.phone ?? null, tpl,
    replyToOptions,
    replyToDefault: propReply ?? operatorEmail ?? '',
  }
}

/** 초안 조회 — 컴포즈 화면이 열릴 때 한 번. */
export async function getTenantDocMailDraft(
  tenantId: string, keys: string[],
): Promise<{ ok: true; draft: TenantDocMailDraftInfo } | { ok: false; error: string }> {
  const ctx = await resolveDocMailContext(tenantId, keys)
  if (!ctx.ok) return ctx

  // 크기는 안내용이라 병렬 조회하고, 못 읽은 파일은 null 로 둔다(발송 직전 합산이 실상한).
  const sizes = await Promise.all(ctx.rows.map(r => driveFileSize(r.driveFileId as string)))
  const data = {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: ctx.names,
  }
  const rendered = renderDocMail(ctx.tpl, data)
  // 본문 칸 프리필 — 텍스트 모드의 본문 블록(치환 완료). 맺음말·첨부 상자는 프레임 몫이라
  // 미리보기로 확인한다. HTML 모드는 편집을 잠그므로 빈 문자열을 내린다.
  const bodyPrefill = renderDocMailBodyPrefill(ctx.tpl, data)

  return {
    ok: true,
    draft: {
      to: ctx.bundle.mail.to as string,
      tenantName: ctx.bundle.tenantName,
      fromName: ctx.propertyName,
      fromAddress: 'no-reply@stayeum.com',
      replyToOptions: ctx.replyToOptions,
      replyToDefault: ctx.replyToDefault,
      subject: rendered.subject,
      bodyText: bodyPrefill,
      htmlLocked: ctx.tpl.mode === 'html',
      attachments: ctx.names.map((name, i) => ({ name, size: sizes[i] })),
      totalBytes: sizes.reduce<number>((s, n) => s + (n ?? 0), 0),
      maxBytes: MAIL_MAX_TOTAL_BYTES,
      previewHtml: rendered.html,
    },
  }
}

/** 편집 반영 미리보기 — 발송과 같은 renderDocMail 하나가 만든다(거짓말 불가 원칙). */
export async function previewTenantDocMail(
  tenantId: string, keys: string[], edit: { subject: string; bodyText: string },
): Promise<{ ok: true; subject: string; html: string } | { ok: false; error: string }> {
  const ctx = await resolveDocMailContext(tenantId, keys)
  if (!ctx.ok) return ctx
  const tpl = applyDraftToTemplate(ctx.tpl, edit)
  const rendered = renderDocMail(tpl, {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: ctx.names,
  })
  return { ok: true, subject: rendered.subject, html: rendered.html }
}

/** 발송 직전 1회성 수정을 문안에 얹는다 — HTML 모드는 제목만 받는다(본문 편집 잠금). */
function applyDraftToTemplate(
  tpl: DocMailTemplate, edit: { subject: string; bodyText: string },
): DocMailTemplate {
  const subject = edit.subject.slice(0, DOC_MAIL_LIMITS.subject)
  if (tpl.mode === 'html') return { ...tpl, subject }
  // 확인 화면의 본문 칸이 곧 본문 블록이다 — 치환 완료 문장이 그대로 들어간다(재치환은 무해:
  // 남은 변수 표기가 있으면 값으로 바뀌는 것뿐이다). 맺음말은 문안 설정을 따른다.
  return { ...tpl, subject, bodyText: edit.bodyText.slice(0, DOC_MAIL_LIMITS.bodyText) }
}

/**
 * 고른 서류를 메일 한 통으로 보낸다(신고 44501308 2단계, 확인 화면 경유 2026-08-25).
 *
 * **클라이언트가 Drive 파일 ID 를 고르지 않는다.** 화면이 넘기는 것은 행 키(docType:leaseTermId)와
 * 텍스트 draft 뿐이고, 서버가 후보 조회를 다시 돌려 그 키가 지금 이 사람의 후보에 서 있을 때만
 * 파일로 바꾼다. 임의 ID 를 끼워 넣을 자리가 아예 없어야 멀티테넌트에서 남의 서류가 새지 않는다.
 *
 * 받는 주소도 화면이 정하지 않는다. 저장된 이 사람의 메일 주소 하나로만 나간다 — 그 자리에서
 * 주소를 고쳐 보낼 수 있게 하면 오타 한 글자가 곧 남의 사서함에 신원번호를 배달하는 길이 된다.
 * 답장 주소도 열거(영업장 메일·로그인 주소) 밖이면 거절한다 — 같은 이유다.
 *
 * draft 는 확인 화면의 1회성 수정(제목·본문·답장 주소)이고 저장되지 않는다. 안 넘어오면
 * 문안 설정 그대로 나간다(옛 화면 호환). HTML 은 어떤 경로로도 클라이언트에서 오지 않는다 —
 * 서버가 DB 문안에서만 읽는다.
 *
 * all-or-nothing 이다 — 첨부 하나라도 못 받으면 아무것도 보내지 않는다. 보낸 뒤에 빠진 것을
 * 알아채면 되돌릴 방법이 없다(클라이언트 공유 경로 lib/useDocShare 와 같은 정책).
 */
export async function sendTenantDocBundleMail(
  tenantId: string, keys: string[],
  draft?: { subject: string; bodyText: string; replyTo: string },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const ctx = await resolveDocMailContext(tenantId, keys)
  if (!ctx.ok) return ctx

  // 답장 주소 — 열거 검증. draft 없이 오면(옛 화면) 기본값.
  let replyTo = ctx.replyToDefault || undefined
  if (draft) {
    if (draft.subject.trim() === '') return { ok: false, error: '제목을 입력해 주세요.' }
    if (ctx.tpl.mode !== 'html' && draft.bodyText.trim() === '') return { ok: false, error: '본문을 입력해 주세요.' }
    const allowed = ctx.replyToOptions.map(o => o.email)
    if (!allowed.includes(draft.replyTo)) return { ok: false, error: '답장 주소가 올바르지 않습니다. 화면을 닫고 다시 열어 주세요.' }
    replyTo = draft.replyTo
  }

  let bytesList: Buffer[]
  try {
    bytesList = await Promise.all(ctx.rows.map(r => downloadDriveBytes(r.driveFileId as string)))
  } catch {
    // 사유를 그대로 올리지 않는다 — Drive 오류 문자열에 파일 이름(이름이 들어간다)이 섞인다.
    return { ok: false, error: '서류를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  const total = bytesList.reduce((s, b) => s + b.byteLength, 0)
  if (total > MAIL_MAX_TOTAL_BYTES) {
    return { ok: false, error: '첨부 용량이 커서 한 번에 보낼 수 없습니다. 몇 건을 빼고 보내 주세요.' }
  }

  const tpl = draft ? applyDraftToTemplate(ctx.tpl, draft) : ctx.tpl
  const rendered = renderDocMail(tpl, {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: ctx.names,
  })

  const outcome = await sendMail({
    to: ctx.bundle.mail.to as string,
    fromName: ctx.propertyName,
    replyTo,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: bytesList.map((b, i) => ({
      filename: ctx.names[i], bytes: new Uint8Array(b), contentType: 'application/pdf',
    })),
  })

  if (outcome.result === 'sent') {
    // 발송 이력 — "보냈다/안 받았다"의 근거(운영자 승인 2026-08-25). 메일은 이미 나갔으므로
    // 기록 실패가 결과를 뒤집으면 안 된다(기록만 조용히 놓치고 발송은 성공으로 답한다).
    try {
      await prisma.mailLog.create({
        data: {
          propertyId: ctx.propertyId,
          tenantId,
          toEmail: ctx.bundle.mail.to as string,
          replyTo: replyTo ?? null,
          subject: rendered.subject,
          docTitles: ctx.docTitles.join(' · '),
          attachmentNames: ctx.names,
          attachmentCount: ctx.rows.length,
          totalBytes: total,
          resendId: outcome.id,
          sentBy: ctx.operatorEmail ?? null,
        },
      })
    } catch {
      console.error('[docMail] 발송 이력 기록 실패 — 발송 자체는 성공')
    }
    return { ok: true, count: ctx.rows.length }
  }
  if (outcome.result === 'staging') return { ok: false, error: '테스트 사이트에서는 메일을 보내지 않습니다.' }
  if (outcome.result === 'disabled') return { ok: false, error: '메일 보내기가 켜져 있지 않습니다.' }
  return { ok: false, error: outcome.reason }
}
