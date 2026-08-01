'use client'

// 입력한 날짜가 이번 달이 아닐 때만 뜨는 한 줄 안내 — 지출·부가수익은 '입력하는 화면의 달'과
// '반영되는 달'이 갈리는데 화면에 그 사실이 없었다(A페이즈, UX 라이터 설계).
// 확인창은 과잉이다(하루 수십 건 입력을 막는다) — 저장 흐름을 끊지 않는 인라인 캡션으로 둔다.
// 이번 달이면 아무것도 그리지 않는다. 항상 뜨는 문구는 읽히지 않는다.

import { kstMonthOf } from '@/lib/fmtDate'

export function OtherMonthNotice({ date }: { date: string | null | undefined }) {
  if (!date) return null
  const mon = kstMonthOf(date)
  if (!mon) return null
  const now = kstMonthOf(new Date())
  if (mon === now) return null
  const label = Number(mon.split('-')[1])
  // 색은 보조(warm-muted) — 다른 달 날짜는 정상 입력이라 경고색이면 오입력처럼 읽힌다.
  // 문장도 하나로 — 반폭 셀에서 두 문장은 3~4줄로 접힌다(디자이너 패스).
  return (
    <p className="text-[0.65625rem] text-[var(--warm-muted)]">{label}월 손익에 반영됩니다.</p>
  )
}
