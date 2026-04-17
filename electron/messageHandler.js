// electron/messageHandler.js
// wsServer/wsClient 공용 메시지 핸들러
// reply: wsServer에서 온 경우 상대 소켓으로 응답, wsClient에서 온 경우 no-op

const path = require('path')
const fs = require('fs')
const { getProfile } = require('./storage/profile')
const { savePeerCache, saveMessage } = require('./storage/queries')
const { connectToPeer, disconnectFromPeer } = require('./peer/wsClient')
const { importPublicKey } = require('./crypto/keyManager')
const { deriveSharedSecret, decryptDM } = require('./crypto/encryption')
const { normalizeAdvertisedAddresses, buildPeerConnectHostCandidates } = require('./peer/networkUtils')
const { removePeerFromDiscovered } = require('./peer/discovery')
const { getFilePort } = require('./peer/fileServer')
const { writePeerDebugLog } = require('./utils/peerDebugLogger')
const { adaptV1KeyExchangeToHello } = require('./peer/wire')
const { dispatchInbound } = require('./peer/inbound')
const {
  sendToRenderer,
  incrementBadge,
  showNotification,
  playNotificationSound,
  sendPeerMessage,
  flushPendingMessages,
  cacheReceivedFile,
  buildMyKeyExchangePayload,
  getMyAdvertisedAddresses,
  getCurrentNicknameSafely,
  clearPeerConnectRetry,
  hasPeerConnection,
} = require('./utils/appUtils')

