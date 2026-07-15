// #31 전체채팅 히스토리 동기화 — 응답 수신 핸들러.
// 상대가 보낸 전체채팅 메시지 배치를 내 DB 에 저장(INSERT OR IGNORE)하고
// 렌더러에 배치로 전달해 화면·스토어에 병합한다.
//
// 무한 루프 방지: 응답을 받아도 새 요청을 만들지 않는다(요청은 연결 시 1회뿐).
// 중복 방어: saveMessage 의 INSERT OR IGNORE(DB) + 렌더러 mergeGlobalMessages 의 id 검사.
//
// 대량 히스토리 파일 메시지의 실제 파일 재수신(cacheReceivedFile)은 스코프 밖 —
// file-request 폭주 위험이 있어 하지 않는다. 메시지 자체(텍스트·메타)만 수렴시킨다.

const { saveMessage } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleHistorySyncResponse({ message, ctx }) {
  if (!ctx.state.database) return
  const incoming = Array.isArray(message.messages) ? message.messages : []
  if (incoming.length === 0) return

  const savedMessages = []
  for (const wireMessage of incoming) {
    // 방어: 전체채팅(type='message')만 수용 — DM/기타 타입은 이 동기화 대상이 아니다.
    if (!wireMessage || wireMessage.type !== 'message' || !wireMessage.id) continue
    try {
      saveMessage(ctx.state.database, {
        id: wireMessage.id,
        type: 'message',
        from_id: wireMessage.fromId,
        from_name: wireMessage.from,
        to_id: null,
        content: wireMessage.content || null,
        content_type: wireMessage.contentType,
        format: wireMessage.format || null,
        encrypted_payload: null,
        file_url: wireMessage.fileUrl || null,
        file_name: wireMessage.fileName || null,
        timestamp: wireMessage.timestamp,
        // 답장(#28) — 와이어는 객체, DB 는 JSON 문자열로 저장.
        reply_to_id: wireMessage.replyToId || null,
        reply_preview: wireMessage.replyPreview ? JSON.stringify(wireMessage.replyPreview) : null,
      })
    } catch (err) {
      // 개별 저장 실패는 건너뛰고 계속 — 한 건이 전체 동기화를 막지 않도록.
      writePeerDebugLog('inbound.historySync.saveError', { id: wireMessage.id, error: err.message })
      continue
    }
    savedMessages.push(wireMessage)
  }

  if (savedMessages.length === 0) return

  writePeerDebugLog('inbound.historySync.applied', {
    fromId: message.fromId,
    count: savedMessages.length,
  })

  // 렌더러에 배치 전달 — mergeGlobalMessages 가 id 중복 제거 + timestamp 정렬로 병합한다.
  // 과거 catch-up 이므로 안읽음 배지는 올리지 않는다(라이브 수신과 구분).
  sendToRenderer(ctx, 'global-history-synced', savedMessages)
}
