// 상태 변경 이벤트 — DB 저장 없이 렌더러로 전달.
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleStatus({ message, ctx }) {
  sendToRenderer(ctx, 'peer-status-changed', {
    peerId: message.fromId,
    statusType: message.statusType,
    statusMessage: message.statusMessage,
  })
}
