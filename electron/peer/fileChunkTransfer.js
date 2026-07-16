// 파일 청크 스트리밍 전송 (#44/#45/#49) — main 프로세스 오케스트레이션.
//
// 배경: 기존 단발 file-data 는 최대 ~150MB 파일을 프레임 1개로 JSON.stringify/JSON.parse 하여
// 메인 이벤트 루프가 수 초간 정지(모든 피어 채팅/heartbeat/IPC 멈춤) + HOL 블로킹 + 메모리 폭증.
// 이 모듈은 파일을 1MB 청크로 쪼개 각 청크를 자체 IV/tag 로 암호화해 순차 전송하고, 청크 사이에
// setImmediate 로 이벤트 루프를 양보한다. 수신측은 transferId 별로 조립해 완료 시 기존 file-data
// 와 완전히 동일한 포맷/경로/헬퍼(saveFileCache, file_cache/<messageId><ext>)로 저장한다.
//
// 하위호환: 요청자가 'file-chunk' capability 를 협상하지 못하면(구버전 피어) fileRequest 핸들러가
// 레거시 단발 file-data 로 폴백한다 — 이 모듈은 청크 경로만 담당한다.

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const { deriveSharedSecret } = require('../crypto/encryption')
const {
  deriveFileTransferKey,
  encryptChunkWithKey,
  decryptChunkWithKey,
} = require('../crypto/peerFileTransfer')
const { encryptBuffer, decryptBuffer, isEncryptedFile } = require('../crypto/fileEncryption')
const { saveFileCache, getFileCache } = require('../storage/queries')
const {
  sendPeerMessage,
  sendToRenderer,
  clearPendingFileRequest,
  requestFileViaWebSocket,
  MAX_CHUNKED_FILE_BYTES,
} = require('../utils/appUtils')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')

// 청크 크기 — wsServer maxPayload(200MB) 훨씬 아래. 1MB 면 base64 오버헤드(1.33x)를 감안해도
// 프레임당 JSON.stringify/parse 가 수 ms 로 끝나 이벤트 루프가 매끄럽게 양보된다.
const FILE_CHUNK_SIZE_BYTES = 1024 * 1024

// 수신측 stall 타임아웃 — 마지막 진행(청크 수신) 이후 이 시간 동안 아무 청크도 안 오면
// 전송이 멈춘 것으로 보고 부분 버퍼를 폐기한 뒤 재요청으로 retry 안전망을 복구한다.
const DEFAULT_INBOUND_TRANSFER_TIMEOUT_MS = 20000
let inboundTransferTimeoutMs = DEFAULT_INBOUND_TRANSFER_TIMEOUT_MS

// 동시 진행 가능한 수신 transfer 상한 — 자원 고갈(메모리) 방어.
const MAX_CONCURRENT_INBOUND_TRANSFERS = 20

// 테스트 전용 — stall 타임아웃을 짧게 바꿔 타임아웃 정리 동작을 검증한다.
function __setInboundTransferTimeoutForTest(ms) {
  inboundTransferTimeoutMs = Number.isFinite(ms) ? ms : DEFAULT_INBOUND_TRANSFER_TIMEOUT_MS
}

// ─── 송신 ────────────────────────────────────────────────────────────────────

