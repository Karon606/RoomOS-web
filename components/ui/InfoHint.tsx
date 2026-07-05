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
        className="ml-1.5 inline-flex items-center justify-center align-[-2px]"
        style={{ color: 'inherit', opacity: 0.55 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /><path d="M12 7.6h.01" /></svg></button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width="xs" z={z}>
        <div className="p-5 text-sm leading-relaxed text-[var(--warm-dark)]">{children}</div>
      </Modal>
    </>
  )
}
