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
import { defaultCheckoutCleaningYmd } from '@/lib/checkoutCleaning'
import { kstYmdStr } from '@/lib/kstDate'

// 이 모달들의 입력 껍데기 문법 + §09 focus-visible 링. 링은 MoneyInput 정본과 같은 값이다
// (--input-border-focus · --input-ring-focus). 트리거가 button 이라 focus 가 아니라
// focus-visible 을 건다 — 손가락으로 눌러 연 달력 뒤에까지 링이 남으면 안 된다.
const FIELD_CLS =
  'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] ' +
  'outline-none focus-visible:border-[var(--persimmon)] focus-visible:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors'

/**
 * 청소 예정일 상태. **효과(useEffect)를 쓰지 않는다.**
 *
 * 규칙은 둘이다. 운영자가 아직 안 건드렸으면 퇴실일을 따라 움직이고, 한 번 건드린 뒤에는
 * 퇴실일을 바꿔도 안 따라간다. 이미 적어 둔 값을 덮지 않는다는 형제 판단과 같은 결이다
 * (CleaningRowBody 의 '이미 적어 둔 이름은 덮지 않는다').
 *
 * `picked === null` 이 곧 '아직 안 건드림'이라 값은 그때그때 퇴실일에서 파생된다. 효과로
 * 동기화하면 퇴실일이 바뀔 때마다 setState 가 한 번 더 돌아 렌더가 겹친다.
 * 비운 것('')도 건드린 것이다 — 미정으로 두겠다는 뜻이 퇴실일 변경에 지워지면 안 된다.
 */
export function useCheckoutCleaningDate(moveOutYmd: string) {
  const [picked, setPicked] = useState<string | null>(null)
  const value = picked ?? defaultCheckoutCleaningYmd(moveOutYmd, kstYmdStr())
  /** 폼을 다시 열 때 — 앞서 연 퇴실 건의 선택이 남으면 다음 사람에게 그 날짜가 붙는다. */
  const reset = () => setPicked(null)
  return { value, setValue: setPicked, reset, touched: picked !== null }
}

export function CheckoutCleaningDateField({ value, onChange, moveOutYmd }: {
  /** 'YYYY-MM-DD' 또는 '' (미정). */
  value: string
  onChange: (v: string) => void
  /** 같은 폼의 퇴실일 — 청소는 방이 빈 뒤의 일이라 그 앞은 고를 수 없다. */
  moveOutYmd: string
}) {
  return (
    <div className="space-y-1.5">
      {/* 라벨 문법은 이 모달의 형제 칸들과 같다(12px/500 --warm-mid, 아래 6px).
          '(선택)' 접미는 안 붙인다 — 기본값이 늘 차 있어 비어 있는 칸을 채우라는 말이 아니다. */}
      <label className="text-xs font-medium text-[var(--warm-mid)]">청소 예정일</label>
      <DatePicker
        value={value} onChange={onChange}
        minDate={moveOutYmd || undefined}
        // 비운 상태는 '아직 안 고름'이 아니라 '미정으로 골랐다'라서 값과 같은 색으로 적는다.
        emptyLabel="미정"
        className={FIELD_CLS} />
      {/* 고른 날이 퇴실보다 이르면 말한다(§27.2 검증은 인라인). 값을 고쳐 주지는 않는다 —
          운영자가 넣은 날짜를 화면이 말없이 바꾸면 이 기능이 없애려던 그 일을 다시 하는 것이다.
          닿는 길은 좁다. 달력 격자는 minDate 로 잠겨 있으니, 청소일을 먼저 고른 뒤 퇴실일을
          더 뒤로 옮긴 경우가 남는다. 그때 아무 말도 안 하면 화면만 엄격하고 저장은 느슨해진다. */}
      {/* 색은 `--danger-fg` 다. §12 가 적은 `--tc-d` 는 다크에서 재정의되지 않아 그대로 쓰면
          대비가 1.98:1 이다(실측). 같은 모달의 형제 인라인 오류가 이미 이 토큰을 같은 크기로
          쓰고 있고, 그쪽은 라이트 #A03C2E · 다크 #E08A75 로 갈린다. */}
      {value && moveOutYmd && value < moveOutYmd && (
        <p className="text-[0.6875rem] text-[var(--danger-fg)] leading-relaxed break-keep">
          퇴실일보다 이른 날짜입니다. 이대로 저장됩니다.
        </p>
      )}
      {/* §11 보조줄(10.5px --warm-muted). 비웠을 때 무슨 일이 생기는지를 두 상태 모두에서 말한다 —
          누르기 전에 대가를 모르면 그 선택은 고른 것이 아니다. 비우는 길은 달력 안에 있는데,
          그 버튼 이름이 '초기화'라 문장이 그 이름을 그대로 불러야 찾을 수 있다(세그먼트를 안
          세운 근거가 통째로 이 한 문장에 걸려 있다). */}
      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
        {value
          ? '이 날짜로 퇴실 청소 예정이 만들어집니다. 달력의 ‘초기화’를 누르면 날짜 없이 만들어집니다.'
          : '날짜 없이 만들어집니다. 호실 관리 ‘청소’ 목록에는 남지만 입퇴실 캘린더에는 서지 않습니다.'}
      </p>
    </div>
  )
}
