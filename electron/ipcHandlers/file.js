// electron/ipcHandlers/file.js
// 파일 저장 및 캐시 관련 IPC 핸들러
// 디스크 저장은 항상 마스터키로 AES-256-GCM 암호화 (보안 3단계).

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { getFileCache } = require('../storage/queries')
const { getFilePort } = require('../peer/fileServer')
const { encryptBuffer } = require('../crypto/fileEncryption')
const { MAX_RAW_FILE_BYTES } = require('../utils/appUtils')

function registerFileHandlers(ctx) {
  const tempFilePath = path.join(ctx.config.appDataPath, 'files')

  // 파일 임시 저장 후 결과 객체 반환 — { ok, url, fileName, error? }.
  // preload 에서 이미 Uint8Array 로 변환되어 들어오므로 추가 변환 불필요.
  // 디스크엔 항상 ciphertext 만 저장 — 평문 바이트는 결코 디스크에 닿지 않는다.
  // 사이즈 초과 / 마스터키 미설정 등 실패 시 명시적 error 코드로 응답 → 렌더러가 토스트 표시.
  ipcMain.handle('save-file', (_, { fileBuffer, fileName }) => {
    try {
      if (!ctx.state.masterKey) {
        return { ok: false, error: 'noMasterKey' }
      }
      // 사이즈 사전 차단 — wsServer maxPayload 를 초과할 거대 파일은 보내봐야 수신측 연결만
      // 끊김. 사용자에게 즉시 알려서 송신 시도를 막는다.
      const byteLength = fileBuffer?.byteLength ?? fileBuffer?.length ?? 0
      if (byteLength > MAX_RAW_FILE_BYTES) {
        return { ok: false, error: 'tooLarge', maxBytes: MAX_RAW_FILE_BYTES, size: byteLength }
      }
      const ext = path.extname(fileName)
      const savedFileName = `${uuidv4()}${ext}`
      const savePath = path.join(tempFilePath, savedFileName)
      const ciphertext = encryptBuffer(Buffer.from(fileBuffer), ctx.state.masterKey)
      fs.writeFileSync(savePath, ciphertext, { mode: 0o600 })
      return {
        ok: true,
        url: `http://${ctx.state.localIP}:${getFilePort()}/files/${savedFileName}`,
        fileName: savedFileName,
      }
    } catch (err) {
      return { ok: false, error: 'writeError', message: err.message }
    }
  })

  // 캐시된 파일 표시 URL 반환 — 디스크엔 ciphertext 만 저장되므로 lanchat:// 핸들러를 거쳐
  // 메모리에서 복호화한 평문을 응답하도록 lanchat://file/<messageId> 형태로 반환.
  ipcMain.handle('get-cached-file-url', (_, messageId) => {
    const cachedPath = getFileCache(ctx.state.database, messageId)
    if (cachedPath && fs.existsSync(cachedPath)) {
      return `lanchat://file/${encodeURIComponent(messageId)}`
    }
    return null
  })
}

module.exports = { registerFileHandlers }
