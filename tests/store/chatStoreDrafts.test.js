// tests/store/chatStoreDrafts.test.js
// useChatStore.drafts — 방별 작성 중 메시지(draft) 저장/복원/삭제 로직 검증
// (MessageInput.jsx 는 React 컴포넌트라 이 프로젝트의 jest(testEnvironment: node) 로는
// 직접 렌더링 검증이 불가하므로, draft 로직 중 순수한 부분인 getRoomKey / store 액션만 단위 테스트한다)
import useChatStore, { getRoomKey } from '../../src/store/useChatStore'

describe('getRoomKey', () => {
  it('전체 채팅방은 "global" 을 반환한다', () => {
    expect(getRoomKey({ type: 'global' })).toBe('global')
  })

  it('DM 방은 peerId 를 그대로 반환한다', () => {
    expect(getRoomKey({ type: 'dm', peerId: 'peer-123', nickname: '홍길동' })).toBe('peer-123')
  })

  it('room 이 없으면 "global" 로 안전하게 처리한다', () => {
    expect(getRoomKey(null)).toBe('global')
    expect(getRoomKey(undefined)).toBe('global')
  })
})

describe('useChatStore — drafts', () => {
  beforeEach(() => {
    useChatStore.setState({ drafts: {} })
  })

  it('setDraft 로 방별 draft 를 저장한다', () => {
    useChatStore.getState().setDraft('global', '작성 중인 내용')
    useChatStore.getState().setDraft('peer-1', 'DM 작성 중')

    expect(useChatStore.getState().drafts).toEqual({
      global: '작성 중인 내용',
      'peer-1': 'DM 작성 중',
    })
  })

  it('빈 문자열로 setDraft 하면 해당 draft 항목을 제거한다', () => {
    useChatStore.getState().setDraft('global', '내용')
    useChatStore.getState().setDraft('global', '')

    expect(useChatStore.getState().drafts).toEqual({})
  })

  it('roomKey 가 없으면 아무 것도 하지 않는다', () => {
    useChatStore.getState().setDraft(null, '내용')
    expect(useChatStore.getState().drafts).toEqual({})
  })

  it('clearDraft 로 특정 방의 draft 만 제거한다', () => {
    useChatStore.getState().setDraft('global', '내용1')
    useChatStore.getState().setDraft('peer-1', '내용2')

    useChatStore.getState().clearDraft('global')

    expect(useChatStore.getState().drafts).toEqual({ 'peer-1': '내용2' })
  })

  it('resetAll 호출 시 drafts 도 초기화된다', () => {
    useChatStore.getState().setDraft('global', '내용')
    useChatStore.getState().resetAll()

    expect(useChatStore.getState().drafts).toEqual({})
  })
})
