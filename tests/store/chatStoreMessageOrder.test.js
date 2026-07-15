// tests/store/chatStoreMessageOrder.test.js
// #20 메시지 순서 보장 회귀 테스트 — 오프라인 상대가 재접속하며 flush 한 대기 메시지는 원래(과거)
// timestamp 를 유지한 채 도착한다. addGlobalMessage/addDMMessage 가 무조건 끝에 append 하면 이
// 과거 메시지가 최신 메시지 아래에 잘못 표시된다. 불변식:
//   1) 신규 메시지가 배열 마지막보다 최신(절대다수 케이스)이면 그대로 append 유지
//   2) 더 과거(지각 flush)면 timestamp 오름차순 위치에 삽입
//   3) 동일 timestamp 는 안정적으로(기존 순서 뒤에) 처리
//   4) #57 id 중복 검사, #10 캡(expanded)/트림 동작은 삽입 경로에서도 그대로 보존
import useChatStore from '../../src/store/useChatStore'

const LIVE_TAIL_CAP = 500

function makeMsg(id, timestamp, extra = {}) {
  return { id, timestamp, fromId: 'peerX', contentType: 'text', content: `content ${id}`, ...extra }
}

beforeEach(() => {
  useChatStore.setState({
    globalMessages: [],
    dmMessages: {},
    globalHistoryExpanded: false,
    dmHistoryExpanded: {},
  })
})

describe('addGlobalMessage — timestamp 기준 삽입 (#20)', () => {
  it('연속으로 최신 timestamp 메시지를 추가하면 append 순서를 유지한다', () => {
    useChatStore.getState().addGlobalMessage(makeMsg('g1', 100))
    useChatStore.getState().addGlobalMessage(makeMsg('g2', 200))
    useChatStore.getState().addGlobalMessage(makeMsg('g3', 300))
    const ids = useChatStore.getState().globalMessages.map((m) => m.id)
    expect(ids).toEqual(['g1', 'g2', 'g3'])
  })

  it('오프라인 상대 flush 로 과거 timestamp 메시지가 늦게 도착하면 올바른 위치에 삽입된다', () => {
    useChatStore.getState().addGlobalMessage(makeMsg('g1', 100))
    useChatStore.getState().addGlobalMessage(makeMsg('g3', 300))
    useChatStore.getState().addGlobalMessage(makeMsg('g4', 400))
    // g2(ts=200)가 상대 재접속으로 뒤늦게 flush 되어 도착 — g1 과 g3 사이에 삽입돼야 한다
    useChatStore.getState().addGlobalMessage(makeMsg('g2', 200))
    const ids = useChatStore.getState().globalMessages.map((m) => m.id)
    expect(ids).toEqual(['g1', 'g2', 'g3', 'g4'])
  })

  it('배열의 맨 앞보다도 과거인 메시지는 맨 앞에 삽입된다', () => {
    useChatStore.getState().addGlobalMessage(makeMsg('g2', 200))
    useChatStore.getState().addGlobalMessage(makeMsg('g3', 300))
    useChatStore.getState().addGlobalMessage(makeMsg('g1', 100))
    const ids = useChatStore.getState().globalMessages.map((m) => m.id)
    expect(ids).toEqual(['g1', 'g2', 'g3'])
  })

  it('동일 timestamp 메시지는 안정적으로(기존 순서 뒤에) 삽입된다', () => {
    useChatStore.getState().addGlobalMessage(makeMsg('g1', 100))
    useChatStore.getState().addGlobalMessage(makeMsg('g2', 100))
    useChatStore.getState().addGlobalMessage(makeMsg('g3', 300))
    // g2b 도 timestamp=100 — 기존 g1, g2 보다 뒤, g3 보다는 앞에 와야 한다
    useChatStore.getState().addGlobalMessage(makeMsg('g2b', 100))
    const ids = useChatStore.getState().globalMessages.map((m) => m.id)
    expect(ids).toEqual(['g1', 'g2', 'g2b', 'g3'])
  })

  it('timestamp 가 없는 메시지는 비교 불가로 취급해 기존처럼 끝에 append 된다', () => {
    useChatStore.getState().addGlobalMessage(makeMsg('g1', 100))
    useChatStore.getState().addGlobalMessage({ id: 'no-ts', content: 'x' })
    const ids = useChatStore.getState().globalMessages.map((m) => m.id)
    expect(ids).toEqual(['g1', 'no-ts'])
  })

  it('삽입 경로에서도 중복 id 는 무시된다(#57)', () => {
    const msg = makeMsg('g1', 100)
    useChatStore.getState().addGlobalMessage(makeMsg('g2', 200))
    useChatStore.getState().addGlobalMessage(msg)
    // g1 과 동일 id 로 다시(과거 위치에 삽입될 값이라도) 들어오면 무시돼야 한다
    useChatStore.getState().addGlobalMessage(msg)
    const globalMessages = useChatStore.getState().globalMessages
    expect(globalMessages).toHaveLength(2)
    expect(globalMessages.filter((m) => m.id === 'g1')).toHaveLength(1)
  })

  it('확장된(expanded) 방에서 과거 timestamp 삽입 시에도 캡으로 트림되지 않는다(#10)', () => {
    useChatStore.setState({ globalHistoryExpanded: true })
    for (let i = 0; i < LIVE_TAIL_CAP; i++) {
      useChatStore.getState().addGlobalMessage(makeMsg(`g${i}`, i * 10 + 1000))
    }
    // 지각 메시지 — 맨 앞보다도 과거
    useChatStore.getState().addGlobalMessage(makeMsg('late', 1))
    const globalMessages = useChatStore.getState().globalMessages
    expect(globalMessages).toHaveLength(LIVE_TAIL_CAP + 1)
    expect(globalMessages[0].id).toBe('late')
  })

  it('비확장 라이브 상태에서는 과거 삽입 후에도 최근 LIVE_TAIL_CAP 개 상한을 유지한다', () => {
    for (let i = 0; i < LIVE_TAIL_CAP; i++) {
      useChatStore.getState().addGlobalMessage(makeMsg(`g${i}`, i * 10 + 1000))
    }
    expect(useChatStore.getState().globalMessages).toHaveLength(LIVE_TAIL_CAP)
    // 지각 메시지가 맨 앞에 삽입되면서 총 501개가 되어 캡에 의해 맨 앞 1개가 트림된다
    useChatStore.getState().addGlobalMessage(makeMsg('late', 1))
    const globalMessages = useChatStore.getState().globalMessages
    expect(globalMessages).toHaveLength(LIVE_TAIL_CAP)
    expect(globalMessages[0].id).toBe('g0')
  })
})

