'use client'

// 참고용 번역본 열람 — 서명 화면의 접힘 카드와 발급 상세의 모달이 이 본문 하나를 함께 쓴다.
//
// **조판이 계약서와 일부러 다르다**(운영자 오더 2026-09-08 — "계약서와 동일한 포맷으로 하면
// 오히려 헷갈릴 수 있으므로 다른 템플릿으로"). 계약서는 A4 축소 종이(.contract-paper, 먹 1색)이고
// 이쪽은 앱 화면 카드 문법이다. 같은 모양이면 입주자가 종이 두 장을 받은 것으로 읽고, 그러면
// "번역본에도 서명했다"는 말이 나온다.
//
// 그래서 여기에 **없는 것들**이 이 파일의 절반이다.
//   · 헤더 밴드·정보표·서명란·워드마크가 없다. 이름도 금액도 안 싣는다 — 조항만이다.
//   · 읽음 확인이 없다. 체크박스도 버튼도 서명도 두지 마라(법률 관점 판정). 번역본에 효력을
//     준 것처럼 읽히면 안 되고, 서명 진행 판정과도 무관해야 한다.
//   · 워터마크가 없다(§29 장식 0). '참고용'은 배지와 고지 문구가 말한다.
//
// **표시 원천은 박제다.** 지금 사전을 다시 해석하지 않는다 — 입주자가 본 문안과 갈리면
// 그 순간 박제는 증거이기를 그만둔다(lib/contractTranslation 의 asResolvedContractTranslation).

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { stripClauseBullet, type ContractTemplate } from '@/lib/contract'
import {
  TRANSLATION_LANG_ENDONYM, translationNoticeBi,
  type ResolvedContractTranslation,
} from '@/lib/contractTranslation'

/**
 * 번역이 없어 한국어 원문이 그대로 남은 줄인가.
 *
 * 판정은 **박제된 한국어 본문과의 대조**다(사전 재조회가 아니다). 그 본문은 같은 스냅샷에
 * 함께 얼어 있어서, 번역본과 index 가 1:1 로 맞는다(resolveContractTranslation 이 template 을
 * 그대로 map 한 결과라 절·항목 개수가 안 줄어든다).
 *
 * 본문을 못 구하면 표식을 안 단다. **감추지는 않는다** — 표식이 없는 것과 줄이 없는 것은
 * 다른 말이고, 줄을 감추면 "3조 2항"이 번역본에서 다른 줄을 가리킨다.
 */
function sameAsSource(translated: string, source: string | undefined): boolean {
  return !!source && translated === source
}

/** 원문으로 남은 줄에 붙는 회색 표식. 크기는 §05 Caption 최소값(10.5px). */
function SourceMark() {
  return (
    <span className="ml-1.5 shrink-0 align-middle text-[0.65625rem] font-medium text-[var(--warm-muted)]">
      원문
    </span>
  )
}

/**
 * 번역본 본문. 카드 껍데기가 없어 모달 안에도 그대로 들어간다.
 *
 * @param source 같은 스냅샷의 한국어 본문. 원문으로 남은 줄에 표식을 달 때만 쓴다.
 */
