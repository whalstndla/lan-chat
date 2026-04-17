// Phase 2b: DM 수신 핸들러.
// 1) 공개키 없으면 암호문 그대로 DB 저장 (나중에 복호화 가능)
// 2) 있으면 복호화 → 평문으로 렌더러에 전달 + 암호문 DB 저장 + 알림

const { saveMessage } = require('../../../storage/queries')
const { deriveSharedSecret, decryptDM } = require('../../../crypto/encryption')
const {
  sendToRenderer,
  incrementBadge,
  showNotification,
  playNotificationSound,
  cacheReceivedFile,
} = require('../../../utils/appUtils')

function saveCiphertextOnly(ctx, message) {
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
  } catch { /* DB 저장 실패 무시 */ }
}

module.exports = function handleDm({ message, ctx }) {
  if (!message.encryptedPayload) return

  const senderPublicKey = ctx.state.peerPublicKeyMap.get(message.fromId)
  if (!senderPublicKey) {
    console.warn(`[DM 수신] 공개키 없음 — fromId=${message.fromId}, 암호문 DB 저장`)
    saveCiphertextOnly(ctx, message)
    return
  }

  try {
    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, senderPublicKey)
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

    if (decryptedPayload.fileUrl) {
      cacheReceivedFile(ctx, message.id, decryptedPayload.fileUrl, decryptedPayload.fileName, message.fromId)
    }
  } catch (err) {
    console.error(`[DM 수신] 복호화 실패: msgId=${message.id}, fromId=${message.fromId}`, err.message)
    saveCiphertextOnly(ctx, message)
  }
}
