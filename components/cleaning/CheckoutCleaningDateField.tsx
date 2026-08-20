'use client'

// 퇴실 미니폼의 '청소 예정일' 칸 정본 — 퇴실 경로 둘(홈 알림·입주자 상세)이 이 한 벌을 쓴다.
//
// 왜 컴포넌트로 뺐나. 퇴실 처리를 하는 자리가 둘이고, 칸을 두 번 지으면 라벨·기본값·안내
// 문구가 갈린다. 갈린 순간 같은 퇴실인데 어느 화면에서 눌렀느냐로 청소 예정일이 달라진다.
// CleaningRowBody 가 같은 이유로 행을 정본 컴포넌트로 만든 그 처방이다.
//
// 세그먼트('날짜 지정 / 미정')를 세우지 않는다. 셋을 재 보고 내린 결정이다.
//   ① 정본 SegmentedControl 은 30px 이고 --tc 보더가 없어 §12 가 묘사한 세그먼트(36px,
//      선택 --cream + 보더 --tc)와 이미 어긋난다. 한 벌 더 쓰면 그 부채를 복제한다.
//   ② role 이 tablist/tab 이라 폼 필드에 맞지 않고(§25 는 필터·뷰 전환용으로 못박는다)
//      화살표 키 핸들러가 없어 tablist 가 약속하는 동작도 안 지킨다.
//   ③ 이 모달은 소프트 키보드가 열리면 본문 가시 창이 280px 남는다. 컨트롤 한 줄(36px)이
//      그 창의 13% 다. 같은 창 때문에 이미 신고가 셋 있었다.
// 비우는 길은 이미 달력 안에 있다(값이 있을 때 뜨는 '초기화'). 없는 문법을 새로 만들 이유가
// 없고, 형제 정본 CleaningPlanForm 의 예정일도 라벨 + DatePicker 한 줄이다.

import { useState } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'

// 이 모달들의 입력 껍데기 문법 + §09 focus-visible 링. 링은 MoneyInput 정본과 같은 값이다
// (--input-border-focus · --input-ring-focus). 트리거가 button 이라 focus 가 아니라
// focus-visible 을 건다 — 손가락으로 눌러 연 달력 뒤에까지 링이 남으면 안 된다.
const FIELD_CLS =
  'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] ' +
  'outline-none focus-visible:border-[var(--persimmon)] focus-visible:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors'

/**
 * 청소 예정일 상태. **앱이 날짜를 제안하지 않는다.**
 *
 * 빈 칸으로 시작하고 운영자가 적은 날이 곧 예정일이다(운영자 확정 2026-08-21). 종전에는
 * 퇴실일에서 기본값을 파생해 두고 안 건드리면 따라 움직이게 했는데, 그 제안은 아무도 약속한
 * 적 없는 날이라 그 다음 날부터 '예정일 경과' 가 거짓으로 떴다.
 */
export function useCheckoutCleaningDate() {
  const [value, setValue] = useState('')
  /** 폼을 다시 열 때 — 앞서 연 퇴실 건의 선택이 남으면 다음 사람에게 그 날짜가 붙는다. */
  const reset = () => setValue('')
  return { value, setValue, reset, touched: value !== '' }
}

export function CheckoutCleaningDateField({ value, onChange }: {
  /** 'YYYY-MM-DD' 또는 '' (미정). */
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {/* 라벨 문법은 이 모달의 형제 칸들과 같다(12px/500 --warm-mid, 아래 6px).
          비워 두는 것이 정상 상태라 '(선택)' 을 붙인다. */}
      <label className="text-xs font-medium text-[var(--warm-mid)]">청소 예정일 (선택)</label>
      {/* minDate 를 걸지 않는다 — 퇴실 전 청소도 정당한 일정이다(운영자 확정 2026-08-21).
          "퇴실 당일에도 청소할 수 있는거고 퇴실 전에 청소도 필요하면 하는거지." */}
      <DatePicker
        value={value} onChange={onChange}
        // 비운 상태는 '아직 안 고름'이 아니라 '미정으로 골랐다'라서 값과 같은 색으로 적는다.
        emptyLabel="미정"
        className={FIELD_CLS} />
      {/* §11 보조줄(10.5px --warm-muted). 비웠을 때 무슨 일이 생기는지를 두 상태 모두에서 말한다 —
          누르기 전에 대가를 모르면 그 선택은 고른 것이 아니다. 비우는 길은 달력 안에 있는데,
          그 버튼 이름이 '초기화'라 문장이 그 이름을 그대로 불러야 찾을 수 있다(세그먼트를 안
          세운 근거가 통째로 이 한 문장에 걸려 있다). */}
      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
        {value
          ? '이 날짜로 퇴실 청소 예정이 만들어집니다. 달력의 ‘초기화’를 누르면 날짜 없이 만들어집니다.'
          : '비워 두면 날짜 없이 만들어집니다. 호실 관리 ‘청소’ 목록에는 남지만 캘린더에는 서지 않습니다.'}
      </p>
    </div>
  )
}
