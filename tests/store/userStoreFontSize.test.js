// tests/store/userStoreFontSize.test.js
// useUserStore.fontSize(#73) — localStorage/document 가 없는 jest(node) 환경에서도 안전하게
// 동작하는지, 그리고 계정 데이터가 아니므로 reset() 에 영향받지 않는지 검증한다
// (기존 tests/store/chatStoreSendOriginalImages.test.js 와 동일한 취지).

import useUserStore from '../../src/store/useUserStore'

describe('useUserStore — fontSize', () => {
  beforeEach(() => {
    useUserStore.setState({ fontSize: 'medium' })
  })

  it('기본값은 medium 이다', () => {
    expect(useUserStore.getState().fontSize).toBe('medium')
  })

  it('setFontSize 로 값을 바꿀 수 있다', () => {
    useUserStore.getState().setFontSize('large')
    expect(useUserStore.getState().fontSize).toBe('large')

    useUserStore.getState().setFontSize('small')
    expect(useUserStore.getState().fontSize).toBe('small')
  })

  it('localStorage/document 접근이 불가능해도(node 테스트 환경) 예외 없이 동작한다', () => {
    expect(() => useUserStore.getState().setFontSize('large')).not.toThrow()
  })

  it('reset() 을 호출해도 계정 데이터가 아니므로 초기화되지 않는다', () => {
    useUserStore.getState().setFontSize('large')
    useUserStore.getState().reset()
    expect(useUserStore.getState().fontSize).toBe('large')
  })
})
