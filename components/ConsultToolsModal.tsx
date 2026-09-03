'use client'

// 상담 도구 — 카톡·네이버톡 상담 중 자주 알려주는 영업장 값을 탭 한 번에 복사하는 모음.
// 한 손으로 쓰는 도구라 값마다 별도 버튼을 찾게 하지 않고 행 전체가 복사 타겟이다.
// 코너 안에 단기 요금 계산 진입을 함께 둔다(운영자 제안, 오류신고 ce05bb74).
// 구분선 아래는 복사가 아닌 줄이다 — 사업자등록증 보내기(파일 첨부)와 단기 요금 계산(운영자 오더 2026-08-18).
//
// 표시되는 값이 곧 복사되는 값이다 — 말줄임을 쓰지 않는다. 화면에 '3333-01-234…' 를
// 남기면 눈으로 본 것과 클립보드에 담긴 것이 갈린다(§06 축약 금지 구역과 같은 사고).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn, btnClass } from '@/components/ui/Btn'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { StayQuoteModal } from '@/components/StayQuoteModal'
import { pushToast, TOAST_DUR_LONG, humanError } from '@/lib/saveStatus'
import { shareOrDownloadFile, shareFiles } from '@/lib/shareFile'
import { pdfToPngBlobs, prewarmPdfToPng } from '@/lib/pdfToPng'
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { getConsultInfo, type ConsultInfo } from '@/app/(app)/consultInfo'

// 행 하나. value 가 비면 목록에서 빠진다 — '미설정' 을 띄우면 탭해도 복사할 것이 없어
// '행 = 복사' 규칙이 깨진다.
type CopyItem = { key: string; label: string; value: string; toast: string; valueClass: string }

function copyItems(info: ConsultInfo): CopyItem[] {
  return [
    { key: 'site',  label: '소개 페이지',      value: info.siteUrl,     toast: '소개 페이지 주소 복사됨',      valueClass: 'break-all' },
    { key: 'addr',  label: '영업장 주소',      value: info.address,     toast: '영업장 주소 복사됨',           valueClass: 'break-keep' },
    { key: 'phone', label: '대표 연락처',      value: info.phone,       toast: '대표 연락처 복사됨',           valueClass: 'num' },
    { key: 'bank',  label: '입금 계좌',        value: info.bankAccount, toast: '입금 계좌 복사됨',             valueClass: 'num break-all' },
    { key: 'biz',   label: '사업자등록번호',   value: info.bizNo,       toast: '사업자등록번호 복사됨',        valueClass: 'num' },
  ].filter(r => r.value)
}

// 안내문 한 번에 — 카톡에 붙였을 때 읽히는 형태가 기준이다. 1행 영업장명(대화 목록 미리보기가
// 이 줄을 쓴다) · 2행 주소 · 3행 URL 단독(단독 줄이라야 자동 링크·미리보기 카드가 붙는다) · 4행 연락처.
// 계좌와 사업자등록번호는 넣지 않는다. 위치를 물어본 사람에게 계좌가 함께 가면 입금 요구로 읽힌다.
// 문장은 이 함수 하나가 만든다 — 화면이 자기 문장을 조립하기 시작하면 같은 안내가 자리마다 갈린다.
export function buildIntroText(info: ConsultInfo): string {
  return [
    info.propertyName,
    info.address,
    info.siteUrl,
    info.phone ? `문의 ${info.phone}` : '',
  ].filter(Boolean).join('\n')
}

const ROW_CLS =
  'w-full text-left px-5 sm:px-6 py-3 min-h-[44px] transition-colors duration-[var(--dur-base)] ' +
  'hover:bg-[var(--cream-soft)] active:bg-[var(--sand)] ' +
  // ring-offset 은 풀블리드 행에서 모달 본문 밖으로 잘린다 — MonthSelector 와 같은 이유로 inset.
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc-text)]/30 focus-visible:ring-inset'

