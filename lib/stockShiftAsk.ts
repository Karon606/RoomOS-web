// 재고 원장 조정 확인 다이얼로그 공용 정본 — 영향받는 점검을 실제 숫자로 나열하고 운영자가 고르게 한다.
// 무상 입수(InventoryClient askLedgerShift)와 지출 수정·삭제(FinanceClient)가 같은 문법을 쓴다 —
// 문구·행 형식이 화면마다 갈라지면 같은 사건이 다른 일처럼 읽힌다(웹디자이너 패널 2026-08-19).
// 조용한 덮어쓰기는 하지 않는다. 어긋나는 점검이 0건이면 아무것도 묻지 않는다(소음 최소).
import { choiceDialog, confirmDialog } from '@/components/ui/ConfirmDialog'
import { fmtDateDot } from '@/lib/fmtDate'

export type ShiftAskResult = { adjust: boolean; asked: boolean; count: number } | null

const fmtShiftQty = (n: number, unit: string | null): string => {
  const rounded = Math.round(n * 100) / 100
  return `${rounded}${unit ?? ''}`
}

// 미리보기 행(서버 계획)을 받아 3지선다(함께 조정/이 기록만/취소)로 묻는다.
// rows 가 비면 묻지 않고 { adjust: false, asked: false } 를 돌려준다.
export async function askShiftRows(input: {
  rows: { date: string; storedTotal: number; nextTotal: number }[]
  title: string
  keepLine: string                      // 이번 변경으로 바뀌지 않는 것 한 줄
  impactLine: (n: number) => string     // 무엇이 어긋났는지 한 줄
  tailLine?: string                     // 마지막 안내 한 줄(기본: 실측 우선 안내)
  unit: string | null
  confirmLabel?: string                 // 기본 '함께 조정'
  altLabel?: string                     // 기본 '이 기록만'
}): Promise<ShiftAskResult> {
  if (input.rows.length === 0) return { adjust: false, asked: false, count: 0 }
  const shown = input.rows.slice(0, 4)
  const lines = shown.map(r => `· ${fmtDateDot(r.date)} 점검 ${fmtShiftQty(r.storedTotal, input.unit)} 에서 ${fmtShiftQty(r.nextTotal, input.unit)} 으로`)
  if (input.rows.length > shown.length) lines.push(`· 그 밖에 ${input.rows.length - shown.length}건`)
  const choice = await choiceDialog({
    title: input.title,
    level: 'caution',
    message: [
      input.keepLine,
      input.impactLine(input.rows.length),
      lines.join('\n'),
      input.tailLine ?? '실제로 세어 적은 값이면 조정하지 말고 이 기록만 바꾸세요. 직후 적용취소로 되돌릴 수 있습니다.',
    ].join('\n'),
    confirmLabel: input.confirmLabel ?? '함께 조정',
    altLabel: input.altLabel ?? '이 기록만',
    cancelLabel: '취소',
  })
  if (choice === null || choice === 'back') return null
  return { adjust: choice === 'confirm', asked: true, count: input.rows.length }
}

// 조정이 필수인 물음(수령 취소) — '이 기록만' 선택지가 없다. 취소 없이 조정만 빼면
// 재수령 때 같은 수량이 이중 가산되는 바로 그 구멍이라 두 갈래(진행/취소)만 둔다.
export async function askShiftRowsRequired(input: {
  rows: { date: string; storedTotal: number; nextTotal: number }[]
  title: string
  keepLine: string
  impactLine: (n: number) => string
  tailLine?: string
  unit: string | null
  confirmLabel: string
}): Promise<{ count: number } | null> {
  if (input.rows.length === 0) return { count: 0 }
  const shown = input.rows.slice(0, 4)
  const lines = shown.map(r => `· ${fmtDateDot(r.date)} 점검 ${fmtShiftQty(r.storedTotal, input.unit)} 에서 ${fmtShiftQty(r.nextTotal, input.unit)} 으로`)
  if (input.rows.length > shown.length) lines.push(`· 그 밖에 ${input.rows.length - shown.length}건`)
  const ok = await confirmDialog({
    title: input.title,
    level: 'caution',
    message: [
      input.keepLine,
      input.impactLine(input.rows.length),
      lines.join('\n'),
      ...(input.tailLine ? [input.tailLine] : []),
    ].join('\n'),
    confirmLabel: input.confirmLabel,
    cancelLabel: '취소',
  })
  return ok ? { count: input.rows.length } : null
}
