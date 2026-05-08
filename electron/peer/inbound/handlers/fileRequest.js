// 파일 전송 요청 (file-request) — 요청자에게 ECDH 공유키로 암호화한 file-data 응답.
// LAN 도청 방어를 위해 평문 base64 송신은 금지 (보안 4단계, wire v3).
// 디스크의 ciphertext 를 자기 마스터키로 복호화 → 요청자 공유키로 다시 암호화 → 송신.

const path = require('path')
const fs = require('fs')
const { sendPeerMessage } = require('../../../utils/appUtils')
const { decryptBuffer, isEncryptedFile } = require('../../../crypto/fileEncryption')
const { deriveSharedSecret } = require('../../../crypto/encryption')
const { encryptFileForPeer } = require('../../../crypto/peerFileTransfer')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleFileRequest({ message, ctx }) {
  const appDataPath = ctx.config.appDataPath
  const { messageId, fileName } = message
  const filePath = path.join(appDataPath, 'files', fileName)
  if (!fileName || !fs.existsSync(filePath)) {
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
