// 파일 요청 retry / 실패 통보 / 사이즈 가드 단위 테스트.
// v0.10.2 fix(image/video): wsServer maxPayload 10MB 초과 시 ws 라이브러리가 연결을
// 끊어 수신측이 영구 'loading' 에 빠지던 문제 회복 메커니즘 검증.

const path = require('path')
const fs = require('fs')
const os = require('os')

// wsClient/wsServer 는 ws 모듈 로드를 트리거하므로 사용 안 하는 함수만 따로 require.
jest.useFakeTimers()

const { createAppContext } = require('../../electron/context')

// sendPeerMessage 를 spy 가능하도록 ws 의존성을 stub — appUtils 안의 wsClient/wsServer 호출은
// 실제 ws 모듈에 닿지 않아도 됨 (testEnvironment 기반).
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
jest.mock('../../electron/peer/fileServer', () => ({
  getFilePort: () => 50000,
}))
jest.mock('../../electron/storage/profile', () => ({
  getProfile: jest.fn(() => null),
}))
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
const {
  cacheReceivedFile,
  requestFileViaWebSocket,
  clearPendingFileRequest,
  clearAllPendingFileRequests,
  MAX_RAW_FILE_BYTES,
  FILE_REQUEST_RETRY_DELAYS_MS,
} = require('../../electron/utils/appUtils')

// 테스트용 mainWindow stub — sendToRenderer 가 호출하는 webContents.send 를 캡처.
function makeMainWindow() {
  const sends = []
  return {
    isDestroyed: () => false,
    isFocused: () => true,
    webContents: {
      isDestroyed: () => false,
      send: (channel, data) => sends.push({ channel, data }),
    },
    _sends: sends,
  }
}

function makeCtx({ masterKey = Buffer.alloc(32, 0x42), appDataPath } = {}) {
  const ctx = createAppContext({ appDataPath: appDataPath || os.tmpdir() })
  ctx.state.peerId = 'me'
  ctx.state.masterKey = masterKey
  ctx.state.mainWindow = makeMainWindow()
  ctx.state.wsServerInfo = { server: {}, port: 49152 }
  return ctx
}

describe('cacheReceivedFile — 입력 검증', () => {
  beforeEach(() => {
    sendMessage.mockClear()
  })

  it('fileName 누락 시 file-request 송신 없이 렌더러에 missingFileName 통보', () => {
    const ctx = makeCtx()
    cacheReceivedFile(ctx, 'msg-a', 'http://x/files/x.png', null, 'peer-1')
    expect(sendMessage).not.toHaveBeenCalled()
    expect(ctx.state.mainWindow._sends).toEqual([
      { channel: 'file-request-error', data: { messageId: 'msg-a', reason: 'missingFileName' } },
    ])
  })

  it('masterKey 미설정 시 file-request 송신 없이 noMasterKey 통보', () => {
    const ctx = makeCtx({ masterKey: null })
    cacheReceivedFile(ctx, 'msg-b', 'http://x/files/x.png', 'x.png', 'peer-1')
    expect(sendMessage).not.toHaveBeenCalled()
    expect(ctx.state.mainWindow._sends).toEqual([
      { channel: 'file-request-error', data: { messageId: 'msg-b', reason: 'noMasterKey' } },
    ])
  })
})

describe('requestFileViaWebSocket — pending 관리 + 중복 차단', () => {
  let ctx
  beforeEach(() => {
    sendMessage.mockClear()
    ctx = makeCtx({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'lc-frq-')) })
  })
  afterEach(() => {
    clearAllPendingFileRequests(ctx)
    fs.rmSync(ctx.config.appDataPath, { recursive: true, force: true })
  })

  it('첫 요청 시 sendPeerMessage(file-request) 호출 + pending 등록', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    expect(sendMessage).toHaveBeenCalledWith('peer-A', expect.objectContaining({
      type: 'file-request',
      messageId: 'msg-1',
      fileName: 'image.png',
    }))
    expect(ctx.state.pendingFileRequestMap.has('msg-1')).toBe(true)
  })

  it('동일 messageId 중복 호출 시 추가 송신 차단 (in-flight 보호)', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('clearPendingFileRequest 호출 시 pending 제거 + 새 요청 가능', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    clearPendingFileRequest(ctx, 'msg-1')
    expect(ctx.state.pendingFileRequestMap.has('msg-1')).toBe(false)
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})

describe('requestFileViaWebSocket — retry 백오프', () => {
  let ctx
  beforeEach(() => {
    sendMessage.mockClear()
    ctx = makeCtx({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'lc-frq-')) })
  })
  afterEach(() => {
    clearAllPendingFileRequests(ctx)
    fs.rmSync(ctx.config.appDataPath, { recursive: true, force: true })
  })

  it('백오프 step 마다 재송신 + 모두 소진 후 file-request-error(timeout) 통보', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    expect(sendMessage).toHaveBeenCalledTimes(1)

    // 매 step 마다 timer 진행 — 각 step 후 sendPeerMessage 1 회 추가 호출 기대.
    for (let stepIndex = 0; stepIndex < FILE_REQUEST_RETRY_DELAYS_MS.length; stepIndex += 1) {
      jest.advanceTimersByTime(FILE_REQUEST_RETRY_DELAYS_MS[stepIndex] + 10)
    }
    // 초기 1회 + 각 백오프 step 마다 1회 추가
    expect(sendMessage).toHaveBeenCalledTimes(1 + FILE_REQUEST_RETRY_DELAYS_MS.length)

    // 마지막 step 이 끝나면 timeout 통보 + pending 정리
    expect(ctx.state.mainWindow._sends).toEqual([
      { channel: 'file-request-error', data: { messageId: 'msg-1', reason: 'timeout' } },
    ])
    expect(ctx.state.pendingFileRequestMap.has('msg-1')).toBe(false)
  })

  it('재시도 도중 clearPendingFileRequest 호출 시 이후 timer 정지', () => {
    requestFileViaWebSocket(ctx, 'msg-1', 'image.png', 'peer-A')
    clearPendingFileRequest(ctx, 'msg-1')
    jest.advanceTimersByTime(FILE_REQUEST_RETRY_DELAYS_MS[0] + 10)
    expect(sendMessage).toHaveBeenCalledTimes(1) // retry 송신 발생 안 함
  })
})

describe('clearAllPendingFileRequests — 로그아웃/세션 종료 시', () => {
  it('진행 중 타이머가 있어도 일괄 정리 가능', () => {
    sendMessage.mockClear()
    const ctx = makeCtx()
    requestFileViaWebSocket(ctx, 'a', 'a.png', 'peer-A')
    requestFileViaWebSocket(ctx, 'b', 'b.png', 'peer-A')
    expect(ctx.state.pendingFileRequestMap.size).toBe(2)
    clearAllPendingFileRequests(ctx)
    expect(ctx.state.pendingFileRequestMap.size).toBe(0)
    jest.advanceTimersByTime(60_000)
    // 두 요청 모두 retry 발생 X
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})

describe('MAX_RAW_FILE_BYTES — 사이즈 가드 상수', () => {
  it('150MB 이상 송신 사이즈를 명시적으로 설정', () => {
    expect(MAX_RAW_FILE_BYTES).toBe(150 * 1024 * 1024)
  })
})
