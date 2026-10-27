'use client'

// 작업·청소 폼의 결제수단 상태 한 벌 — 선택지 조회, 업체를 따라 움직이는 기본값, 손으로 고르면 멈춤(2026-10-27).
//
// 기본값 규칙은 서버 정본(lib/workPayDefault)이 낸 표를 고르기만 한다. 같은 업체 직전 지출 → 같은 카테고리 직전 → 영업장 목록 첫 값.
// 이미 걸린 지출에 결제수단이 있으면 그것이 처음 값이다(아는 것을 다시 묻지 않는다). 그때는 업체를 바꿔도 따라 움직이지 않는다.
// 손으로 한 번 고르면 업체를 바꿔도 덮지 않는다. 선택지를 못 받아 오면 칸을 안 세우고 값도 안 보낸다(서버가 같은 규칙으로 채운다).

import { useEffect, useRef, useState } from 'react'
import { getWorkPayOptions, type WorkPayOptions } from '@/app/(app)/room-manage/workPayActions'

type Known = { payMethod: string | null; financialAccountId: string | null } | null | undefined

export function useWorkPay({ kind, enabled, vendor, vendors, known }: {
  kind: 'work' | 'cleaning'
  /** 폼이 열렸고 비용이 있어 칸이 설 자리인가. 처음 참이 될 때 한 번 받아 온다. */
  enabled: boolean
  /** 지금 폼의 업체·사람 이름. 손대기 전에는 기본값이 이 이름을 따라간다. */
  vendor: string
  /** 고를 업체 이름 후보(최근에 맡긴 곳). 서버가 이 이름들의 직전 결제수단을 한 번에 알려 준다. */
  vendors: string[]
  /** 이미 걸린 지출의 결제수단·계정. 있으면 그것이 처음 값이다. */
  known?: Known
}) {
  const [options, setOptions] = useState<WorkPayOptions | null>(null)
  const [base, setBase] = useState<Known>(known)
  const [payMethod, setPayMethod] = useState(known?.payMethod ?? '')
  const [accountId, setAccountId] = useState(known?.financialAccountId ?? '')
  const [touched, setTouched] = useState(!!known?.payMethod)
  const asked = useRef(false)

  // 처음 열릴 때 한 번 받는다. 이름 후보는 여는 순간의 값이다(손으로 적은 새 이름은 표에 없어 fallback 으로 간다).
  useEffect(() => {
    if (!enabled || asked.current) return
    asked.current = true
    getWorkPayOptions(kind, [...vendors, vendor].filter(Boolean)).then(setOptions).catch(() => setOptions(null))
    // 이름이 바뀔 때마다 다시 받지 않는다. 표는 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind])

  // 손대기 전에는 업체를 따라간다. 표에 없는 이름은 업체를 모를 때의 기본값이다.
  const auto = options && !touched ? (options.byVendor[vendor.trim()] ?? options.fallback) : null
  const shownMethod = auto ? auto.payMethod : payMethod
  const shownAccount = auto ? (auto.financialAccountId ?? '') : accountId

  return {
    /** 선택지를 받아 왔는가. false 면 칸을 세우지 않는다. */
    ready: !!options,
    methods: options?.methods ?? [],
    accounts: options?.accounts ?? [],
    payMethod: shownMethod,
    accountId: shownAccount,
    onChange: (m: string, a: string) => { setTouched(true); setPayMethod(m); setAccountId(a) },
    /** 같은 행에서 폼을 다시 열 때 처음 값으로 되돌린다(완료 적용취소 뒤 다시 완료하는 경우). */
    reset: (k: Known) => { setBase(k); setPayMethod(k?.payMethod ?? ''); setAccountId(k?.financialAccountId ?? ''); setTouched(!!k?.payMethod) },
    /** 저장에 실을 값. 선택지를 못 받았으면 비워 보낸다(서버 기본값 규칙). */
    payload: (options && shownMethod ? { payMethod: shownMethod, financialAccountId: shownAccount || null } : {}) as { payMethod?: string; financialAccountId?: string | null },
    /** 처음 값에서 바뀌었는가(수정 폼 dirty 판정). */
    changed: touched && (payMethod !== (base?.payMethod ?? '') || accountId !== (base?.financialAccountId ?? '')),
  }
}
