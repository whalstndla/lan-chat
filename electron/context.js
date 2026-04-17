// electron/context.js
// 앱 전체에서 공유되는 상태(state)와 설정(config)을 하나의 context 객체로 관리

function createAppContext(config) {
  return {
    config,
    state: {
      peerId: null,
      mainWindow: null,
      database: null,
      wsServerInfo: null,
      myPrivateKey: null,
      myPublicKeyBase64: null,
      localIP: 'localhost',
      localAddressCandidates: [],
      discoveryEpoch: 0,
      isDiscoveryStarting: false,
      downloadedUpdateFile: null,
      updatedFromVersion: null,
      unreadBadgeCount: 0,
      handleIncomingMessage: null,
      tray: null,
      isQuitting: false,
      peerPublicKeyMap: new Map(),
      flushingPeers: new Set(),
      peerConnectInFlightSet: new Set(),
      peerConnectRetryTimerMap: new Map(),
      latestDiscoveredPeerInfoMap: new Map(),
      // Phase 1b: PeerManager shadow mode 인스턴스.
      // start-peer-discovery 시점에 생성되며, 기존 로직과 병행 실행하는 관찰자.
      // Phase 1c 에서 기존 ctx.state.peer* 를 대체할 예정.
      peerManager: null,
      // 현재 세션 ID — 앱 실행 중 고정 (프로세스 수명 동안)
      mySessionId: null,
    },
  }
}

module.exports = { createAppContext }