function CopyRow({ label, value, valueClass, onCopy }: {
  label: string; value: string; valueClass: string; onCopy: () => void
}) {
  return (
    <button type="button" onClick={onCopy} aria-label={`${label} 복사`}
      className={`${ROW_CLS} border-b border-[var(--warm-border)]/50 last:border-0`}>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium leading-normal text-[var(--warm-muted)]">{label}</span>
          {/* select-text — 클립보드 API 가 막힌 환경에서 값을 길게 눌러 직접 고르는 폴백을 살린다 */}
          <span className={`block select-text text-sm leading-relaxed text-[var(--warm-dark)] ${valueClass}`}>{value}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className="mt-1 shrink-0 text-[var(--warm-mid)]">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </span>
    </button>
  )
}

// 사업자등록증 첨부 파일명의 확장자. mime 을 그대로 쪼개면 image/jpeg 가 '.jpeg' 가 되고
// 받는 쪽 앱이 낯설게 다루는 일이 있어 흔한 형식만 손으로 짝지어 둔다.
const CERT_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/gif': 'gif',
}

async function fetchBizCertBlob(): Promise<Blob> {
  const res = await fetch('/api/biz-cert')
  if (!res.ok) throw new Error('사업자등록증을 불러오지 못했습니다.')
  return res.blob()
}

// 보낼 준비 완료 형태 — PDF 는 여기서 이미 이미지로 변환돼 있다.
type PreparedCert = { blobs: Blob[]; mime: string; ext: string; original: Blob; originalMime: string }

// PDF 는 이미지로 변환해 첨부한다(운영자 실사용 보고 2026-08-18 — 문자메시지가 PDF 첨부를 간혹
// 거부한다). 공유 시트는 목적지를 미리 알 수 없으므로 항상 이미지가 안전하고, 이미지 원본은 그대로다.
// 변환은 프리페치 단계에서 끝낸다 — 탭 후 변환을 시작하면 제스처 허용 시간이 지나 다운로드로 샌다.
async function prepareBizCert(fallbackMime: string | null): Promise<PreparedCert> {
  const blob = await fetchBizCertBlob()
  const mime = blob.type || fallbackMime || 'application/pdf'
  if (mime === 'application/pdf') {
    const pages = await pdfToPngBlobs(await blob.arrayBuffer())
    return { blobs: pages, mime: 'image/png', ext: 'png', original: blob, originalMime: mime }
  }
  return { blobs: [blob], mime, ext: CERT_EXT[mime] ?? 'png', original: blob, originalMime: mime }
}

