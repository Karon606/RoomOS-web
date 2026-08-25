// 입주자 '서류 보내기' 행 규칙 정본 — 사람 단위로 열되 **행은 계약 축**이다(신고 44501308, 1단계).
//
// 왜 계약 축인가. 한 사람이 방을 둘 쓰면(509호 거주 + 601호 창고) 납부 확인서는 계약마다 다른 종이다.
// 사람 하나로 눕히는 순간 어느 계약의 종이인지 화면이 말할 수 없고, 그러면 받지도 않은 돈의 종이가
// 나가거나 그 반대가 된다 — 서류 지목(lib/documentLease)이 이미 정리한 클래스와 같은 뿌리다.
// 그래서 모든 행이 leaseTermId 를 명시하고, 말할 수 없는 파일은 중립 그룹에 둔다(단정 배치 금지).
//
// 규칙을 조회에서 떼어 여기 둔 이유는 하나다 — 실데이터 대조와 회귀 케이스가 화면과 **같은 함수**를
// 통과해야 한다. 스크립트가 규칙을 다시 적으면 그 사본이 검증하는 것은 사본 자신이다.
//
// 여기서 아무것도 발급하지 않는다. 미발급 칸은 후보로 세우되 파일이 없다고만 말하고, 화면이 작성
// 화면으로 보낸다. 발행번호 원장·서명이 걸려 있어 자동 발급은 금지다(패널 확정).

import { CURRENT_OCCUPANCY_STATUSES, roomLeaseRowOrder } from '@/lib/leaseStatus'
import { kstMonthOf } from '@/lib/fmtDate'
import { DOC_MIME_PDF } from '@/lib/docMime'

export type DocBundleDocType = 'contract' | 'rent' | 'deposit' | 'residence'

// 서류 이름은 두 벌이다 — 화면에 서는 이름과 파일·메일에 적히는 이름. 파일 쪽은 형제 3화면이
// 이미 쓰고 있는 문자열 그대로여야 같은 서류가 어디로 나가든 같은 이름으로 도착한다.
// 규칙 정본에 함께 두는 이유는 하나다. 사본이 생기면 한쪽만 고쳐진 채로 두 이름이 돌아다닌다.
export const DOC_TYPE_TITLE: Record<DocBundleDocType, string> = {
  contract: '계약서',
  rent: '입실료 납부 확인서',
  deposit: '보증금 영수증',
  residence: '실거주 확인서',
}
export const DOC_TYPE_FILE_LABEL: Record<DocBundleDocType, string> = {
  contract: '계약서',
  rent: '입실료납부확인서',
  deposit: '보증금영수증',
  residence: '실거주확인서',
}

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
  /** 파일 형식 추정(파일명 기준) — 첨부 표기·파일명 확장자의 기본값이다.
   *  실제로 내보낼 때는 바이트 스니핑(lib/docMime)이 최종 권위라, 이 추정이 틀려도 파일은 옳게 나간다. */
  mime: string
  /** 이 행으로 보낼 수 있는 판본들(계약서 전용). 없거나 1부면 화면이 판본 줄을 안 세운다.
   *  **기본 선택은 언제나 driveFileId(대표본)다** — 운영자가 안 만지면 종전과 같은 종이가 나간다. */
  versions?: DocBundleContractVersion[]
}

/**
 * 계약서 판본 하나 — 같은 계약에 실계약·스캔본·제출용·번역본이 함께 설 수 있다.
 *
 * 왜 필요한가(긴급 신고 2026-08-25, 419호). 스캔본을 지우자 남은 것이 '제출용'뿐이었는데,
 * 대표 판정 정본이 파생 판본을 대표로 승격하지 않으므로 **보낼 계약서가 없다**가 됐다.
 * 그 규칙은 옳다(근거 없는 표시본이 실계약 자리에 앉으면 안 된다) — 없던 것은 파생 판본을
 * 명시적으로 골라 보내는 길이다. 승격이 아니라 선택이라 대표 판정은 한 글자도 안 바뀐다.
 */
