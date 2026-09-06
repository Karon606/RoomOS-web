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

import { Modal } from '@/components/ui/Modal'
import { SIGN_LANGS, SIGN_LANG_LABEL, type SignLang } from '@/lib/signGuideText'

export function SignRequestLangPicker({ defaultLang, onPick, onClose }: {
  defaultLang: SignLang
  onPick: (lang: SignLang) => void
  onClose: () => void
}) {
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
                  {l === defaultLang && (
                    <span className="mt-0.5 block text-[0.6875rem] text-[var(--warm-muted)]">국적 기본값</span>
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
