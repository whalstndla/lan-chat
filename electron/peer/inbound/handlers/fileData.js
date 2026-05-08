// 파일 데이터 수신 (file-data) — WebSocket 파일 전송 응답 처리.
// 받은 base64 평문은 자기 마스터키로 즉시 암호화해 디스크에 저장한다.
const path = require('path')
const fs = require('fs')
const { saveFileCache } = require('../../../storage/queries')
const { sendToRenderer } = require('../../../utils/appUtils')
const { encryptBuffer } = require('../../../crypto/fileEncryption')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleFileData({ message, ctx }) {
  const appDataPath = ctx.config.appDataPath
  const { messageId, fileName, data } = message
  if (!messageId || !fileName || !data) return
  if (!ctx.state.masterKey) return
  try {
    const cacheDir = path.join(appDataPath, 'file_cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const ext = path.extname(fileName)
    const cachedFileName = `${messageId}${ext}`
    const cachedPath = path.join(cacheDir, cachedFileName)
    const plaintext = Buffer.from(data, 'base64')
    const encrypted = encryptBuffer(plaintext, ctx.state.masterKey)
    fs.writeFileSync(cachedPath, encrypted, { mode: 0o600 })
    try { saveFileCache(ctx.state.database, { messageId, cachedPath }) } catch {}
    sendToRenderer(ctx, 'file-cached', { messageId, cachedPath })
    writePeerDebugLog('inbound.fileData.received', { messageId, fileName, cachedPath })
  } catch (err) {
    writePeerDebugLog('inbound.fileData.receiveError', { messageId, error: err.message })
  }
}