describe('addDMMessage — timestamp 기준 삽입 (#20)', () => {
  const peerId = 'peer1'

  it('연속으로 최신 timestamp 메시지를 추가하면 append 순서를 유지한다', () => {
    useChatStore.getState().addDMMessage(peerId, makeMsg('d1', 100))
    useChatStore.getState().addDMMessage(peerId, makeMsg('d2', 200))
    const ids = useChatStore.getState().dmMessages[peerId].map((m) => m.id)
    expect(ids).toEqual(['d1', 'd2'])
  })

  it('과거 timestamp 메시지가 뒤늦게 도착하면 올바른 위치에 삽입된다', () => {
    useChatStore.getState().addDMMessage(peerId, makeMsg('d1', 100))
    useChatStore.getState().addDMMessage(peerId, makeMsg('d3', 300))
    useChatStore.getState().addDMMessage(peerId, makeMsg('d2', 200))
    const ids = useChatStore.getState().dmMessages[peerId].map((m) => m.id)
    expect(ids).toEqual(['d1', 'd2', 'd3'])
  })

  it('삽입 경로에서도 중복 id 는 무시된다(#57)', () => {
    const msg = makeMsg('d1', 100)
    useChatStore.getState().addDMMessage(peerId, makeMsg('d2', 200))
    useChatStore.getState().addDMMessage(peerId, msg)
    useChatStore.getState().addDMMessage(peerId, msg)
    const list = useChatStore.getState().dmMessages[peerId]
    expect(list).toHaveLength(2)
    expect(list.filter((m) => m.id === 'd1')).toHaveLength(1)
  })

  it('상대(peer)별로 독립적으로 순서가 삽입된다', () => {
    const peerA = 'peerA'
    const peerB = 'peerB'
    useChatStore.getState().addDMMessage(peerA, makeMsg('a1', 100))
    useChatStore.getState().addDMMessage(peerA, makeMsg('a3', 300))
    useChatStore.getState().addDMMessage(peerB, makeMsg('b1', 100))
    // peerA 에만 과거 메시지 삽입 — peerB 는 영향받지 않는다
    useChatStore.getState().addDMMessage(peerA, makeMsg('a2', 200))
    expect(useChatStore.getState().dmMessages[peerA].map((m) => m.id)).toEqual(['a1', 'a2', 'a3'])
    expect(useChatStore.getState().dmMessages[peerB].map((m) => m.id)).toEqual(['b1'])
  })

  it('확장된(expanded) DM 방에서 과거 삽입 시에도 캡으로 트림되지 않는다(#10)', () => {
    useChatStore.setState({ dmHistoryExpanded: { [peerId]: true } })
    for (let i = 0; i < LIVE_TAIL_CAP; i++) {
      useChatStore.getState().addDMMessage(peerId, makeMsg(`d${i}`, i * 10 + 1000))
    }
    useChatStore.getState().addDMMessage(peerId, makeMsg('late', 1))
    const list = useChatStore.getState().dmMessages[peerId]
    expect(list).toHaveLength(LIVE_TAIL_CAP + 1)
    expect(list[0].id).toBe('late')
  })

  it('비확장 라이브 DM 방에서는 과거 삽입 후에도 최근 LIVE_TAIL_CAP 개 상한을 유지한다', () => {
    for (let i = 0; i < LIVE_TAIL_CAP; i++) {
      useChatStore.getState().addDMMessage(peerId, makeMsg(`d${i}`, i * 10 + 1000))
    }
    useChatStore.getState().addDMMessage(peerId, makeMsg('late', 1))
    const list = useChatStore.getState().dmMessages[peerId]
    expect(list).toHaveLength(LIVE_TAIL_CAP)
    expect(list[0].id).toBe('d0')
  })
})
