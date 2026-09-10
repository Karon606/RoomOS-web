'use client'

// 손으로 고친 표시값 목록 — 어느 칸이 자동값을 벗어났는지 보이고 칸 단위로 되돌린다(계약서·실거주 확인서 공용).
//
// 왜 한 컴포넌트인가. 두 화면이 말하는 것은 **같은 사실**이다 — "이 칸은 자동으로 따라오지 않는다".
// 두 벌로 지으면 한쪽만 고쳐졌을 때 같은 뜻이 두 모양으로 서고, 그 어긋남은 종전 배지에서
// 이미 한 번 났다(.rc-badge 주석의 "같은 뜻이 두 화면에서 다르게 보이면 안 된다").
//
// **규칙은 여기 없다.** 무엇이 고쳐진 칸인지, 자동값이 무엇인지는 각 화면의 서버 쪽 정본이 낸다
// (계약서 = lib/contractData 의 overriddenFieldKeys·fieldAuto, 확인서 = lib/documentFieldOverrides).
// 두 화면의 칸 집합이 아예 다르므로 이 파일은 받은 행을 그리기만 한다.

import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { RotateCcw } from '@/components/ui/RotateCcw'

/** 목록 한 줄 — 어떤 칸이, 지금 무엇으로 찍히고, 안 고쳤다면 무엇이었을지. */
export type FieldOverrideRow = {
  key: string
  label: string
  /** 지금 종이에 찍히는 값. 잠긴 서류에서는 박제된 값이다. */
  current: string
  /** 오버라이드를 벗겼을 때의 값. 빈 칸이면 호출부가 '빈칸' 같은 말을 담아 넘긴다. */
  auto: string
}

/** 마지막 음절에 받침이 있는가 — 한글 음절이 아니면 없는 것으로 본다(외자·기호 라벨 방어). */
function hasFinalConsonant(label: string): boolean {
  const t = label.trim()
  if (!t) return false
  const c = t.charCodeAt(t.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return false
  return (c - 0xac00) % 28 !== 0
}

/**
 * 되돌린 뒤의 결과 토스트(§16 "적용취소 후에도 결과 토스트").
 *
 * 두 화면이 같은 문장을 쓰게 문장을 여기 둔다 — 각자 조립하면 한쪽만 칸 이름을 바꿔도 갈린다.
 */
export function fieldUndoneMessage(label: string): string {
  return `${label}${hasFinalConsonant(label) ? '을' : '를'} 적용취소했습니다 · 자동값으로 복귀`
}

/**
 * §16 적용취소 아이콘은 components/ui/RotateCcw 가 정본이다. 여기서 다시 export 하는 것은
 * 이 경로로 import 하던 자리들이 그대로 돌게 두기 위함이고, 새 자리는 정본 경로를 쓴다.
 */
export { RotateCcw }

export function FieldOverrideListModal({
  open, onClose, rows, onUndo, undoingKey = null, lockMessage,
}: {
  open: boolean
  onClose: () => void
  rows: FieldOverrideRow[]
  /** 없으면 되돌리기 자리를 안 그린다. 잠긴 서류가 그 경우이고, 이유는 lockMessage 가 맡는다. */
  onUndo?: (row: FieldOverrideRow) => void
  undoingKey?: string | null
  /**
   * 잠겨 있다면 그 이유 한 문장. **칸을 눌렀을 때 뜨는 토스트와 같은 문구여야 한다** —
   * 같은 잠금을 두 문장으로 설명하면 운영자는 서로 다른 해결책을 듣는다(lib/contractLockMessage).
   */
  lockMessage?: string
}) {
  return (
    <Modal open={open} onClose={onClose} width="xs" title="직접 입력한 표시값">
      <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
        이 칸들은 손으로 넣은 값이라 입실자 정보를 고쳐도 따라오지 않습니다.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map(row => (
          <li key={row.key}
            className="rounded-md border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--warm-dark)]">{row.label}</span>
              {/* §16 원위치 진입점 — btn-subtle sm + rotate-ccw. 잠기면 자리 자체가 없다.
                  **되돌리는 동안 전 행을 잠근다.** 누른 행만 잠그면 다른 행을 눌렀을 때
                  호출부의 진행 가드가 아무 말 없이 삼켜, 화면이 무반응이 된다(§27.2).
                  라벨은 '적용취소' 로 고정한다 — 글자가 길어지면 §10 '너비 고정' 을 어기고
                  행마다 버튼 폭이 뛴다. 진행은 aria-busy 와 잠김 상태가 알린다. */}
              {onUndo && (
                <Btn variant="subtle" size="sm" disabled={undoingKey !== null}
                  aria-busy={undoingKey === row.key} onClick={() => onUndo(row)}>
                  <RotateCcw />
                  적용취소
                </Btn>
              )}
            </div>
            {/* 두 값에 다 이름을 붙인다. 주소처럼 긴 값이 줄바꿈되면 이름 없는 쪽이 어느 것인지
                사라진다 — '자동값' 만 붙어 있으면 위 줄이 지금 값이라는 근거가 배치뿐이다. */}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[0.8125rem] tabular-nums text-[var(--warm-dark)]">
                <span className="text-[0.6875rem] text-[var(--warm-muted)]">지금 </span>{row.current}
              </span>
              <span className="text-[0.6875rem] tabular-nums text-[var(--warm-muted)]">
                자동값 {row.auto}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {lockMessage && (
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">{lockMessage}</p>
      )}
    </Modal>
  )
}