export type DocBundleContractVersion = {
  /** ContractFile.id — 선택 키의 접미가 된다(driveFileId 가 아니라 행 id 다). */
  contractFileId: string
  driveFileId: string
  /** 서명일 ISO. */
  at: string
  /** '제출용'·'번역본' — 실계약이면 null(기본값이 대다수 행에 붙으면 소음이다). */
  purposeLabel: string | null
  /** '스캔본' · '구버전' 같은 파일 자체의 보조 표기. */
  note: string | null
  /** 이 부가 그 계약의 대표본인가 — 기본 선택이자 화면의 '현재' 표시. */
  representative: boolean
  mime: string
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

/** 조회가 넘기는 계약 한 건. */
export type DocBundleLease = {
  id: string
  status: string
  moveInDate: Date | string | null
  depositAmount: number
  parentLeaseTermId: string | null
  roomNo: string | null
}

/** 조회가 넘기는 보관 파일 한 건. 각 배열은 **최신순**이어야 한다(첫 건이 곧 그 계약의 최신). */
export type DocBundleFile = {
  driveFileId: string
  leaseTermId: string | null
  /** 계약서는 서명일, 나머지는 발급일. */
  at: Date
  /** 파일 자체가 말하는 보조 표기 — 지금은 계약서 스캔본뿐이다. */
  note: string | null
  /** 파일 형식 — 조회부가 파일명으로 추정해 넣는다. 없으면 PDF(앱 발급본 전부가 PDF). */
  mime?: string | null
}

export type DocBundleInput = {
  tenantName: string
  /** 발급 대상 상태(CONTRACT_ISSUE_STATUSES)로 이미 걸러진 계약들. 순서는 여기서 다시 잡는다. */
  leases: DocBundleLease[]
  contracts: DocBundleFile[]
  /** 살아 있는 계약서 판본 전량(폐기본 제외). contracts 는 그중 대표 한 부라 기본 선택이 안 바뀐다.
   *  행에 실릴 때 leaseTermId 는 떨어져 나간다(행이 이미 그 계약을 말한다). */
  contractVersions?: (DocBundleContractVersion & { leaseTermId: string | null })[]
  rents: DocBundleFile[]
  deposits: DocBundleFile[]
  certs: DocBundleFile[]
  /** '이번 달' 판정 기준 — 호출부가 넘긴다(테스트가 시계를 고정할 수 있게). */
  now: Date
}

/** 종류별 최신 한 건 — 입력이 이미 최신순이라 첫 일치가 곧 최신이다. */
const latestFor = (files: DocBundleFile[], leaseTermId: string): DocBundleFile | undefined =>
  files.find(f => f.leaseTermId === leaseTermId)

export function buildDocBundle(input: DocBundleInput): TenantDocBundle {
  const { tenantName, leases, contracts, contractVersions = [], rents, deposits, certs, now } = input
  // 그룹 순서 정본 — 거주 · 예약 · 비거주(호실 면·프리즘과 같은 한 벌).
  const ordered = roomLeaseRowOrder(leases)

  // 이번 달 발급본인가 — 납부 확인서에만 붙이는 보조 문구다. 그 서류만 '그 달의 사실'을 증명하고,
  // 계약서·보증금 영수증·실거주 확인서는 달과 무관해 오래됐다는 말 자체가 성립하지 않는다.
  const nowMonth = kstMonthOf(now)
  const staleNote = (at: Date): string | null => (kstMonthOf(at) === nowMonth ? null : '이번 달 발급본이 아닙니다')

  const row = (
    docType: DocBundleDocType, leaseTermId: string | null, file: DocBundleFile | undefined, extraNote?: string | null,
  ): DocBundleRow => ({
    key: `${docType}:${leaseTermId ?? 'none'}`,
    docType,
    leaseTermId,
    driveFileId: file?.driveFileId ?? null,
    issuedAt: file ? file.at.toISOString() : null,
    note: [file?.note ?? null, extraNote ?? null].filter(Boolean).join(' · ') || null,
    mime: file?.mime || DOC_MIME_PDF,
  })

  const residing: string[] = CURRENT_OCCUPANCY_STATUSES
  const groups: DocBundleGroup[] = ordered.map(l => {
    const rows: DocBundleRow[] = []

    // 계약서는 **딸린 계약에 없다.** 그 계약의 종이는 부모 한 장이고 합본이 추가 호실을 이미 싣는다
    // (계약서 파일 칸의 extraLeases 와 문자 그대로 같은 규칙, 발급 자체도 서버가 막는다).
    if (!l.parentLeaseTermId) {
      const contractRow = row('contract', l.id, latestFor(contracts, l.id))
      // 판본은 그 계약에 걸린 것만. 대표가 없어도(419호처럼 제출용만 남은 경우) 행은 서고,
      // 화면이 '실계약 계약서가 없습니다'를 말한 뒤 판본을 고르게 한다.
      const vs = contractVersions.filter(v => v.leaseTermId === l.id)
      if (vs.length > 0) {
        // leaseTermId 는 떼고 싣는다 — 행이 이미 그 계약을 말하고 있어 중복이다.
        contractRow.versions = vs.map(v => ({
          contractFileId: v.contractFileId, driveFileId: v.driveFileId, at: v.at,
          purposeLabel: v.purposeLabel, note: v.note, representative: v.representative, mime: v.mime,
        }))
        if (!contractRow.driveFileId) contractRow.note = '실계약 계약서가 없습니다'
      }
      rows.push(contractRow)
    }

    const rent = latestFor(rents, l.id)
    rows.push(row('rent', l.id, rent, rent ? staleNote(rent.at) : null))

    // 보증금 영수증은 보증금 있는 계약만. 이미 발급된 건이 있으면 계약이 0원이 됐어도 남긴다 —
    // 존재하는 종이를 발송 화면에서 감추면 보낼 길이 사라진다.
    const deposit = latestFor(deposits, l.id)
    if (l.depositAmount > 0 || deposit) rows.push(row('deposit', l.id, deposit))

    // 실거주 확인서는 거주 계약만이다 — 실거주 사실이 없는 계약의 확인서는 존재해선 안 된다.
    // 다만 이미 발급된 건이 있으면 그것도 사실이라 행으로 세운다(보증금과 같은 이유).
    const cert = latestFor(certs, l.id)
    if (residing.includes(l.status) || cert) rows.push(row('residence', l.id, cert))

    return { kind: 'lease' as const, leaseTermId: l.id, roomNo: l.roomNo, status: l.status, rows }
  })

  // 위 계약들에 걸리지 않은 보관본 — 계약 연결이 끊긴 옛 파일(null)과 끝난 계약의 발급본.
  // 어느 계약의 것인지 단정하지 않고 중립 그룹에 세운다. 파일이 있는 것만 담는다(작성 왕복 없음).
  const shown = new Set(ordered.map(l => l.id))
  const orphan = (files: DocBundleFile[]): DocBundleFile | undefined =>
    files.find(f => !f.leaseTermId || !shown.has(f.leaseTermId))
  const otherRows: DocBundleRow[] = []
  const pushOther = (docType: DocBundleDocType, f: DocBundleFile | undefined) => {
    if (!f) return
    otherRows.push({
      key: `other-${docType}`,
      docType,
      leaseTermId: null,
      driveFileId: f.driveFileId,
      issuedAt: f.at.toISOString(),
      note: [f.note, f.leaseTermId ? '지난 계약' : '계약 표시 없음'].filter(Boolean).join(' · '),
      mime: f.mime || DOC_MIME_PDF,
    })
  }
  pushOther('contract', orphan(contracts))
  pushOther('rent', orphan(rents))
  pushOther('deposit', orphan(deposits))
  pushOther('residence', orphan(certs))
  if (otherRows.length > 0) {
    groups.push({ kind: 'other', leaseTermId: null, roomNo: null, status: null, rows: otherRows })
  }

  return { tenantName, groups }
}
