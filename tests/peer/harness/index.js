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

        // messageHandler.js 등 여러 파일이 destructuring 으로 sendToRenderer 를 import 하므로
        // appUtils.sendToRenderer 를 몽키패치해도 효과 없음 (참조가 이미 복사됨).
        // 대신 실제 sendToRenderer 구현이 호출하는 mainWindow.webContents.send 를 intercept 한다.

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

        // mainWindow 스텁 — webContents.send 를 renderer 이벤트 수집기로 만든다.
        // sendToRenderer(ctx, channel, data) 의 종착지가 여기.
        ctx.state.mainWindow = {
          isDestroyed: () => false,
          isFocused: () => true,
          webContents: {
            isDestroyed: () => false,
            send: (channel, data) => {
              rendererEvents.push({ channel, data, at: Date.now() })
            },
          },
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
    // 격리된 wsClient 모듈의 현재 outbound 연결 peerId 목록 (OPEN 상태만)
    getOutboundConnections: () => wsClientModule.getConnections(),
    hasOutboundConnection: (peerId) => wsClientModule.getConnections().includes(peerId),
    // 격리된 wsServer 모듈의 현재 inbound 연결 peerId 목록
    getInboundConnections: () => wsServerModule.getServerClientPeerIds(wsServerInfo),
    // 전체 연결 상태 — ipcHandlers/peer.js의 hasPeerConnection 와 동일 의미
    hasAnyConnection: (peerId) =>
      wsClientModule.getConnections().includes(peerId) ||
      wsServerModule.getServerClientPeerIds(wsServerInfo).includes(peerId),
    async shutdown() {
      // discoveryEpoch를 증가시켜 ipcHandlers/peer.js 내부 setTimeout 콜백들이
      // `if (currentEpoch !== ctx.state.discoveryEpoch) return` 로 조기 종료되게 함.
      // peer.js는 peer cache 재연결(1초), handshake sweep(2초) 등 지연 동작을 스케줄하는데,
      // 이들이 DB close 후 실행되면 크래시 유발. epoch 무효화로 차단.
      if (ctx && ctx.state) {
        ctx.state.discoveryEpoch++
        ctx.state.peerConnectRetryTimerMap.forEach(t => clearTimeout(t))
        ctx.state.peerConnectRetryTimerMap.clear()
        ctx.state.peerConnectInFlightSet.clear()
      }
      try {
        if (fakeDiscovery.isStarted()) await fakeDiscovery.stopPeerDiscovery()
      } catch { /* 무시 */ }
      try {
        if (fakeBroadcast.isStarted()) fakeBroadcast.stopBroadcastDiscovery()
      } catch { /* 무시 */ }
      try { if (wsClientModule) wsClientModule.disconnectAll() } catch { /* 무시 */ }
      // 기존 inbound 소켓들을 terminate — 상대방에게 즉시 close 이벤트 전파.
      // server.close()만 호출하면 기존 연결은 유지되어 상대방 outbound 가 계속 OPEN 으로 남음.
      try { if (wsServerModule && wsServerInfo) wsServerModule.closeAllServerClients(wsServerInfo) } catch { /* 무시 */ }
      try { if (wsServerModule && wsServerInfo) wsServerModule.stopWsServer(wsServerInfo) } catch { /* 무시 */ }
      try { if (db) db.close() } catch { /* 무시 */ }
      // DB가 먼저 close되지 않도록 약간 대기 — 이미 epoch 무효화로 대부분 안전
      await new Promise(r => setTimeout(r, 50))
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
