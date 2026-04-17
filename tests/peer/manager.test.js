const { PeerManager } = require('../../electron/peer/manager')
const { SESSION_STATES } = require('../../electron/peer/session')

function makeInfo(peerId, overrides = {}) {
  return {
    peerId,
    nickname: peerId + '-nick',
    host: '127.0.0.1',
    addresses: ['127.0.0.1'],
    wsPort: 12345,
    filePort: 0,
    ...overrides,
  }
}

describe('PeerManager', () => {
  let manager

  beforeEach(() => {
    manager = new PeerManager({ myPeerId: 'me', mySessionId: 'sess-me' })
  })

  it('handleDiscovery 로 새 Session 생성', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a'))
    const session = manager.getSession('peer-a')
    expect(session).toBeDefined()
    expect(session.state).toBe(SESSION_STATES.DISCOVERED)
  })

  it('같은 peerId 에 대한 반복 discovery 는 기존 Session 업데이트', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a', { nickname: 'a1' }))
    manager.handleDiscovery('broadcast', makeInfo('peer-a', { nickname: 'a2' }))
    const session = manager.getSession('peer-a')
    expect(session.discovered.sources.size).toBe(2)
    expect(session.discovered.lastInfo.nickname).toBe('a2')
    expect(manager.listSessions().length).toBe(1)
  })

  it('자기 자신 peerId 는 무시', () => {
    manager.handleDiscovery('mdns', makeInfo('me'))
    expect(manager.getSession('me')).toBeUndefined()
    expect(manager.listSessions().length).toBe(0)
  })

  it('handleRemoteHello 는 해당 Session 을 READY 로 전이', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a'))
    const session = manager.getSession('peer-a')
    session.markConnecting()
    session.markConnected()
    session.markHandshaking()

    manager.handleRemoteHello({
      peerId: 'peer-a', sessionId: 'rs-1', publicKey: 'A', nickname: 'a',
      wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [],
    })
    expect(session.state).toBe(SESSION_STATES.READY)
  })

  it('handleRemoteHello 로 discovery 없이도 Session 이 생성된다 (역방향 연결)', () => {
    manager.handleRemoteHello({
      peerId: 'peer-b', sessionId: 'rs-2', publicKey: 'B', nickname: 'b',
      wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [],
    })
    const session = manager.getSession('peer-b')
    expect(session).toBeDefined()
    expect(session.state).toBe(SESSION_STATES.READY)
  })

  it('handleLost 는 해당 Session 을 DISCONNECTED 로 설정', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a'))
    manager.handleLost('peer-a')
    expect(manager.getSession('peer-a').state).toBe(SESSION_STATES.DISCONNECTED)
  })

  it('removeSession 으로 컬렉션에서 제거', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a'))
    manager.removeSession('peer-a')
    expect(manager.getSession('peer-a')).toBeUndefined()
  })

  it('listReadySessions 는 READY 상태인 것만 반환', () => {
    manager.handleDiscovery('mdns', makeInfo('peer-a'))
    manager.handleDiscovery('mdns', makeInfo('peer-b'))
    const sA = manager.getSession('peer-a')
    sA.markConnecting(); sA.markConnected(); sA.markHandshaking()
    manager.handleRemoteHello({
      peerId: 'peer-a', sessionId: 'rs-a', publicKey: 'A', nickname: 'a',
      wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [],
    })
    // peer-a READY, peer-b 는 DISCOVERED
    const ready = manager.listReadySessions()
    expect(ready.length).toBe(1)
    expect(ready[0].peerId).toBe('peer-a')
  })

  it('listener 콜백이 호출된다 (onSessionReady/onSessionLost/onSessionDiscovered)', () => {
    const discovered = jest.fn()
    const ready = jest.fn()
    const lost = jest.fn()
    const m = new PeerManager({
      myPeerId: 'me', mySessionId: 'sess-me',
      listeners: { onSessionDiscovered: discovered, onSessionReady: ready, onSessionLost: lost },
    })

    m.handleDiscovery('mdns', makeInfo('peer-a'))
    expect(discovered).toHaveBeenCalledTimes(1)

    m.handleRemoteHello({
      peerId: 'peer-a', sessionId: 'rs-a', publicKey: 'A', nickname: 'a',
      wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [],
    })
    expect(ready).toHaveBeenCalledTimes(1)

    m.handleLost('peer-a')
    expect(lost).toHaveBeenCalledTimes(1)
  })
})
