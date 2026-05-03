'use client'

import React from 'react'

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-8 text-center space-y-2 ${className}`}>
      {icon && <div className="text-3xl mb-1 opacity-60">{icon}</div>}
      <p className="text-sm text-[var(--warm-dark)] font-medium">{title}</p>
      {description && <p className="text-xs text-[var(--warm-muted)] leading-relaxed">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}
