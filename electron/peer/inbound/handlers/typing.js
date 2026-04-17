// 타이핑 이벤트 — DB 저장 없이 렌더러로 전달만.
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleTyping({ message, ctx }) {
  sendToRenderer(ctx, 'typing-event', {
    fromId: message.fromId,
    from: message.from,
    to: message.to || null,
  })
}
