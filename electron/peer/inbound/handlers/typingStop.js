// 타이핑 정지 이벤트 — 메시지 전송 완료 시점에 발신자가 보내는 즉시 정지 신호.
// DB 저장 없이 렌더러로 전달만 한다 (typing.js 와 대칭 구조).
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleTypingStop({ message, ctx }) {
  sendToRenderer(ctx, 'typing-stop', {
    fromId: message.fromId,
    to: message.to || null,
  })
}
