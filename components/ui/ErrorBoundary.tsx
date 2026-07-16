'use client'

// 렌더 오류 그물 — 하위 트리에서 예외가 나면 조용한 크래시(모달 사라짐 등) 대신 안내를 띄우고
// 오류신고 자취(recordCrumb)에 기록한다. React 렌더 오류는 window error 훅에 안 잡혀 자동 캡처가
// 안 되므로(오류신고 0861b35f 사례), 이 경계가 그 공백을 메워 재발 시 진단 가능하게 한다.

import { Component, type ReactNode } from 'react'
import { recordCrumb } from '@/lib/errorBreadcrumbs'

type Props = {
  children: ReactNode
  label?: string                          // 자취·안내에 붙는 위치 이름
  resetKey?: unknown                      // 값이 바뀌면 에러 상태를 자동 초기화(예: 탭·모드 전환)
  fallback?: (message: string, reset: () => void) => ReactNode
}
type State = { error: Error | null; lastResetKey: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, lastResetKey: this.props.resetKey }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // resetKey가 바뀌면(모드·탭 전환) 이전 에러를 지우고 다시 렌더 시도.
    if (props.resetKey !== state.lastResetKey) return { error: null, lastResetKey: props.resetKey }
    return null
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error) {
    const where = this.props.label ? ` [${this.props.label}]` : ''
    recordCrumb('error', `render${where}: ${error.name}: ${error.message}`)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error.message, this.reset)
    return (
      <div className="px-5 py-8 text-center space-y-2">
        <p className="text-sm font-medium text-[var(--warm-dark)]">이 화면을 여는 중 오류가 발생했습니다.</p>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] break-all">{error.message}</p>
        <button type="button" onClick={this.reset}
          className="mt-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
          다시 시도
        </button>
        <p className="text-[0.625rem] text-[var(--warm-muted)]">계속되면 우측 상단 오류 신고로 알려주시면 원인을 담아 전달됩니다.</p>
      </div>
    )
  }
}
