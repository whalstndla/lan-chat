// Phase 2: 수신 메시지 타입별 디스패처.
// messageHandler.js 의 거대한 switch-chain 을 타입별 파일로 분해한다.
//
// 각 핸들러 시그니처:
//   handler({ message, ctx, reply })
//
// 일부 타입(key-exchange, dm, message 기본)은 복잡도 때문에 아직 messageHandler.js 에 유지.
// Phase 2b/1c 에서 순차 이관.

const typing = require('./handlers/typing')
const status = require('./handlers/status')
const nickname = require('./handlers/nickname')
const readReceipt = require('./handlers/readReceipt')
const reaction = require('./handlers/reaction')
const deleteMessageHandler = require('./handlers/delete')
const editMessageHandler = require('./handlers/edit')
const fileRequest = require('./handlers/fileRequest')
const fileData = require('./handlers/fileData')

// type → handler 매핑. 여기 없는 타입은 messageHandler.js 의 레거시 경로로 폴스루.
const HANDLERS = {
  'typing': typing,
  'status-changed': status,
  'nickname-changed': nickname,
  'read-receipt': readReceipt,
  'reaction': reaction,
  'delete-message': deleteMessageHandler,
  'edit-message': editMessageHandler,
  'file-request': fileRequest,
  'file-data': fileData,
}

// handleInbound 가 true 를 반환하면 dispatcher 가 메시지를 처리했다는 뜻.
// 레거시 messageHandler.js 는 이 반환값이 true 면 조기 return 한다.
function dispatchInbound({ message, ctx, reply }) {
  const handler = HANDLERS[message.type]
  if (!handler) return false
  try {
    handler({ message, ctx, reply })
  } catch (err) {
    const { writePeerDebugLog } = require('../../utils/peerDebugLogger')
    writePeerDebugLog('inbound.dispatchError', { type: message.type, error: err.message })
  }
  return true
}

module.exports = { dispatchInbound, HANDLERS }
