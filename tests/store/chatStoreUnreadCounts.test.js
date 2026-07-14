// tests/store/chatStoreUnreadCounts.test.js
// useChatStore.setUnreadCounts — get-unread-counts IPC 응답을 기존 상태에 병합하는 로직 검증
import useChatStore from '../../src/store/useChatStore'

beforeEach(() => {
  useChatStore.setState({ unreadCounts: {} })
})

describe('useChatStore — setUnreadCounts', () => {
  it('DB 에서 조회한 안읽은 개수를 그대로 반영한다', () => {
    useChatStore.getState().setUnreadCounts({ peer1: 3, peer2: 1 })
    expect(useChatStore.getState().unreadCounts).toEqual({ peer1: 3, peer2: 1 })
  })

  it('기존에 실시간으로 누적된 unreadCounts 와 병합된다(덮어쓰지 않음)', () => {
    useChatStore.getState().incrementUnread('peer3')
    useChatStore.getState().setUnreadCounts({ peer1: 2 })

    const { unreadCounts } = useChatStore.getState()
    expect(unreadCounts.peer1).toBe(2)
    expect(unreadCounts.peer3).toBe(1)
  })
})
