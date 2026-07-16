// tests/store/chatStoreReactions.test.js
// useChatStore의 리액션 하이드레이션(setReactions)/실시간 갱신(updateReaction) 로직 검증
import useChatStore from '../../src/store/useChatStore'

beforeEach(() => {
  useChatStore.setState({ reactions: {} })
})

describe('useChatStore — reactions', () => {
  it('setReactions — get-reactions IPC 응답 형식을 스토어 형식으로 변환해 병합', () => {
    useChatStore.getState().setReactions({
      'msg-1': [
        { message_id: 'msg-1', peer_id: 'peer1', emoji: '👍' },
        { message_id: 'msg-1', peer_id: 'peer2', emoji: '👍' },
        { message_id: 'msg-1', peer_id: 'peer1', emoji: '❤️' },
      ],
      'msg-2': [
        { message_id: 'msg-2', peer_id: 'peer2', emoji: '🎉' },
      ],
    })

    const { reactions } = useChatStore.getState()
    expect(reactions['msg-1']['👍']).toEqual(['peer1', 'peer2'])
    expect(reactions['msg-1']['❤️']).toEqual(['peer1'])
    expect(reactions['msg-2']['🎉']).toEqual(['peer2'])
  })

  it('setReactions — 기존 다른 메시지의 리액션은 유지한 채 병합', () => {
    useChatStore.getState().setReactions({
      'msg-1': [{ message_id: 'msg-1', peer_id: 'peer1', emoji: '👍' }],
    })
    useChatStore.getState().setReactions({
      'msg-2': [{ message_id: 'msg-2', peer_id: 'peer2', emoji: '🎉' }],
    })

    const { reactions } = useChatStore.getState()
    expect(reactions['msg-1']['👍']).toEqual(['peer1'])
    expect(reactions['msg-2']['🎉']).toEqual(['peer2'])
  })

  it('updateReaction — action add 시 반응자 추가', () => {
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    expect(useChatStore.getState().reactions['msg-1']['👍']).toEqual(['peer1'])
  })

  it('updateReaction — 동일 peerId 중복 add 방지', () => {
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    expect(useChatStore.getState().reactions['msg-1']['👍']).toEqual(['peer1'])
  })

  it('updateReaction — action remove 시 반응자 제거, 빈 배열이면 emoji 키 삭제', () => {
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'remove')
    expect(useChatStore.getState().reactions['msg-1']['👍']).toBeUndefined()
  })

  it('updateReaction — 여러 peerId 의 리액션이 독립적으로 유지됨', () => {
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer2', 'add')
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'remove')

    expect(useChatStore.getState().reactions['msg-1']['👍']).toEqual(['peer2'])
  })

  it('resetAll — reactions 초기화', () => {
    useChatStore.getState().updateReaction('msg-1', '👍', 'peer1', 'add')
    useChatStore.getState().resetAll()
    expect(useChatStore.getState().reactions).toEqual({})
  })
})
