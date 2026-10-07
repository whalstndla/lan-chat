const { getLanpetProtocol } = require('../../../lanpet/protocol')

module.exports = function handleLanpet({ message, ctx }) {
  if (!ctx.state.database || !ctx.state.myPrivateKey || ctx.state.isSessionClosing) return
  return getLanpetProtocol(ctx).receive(message)
}
