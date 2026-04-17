// 메시지 수정 이벤트 — DB 업데이트 후 렌더러 전달.
const { editMessage } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleEdit({ message, ctx }) {
  try {
    editMessage(ctx.state.database, {
      messageId: message.messageId,
      fromId: message.fromId,
      newContent: message.newContent,
    })
    sendToRenderer(ctx, 'message-edited', {
      messageId: message.messageId,
      fromId: message.fromId,
      newContent: message.newContent,
      editedAt: message.editedAt,
      to: message.to || null,
    })
  } catch { /* 무시 */ }
}
