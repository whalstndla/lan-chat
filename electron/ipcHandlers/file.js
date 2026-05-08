// electron/ipcHandlers/file.js
// 파일 저장 및 캐시 관련 IPC 핸들러

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { getFileCache } = require('../storage/queries')
const { getFilePort } = require('../peer/fileServer')

function registerFileHandlers(ctx) {
  const tempFilePath = path.join(ctx.config.appDataPath, 'files')

  // 파일 임시 저장 후 URL 반환
  // preload 에서 이미 Uint8Array 로 변환되어 들어오므로 추가 변환 불필요.
  ipcMain.handle('save-file', (_, { fileBuffer, fileName }) => {
    try {
      const ext = path.extname(fileName)
      const savedFileName = `${uuidv4()}${ext}`
      const savePath = path.join(tempFilePath, savedFileName)
      fs.writeFileSync(savePath, Buffer.from(fileBuffer))
      return `http://${ctx.state.localIP}:${getFilePort()}/files/${savedFileName}`
    } catch {
      return null
    }
  })

  // 캐시된 파일 URL 반환 — 캐시 파일이 존재하면 file:// URL, 없으면 null.
  // 송신자가 자기 파일을 영구 캐시하지 않은 경우 tempFilePath 의 원본도 폴백으로 시도.
  ipcMain.handle('get-cached-file-url', (_, messageId) => {
    const cachedPath = getFileCache(ctx.state.database, messageId)
    if (cachedPath && fs.existsSync(cachedPath)) return `file://${cachedPath}`
    return null
  })
}

module.exports = { registerFileHandlers }
