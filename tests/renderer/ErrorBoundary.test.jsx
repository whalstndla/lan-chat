// tests/renderer/ErrorBoundary.test.jsx
// 렌더러 최상위 에러 경계(ErrorBoundary) 스모크 테스트 — 정상 자식은 그대로 렌더링하고,
// 자식이 렌더 중 예외를 던지면 fallback UI("다시 시작" 버튼)로 전환하는지 확인한다.
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../../src/components/ErrorBoundary'

// 렌더 중 항상 예외를 던지는 테스트용 컴포넌트
function Boom() {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  // React 가 콘솔에 에러를 출력하는 것을 테스트 출력에서 숨기기 위해 매 테스트마다 mock/restore
  let consoleErrorSpy

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('정상 자식 컴포넌트는 그대로 렌더링한다', () => {
    render(
      <ErrorBoundary>
        <p>정상 화면</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('정상 화면')).toBeInTheDocument()
  })

  it('자식이 렌더 중 에러를 던지면 fallback UI("다시 시작" 버튼)를 렌더링한다', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('예기치 못한 오류가 발생했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시작' })).toBeInTheDocument()
  })
})
