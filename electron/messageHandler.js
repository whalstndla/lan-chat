// electron/messageHandler.js
// wsServer/wsClient 공용 인바운드 메시지 진입점.
//
// Phase 2/2b 이후 이 파일은 단순히 dispatchInbound 로 위임한다.
// 각 타입별 실제 처리는 electron/peer/inbound/handlers/ 에 있다.

const { dispatchInbound } = require('./peer/inbound')
const { writePeerDebugLog } = require('./utils/peerDebugLogger')

// 중복 제거용 최근 메시지 id 집합의 최대 크기 — 초과 시 가장 오래된 항목부터 FIFO 로 방출한다.
// (기존 wsServer.js 의 상한 값을 그대로 유지)
const MAX_RECENT_MESSAGE_IDS = 1000

// 이미 처리한 적 있는 메시지면 true(=처리 차단), 처음 보는 메시지면 집합에 기록 후 false 반환.
// dedup 대상은 고유 id 를 가진 메시지(콘텐츠성 message/dm)뿐이다. typing/typing-stop/
// read-receipt/reaction 처럼 id 가 없거나 정당하게 반복될 수 있는 타입은 검사하지 않는다(#57).
function isDuplicateInboundMessage(state, message) {
  if (!message || !message.id) return false
  const recentIds = state.recentInboundMessageIds
  // 방어적 처리 — 정상 경로에서는 context.js 가 항상 초기화한다.
  if (!recentIds) return false
  if (recentIds.has(message.id)) return true
  // 상한 초과 시 가장 오래된 항목(집합의 첫 값)부터 제거 (FIFO)
  if (recentIds.size >= MAX_RECENT_MESSAGE_IDS) {
    const oldestId = recentIds.values().next().value
    recentIds.delete(oldestId)
  }
  recentIds.add(message.id)
  return false
}

function createIncomingMessageHandler(ctx) {
  return function handleIncomingMessage(message, reply) {
    if (!ctx.state.database) return
    // 동일 id 메시지 재수신 시 무시 — wsServer/wsClient 양 인바운드 경로 공용 진입점에서
    // 한 번만 판정하므로, 두 경로 중 어디로 중복이 들어와도 한 번만 처리된다(#57).
    if (isDuplicateInboundMessage(ctx.state, message)) return
    // dispatcher 가 타입별 핸들러로 위임. 알려지지 않은 타입은 조용히 무시.
    const handled = dispatchInbound({ message, ctx, reply })
    if (!handled) {
      writePeerDebugLog('inbound.unknownType', { type: message?.type })
    }
  }
}

module.exports = { createIncomingMessageHandler, MAX_RECENT_MESSAGE_IDS }
