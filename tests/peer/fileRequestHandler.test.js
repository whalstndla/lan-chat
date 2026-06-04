// handleFileRequest / handleFileData / handleFileRequestError 통합 단위 테스트.
// v0.10.2 fix(image/video): 모든 실패 분기에서 명시적 file-request-error 응답 +
// file-data 수신 시 pending retry 정리 동작 검증.

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

jest.useFakeTimers()

// wsClient / wsServer 의 실제 ws 의존성을 끊는다 (Node 환경에서 직접 호출만 검증).
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
  return {
    ...actual,
    saveFileCache: jest.fn(),
    getFileCache: jest.fn(() => null),
  }
})

const { sendMessage } = require('../../electron/peer/wsClient')
const { createAppContext } = require('../../electron/context')
const {
  requestFileViaWebSocket,
  clearAllPendingFileRequests,
} = require('../../electron/utils/appUtils')

const handleFileRequest = require('../../electron/peer/inbound/handlers/fileRequest')
const handleFileData = require('../../electron/peer/inbound/handlers/fileData')
const handleFileRequestError = require('../../electron/peer/inbound/handlers/fileRequestError')

const { encryptBuffer } = require('../../electron/crypto/fileEncryption')
const {
  encryptFileForPeer,
  decryptFileFromPeer,
} = require('../../electron/crypto/peerFileTransfer')

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

function makeCtx(appDataPath) {
  const ctx = createAppContext({ appDataPath })
  ctx.state.peerId = 'me'
  ctx.state.masterKey = Buffer.alloc(32, 0x77)
  ctx.state.mainWindow = makeMainWindow()
  ctx.state.wsServerInfo = { server: {}, port: 49152 }
  return ctx
}

describe('handleFileRequest — 실패 분기마다 file-request-error 응답', () => {
  let ctx
  let tempDir

  beforeEach(() => {
    sendMessage.mockClear()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fr-h-'))
    fs.mkdirSync(path.join(tempDir, 'files'), { recursive: true })
    ctx = makeCtx(tempDir)
  })
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('notFound — 디스크에 파일 없으면 requester 에게 명시적 응답', () => {
    handleFileRequest({
      message: { type: 'file-request', fromId: 'requester-1', messageId: 'm-1', fileName: 'missing.png' },
      ctx,
    })
    expect(sendMessage).toHaveBeenCalledWith('requester-1', expect.objectContaining({
      type: 'file-request-error',
      messageId: 'm-1',
      reason: 'notFound',
    }))
  })

  it('noPublicKey — 요청자의 공개키 미보유 시 응답', () => {
    // 디스크 파일은 존재시켜 통과시킨다 → 다음 단계인 공개키 검사에서 실패
    fs.writeFileSync(path.join(tempDir, 'files', 'foo.png'), Buffer.from([1, 2, 3]))
    handleFileRequest({
      message: { type: 'file-request', fromId: 'requester-1', messageId: 'm-2', fileName: 'foo.png' },
      ctx,
    })
    expect(sendMessage).toHaveBeenCalledWith('requester-1', expect.objectContaining({
      type: 'file-request-error',
      messageId: 'm-2',
      reason: 'noPublicKey',
    }))
  })

  it('noMasterKey — 마스터키 미설정 시 응답', () => {
    fs.writeFileSync(path.join(tempDir, 'files', 'bar.png'), Buffer.from([1, 2, 3]))
    const requesterKp = makeKeyPair()
    ctx.state.peerPublicKeyMap.set('requester-1', requesterKp.publicKey)
    ctx.state.masterKey = null
    handleFileRequest({
      message: { type: 'file-request', fromId: 'requester-1', messageId: 'm-3', fileName: 'bar.png' },
      ctx,
    })
    expect(sendMessage).toHaveBeenCalledWith('requester-1', expect.objectContaining({
      type: 'file-request-error',
      messageId: 'm-3',
      reason: 'noMasterKey',
    }))
  })

  it('정상 흐름 — 평문 파일도 file-data v3 로 전송', () => {
    const plaintext = Buffer.from('hello world')
    fs.writeFileSync(path.join(tempDir, 'files', 'ok.png'), plaintext) // 평문 (마이그레이션 이전 호환)
    const requesterKp = makeKeyPair()
    const myKp = makeKeyPair()
    ctx.state.peerPublicKeyMap.set('requester-1', requesterKp.publicKey)
    ctx.state.myPrivateKey = myKp.privateKey

    handleFileRequest({
      message: { type: 'file-request', fromId: 'requester-1', messageId: 'm-ok', fileName: 'ok.png' },
      ctx,
    })

    const sentCall = sendMessage.mock.calls.find(call => call[1]?.type === 'file-data')
    expect(sentCall).toBeTruthy()
    expect(sentCall[1]).toMatchObject({ type: 'file-data', v: 3, messageId: 'm-ok', fileName: 'ok.png' })
    expect(typeof sentCall[1].data).toBe('string')
  })
})

