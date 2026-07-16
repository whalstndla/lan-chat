// tests/store/chatStoreAppendDedup.test.js
// addGlobalMessage/addDMMessage 의 id 중복 검사(#57) — 향후 히스토리 동기화/재전송이 이미 화면에
// 있는 메시지를 다시 올려도 두 번 표시되지 않아야 한다. id 가 없는 메시지는 중복 판정 대상이 아니다.
import useChatStore from '../../src/store/useChatStore'

beforeEach(() => {
  useChatStore.setState({
    globalMessages: [],
    dmMessages: {},
    globalHistoryExpanded: false,
    dmHistoryExpanded: {},
  })
})

describe('useChatStore — append id 중복 검사(#57)', () => {
  it('addGlobalMessage — 같은 id 를 두 번 추가하면 한 번만 들어간다', () => {
    const msg = { id: 'g-1', content: '안녕', fromId: 'peer-a' }
    useChatStore.getState().addGlobalMessage(msg)
    useChatStore.getState().addGlobalMessage(msg)
    const { globalMessages } = useChatStore.getState()
    expect(globalMessages).toHaveLength(1)
    expect(globalMessages.filter((m) => m.id === 'g-1')).toHaveLength(1)
  })

  it('addGlobalMessage — 서로 다른 id 는 모두 추가된다', () => {
    useChatStore.getState().addGlobalMessage({ id: 'g-1', content: 'a' })
    useChatStore.getState().addGlobalMessage({ id: 'g-2', content: 'b' })
    expect(useChatStore.getState().globalMessages).toHaveLength(2)
  })

  it('addGlobalMessage — id 가 없는 메시지는 중복 검사 없이 매번 추가된다', () => {
    useChatStore.getState().addGlobalMessage({ content: 'no-id' })
    useChatStore.getState().addGlobalMessage({ content: 'no-id' })
    expect(useChatStore.getState().globalMessages).toHaveLength(2)
  })

  it('addGlobalMessage — 확장된(expanded) 방에서도 같은 id 는 중복 추가되지 않는다', () => {
    useChatStore.setState({ globalHistoryExpanded: true })
    const msg = { id: 'g-9', content: 'x' }
    useChatStore.getState().addGlobalMessage(msg)
    useChatStore.getState().addGlobalMessage(msg)
    expect(useChatStore.getState().globalMessages).toHaveLength(1)
  })

  it('addDMMessage — 같은 id 를 두 번 추가하면 한 번만 들어간다', () => {
    const msg = { id: 'd-1', content: '디엠', fromId: 'peer-a' }
    useChatStore.getState().addDMMessage('peer-a', msg)
    useChatStore.getState().addDMMessage('peer-a', msg)
    const list = useChatStore.getState().dmMessages['peer-a']
    expect(list).toHaveLength(1)
    expect(list.filter((m) => m.id === 'd-1')).toHaveLength(1)
  })

  it('addDMMessage — id 가 없는 메시지는 매번 추가된다', () => {
    useChatStore.getState().addDMMessage('peer-a', { content: 'x' })
    useChatStore.getState().addDMMessage('peer-a', { content: 'x' })
    expect(useChatStore.getState().dmMessages['peer-a']).toHaveLength(2)
  })

  it('addDMMessage — 상대별로 독립적으로 판정한다 (같은 id 라도 다른 상대엔 추가된다)', () => {
    const msg = { id: 'd-2', content: 'y' }
    useChatStore.getState().addDMMessage('peer-a', msg)
    useChatStore.getState().addDMMessage('peer-b', msg)
    expect(useChatStore.getState().dmMessages['peer-a']).toHaveLength(1)
    expect(useChatStore.getState().dmMessages['peer-b']).toHaveLength(1)
  })
})
