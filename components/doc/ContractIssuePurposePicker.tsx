'use client'

// 발급 용도 고르기 — 실계약 계약서가 이미 있는 계약에서 새 계약서를 뽑을 때 무엇으로 남길지.
//
// 왜 확인창이 아니라 창인가. 고를 것이 셋이라 choiceDialog(확인·제3·취소)에 안 들어간다. 그렇다고
// 확인창을 두 번 잇는 것은 §14 가 막는다("다이얼로그 안 다이얼로그"). 남는 문법이 카드 리스트고,
// 이 저장소에는 같은 모양이 이미 둘 있다 — 서류 보내기의 판본 피커, 계약서 파일의 용도 창.
// 세 번째 문법을 새로 만들 이유가 없어 그 카드를 그대로 쓴다.
//
// 카드를 누르면 곧바로 발급되지 않는다. 탭은 확인창보다 가벼운 제스처라 오탭 한 번이 PDF 발급이
// 되면 안 된다. 카드 탭 다음에 확인 1회가 서고, 그것이 §14 가 허용하는 유일한 연쇄다.
//
// 실계약을 고르면 그 확인창이 곧 운영자가 요구한 질문이다 — "보관용으로 남길거냐고 물어는 봐야지".

import { Modal } from '@/components/ui/Modal'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { ISSUABLE_CONTRACT_PURPOSES, DEFAULT_CONTRACT_PURPOSE } from '@/lib/contractPurpose'

/** 고른 결과 — 저장값이 아니라 표시값이다(호출부가 실계약을 null 로 내린다). */
export type IssuePurposePick = (typeof ISSUABLE_CONTRACT_PURPOSES)[number]

export function ContractIssuePurposePicker({ archiveCount, onPick, onClose }: {
  /** 이 계약에 살아 있는 실계약 부수 — 확인창이 "기존 N부"라고 적는다(서버 실데이터). */
  archiveCount: number
  onPick: (purpose: IssuePurposePick) => void
  onClose: () => void
}) {
  const choose = async (p: IssuePurposePick) => {
    const ok = p === DEFAULT_CONTRACT_PURPOSE
      ? await confirmDialog({
          title: '실계약으로 발급할까요?',
          message: `기존 실계약 ${archiveCount}부는 보관용으로 바뀌고 바뀐 이력이 기록에 남습니다. 발급 뒤에도 각 계약서의 용도에서 되돌릴 수 있습니다.`,
          level: 'caution',
          confirmLabel: '발급',
          // 이 취소는 흐름을 닫지 않고 피커로 돌아간다 — §14 가 '취소'와 가른 그 동작이다.
          cancelLabel: '뒤로',
        })
      : await confirmDialog({
          title: `'${p}' 판본으로 발급할까요?`,
          message: `대표 계약서는 실계약 그대로 남고, 이번 발급본은 ${p}으로 기록됩니다.`,
          confirmLabel: '발급',
          cancelLabel: '뒤로',
        })
    if (ok) onPick(p)
  }

  return (
    <Modal open onClose={onClose} z={280} width="sm" title="어떤 판본으로 발급할까요">
      <div className="space-y-2">
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
          실계약 계약서가 이미 있습니다. 실계약으로 발급하면 기존 실계약은 보관용으로 바뀝니다.
        </p>
        <ul className="space-y-1.5">
          {ISSUABLE_CONTRACT_PURPOSES.map(p => (
            <li key={p}>
              <button type="button" onClick={() => void choose(p)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-3 text-left transition-colors hover:bg-[var(--cream-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--warm-dark)]">{p}</span>
                  {/* 결과가 갈리는 카드에만 캡션을 둔다 — 형제 두 창과 같은 규칙이다. */}
                  {p === DEFAULT_CONTRACT_PURPOSE && (
                    <span className="mt-0.5 block text-[0.65625rem] text-[var(--warm-muted)]">
                      새 대표 계약서가 됩니다. 기존 실계약 <span className="tabular-nums">{archiveCount}</span>부는 보관용으로 바뀝니다.
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
