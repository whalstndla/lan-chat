// Phase 0 peer 통합 테스트 하네스 — 두 노드를 한 프로세스에서 격리 실행.
//
// 사용 예:
//   const nodeA = await createNode({ peerId: 'A', nickname: '앨리스' })
//   const nodeB = await createNode({ peerId: 'B', nickname: '밥' })
//   await nodeA.callIpc('start-peer-discovery')
//   emitDiscovery(nodeA, nodeB)
//   ... test assertions
//   await nodeA.shutdown(); await nodeB.shutdown()

const { createMockElectron } = require('./mockElectron')
const { createFakeDiscovery, createFakeBroadcastDiscovery, createFakeFileServer } = require('./fakes')
const { createTempAppDataPath, removeTempAppDataPath } = require('./tempKeyPair')

// 격리된 모듈 컨텍스트 내에서 현재 electron 백엔드의 핵심 부분을 구성한다.
// 전역 모듈 상태 충돌(wsClient.connectionMap 등)을 피하기 위해 jest.isolateModules 사용.
async function createNode({ peerId, nickname }) {
  const appDataPath = createTempAppDataPath(peerId)
  process.env.HARNESS_TMP_DIR = appDataPath

  const mockElectron = createMockElectron()
  const fakeDiscovery = createFakeDiscovery()
  const fakeBroadcast = createFakeBroadcastDiscovery()
  const fakeFileServer = createFakeFileServer()
  const rendererEvents = []

  // 격리된 require로 얻어올 모듈들을 밖으로 꺼내기 위한 컨테이너
  let ctx
  let wsServerInfo
  let db
  let wsClientModule
  let wsServerModule
  let isolateError = null

  const isolateDone = new Promise((resolveOuter, rejectOuter) => {
    jest.isolateModules(() => {
      try {
        // 1) electron 모듈 mock
        jest.doMock('electron', () => mockElectron.api)

        // 2) electron-updater는 ipcHandlers/app.js가 import — 본 하네스에서는 app 핸들러 미등록이지만
        //    방어적으로 전체 스텁
        jest.doMock('electron-updater', () => ({
          autoUpdater: {
            autoDownload: false,
            on: () => {},
            once: () => {},
            checkForUpdates: async () => {},
            quitAndInstall: () => {},
          },
        }))

        // 3) discovery / broadcastDiscovery 모듈 mock (fake 주입)
        jest.doMock('../../../electron/peer/discovery', () => fakeDiscovery)
        jest.doMock('../../../electron/peer/broadcastDiscovery', () => fakeBroadcast)
        // 4) fileServer 스텁 — 포트 바인딩 회피
        jest.doMock('../../../electron/peer/fileServer', () => fakeFileServer)

        const { createAppContext } = require('../../../electron/context')
        const { initDatabase, migrateDatabase } = require('../../../electron/storage/database')
        const wsServer = require('../../../electron/peer/wsServer')
        const wsClient = require('../../../electron/peer/wsClient')
        const { createIncomingMessageHandler } = require('../../../electron/messageHandler')
        const { loadOrCreateKeyPair, exportPublicKey } = require('../../../electron/crypto/keyManager')
        const appUtils = require('../../../electron/utils/appUtils')

        // sendToRenderer 가로채기 — 렌더러 이벤트를 테스트에서 조회 가능하게 함
        appUtils.sendToRenderer = (_ctx, channel, data) => {
          rendererEvents.push({ channel, data, at: Date.now() })
        }

        // 본 하네스에서 필요한 IPC 핸들러만 선택적으로 등록 (electron-updater 회피)
        const { registerPeerHandlers } = require('../../../electron/ipcHandlers/peer')
        const { registerMessageHandlers } = require('../../../electron/ipcHandlers/message')
        const { registerReadStatusHandlers } = require('../../../electron/ipcHandlers/readStatus')
        const { registerReactionHandlers } = require('../../../electron/ipcHandlers/reaction')
        const { registerHistoryHandlers } = require('../../../electron/ipcHandlers/history')
        const { registerUserHandlers } = require('../../../electron/ipcHandlers/user')

        ctx = createAppContext({
          isDev: true,
          defaultNickname: nickname,
          appDataPath,
          appRootDir: appDataPath,
        })
        ctx.state.peerId = peerId
        ctx.state.isQuitting = false

        // in-memory DB
        db = initDatabase(':memory:')
        migrateDatabase(db)
        ctx.state.database = db

        // 네트워크 주소는 loopback으로 고정
        ctx.state.localIP = '127.0.0.1'
        ctx.state.localAddressCandidates = ['127.0.0.1']

        // 키쌍
        const { privateKey, publicKey } = loadOrCreateKeyPair(appDataPath)
        ctx.state.myPrivateKey = privateKey
        ctx.state.myPublicKeyBase64 = exportPublicKey(publicKey)

        // 메시지 핸들러
        ctx.state.handleIncomingMessage = createIncomingMessageHandler(ctx)

        // mainWindow 스텁 — focus/destroyed 체크 통과
        ctx.state.mainWindow = {
          isDestroyed: () => false,
          isFocused: () => true,
          webContents: { isDestroyed: () => false, send: () => {} },
          show: () => {},
          focus: () => {},
          hide: () => {},
          on: () => {},
        }

        // 외부로 모듈 참조 저장 (shutdown에서 사용)
        wsServerModule = wsServer
        wsClientModule = wsClient

        // wsServer (0 = 임의 포트)
        wsServer.startWsServer({ onMessage: ctx.state.handleIncomingMessage })
          .then((info) => {
            wsServerInfo = info
            ctx.state.wsServerInfo = info

            // IPC 핸들러 등록 (본 하네스에서 필요한 것만)
            registerUserHandlers(ctx)
            registerPeerHandlers(ctx)
            registerMessageHandlers(ctx)
            registerReadStatusHandlers(ctx)
            registerReactionHandlers(ctx)
            registerHistoryHandlers(ctx)

            resolveOuter()
          })
          .catch((err) => {
            isolateError = err
            rejectOuter(err)
          })
      } catch (err) {
        isolateError = err
        rejectOuter(err)
      }
    })
  })

  await isolateDone
  if (isolateError) throw isolateError

  // IPC 호출 헬퍼
  async function callIpc(channel, payload) {
    const handler = mockElectron.handlers.get(channel)
    if (!handler) throw new Error(`IPC handler not registered: ${channel}`)
    return handler({}, payload)
  }

  return {
    peerId,
    nickname,
    ctx,
    db,
    port: wsServerInfo.port,
    handlers: mockElectron.handlers,
    fakeDiscovery,
    fakeBroadcast,
    rendererEvents,
    getRendererEvents: (channelFilter) =>
      channelFilter
        ? rendererEvents.filter(e => e.channel === channelFilter)
        : [...rendererEvents],
    clearRendererEvents: () => { rendererEvents.length = 0 },
    callIpc,
    async shutdown() {
      try {
        if (fakeDiscovery.isStarted()) await fakeDiscovery.stopPeerDiscovery()
      } catch { /* 무시 */ }
      try {
        if (fakeBroadcast.isStarted()) fakeBroadcast.stopBroadcastDiscovery()
      } catch { /* 무시 */ }
      try { if (wsClientModule) wsClientModule.disconnectAll() } catch { /* 무시 */ }
      try { if (wsServerModule && wsServerInfo) wsServerModule.stopWsServer(wsServerInfo) } catch { /* 무시 */ }
      try { if (db) db.close() } catch { /* 무시 */ }
      removeTempAppDataPath(appDataPath)
    },
  }
}

// B의 wsServer 정보를 A의 fakeDiscovery로 전달해 A가 B를 발견하도록 시뮬레이션
function emitDiscovery(fromNode, toNode) {
  fromNode.fakeDiscovery.emitPeerFound({
    peerId: toNode.peerId,
    nickname: toNode.nickname,
    host: '127.0.0.1',
    addresses: ['127.0.0.1'],
    advertisedAddresses: ['127.0.0.1'],
    refererAddress: null,
    wsPort: toNode.port,
    filePort: 0,
  })
}

module.exports = { createNode, emitDiscovery }
