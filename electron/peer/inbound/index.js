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
const keyExchange = require('./handlers/keyExchange')
const hello = require('./handlers/hello')
const dm = require('./handlers/dm')
const globalMessage = require('./handlers/message')

// type → handler 매핑. 알려지지 않은 type 은 무시됨.
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
  'key-exchange': keyExchange,       // v1 (현재 기본 전송 포맷)
  'hello': hello,                    // v2 (수신 지원만, 송신은 v0.9.0부터)
  'dm': dm,
  'message': globalMessage,
}

const { perfEnabled } = require('../../utils/perf')
const { writePeerDebugLog } = require('../../utils/peerDebugLogger')

// dispatchInbound 가 true 를 반환하면 dispatcher 가 메시지를 처리했다는 뜻.
function dispatchInbound({ message, ctx, reply }) {
  const handler = HANDLERS[message.type]
  if (!handler) return false
  const start = perfEnabled ? process.hrtime.bigint() : null
  try {
    handler({ message, ctx, reply })
  } catch (err) {
    writePeerDebugLog('inbound.dispatchError', { type: message.type, error: err.message })
  }
  if (perfEnabled && start !== null) {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    // 느린 메시지 처리만 기록 (>5ms)
    if (elapsedMs > 5) {
      writePeerDebugLog('perf.inbound', { type: message.type, elapsedMs })
    }
  }
  return true
}

module.exports = { dispatchInbound, HANDLERS }
