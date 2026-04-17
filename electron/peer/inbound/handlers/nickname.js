// 닉네임 변경 이벤트.
const { sendToRenderer } = require('../../../utils/appUtils')

module.exports = function handleNicknameChange({ message, ctx }) {
  sendToRenderer(ctx, 'peer-nickname-changed', {
    peerId: message.fromId,
    nickname: message.nickname,
  })
}