// 파일을 청크로 쪼개 요청자에게 스트리밍 전송한다. 호출부(handleFileRequest)에서 이미
// filePath/공개키/마스터키 존재를 확인했다고 가정한다. async — 청크 사이마다 이벤트 루프 양보.
async function sendFileAsChunks(ctx, { requesterPeerId, messageId, fileName, filePath }) {
  const transferId = randomUUID()
  ctx.state.outboundFileTransfers.set(transferId, { canceled: false, requesterPeerId, messageId })
  try {
    const requesterPublicKey = ctx.state.peerPublicKeyMap.get(requesterPeerId)
    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, requesterPublicKey)
    // HKDF 도출은 전송당 1회 — 청크마다 반복하지 않는다.
    const key = deriveFileTransferKey(sharedSecret, ctx.state.peerId, requesterPeerId)

    // 디스크 ciphertext 를 비동기로 읽어(디스크 IO 로 루프 블로킹 회피) 마스터키로 복호화.
    // AES-GCM 은 전체파일 태그라 청크 단위 복호가 불가능 → 전체 평문을 메모리에 1회 확보한다.
    const raw = await fs.promises.readFile(filePath)
    const plaintext = isEncryptedFile(raw) ? decryptBuffer(raw, ctx.state.masterKey) : raw

    const ext = path.extname(fileName)
    const totalBytes = plaintext.length
    const totalChunks = Math.max(1, Math.ceil(totalBytes / FILE_CHUNK_SIZE_BYTES))

    // 파일 읽는 사이 취소됐을 수 있으니 확인.
    if (ctx.state.outboundFileTransfers.get(transferId)?.canceled) {
      writePeerDebugLog('fileChunk.send.canceledBeforeStart', { transferId, messageId })
      return
    }

    sendPeerMessage(ctx, requesterPeerId, {
      type: 'file-chunk-start',
      fromId: ctx.state.peerId,
      transferId,
      messageId,
      fileName,
      ext,
      totalChunks,
      totalBytes,
    })

    for (let seq = 0; seq < totalChunks; seq += 1) {
      const transfer = ctx.state.outboundFileTransfers.get(transferId)
      if (!transfer || transfer.canceled) {
        writePeerDebugLog('fileChunk.send.aborted', { transferId, messageId, seq })
        return
      }
      const start = seq * FILE_CHUNK_SIZE_BYTES
      const end = Math.min(start + FILE_CHUNK_SIZE_BYTES, totalBytes)
      // subarray 는 복사 없이 뷰 — 암호화 입력으로만 쓰이므로 안전.
      const data = encryptChunkWithKey(plaintext.subarray(start, end), key)
      sendPeerMessage(ctx, requesterPeerId, {
        type: 'file-chunk',
        fromId: ctx.state.peerId,
        transferId,
        seq,
        data,
      })
      // 이벤트 루프 양보 — 다른 피어 채팅/heartbeat/IPC 가 청크 사이에 처리되게 한다.
      await new Promise((resolve) => setImmediate(resolve))
    }

    if (!ctx.state.outboundFileTransfers.get(transferId)?.canceled) {
      sendPeerMessage(ctx, requesterPeerId, {
        type: 'file-chunk-end',
        fromId: ctx.state.peerId,
        transferId,
      })
      writePeerDebugLog('fileChunk.send.done', { transferId, messageId, totalChunks, totalBytes })
    }
  } catch (err) {
    writePeerDebugLog('fileChunk.send.error', { transferId, messageId, error: err.message })
    // 송신 실패 — 요청자에게 명시적 영구 실패 통보(레거시 sendError 와 동일 취급).
    // 요청자는 즉시 failed 전환되고 진행 중 retry 도 정리된다.
    try {
      sendPeerMessage(ctx, requesterPeerId, {
        type: 'file-request-error',
        fromId: ctx.state.peerId,
        messageId,
        reason: 'sendError',
      })
    } catch { /* 소켓 종료 등 — 무시 */ }
  } finally {
    ctx.state.outboundFileTransfers.delete(transferId)
  }
}

// ─── 수신 ────────────────────────────────────────────────────────────────────

// transfer 상태 정리 (타이머 + 두 인덱스 맵).
function cleanupInboundTransfer(ctx, transferId) {
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  if (!transfer) return
  if (transfer.timer) clearTimeout(transfer.timer)
  ctx.state.inboundFileTransfers.delete(transferId)
  if (ctx.state.inboundFileTransferByMessage.get(transfer.messageId) === transferId) {
    ctx.state.inboundFileTransferByMessage.delete(transfer.messageId)
  }
}

// 진행 중 transfer 를 폐기. reRequest 면 아직 캐시 안 된 경우 재요청으로 retry 안전망 복구.
function abortInboundTransfer(ctx, transferId, { reRequest = false } = {}) {
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  if (!transfer) return
  const { messageId, fileName, fromId } = transfer
  cleanupInboundTransfer(ctx, transferId)
  if (!reRequest) return
  let alreadyCached = false
  try {
    const cachedPath = getFileCache(ctx.state.database, messageId)
    alreadyCached = !!(cachedPath && fs.existsSync(cachedPath))
  } catch { /* DB 조회 실패 시 재요청 시도 */ }
  if (!alreadyCached) requestFileViaWebSocket(ctx, messageId, fileName, fromId)
}

// stall 타임아웃 무장/리셋 — 청크가 올 때마다 다시 건다.
function armInboundTimeout(ctx, transferId) {
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  if (!transfer) return
  if (transfer.timer) clearTimeout(transfer.timer)
  transfer.timer = setTimeout(() => {
    writePeerDebugLog('fileChunk.timeout', {
      transferId,
      messageId: transfer.messageId,
      received: transfer.receivedCount,
      total: transfer.totalChunks,
    })
    abortInboundTransfer(ctx, transferId, { reRequest: true })
  }, inboundTransferTimeoutMs)
  if (transfer.timer.unref) transfer.timer.unref()
}

