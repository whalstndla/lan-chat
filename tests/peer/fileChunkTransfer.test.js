// 청크 전송(#44/#45/#49) 오케스트레이션 단위 테스트.
// 송신(sendFileAsChunks) → 수신 조립(handleFileChunkStart/Chunk/End) 왕복이 원본과 바이트
// 동일하게 file_cache 에 저장되는지, 순서 뒤섞임/취소/타임아웃/미지원 폴백을 안전하게 처리하는지 검증.

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

// ws 의존성 끊기 — Node 환경에서 직접 호출만 검증 (fileRequestHandler.test.js 와 동일 패턴).
jest.mock('../../electron/peer/wsClient', () => ({
  sendMessage: jest.fn(() => true),
  getConnections: jest.fn(() => []),
  disconnectFromPeer: jest.fn(),
}))
jest.mock('../../electron/peer/wsServer', () => ({
  getServerClientPeerIds: jest.fn(() => []),
  sendMessageToServerPeer: jest.fn(() => false),
  MAX_PAYLOAD_BYTES: 200 * 1024 * 1024,
}))
jest.mock('../../electron/peer/fileServer', () => ({ getFilePort: () => 50000 }))
jest.mock('../../electron/storage/profile', () => ({ getProfile: jest.fn(() => null) }))
jest.mock('../../electron/storage/pendingMessages', () => ({
  getPendingMessages: jest.fn(() => []),
  deletePendingMessage: jest.fn(),
}))
jest.mock('../../electron/storage/queries', () => {
  const actual = jest.requireActual('../../electron/storage/queries')
  return { ...actual, saveFileCache: jest.fn(), getFileCache: jest.fn(() => null) }
})

const { sendMessage } = require('../../electron/peer/wsClient')
const { createAppContext } = require('../../electron/context')
const { encryptBuffer, decryptBuffer } = require('../../electron/crypto/fileEncryption')
const {
  sendFileAsChunks,
  handleFileChunkStart,
  handleFileChunk,
  handleFileChunkEnd,
  handleFileCancel,
  cancelInboundTransferByMessageId,
  clearAllFileChunkTransfers,
  __setInboundTransferTimeoutForTest,
} = require('../../electron/peer/fileChunkTransfer')
const handleFileRequest = require('../../electron/peer/inbound/handlers/fileRequest')
const { clearAllPendingFileRequests } = require('../../electron/utils/appUtils')

function makeMainWindow() {
  const sends = []
  return {
    isDestroyed: () => false,
    isFocused: () => true,
    webContents: { isDestroyed: () => false, send: (channel, data) => sends.push({ channel, data }) },
    _sends: sends,
  }
}
function makeKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

// sender/receiver 는 서로의 공개키를 알고, 같은 ECDH 공유키 → 같은 파일전송키를 도출한다.
const senderKp = makeKeyPair()
const receiverKp = makeKeyPair()

function makeSenderCtx(dir, { supportChunk = true } = {}) {
  const ctx = createAppContext({ appDataPath: dir })
  ctx.state.peerId = 'sender'
  ctx.state.masterKey = Buffer.alloc(32, 0x11)
  ctx.state.myPrivateKey = senderKp.privateKey
  ctx.state.mainWindow = makeMainWindow()
  ctx.state.wsServerInfo = { server: {}, port: 49152 }
  ctx.state.peerPublicKeyMap.set('receiver', receiverKp.publicKey)
  if (supportChunk) {
    // peerManager 세션의 remoteCapabilities 에 file-chunk 포함 → 청크 경로 선택.
    ctx.state.peerManager = { getSession: () => ({ handshake: { remoteCapabilities: ['file-chunk'] } }) }
  }
  return ctx
}
function makeReceiverCtx(dir) {
  const ctx = createAppContext({ appDataPath: dir })
  ctx.state.peerId = 'receiver'
  ctx.state.masterKey = Buffer.alloc(32, 0x22)
  ctx.state.myPrivateKey = receiverKp.privateKey
  ctx.state.mainWindow = makeMainWindow()
  ctx.state.wsServerInfo = { server: {}, port: 49153 }
  ctx.state.peerPublicKeyMap.set('sender', senderKp.publicKey)
  return ctx
}

