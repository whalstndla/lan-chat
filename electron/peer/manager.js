// PeerManager — PeerSession 컬렉션을 관리하고 discovery / hello 이벤트를
// 적절한 세션으로 라우팅. 이벤트 기반(event emitter 아님, 콜백 주입식).
//
// Phase 1a: 순수 상태 관리만. Phase 1b 에서 실제 transport 호출과 결합.

const { PeerSession, SESSION_STATES } = require('./session')

class PeerManager {
  constructor({ myPeerId, mySessionId, listeners = {} }) {
    if (!myPeerId) throw new Error('PeerManager requires myPeerId')
    if (!mySessionId) throw new Error('PeerManager requires mySessionId')
    this.myPeerId = myPeerId
    this.mySessionId = mySessionId
    this.sessions = new Map()   // peerId -> PeerSession
    this.listeners = {
      onSessionReady: listeners.onSessionReady || (() => {}),
      onSessionLost: listeners.onSessionLost || (() => {}),
      onSessionDiscovered: listeners.onSessionDiscovered || (() => {}),
    }
  }

  getSession(peerId) {
    return this.sessions.get(peerId)
  }

  listSessions() {
    return [...this.sessions.values()]
  }

  listReadySessions() {
    return this.listSessions().filter(s => s.state === SESSION_STATES.READY)
  }

  _ensureSession(peerId) {
    let session = this.sessions.get(peerId)
    if (!session) {
      session = new PeerSession({ peerId, localSessionId: this.mySessionId })
      this.sessions.set(peerId, session)
    }
    return session
  }

  // discovery 소스(mdns/dns-sd/broadcast/cache)에서 피어 발견 시 호출
  handleDiscovery(source, info) {
    if (!info || !info.peerId) return null
    if (info.peerId === this.myPeerId) return null   // 자기 자신 무시
    const session = this._ensureSession(info.peerId)
    const wasDisconnected = session.state === SESSION_STATES.DISCONNECTED
    session.applyDiscovery(source, info)
    if (wasDisconnected) {
      this.listeners.onSessionDiscovered(session)
    }
    return session
  }

  // 원격 hello 수신 시 호출
  handleRemoteHello(hello) {
    if (!hello || !hello.peerId) return null
    if (hello.peerId === this.myPeerId) return null
    const session = this._ensureSession(hello.peerId)
    // Session 이 아직 HANDSHAKING 이전이어도 원격 hello 우선 반영 (역방향 연결 케이스)
    session.applyRemoteHello(hello)
    this.listeners.onSessionReady(session)
    return session
  }

  // discovery 소스에서 피어 이탈 감지 시 호출
  handleLost(peerId) {
    const session = this.sessions.get(peerId)
    if (!session) return
    const wasReady = session.state === SESSION_STATES.READY
    session.markClosed()
    if (wasReady) {
      this.listeners.onSessionLost(session)
    }
  }

  removeSession(peerId) {
    const session = this.sessions.get(peerId)
    if (!session) return
    session.cancelReconnectTimer()
    this.sessions.delete(peerId)
  }

  clear() {
    for (const session of this.sessions.values()) {
      session.cancelReconnectTimer()
    }
    this.sessions.clear()
  }
}

module.exports = { PeerManager }
