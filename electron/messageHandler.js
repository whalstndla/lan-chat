// electron/messageHandler.js
// wsServer/wsClient 공용 메시지 핸들러
// reply: wsServer에서 온 경우 상대 소켓으로 응답, wsClient에서 온 경우 no-op

const path = require('path')
const fs = require('fs')
const { getProfile } = require('./storage/profile')
const { savePeerCache, saveFileCache, saveMessage, editMessage, deleteMessage, addReaction, removeReaction, markMessagesAsRead: markMessagesAsReadDB } = require('./storage/queries')
const { connectToPeer, disconnectFromPeer } = require('./peer/wsClient')
const { importPublicKey } = require('./crypto/keyManager')
const { deriveSharedSecret, decryptDM } = require('./crypto/encryption')
const { normalizeAdvertisedAddresses, buildPeerConnectHostCandidates } = require('./peer/networkUtils')
const { removePeerFromDiscovered } = require('./peer/discovery')
const { getFilePort } = require('./peer/fileServer')
const { writePeerDebugLog } = require('./utils/peerDebugLogger')
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

    // 파일 전송 요청 — HTTP가 막힌 환경(AP isolation)에서 WebSocket으로 파일 직접 전달
    if (message.type === 'file-request') {
      const { messageId, fileName } = message
      const filePath = path.join(appDataPath, 'files', fileName)
      if (!fileName || !fs.existsSync(filePath)) {
        writePeerDebugLog('main.fileTransfer.notFound', { messageId, fileName })
        return
      }
      try {
        const data = fs.readFileSync(filePath).toString('base64')
        const ext = path.extname(fileName)
        sendPeerMessage(ctx, message.fromId, {
          type: 'file-data',
          fromId: ctx.state.peerId,
          messageId,
          fileName,
          ext,
          data,
        })
        writePeerDebugLog('main.fileTransfer.sent', { messageId, fileName, toId: message.fromId })
      } catch (err) {
        writePeerDebugLog('main.fileTransfer.sendError', { messageId, error: err.message })
      }
      return
    }

    // 파일 데이터 수신 — WebSocket 파일 전송 응답 처리
    if (message.type === 'file-data') {
      const { messageId, fileName, data } = message
      if (!messageId || !fileName || !data) return
      try {
        const cacheDir = path.join(appDataPath, 'file_cache')
        fs.mkdirSync(cacheDir, { recursive: true })
        const ext = path.extname(fileName)
        const cachedFileName = `${messageId}${ext}`
        const cachedPath = path.join(cacheDir, cachedFileName)
        fs.writeFileSync(cachedPath, Buffer.from(data, 'base64'))
        try { saveFileCache(ctx.state.database, { messageId, cachedPath }) } catch {}
        sendToRenderer(ctx, 'file-cached', { messageId, cachedPath })
        writePeerDebugLog('main.fileTransfer.received', { messageId, fileName, cachedPath })
      } catch (err) {
        writePeerDebugLog('main.fileTransfer.receiveError', { messageId, error: err.message })
      }
      return
    }

    // 타이핑 이벤트 — DB 저장 없이 렌더러로 전달만
    if (message.type === 'typing') {
      sendToRenderer(ctx, 'typing-event', { fromId: message.fromId, from: message.from, to: message.to || null })
      return
    }

    // 상태 변경 이벤트 — DB 저장 없이 렌더러로 전달
    if (message.type === 'status-changed') {
      sendToRenderer(ctx, 'peer-status-changed', {
        peerId: message.fromId,
        statusType: message.statusType,
        statusMessage: message.statusMessage,
      })
      return
    }

    // 메시지 삭제 이벤트 — DB 삭제 후 렌더러로 전달
    if (message.type === 'delete-message') {
      try { deleteMessage(ctx.state.database, message.messageId, message.fromId) } catch { /* 무시 */ }
      sendToRenderer(ctx, 'message-received', {
        type: 'delete-message',
        messageId: message.messageId,
        fromId: message.fromId,
        to: message.to || null,
      })
      return
    }

    // 메시지 수정 이벤트 — DB 업데이트 후 렌더러로 전달
    if (message.type === 'edit-message') {
      try {
        editMessage(ctx.state.database, { messageId: message.messageId, fromId: message.fromId, newContent: message.newContent })
        sendToRenderer(ctx, 'message-edited', {
          messageId: message.messageId, fromId: message.fromId,
          newContent: message.newContent, editedAt: message.editedAt, to: message.to || null,
        })
      } catch { /* 무시 */ }
      return
    }

    // 읽음 확인 이벤트 — DB 업데이트 후 렌더러로 전달
    if (message.type === 'read-receipt') {
      try { markMessagesAsReadDB(ctx.state.database, message.messageIds) } catch { /* 무시 */ }
      sendToRenderer(ctx, 'read-receipt', { fromId: message.fromId, messageIds: message.messageIds })
      return
    }

    // 닉네임 변경 이벤트
    if (message.type === 'nickname-changed') {
      sendToRenderer(ctx, 'peer-nickname-changed', { peerId: message.fromId, nickname: message.nickname })
      return
    }

    // 이모지 리액션 처리 — DB 저장 후 렌더러로 전달
    if (message.type === 'reaction') {
      try {
        if (message.action === 'add') {
          addReaction(ctx.state.database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
        } else if (message.action === 'remove') {
          removeReaction(ctx.state.database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
        }
        sendToRenderer(ctx, 'reaction-updated', {
          messageId: message.messageId, peerId: message.fromId,
          emoji: message.emoji, action: message.action,
        })
      } catch { /* 무시 */ }
      return
    }

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