// sender 디스크에 masterKey 로 암호화된 파일을 만들고, 송신 후 캡처된 청크 메시지를 반환.
async function produceChunks(senderCtx, senderDir, { original, messageId, fileName }) {
  const filePath = path.join(senderDir, 'files', fileName)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, encryptBuffer(original, senderCtx.state.masterKey))
  sendMessage.mockClear()
  await sendFileAsChunks(senderCtx, { requesterPeerId: 'receiver', messageId, fileName, filePath })
  const messages = sendMessage.mock.calls.map((call) => call[1])
  return {
    filePath,
    start: messages.find((m) => m.type === 'file-chunk-start'),
    chunks: messages.filter((m) => m.type === 'file-chunk'),
    end: messages.find((m) => m.type === 'file-chunk-end'),
  }
}

describe('sendFileAsChunks — 송신', () => {
  let senderCtx, senderDir
  beforeEach(() => {
    sendMessage.mockReset()
    sendMessage.mockImplementation(() => true)
    senderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-s-'))
    senderCtx = makeSenderCtx(senderDir)
  })
  afterEach(() => {
    clearAllFileChunkTransfers(senderCtx)
    fs.rmSync(senderDir, { recursive: true, force: true })
  })

  it('start(정확한 totalChunks/totalBytes) + 청크들 + end 순서로 전송', async () => {
    const original = crypto.randomBytes(2_500_000) // 1MB 청크 → 3개
    const { start, chunks, end } = await produceChunks(senderCtx, senderDir, {
      original, messageId: 'm-send', fileName: 'photo.png',
    })
    expect(start).toMatchObject({ type: 'file-chunk-start', messageId: 'm-send', fileName: 'photo.png', ext: '.png', totalChunks: 3, totalBytes: 2_500_000 })
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2])
    expect(chunks.every((c) => typeof c.data === 'string')).toBe(true)
    expect(end).toMatchObject({ type: 'file-chunk-end' })
    // 전송 완료 후 outbound transfer 정리됨
    expect(senderCtx.state.outboundFileTransfers.size).toBe(0)
  })

  it('취소되면 남은 청크와 end 를 보내지 않고 중단', async () => {
    const original = crypto.randomBytes(5 * 1024 * 1024) // 5개 청크
    const filePath = path.join(senderDir, 'files', 'big.bin')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, encryptBuffer(original, senderCtx.state.masterKey))
    sendMessage.mockClear()
    // 첫 청크(seq 0) 전송 시점에 취소 주입.
    sendMessage.mockImplementation((peerId, msg) => {
      if (msg.type === 'file-chunk' && msg.seq === 0) {
        handleFileCancel(senderCtx, { type: 'file-cancel', transferId: msg.transferId })
      }
      return true
    })
    await sendFileAsChunks(senderCtx, { requesterPeerId: 'receiver', messageId: 'm-cancel', fileName: 'big.bin', filePath })
    const sentTypes = sendMessage.mock.calls.map((c) => c[1].type)
    const sentChunkSeqs = sendMessage.mock.calls.map((c) => c[1]).filter((m) => m.type === 'file-chunk').map((m) => m.seq)
    expect(Math.max(...sentChunkSeqs)).toBeLessThan(4) // 마지막(seq 4) 청크는 안 보냄
    expect(sentTypes).not.toContain('file-chunk-end')
    expect(senderCtx.state.outboundFileTransfers.size).toBe(0)
  })
})

