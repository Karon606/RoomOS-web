'use client'

// 계약서 발급 상세 — 이 발급본 한 부가 무엇을 인쇄했는지의 기록(읽기 전용).
//
// **편집 컨트롤이 0개인 것이 이 화면의 규칙이다.** 발급본은 증거라 나중에 고칠 수 있으면 증거가 아니다.
// 그래서 여기에는 저장·수정·재발급 버튼이 없다. 종이를 보려면 목록의 [보기]를 쓴다 —
// §30 행 액션 4개(보기·보내기·인쇄·삭제)는 이 화면이 생겨도 그대로다.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { fmtDateDot } from '@/lib/fmtDate'
import { splitKstDateTime } from '@/lib/kstDate'
import { fmtWon } from '@/lib/fmtMoney'
import { roomLabel } from '@/lib/tenantAddress'
import { PRINTED_FACT_KEYS, PRINTED_FACT_LABEL, type PrintedFactKey } from '@/lib/contractPrintedFacts'
import { getContractIssuedSnapshot, type IssuedContractDetail } from '@/app/(app)/tenants/actions'

const BODY_SOURCE_LABEL: Record<string, string> = {
  SNAPSHOT: '서명 시점 박제본',
  ARCHIVED: '앱 밖 원본(종이 계약·구본)',
  LIVE: '발급 시점 공통 본문',
}

// 시각은 날짜만으로는 같은 날 두 부를 못 가른다 — 발급 상세는 분까지 적는다.
const fmtDateTime = (d: Date | string | null | undefined): string => {
  if (!d) return '기록 없음'
  const { hm } = splitKstDateTime(d)
  return `${fmtDateDot(d)} ${hm}`
}

const AMOUNT_KEYS = new Set<PrintedFactKey>(['lease.rentAmount', 'lease.depositAmount', 'lease.cleaningFee'])

// 축 하나의 값을 사람이 읽는 문장으로. 키가 아예 없으면(undefined) '기록 없음' 이다 —
// 그 축이 생기기 전에 만들어진 기록이라는 뜻이고, 값이 비었다는 뜻이 아니다.
function factText(key: PrintedFactKey, v: unknown): string {
  if (v === undefined) return '기록 없음'
  if (v === null || v === '') return '없음'
  if (key === 'tenant.smoking') return v === true ? '흡연' : '비흡연'
  // 박제값은 `900101-*******#<hmac8>` 이다. 지문은 대조용이지 사람이 읽을 것이 아니라 안 그린다.
  if (key === 'tenant.foreignRegNo') return String(v).split('#')[0]
  if (key === 'tenant.emergencyContacts') {
    try {
      const list = JSON.parse(String(v)) as Array<{ phone?: string; relation?: string | null }>
      if (!Array.isArray(list) || list.length === 0) return '없음'
      return list.map(c => [c.relation, c.phone].filter(Boolean).join(' ')).join(' · ')
    } catch { return String(v) }
  }
  if (key === 'lease.subLeases') {
    try {
      const list = JSON.parse(String(v)) as Array<{ roomNo?: string | null; rentAmount?: number }>
      if (!Array.isArray(list) || list.length === 0) return '없음'
      return list.map(s => [s.roomNo ? roomLabel(s.roomNo) : '호실 미지정', fmtWon(s.rentAmount ?? 0)].join(' ')).join(' · ')
    } catch { return String(v) }
  }
  if (AMOUNT_KEYS.has(key) && typeof v === 'number') return fmtWon(v)
  if (key === 'lease.dueDay') return v === '말' || v === '말일' ? '매월 말일' : `매월 ${v}일`
  return String(v)
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-24 shrink-0 text-[0.6875rem] text-[var(--warm-muted)]">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-[var(--warm-dark)] break-words">{value}</span>
    </div>
  )
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8125rem] font-bold text-[var(--warm-dark)] pt-3 pb-1 first:pt-0">{children}</p>
}

export function IssuedContractSheet({ fileId, onClose, z = 260 }: {
  fileId: string
  onClose: () => void
  z?: 200 | 260 | 280 | 380
}) {
  const [detail, setDetail] = useState<IssuedContractDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getContractIssuedSnapshot(fileId).then(res => {
      if (!alive) return
      if (res.ok) setDetail(res.detail)
      else setError(res.error)
    })
    return () => { alive = false }
  }, [fileId])

  const snap = detail?.snapshot ?? null

  return (
    <Modal open onClose={onClose} z={z} width="md"
      title={detail?.contractNo ? `계약번호 ${detail.contractNo}` : '발급 기록'}
      subtitle={detail ? `${detail.tenantName} · ${detail.source === 'GENERATED' ? '앱 발급본' : '스캔본'}` : undefined}>
      {!detail && !error && <SkeletonRows rows={4} />}
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      {detail && (
        <div className="space-y-1">
          <GroupTitle>발급 정보</GroupTitle>
          <Row label="계약번호" value={detail.contractNo ?? '없음'} />
          <Row label="계약일" value={fmtDateDot(detail.signedAt)} />
          <Row label="발급 시각" value={fmtDateTime(snap?.issuedAt ?? detail.createdAt)} />
          <Row label="파일명" value={detail.fileName} />

          {!snap ? (
            // 박제 칸이 생기기 전에 발급된 42건 — 기록이 없다는 사실만 말하고 지어내지 않는다.
            <p className="mt-3 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2.5 text-xs text-[var(--warm-muted)]">
              이 발급본의 기록이 없습니다. 종이는 보기로 확인하세요.
            </p>
          ) : (
            <>
              <GroupTitle>서명</GroupTitle>
              <Row label="서명 경로" value={snap.shareLinkId ? '원격 서명 링크' : '대면 서명'} />
              <Row label="계약서 서명" value={fmtDateTime(snap.signature.contractSignedAt)} />
              {snap.signature.contractImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={snap.signature.contractImage} alt="계약서 서명"
                  className="mb-1 h-16 w-auto max-w-full rounded-lg border border-[var(--warm-border)] bg-white object-contain p-1" />
              )}
              <Row label="동의서 서명" value={fmtDateTime(snap.signature.disposalSignedAt)} />
              {snap.signature.disposalImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={snap.signature.disposalImage} alt="잔여 소지품 임의처분 동의서 서명"
                  className="mb-1 h-16 w-auto max-w-full rounded-lg border border-[var(--warm-border)] bg-white object-contain p-1" />
              )}

              <GroupTitle>이 발급본의 표시값</GroupTitle>
              {/* 추가 호실은 딸린 계약이 있는 발급본에만 있는 축이다 — 없는 발급본에 '기록 없음'
                  줄을 세우면 단독 계약 전건의 시트에 결함처럼 보이는 빈 줄이 하나 는다.
                  다른 축은 종전대로 늘 그린다(그쪽은 모든 계약서에 있는 칸이라 공백이 곧 사실이다). */}
              {PRINTED_FACT_KEYS.filter(k => k !== 'template')
                .filter(k => k !== 'lease.subLeases' || snap.facts[k] !== undefined)
                .map(k => (
                <Row key={k} label={PRINTED_FACT_LABEL[k]} value={factText(k, snap.facts[k])} />
              ))}

              <GroupTitle>본문 출처</GroupTitle>
              <Row label="가져온 곳" value={BODY_SOURCE_LABEL[snap.bodySource] ?? snap.bodySource} />
              <Row label="본문 기록" value={snap.facts.template === undefined ? '없음' : '있음'} />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
