// 메시지 삭제 이벤트 — DB 삭제 후 렌더러 전달.
const { deleteMessage } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleDelete({ message, ctx }) {
  try { deleteMessage(ctx.state.database, message.messageId, message.fromId) } catch { /* 무시 */ }
  sendToRenderer(ctx, 'message-received', {
    type: 'delete-message',
    messageId: message.messageId,
    fromId: message.fromId,
    to: message.to || null,
  })
}
