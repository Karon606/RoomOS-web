'use server'

// 입주자 한 사람의 '서류 보내기' 후보 조회 — 행 규칙은 lib/docBundle 정본이 정하고 여기는 읽어 넘긴다.
// 규칙과 조회를 가른 이유는 실데이터 대조·회귀 케이스가 화면과 같은 함수를 통과하게 하려는 것이다.
//
// 조회 범위 — 이 영업장, 이 사람, deletedAt null. 발급 대상 상태(CONTRACT_ISSUE_STATUSES)의 계약만
// 연다(투어 단계 계약에는 뽑을 종이가 없다). 파일은 종류마다 최신순으로 넘기고 정본이 계약별 최신을 고른다.

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { CONTRACT_ISSUE_STATUSES } from '@/lib/leaseStatus'
import { rentPaidWhere } from '@/lib/rentPaid'
import { kstMonthStr } from '@/lib/kstDate'
import {
  buildDocBundle, DOC_TYPE_FILE_LABEL, DOC_TYPE_TITLE,
  type DocBundleFile, type TenantDocBundle, type DocBundleRow,
} from '@/lib/docBundle'
import { currentIssueIds } from '@/lib/contractCurrentIssue'
import { contractPurposeLabel, effectiveIssuePurpose, withEffectivePurpose } from '@/lib/contractPurpose'
import { downloadDriveBytes, driveFileSize } from '@/lib/google-drive'
import { shareFileNames } from '@/lib/docShareQueue'
import { sniffDocMime, extForDocMime, guessDocMimeByName, docMimeLabel, DOC_MIME_PDF } from '@/lib/docMime'
import { isMailConfigured, sendMail, MAIL_MAX_TOTAL_BYTES } from '@/lib/mailSend'
import { buildMailFromAddress } from '@/lib/mailFrom'
import { fetchDocMailLogo, logoDataUri, DOC_MAIL_LOGO_CID, DOC_MAIL_LOGO_PX } from '@/lib/docMailLogo'
import type { DocMailSignature } from '@/lib/docMail'
import { fmtDateDot } from '@/lib/fmtDate'
import {
  parseDocMailTemplate, renderDocMail, renderDocMailBodyPrefill, DOC_MAIL_LIMITS, type DocMailTemplate,
} from '@/lib/docMail'

// 한 번에 보낼 수 있는 건수 — 시트의 선택 상한과 같은 숫자다. 메일은 브라우저 다중 공유의
// 10개 하드 리밋과 무관하지만, 두 경로가 다른 수를 말하면 화면이 거짓말을 하게 된다.
const MAIL_MAX_DOCS = 10

/** 메일로 보내기가 이 화면에서 가능한지 — 켜짐 여부와 프리필 주소. 주소는 이 사람 것 하나뿐이다. */
export type TenantDocBundleMail = { enabled: boolean; to: string | null }

/**
 * 문자로 보내기에 필요한 것 — 받는 번호와 문안에 넣을 영업장 이름.
 *
 * 메일과 달리 켜짐 여부가 없다. 문자는 서버가 보내지 않고 운영자 폰의 문자앱이 보내므로
 * 켤 키도 끌 스위치도 없다(형제 문자 모달 셋이 기기를 가리지 않는 것과 같은 이유).
 */
export type TenantDocBundleSms = { to: string | null; propertyName: string }

