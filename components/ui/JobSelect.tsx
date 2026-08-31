'use client'
// 입주자 직업 선택 — 목록 끝 '기타(직접 입력)'으로 전환되는 정본 문법(CategorySelect)을 쓴다.
//
// 종전에는 자체 드롭다운 패널이었고 두 가지가 문제였다.
//
// 첫째, 패널이 트리거 폭을 그대로 물려받아(w-full) 좁은 칸에서는 '직접 추가' 입력칸의 실제 폭이
// 20px 남짓이었다. 글자를 쳐도 보이지 않는다는 운영자 지적이 그것이다(2026-08-31). 정본 문법은
// 입력할 때 칸 전체가 입력칸이 되므로 그 문제가 구조적으로 없다.
//
// 둘째, 직접 추가한 직업이 브라우저 localStorage 에만 남았다. 기기를 바꾸면 없고 브라우저
// 데이터를 지우면 사라졌다. 같은 성격의 요청·지출 카테고리는 처음부터 영업장 설정에 있었다.
// 이제 목록도 서버가 쥔다.
//
// 바깥 계약(name·defaultValue·placeholder)은 그대로 두었다 — 쓰는 폼이 한 글자도 안 바뀐다.

import { useState, useEffect } from 'react'
import CategorySelect from '@/components/ui/CategorySelect'
import { getJobOptions, addJobOption } from '@/app/(app)/settings/actions'

/** 옛 저장 자리 — 한 번 서버로 옮기고 지운다. */
const LEGACY_KEY = 'stayeum_custom_jobs'

interface JobSelectProps {
  name: string
  defaultValue?: string | null
  placeholder?: string
}

export function JobSelect({ name, defaultValue, placeholder = '직업 선택' }: JobSelectProps) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [options, setOptions] = useState<string[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      // 브라우저에 남은 옛 목록을 한 번만 서버로 옮긴다. 운영자가 이미 추가해 둔 직업이
      // 이 전환으로 사라지면 안 된다(실기에서 '프로그래머'·'봉제'가 확인됐다).
      try {
        const raw = localStorage.getItem(LEGACY_KEY)
        if (raw) {
          const legacy = JSON.parse(raw) as string[]
          if (Array.isArray(legacy)) for (const j of legacy) await addJobOption(j)
          localStorage.removeItem(LEGACY_KEY)
        }
      } catch { /* 옛 값이 깨져 있어도 목록 조회는 이어간다 */ }
      const list = await getJobOptions()
      if (live) setOptions(list)
    })()
    return () => { live = false }
  }, [])

  // 저장된 값이 목록에 없으면 정본이 알아서 입력 모드로 연다(하위호환이 공짜로 딸려 온다).
  return (
    <CategorySelect
      name={name}
      value={value}
      onChange={setValue}
      options={options}
      emptyLabel={placeholder}
      placeholder="직업을 직접 입력하세요"
      showAddHint
      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] min-h-[var(--input-h-touch)] sm:min-h-0"
    />
  )
}
