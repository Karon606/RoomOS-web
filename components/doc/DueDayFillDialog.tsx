'use client'

// 매월 납부일 채움 창 — 계약서 문(진입·서명 요청·발급)이 납부일 없는 계약을 만나면 연다.
//
// 납부일 게이트(설계 D, 2026-09-07)의 화면 짝이다. 서버가 DUE_DAY_REQUIRED 로 거절하면
// 이 창이 열리고, 저장하면 호출부가 하던 일을 이어서 다시 시도한다 — 막다른 거절 금지
// (신고 09da7f29). 값은 표시값이 아니라 **계약 원천**으로 저장된다(setDueDayForContract).

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { setDueDayForContract } from '@/app/(app)/tenants/contractShare'
import { pushToast, trackSave } from '@/lib/saveStatus'

export function DueDayFillDialog({ leaseTermId, defaultDay, onDone, onClose }: {
  leaseTermId: string
  /** 입주일의 날로 미리 채운다(수정 가능). 없으면 빈 칸. */
  defaultDay: string
  onDone: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState(defaultDay)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (saving) return
    setSaving(true)
    const release = trackSave()
    try {
      const res = await setDueDayForContract(leaseTermId, value.trim())
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '납부일 저장됨', {
        detail: res.closedLinks > 0 ? '보낸 서명 링크는 닫혔습니다. 서명 요청을 다시 보내 주세요.' : '이 계약의 매월 납부일로 저장됐습니다.',
      })
      onDone()
    } finally { release(); setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} z={280} width="sm" title="매월 납부일을 정해 주세요">
      <div className="space-y-3">
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
          계약서에 실리는 값이라 비워 둘 수 없습니다. 입주한 날이 기본이고, 다르면 고쳐 주세요.
          입주일과 다른 날을 정하면 첫 달은 그 차이만큼 일할로 계산됩니다.
        </p>
        <div className="space-y-1">
          <label className="text-[0.6875rem] text-[var(--warm-muted)]">매월 납부일</label>
          <input type="text" inputMode="numeric" value={value} onChange={e => setValue(e.target.value)}
            placeholder="예: 5 또는 말일"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] transition-colors" />
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">1부터 31 사이의 숫자 또는 말일.</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" className="flex-1" onClick={onClose}>취소</Btn>
          <Btn variant="primary" size="md" className="flex-1" onClick={() => void save()} disabled={saving || !value.trim()}>저장</Btn>
        </div>
      </div>
    </Modal>
  )
}
