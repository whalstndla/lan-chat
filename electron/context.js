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
      // 로그아웃/인증 실패로 세션을 닫는 동안 늦은 discovery 시작 요청을 차단한다.
      isSessionClosing: false,
      downloadedUpdateFile: null,
      updatedFromVersion: null,
      unreadBadgeCount: 0,
      handleIncomingMessage: null,
      tray: null,
      isQuitting: false,
      peerPublicKeyMap: new Map(),
      // TOFU 키 고정(#59) — 고정된 키와 불일치하는 hello 를 받았을 때, 사용자가 아직
      // 승인하지 않은 "보류 중인 새 공개키"를 peerId → publicKeyBase64 로 담아둔다.
      // 사용자가 trust-peer-key 로 명시적으로 승인해야만 이 키가 고정 키/세션 맵으로
      // 반영되며, 그전까지는 절대 자동 교체되지 않는다.
      pendingKeyChangeMap: new Map(),
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
      // 청크 전송(#44/#45/#49) 진행 상태.
      // outboundFileTransfers: transferId → { canceled } — 송신 루프가 청크 사이에서 취소 확인.
      // inboundFileTransfers: transferId → { messageId, fileName, ext, totalChunks, totalBytes,
      //   fromId, key, chunks(Map<seq,Buffer>), receivedBytes, receivedCount, timer } — 수신 조립 버퍼.
      // inboundFileTransferByMessage: messageId → transferId — 렌더러의 messageId 기반 취소 조회용.
      outboundFileTransfers: new Map(),
      inboundFileTransfers: new Map(),
      inboundFileTransferByMessage: new Map(),
      // 뮤트된 채팅방 집합 (roomKey: 'global' 또는 peerId) — renderer 의 mutedRooms
      // (localStorage) 를 set-muted-rooms IPC 로 동기화받아 유지한다. 소리/OS알림 억제
      // 판정에만 사용하고, 안읽음 배지 증가에는 영향을 주지 않는다(#4).
      mutedRoomKeySet: new Set(),
      // 유휴 자동 자리비움(auto-away) 이 현재 적용 중인지 여부 — 사용자가 명시적으로
      // 상태를 변경(update-status)하면 false 로 리셋된다(#41).
      isAutoAway: false,
      // 수신 메시지 중복 제거용 최근 메시지 id 집합 — wsServer/wsClient 양 인바운드 경로가
      // 공유한다(#57). 고유 id 를 가진 콘텐츠성 메시지(message/dm)의 재수신을 한 곳에서 차단해,
      // 향후 ack 재전송·히스토리 동기화가 같은 메시지를 다시 보내도 이중 처리되지 않게 한다.
      // 상한(FIFO 방출)은 messageHandler.js 의 MAX_RECENT_MESSAGE_IDS 로 유지된다.
      recentInboundMessageIds: new Set(),
    },
  }
}

module.exports = { createAppContext }
