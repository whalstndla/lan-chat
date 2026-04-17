// PeerSession — 한 피어에 대한 모든 상태를 소유하는 FSM.
//
// 기존 코드에서 분산되어 있던 상태(peerPublicKeyMap, peerConnectInFlightSet,
// connectionMap, reconnectOptionsMap, peerServiceMap 등)를 하나로 모은다.
// 상태 전이는 명시적 메서드로만 수행하며, 잘못된 전이는 (방어적으로) 경고만 로깅.

const SESSION_STATES = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  DISCOVERED:   'DISCOVERED',
  CONNECTING:   'CONNECTING',
  CONNECTED:    'CONNECTED',     // TCP/WS open, hello 미송신
  HANDSHAKING:  'HANDSHAKING',   // hello 송신 완료, 원격 hello 대기
  READY:        'READY',         // 양방향 hello 완료, 메시지 송수신 가능
  RECONNECTING: 'RECONNECTING',
})

class PeerSession {
  constructor({ peerId, localSessionId }) {
    if (!peerId) throw new Error('PeerSession requires peerId')
    if (!localSessionId) throw new Error('PeerSession requires localSessionId')

    this.peerId = peerId
    this.state = SESSION_STATES.DISCONNECTED

    this.discovered = {
      sources: new Set(),     // 'mdns' | 'dns-sd' | 'broadcast' | 'cache'
      lastInfo: null,         // 최근 수신한 discovery info
    }
    this.transport = {
      outSocket: null,
      inSocket: null,
    }
    this.crypto = {
      publicKey: null,        // base64 문자열 (raw — parsing은 상위에서)
      sharedSecret: null,     // Phase 1b에서 keyManager 연동
    }
    this.handshake = {
      localSessionId,         // 우리 측 세션 ID (앱 실행 중 고정)
      remoteSessionId: null,  // 상대 측 세션 ID (재시작 감지용)
      remoteVersion: null,
      remoteCapabilities: [],
    }
    this.reconnect = {
      attempt: 0,
      nextTimer: null,
    }
  }

  // 상태 전이 메서드 — 각 메서드가 허용 전이를 제한하지만 엄격하지 않음 (로깅만)
  applyDiscovery(source, info) {
    this.discovered.sources.add(source)
    this.discovered.lastInfo = { ...info }
    if (this.state === SESSION_STATES.DISCONNECTED) {
      this.state = SESSION_STATES.DISCOVERED
    }
  }

  markConnecting() {
    this.state = SESSION_STATES.CONNECTING
  }

  markConnected() {
    this.state = SESSION_STATES.CONNECTED
    this.reconnect.attempt = 0
  }

  markHandshaking() {
    this.state = SESSION_STATES.HANDSHAKING
  }

  applyRemoteHello(hello) {
    // hello 는 parseHello 통과한 객체 (peerId, sessionId, publicKey, ...)
    this.handshake.remoteSessionId = hello.sessionId
    this.handshake.remoteCapabilities = Array.isArray(hello.capabilities) ? [...hello.capabilities] : []
    this.crypto.publicKey = hello.publicKey
    this.state = SESSION_STATES.READY
  }

  markReconnecting() {
    this.state = SESSION_STATES.RECONNECTING
    this.reconnect.attempt += 1
  }

  markClosed() {
    this.state = SESSION_STATES.DISCONNECTED
    this.transport.outSocket = null
    this.transport.inSocket = null
    // publicKey는 유지 — 재연결 시 재협상은 hello에서
  }

  cancelReconnectTimer() {
    if (this.reconnect.nextTimer) {
      clearTimeout(this.reconnect.nextTimer)
      this.reconnect.nextTimer = null
    }
  }

  setOutboundSocket(socket) {
    this.transport.outSocket = socket
  }

  setInboundSocket(socket) {
    this.transport.inSocket = socket
  }

  hasAnySocket() {
    return !!(this.transport.outSocket || this.transport.inSocket)
  }
}

module.exports = { PeerSession, SESSION_STATES }
