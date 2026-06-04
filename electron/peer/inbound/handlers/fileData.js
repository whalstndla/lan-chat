// 파일 데이터 수신 (file-data, wire v3) — ECDH 공유키로 복호화 후 자기 마스터키로 재암호화.
// 평문은 메모리에서만 잠시 존재하고 디스크엔 결코 닿지 않는다.
// v < 3 는 거부 (구버전 클라이언트 — 사용자 결정으로 호환성 단절).

const path = require('path')
const fs = require('fs')
const { saveFileCache } = require('../../../storage/queries')
const { sendToRenderer, clearPendingFileRequest } = require('../../../utils/appUtils')
const { encryptBuffer } = require('../../../crypto/fileEncryption')
const { deriveSharedSecret } = require('../../../crypto/encryption')
const { decryptFileFromPeer } = require('../../../crypto/peerFileTransfer')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleFileData({ message, ctx }) {
  const appDataPath = ctx.config.appDataPath
  const { messageId, fileName, data, v } = message
  if (!messageId || !fileName || !data) return

  if (v !== 3) {
    writePeerDebugLog('inbound.fileData.unsupportedVersion', { messageId, v })
    return
  }

  const senderPublicKey = ctx.state.peerPublicKeyMap.get(message.fromId)
  if (!senderPublicKey) {
    writePeerDebugLog('inbound.fileData.noPublicKey', { messageId, fromId: message.fromId })
    return
  }
  if (!ctx.state.masterKey) return

  try {
    const cacheDir = path.join(appDataPath, 'file_cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const ext = path.extname(fileName)
    const cachedFileName = `${messageId}${ext}`
    const cachedPath = path.join(cacheDir, cachedFileName)

    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, senderPublicKey)
    const plaintext = decryptFileFromPeer(data, sharedSecret, message.fromId, ctx.state.peerId)

    const encrypted = encryptBuffer(plaintext, ctx.state.masterKey)
    fs.writeFileSync(cachedPath, encrypted, { mode: 0o600 })
    try { saveFileCache(ctx.state.database, { messageId, cachedPath }) } catch {}
    // 진행 중인 재요청 타이머 취소 — 성공했으므로 retry 불필요
    clearPendingFileRequest(ctx, messageId)
    sendToRenderer(ctx, 'file-cached', { messageId, cachedPath })
    writePeerDebugLog('inbound.fileData.received', { messageId, fileName, cachedPath })
  } catch (err) {
    writePeerDebugLog('inbound.fileData.receiveError', { messageId, error: err.message })
  }
}
