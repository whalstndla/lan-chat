// electron/ipcHandlers/message.js
// 메시지 전송 관련 IPC 핸들러 — 전체채팅, DM, 타이핑, 삭제, 수정

const { ipcMain } = require('electron')
const { v4: uuidv4 } = require('uuid')
const { saveMessage, deleteMessage, editMessage } = require('../storage/queries')
const { savePendingMessage } = require('../storage/pendingMessages')
const { deriveSharedSecret, encryptDM } = require('../crypto/encryption')
const { sendPeerMessage, broadcastPeerMessage, getCurrentNicknameSafely } = require('../utils/appUtils')

// 허용 contentType/format 화이트리스트
const ALLOWED_CONTENT_TYPES = ['text', 'image', 'video', 'file']
const ALLOWED_FORMATS = [null, undefined, 'markdown']
const MAX_CONTENT_LENGTH = 10000

function registerMessageHandlers(ctx) {
  // 전체채팅 메시지 전송
  ipcMain.handle('send-global-message', (_, { content, contentType, fileUrl, fileName, format }) => {
    // 입력 검증
    if (content && content.length > MAX_CONTENT_LENGTH) return null
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null
    if (!ALLOWED_FORMATS.includes(format)) format = null
    const currentNickname = getCurrentNicknameSafely(ctx)
    const message = {
      id: uuidv4(),
      type: 'message',
      from: currentNickname,
      fromId: ctx.state.peerId,
      to: null,
      content: content || null,
      contentType,
      format: format || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
    }
    broadcastPeerMessage(ctx, message)
    // 내 메시지도 로컬 저장 — 저장 실패 시에도 메시지 반환은 계속
    try {
      saveMessage(ctx.state.database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: null, content: message.content,
        content_type: message.contentType, format: message.format,
        encrypted_payload: null,
        file_url: message.fileUrl, file_name: message.fileName,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 */ }
    return message
  })

  // DM 전송 (E2E 암호화, 오프라인이면 pending 큐에 저장)
  ipcMain.handle('send-dm', (_, { recipientPeerId, content, contentType, fileUrl, fileName, format }) => {
    // 입력 검증
    if (content && content.length > MAX_CONTENT_LENGTH) return null
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null
    if (!ALLOWED_FORMATS.includes(format)) format = null
    const currentNickname = getCurrentNicknameSafely(ctx)
    const messageId = uuidv4()
    const timestamp = Date.now()

    const recipientPublicKey = ctx.state.peerPublicKeyMap.get(recipientPeerId)
    if (!recipientPublicKey) {
      // 오프라인 — 평문으로 pending 큐에 저장
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
      // messages 테이블에 평문으로 저장 (히스토리 표시용)
      saveMessage(ctx.state.database, {
        id: messageId, type: 'dm',
        from_id: ctx.state.peerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
      })
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
      }
    }

    let encryptedPayload
    try {
      const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, recipientPublicKey)
      // ctx.state.peerId = 나(송신자), recipientPeerId = 수신자
      encryptedPayload = encryptDM(
        { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
        sharedSecret,
        ctx.state.peerId,
        recipientPeerId
      )
    } catch {
      // 암호화 실패 시 pending 큐에 저장 후 반환
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
      saveMessage(ctx.state.database, {
        id: messageId, type: 'dm',
        from_id: ctx.state.peerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
      })
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
      }
    }

    const message = {
      id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
      to: recipientPeerId, content: null, contentType, format: format || null, encryptedPayload,
      fileUrl: null, fileName: null, timestamp,
    }

    const sent = sendPeerMessage(ctx, recipientPeerId, message)

    if (!sent) {
      // 소켓은 있지만 연결 끊긴 경우 → pending 저장
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
    }

    // 내 DB에는 암호문 저장
    try {
      saveMessage(ctx.state.database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: message.to, content: null,
        content_type: contentType, format: format || null, encrypted_payload: encryptedPayload,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 */ }

    // 렌더러에는 복호화된 내용으로 반환
    return {
      ...message, content: content || null, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null,
      ...(sent ? {} : { pending: true }),
    }
  })

  // 타이핑 인디케이터 전송
  ipcMain.handle('send-typing', (_, targetPeerId) => {
    const currentNickname = getCurrentNicknameSafely(ctx)
    const typingMessage = {
      type: 'typing',
      fromId: ctx.state.peerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendPeerMessage(ctx, targetPeerId, typingMessage)
    } else {
      broadcastPeerMessage(ctx, typingMessage)
    }
  })

  // 메시지 삭제 (본인 메시지만)
  ipcMain.handle('delete-message', (_, { messageId, targetPeerId }) => {
    deleteMessage(ctx.state.database, messageId, ctx.state.peerId)
    const currentNickname = getCurrentNicknameSafely(ctx)
    const deletePayload = {
      type: 'delete-message',
      messageId,
      fromId: ctx.state.peerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendPeerMessage(ctx, targetPeerId, deletePayload)
    } else {
      broadcastPeerMessage(ctx, deletePayload)
    }
  })

  // 메시지 수정 — 본인 메시지만 수정 가능, 내용 길이 검증 후 브로드캐스트
  ipcMain.handle('edit-message', (_, { messageId, newContent, targetPeerId }) => {
    if (!newContent?.trim() || newContent.length > MAX_CONTENT_LENGTH) return null
    const editedAt = Date.now()
    editMessage(ctx.state.database, { messageId, fromId: ctx.state.peerId, newContent })
    const currentNickname = getCurrentNicknameSafely(ctx)
    const editPayload = {
      type: 'edit-message', messageId, fromId: ctx.state.peerId, from: currentNickname,
      newContent, editedAt, to: targetPeerId || null, timestamp: Date.now(),
    }
    if (targetPeerId) sendPeerMessage(ctx, targetPeerId, editPayload)
    else broadcastPeerMessage(ctx, editPayload)
    return { editedAt }
  })
}

module.exports = { registerMessageHandlers }
