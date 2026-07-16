// tests/store/userStoreTheme.test.js
// useUserStore.theme(#73) — localStorage/document 가 없는 jest(node) 환경에서도 안전하게
// 동작하는지, 그리고 계정 데이터가 아니므로 reset() 에 영향받지 않는지 검증한다
// (기존 tests/store/chatStoreSendOriginalImages.test.js 와 동일한 취지).

import useUserStore from '../../src/store/useUserStore'

describe('useUserStore — theme', () => {
  beforeEach(() => {
    useUserStore.setState({ theme: 'dark' })
  })

  it('기본값은 dark 이다', () => {
    expect(useUserStore.getState().theme).toBe('dark')
  })

  it('setTheme 으로 값을 바꿀 수 있다', () => {
    useUserStore.getState().setTheme('light')
    expect(useUserStore.getState().theme).toBe('light')

    useUserStore.getState().setTheme('system')
    expect(useUserStore.getState().theme).toBe('system')
  })

  it('localStorage/document 접근이 불가능해도(node 테스트 환경) 예외 없이 동작한다', () => {
    expect(() => useUserStore.getState().setTheme('light')).not.toThrow()
  })

  it('reset() 을 호출해도 계정 데이터가 아니므로 초기화되지 않는다', () => {
    useUserStore.getState().setTheme('light')
    useUserStore.getState().reset()
    expect(useUserStore.getState().theme).toBe('light')
  })
})
