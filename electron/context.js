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
      // 디스크 저장 파일/DB 암호화에 쓰는 32바이트 마스터키 (safeStorage 로 보호된 키체인 기반)
      masterKey: null,
      // 진행 중인 파일 요청 추적용 — messageId → { fromId, fileName, attempt, timer }.
      // cacheReceivedFile 이 file-request 를 송신할 때 등록하고, file-data 수신 또는
      // file-request-error 수신 시 정리. 타임아웃 만료 시 백오프로 재요청.
      pendingFileRequestMap: new Map(),
      // 뮤트된 채팅방 집합 (roomKey: 'global' 또는 peerId) — renderer 의 mutedRooms
      // (localStorage) 를 set-muted-rooms IPC 로 동기화받아 유지한다. 소리/OS알림 억제
      // 판정에만 사용하고, 안읽음 배지 증가에는 영향을 주지 않는다(#4).
      mutedRoomKeySet: new Set(),
      // 유휴 자동 자리비움(auto-away) 이 현재 적용 중인지 여부 — 사용자가 명시적으로
      // 상태를 변경(update-status)하면 false 로 리셋된다(#41).
      isAutoAway: false,
    },
  }
}

module.exports = { createAppContext }
