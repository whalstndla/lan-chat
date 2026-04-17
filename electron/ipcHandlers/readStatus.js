// electron/ipcHandlers/readStatus.js
// 읽음 상태 관련 IPC 핸들러 — 안읽은 DM ID 조회, 읽음 확인 전송

const { ipcMain } = require('electron')
const { getUnreadDMMessageIds, markMessagesAsRead: markMessagesAsReadDB } = require('../storage/queries')
const { sendPeerMessage } = require('../utils/appUtils')

function registerReadStatusHandlers(ctx) {
  // 안읽은 DM 메시지 ID 조회 (제한 없음)
  ipcMain.handle('get-unread-dm-ids', (_, senderPeerId) => {
    return getUnreadDMMessageIds(ctx.state.database, ctx.state.peerId, senderPeerId)
  })

  // 읽음 확인 전송 — 전송 성공 시에만 로컬 DB 업데이트 (실패 시 재진입 때 재전송 가능)
  ipcMain.handle('send-read-receipt', (_, { targetPeerId, messageIds }) => {
    if (!targetPeerId || !messageIds?.length) return
    // 배열 크기 제한 — SQL 쿼리 부하 방지
    if (messageIds.length > 500) return
    const sent = sendPeerMessage(ctx, targetPeerId, {
      type: 'read-receipt',
      fromId: ctx.state.peerId,
      messageIds,
      timestamp: Date.now(),
    })
    // 전송 성공 시에만 로컬 DB 읽음 처리 — 실패 시 재진입 때 재전송 가능
    if (sent) {
      try { markMessagesAsReadDB(ctx.state.database, messageIds) } catch { /* 무시 */ }
    }
  })
}

module.exports = { registerReadStatusHandlers }
