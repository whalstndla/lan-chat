// Phase 1c: v2 hello 수신 핸들러.
// 현재(v0.8.x)는 수신만 지원. 송신은 v0.9.0 에서 전환 예정.
// v2 hello 를 받으면 parseHello 검증 후 keyExchange 핸들러와 동일한 흐름으로 처리.
// 단 PeerManager 에는 원본 hello (세션ID 포함) 전달.

const { parseHello } = require('../../wire')
const { importPublicKey } = require('../../../crypto/keyManager')
const { savePeerCache, pinKey } = require('../../../storage/queries')
const { evaluatePeerKey, computeKeyFingerprint } = require('../../keyPinning')
const { getProfile } = require('../../../storage/profile')
const { connectToPeer, disconnectFromPeer } = require('../../wsClient')
const { buildPeerConnectHostCandidates } = require('../../networkUtils')
const { removePeerFromDiscovered } = require('../../discovery')
const { getFilePort } = require('../../fileServer')
const {
  sendToRenderer,
  sendPeerMessage,
  sendHistorySyncRequest,
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

    // TOFU 키 고정 판정(#59) — 고정된 공개키와 수신 공개키를 대조한다.
    // 자기 자신의 hello 는 판정에서 제외(peerId 동일). 그 외 3분기로 처리한다.
    const keyDecision = hello.peerId === ctx.state.peerId
      ? { status: 'match', pinned: null }
      : evaluatePeerKey(ctx.state.database, hello.peerId, hello.publicKey)

    if (keyDecision.status === 'mismatch') {
      // 키 변경 감지 — 조용히 덮어쓰지 않는다. 이전 고정 키를 유지(peerPublicKeyMap 미갱신)해
      // 이 피어와의 암호화 통신을 보류하고, 렌더러에 경고를 띄워 사용자 승인을 기다린다.
      // 승인(trust-peer-key) 전까지 이 새 키는 pendingKeyChangeMap 에만 보관된다.
      ctx.state.pendingKeyChangeMap.set(hello.peerId, hello.publicKey)
      writePeerDebugLog('inbound.hello.keyChanged', {
        peerId: hello.peerId,
        nickname: hello.nickname,
      })
      sendToRenderer(ctx, 'peer-key-changed', {
        peerId: hello.peerId,
        nickname: hello.nickname || '알 수 없음',
        fingerprint: computeKeyFingerprint(hello.publicKey),
      })
    } else {
      // 최초(first) → DB 에 고정(pin). 일치(match) → 그대로 세션 맵에 반영(정상 재연결).
      if (keyDecision.status === 'first' && ctx.state.database && hello.peerId !== ctx.state.peerId) {
        try {
          pinKey(ctx.state.database, {
            peerId: hello.peerId,
            publicKey: hello.publicKey,
            firstSeen: Date.now(),
          })
        } catch { /* DB 고정 실패해도 세션 통신은 계속(map 은 아래에서 세팅) */ }
      }
      const publicKeyObj = importPublicKey(hello.publicKey)
      ctx.state.peerPublicKeyMap.set(hello.peerId, publicKeyObj)
      // 경고가 떠 있던 피어가 동일(고정) 키로 정상 복귀하면 보류 상태를 해제하고
      // 렌더러 경고도 내려준다(공격 시도가 멈추고 정상 피어가 돌아온 케이스).
      if (ctx.state.pendingKeyChangeMap.has(hello.peerId)) {
        ctx.state.pendingKeyChangeMap.delete(hello.peerId)
        sendToRenderer(ctx, 'peer-key-changed', { peerId: hello.peerId, resolved: true })
      }
    }

    // PeerManager 에 원본 hello 전달 (v2 sessionId 포함)
    if (ctx.state.peerManager) {
      ctx.state.peerManager.handleRemoteHello(hello)
    }

    // v0.8.0+: reply 도 v2 hello 포맷. (buildMyKeyExchangePayload 는 내부적으로 buildMyHelloPayload 호출)
    const currentNicknameForReply = getProfile(ctx.state.database)?.nickname || ''
    reply(buildMyKeyExchangePayload(ctx, ctx.state.peerId, currentNicknameForReply))

    // #31 전체채팅 히스토리 동기화 — hello 핸드셰이크 완료(=피어 ready) 직후 1회 요청 송신.
    // 이 시점엔 공개키 저장 + (인바운드) 소켓 태깅이 끝나 sendPeerMessage 로 도달 가능하다.
    // 요청은 여기서만 발생하며 응답 수신은 새 요청을 만들지 않아 무한루프가 없다.
    sendHistorySyncRequest(ctx, hello.peerId)

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
