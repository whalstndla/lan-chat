// 파일 전송 요청 (file-request) — 요청자에게 ECDH 공유키로 암호화한 file-data 응답.
// LAN 도청 방어를 위해 평문 base64 송신은 금지 (보안 4단계, wire v3).
// 디스크의 ciphertext 를 자기 마스터키로 복호화 → 요청자 공유키로 다시 암호화 → 송신.

const path = require('path')
const fs = require('fs')
const { sendPeerMessage, peerSupportsCapability, MAX_RAW_FILE_BYTES, MAX_CHUNKED_FILE_BYTES } = require('../../../utils/appUtils')
const { decryptBuffer, isEncryptedFile } = require('../../../crypto/fileEncryption')
const { deriveSharedSecret } = require('../../../crypto/encryption')
const { encryptFileForPeer } = require('../../../crypto/peerFileTransfer')
const { sendFileAsChunks } = require('../../fileChunkTransfer')
const { getFileCache } = require('../../../storage/queries')
const { writePeerDebugLog } = require('../../../utils/peerDebugLogger')

// 실패 시 요청자에게 명시적 에러 응답을 보낸다. 응답 없이 silent return 만 하면
// 요청자는 영원히 'loading' 상태로 대기 → 사용자가 "이미지 불러오기 실패" 도 못 보고 spinner 만 봄.
function replyError(ctx, requesterPeerId, messageId, reason) {
  writePeerDebugLog('inbound.fileRequest.replyError', { messageId, reason, toId: requesterPeerId })
  sendPeerMessage(ctx, requesterPeerId, {
    type: 'file-request-error',
    fromId: ctx.state.peerId,
    messageId,
    reason,
  })
}

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
  const requesterPeerId = message.fromId
  const filePath = resolveFilePathOnDisk(ctx, messageId, fileName)
  if (!filePath) {
    writePeerDebugLog('inbound.fileRequest.notFound', { messageId, fileName })
    replyError(ctx, requesterPeerId, messageId, 'notFound')
    return
  }

  const requesterPublicKey = ctx.state.peerPublicKeyMap.get(requesterPeerId)
  if (!requesterPublicKey) {
    writePeerDebugLog('inbound.fileRequest.noPublicKey', { messageId, fromId: requesterPeerId })
    replyError(ctx, requesterPeerId, messageId, 'noPublicKey')
    return
  }
  if (!ctx.state.masterKey) {
    writePeerDebugLog('inbound.fileRequest.noMasterKey', { messageId })
    replyError(ctx, requesterPeerId, messageId, 'noMasterKey')
    return
  }

  // 청크 지원 협상 여부 — 요청자가 'file-chunk' 를 협상했으면 청크 스트리밍, 아니면 레거시 폴백.
  // 협상 정보가 없으면(peerManager/세션 없음, 구버전 피어) 안전하게 레거시 경로를 택한다.
  const useChunk = peerSupportsCapability(ctx, requesterPeerId, 'file-chunk')
  // 청크 경로는 단일 프레임 제약이 없어 더 큰 상한(1GB)을, 레거시는 단발 한도(150MB)를 적용.
  const sizeLimit = useChunk ? MAX_CHUNKED_FILE_BYTES : MAX_RAW_FILE_BYTES

  // 파일 사이즈 사전 가드 — 상한 초과 파일은 거부 (레거시는 wsServer maxPayload 초과로 연결이
  // 끊기고, 청크는 메모리 폭증을 유발하므로 양쪽 다 사전 차단하는 것이 안전).
  try {
    const stat = fs.statSync(filePath)
    // 평문 크기 추정: 암호화 envelope 인 경우 HEADER_BYTES(33) 만큼 더 큰 디스크 크기 → iv/tag 여유 포함.
    if (stat.size > sizeLimit + 1024) {
      writePeerDebugLog('inbound.fileRequest.tooLarge', { messageId, fileName, size: stat.size, sizeLimit, useChunk })
      replyError(ctx, requesterPeerId, messageId, 'tooLarge')
      return
    }
  } catch { /* stat 실패 시 송신 시도 (정상 케이스에서는 발생 안 함) */ }

  if (useChunk) {
    // 청크 스트리밍 — 비동기로 파일을 읽어(루프 블로킹 회피) 1MB 단위로 흘려보낸다.
    // sendFileAsChunks 는 내부에서 try/catch/finally 로 실패 시 file-request-error(sendError) 를
    // 보내므로 여기서는 fire-and-forget 하되 방어적으로 catch 만 붙인다.
    writePeerDebugLog('inbound.fileRequest.chunkStart', { messageId, fileName, toId: requesterPeerId })
    Promise.resolve(sendFileAsChunks(ctx, { requesterPeerId, messageId, fileName, filePath }))
      .catch((err) => {
        writePeerDebugLog('inbound.fileRequest.chunkError', { messageId, error: err?.message })
      })
    return
  }

  // 레거시 단발 file-data 경로 (구버전 피어 폴백) — 기존 동작 그대로 보존.
  try {
    const raw = fs.readFileSync(filePath)
    const plaintext = isEncryptedFile(raw)
      ? decryptBuffer(raw, ctx.state.masterKey)
      : raw // 마이그레이션 전 평문 호환

    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, requesterPublicKey)
    const data = encryptFileForPeer(plaintext, sharedSecret, ctx.state.peerId, requesterPeerId)
    const ext = path.extname(fileName)

    sendPeerMessage(ctx, requesterPeerId, {
      type: 'file-data',
      v: 3,
      fromId: ctx.state.peerId,
      messageId,
      fileName,
      ext,
      data,
    })
    writePeerDebugLog('inbound.fileRequest.sent', { messageId, fileName, toId: requesterPeerId, v: 3 })
  } catch (err) {
    writePeerDebugLog('inbound.fileRequest.sendError', { messageId, error: err.message })
    replyError(ctx, requesterPeerId, messageId, 'sendError')
  }
}