function createIncomingMessageHandler(ctx) {
  const appDataPath = ctx.config.appDataPath
  return function handleIncomingMessage(message, reply) {
    if (!ctx.state.database) return

    // Phase 2: 분해된 핸들러로 우선 디스패치. 처리되면 조기 return.
    // 아직 여기서 처리되지 않는 타입: key-exchange, dm, 전체채팅 message.
    if (dispatchInbound({ message, ctx, reply })) return

    // 키 교환 처리 — 내 키 즉시 reply + 역방향 연결 (mDNS 단방향 문제 해결)
    if (message.type === 'key-exchange') {
      try {
        const messageAdvertisedAddresses = normalizeAdvertisedAddresses(message.addresses)
        writePeerDebugLog('main.keyExchange.received', {
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
        // 상대 공개키 저장 (reply 성공/실패와 무관하게 항상 저장)
        ctx.state.peerPublicKeyMap.set(message.fromId, publicKeyObj)

        // Phase 1b shadow mode: PeerManager 에도 hello(=adapted v1 key-exchange) 전달
        if (ctx.state.peerManager) {
          const adapted = adaptV1KeyExchangeToHello(message)
          if (adapted.ok) ctx.state.peerManager.handleRemoteHello(adapted.hello)
        }

        const currentNicknameForReply = getProfile(ctx.state.database)?.nickname || ''
        // reply 시도 — 실패해도 역방향 연결에서 key-exchange를 다시 교환하므로 계속 진행
        reply(buildMyKeyExchangePayload(ctx, ctx.state.peerId, currentNicknameForReply))
        writePeerDebugLog('main.keyExchange.replied', {
          toPeerId: message.fromId,
          host: ctx.state.localIP,
          addresses: getMyAdvertisedAddresses(ctx),
          wsPort: ctx.state.wsServerInfo?.port ?? 0,
          filePort: getFilePort(),
        })

        // 피어 캐시 저장 — IP와 포트를 DB에 기록해 mDNS 없이도 재연결 가능하게 (자기 자신 제외)
        if (ctx.state.database && message.host && message.wsPort && message.fromId !== ctx.state.peerId) {
          try {
            savePeerCache(ctx.state.database, {
              peerId: message.fromId,
              ip: message.host,
              wsPort: message.wsPort,
              nickname: message.nickname || '알 수 없음',
            })
            writePeerDebugLog('main.peerCache.saved', {
              peerId: message.fromId,
              ip: message.host,
              wsPort: message.wsPort,
            })
          } catch { /* DB 저장 실패 시 무시 */ }
        }

        // 상대방 프로필 이미지 URL 업데이트
        if (message.profileImageUrl !== undefined) {
          sendToRenderer(ctx, 'peer-profile-updated', { peerId: message.fromId, profileImageUrl: message.profileImageUrl })
        }

        // key-exchange 수신 = 상대방 온라인 확실 → 무조건 peer-discovered 전송
        // (mDNS 재발견 실패 시에도 UI 복구 보장)
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

        // 역방향 연결 — 기존 연결이 없는 경우에만 (mDNS 단방향 문제 해결)
        // 좀비 소켓은 start-peer-discovery의 closeAllServerClients가 사전 정리
        const reverseConnectHostCandidates = buildPeerConnectHostCandidates({
          host: message.host,
          addresses: messageAdvertisedAddresses,
          advertisedAddresses: messageAdvertisedAddresses,
          wsPort: message.wsPort,
        })

        if (reverseConnectHostCandidates.length > 0 && message.wsPort && !hasPeerConnection(ctx, message.fromId)) {
          const epochAtReverse = ctx.state.discoveryEpoch
          writePeerDebugLog('main.keyExchange.reverseConnect.start', {
            peerId: message.fromId,
            reverseConnectHostCandidates,
            wsPort: message.wsPort,
            epochAtReverse,
          })
          const reverseConnectPromise = (async () => {
            for (const connectHost of reverseConnectHostCandidates) {
              try {
                writePeerDebugLog('main.keyExchange.reverseConnect.attempt', {
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
                    // 역방향 재연결 성공 후 key-exchange 재전송
                    if (epochAtReverse !== ctx.state.discoveryEpoch) return
                    const latestNickname = getCurrentNicknameSafely(ctx)
                    sendPeerMessage(ctx, message.fromId, buildMyKeyExchangePayload(ctx, ctx.state.peerId, latestNickname))
                  },
                  onClose: () => {
                    if (epochAtReverse !== ctx.state.discoveryEpoch) return
                    removePeerFromDiscovered(message.fromId)
                    if (!hasPeerConnection(ctx, message.fromId)) {
                      writePeerDebugLog('main.keyExchange.reverseConnect.closed', {
                        peerId: message.fromId,
                        epochAtReverse,
                      })
                      sendToRenderer(ctx, 'peer-left', message.fromId)
                    }
                  },
                })
                return connectHost
              } catch (error) {
                writePeerDebugLog('main.keyExchange.reverseConnect.attemptFailed', {
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
            writePeerDebugLog('main.keyExchange.reverseConnect.connected', {
              peerId: message.fromId,
              connectedHost,
              epochAtReverse,
            })
            // 역방향 연결 성공 후 epoch 재확인 — stale이면 폐기
            if (epochAtReverse !== ctx.state.discoveryEpoch) {
              disconnectFromPeer(message.fromId)
              return
            }
            flushPendingMessages(ctx, message.fromId)
          }).catch((error) => {
            writePeerDebugLog('main.keyExchange.reverseConnect.failed', {
              peerId: message.fromId,
              epochAtReverse,
              error,
            })
          })
        } else {
          // 이미 연결 중이거나 host/wsPort 없으면 즉시 flush
          writePeerDebugLog('main.keyExchange.reverseConnect.skipped', {
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
      return
    }

    // DM: 암호문 복호화 후 렌더러 전달
    if (message.type === 'dm' && message.encryptedPayload) {
      const senderPublicKey = ctx.state.peerPublicKeyMap.get(message.fromId)
      if (!senderPublicKey) {
        // 공개키 없으면 암호문이라도 DB에 저장 (나중에 복호화 가능)
        console.warn(`[DM 수신] 공개키 없음 — fromId=${message.fromId}, 암호문 DB 저장`)
        try {
          saveMessage(ctx.state.database, {
            id: message.id, type: message.type,
            from_id: message.fromId, from_name: message.from || '알 수 없음',
            to_id: message.to, content: null,
            content_type: 'text', format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: null, file_name: null,
            timestamp: message.timestamp,
          })
        } catch { /* DB 저장 실패 */ }
        return
      }

      try {
        const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, senderPublicKey)
        // message.fromId = 송신자, ctx.state.peerId = 나(수신자)
        const decryptedPayload = decryptDM(message.encryptedPayload, sharedSecret, message.fromId, ctx.state.peerId)

        try {
          saveMessage(ctx.state.database, {
            id: message.id,
            type: message.type,
            from_id: message.fromId,
            from_name: message.from,
            to_id: message.to,
            content: null,
            content_type: decryptedPayload.contentType,
            format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: decryptedPayload.fileUrl || null,
            file_name: decryptedPayload.fileName || null,
            timestamp: message.timestamp,
          })
        } catch (err) {
          console.error(`[DM 수신] DB 저장 실패: ${message.id}`, err.message)
        }

        if (ctx.state.mainWindow && !ctx.state.mainWindow.isFocused()) {
          incrementBadge(ctx)
          showNotification(
            ctx,
            `${message.from || '알 수 없음'} (DM)`,
            decryptedPayload.content || '파일을 보냈습니다.',
            { type: 'dm', peerId: message.fromId, nickname: message.from || '알 수 없음' }
          )
          playNotificationSound(ctx)
        }

        sendToRenderer(ctx, 'message-received', {
          ...message,
          content: decryptedPayload.content,
          contentType: decryptedPayload.contentType,
          fileUrl: decryptedPayload.fileUrl,
          fileName: decryptedPayload.fileName,
        })
        // DM 파일 메시지면 로컬 캐시에 저장
        if (decryptedPayload.fileUrl) cacheReceivedFile(ctx, message.id, decryptedPayload.fileUrl, decryptedPayload.fileName, message.fromId)
      } catch (err) {
        console.error(`[DM 수신] 복호화 실패: msgId=${message.id}, fromId=${message.fromId}`, err.message)
        // 복호화 실패해도 암호문은 DB에 저장 (나중에 재복호화 가능)
        try {
          saveMessage(ctx.state.database, {
            id: message.id, type: message.type,
            from_id: message.fromId, from_name: message.from || '알 수 없음',
            to_id: message.to, content: null,
            content_type: 'text', format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: null, file_name: null,
            timestamp: message.timestamp,
          })
        } catch { /* DB 저장도 실패 */ }
      }
      return
    }

    // 전체채팅 메시지 (평문 저장) — DB 저장 실패 시에도 렌더러 전달은 계속
    try {
      saveMessage(ctx.state.database, {
        id: message.id,
        type: message.type,
        from_id: message.fromId,
        from_name: message.from,
        to_id: null,
        content: message.content || null,
        content_type: message.contentType,
        format: message.format || null,
        encrypted_payload: null,
        file_url: message.fileUrl || null,
        file_name: message.fileName || null,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 — 렌더러 전달은 계속 */ }

    if (ctx.state.mainWindow && !ctx.state.mainWindow.isFocused()) {
      incrementBadge(ctx)
      showNotification(
        ctx,
        message.from || '알 수 없음',
        message.content || '파일을 보냈습니다.',
        { type: 'global' }
      )
      playNotificationSound(ctx)
    }

    sendToRenderer(ctx, 'message-received', message)
    // 파일 메시지면 로컬 캐시에 저장
    if (message.fileUrl) cacheReceivedFile(ctx, message.id, message.fileUrl, message.fileName, message.fromId)
  }
}

module.exports = { createIncomingMessageHandler }
