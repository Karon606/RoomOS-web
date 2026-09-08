'use client'

// 서명 요청 안내 언어 고르기 — 외국인 입주자에게 링크를 보낼 때 안내문을 무슨 언어로 붙일지.
//
// 국적으로 계산한 기본값이 미리 표시되고, 운영자가 바꿔 보낼 수 있다. 김명화님처럼 국적은
// 중국이어도 한국어가 편한 분이 있어서다(운영자 지시 2026-09-06). 고른 언어는 링크 스냅샷에
// 박제돼 입주자가 여는 화면·문자·오류 안내가 전부 그 언어로 병기된다(한국어 정본 줄 + 그 언어).
//
// 카드 리스트 문법은 발급 용도 피커(ContractIssuePurposePicker)와 같다 — 고를 것이 일곱이라
// 확인창에 안 들어간다. 탭 즉시 진행하는 이유는 그쪽과 다르다. 언어 선택은 파괴적이지 않고
// (다시 보내면 그만이다) 뒤에 문자 앱이 한 번 더 서기 때문에 확인을 겹치면 §14 연쇄가 된다.
//
// 참고용 번역본 진행을 캡션으로 함께 보여준다(운영자 오더 2026-09-08). 그 언어의 번역이
// 반쯤 된 것을 모르고 보내면, 입주자 화면에는 절반이 한국어 원문으로 남은 번역본이 뜬다.
// **고르는 것을 막지는 않는다** — 미완인 언어로 보낼지는 운영자가 정한다. 캡션만이다.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SIGN_LANGS, SIGN_LANG_LABEL, type SignLang } from '@/lib/signGuideText'
import { getContractTranslationSettings } from '@/app/(app)/settings/actions'
import { getContractTranslationAddenda } from '@/app/contract/[tenantId]/actions'
import { asTranslationLang, translationProgress } from '@/lib/contractTranslation'

/** 언어별 캡션. 번역본을 안 쓰는 영업장에서는 통째로 비어 이 피커가 종전과 같은 화면이다. */
type LangCaptions = Partial<Record<SignLang, string>>

/**
 * @param tenantId 링크를 보낼 계약의 입주자. 캡션의 분모를 **그 계약에 실릴 절**로 좁히는 데
 *   쓴다 — 영업장이 쓸 수 있는 전부로 세면 다 번역한 언어가 영영 '26/34' 로 보인다.
 *   안 주면 영업장 기준으로 떨어진다(캡션은 보조 정보라 못 세는 상황에서 막지 않는다).
 * @param leaseTermId 그 계약 지목. 없으면 서버가 링크 발급과 **같은 추론**으로 고른다.
 */
export function SignRequestLangPicker({ defaultLang, tenantId, leaseTermId, onPick, onClose }: {
  defaultLang: SignLang
  tenantId?: string
  leaseTermId?: string | null
  onPick: (lang: SignLang) => void
  onClose: () => void
}) {
  const [captions, setCaptions] = useState<LangCaptions>({})

  useEffect(() => {
    let alive = true
    // 분모는 **그 계약에 실릴 절**이라 발급과 같은 조립에서 따로 가져온다. 지목이 없으면
    // 영업장이 쓸 수 있는 전부로 떨어진다 — 캡션이 실제보다 미완으로 보일 뿐 막지는 않는다.
    Promise.all([
      getContractTranslationSettings(),
      tenantId ? getContractTranslationAddenda(tenantId, leaseTermId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([r, mine]) => {
        if (!alive) return
        // 운영 스위치가 꺼져 있으면 어느 언어에도 번역본이 안 실린다. 그때 언어마다 '번역본 없음'을
        // 다는 것은 안 쓰는 기능을 일곱 줄로 광고하는 것이라, 캡션 자체를 안 만든다.
        if (!r.translations.enabled) return
        const next: LangCaptions = {}
        for (const l of SIGN_LANGS) {
          const lang = asTranslationLang(l)
          if (!lang) continue   // 한국어는 정본이라 번역 대상이 아니다
          // 분모는 **그 계약에 실릴 것**이다. 서버가 링크 발급과 같은 조립으로 골라 준다.
          const p = translationProgress(r.translations, r.template, lang, mine ?? r.addenda)
          // 세 상태를 갈라 말한다. '비공개'와 '없음'을 한 문장으로 묶으면, 다 번역해 두고
          // 공개만 안 켠 언어에 대해 화면이 "없다"고 거짓을 말한다.
          next[l] = !p.hasEntry ? '번역본 없음'
            : p.published ? `번역 ${p.done}/${p.total}`
            : `비공개 · 번역 ${p.done}/${p.total}`
        }
        setCaptions(next)
      })
      .catch(() => { /* 캡션은 보조 정보다 — 못 읽어도 언어 선택은 그대로 된다 */ })
    return () => { alive = false }
  }, [tenantId, leaseTermId])

  return (
    <Modal open onClose={onClose} z={280} width="sm" title="안내를 무슨 언어로 보낼까요">
      <div className="space-y-2">
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
          계약서 본문은 한국어 그대로이고, 문자와 서명 화면의 안내문에 고른 언어가 함께 붙습니다.
        </p>
        <ul className="space-y-1.5">
          {SIGN_LANGS.map(l => (
            <li key={l}>
              <button type="button" onClick={() => onPick(l)}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-colors hover:bg-[var(--cream-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)] bg-[var(--cream)] ${l === defaultLang ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--warm-dark)]">{SIGN_LANG_LABEL[l]}</span>
                  {/* 캡션은 한 줄로 잇는다. 기본값 언어에 번역 진행까지 있으면 두 줄로 쌓여
                      카드 높이가 그 언어만 달라진다(디자이너 지적 2026-09-08).
                      숫자는 tabular-nums — 언어마다 자릿수가 달라 세로줄이 흔들린다(§11). */}
                  {(l === defaultLang || captions[l]) && (
                    <span className="mt-0.5 block text-[0.6875rem] text-[var(--warm-muted)] tabular-nums">
                      {[l === defaultLang ? '국적 기본값' : '', captions[l] ?? ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
