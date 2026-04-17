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

  if (message.fileUrl) {
    cacheReceivedFile(ctx, message.id, message.fileUrl, message.fileName, message.fromId)
  }
}