describe('수신 조립 — 왕복 바이트 동일', () => {
  let senderCtx, receiverCtx, senderDir, receiverDir
  beforeEach(() => {
    sendMessage.mockReset()
    sendMessage.mockImplementation(() => true)
    senderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-s-'))
    receiverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-r-'))
    senderCtx = makeSenderCtx(senderDir)
    receiverCtx = makeReceiverCtx(receiverDir)
  })
  afterEach(() => {
    clearAllFileChunkTransfers(senderCtx)
    clearAllFileChunkTransfers(receiverCtx)
    clearAllPendingFileRequests(receiverCtx)
    fs.rmSync(senderDir, { recursive: true, force: true })
    fs.rmSync(receiverDir, { recursive: true, force: true })
  })

  function assertAssembled(original, messageId, ext) {
    const cachedPath = path.join(receiverDir, 'file_cache', `${messageId}${ext}`)
    expect(fs.existsSync(cachedPath)).toBe(true)
    const decrypted = decryptBuffer(fs.readFileSync(cachedPath), receiverCtx.state.masterKey)
    expect(decrypted.equals(original)).toBe(true)
    expect(receiverCtx.state.mainWindow._sends.some((s) => s.channel === 'file-cached' && s.data.messageId === messageId)).toBe(true)
    // 조립 완료 후 transfer 상태 정리
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
    expect(receiverCtx.state.inboundFileTransferByMessage.size).toBe(0)
  }

  it('in-order 청크 조립 → 원본과 바이트 동일', async () => {
    const original = crypto.randomBytes(2_500_000)
    const { start, chunks, end } = await produceChunks(senderCtx, senderDir, { original, messageId: 'm-io', fileName: 'a.png' })
    sendMessage.mockClear()
    handleFileChunkStart(receiverCtx, start)
    chunks.forEach((c) => handleFileChunk(receiverCtx, c))
    handleFileChunkEnd(receiverCtx, end) // backstop — 이미 조립됨
    assertAssembled(original, 'm-io', '.png')
  })

  it('순서 뒤섞인 청크도 seq 로 올바르게 조립', async () => {
    const original = crypto.randomBytes(3_500_000) // 4개 청크
    const { start, chunks, end } = await produceChunks(senderCtx, senderDir, { original, messageId: 'm-ooo', fileName: 'b.bin' })
    sendMessage.mockClear()
    handleFileChunkStart(receiverCtx, start)
    // 역순 + 셔플로 전달
    const shuffled = [...chunks].reverse()
    shuffled.forEach((c) => handleFileChunk(receiverCtx, c))
    handleFileChunkEnd(receiverCtx, end)
    assertAssembled(original, 'm-ooo', '.bin')
  })

  it('중복 청크가 와도 한 번만 반영되어 정상 조립', async () => {
    const original = crypto.randomBytes(1_500_000) // 2개 청크
    const { start, chunks } = await produceChunks(senderCtx, senderDir, { original, messageId: 'm-dup', fileName: 'c.png' })
    sendMessage.mockClear()
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, chunks[0])
    handleFileChunk(receiverCtx, chunks[0]) // 중복
    handleFileChunk(receiverCtx, chunks[1])
    assertAssembled(original, 'm-dup', '.png')
  })

  it('진행률(file-progress) 이 수신 중 렌더러로 전달', async () => {
    const original = crypto.randomBytes(2_500_000)
    const { start, chunks } = await produceChunks(senderCtx, senderDir, { original, messageId: 'm-prog', fileName: 'd.png' })
    sendMessage.mockClear()
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, chunks[0])
    const progressEvents = receiverCtx.state.mainWindow._sends.filter((s) => s.channel === 'file-progress')
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents[0].data).toMatchObject({ messageId: 'm-prog', total: 2_500_000 })
    expect(progressEvents[0].data.received).toBeGreaterThan(0)
  })
})

