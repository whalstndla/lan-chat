// electron/ipcHandlers/peer.js
// 피어 발견 및 연결 관련 IPC 핸들러

const { ipcMain } = require('electron')
const { startPeerDiscovery, stopPeerDiscovery, removePeerFromDiscovered } = require('../peer/discovery')
const { startBroadcastDiscovery, stopBroadcastDiscovery } = require('../peer/broadcastDiscovery')
const { buildPeerConnectHostCandidates } = require('../peer/networkUtils')
const { connectToPeer, disconnectAll, disconnectFromPeer } = require('../peer/wsClient')
const { closeAllServerClients } = require('../peer/wsServer')
const { getFilePort } = require('../peer/fileServer')
const { loadPeerCache, deletePeerCache } = require('../storage/queries')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')
const {
  sendToRenderer,
  getMyAdvertisedAddresses,
  buildMyKeyExchangePayload,
  waitForMilliseconds,
  clearPeerConnectRetry,
  clearAllPeerConnectRetryState,
  getConnectedPeerIds,
  hasPeerConnection,
  sendPeerMessage,
  flushPendingMessages,
  getCurrentNicknameSafely,
} = require('../utils/appUtils')

function registerPeerHandlers(ctx) {
  // 피어 발견 시작 — 기존 인스턴스 정리 후 재시작 (Cmd+R 등 재호출 시 Bonjour 좀비 방지)
  ipcMain.handle('start-peer-discovery', async (_event, _params) => {
    // wsServerInfo가 null이면 서버 초기화 실패 — 피어 탐색 불가
    if (!ctx.state.wsServerInfo) return
    // 동시 실행 방지 — React StrictMode 이중 호출 등으로 인한 race condition 차단
    if (ctx.state.isDiscoveryStarting) return
    ctx.state.isDiscoveryStarting = true
    try {
      writePeerDebugLog('main.discovery.startRequested', {
        currentPeerId: ctx.state.peerId,
        previousEpoch: ctx.state.discoveryEpoch,
        wsPort: ctx.state.wsServerInfo.port,
        filePort: getFilePort(),
      })
      stopBroadcastDiscovery()
      await stopPeerDiscovery()
      disconnectAll()
      // 서버에 연결된 상대방의 클라이언트 소켓도 강제 종료 — 좀비 소켓 방지
      if (ctx.state.wsServerInfo) closeAllServerClients(ctx.state.wsServerInfo)
      ctx.state.peerPublicKeyMap.clear()
      clearAllPeerConnectRetryState(ctx)
      // 글로벌 세대 증가 — 이전 세대의 연결에서 발생하는 stale close/peer-left를 무시하기 위함
      ctx.state.discoveryEpoch++
      const currentEpoch = ctx.state.discoveryEpoch
      const currentNickname = getCurrentNicknameSafely(ctx)
      const INITIAL_CONNECT_MAX_RETRIES = 3
      const INITIAL_CONNECT_RETRY_DELAY = 700
      const INITIAL_CONNECT_TIMEOUT = 1500
      const BACKGROUND_CONNECT_RETRY_DELAY = 2500
      const HANDSHAKE_SWEEP_DELAY = 2000

      const scheduleBackgroundConnectRetry = (targetPeerId) => {
        if (currentEpoch !== ctx.state.discoveryEpoch) return
        if (ctx.state.peerConnectRetryTimerMap.has(targetPeerId)) return

        writePeerDebugLog('main.discovery.backgroundRetry.scheduled', {
          targetPeerId,
          currentEpoch,
          delayMs: BACKGROUND_CONNECT_RETRY_DELAY,
        })
        const retryTimer = setTimeout(() => {
          ctx.state.peerConnectRetryTimerMap.delete(targetPeerId)
          if (currentEpoch !== ctx.state.discoveryEpoch) return
          if (hasPeerConnection(ctx, targetPeerId)) return

          const latestPeerInfo = ctx.state.latestDiscoveredPeerInfoMap.get(targetPeerId)
          if (!latestPeerInfo) return
          writePeerDebugLog('main.discovery.backgroundRetry.run', {
            targetPeerId,
            currentEpoch,
            latestPeerInfo,
          })
          connectDiscoveredPeer(latestPeerInfo)
        }, BACKGROUND_CONNECT_RETRY_DELAY)

        if (retryTimer.unref) retryTimer.unref()
        ctx.state.peerConnectRetryTimerMap.set(targetPeerId, retryTimer)
      }

      const connectDiscoveredPeer = async (peerInfo) => {
        if (currentEpoch !== ctx.state.discoveryEpoch) return
        if (!peerInfo?.peerId) return
        writePeerDebugLog('main.discovery.connectPeer.start', {
          peerInfo,
          currentEpoch,
        })
        const peerWsPort = Number(peerInfo.wsPort)
        if (!Number.isInteger(peerWsPort) || peerWsPort <= 0) {
          removePeerFromDiscovered(peerInfo.peerId)
          scheduleBackgroundConnectRetry(peerInfo.peerId)
          return
        }
        if (hasPeerConnection(ctx, peerInfo.peerId)) {
          clearPeerConnectRetry(ctx, peerInfo.peerId)
          return
        }
        if (ctx.state.peerConnectInFlightSet.has(peerInfo.peerId)) return

        ctx.state.peerConnectInFlightSet.add(peerInfo.peerId)
        sendToRenderer(ctx, 'peer-connecting', peerInfo.peerId)
        try {
          const latestPeerInfo = ctx.state.latestDiscoveredPeerInfoMap.get(peerInfo.peerId) || peerInfo
          const connectHostCandidates = buildPeerConnectHostCandidates(latestPeerInfo)
          writePeerDebugLog('main.discovery.connectPeer.candidates', {
            peerId: peerInfo.peerId,
            currentEpoch,
            connectHostCandidates,
            latestPeerInfo,
          })
          if (connectHostCandidates.length === 0) {
            removePeerFromDiscovered(peerInfo.peerId)
            scheduleBackgroundConnectRetry(peerInfo.peerId)
            return
          }

          // 기존 autoReconnect 루프(구 포트) 취소 — mDNS 재발견 시 포트가 바뀌었을 수 있으므로
          disconnectFromPeer(peerInfo.peerId)

          let connectedHost = null

          // 라운드 단위 재시도: 각 라운드마다 모든 후보 host를 순회 시도
          for (let attempt = 0; attempt <= INITIAL_CONNECT_MAX_RETRIES; attempt++) {
            if (currentEpoch !== ctx.state.discoveryEpoch) return
            for (const connectHost of connectHostCandidates) {
              if (currentEpoch !== ctx.state.discoveryEpoch) return
              try {
                writePeerDebugLog('main.discovery.connectPeer.attempt', {
                  peerId: peerInfo.peerId,
                  connectHost,
                  peerWsPort,
                  attempt,
                  currentEpoch,
                })
                await connectToPeer({
                  peerId: peerInfo.peerId,
                  host: connectHost,
                  wsPort: peerWsPort,
                  connectTimeoutMs: INITIAL_CONNECT_TIMEOUT,
                  onMessage: ctx.state.handleIncomingMessage,
                  autoReconnect: true,
                  onReconnect: () => {
                    // 재연결 성공 후 key-exchange 재전송 (암호화 세션 복구)
                    if (currentEpoch !== ctx.state.discoveryEpoch) return
                    const latestNickname = getCurrentNicknameSafely(ctx)
                    sendPeerMessage(ctx, peerInfo.peerId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, latestNickname))
                  },
                  onClose: () => {
                    // 영구 실패 시에만 호출됨 (autoReconnect 최대 시도 초과)
                    if (currentEpoch !== ctx.state.discoveryEpoch) return
                    removePeerFromDiscovered(peerInfo.peerId)
                    if (!hasPeerConnection(ctx, peerInfo.peerId)) {
                      sendToRenderer(ctx, 'peer-left', peerInfo.peerId)
                      scheduleBackgroundConnectRetry(peerInfo.peerId)
                    }
                  },
                })
                connectedHost = connectHost
                writePeerDebugLog('main.discovery.connectPeer.connected', {
                  peerId: peerInfo.peerId,
                  connectedHost,
                  peerWsPort,
                  attempt,
                  currentEpoch,
                })
                break
              } catch (error) {
                writePeerDebugLog('main.discovery.connectPeer.failed', {
                  peerId: peerInfo.peerId,
                  connectHost,
                  peerWsPort,
                  attempt,
                  currentEpoch,
                  error,
                })
                // 같은 라운드의 다음 host 후보를 계속 시도
              }
            }

            // 연결 성공 시 재시도 루프 종료
            if (connectedHost) break

            // 마지막 라운드가 아니면 대기 후 다음 라운드 진행
            if (attempt < INITIAL_CONNECT_MAX_RETRIES) {
              await waitForMilliseconds(INITIAL_CONNECT_RETRY_DELAY * (attempt + 1))
            }
          }

          if (!connectedHost) {
            // mDNS 재발견이 오지 않는 환경을 대비해 background 재시도 스케줄링
            writePeerDebugLog('main.discovery.connectPeer.exhausted', {
              peerId: peerInfo.peerId,
              currentEpoch,
            })
            removePeerFromDiscovered(peerInfo.peerId)
            scheduleBackgroundConnectRetry(peerInfo.peerId)
            return
          }

          // 연결 성공 후 epoch 재확인 — 연결 중에 refresh가 발생했으면 stale 소켓 폐기
          if (currentEpoch !== ctx.state.discoveryEpoch) {
            disconnectFromPeer(peerInfo.peerId)
            return
          }

          clearPeerConnectRetry(ctx, peerInfo.peerId)
          // key-exchange에 내 접속 정보 + 프로필 이미지 포함
          sendPeerMessage(ctx, peerInfo.peerId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, getCurrentNicknameSafely(ctx)))
          writePeerDebugLog('main.discovery.keyExchange.sent', {
            peerId: peerInfo.peerId,
            connectedHost,
            currentEpoch,
          })
          sendToRenderer(ctx, 'peer-discovered', { ...latestPeerInfo, host: connectedHost })
        } finally {
          ctx.state.peerConnectInFlightSet.delete(peerInfo.peerId)
        }
      }

      startPeerDiscovery({
        nickname: currentNickname,
        peerId: ctx.state.peerId,
        wsPort: ctx.state.wsServerInfo.port,
        filePort: getFilePort(),
        advertisedAddresses: getMyAdvertisedAddresses(ctx),
        onPeerFound: async (peerInfo) => {
          if (peerInfo.peerId === ctx.state.peerId) return // 자기 자신 무시
          ctx.state.latestDiscoveredPeerInfoMap.set(peerInfo.peerId, peerInfo)
          writePeerDebugLog('main.discovery.peerFound', { peerInfo, currentEpoch })
          await connectDiscoveredPeer(peerInfo)
        },
        onPeerLeft: (leftPeerId) => {
          // 현재 세대가 아니면 stale mDNS 이벤트 → 무시
          if (currentEpoch !== ctx.state.discoveryEpoch) return
          clearPeerConnectRetry(ctx, leftPeerId)
          ctx.state.peerConnectInFlightSet.delete(leftPeerId)
          ctx.state.latestDiscoveredPeerInfoMap.delete(leftPeerId)
          // active outbound connection이 있으면 peer-left를 보내지 않음
          if (!hasPeerConnection(ctx, leftPeerId)) {
            writePeerDebugLog('main.discovery.peerLeft', { leftPeerId, currentEpoch })
            sendToRenderer(ctx, 'peer-left', leftPeerId)
          }
        },
      })

      // UDP 브로드캐스트 발견 — mDNS 멀티캐스트가 AP isolation으로 차단된 경우 보완
      startBroadcastDiscovery({
        peerId: ctx.state.peerId,
        nickname: currentNickname,
        wsPort: ctx.state.wsServerInfo.port,
        filePort: getFilePort(),
        addresses: getMyAdvertisedAddresses(ctx),
        myAddresses: ctx.state.localAddressCandidates,
        onPeerFound: async (peerInfo) => {
          if (peerInfo.peerId === ctx.state.peerId) return // 자기 자신 무시
          if (currentEpoch !== ctx.state.discoveryEpoch) return
          ctx.state.latestDiscoveredPeerInfoMap.set(peerInfo.peerId, peerInfo)
          writePeerDebugLog('main.broadcastDiscovery.peerFound', { peerInfo, currentEpoch })
          await connectDiscoveredPeer(peerInfo)
        },
      })

      // 피어 캐시 재연결 — mDNS 없이도 마지막 접속 IP:포트로 바로 연결 시도
      if (ctx.state.database) {
        // 혹시 자기 자신이 캐시에 저장돼 있으면 제거
        try { deletePeerCache(ctx.state.database, ctx.state.peerId) } catch {}
        setTimeout(() => {
          if (currentEpoch !== ctx.state.discoveryEpoch) return
          const cachedPeers = loadPeerCache(ctx.state.database)
          writePeerDebugLog('main.peerCache.reconnect', { count: cachedPeers.length, currentEpoch })
          for (const cached of cachedPeers) {
            if (cached.peerId === ctx.state.peerId) continue // 자기 자신 무시
            if (hasPeerConnection(ctx, cached.peerId)) continue
            if (ctx.state.peerConnectInFlightSet.has(cached.peerId)) continue
            // latestDiscoveredPeerInfoMap에 없으면 캐시 정보로 채워서 connectDiscoveredPeer 호출
            if (!ctx.state.latestDiscoveredPeerInfoMap.has(cached.peerId)) {
              ctx.state.latestDiscoveredPeerInfoMap.set(cached.peerId, {
                peerId: cached.peerId,
                nickname: cached.nickname,
                host: cached.ip,
                addresses: [cached.ip],
                advertisedAddresses: [cached.ip],
                refererAddress: null,
                wsPort: cached.wsPort,
                filePort: 0,
              })
            }
            connectDiscoveredPeer(ctx.state.latestDiscoveredPeerInfoMap.get(cached.peerId))
          }
        }, 1000) // DNS-SD보다 조금 늦게 시작 (mDNS가 먼저 성공하면 캐시 불필요)
      }

      // handshake 보완 스윕 — 공개키 미교환 피어에게 key-exchange 재전송
      const sweepTimer = setTimeout(() => {
        if (currentEpoch !== ctx.state.discoveryEpoch) return
        const allPeerIds = getConnectedPeerIds(ctx)
        writePeerDebugLog('main.discovery.sweep', {
          currentEpoch,
          allPeerIds,
          peerPublicKeyPeerIds: [...ctx.state.peerPublicKeyMap.keys()],
        })
        const latestNickname = getCurrentNicknameSafely(ctx)
        for (const targetPeerId of allPeerIds) {
          if (!ctx.state.peerPublicKeyMap.has(targetPeerId)) {
            sendPeerMessage(ctx, targetPeerId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, latestNickname))
          }
        }
        // 공개키가 있지만 pending 메시지가 남아있는 피어 flush 재시도
        for (const targetPeerId of allPeerIds) {
          if (ctx.state.peerPublicKeyMap.has(targetPeerId)) {
            flushPendingMessages(ctx, targetPeerId)
          }
        }
      }, HANDSHAKE_SWEEP_DELAY)
      if (sweepTimer.unref) sweepTimer.unref()
    } finally {
      ctx.state.isDiscoveryStarting = false
    }
  })
}

module.exports = { registerPeerHandlers }
