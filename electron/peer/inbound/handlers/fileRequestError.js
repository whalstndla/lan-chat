// 파일 전송 요청 실패 응답 (file-request-error) — 송신측이 명시적으로 보낸 실패 통보.
// 수신측의 progressive retry 를 즉시 멈추고 렌더러에 실패 통보 → 사용자가 spinner 가 아닌
// "이미지 불러오기 실패" 상태를 빠르게 확인할 수 있게 함.

const { sendToRenderer, clearPendingFileRequest } = require('../../../utils/appUtils')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

// 명시적 영구 실패 이유 — retry 해도 회복 불가하므로 즉시 give-up.
const TERMINAL_REASONS = new Set(['notFound', 'tooLarge', 'sendError'])

module.exports = function handleFileRequestError({ message, ctx }) {
  const { messageId, reason } = message
  if (!messageId) return
  writePeerDebugLog('inbound.fileRequestError.received', {
    messageId,
    reason: reason || null,
    fromId: message.fromId,
  })

  if (TERMINAL_REASONS.has(reason)) {
    // 영구 실패 — 진행 중인 retry 도 모두 취소
    clearPendingFileRequest(ctx, messageId)
    sendToRenderer(ctx, 'file-request-error', { messageId, reason })
    return
  }

  // noPublicKey / noMasterKey 등 일시 실패는 retry 백오프에 맡긴다 (취소 안 함).
  // 렌더러에는 알리지 않음 — 다음 retry 가 성공하면 file-cached 로 자연 회복.
}
