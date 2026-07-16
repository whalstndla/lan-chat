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

// 신선도(replay) 검증 window — 실시간 라이브 인바운드(message/dm)에만 적용한다.
// id 기반 dedup(recentInboundMessageIds)은 in-memory 라 재시작 시 소실되고, 상한 초과 시
// 옛 id 가 FIFO 로 방출돼 재사용이 가능해진다 → 재시작 후/플러딩으로 replay 창이 열린다.
// timestamp 신선도로 그 창을 "시간"으로 봉쇄한다. 값은 피어 간 시계 스큐를 고려해 넉넉히 잡는다.
const MAX_INBOUND_PAST_AGE_MS = 10 * 60 * 1000    // 과거 10분 초과 시 stale(=replay 의심)
const MAX_INBOUND_FUTURE_SKEW_MS = 2 * 60 * 1000  // 미래 2분 초과 시 stale(=비정상 시계/조작)

// 라이브 콘텐츠 메시지(message/dm)의 timestamp 가 허용 window 밖이면 true(=stale, 무시).
// 검증 대상/예외 규칙:
//  - 대상: 라이브 전체채팅(message)·DM(dm)만. typing/reaction/read-receipt 등 정당하게
//    반복되거나 messageId 기반인 타입은 애초에 dedup 대상이 아니므로 신선도 검증도 하지 않는다.
//  - 예외 1: 히스토리 동기화(#31, history-sync-response) 내부 메시지는 정당하게 오래됐지만
//    handleIncomingMessage 를 재진입하지 않고 핸들러 안에서 직접 저장되므로 이 검사를 타지 않는다
//    (엔벨로프 타입도 message/dm 이 아니다).
//  - 예외 2: 오프라인 큐에서 지연 재전송되는 pending flush 메시지는 원래 전송 시점(최대 7일 전)의
//    timestamp 를 그대로 유지하므로, 송신측이 deferred:true 로 표시하고 여기서 그 플래그로 통과시킨다.
//  - timestamp 가 없거나 숫자가 아니면(구버전/비정상 페이로드) 검사 불가로 보고 통과시킨다(하위호환).
function isStaleInboundMessage(message) {
  if (!message || (message.type !== 'message' && message.type !== 'dm')) return false
  // pending flush 로 지연 재전송된 오프라인 메시지 — 정당하게 오래된 timestamp 이므로 예외.
  if (message.deferred === true) return false
  const timestamp = message.timestamp
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false
  const ageMs = Date.now() - timestamp
  if (ageMs > MAX_INBOUND_PAST_AGE_MS) return true      // 너무 과거 → replay 의심
  if (ageMs < -MAX_INBOUND_FUTURE_SKEW_MS) return true  // 너무 미래 → 비정상 시계/조작
  return false
}

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
    // 신선도 검증 — 옛 라이브 메시지 replay 를 시간 window 로 차단한다. 재시작으로 dedup Set 이
    // 비었거나 상한 초과로 옛 id 가 방출된 뒤에도, timestamp 가 window 밖이면 여기서 걸린다.
    // 히스토리 동기화·pending flush 는 예외 처리됨(isStaleInboundMessage 주석 참고).
    if (isStaleInboundMessage(message)) {
      writePeerDebugLog('inbound.stale', {
        type: message?.type,
        id: message?.id || null,
        timestamp: message?.timestamp ?? null,
      })
      return
    }
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

module.exports = {
  createIncomingMessageHandler,
  MAX_RECENT_MESSAGE_IDS,
  isStaleInboundMessage,
  MAX_INBOUND_PAST_AGE_MS,
  MAX_INBOUND_FUTURE_SKEW_MS,
}
