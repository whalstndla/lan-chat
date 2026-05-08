// 파일 전송 요청 (file-request) — HTTP가 막힌 환경에서 WebSocket으로 파일 직접 전달.
// 디스크의 ciphertext 를 마스터키로 복호화해 평문 base64 로 보낸다.
// 4단계에서 ECDH 공유키 기반 ciphertext 송신으로 재설계 예정.
const path = require('path')
const fs = require('fs')
const { sendPeerMessage } = require('../../../utils/appUtils')
const { decryptBuffer, isEncryptedFile } = require('../../../crypto/fileEncryption')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

module.exports = function handleFileRequest({ message, ctx }) {
  const appDataPath = ctx.config.appDataPath
  const { messageId, fileName } = message
  const filePath = path.join(appDataPath, 'files', fileName)
  if (!fileName || !fs.existsSync(filePath)) {
    writePeerDebugLog('inbound.fileRequest.notFound', { messageId, fileName })
    return
  }
  try {
    const raw = fs.readFileSync(filePath)
    let plaintext
    if (isEncryptedFile(raw)) {
      if (!ctx.state.masterKey) throw new Error('마스터키 미초기화')
      plaintext = decryptBuffer(raw, ctx.state.masterKey)
    } else {
      // 마이그레이션 전 평문 호환 — 다음 부팅 시 일괄 암호화 예정
      plaintext = raw
    }
    const data = plaintext.toString('base64')
    const ext = path.extname(fileName)
    sendPeerMessage(ctx, message.fromId, {
      type: 'file-data',
      fromId: ctx.state.peerId,
      messageId,
      fileName,
      ext,
      data,
    })
    writePeerDebugLog('inbound.fileRequest.sent', { messageId, fileName, toId: message.fromId })
  } catch (err) {
    writePeerDebugLog('inbound.fileRequest.sendError', { messageId, error: err.message })
  }
}
