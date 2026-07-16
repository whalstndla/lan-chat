// src/components/ErrorBoundary.jsx
// 렌더러 최상위 에러 경계 — 예기치 못한 렌더링 오류로 화면이 통째로 하얗게(화이트스크린)
// 사라지는 것을 방지한다. 이 앱은 트레이 상주 앱이라 사용자가 창을 오래 띄워두는 경우가
// 많으므로, 크래시 시 최소한 "다시 시작" 경로를 제공해야 한다.
// React 에러 경계는 클래스 컴포넌트로만 구현 가능 (hook 대응 없음).
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] 렌더링 오류:', error, errorInfo)
  }

  handleRestart = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-screen items-center justify-center gap-4 bg-vsc-bg text-vsc-text">
          <p className="text-sm text-vsc-muted">예기치 못한 오류가 발생했습니다.</p>
          <button
            onClick={this.handleRestart}
            className="cursor-pointer px-4 py-2 rounded bg-vsc-accent text-vsc-bg font-semibold text-sm hover:opacity-80 transition-opacity"
          >
            다시 시작
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
