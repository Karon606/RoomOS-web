'use client'

import { useState } from 'react'

const PYEONG_TO_M2 = 3.30579

export function AreaInput({
  defaultPyeong, defaultM2
}: {
  defaultPyeong?: number | null
  defaultM2?: number | null
}) {
  const [pyeong, setPyeong] = useState(defaultPyeong?.toString() ?? '')
  const [m2, setM2] = useState(defaultM2?.toString() ?? '')

  const handlePyeong = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setPyeong(val)
    const num = parseFloat(val)
    if (!isNaN(num)) setM2((num * PYEONG_TO_M2).toFixed(2))
    else setM2('')
  }

  const handleM2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setM2(val)
    const num = parseFloat(val)
    if (!isNaN(num)) setPyeong((num / PYEONG_TO_M2).toFixed(2))
    else setPyeong('')
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (평)</label>
        <input
          type="text" name="areaPyeong" value={pyeong}
          onChange={handlePyeong} placeholder="0.0"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (m²)</label>
        <input
          type="text" name="areaM2" value={m2}
          onChange={handleM2} placeholder="0.0"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]" />
      </div>
    </div>
  )
}