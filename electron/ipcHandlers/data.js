// electron/ipcHandlers/data.js
// 데이터 삭제 관련 IPC 핸들러 — 전체 메시지 삭제, DM 삭제

const { ipcMain } = require('electron')
const { clearAllMessages, clearAllDMs } = require('../storage/queries')

function registerDataHandlers(ctx) {
  // 전체 채팅 기록 삭제 (global + DM + pending 모두)
  ipcMain.handle('clear-all-messages', () => {
    clearAllMessages(ctx.state.database)
  })

  // DM 기록만 삭제
  ipcMain.handle('clear-all-dms', () => {
    clearAllDMs(ctx.state.database)
  })
}

module.exports = { registerDataHandlers }
