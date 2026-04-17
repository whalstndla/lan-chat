// Phase 1c: v2 hello 수신 핸들러.
// 현재(v0.8.x)는 수신만 지원. 송신은 v0.9.0 에서 전환 예정.
// v2 hello 를 받으면 parseHello 검증 후 keyExchange 핸들러와 동일한 흐름으로 처리.
// 단 PeerManager 에는 원본 hello (세션ID 포함) 전달.

const { parseHello } = require('../../wire')
const { importPublicKey } = require('../../../crypto/keyManager')
const { savePeerCache } = require('../../../storage/queries')
const { getProfile } = require('../../../storage/profile')
const { connectToPeer, disconnectFromPeer } = require('../../wsClient')
const { buildPeerConnectHostCandidates } = require('../../networkUtils')
const { removePeerFromDiscovered } = require('../../discovery')
const { getFilePort } = require('../../fileServer')
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

module.exports = function handleHelloV2({ message, ctx, reply }) {
  const parsed = parseHello(message)
  if (!parsed.ok) {
    writePeerDebugLog('inbound.hello.rejected', {
      fromId: message.fromId,
      reason: parsed.reason,
    })
    // 버전 불일치 등 — 현재는 조용히 무시. Phase 1c 완전 전환 이후
    // reply(version-mismatch) 로 명확한 안내 필요.
    return
  }
  const hello = parsed.hello

  writePeerDebugLog('inbound.hello.received', {
    fromId: hello.peerId,
    sessionId: hello.sessionId,
    addresses: hello.addresses,
    wsPort: hello.wsPort,
    nickname: hello.nickname,
  })

  try {
    clearPeerConnectRetry(ctx, hello.peerId)
    ctx.state.peerConnectInFlightSet.delete(hello.peerId)
    const publicKeyObj = importPublicKey(hello.publicKey)
    ctx.state.peerPublicKeyMap.set(hello.peerId, publicKeyObj)

    // PeerManager 에 원본 hello 전달 (v2 sessionId 포함)
    if (ctx.state.peerManager) {
      ctx.state.peerManager.handleRemoteHello(hello)
    }

    // v1 상대와의 호환을 위해 reply 는 계속 v1 key-exchange 포맷.
    // v0.9.0 에서 양쪽이 모두 v2 가 되면 이 reply 도 v2 hello 로 전환.
    const currentNicknameForReply = getProfile(ctx.state.database)?.nickname || ''
    reply(buildMyKeyExchangePayload(ctx, ctx.state.peerId, currentNicknameForReply))

    // 피어 캐시
    if (ctx.state.database && hello.addresses[0] && hello.wsPort && hello.peerId !== ctx.state.peerId) {
      try {
        savePeerCache(ctx.state.database, {
          peerId: hello.peerId,
          ip: hello.addresses[0],
          wsPort: hello.wsPort,
          nickname: hello.nickname || '알 수 없음',
        })
      } catch { /* DB 실패 무시 */ }
    }

    if (hello.profileImageUrl !== undefined) {
      sendToRenderer(ctx, 'peer-profile-updated', {
        peerId: hello.peerId,
        profileImageUrl: hello.profileImageUrl,
      })
    }

    const peerDiscoveredData = {
      peerId: hello.peerId,
      nickname: hello.nickname || '알 수 없음',
      host: hello.addresses[0],
      addresses: hello.addresses,
      advertisedAddresses: hello.addresses,
      wsPort: hello.wsPort,
      filePort: hello.filePort || 0,
      profileImageUrl: hello.profileImageUrl || null,
    }
    ctx.state.latestDiscoveredPeerInfoMap.set(hello.peerId, peerDiscoveredData)
    sendToRenderer(ctx, 'peer-discovered', peerDiscoveredData)

    // 역방향 연결 (keyExchange 핸들러와 동일 로직)
    const reverseHostCandidates = buildPeerConnectHostCandidates({
      host: hello.addresses[0],
      addresses: hello.addresses,
      advertisedAddresses: hello.addresses,
      wsPort: hello.wsPort,
    })

    if (reverseHostCandidates.length > 0 && hello.wsPort && !hasPeerConnection(ctx, hello.peerId)) {
      const epochAtReverse = ctx.state.discoveryEpoch
      ;(async () => {
        for (const connectHost of reverseHostCandidates) {
          try {
            await connectToPeer({
              peerId: hello.peerId,
              host: connectHost,
              wsPort: hello.wsPort,
              onMessage: ctx.state.handleIncomingMessage,
              autoReconnect: true,
              onReconnect: () => {
                if (epochAtReverse !== ctx.state.discoveryEpoch) return
                const latestNickname = getCurrentNicknameSafely(ctx)
                sendPeerMessage(ctx, hello.peerId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, latestNickname))
              },
              onClose: () => {
                if (epochAtReverse !== ctx.state.discoveryEpoch) return
                removePeerFromDiscovered(hello.peerId)
                if (!hasPeerConnection(ctx, hello.peerId)) {
                  sendToRenderer(ctx, 'peer-left', hello.peerId)
                }
              },
            })
            return connectHost
          } catch { /* 다음 후보 */ }
        }
        throw new Error(`v2 역방향 연결 실패: ${hello.peerId}`)
      })().then(() => {
        if (epochAtReverse !== ctx.state.discoveryEpoch) {
          disconnectFromPeer(hello.peerId)
          return
        }
        flushPendingMessages(ctx, hello.peerId)
      }).catch((error) => {
        writePeerDebugLog('inbound.hello.reverseConnect.failed', {
          peerId: hello.peerId,
          error: error.message,
        })
      })
    } else {
      flushPendingMessages(ctx, hello.peerId)
    }
  } catch (err) {
    writePeerDebugLog('inbound.hello.error', { fromId: hello.peerId, error: err.message })
  }
}