export async function getTenantDocBundle(
  tenantId: string,
): Promise<(TenantDocBundle & { mail: TenantDocBundleMail; sms: TenantDocBundleSms }) | null> {
  const { propertyId } = await requirePropertyAccess()
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, propertyId },
    select: {
      name: true, email: true,
      // 문자 받을 번호 — 입주자 문자(getPersonalSmsContext)와 **같은 자를 쓴다**. 거기는 첫
      // PHONE 연락처를 쓰고 여기만 다른 번호를 고르면 같은 사람에게 두 번호로 문자가 간다.
      contacts: {
        where: { contactType: 'PHONE' }, orderBy: { createdAt: 'asc' },
        select: { contactValue: true }, take: 1,
      },
    },
  })
  if (!tenant) return null
  const property = await prisma.property.findUnique({
    where: { id: propertyId }, select: { name: true },
  })

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
        // 번복이 있으면 지금 지위는 이쪽이다 — 대표 판정·판본 라벨이 같은 값을 본다.
        purposeOverride: true,
        // 스캔 업로드본은 PDF 가 아닐 수 있다 — 첨부 표기·파일명 확장자의 추정 근거다.
        fileName: true,
      },
    }),
    prisma.rentReceiptFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true, kind: true, targetMonth: true },
    }),
    prisma.residenceCertFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true },
    }),
  ])

  const representativeIds = new Set(currentIssueIds(contractRows.map(withEffectivePurpose)).values())

  // 이번 달 실입금이 있는 계약 — 서류 시트의 '이번 달 확인서 작성' 문을 여는 유일한 근거다.
  // 판정은 lib/rentPaid 정본이 쥔다(발급 화면·감사 규칙과 같은 술어). 계약 목록을 이미 읽은
  // 뒤라 조회 한 번이 늘 뿐이고, id 만 받아 오므로 행을 통째로 끌어오지 않는다.
  const paidRows = leases.length > 0
    ? await prisma.paymentRecord.findMany({
      where: { propertyId, ...rentPaidWhere(kstMonthStr(), leases.map(l => l.id)) },
      select: { leaseTermId: true },
      distinct: ['leaseTermId'],
    })
    : []
  const rentPaidLeaseIds = paidRows.map(r => r.leaseTermId).filter((id): id is string => !!id)

  const receipt = (kind: 'rent' | 'deposit'): DocBundleFile[] => receiptRows
    .filter(r => (kind === 'deposit' ? r.kind === 'deposit' : r.kind !== 'deposit'))
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null, targetMonth: r.targetMonth }))

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
      // 앱 발급본은 PDF 가 확실하고, 업로드본만 이름으로 추정한다(발송 때 바이트가 다시 판정한다).
      mime: r.source === 'UPLOADED' ? guessDocMimeByName(r.fileName) : DOC_MIME_PDF,
    })),
    // 판본 전량 — 폐기본은 뺀다(효력 없는 종이를 내보내는 길을 열지 않는다, 계약서함 다건 보내기와 같은 축).
    // 구버전 도장(supersededAt)은 유효한 종이라 남기되 라벨로 말한다.
    contractVersions: contractRows.filter(r => !r.voidedAt).map(r => ({
      contractFileId: r.id,
      driveFileId: r.driveFileId,
      leaseTermId: r.leaseTermId,
      at: r.signedAt.toISOString(),
      purposeLabel: contractPurposeLabel(effectiveIssuePurpose(r)),
      // '보관용 · 구버전'을 겹말로 보고 뒤를 지웠다가 되돌렸다(디자이너 패스). 축이 다르고 —
      // 도장은 서명의 주인이 넘어갔다는 사실, 보관용은 지금 지위다 — 판본을 고르는 창에서
      // 그 단서를 지우면 보관용 둘을 서명일 하나로만 갈라야 한다. 판본 고르기가 이 창의 용건이다.
      note: [r.source === 'UPLOADED' ? '스캔본' : null, r.supersededAt ? '구버전' : null]
        .filter(Boolean).join(' · ') || null,
      representative: representativeIds.has(r.id),
      mime: r.source === 'UPLOADED' ? guessDocMimeByName(r.fileName) : DOC_MIME_PDF,
    })),
    rents: receipt('rent'),
    rentPaidLeaseIds,
    deposits: receipt('deposit'),
    certs: certRows.map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null })),
    now: new Date(),
  }), tenant.email, tenant.contacts[0]?.contactValue ?? null, property?.name ?? '')
}

