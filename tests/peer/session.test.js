const { PeerSession, SESSION_STATES } = require('../../electron/peer/session')

function makeDiscoveryInfo(overrides = {}) {
  return {
    peerId: 'peer-x',
    nickname: '엑스',
    host: '127.0.0.1',
    addresses: ['127.0.0.1'],
    wsPort: 12345,
    filePort: 0,
    ...overrides,
  }
}

describe('PeerSession FSM', () => {
  it('새 세션은 DISCOVERED 상태로 시작한다', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    expect(session.state).toBe(SESSION_STATES.DISCOVERED)
    expect(session.discovered.sources.has('mdns')).toBe(true)
  })

  it('connect() 호출 시 CONNECTING 으로 전이된다', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.markConnecting()
    expect(session.state).toBe(SESSION_STATES.CONNECTING)
  })

  it('markConnected 후 markHandshaking 로 HANDSHAKING 전이', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.markConnecting()
    session.markConnected()
    session.markHandshaking()
    expect(session.state).toBe(SESSION_STATES.HANDSHAKING)
  })

  it('applyRemoteHello 로 READY 로 전이된다', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.markConnecting()
    session.markConnected()
    session.markHandshaking()
    session.applyRemoteHello({
      peerId: 'peer-x',
      sessionId: 'rs-1',
      publicKey: 'AAAA',
      nickname: '엑스',
      wsPort: 12345,
      filePort: 0,
      addresses: ['127.0.0.1'],
      profileImageUrl: null,
      capabilities: ['dm'],
    })
    expect(session.state).toBe(SESSION_STATES.READY)
    expect(session.crypto.publicKey).toBe('AAAA')
    expect(session.handshake.remoteSessionId).toBe('rs-1')
  })

  it('markClosed 는 항상 DISCONNECTED 로 전이', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.markConnecting()
    session.markClosed()
    expect(session.state).toBe(SESSION_STATES.DISCONNECTED)
  })

  it('다른 sessionId 의 hello 는 원격 재시작으로 간주되어 remoteSessionId 갱신', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.markConnecting()
    session.markConnected()
    session.markHandshaking()
    session.applyRemoteHello({ peerId: 'peer-x', sessionId: 'rs-1', publicKey: 'A', nickname: 'x', wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [] })
    expect(session.handshake.remoteSessionId).toBe('rs-1')
    session.applyRemoteHello({ peerId: 'peer-x', sessionId: 'rs-2', publicKey: 'B', nickname: 'x', wsPort: 1, filePort: 0, addresses: [], profileImageUrl: null, capabilities: [] })
    expect(session.handshake.remoteSessionId).toBe('rs-2')
    expect(session.crypto.publicKey).toBe('B')
  })

  it('applyDiscovery 는 여러 소스를 누적 기록한다', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo())
    session.applyDiscovery('broadcast', makeDiscoveryInfo())
    session.applyDiscovery('cache', makeDiscoveryInfo())
    expect(session.discovered.sources.size).toBe(3)
    expect(session.discovered.sources.has('mdns')).toBe(true)
    expect(session.discovered.sources.has('broadcast')).toBe(true)
    expect(session.discovered.sources.has('cache')).toBe(true)
  })

  it('lastDiscoveryInfo 는 가장 최근 정보로 갱신', () => {
    const session = new PeerSession({ peerId: 'peer-x', localSessionId: 'ls-1' })
    session.applyDiscovery('mdns', makeDiscoveryInfo({ nickname: '엑스1' }))
    session.applyDiscovery('broadcast', makeDiscoveryInfo({ nickname: '엑스2' }))
    expect(session.discovered.lastInfo.nickname).toBe('엑스2')
  })
})
