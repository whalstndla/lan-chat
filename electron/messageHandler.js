// electron/messageHandler.js
// wsServer/wsClient 공용 인바운드 메시지 진입점.
//
// Phase 2/2b 이후 이 파일은 단순히 dispatchInbound 로 위임한다.
// 각 타입별 실제 처리는 electron/peer/inbound/handlers/ 에 있다.

const { dispatchInbound } = require('./peer/inbound')
const { writePeerDebugLog } = require('./utils/peerDebugLogger')

function createIncomingMessageHandler(ctx) {
  return function handleIncomingMessage(message, reply) {
    if (!ctx.state.database) return
    // dispatcher 가 타입별 핸들러로 위임. 알려지지 않은 타입은 조용히 무시.
    const handled = dispatchInbound({ message, ctx, reply })
    if (!handled) {
      writePeerDebugLog('inbound.unknownType', { type: message?.type })
    }
  }
}

module.exports = { createIncomingMessageHandler }
