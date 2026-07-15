// Phase 2b: 전체채팅 메시지 수신 핸들러 (평문).
// DB 저장 실패해도 렌더러 전달은 계속.

const { saveMessage } = require('../../../storage/queries')
const {
  sendToRenderer,
  incrementBadge,
  showNotification,
  playNotificationSound,
  cacheReceivedFile,
} = require('../../../utils/appUtils')
const { resolveNotificationDecision } = require('../../../utils/notificationPolicy')

module.exports = function handleGlobalMessage({ message, ctx }) {
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
      // 답장(#28) — 전체채팅은 평문 와이어 필드로 도착. 구버전 송신자는 이 필드가 없어 null.
      reply_to_id: message.replyToId || null,
      reply_preview: message.replyPreview ? JSON.stringify(message.replyPreview) : null,
      // @멘션(#29) — 전체채팅은 평문 와이어 필드로 도착. 구버전 송신자는 이 필드가 없어 null.
      mentions: Array.isArray(message.mentions) && message.mentions.length > 0 ? JSON.stringify(message.mentions) : null,
    })
  } catch { /* DB 저장 실패 시 무시 — 렌더러 전달은 계속 */ }

  if (ctx.state.mainWindow && !ctx.state.mainWindow.isFocused()) {
    // 안읽음 배지는 뮤트/알림 범위/방해금지 여부와 무관하게 항상 증가한다(#4).
    incrementBadge(ctx)
    const { notify, body } = resolveNotificationDecision(ctx, {
      roomType: 'global',
      roomKey: 'global',
      fallbackBody: message.content || '파일을 보냈습니다.',
    })
    if (notify) {
      showNotification(ctx, message.from || '알 수 없음', body, { type: 'global' })
      playNotificationSound(ctx)
    }
  }

  sendToRenderer(ctx, 'message-received', message)

  if (message.fileUrl) {
    cacheReceivedFile(ctx, message.id, message.fileUrl, message.fileName, message.fromId)
  }
}