describe('handleFileData — 성공 수신 시 pending 정리', () => {
  let ctx
  let tempDir
  let myKp, senderKp

  beforeEach(() => {
    sendMessage.mockClear()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fd-h-'))
    ctx = makeCtx(tempDir)
    myKp = makeKeyPair()
    senderKp = makeKeyPair()
    ctx.state.myPrivateKey = myKp.privateKey
    ctx.state.peerPublicKeyMap.set('peer-A', senderKp.publicKey)
  })
  afterEach(() => {
    clearAllPendingFileRequests(ctx)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('성공 시 pending 정리 + file-cached 이벤트 송신', () => {
    // 사전: pending 등록
    requestFileViaWebSocket(ctx, 'msg-x', 'cat.png', 'peer-A')
    expect(ctx.state.pendingFileRequestMap.has('msg-x')).toBe(true)

    // 송신측이 만든 file-data envelope (ECDH 공유키로 암호화) 합성
    const sharedAtSender = crypto.diffieHellman({ privateKey: senderKp.privateKey, publicKey: myKp.publicKey })
    const plaintext = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const data = encryptFileForPeer(plaintext, sharedAtSender, 'peer-A', 'me')

    handleFileData({
      message: { type: 'file-data', v: 3, fromId: 'peer-A', messageId: 'msg-x', fileName: 'cat.png', data },
      ctx,
    })

    expect(ctx.state.pendingFileRequestMap.has('msg-x')).toBe(false)
    expect(ctx.state.mainWindow._sends.find(s => s.channel === 'file-cached')).toEqual({
      channel: 'file-cached',
      data: expect.objectContaining({ messageId: 'msg-x' }),
    })
    // 디스크에 ciphertext 가 저장됐는지 — 마스터키로 복호화 round-trip
    const cachedPath = path.join(tempDir, 'file_cache', 'msg-x.png')
    expect(fs.existsSync(cachedPath)).toBe(true)
  })

  it('v 가 3 이 아니면 무시', () => {
    requestFileViaWebSocket(ctx, 'msg-y', 'dog.png', 'peer-A')
    handleFileData({
      message: { type: 'file-data', v: 2, fromId: 'peer-A', messageId: 'msg-y', fileName: 'dog.png', data: 'AAAA' },
      ctx,
    })
    // pending 그대로 유지 (다음 retry 가 처리)
    expect(ctx.state.pendingFileRequestMap.has('msg-y')).toBe(true)
  })
})

describe('handleFileRequestError — 영구 실패 시 즉시 give-up', () => {
  let ctx
  beforeEach(() => {
    sendMessage.mockClear()
    ctx = makeCtx(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fre-')))
  })
  afterEach(() => {
    clearAllPendingFileRequests(ctx)
    fs.rmSync(ctx.config.appDataPath, { recursive: true, force: true })
  })

  it('reason=notFound 면 pending 정리 + 렌더러 통보', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'a.png', 'peer-A')
    handleFileRequestError({
      message: { type: 'file-request-error', fromId: 'peer-A', messageId: 'msg-1', reason: 'notFound' },
      ctx,
    })
    expect(ctx.state.pendingFileRequestMap.has('msg-1')).toBe(false)
    expect(ctx.state.mainWindow._sends).toEqual([
      { channel: 'file-request-error', data: { messageId: 'msg-1', reason: 'notFound' } },
    ])
  })

  it('reason=tooLarge 도 영구 실패로 처리', () => {
    requestFileViaWebSocket(ctx, 'msg-2', 'v.mp4', 'peer-A')
    handleFileRequestError({
      message: { type: 'file-request-error', fromId: 'peer-A', messageId: 'msg-2', reason: 'tooLarge' },
      ctx,
    })
    expect(ctx.state.pendingFileRequestMap.has('msg-2')).toBe(false)
    expect(ctx.state.mainWindow._sends.find(s => s.data?.reason === 'tooLarge')).toBeTruthy()
  })

  it('reason=noPublicKey 같은 일시 실패는 retry 에 맡기고 렌더러에 통보하지 않음', () => {
    requestFileViaWebSocket(ctx, 'msg-3', 'a.png', 'peer-A')
    handleFileRequestError({
      message: { type: 'file-request-error', fromId: 'peer-A', messageId: 'msg-3', reason: 'noPublicKey' },
      ctx,
    })
    // pending 유지 (retry 진행 중)
    expect(ctx.state.pendingFileRequestMap.has('msg-3')).toBe(true)
    expect(ctx.state.mainWindow._sends.find(s => s.channel === 'file-request-error')).toBeUndefined()
  })
})
