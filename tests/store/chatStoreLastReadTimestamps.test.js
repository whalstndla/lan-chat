// tests/store/chatStoreLastReadTimestamps.test.js
// useChatStore.lastReadTimestamps — 방별 마지막 읽은 지점 저장/병합 로직 검증(#39).
// DB 하이드레이션(setLastReadTimestamps) 은 기존 값을 덮어쓰지 않고 병합해야 한다 —
// useChatSubscriptions 가 부팅 시 호출하는 시점에 ChatWindow 가 이미 이번 세션에서
// 캡처한 값이 있을 수 있기 때문이다(레이스는 아니지만 병합 안전성은 보장해야 함).
import useChatStore from '../../src/store/useChatStore'

describe('useChatStore — lastReadTimestamps', () => {
  beforeEach(() => {
    useChatStore.setState({ lastReadTimestamps: {} })
  })

  it('setLastReadTimestamps 로 DB 에서 조회한 값을 일괄 반영한다', () => {
    useChatStore.getState().setLastReadTimestamps({ global: 1000, 'peer-1': 2000 })

    expect(useChatStore.getState().lastReadTimestamps).toEqual({ global: 1000, 'peer-1': 2000 })
  })

  it('setLastReadTimestamps 는 기존 값과 병합된다(덮어쓰지 않음)', () => {
    useChatStore.getState().setLastReadTimestamp('peer-2', 500)
    useChatStore.getState().setLastReadTimestamps({ global: 1000 })

    const { lastReadTimestamps } = useChatStore.getState()
    expect(lastReadTimestamps.global).toBe(1000)
    expect(lastReadTimestamps['peer-2']).toBe(500)
  })

  it('setLastReadTimestamp 로 방 하나의 값만 갱신한다', () => {
    useChatStore.getState().setLastReadTimestamp('global', 1000)
    useChatStore.getState().setLastReadTimestamp('global', 5000)

    expect(useChatStore.getState().lastReadTimestamps.global).toBe(5000)
  })

  it('timestamp 로 null 을 저장할 수 있다(메시지가 아직 없는 방)', () => {
    useChatStore.getState().setLastReadTimestamp('peer-new', null)

    expect(useChatStore.getState().lastReadTimestamps['peer-new']).toBeNull()
  })

  it('resetAll 호출 시 lastReadTimestamps 도 초기화된다', () => {
    useChatStore.getState().setLastReadTimestamp('global', 1000)
    useChatStore.getState().resetAll()

    expect(useChatStore.getState().lastReadTimestamps).toEqual({})
  })
})