// file-chunk-start 수신 — transfer 초기화.
function handleFileChunkStart(ctx, message) {
  const { transferId, messageId, fileName, ext, totalChunks, totalBytes, fromId } = message
  if (!transferId || !messageId || !fileName) return
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) return
  // 사이즈 상한 방어 — 버그성/악의적 거대 totalBytes 거부.
  if (!Number.isFinite(totalBytes) || totalBytes < 0 || totalBytes > MAX_CHUNKED_FILE_BYTES) {
    writePeerDebugLog('fileChunk.start.tooLarge', { transferId, messageId, totalBytes })
    return
  }
  // 이미 같은 transferId 진행 중이면 중복 start 무시.
  if (ctx.state.inboundFileTransfers.has(transferId)) return
  // 동시 진행 상한 — 자원 고갈 방어.
  if (ctx.state.inboundFileTransfers.size >= MAX_CONCURRENT_INBOUND_TRANSFERS) {
    writePeerDebugLog('fileChunk.start.tooMany', { transferId, messageId, active: ctx.state.inboundFileTransfers.size })
    return
  }
  const senderPublicKey = ctx.state.peerPublicKeyMap.get(fromId)
  if (!senderPublicKey) {
    writePeerDebugLog('fileChunk.start.noPublicKey', { transferId, messageId, fromId })
    return
  }
  if (!ctx.state.masterKey) {
    writePeerDebugLog('fileChunk.start.noMasterKey', { transferId, messageId })
    return
  }

  const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, senderPublicKey)
  const key = deriveFileTransferKey(sharedSecret, fromId, ctx.state.peerId)

  const transfer = {
    messageId,
    fileName,
    ext: ext || path.extname(fileName),
    totalChunks,
    totalBytes,
    fromId,
    key,
    chunks: new Map(),   // seq → 평문 Buffer
    receivedBytes: 0,
    receivedCount: 0,
    timer: null,
  }
  ctx.state.inboundFileTransfers.set(transferId, transfer)
  ctx.state.inboundFileTransferByMessage.set(messageId, transferId)

  // 전송이 실제로 시작됐으니 요청자측 pending retry 타이머는 정리 — 중복 file-request 방지.
  // (전송이 멈추면 아래 stall 타임아웃이 재요청으로 안전망을 복구한다.)
  clearPendingFileRequest(ctx, messageId)
  armInboundTimeout(ctx, transferId)
  writePeerDebugLog('fileChunk.start.received', { transferId, messageId, totalChunks, totalBytes })
}

// file-chunk 수신 — 복호화 후 seq 위치에 저장. 순서 어긋남/중복은 안전하게 처리.
function handleFileChunk(ctx, message) {
  const { transferId, seq, data } = message
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  // start 미수신/이미 정리됨 → drop. 요청자 pending 또는 stall 타임아웃이 복구를 담당한다.
  if (!transfer) return
  if (!Number.isInteger(seq) || seq < 0 || seq >= transfer.totalChunks) return
  if (transfer.chunks.has(seq)) return // 중복 청크 무시
  if (typeof data !== 'string') return

  try {
    const plainChunk = decryptChunkWithKey(data, transfer.key)
    transfer.chunks.set(seq, plainChunk)
    transfer.receivedBytes += plainChunk.length
    transfer.receivedCount += 1
    armInboundTimeout(ctx, transferId) // 진행 있으니 stall 타임아웃 리셋
    sendToRenderer(ctx, 'file-progress', {
      messageId: transfer.messageId,
      received: transfer.receivedBytes,
      total: transfer.totalBytes,
    })
    // 모든 청크가 도착하면 file-chunk-end 를 기다리지 않고 즉시 조립(순서 무관 완료 판정).
    if (transfer.receivedCount >= transfer.totalChunks) {
      finalizeInboundTransfer(ctx, transferId)
    }
  } catch (err) {
    // 복호화 실패(위변조/키 불일치) — 부분 폐기 후 재요청.
    writePeerDebugLog('fileChunk.chunk.decryptError', { transferId, seq, error: err.message })
    abortInboundTransfer(ctx, transferId, { reRequest: true })
  }
}

// file-chunk-end 수신 — 완료 backstop. 이미 마지막 청크에서 조립됐으면 no-op.
function handleFileChunkEnd(ctx, message) {
  const { transferId } = message
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  if (!transfer) return
  if (transfer.receivedCount < transfer.totalChunks) {
    // 청크 유실 상태로 end 도착 → 부분 폐기 후 재요청으로 복구.
    writePeerDebugLog('fileChunk.end.incomplete', {
      transferId,
      received: transfer.receivedCount,
      total: transfer.totalChunks,
    })
    abortInboundTransfer(ctx, transferId, { reRequest: true })
    return
  }
  finalizeInboundTransfer(ctx, transferId)
}

