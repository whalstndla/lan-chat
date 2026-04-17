// 이모지 리액션 — DB 저장 후 렌더러 전달.
const { addReaction, removeReaction } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleReaction({ message, ctx }) {
  try {
    if (message.action === 'add') {
      addReaction(ctx.state.database, {
        messageId: message.messageId,
        peerId: message.fromId,
        emoji: message.emoji,
      })
    } else if (message.action === 'remove') {
      removeReaction(ctx.state.database, {
        messageId: message.messageId,
        peerId: message.fromId,
        emoji: message.emoji,
      })
    }
    sendToRenderer(ctx, 'reaction-updated', {
      messageId: message.messageId,
      peerId: message.fromId,
      emoji: message.emoji,
      action: message.action,
    })
  } catch { /* DB 실패 무시 */ }
}
