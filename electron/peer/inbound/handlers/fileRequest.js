// 파일 전송 요청 (file-request) — 요청자에게 ECDH 공유키로 암호화한 file-data 응답.
// LAN 도청 방어를 위해 평문 base64 송신은 금지 (보안 4단계, wire v3).
// 디스크의 ciphertext 를 자기 마스터키로 복호화 → 요청자 공유키로 다시 암호화 → 송신.

const path = require('path')
const fs = require('fs')
const { sendPeerMessage } = require('../../../utils/appUtils')
const { decryptBuffer, isEncryptedFile } = require('../../../crypto/fileEncryption')
const { deriveSharedSecret } = require('../../../crypto/encryption')
const { encryptFileForPeer } = require('../../../crypto/peerFileTransfer')
const { getFileCache } = require('../../../storage/queries')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

// 디스크에서 messageId 또는 fileName 으로 파일 위치를 찾는다.
// 우선순위:
//   1) file_cache 의 messageId 매핑 — cacheOwnFile 로 저장된 영구 캐시 (확실)
//   2) tempFilePath/files/<fileName> — 호환성 폴백 (saveFile 직후, 마이그레이션 전 등)
//
// 주의: 메시지의 fileName 필드는 사용자 원본 파일명("screenshot.png") 일 수 있는데,
// saveFile 이 만든 디스크 파일은 uuid 기반 ("<uuid>.png") 이라 이름이 안 맞다.
// 그래서 messageId 기반 file_cache 조회가 필수.
function resolveFilePathOnDisk(ctx, messageId, fileName) {
  try {
    const cachedPath = getFileCache(ctx.state.database, messageId)
    if (cachedPath && fs.existsSync(cachedPath)) return cachedPath
  } catch { /* DB 조회 실패 시 폴백 */ }
  if (fileName) {
    const tryPath = path.join(ctx.config.appDataPath, 'files', fileName)
    if (fs.existsSync(tryPath)) return tryPath
  }
  return null
}

module.exports = function handleFileRequest({ message, ctx }) {
  const { messageId, fileName } = message
  const filePath = resolveFilePathOnDisk(ctx, messageId, fileName)
  if (!filePath) {
    writePeerDebugLog('inbound.fileRequest.notFound', { messageId, fileName })
    return
  }

  const requesterPublicKey = ctx.state.peerPublicKeyMap.get(message.fromId)
  if (!requesterPublicKey) {
    writePeerDebugLog('inbound.fileRequest.noPublicKey', { messageId, fromId: message.fromId })
    return
  }
  if (!ctx.state.masterKey) {
    writePeerDebugLog('inbound.fileRequest.noMasterKey', { messageId })
    return
  }

  try {
    const raw = fs.readFileSync(filePath)
    const plaintext = isEncryptedFile(raw)
      ? decryptBuffer(raw, ctx.state.masterKey)
      : raw // 마이그레이션 전 평문 호환

    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, requesterPublicKey)
    const data = encryptFileForPeer(plaintext, sharedSecret, ctx.state.peerId, message.fromId)
    const ext = path.extname(fileName)

    sendPeerMessage(ctx, message.fromId, {
      type: 'file-data',
      v: 3,
      fromId: ctx.state.peerId,
      messageId,
      fileName,
      ext,
      data,
    })
    writePeerDebugLog('inbound.fileRequest.sent', { messageId, fileName, toId: message.fromId, v: 3 })
  } catch (err) {
    writePeerDebugLog('inbound.fileRequest.sendError', { messageId, error: err.message })
  }
}
