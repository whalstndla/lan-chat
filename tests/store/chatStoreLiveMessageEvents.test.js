import useChatStore from '../../src/store/useChatStore'

function makeMessage(id, timestamp, overrides = {}) {
  return {
    id,
    content: id,
    timestamp,
    fromId: 'other-peer',
    from: '상대방',
    ...overrides,
  }
}

describe('실시간 메시지 이벤트 출처', () => {
  beforeEach(() => {
    useChatStore.getState().resetAll()
  })

  it('global 라이브 add는 시계 오차와 무관하게 발행하고 과거 변경·중복·deferred는 제외한다', () => {
    useChatStore.getState().setGlobalHistory([makeMessage('latest', 2000)])
    const initialSequence = useChatStore.getState().nextLiveMessageSequence

    useChatStore.getState().addGlobalMessage(makeMessage('live', 3000))
    useChatStore.getState().addGlobalMessage(makeMessage('live', 3000))
    useChatStore.getState().addGlobalMessage(makeMessage('late', 1000))
    useChatStore.getState().addGlobalMessage(makeMessage('deferred', 900, { deferred: true }))
    useChatStore.getState().prependGlobalMessages([makeMessage('older', 500)])
    useChatStore.getState().mergeGlobalMessages([makeMessage('catch-up', 1500)])

    const state = useChatStore.getState()
    expect(state.nextLiveMessageSequence).toBe(initialSequence + 2)
    expect(state.liveMessageEvents.global.map(event => event.message.id)).toEqual(['live', 'late'])
    expect(state.liveMessageEvents.global.map(event => event.sequence)).toEqual([
      initialSequence + 1,
      initialSequence + 2,
    ])
  })

  it('DM 이벤트는 상대 방 키에 순서대로 쌓이고 resetAll 뒤에도 sequence를 재사용하지 않는다', () => {
    const peerId = 'peer-a'
    useChatStore.getState().setDMHistory(peerId, [makeMessage('dm-latest', 1000)])
    useChatStore.getState().setCurrentRoom({ type: 'dm', peerId, nickname: '상대방' })
    const initialSequence = useChatStore.getState().nextLiveMessageSequence
    const initialChatSessionEpoch = useChatStore.getState().chatSessionEpoch

    useChatStore.getState().addDMMessage(peerId, makeMessage('dm-1', 2000))
    useChatStore.getState().addDMMessage(peerId, makeMessage('dm-2', 3000))
    useChatStore.getState().addDMMessage(peerId, makeMessage('dm-3', 4000))

    const eventsBeforeReset = useChatStore.getState().liveMessageEvents[peerId]
    expect(eventsBeforeReset.map(event => event.sequence)).toEqual([
      initialSequence + 1,
      initialSequence + 2,
      initialSequence + 3,
    ])

    const lastSequence = useChatStore.getState().nextLiveMessageSequence
    useChatStore.getState().resetAll()
    expect(useChatStore.getState().liveMessageEvents).toEqual({})
    expect(useChatStore.getState().chatSessionEpoch).toBe(initialChatSessionEpoch + 1)

    useChatStore.getState().setCurrentRoom({ type: 'dm', peerId, nickname: '상대방' })
    useChatStore.getState().addDMMessage(peerId, makeMessage('after-reset', 5000))
    expect(useChatStore.getState().liveMessageEvents[peerId][0].sequence).toBe(lastSequence + 1)
  })

  it('현재 보고 있지 않은 DM은 새 메시지 토스트 이벤트 큐에 쌓지 않는다', () => {
    for (let messageIndex = 1; messageIndex <= 200; messageIndex += 1) {
      useChatStore.getState().addDMMessage(
        'background-peer',
        makeMessage(`background-${messageIndex}`, messageIndex)
      )
    }

    expect(useChatStore.getState().liveMessageEvents['background-peer']).toBeUndefined()
    expect(useChatStore.getState().dmMessages['background-peer']).toHaveLength(200)
  })
})
