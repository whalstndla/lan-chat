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
    },
  }
}

module.exports = { createAppContext }
