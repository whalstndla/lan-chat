// tests/store/chatStoreMessageCap.test.js
// #10 상한 버그 회귀 테스트 — append 캡(slice(-500))이 위로 스크롤해 로드한 과거를 잘라 증발시키던
// 문제를 검증한다. 불변식: "위로 스크롤해 과거를 로드한 뒤 새 메시지가 도착해도, 지금 보고 있는
// 과거 메시지가 사라지면 안 된다." 동시에 과거를 로드하지 않은 일반 상태에서는 메모리 상한(500)을
// 유지해야 한다.
import useChatStore from '../../src/store/useChatStore'

const LIVE_TAIL_CAP = 500

// id/timestamp 를 인덱스로 갖는 메시지 헬퍼
function makeMsg(i, senderId = 'peerX') {
  return { id: `m${i}`, timestamp: i, fromId: senderId, contentType: 'text', content: `msg ${i}` }
}

function makeRange(start, count) {
  return Array.from({ length: count }, (_, k) => makeMsg(start + k))
}

beforeEach(() => {
  useChatStore.setState({
    globalMessages: [],
    dmMessages: {},
    globalHistoryExpanded: false,
    dmHistoryExpanded: {},
  })
})

describe('전체 채팅 append 상한 (#10)', () => {
  it('과거를 prepend 로 로드한 뒤 새 메시지가 와도 앞부분(과거)이 보존된다', () => {
    // 기본 히스토리 100개 (id 500~599)
    useChatStore.getState().setGlobalHistory(makeRange(500, 100))
    // 위로 스크롤해 과거 500개 로드 (id 0~499) → 총 600개(LIVE_TAIL_CAP 초과)
    useChatStore.getState().prependGlobalMessages(makeRange(0, 500))
    expect(useChatStore.getState().globalMessages).toHaveLength(600)
    expect(useChatStore.getState().globalHistoryExpanded).toBe(true)

    // 새 메시지 1개 도착 — slice(-500) 로 앞부분이 잘리면 안 된다
    useChatStore.getState().addGlobalMessage(makeMsg(600))
    const msgs = useChatStore.getState().globalMessages
    expect(msgs).toHaveLength(601)
    expect(msgs[0].id).toBe('m0')       // 가장 오래된 과거 보존
    expect(msgs[msgs.length - 1].id).toBe('m600')
  })

  it('검색 점프로 500개 초과를 한 번에 로드한 방에서도 append 가 트림하지 않는다', () => {
    // setGlobalHistory 로 600개(rank+1 상황) 를 한 번에 교체 → expanded
    useChatStore.getState().setGlobalHistory(makeRange(0, 600))
    expect(useChatStore.getState().globalHistoryExpanded).toBe(true)

    useChatStore.getState().addGlobalMessage(makeMsg(600))
    const msgs = useChatStore.getState().globalMessages
    expect(msgs).toHaveLength(601)
    expect(msgs[0].id).toBe('m0')
  })

  it('과거를 로드하지 않은 일반 라이브 상태에서는 최근 500개 상한을 유지한다', () => {
    // 기본 히스토리 100개(미확장) → append 로 500개 초과
    useChatStore.getState().setGlobalHistory(makeRange(0, 100))
    expect(useChatStore.getState().globalHistoryExpanded).toBe(false)
    for (let k = 100; k < 600; k++) useChatStore.getState().addGlobalMessage(makeMsg(k))

    const msgs = useChatStore.getState().globalMessages
    expect(msgs).toHaveLength(LIVE_TAIL_CAP)
    expect(msgs[0].id).toBe('m100')     // 가장 오래된 100개는 트림됨
    expect(msgs[msgs.length - 1].id).toBe('m599')
  })

  it('기본 페이지(100)만 로드된 방은 expanded 가 아니다', () => {
    useChatStore.getState().setGlobalHistory(makeRange(0, 100))
    expect(useChatStore.getState().globalHistoryExpanded).toBe(false)
  })
})

describe('DM append 상한 (#10)', () => {
  const peerId = 'peer1'

  it('과거를 prepend 로 로드한 뒤 새 메시지가 와도 앞부분이 보존된다', () => {
    useChatStore.getState().setDMHistory(peerId, makeRange(500, 100))
    useChatStore.getState().prependDMMessages(peerId, makeRange(0, 500))
    expect(useChatStore.getState().dmMessages[peerId]).toHaveLength(600)
    expect(useChatStore.getState().dmHistoryExpanded[peerId]).toBe(true)

    useChatStore.getState().addDMMessage(peerId, makeMsg(600))
    const msgs = useChatStore.getState().dmMessages[peerId]
    expect(msgs).toHaveLength(601)
    expect(msgs[0].id).toBe('m0')
    expect(msgs[msgs.length - 1].id).toBe('m600')
  })

  it('과거를 로드하지 않은 일반 상태에서는 최근 500개 상한을 유지한다', () => {
    useChatStore.getState().setDMHistory(peerId, makeRange(0, 100))
    for (let k = 100; k < 600; k++) useChatStore.getState().addDMMessage(peerId, makeMsg(k))

    const msgs = useChatStore.getState().dmMessages[peerId]
    expect(msgs).toHaveLength(LIVE_TAIL_CAP)
    expect(msgs[0].id).toBe('m100')
    expect(msgs[msgs.length - 1].id).toBe('m599')
  })

  it('방을 기본 페이지로 재로드(setDMHistory)하면 expanded 가 리셋된다', () => {
    useChatStore.getState().setDMHistory(peerId, makeRange(0, 600)) // 확장
    expect(useChatStore.getState().dmHistoryExpanded[peerId]).toBe(true)
    useChatStore.getState().setDMHistory(peerId, makeRange(0, 100)) // 기본 페이지로 재진입
    expect(useChatStore.getState().dmHistoryExpanded[peerId]).toBe(false)
  })

  it('한 상대의 expanded 는 다른 상대의 트림에 영향을 주지 않는다', () => {
    const peerA = 'peerA'
    const peerB = 'peerB'
    useChatStore.getState().setDMHistory(peerA, makeRange(0, 600)) // A 확장
    useChatStore.getState().setDMHistory(peerB, makeRange(0, 100)) // B 미확장
    for (let k = 100; k < 600; k++) useChatStore.getState().addDMMessage(peerB, makeMsg(k))

    expect(useChatStore.getState().dmMessages[peerA]).toHaveLength(600) // A 트림 안 됨
    expect(useChatStore.getState().dmMessages[peerB]).toHaveLength(LIVE_TAIL_CAP) // B 트림됨
  })
})