/** 규칙 정본이 만든 묶음에 보낼 곳 정보만 얹는다 — lib/docBundle 은 발송을 모른다(순수 규칙). */
function withMail(
  bundle: TenantDocBundle, email: string | null, phone: string | null, propertyName: string,
): TenantDocBundle & { mail: TenantDocBundleMail; sms: TenantDocBundleSms } {
  return {
    ...bundle,
    mail: { enabled: isMailConfigured(), to: email?.trim() || null },
    sms: { to: phone?.trim() || null, propertyName },
  }
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
  /** 표시용 발신 — 도메인은 인증 때문에 고정이고 앞부분은 영업장 설정을 따른다(lib/mailFrom). */
  fromName: string
  fromAddress: string
  /** 답장 후보 열거 — 이 밖의 주소로는 보낼 수 없다(자유 입력 금지). */
  replyToOptions: { email: string; kind: 'property' | 'login' }[]
  replyToDefault: string
  subject: string
  bodyText: string
  /** 문안이 직접 HTML 모드 — 본문 편집을 잠그고 미리보기만 보여준다. */
  htmlLocked: boolean
  /** 보낸 메일 사본이 답장 주소로 함께 가는가(영업장 설정) — 화면이 그 사실을 말한다. */
  copyToReply: boolean
  attachments: { name: string; size: number | null; kind: string }[]
  /** 알려진 크기의 합 — 안내용. 실제 상한은 발송 직전 다운로드 합산이 다시 지킨다. */
  totalBytes: number
  maxBytes: number
  previewHtml: string
}

/** 세 액션(초안·미리보기·발송)이 같은 해석을 지나게 하는 내부 헬퍼 — 키 검증·파일명·문안까지. */
/**
 * 사업자 정보 Json 을 푸터 서명으로 — 칸별로 느슨하게 읽는다.
 *
 * 아직 안 채운 영업장이 있고, 채웠어도 일부만 있을 수 있다. 값이 없으면 그 줄만 빠지고
 * 상호 한 줄은 남는다 — 서명이 부실하다고 서류가 안 나가면 안 된다.
 */
function readMailSignature(raw: unknown): DocMailSignature | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const sig = {
    registrationNo: str(o.registrationNo),
    ceoName: str(o.ceoName),
    address: str(o.address),
  }
  return sig.registrationNo || sig.ceoName || sig.address ? sig : null
}

