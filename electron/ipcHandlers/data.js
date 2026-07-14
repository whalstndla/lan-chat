// electron/ipcHandlers/data.js
// 데이터 삭제 관련 IPC 핸들러 — 전체 메시지 삭제, DM 삭제

const { ipcMain } = require('electron')
const fs = require('fs')
const { clearAllMessages, clearAllDMs } = require('../storage/queries')

// 삭제된 메시지가 참조하던 file_cache 파일들을 정리 — 다른 메시지가 참조할 수 없는
// messageId 1:1 캐시 파일이므로(cacheOwnFile/cacheReceivedFile 참고) 참조 카운트 없이
// 안전하게 삭제 가능 (#24, DB 행만 지우고 캐시 파일은 고아로 남던 문제).
function removeCachedFiles(cachedFilePaths) {
  for (const filePath of cachedFilePaths) {
    try { fs.unlinkSync(filePath) } catch { /* 이미 없거나 삭제 실패 시 무시 */ }
  }
}

function registerDataHandlers(ctx) {
  // 전체 채팅 기록 삭제 (global + DM + pending 모두)
  ipcMain.handle('clear-all-messages', () => {
    const { cachedFilePaths } = clearAllMessages(ctx.state.database)
    removeCachedFiles(cachedFilePaths)
  })

  // DM 기록만 삭제
  ipcMain.handle('clear-all-dms', () => {
    const { cachedFilePaths } = clearAllDMs(ctx.state.database)
    removeCachedFiles(cachedFilePaths)
  })
}

module.exports = { registerDataHandlers }
