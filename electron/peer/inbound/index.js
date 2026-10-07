// Phase 2: 수신 메시지 타입별 디스패처.
// messageHandler.js 의 거대한 switch-chain 을 타입별 파일로 분해한다.
//
// 각 핸들러 시그니처:
//   handler({ message, ctx, reply })
//
// 일부 타입(key-exchange, dm, message 기본)은 복잡도 때문에 아직 messageHandler.js 에 유지.
// Phase 2b/1c 에서 순차 이관.

const typing = require('./handlers/typing')
const typingStop = require('./handlers/typingStop')
const status = require('./handlers/status')
const nickname = require('./handlers/nickname')
const readReceipt = require('./handlers/readReceipt')
const reaction = require('./handlers/reaction')
const deleteMessageHandler = require('./handlers/delete')
const editMessageHandler = require('./handlers/edit')
const fileRequest = require('./handlers/fileRequest')
const fileData = require('./handlers/fileData')
const fileRequestError = require('./handlers/fileRequestError')
const fileChunkStart = require('./handlers/fileChunkStart')
const fileChunk = require('./handlers/fileChunk')
const fileChunkEnd = require('./handlers/fileChunkEnd')
const fileCancel = require('./handlers/fileCancel')
const hello = require('./handlers/hello')
const dm = require('./handlers/dm')
const globalMessage = require('./handlers/message')
const historySyncRequest = require('./handlers/historySyncRequest')
const historySyncResponse = require('./handlers/historySyncResponse')
const lanpet = require('./handlers/lanpet')

// type → handler 매핑. 알려지지 않은 type 은 무시됨.
const HANDLERS = {
  'typing': typing,
  'typing-stop': typingStop,
  'status-changed': status,
  'nickname-changed': nickname,
  'read-receipt': readReceipt,
  'reaction': reaction,
  'delete-message': deleteMessageHandler,
  'edit-message': editMessageHandler,
  'file-request': fileRequest,
  'file-data': fileData,
  'file-request-error': fileRequestError,
  // 청크 스트리밍 전송 (#44/#45/#49). 화이트리스트에 없는 구버전은 drop = 레거시 file-data 로 폴백.
  'file-chunk-start': fileChunkStart,
  'file-chunk': fileChunk,
  'file-chunk-end': fileChunkEnd,
  'file-cancel': fileCancel,
  // v1 'key-exchange' 수신 핸들러는 제거됨(#69) — 현재 앱(v0.8.0+)은 항상 v2 hello 를 보낸다.
  // v1 전용 구버전(≤v0.7.x) 피어와는 연결 단절(의도된 정리).
  'hello': hello,                    // v2 핸드셰이크 (현재 정본)
  'dm': dm,
  'message': globalMessage,
  // #31 전체채팅 히스토리 동기화 (additive — 구버전은 화이트리스트에서 drop = graceful degradation)
  'history-sync-request': historySyncRequest,
  'history-sync-response': historySyncResponse,
  'lanpet': lanpet,
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
