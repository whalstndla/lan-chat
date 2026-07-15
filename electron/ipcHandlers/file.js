// electron/ipcHandlers/file.js
// 파일 저장 및 캐시 관련 IPC 핸들러
// 디스크 저장은 항상 마스터키로 AES-256-GCM 암호화 (보안 3단계).

const { ipcMain, dialog, app, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { getFileCache, getFileForDownload } = require('../storage/queries')
const { getFilePort } = require('../peer/fileServer')
const { encryptBuffer, decryptBuffer, isEncryptedFile } = require('../crypto/fileEncryption')
const { MAX_CHUNKED_FILE_BYTES } = require('../utils/appUtils')
const { cancelInboundTransferByMessageId } = require('../peer/fileChunkTransfer')
const { resolveDownloadFileName } = require('../utils/downloadUtils')

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
      // 사이즈 사전 차단 — 청크 전송(#44/#45/#49)으로 단발 프레임 제약이 사라져 상한을 1GB 로
      // 상향했다. 청크 미지원(구버전) 피어가 요청하면 fileRequest 핸들러가 레거시 한도(150MB)를
      // 초과분에 대해 tooLarge 로 거부하므로, 업로드 자체는 청크 상한까지 허용한다.
      const byteLength = fileBuffer?.byteLength ?? fileBuffer?.length ?? 0
      if (byteLength > MAX_CHUNKED_FILE_BYTES) {
        return { ok: false, error: 'tooLarge', maxBytes: MAX_CHUNKED_FILE_BYTES, size: byteLength }
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

  // 파일 다운로드 — "다른 이름으로 저장" 다이얼로그를 띄워 사용자가 선택한 위치에
  // 원본 파일명으로 저장한다. 복호화 경로는 lanchat:// 프로토콜 핸들러(protocol/lanchatProtocol.js)와
  // 완전히 동일 — 캐시된 ciphertext 를 메모리에서 복호화해 평문 바이트를 얻는다.
  // 사용자가 명시적으로 다운로드(내보내기)를 요청한 것이므로 디스크에 평문으로 저장하는 것이 의도된 동작이다.
  ipcMain.handle('download-file', async (_, messageId) => {
    try {
      const fileInfo = getFileForDownload(ctx.state.database, messageId)
      if (!fileInfo?.cachedFilePath || !fs.existsSync(fileInfo.cachedFilePath)) {
        return { ok: false, error: 'notFound' }
      }

      const rawBytes = fs.readFileSync(fileInfo.cachedFilePath)
      let plaintext
      if (isEncryptedFile(rawBytes)) {
        if (!ctx.state.masterKey) return { ok: false, error: 'noMasterKey' }
        try {
          plaintext = decryptBuffer(rawBytes, ctx.state.masterKey)
        } catch (err) {
          return { ok: false, error: 'decryptionFailed', message: err.message }
        }
      } else {
        // 마이그레이션 전 평문 캐시 — 그대로 사용
        plaintext = rawBytes
      }

      const defaultFileName = resolveDownloadFileName(fileInfo.fileName, fileInfo.cachedFilePath)
      const defaultPath = path.join(app.getPath('downloads'), defaultFileName)

      const saveDialogOptions = { defaultPath }
      const { canceled, filePath } = ctx.state.mainWindow
        ? await dialog.showSaveDialog(ctx.state.mainWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions)

      if (canceled || !filePath) {
        return { ok: false, canceled: true }
      }

      fs.writeFileSync(filePath, plaintext)
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: 'writeError', message: err.message }
    }
  })

  // 저장된 파일을 OS 파일 탐색기(파인더/탐색기)에서 보여주기 — "폴더에서 보기" 액션
  ipcMain.handle('show-item-in-folder', (_, filePath) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath)
    }
  })

  // 진행 중인 청크 전송 취소(#44/#45/#49) — 사용자가 대용량 파일 수신을 중단할 때.
  // 송신측에 file-cancel 을 보내 루프를 멈추고, 로컬 부분 버퍼를 폐기한다.
  ipcMain.handle('cancel-file-transfer', (_, messageId) => {
    cancelInboundTransferByMessageId(ctx, messageId)
    return { ok: true }
  })
}

module.exports = { registerFileHandlers }