export function ContractTranslationBody({ translation, source }: {
  translation: ResolvedContractTranslation
  source?: ContractTemplate | null
}) {
  const srcSections = Array.isArray(source?.sections) ? source.sections : []
  return (
    <div className="space-y-4">
      {/* 머리 — 무엇인지 먼저 말한다. 배지는 pale-neutral 고정이다(§11). 강조색을 쓰면
          이 종이가 힘을 가진 것처럼 읽히는데, 여기는 힘이 없다는 것이 요점이다.
          언어는 그 언어의 자기 이름으로 적는다 — 자기 언어를 찾는 사람에게 '영어'는 단서가 아니다. */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="pale-neutral" size="sm">참고용 · Reference only</Badge>
        <span className="text-xs font-medium text-[var(--warm-muted)]">
          {TRANSLATION_LANG_ENDONYM[translation.lang]}
        </span>
      </div>

      {/* 우선 문구 — §18 안내 톤 줄. 좌측 3px 팁은 안 단다(팁은 상태색일 때만 선다, §18
          2026-09 개정). 문법은 같은 화면의 형제 안내 줄(ContractView 서명본 배너)과 같다.
          문안은 코드 사전 그대로다 — 한국어 정본 줄이 앞서고 그 언어 줄이 뒤따른다. */}
      <p
        className="whitespace-pre-line"
        style={{
          background: 'var(--info-bg)', border: '1px solid var(--info-ring)', borderRadius: 10,
          padding: '10px 12px', margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--info-fg)',
        }}
      >
        {translationNoticeBi(translation.lang)}
      </p>

      {/* 계약서 제목. 번역이 없으면 한국어 원문이 그대로 서고 표식이 붙는다. */}
      <h2 className="text-lg font-bold leading-snug tracking-[-0.02em] text-[var(--warm-dark)] break-keep">
        {translation.title}
        {sameAsSource(translation.title, source?.title) && <SourceMark />}
      </h2>

      {/* 조항. **번호는 계약서와 같은 번호다** — 대조가 목적이라 여기서 다시 매기면 안 된다.
          절 번호는 제목 문자열 안에 있고(운영자가 '1. 입실 계약'처럼 적는다), 항목 번호는
          종이의 CSS 카운터와 같은 규칙으로 절마다 1부터 센다. 글머리 제거도 종이와 같은
          정본 함수를 쓴다(stripClauseBullet) — 규칙이 두 벌이면 언젠가 갈린다. */}
      {translation.sections.map((sec, si) => (
        <section key={si} className="space-y-1.5">
          <h3 className="text-sm font-bold leading-normal text-[var(--warm-dark)] break-keep">
            {sec.title}
            {sameAsSource(sec.title, srcSections[si]?.title) && <SourceMark />}
          </h3>
          <ol className="space-y-1.5">
            {sec.items.map((item, ii) => (
              <li key={ii} className="flex gap-2 text-sm leading-relaxed tracking-[-0.01em] text-[var(--warm-dark)] break-keep">
                <span className="num shrink-0 text-[var(--warm-muted)]">{ii + 1}.</span>
                <span className="min-w-0 whitespace-pre-line">
                  {stripClauseBullet(item)}
                  {sameAsSource(item, srcSections[si]?.items?.[ii]) && <SourceMark />}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {translation.oathText && (
        <p className="text-sm leading-relaxed tracking-[-0.01em] text-[var(--warm-dark)] break-keep">
          {translation.oathText}
          {sameAsSource(translation.oathText, source?.oathText) && <SourceMark />}
        </p>
      )}
    </div>
  )
}

/**
 * 서명 화면의 접힘 카드 — 계약서 종이 **위**에 선다. 종이를 읽기 전에 만나야 하기 때문이다.
 *
 * **기본이 펼침이다.** 번역본이 실린 링크는 한국어를 못 읽는 사람에게 나간 것이라, 접힌 채로
 * 두면 그 사람이 읽을 것이 화면에 하나도 없는 상태로 시작한다. 접는 손잡이는 남긴다 —
 * 다 읽은 사람이 종이로 내려가는 길이다.
 *
 * 여기에 읽음 확인을 붙이지 마라. 체크박스·버튼·서명 어느 것도 없다(파일 머리 주석).
 */
export function ContractTranslationCard({ translation, source }: {
  translation: ResolvedContractTranslation
  source?: ContractTemplate | null
}) {
  const [open, setOpen] = useState(true)
  return (
    <div
      className="no-print"
      style={{
        // 폭은 같은 화면 형제 셋(종이 우리·툴바·원어 성명 칸)과 같은 값이다. 안 주면 부모가
        // align-items:center 라 접힘에서는 라벨 폭만큼 줄고 펼침에서는 화면 끝까지 늘어,
        // 접었다 펼 때 폭이 튄다(디자이너 차단 2026-09-08).
        width: 'min(210mm, 100% - 24px)', boxSizing: 'border-box',
        background: 'var(--cream)', border: '1px solid var(--warm-border)', borderRadius: 14,
        // 좌우 패딩도 형제와 같은 14 — 16 이면 글자 좌변이 2px 어긋난다.
        padding: '14px', margin: '0 0 12px',
      }}
    >
      {/* 손잡이 문법은 형제 접힘 행과 같다(RoomStayHistory 등) — 셰브론이 펼침에서 아래를,
          접힘에서 위를 본다. 라벨은 한국어 정본 줄 + 그 언어의 자기 이름이라, 한글을 못 읽는
          사람도 자기 언어가 여기 있다는 것을 라벨만 보고 안다. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--warm-dark)]">
          참고용 번역본 <span className="font-medium text-[var(--warm-muted)]">{TRANSLATION_LANG_ENDONYM[translation.lang]}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={`shrink-0 text-[var(--warm-muted)] transition-transform ${open ? '' : '-rotate-90'}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-3">
        <ContractTranslationBody translation={translation} source={source} />
      </div>}
    </div>
  )
}
