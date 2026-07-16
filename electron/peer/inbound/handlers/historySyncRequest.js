// #31 전체채팅 히스토리 동기화 — 요청 수신 핸들러.
// 상대가 보낸 sinceTimestamp 기준으로 내 DB 의 전체채팅(type='message') 중
// timestamp >= sinceTimestamp 인 것을 조회해 history-sync-response 로 응답한다.
//
// 무한 루프 방지: 이 핸들러는 "응답"만 보낼 뿐 새 요청을 만들지 않는다.
// 요청은 오직 연결(hello) 완료 시 1회만 송신된다(appUtils.sendHistorySyncRequest).

const { getGlobalMessagesSince } = require('../../../storage/queries')
const { sendPeerMessage } = require('../../../utils/appUtils')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

// 한 응답에 담는 전체채팅 메시지 최대 개수 — 초과 시 "가장 최신" N개만 실어 페이로드 폭주를 막는다.
const HISTORY_SYNC_MAX_MESSAGES = 500

// DB 행(snake_case) → 와이어 메시지(camelCase). 전체채팅 평문 메시지 포맷은
// send-global-message 가 만드는 것과 동일하게 맞춰, 수신측이 라이브 메시지와 같은 경로로 처리한다.
// cached_file_path·read 같은 로컬 전용 컬럼은 절대 실어 보내지 않는다(디스크 경로 유출 방지).
function rowToWireMessage(row) {
  return {
    id: row.id,
    type: 'message',
    from: row.from_name,
    fromId: row.from_id,
    to: null,
    content: row.content,
    contentType: row.content_type,
    format: row.format || null,
    fileUrl: row.file_url || null,
    fileName: row.file_name || null,
    timestamp: row.timestamp,
    // 답장(#28) 메타 — DB 에는 JSON 문자열로 저장돼 있으므로 객체로 복원해 실어 보낸다.
    replyToId: row.reply_to_id || null,
    replyPreview: row.reply_preview ? safeParseJson(row.reply_preview) : null,
  }
}

// reply_preview JSON 파싱 실패 시 null 로 폴백 — 손상된 스냅샷이 동기화 전체를 막지 않도록.
function safeParseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

module.exports = function handleHistorySyncRequest({ message, ctx, reply }) {
  if (!ctx.state.database) return
  const sinceTimestamp = Number.isFinite(message.sinceTimestamp) ? message.sinceTimestamp : 0

  let rows
  try {
    rows = getGlobalMessagesSince(ctx.state.database, sinceTimestamp, HISTORY_SYNC_MAX_MESSAGES)
  } catch (err) {
    writePeerDebugLog('inbound.historySync.requestQueryError', { fromId: message.fromId, error: err.message })
    return
  }

  // 보낼 게 없으면 응답 자체를 생략 — 불필요한 트래픽 방지(수신측은 빈 응답도 안전하게 처리).
  if (rows.length === 0) return

  const response = {
    type: 'history-sync-response',
    fromId: ctx.state.peerId,
    messages: rows.map(rowToWireMessage),
  }

  writePeerDebugLog('inbound.historySync.responding', {
    toPeerId: message.fromId,
    sinceTimestamp,
    count: response.messages.length,
  })

  // reply 채널(요청이 도착한 소켓)이 살아있으면 그대로 응답, 아니면 sendPeerMessage 로 폴백.
  // wsClient 경로에서 온 요청은 reply 가 no-op(undefined 반환)이라 폴백을 탄다.
  const repliedOnSocket = reply(response)
  if (!repliedOnSocket) {
    sendPeerMessage(ctx, message.fromId, response)
  }
}

module.exports.HISTORY_SYNC_MAX_MESSAGES = HISTORY_SYNC_MAX_MESSAGES
module.exports.rowToWireMessage = rowToWireMessage
