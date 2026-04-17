// v1 key-exchange 수신 핸들러 (legacy — v0.7.x 피어 호환용).
// v0.8.0 이후 송신은 v2 hello 로 전환되었으나, 구버전 피어가 보낸 v1 메시지는 여전히 수용.
// reply 는 v2 hello 로 답장 → 구버전 피어는 이를 이해 못 함 (의도된 breaking).
// 이 핸들러는 v0.9.0 에서 제거될 예정.

const { getProfile } = require('../../../storage/profile')
const { savePeerCache } = require('../../../storage/queries')
const { connectToPeer, disconnectFromPeer } = require('../../wsClient')
const { importPublicKey } = require('../../../crypto/keyManager')
const { normalizeAdvertisedAddresses, buildPeerConnectHostCandidates } = require('../../networkUtils')
const { removePeerFromDiscovered } = require('../../discovery')
const { getFilePort } = require('../../fileServer')
const { adaptV1KeyExchangeToHello } = require('../../wire')
const {
  sendToRenderer,
  sendPeerMessage,
  flushPendingMessages,
  buildMyKeyExchangePayload,
  getMyAdvertisedAddresses,
  getCurrentNicknameSafely,
  clearPeerConnectRetry,
  hasPeerConnection,
} = require('../../../utils/appUtils')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleKeyExchange({ message, ctx, reply }) {
  try {
    const messageAdvertisedAddresses = normalizeAdvertisedAddresses(message.addresses)
    writePeerDebugLog('inbound.keyExchange.received', {
      fromId: message.fromId,
      host: message.host || null,
      addresses: messageAdvertisedAddresses,
      wsPort: message.wsPort || null,
      filePort: message.filePort || null,
      nickname: message.nickname || null,
      hasProfileImageUrl: message.profileImageUrl !== undefined,
    })
    clearPeerConnectRetry(ctx, message.fromId)
    ctx.state.peerConnectInFlightSet.delete(message.fromId)
    const publicKeyObj = importPublicKey(message.publicKey)
    ctx.state.peerPublicKeyMap.set(message.fromId, publicKeyObj)

    // Phase 1b shadow mode: PeerManager 에도 adapted hello 전달
    if (ctx.state.peerManager) {
      const adapted = adaptV1KeyExchangeToHello(message)
      if (adapted.ok) ctx.state.peerManager.handleRemoteHello(adapted.hello)
    }

    const currentNicknameForReply = getProfile(ctx.state.database)?.nickname || ''
    reply(buildMyKeyExchangePayload(ctx, ctx.state.peerId, currentNicknameForReply))
    writePeerDebugLog('inbound.keyExchange.replied', {
      toPeerId: message.fromId,
      host: ctx.state.localIP,
      addresses: getMyAdvertisedAddresses(ctx),
      wsPort: ctx.state.wsServerInfo?.port ?? 0,
      filePort: getFilePort(),
    })

    // 피어 캐시 저장 — mDNS 없이도 재연결 가능
    if (ctx.state.database && message.host && message.wsPort && message.fromId !== ctx.state.peerId) {
      try {
        savePeerCache(ctx.state.database, {
          peerId: message.fromId,
          ip: message.host,
          wsPort: message.wsPort,
          nickname: message.nickname || '알 수 없음',
        })
        writePeerDebugLog('inbound.keyExchange.peerCacheSaved', {
          peerId: message.fromId,
          ip: message.host,
          wsPort: message.wsPort,
        })
      } catch { /* DB 저장 실패 시 무시 */ }
    }

    if (message.profileImageUrl !== undefined) {
      sendToRenderer(ctx, 'peer-profile-updated', {
        peerId: message.fromId,
        profileImageUrl: message.profileImageUrl,
      })
    }

    // key-exchange 수신 = 상대방 온라인 확실 → 무조건 peer-discovered 전송
    const peerDiscoveredData = {
      peerId: message.fromId,
      nickname: message.nickname || '알 수 없음',
      ...(message.host && { host: message.host }),
      addresses: messageAdvertisedAddresses,
      advertisedAddresses: messageAdvertisedAddresses,
      ...(message.wsPort && { wsPort: message.wsPort }),
      filePort: message.filePort || 0,
      profileImageUrl: message.profileImageUrl || null,
    }
    ctx.state.latestDiscoveredPeerInfoMap.set(message.fromId, peerDiscoveredData)
    sendToRenderer(ctx, 'peer-discovered', peerDiscoveredData)

    // 역방향 연결 — 기존 연결이 없는 경우에만
    const reverseConnectHostCandidates = buildPeerConnectHostCandidates({
      host: message.host,
      addresses: messageAdvertisedAddresses,
      advertisedAddresses: messageAdvertisedAddresses,
      wsPort: message.wsPort,
    })

    if (reverseConnectHostCandidates.length > 0 && message.wsPort && !hasPeerConnection(ctx, message.fromId)) {
      const epochAtReverse = ctx.state.discoveryEpoch
      writePeerDebugLog('inbound.keyExchange.reverseConnect.start', {
        peerId: message.fromId,
        reverseConnectHostCandidates,
        wsPort: message.wsPort,
        epochAtReverse,
      })
      const reverseConnectPromise = (async () => {
        for (const connectHost of reverseConnectHostCandidates) {
          try {
            writePeerDebugLog('inbound.keyExchange.reverseConnect.attempt', {
              peerId: message.fromId,
              connectHost,
              wsPort: message.wsPort,
              epochAtReverse,
            })
            await connectToPeer({
              peerId: message.fromId,
              host: connectHost,
              wsPort: message.wsPort,
              onMessage: ctx.state.handleIncomingMessage,
              autoReconnect: true,
              onReconnect: () => {
                if (epochAtReverse !== ctx.state.discoveryEpoch) return
                const latestNickname = getCurrentNicknameSafely(ctx)
                sendPeerMessage(ctx, message.fromId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, latestNickname))
              },
              onClose: () => {
                if (epochAtReverse !== ctx.state.discoveryEpoch) return
                removePeerFromDiscovered(message.fromId)
                if (!hasPeerConnection(ctx, message.fromId)) {
                  writePeerDebugLog('inbound.keyExchange.reverseConnect.closed', {
                    peerId: message.fromId,
                    epochAtReverse,
                  })
                  sendToRenderer(ctx, 'peer-left', message.fromId)
                }
              },
            })
            return connectHost
          } catch (error) {
            writePeerDebugLog('inbound.keyExchange.reverseConnect.attemptFailed', {
              peerId: message.fromId,
              connectHost,
              wsPort: message.wsPort,
              epochAtReverse,
              error,
            })
          }
        }
        throw new Error(`역방향 연결 실패: ${message.fromId}`)
      })()

      reverseConnectPromise.then((connectedHost) => {
        writePeerDebugLog('inbound.keyExchange.reverseConnect.connected', {
          peerId: message.fromId,
          connectedHost,
          epochAtReverse,
        })
        if (epochAtReverse !== ctx.state.discoveryEpoch) {
          disconnectFromPeer(message.fromId)
          return
        }
        flushPendingMessages(ctx, message.fromId)
      }).catch((error) => {
        writePeerDebugLog('inbound.keyExchange.reverseConnect.failed', {
          peerId: message.fromId,
          epochAtReverse,
          error,
        })
      })
    } else {
      writePeerDebugLog('inbound.keyExchange.reverseConnect.skipped', {
        peerId: message.fromId,
        reverseConnectHostCandidates,
        hasWsPort: !!message.wsPort,
        hasPeerConnection: hasPeerConnection(ctx, message.fromId),
      })
      flushPendingMessages(ctx, message.fromId)
    }
  } catch {
    // 잘못된 공개키 무시
  }
}