// 조립 완료 — seq 순서로 이어붙여 평문 복원 → 마스터키 재암호화 → file_cache 저장.
// 기존 file-data 수신(fileData.js)과 완전히 동일한 저장 포맷/경로/헬퍼를 사용한다.
function finalizeInboundTransfer(ctx, transferId) {
  const transfer = ctx.state.inboundFileTransfers.get(transferId)
  if (!transfer) return
  try {
    const ordered = []
    for (let seq = 0; seq < transfer.totalChunks; seq += 1) {
      const chunk = transfer.chunks.get(seq)
      if (!chunk) {
        // 유실 청크 발견 — 재요청으로 복구.
        abortInboundTransfer(ctx, transferId, { reRequest: true })
        return
      }
      ordered.push(chunk)
    }
    const plaintext = Buffer.concat(ordered)

    const cacheDir = path.join(ctx.config.appDataPath, 'file_cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const cachedFileName = `${transfer.messageId}${transfer.ext}`
    const cachedPath = path.join(cacheDir, cachedFileName)
    const encrypted = encryptBuffer(plaintext, ctx.state.masterKey)
    fs.writeFileSync(cachedPath, encrypted, { mode: 0o600 })
    try { saveFileCache(ctx.state.database, { messageId: transfer.messageId, cachedPath }) } catch {}

    // 진행 중인 재요청 타이머 취소 — 성공했으므로 retry 불필요(레거시 file-data 와 동일).
    clearPendingFileRequest(ctx, transfer.messageId)
    cleanupInboundTransfer(ctx, transferId)
    sendToRenderer(ctx, 'file-cached', { messageId: transfer.messageId, cachedPath })
    writePeerDebugLog('fileChunk.finalize.done', {
      transferId,
      messageId: transfer.messageId,
      bytes: plaintext.length,
    })
  } catch (err) {
    writePeerDebugLog('fileChunk.finalize.error', { transferId, error: err.message })
    abortInboundTransfer(ctx, transferId, { reRequest: true })
  }
}

// file-cancel 수신 — 주로 송신측이 받는다(요청자가 전송 취소). 송신 루프가 다음 청크 전에 abort.
function handleFileCancel(ctx, message) {
  const { transferId } = message
  const outbound = ctx.state.outboundFileTransfers.get(transferId)
  if (outbound) {
    outbound.canceled = true
    writePeerDebugLog('fileChunk.cancel.received', { transferId })
  }
  // 방어: 같은 transferId 의 inbound 도 있으면 부분 폐기.
  if (ctx.state.inboundFileTransfers.has(transferId)) {
    cleanupInboundTransfer(ctx, transferId)
  }
}

// 렌더러 취소(messageId 기반) — 진행 중 inbound transfer 를 폐기하고 송신측에 file-cancel 통보.
function cancelInboundTransferByMessageId(ctx, messageId) {
  if (!messageId) return
  const transferId = ctx.state.inboundFileTransferByMessage.get(messageId)
  if (transferId) {
    const transfer = ctx.state.inboundFileTransfers.get(transferId)
    const fromId = transfer?.fromId
    cleanupInboundTransfer(ctx, transferId)
    if (fromId) {
      sendPeerMessage(ctx, fromId, { type: 'file-cancel', fromId: ctx.state.peerId, transferId })
    }
  }
  // 청크 시작 전(pending 단계) 요청도 함께 정리.
  clearPendingFileRequest(ctx, messageId)
  // 렌더러엔 취소를 실패(canceled)로 통보 → spinner 종료.
  sendToRenderer(ctx, 'file-request-error', { messageId, reason: 'canceled' })
}

// 로그아웃/세션 종료 시 진행 중인 모든 청크 transfer 정리.
function clearAllFileChunkTransfers(ctx) {
  if (ctx.state.inboundFileTransfers) {
    for (const transfer of ctx.state.inboundFileTransfers.values()) {
      if (transfer.timer) clearTimeout(transfer.timer)
    }
    ctx.state.inboundFileTransfers.clear()
  }
  if (ctx.state.inboundFileTransferByMessage) ctx.state.inboundFileTransferByMessage.clear()
  if (ctx.state.outboundFileTransfers) {
    for (const transfer of ctx.state.outboundFileTransfers.values()) {
      transfer.canceled = true // 진행 중 송신 루프가 다음 청크 전에 멈추도록.
    }
    ctx.state.outboundFileTransfers.clear()
  }
}

module.exports = {
  FILE_CHUNK_SIZE_BYTES,
  sendFileAsChunks,
  handleFileChunkStart,
  handleFileChunk,
  handleFileChunkEnd,
  handleFileCancel,
  cancelInboundTransferByMessageId,
  clearAllFileChunkTransfers,
  __setInboundTransferTimeoutForTest,
}
