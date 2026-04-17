// 읽음 확인 수신 — DB에 read=1 플래그 + 렌더러 전달.
const { markMessagesAsRead } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleReadReceipt({ message, ctx }) {
  try { markMessagesAsRead(ctx.state.database, message.messageIds) } catch { /* DB 실패 무시 */ }
  sendToRenderer(ctx, 'read-receipt', {
    fromId: message.fromId,
    messageIds: message.messageIds,
  })
}