describe('수신 — 취소 / 타임아웃 / 방어', () => {
  let senderCtx, receiverCtx, senderDir, receiverDir
  let start, chunks
  beforeEach(async () => {
    sendMessage.mockReset()
    sendMessage.mockImplementation(() => true)
    senderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-s-'))
    receiverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-r-'))
    senderCtx = makeSenderCtx(senderDir)
    receiverCtx = makeReceiverCtx(receiverDir)
    const original = crypto.randomBytes(3_000_000) // 3개 청크
    const produced = await produceChunks(senderCtx, senderDir, { original, messageId: 'm-x', fileName: 'e.png' })
    start = produced.start
    chunks = produced.chunks
    sendMessage.mockClear()
  })
  afterEach(() => {
    __setInboundTransferTimeoutForTest() // 기본값 복원
    clearAllFileChunkTransfers(senderCtx)
    clearAllFileChunkTransfers(receiverCtx)
    clearAllPendingFileRequests(receiverCtx)
    fs.rmSync(senderDir, { recursive: true, force: true })
    fs.rmSync(receiverDir, { recursive: true, force: true })
  })

  it('수신측 취소 — 부분 폐기 + 송신측에 file-cancel + 렌더러 canceled 통보', () => {
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, chunks[0]) // 부분 수신
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(1)

    cancelInboundTransferByMessageId(receiverCtx, 'm-x')

    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
    expect(receiverCtx.state.inboundFileTransferByMessage.size).toBe(0)
    // 송신측(fromId='sender')에 file-cancel 전송
    const cancelSent = sendMessage.mock.calls.map((c) => c[1]).find((m) => m.type === 'file-cancel')
    expect(cancelSent).toBeTruthy()
    expect(cancelSent.transferId).toBe(start.transferId)
    // 렌더러 canceled 통보 (spinner 종료)
    expect(receiverCtx.state.mainWindow._sends.some((s) => s.channel === 'file-request-error' && s.data.reason === 'canceled')).toBe(true)
    // file_cache 에 저장 안 됨
    expect(fs.existsSync(path.join(receiverDir, 'file_cache', 'm-x.png'))).toBe(false)
  })

  it('stall 타임아웃 — 부분 폐기 후 재요청(file-request)', async () => {
    __setInboundTransferTimeoutForTest(80)
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, chunks[0]) // 부분 → 80ms 타임아웃 무장
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
    // 아직 캐시 안 됨(getFileCache mock=null) → 재요청 송신
    expect(sendMessage.mock.calls.map((c) => c[1]).some((m) => m.type === 'file-request' && m.messageId === 'm-x')).toBe(true)
  })

  it('start 없이 도착한 청크는 무시(no throw, 상태 변화 없음)', () => {
    expect(() => handleFileChunk(receiverCtx, { type: 'file-chunk', transferId: 'ghost', seq: 0, data: 'AAAA', fromId: 'sender' })).not.toThrow()
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
  })

  it('범위 밖 seq 는 무시', () => {
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, { type: 'file-chunk', transferId: start.transferId, seq: 999, data: chunks[0].data, fromId: 'sender' })
    const transfer = receiverCtx.state.inboundFileTransfers.get(start.transferId)
    expect(transfer.receivedCount).toBe(0)
  })

  it('totalBytes 가 상한(1GB) 초과인 start 는 거부', () => {
    handleFileChunkStart(receiverCtx, { ...start, totalBytes: 2 * 1024 * 1024 * 1024 })
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
  })

  it('end 가 미완 상태로 오면 부분 폐기 후 재요청', () => {
    handleFileChunkStart(receiverCtx, start)
    handleFileChunk(receiverCtx, chunks[0]) // 3개 중 1개만
    handleFileChunkEnd(receiverCtx, { type: 'file-chunk-end', transferId: start.transferId })
    expect(receiverCtx.state.inboundFileTransfers.size).toBe(0)
    expect(sendMessage.mock.calls.map((c) => c[1]).some((m) => m.type === 'file-request' && m.messageId === 'm-x')).toBe(true)
  })
})

describe('handleFileRequest — capability 기반 청크/레거시 분기', () => {
  let senderDir
  beforeEach(() => {
    sendMessage.mockReset()
    sendMessage.mockImplementation(() => true)
    senderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chunk-br-'))
    fs.mkdirSync(path.join(senderDir, 'files'), { recursive: true })
  })
  afterEach(() => {
    fs.rmSync(senderDir, { recursive: true, force: true })
  })

  function seedFile(ctx, fileName) {
    const plaintext = Buffer.from('branch-test-content')
    fs.writeFileSync(path.join(senderDir, 'files', fileName), encryptBuffer(plaintext, ctx.state.masterKey))
  }

  it('요청자가 file-chunk 지원 → 청크 경로(file-chunk-start, file-data 미전송)', async () => {
    const ctx = makeSenderCtx(senderDir, { supportChunk: true })
    seedFile(ctx, 'p.png')
    handleFileRequest({ message: { type: 'file-request', fromId: 'receiver', messageId: 'm-b1', fileName: 'p.png' }, ctx })
    // 청크 송신은 비동기 — 잠시 flush
    await new Promise((resolve) => setTimeout(resolve, 60))
    const types = sendMessage.mock.calls.map((c) => c[1].type)
    expect(types).toContain('file-chunk-start')
    expect(types).not.toContain('file-data')
    clearAllFileChunkTransfers(ctx)
  })

  it('요청자가 file-chunk 미지원(peerManager 없음) → 레거시 file-data', () => {
    const ctx = makeSenderCtx(senderDir, { supportChunk: false })
    seedFile(ctx, 'q.png')
    handleFileRequest({ message: { type: 'file-request', fromId: 'receiver', messageId: 'm-b2', fileName: 'q.png' }, ctx })
    const types = sendMessage.mock.calls.map((c) => c[1].type)
    expect(types).toContain('file-data')
    expect(types).not.toContain('file-chunk-start')
  })
})
