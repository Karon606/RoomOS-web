'use client'

// 호실 수정 폼의 '단독 계약' 세 갈래 칸(가능 / 비거주 계약만 / 불가) — 세그먼트 하나를 hidden 두 칸으로 저장한다.
//
// 2026-10-27 운영자 승인(601~604호). 종전 체크박스 '이 방은 단독 계약이 불가합니다' 하나로는 비거주 계약만
// 혼자 받는 방을 표현할 수 없어서, 602호는 체크를 끄는 임시 조치로 거주 계약까지 혼자 들어가게 열려 있었다.
// 셋은 서로 배타라 체크박스 둘이 아니라 세그먼트다(가이드 §12 '상호배타는 체크박스 금지'). 라벨은 같은 그룹의
// 체크박스 행과 같은 글자(text-xs warm-dark)이고, SegmentedControl sm 과 값별 캡션은 입주자 폼 '일정 조절'을 따르되
// 캡션이 길어 아래 줄에 둔다. 값의 뜻·저장 두 칸은 lib/roomAssignment 가 정본이다.
// 되돌리기는 다른 값을 골라 다시 저장하는 것이다(설정 하나, 즉시 복귀).

import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { standaloneLeaseModeOf, standaloneLeaseFlagsOf, type StandaloneLeaseMode, type StandaloneLeaseFlags } from '@/lib/roomAssignment'

const OPTIONS: { value: StandaloneLeaseMode; label: string }[] = [
  { value: 'ALL', label: '가능' },
  { value: 'NON_RESIDENT_ONLY', label: '비거주 계약만' },
  { value: 'NONE', label: '불가' },
]

const CAPTION: Record<StandaloneLeaseMode, string> = {
  ALL: '이 방 하나로 계약할 수 있습니다',
  // 한 문장 캡션은 형제 '일정 조절'처럼 끝 마침표가 없고, 두 문장 캡션은 한 캡션 안에서 통일해 끝에도 마침표를 둔다.
  NON_RESIDENT_ONLY: '거주 계약은 메인 계약에 묶어야 합니다. 비거주 계약은 이 방 하나로 할 수 있습니다.',
  NONE: '모든 계약을 다른 계약에 묶어야 합니다. 계약 저장 때 메인 계약을 고릅니다.',
}

export function StandaloneLeaseField({ initial }: { initial: StandaloneLeaseFlags }) {
  const [mode, setMode] = useState<StandaloneLeaseMode>(() => standaloneLeaseModeOf(initial))
  const flags = standaloneLeaseFlagsOf(mode)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--warm-dark)]">단독 계약</span>
        <SegmentedControl<StandaloneLeaseMode>
          size="sm"
          ariaLabel="단독 계약"
          options={OPTIONS}
          value={mode}
          onChange={setMode}
        />
      </div>
      <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">{CAPTION[mode]}</p>
      <input type="hidden" name="standaloneLeaseAllowed" value={flags.standaloneLeaseAllowed ? '1' : '0'} />
      <input type="hidden" name="nonResidentStandaloneAllowed" value={flags.nonResidentStandaloneAllowed ? '1' : '0'} />
    </div>
  )
}
