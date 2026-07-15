// tests/store/chatStoreSendOriginalImages.test.js
// useChatStore.sendOriginalImages — 이미지 압축 대신 원본 전송 여부 토글(#47) 검증.
// localStorage 는 이 프로젝트의 jest(testEnvironment: node) 에는 존재하지 않아, 모듈이
// try/catch 로 안전하게 폴백하는지(기존 mutedRooms/bookmarks 와 동일 패턴)도 함께 확인한다.
import useChatStore from '../../src/store/useChatStore'

describe('useChatStore — sendOriginalImages', () => {
  beforeEach(() => {
    useChatStore.setState({ sendOriginalImages: false })
  })

  it('기본값은 false(압축 적용)이다', () => {
    expect(useChatStore.getState().sendOriginalImages).toBe(false)
  })

  it('setSendOriginalImages 로 값을 바꿀 수 있다', () => {
    useChatStore.getState().setSendOriginalImages(true)
    expect(useChatStore.getState().sendOriginalImages).toBe(true)

    useChatStore.getState().setSendOriginalImages(false)
    expect(useChatStore.getState().sendOriginalImages).toBe(false)
  })

  it('localStorage 접근이 불가능해도(node 테스트 환경) 예외 없이 동작한다', () => {
    expect(() => useChatStore.getState().setSendOriginalImages(true)).not.toThrow()
  })

  it('resetAll 을 호출해도 계정 데이터가 아니므로 초기화되지 않는다(mutedRooms 와 동일 취급)', () => {
    useChatStore.getState().setSendOriginalImages(true)
    useChatStore.getState().resetAll()
    expect(useChatStore.getState().sendOriginalImages).toBe(true)
  })
})