async function resolveDocMailContext(tenantId: string, keys: string[]) {
  const { propertyId, email: operatorEmail } = await requirePropertyAccess()

  const bundle = await getTenantDocBundle(tenantId)
  if (!bundle) return { ok: false as const, error: '입주자를 찾을 수 없습니다.' }
  if (!bundle.mail.enabled) return { ok: false as const, error: '메일 보내기가 켜져 있지 않습니다.' }
  if (!bundle.mail.to) return { ok: false as const, error: '입주자의 메일 주소가 없습니다. 입주자 정보에 먼저 넣어 주세요.' }

  // 키는 두 꼴이다. 'contract:<leaseId>' 는 대표본(종전 그대로), '...#<contractFileId>' 는 명시 판본.
  // **접미는 재조회한 행의 versions 안에서만 파일로 되바뀐다** — 후보 밖 id 는 조용히 거절되므로
  // 임의 ID 를 끼워 넣을 자리가 없다는 멀티테넌트 방어가 문자 그대로 유지된다.
  const picked = new Map<string, string | null>()   // 행 키 -> 고른 contractFileId(없으면 대표본)
  for (const k of keys) {
    const at = k.indexOf('#')
    if (at < 0) picked.set(k, null)
    else picked.set(k.slice(0, at), k.slice(at + 1))
  }
  const allRows = bundle.groups.flatMap(g => g.rows)
  const rows: (DocBundleRow & { driveFileId: string })[] = []
  for (const r of allRows) {
    if (!picked.has(r.key)) continue
    const wantId = picked.get(r.key) ?? null
    if (!wantId) {
      if (r.driveFileId) rows.push({ ...r, driveFileId: r.driveFileId })
      continue
    }
    const v = r.versions?.find(x => x.contractFileId === wantId)
    if (!v) return { ok: false as const, error: '고른 계약서 판본을 찾을 수 없습니다. 화면을 닫고 다시 열어 주세요.' }
    // 판본을 고르면 그 판본의 파일·서명일·형식이 행을 대신한다. 파일명 접미도 여기서 갈린다.
    rows.push({
      ...r,
      driveFileId: v.driveFileId,
      issuedAt: v.at,
      mime: v.mime,
      note: [v.purposeLabel, v.note].filter(Boolean).join(' · ') || null,
    })
  }
  if (rows.length === 0) return { ok: false as const, error: '보낼 서류를 고르지 않았습니다.' }
  if (rows.length > MAIL_MAX_DOCS) return { ok: false as const, error: `한 번에 최대 ${MAIL_MAX_DOCS}건까지 보낼 수 있습니다.` }

  // 파일명은 공유 경로와 **같은 정본**이다 — 같은 서류가 어디로 나가든 같은 이름으로 도착해야 한다.
  const entries = rows.map(r => {
    // 파생 판본은 이름에 그 사실을 적는다 — 받는 쪽이 제출용을 실계약으로 오인하지 않게.
    // 실계약·스캔본은 접미가 없어 종전 이름 그대로다(무회귀).
    const picked2 = picked.get(r.key) ?? null
    const label = picked2 ? r.versions?.find(v => v.contractFileId === picked2)?.purposeLabel ?? null : null
    return {
      personName: bundle.tenantName,
      docLabel: label ? `${DOC_TYPE_FILE_LABEL[r.docType]}(${label})` : DOC_TYPE_FILE_LABEL[r.docType],
      dateStr: fmtDateDot(r.issuedAt),
    }
  })
  // 확장자는 항목별이다 — 스캔 JPEG 에 .pdf 를 붙여 보낸 것이 이번 사고였다(419호).
  // 여기 값은 추정이고, 실제 발송은 다운로드한 바이트로 다시 판정해 최종 이름을 짓는다.
  const names = shareFileNames(entries, rows.map(() => 1), rows.map(r => extForDocMime(r.mime)))

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      name: true, phone: true, replyToEmail: true, docMailTemplate: true,
      mailFromLocal: true, mailCopyToSelf: true,
      // 푸터 서명·로고 — 종이 푸터를 봉투로 옮긴 자리다(lib/docMail DocMailSignature).
      businessInfo: true, logoDriveFileId: true,
    },
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
    bundle, rows, names, entries,
    docTitles: rows.map(r => DOC_TYPE_TITLE[r.docType]),
    propertyName, propertyPhone: property?.phone ?? null, tpl,
    signature: readMailSignature(property?.businessInfo),
    logoFileId: property?.logoDriveFileId ?? null,
    mailFromLocal: property?.mailFromLocal ?? null,
    copyToSelf: property?.mailCopyToSelf === true,
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
  // 크기와 로고를 함께 병렬로 — 로고는 실패해도 null 이라 발송을 안 막는다.
  const [sizes, logoAsset] = await Promise.all([
    Promise.all(ctx.rows.map(r => driveFileSize(r.driveFileId as string))),
    fetchDocMailLogo(ctx.logoFileId),
  ])
  const data = {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: ctx.names,
    signature: ctx.signature,
    // 미리보기는 iframe 이라 cid: 를 못 그린다 — 같은 바이트를 data URI 로 넣어 그림을 맞춘다.
    logo: logoAsset ? { src: logoDataUri(logoAsset), px: DOC_MAIL_LOGO_PX } : null,
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
      // 표시도 발송과 같은 조립 함수를 지난다 — 화면이 보여준 주소와 실제로 나간 주소가 갈릴 수 없다.
      fromAddress: buildMailFromAddress(ctx.mailFromLocal),
      replyToOptions: ctx.replyToOptions,
      replyToDefault: ctx.replyToDefault,
      subject: rendered.subject,
      bodyText: bodyPrefill,
      htmlLocked: ctx.tpl.mode === 'html',
      copyToReply: ctx.copyToSelf,
      attachments: ctx.names.map((name, i) => ({ name, size: sizes[i], kind: docMimeLabel(ctx.rows[i].mime) })),
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
  const logoAsset = await fetchDocMailLogo(ctx.logoFileId)
  const rendered = renderDocMail(tpl, {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: ctx.names,
    signature: ctx.signature,
    logo: logoAsset ? { src: logoDataUri(logoAsset), px: DOC_MAIL_LOGO_PX } : null,
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

  // **바이트가 최종 권위다.** 스캔본이 JPEG 인데 .pdf 이름·application/pdf 로 실려 받는 사람에게
  // 깨진 계약서가 도착했다(긴급 신고 2026-08-25, 419호). 이름 추정과 실제가 갈리면 실제를 따른다.
  const mimes = bytesList.map(b => sniffDocMime(b))
  const names = shareFileNames(ctx.entries, ctx.rows.map(() => 1), mimes.map(extForDocMime))

  const tpl = draft ? applyDraftToTemplate(ctx.tpl, draft) : ctx.tpl
  // 로고는 **메일 안에 바이트로** 들어간다(cid). 주소를 심으면 나중에 로고를 바꿀 때
  // 옛 파일이 휴지통으로 가면서 이미 보낸 메일이 전부 깨진다. 실패는 null 이라 발송을 안 막는다.
  const logoAsset = await fetchDocMailLogo(ctx.logoFileId)
  const rendered = renderDocMail(tpl, {
    propertyName: ctx.propertyName, propertyPhone: ctx.propertyPhone,
    tenantName: ctx.bundle.tenantName, docTitles: ctx.docTitles, attachmentNames: names,
    signature: ctx.signature,
    logo: logoAsset ? { src: `cid:${DOC_MAIL_LOGO_CID}`, px: DOC_MAIL_LOGO_PX } : null,
  })

  // 사본은 **답장 받기로 한 주소**로 간다 — 사본이 가야 할 곳과 답장이 와야 할 곳은 같은
  // 사서함("내가 확인하는 곳")이라 칸을 셋으로 늘리지 않는다. 그 값은 이미 열거 검증을 지났고,
  // 받는 사람과 같으면 사본을 안 보낸다(같은 메일이 두 번 갈 이유가 없다).
  const copyTo = ctx.copyToSelf && replyTo && replyTo !== ctx.bundle.mail.to ? replyTo : null

  const outcome = await sendMail({
    to: ctx.bundle.mail.to as string,
    fromName: ctx.propertyName,
    fromLocal: ctx.mailFromLocal,
    replyTo,
    bcc: copyTo,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: [
      ...bytesList.map((b, i) => ({
        filename: names[i], bytes: new Uint8Array(b), contentType: mimes[i],
      })),
      // 로고는 contentId 가 붙어 용량 합산에서 빠진다 — 봉투가 아니라 편지지다(lib/mailSend).
      ...(logoAsset ? [{
        filename: 'logo.png',
        bytes: new Uint8Array(logoAsset.bytes),
        contentType: logoAsset.contentType,
        contentId: DOC_MAIL_LOGO_CID,
      }] : []),
    ],
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
          attachmentNames: names,
          attachmentCount: ctx.rows.length,
          totalBytes: total,
          resendId: outcome.id,
          copyTo,
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

/**
 * 서류 문자 발송 시도 기록 — 1행(kind 'doc').
 *
 * 실제 발송은 운영자 폰의 문자앱에서 끝난다. 그래서 이 기록은 '보냈다'가 아니라 '넘겼다'이고,
 * 형제 셋(unpaid·notice·personal)과 같은 성격이다. kind 는 String 칼럼이라 값만 늘고 DDL 은 없다.
 */
export async function logDocSmsAttempt(input: {
  tenantId: string
  renderedBody: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { propertyId } = await requirePropertyAccess()
    if (!input.renderedBody.trim()) return { ok: false, error: '본문이 비어 있습니다.' }
    await prisma.smsLog.create({
      data: {
        propertyId,
        tenantId: input.tenantId,
        renderedBody: input.renderedBody,
        sentVia: 'manual_sms',
        kind: 'doc',
      },
    })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '이력 기록에 실패했습니다.' }
  }
}
