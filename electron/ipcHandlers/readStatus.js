// electron/ipcHandlers/readStatus.js
// 읽음 상태 관련 IPC 핸들러 — 안읽은 DM ID 조회, 읽음 확인 전송

const { ipcMain } = require('electron')
const { getUnreadDMMessageIds, markMessagesAsRead: markMessagesAsReadDB } = require('../storage/queries')
const { sendPeerMessage } = require('../utils/appUtils')

// 한 번에 처리할 messageId 청크 크기 — SQLite 변수 개수 한도(기본 999)를 고려해
// 여유 있게 설정. 500개 초과 시 조용히 무시하던 기존 동작 대신 청크 단위로 분할 처리한다.
const READ_RECEIPT_CHUNK_SIZE = 400

function registerReadStatusHandlers(ctx) {
  // 안읽은 DM 메시지 ID 조회 (제한 없음)
  ipcMain.handle('get-unread-dm-ids', (_, senderPeerId) => {
    return getUnreadDMMessageIds(ctx.state.database, ctx.state.peerId, senderPeerId)
  })

  // 읽음 확인 전송 — 전송 성공 시에만 로컬 DB 업데이트 (실패 시 재진입 때 재전송 가능)
  ipcMain.handle('send-read-receipt', (_, { targetPeerId, messageIds }) => {
    if (!targetPeerId || !messageIds?.length) return
    // SQLite IN(...) 변수 개수 한도 및 페이로드 크기를 고려해 청크 단위로 분할 전송/반영
    for (let i = 0; i < messageIds.length; i += READ_RECEIPT_CHUNK_SIZE) {
      const chunk = messageIds.slice(i, i + READ_RECEIPT_CHUNK_SIZE)
      const sent = sendPeerMessage(ctx, targetPeerId, {
        type: 'read-receipt',
        fromId: ctx.state.peerId,
        messageIds: chunk,
        timestamp: Date.now(),
      })
      // 전송 성공 시에만 로컬 DB 읽음 처리 — 실패 시 재진입 때 재전송 가능
      if (sent) {
        try { markMessagesAsReadDB(ctx.state.database, chunk) } catch { /* 무시 */ }
      }
    }
  })
}

module.exports = { registerReadStatusHandlers }