export function ConsultToolsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<ConsultInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [sending, setSending] = useState(false)
  // 사업자등록증을 탭 전에 미리 받아 둔다. 공유 시트는 탭 직후에만 열 수 있어(lib/shareFile 제스처
  // 규칙) 탭하고 나서 내려받기 시작하면 허용 시간이 지나 전송이 다운로드로 새어 나간다.
  // 서류 보내기 시트가 체크하는 순간부터 준비를 거는 것과 같은 이유다(lib/docShareQueue).
  const certRef = useRef<Promise<PreparedCert> | null>(null)

  const load = useCallback(() => {
    // 열 때마다 버린다 — 환경설정에서 등록증을 교체한 직후에 옛 파일이 나가면 안 된다(값 재조회와 같은 이유).
    certRef.current = null
    setFailed(false); setLoading(true)
    getConsultInfo()
      .then(res => {
        if (res.ok) {
          setInfo(res.info)
          if (res.info.bizCertMimeType) {
            if (res.info.bizCertMimeType === 'application/pdf') prewarmPdfToPng()
            const p = prepareBizCert(res.info.bizCertMimeType)
            p.catch(() => { /* 탭 전 실패는 조용히 — 탭 시점에 같은 프라미스를 다시 기다려 알린다 */ })
            certRef.current = p
          }
          return
        }
        setInfo(null); setFailed(true); pushToast('error', res.error)
      })
      .catch(() => { setInfo(null); setFailed(true); pushToast('error', '영업장 정보를 불러오지 못했습니다.') })
      .finally(() => setLoading(false))
  }, [])

  // 열 때마다 다시 읽는다 — 환경설정에서 계좌를 고친 직후에도 옛 값을 복사하지 않게.
  // 열림이라는 외부 사건에 맞춰 조회를 시작하는 자리라 진행 표시(setLoading)가 동기여야 한다.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open) load() }, [open, load])

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      pushToast('success', message)
    } catch {
      pushToast('error', '복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.')
    }
  }

  // PDF 로 올린 등록증은 보낼 때 형식을 고른다(운영자 오더 2026-08-18 — 문자엔 사진이 확실하고
  // 메일엔 PDF 원본이 맞는다). 물음은 SendDocButton 의 choiceDialog 정본(§14) 그대로이고, 선택
  // 버튼 탭이 새 제스처라 공유 시트가 바로 열린다. 이미지로 올린 등록증은 물을 것이 없어 그대로 나간다.
  // 사진 변환은 프리페치가 이미 끝내 두었다(prepareBizCert).
  const sendBizCert = async () => {
    if (!info) return
    setSending(true)
    try {
      const pending = certRef.current ?? prepareBizCert(info.bizCertMimeType)
      certRef.current = pending
      const prep = await pending
      const base = info.propertyName ? `${info.propertyName}_사업자등록증` : '사업자등록증'
      let asImage = true
      if (prep.originalMime === 'application/pdf') {
        const format = await choiceDialog({
          title: '어떤 형식으로 보낼까요?',
          message: `문자메시지로 보낼 때는 사진이 확실합니다. PDF는 일부 휴대폰·문자 앱에서 첨부가 안 될 수 있고, 이메일에는 PDF 원본이 깔끔합니다.${prep.blobs.length > 1 ? ` 사진은 장수만큼(${prep.blobs.length}장) 만들어집니다.` : ''}`,
          confirmLabel: '사진으로',
          altLabel: 'PDF로',
        })
        if (!format || format === 'back') { setSending(false); return }
        asImage = format === 'confirm'
      }
      if (!asImage) {
        const ext = CERT_EXT[prep.originalMime] ?? 'pdf'
        const result = await shareOrDownloadFile(prep.original, `${base}.${ext}`, prep.originalMime)
        if (result === 'downloaded') {
          pushToast('info', '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다.', { duration: TOAST_DUR_LONG })
        }
      } else if (prep.blobs.length === 1) {
        const result = await shareOrDownloadFile(prep.blobs[0], `${base}.${prep.ext}`, prep.mime)
        if (result === 'downloaded') {
          pushToast('info', '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다.', { duration: TOAST_DUR_LONG })
        }
      } else {
        const files = prep.blobs.map((b, i) => new File([b], `${base}_${i + 1}.${prep.ext}`, { type: prep.mime }))
        const result = await shareFiles(files)
        if (result === 'retry') {
          pushToast('info', '한 번 더 눌러 주세요.')
        } else if (result === 'unsupported') {
          // 여러 장 저장은 브라우저가 연속 다운로드를 막는다 — 원본 한 파일로 받는 것이 폴백이다.
          const ext = CERT_EXT[prep.originalMime] ?? 'pdf'
          await shareOrDownloadFile(prep.original, `${base}.${ext}`, prep.originalMime)
          pushToast('info', '이 기기에서는 바로 보낼 수 없어 원본 파일로 저장했습니다.', { duration: TOAST_DUR_LONG })
        }
      }
    } catch (err) {
      certRef.current = null   // 다음 탭에서 다시 받는다
      pushToast('error', humanError(err, '사업자등록증을 보내지 못했습니다.'))
    }
    // finally 로 묶지 않는다 — try/finally 안의 setState 를 보면 react-hooks 컴파일러 규칙이
    // 이 컴포넌트 전체 분석을 포기해, 위 useEffect 의 set-state-in-effect 검사까지 조용히 꺼졌다
    // (eslint 가 그 disable 지시를 '쓰이지 않음'으로 보고해 드러났다). catch 가 전부 삼키므로
    // 여기까지 오는 길은 하나뿐이고 결과는 finally 와 같다.
    setSending(false)
  }

  const items = info ? copyItems(info) : []
  const introText = info ? buildIntroText(info) : ''
  // 한 줄뿐이면 묶음이 개별 행과 같아진다 — 그때는 세우지 않는다.
  const showIntro = introText.includes('\n')

  return (
    <>
      <Modal open={open} onClose={onClose} title="상담 도구" width="sm"
        subtitle="탭하면 클립보드에 복사됩니다"
        /* 풀블리드 — 행 전체가 복사 타겟이라 hover·눌림 표면이 패널 좌우 끝까지 닿아야 한다(§13 예외 조항). */
        bodyClassName="">
        {!info && loading ? (
          <div className="px-5 py-4 sm:px-6"><SkeletonRows rows={5} /></div>
        ) : failed ? (
          <div className="px-5 py-4 sm:px-6">
            <EmptyState
              title="영업장 정보를 불러오지 못했습니다"
              description="잠시 후 다시 시도해 주세요."
              action={<Btn variant="secondary" size="sm" onClick={load}>다시 시도</Btn>}
            />
          </div>
        ) : items.length === 0 && !showIntro ? (
          <div className="px-5 py-4 sm:px-6">
            <EmptyState
              title="복사할 정보가 없습니다"
              description="환경설정 기본 정보에서 주소·대표 연락처·입금 계좌를, 웹사이트 탭에서 소개 페이지 주소를 채우면 여기에 뜹니다."
              action={
                <Link href="/settings" onClick={onClose} className={btnClass('secondary', 'sm')}>환경설정 열기</Link>
              }
            />
          </div>
        ) : (
          <div>
            {items.map(r => (
              <CopyRow key={r.key} label={r.label} value={r.value} valueClass={r.valueClass}
                onCopy={() => copy(r.value, r.toast)} />
            ))}
            {/* 안내문은 한글을 어절 단위(break-keep)로 접는데 URL 줄만 끊을 자리가 없어 320px 에서
                34px 삐져나갔다(헤드리스 실측). overflow-wrap:anywhere 는 다른 접을 자리가 없을 때만
                발동해 한글 줄은 그대로 두고 URL 만 접는다. */}
            {showIntro && (
              <CopyRow label="안내문 한 번에" value={introText} valueClass="whitespace-pre-line break-keep [overflow-wrap:anywhere]"
                onCopy={() => copy(introText, '안내문 복사됨')} />
            )}
          </div>
        )}

        {/* 탭이 곧 동작인 줄들 — 위 목록은 복사, 여기는 복사가 아니다. 그래서 구분선 아래에 따로 선다.
            모달 부제('탭하면 클립보드에 복사됩니다')가 위 목록의 약속이라 섞으면 그 약속이 거짓말이 된다. */}
        <div className="border-t border-[var(--warm-border)]">
          {/* 사업자등록증 — 파일이 있을 때만 선다(값 없는 복사 줄을 빼는 규칙과 같다).
              라벨에 '보내기'를 박는다 — 한 코너에서 위는 복사, 이 줄은 전송이라 라벨이 갈라 줘야 한다.
              동사는 서류 어휘 정본을 따른다('공유' 금지, '보내기'가 정본). */}
          {info?.bizCertMimeType && (
            <button type="button" onClick={sendBizCert} disabled={sending}
              className={`${ROW_CLS} border-b border-[var(--warm-border)]/50 disabled:opacity-60`}>
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--warm-dark)]">
                    {sending ? '준비 중…' : '사업자등록증 보내기'}
                  </span>
                  <span className="block text-xs leading-normal break-keep text-[var(--warm-muted)]">{info?.bizCertMimeType === 'application/pdf' ? '보낼 때 사진과 PDF 중 고릅니다' : '문자·메일에 파일 그대로 첨부됩니다'}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  className="shrink-0 text-[var(--warm-mid)]">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </span>
            </button>
          )}

          {/* 단기 요금 계산 — 홈 월 선택 줄에 홀로 서 있던 도구를 이 코너 안으로 들였다(운영자 제안). */}
          <button type="button" onClick={() => setQuoteOpen(true)} className={ROW_CLS}>
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--warm-dark)]">단기 요금 계산</span>
                <span className="block text-xs leading-normal text-[var(--warm-muted)]">등록 없이 기간별 요금을 미리 계산합니다</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                className="shrink-0 text-[var(--warm-mid)]">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
          </button>
        </div>
      </Modal>

      {/* 이 코너 위에 겹쳐 뜬다 — §13 중첩 +10 (z 200 위의 260). 닫으면 코너로 돌아온다. */}
      <StayQuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} z={260} />
    </>
  )
}
