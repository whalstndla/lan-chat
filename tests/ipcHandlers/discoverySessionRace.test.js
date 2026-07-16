const mockHandlers = new Map()
const mockStopResolvers = []
const mockStartPeerDiscovery = jest.fn()
const mockStopPeerDiscovery = jest.fn()
const mockStartBroadcastDiscovery = jest.fn()
const mockStopBroadcastDiscovery = jest.fn()
const mockDisconnectAll = jest.fn()
const mockCloseAllServerClients = jest.fn()

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => mockHandlers.set(channel, handler),
  },
}))

jest.mock('../../electron/peer/discovery', () => ({
  startPeerDiscovery: mockStartPeerDiscovery,
  stopPeerDiscovery: mockStopPeerDiscovery,
  removePeerFromDiscovered: jest.fn(),
}))

jest.mock('../../electron/peer/broadcastDiscovery', () => ({
  startBroadcastDiscovery: mockStartBroadcastDiscovery,
  stopBroadcastDiscovery: mockStopBroadcastDiscovery,
}))

jest.mock('../../electron/peer/wsClient', () => ({
  connectToPeer: jest.fn(),
  disconnectAll: mockDisconnectAll,
  disconnectFromPeer: jest.fn(),
}))

jest.mock('../../electron/peer/wsServer', () => ({
  closeAllServerClients: mockCloseAllServerClients,
}))

jest.mock('../../electron/peer/fileServer', () => ({ getFilePort: () => 4321 }))
jest.mock('../../electron/peer/manualConnect', () => ({ connectManualPeer: jest.fn() }))
jest.mock('../../electron/storage/queries', () => ({
  loadPeerCache: jest.fn(() => []),
  deletePeerCache: jest.fn(),
  updatePinnedKey: jest.fn(),
}))
jest.mock('../../electron/crypto/keyManager', () => ({
  importPublicKey: jest.fn(),
  loadOrCreateEncryptedKeyPair: jest.fn(),
  exportPublicKey: jest.fn(),
}))
jest.mock('../../electron/storage/database', () => ({
  initDatabase: jest.fn(),
  migrateDatabase: jest.fn(),
  closeDatabase: jest.fn(),
}))
jest.mock('../../electron/storage/dbMigration', () => ({ migratePlaintextDbToEncrypted: jest.fn() }))
jest.mock('../../electron/storage/fileMigration', () => ({ migratePlaintextFiles: jest.fn() }))
jest.mock('../../electron/storage/pendingMessages', () => ({ deleteExpiredPendingMessages: jest.fn() }))
jest.mock('../../electron/storage/profile', () => ({
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
  verifyPassword: jest.fn(),
  updatePeerId: jest.fn(),
  updatePassword: jest.fn(),
}))
jest.mock('../../electron/crypto/masterKey', () => ({
  createMasterKey: jest.fn(),
  saveWrappedMasterKey: jest.fn(),
  loadWrappedMasterKey: jest.fn(),
  rewrapMasterKey: jest.fn(),
  migrateLegacyMasterKey: jest.fn(),
  masterKeyFileExists: jest.fn(() => false),
  legacyKeyFileExists: jest.fn(() => false),
}))
jest.mock('../../electron/protocol/lanchatProtocol', () => ({ clearDecryptedCache: jest.fn() }))
jest.mock('../../electron/peer/fileChunkTransfer', () => ({ clearAllFileChunkTransfers: jest.fn() }))
jest.mock('../../electron/utils/peerDebugLogger', () => ({ writePeerDebugLog: jest.fn() }))
jest.mock('../../electron/utils/appUtils', () => ({
  sendToRenderer: jest.fn(),
  getMyAdvertisedAddresses: jest.fn(() => []),
  buildMyKeyExchangePayload: jest.fn(),
  waitForMilliseconds: jest.fn(),
  clearPeerConnectRetry: jest.fn(),
  clearAllPeerConnectRetryState: jest.fn(),
  clearAllPendingFileRequests: jest.fn(),
  sweepOrphanedFileCache: jest.fn(() => ({ removed: 0 })),
  getConnectedPeerIds: jest.fn(() => []),
  hasPeerConnection: jest.fn(() => false),
  sendPeerMessage: jest.fn(),
  flushPendingMessages: jest.fn(),
  getCurrentNicknameSafely: jest.fn(() => '테스트 사용자'),
}))

const { createAppContext } = require('../../electron/context')
const { registerPeerHandlers } = require('../../electron/ipcHandlers/peer')
const { registerAuthHandlers } = require('../../electron/ipcHandlers/auth')

describe('discovery 시작과 로그아웃 경합', () => {
  beforeEach(() => {
    mockHandlers.clear()
    mockStopResolvers.length = 0
    jest.clearAllMocks()
    mockStopPeerDiscovery.mockImplementation(() => (
      new Promise(resolve => mockStopResolvers.push(resolve))
    ))
  })

  it('stop 대기 중 로그아웃이 시작되면 이전 세션 discovery를 다시 등록하지 않는다', async () => {
    const ctx = createAppContext({ appDataPath: '/tmp/lan-chat-discovery-race' })
    ctx.state.database = { close: jest.fn() }
    ctx.state.peerId = 'my-peer'
    ctx.state.wsServerInfo = { port: 1234 }

    registerPeerHandlers(ctx)
    registerAuthHandlers(ctx)

    const startPromise = mockHandlers.get('start-peer-discovery')()
    expect(mockStopResolvers).toHaveLength(1)

    const logoutPromise = mockHandlers.get('logout')()
    expect(mockStopResolvers).toHaveLength(2)
    expect(ctx.state.isSessionClosing).toBe(true)
    expect(ctx.state.discoveryEpoch).toBe(1)

    // 먼저 시작된 discovery stop이 먼저 끝나는 실제 타이밍을 재현한다.
    mockStopResolvers[0]()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockStartPeerDiscovery).not.toHaveBeenCalled()
    expect(mockStartBroadcastDiscovery).not.toHaveBeenCalled()

    mockStopResolvers[1]()
    await Promise.all([startPromise, logoutPromise])

    expect(ctx.state.database).toBeNull()
    expect(ctx.state.isDiscoveryStarting).toBe(false)
    expect(mockStartPeerDiscovery).not.toHaveBeenCalled()
    expect(mockStartBroadcastDiscovery).not.toHaveBeenCalled()
  })
})
