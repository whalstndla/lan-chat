// 파일 전송 요청 (file-request) — HTTP가 막힌 환경에서 WebSocket으로 파일 직접 전달.
const path = require('path')
const fs = require('fs')
const { sendPeerMessage } = require('../../../utils/appUtils')
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
    const data = fs.readFileSync(filePath).toString('base64')
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
