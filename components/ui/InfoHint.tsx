'use client'

// 페이지·섹션 설명을 ? 아이콘 뒤로 — 헤더를 가볍게(운영자 지시 2026-07-06).
// 홈 KPI 라벨의 ? 버튼과 동일 문법(원형 ?, 탭 → 설명 모달) — 앱 전체에서 "?"는 설명이라는 하나의 약속.
import { useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'

export function InfoHint({ title, children, z }: {
  title: string
  children: ReactNode
  z?: 200 | 260 | 280
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-label={`${title} 설명 보기`}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full align-[-2px] text-[0.625rem] font-bold"
        style={{ background: 'rgba(127,127,127,0.22)', color: 'inherit' }}>?</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width="xs" z={z}>
        <div className="p-5 text-sm leading-relaxed text-[var(--warm-dark)]">{children}</div>
      </Modal>
    </>
  )
}
