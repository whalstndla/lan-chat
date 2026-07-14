// electron/main.js
const { app, BrowserWindow, Menu, Tray, nativeImage, safeStorage, dialog } = require('electron')
// safeStorage 는 v0.9.x 키체인 wrap 마스터키를 비밀번호 wrap 으로 마이그레이션할 때만 사용.
// v0.10.0 부터는 OS 키체인 의존 없이 사용자 비밀번호 KDF 만으로 마스터키 보호.
const path = require('path')
const os = require('os')
const { startWsServer, stopWsServer } = require('./peer/wsServer')
const { disconnectAll } = require('./peer/wsClient')
const { startFileServer, stopFileServer, getFilePort } = require('./peer/fileServer')
const { collectLocalIpv4Addresses, selectPrimaryLocalIpv4 } = require('./peer/networkUtils')
const { loadOrCreateKeyPair, exportPublicKey } = require('./crypto/keyManager')
const { closeDatabase } = require('./storage/database')
const { writePeerDebugLog, resetPeerDebugLog, isPeerDebugEnabled, getPeerDebugLogPath, flushPeerDebugLogNow } = require('./utils/peerDebugLogger')
const { startMemoryMonitor, stopMemoryMonitor, perfEnabled } = require('./utils/perf')
const { startPresenceMonitor, stopPresenceMonitor } = require('./utils/presence')
const { stopPeerDiscovery } = require('./peer/discovery')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')

const { createAppContext } = require('./context')
const { createIncomingMessageHandler } = require('./messageHandler')
const { registerAllIpcHandlers } = require('./ipcHandlers/index')
const { sendToRenderer, clearBadge, checkAndNotifyUpdated } = require('./utils/appUtils')
const { registerLanChatScheme, registerLanChatHandler } = require('./protocol/lanchatProtocol')

// custom protocol 은 app.whenReady 이전에 등록해야 함
registerLanChatScheme()

// main 프로세스 미처리 예외/거부 핸들러 — 등록하지 않으면 Node.js 기본 동작으로
// uncaughtException 발생 시 프로세스가 그대로 종료된다. 트레이 상주 앱 특성상
// 사용자가 창을 닫지 않고 방치하는 경우가 많아, 조용히 프로세스가 사라지는 대신
// 로그를 남기고(peerDebugLogger) 가능하면 사용자에게 알린 뒤 계속 실행한다.
process.on('uncaughtException', (error) => {
  try {
    writePeerDebugLog('main.process.uncaughtException', { error })
  } catch { /* 로깅 실패 시 무시 */ }
  try {
    dialog.showErrorBox('LAN Chat 오류', `예상치 못한 오류가 발생했습니다.\n${error?.message || error}`)
  } catch { /* 다이얼로그 표시 실패 시 무시 (예: 창이 아직 없는 시점) */ }
})

process.on('unhandledRejection', (reason) => {
  try {
    writePeerDebugLog('main.process.unhandledRejection', { reason })
  } catch { /* 로깅 실패 시 무시 */ }
})

// 단일 인스턴스 강제 — 트레이에 숨겨진 채로 사용자가 앱을 다시 실행했을 때
// 두 번째 프로세스가 별도로 떠서 포트 / DB 락 충돌로 창이 안 뜨던 버그 방지.
// 두 번째 인스턴스 시도는 즉시 종료하고, 첫 번째 인스턴스의 'second-instance'
// 이벤트가 mainWindow 를 다시 띄워 준다.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

const isDev = !app.isPackaged

// 앱 데이터 경로
const appDataPath = app.getPath('userData')
const tempFilePath = path.join(appDataPath, 'files')
const profileFolderPath = path.join(appDataPath, 'profile')
const systemDefaultNickname = os.userInfo().username

// AppContext 생성
const ctx = createAppContext({
  isDev,
  defaultNickname: systemDefaultNickname,
  appDataPath,
  appRootDir: path.join(__dirname, '..'),
})

async function initApp() {
  if (!isDev) {
    process.env.LAN_CHAT_DEBUG_PEER = process.env.LAN_CHAT_DEBUG_PEER || '1'
    process.env.LAN_CHAT_DEBUG_LOG_PATH = process.env.LAN_CHAT_DEBUG_LOG_PATH || path.join(appDataPath, 'logs', 'peer-debug.log')
  }

  if (isPeerDebugEnabled()) {
    resetPeerDebugLog()
    writePeerDebugLog('main.peerDebug.enabled', {
      logPath: getPeerDebugLogPath(),
      cwd: process.cwd(),
    })
  }

  // Phase 4: 성능 계측이 활성화되면 메모리 모니터 시작 (5분 간격).
  if (perfEnabled) {
    startMemoryMonitor()
    writePeerDebugLog('main.perf.enabled', {})
  }

  // 앱 데이터 디렉토리 권한 제한 — 소유자만 접근 (민감 정보 보호)
  try { fs.chmodSync(appDataPath, 0o700) } catch { /* 무시 */ }

  // 임시 파일 폴더 / 프로필 이미지 폴더 생성 — recursive: true는 이미 존재 시 no-op (TOCTOU 방지)
  fs.mkdirSync(tempFilePath, { recursive: true })
  fs.mkdirSync(profileFolderPath, { recursive: true })

  // 임시 파일 7일 이상 된 것 자동 정리 (디스크 누적 방지)
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    fs.readdirSync(tempFilePath).forEach(file => {
      const filePath = path.join(tempFilePath, file)
      if (fs.statSync(filePath).mtimeMs < sevenDaysAgo) fs.unlinkSync(filePath)
    })
  } catch { /* 정리 실패 시 무시 */ }

  // 파일 / DB 마이그레이션 + 만료 pending 정리는 register / login 시점
  // (마스터키 unwrap + DB 오픈 이후) 에 수행한다.

  // 업데이트 후 첫 실행 감지
  checkAndNotifyUpdated(ctx)

  // LAN IP 계산 (key-exchange 및 파일 서버용)
  ctx.state.localAddressCandidates = collectLocalIpv4Addresses(os.networkInterfaces())
  ctx.state.localIP = selectPrimaryLocalIpv4(os.networkInterfaces())
  writePeerDebugLog('main.network.localIpSelected', {
    localIP: ctx.state.localIP,
    localAddressCandidates: ctx.state.localAddressCandidates,
    interfaces: os.networkInterfaces(),
  })

  // ECDH 키 쌍 로드 (최초 실행 시 자동 생성)
  const { privateKey, publicKey } = loadOrCreateKeyPair(appDataPath)
  ctx.state.myPrivateKey = privateKey
  ctx.state.myPublicKeyBase64 = exportPublicKey(publicKey)

  // 파일 서버 시작 (파일 + 프로필 이미지 제공)
  await startFileServer(profileFolderPath)
  writePeerDebugLog('main.fileServer.started', {
    filePort: getFilePort(),
    tempFilePath,
    profileFolderPath,
  })

  // wsServer/wsClient 공용 메시지 핸들러 생성 후 ctx.state에 저장
  ctx.state.handleIncomingMessage = createIncomingMessageHandler(ctx)

  // WebSocket 서버 시작 (공용 핸들러 사용) — 고정 포트 범위 49152~49161 우선 시도
  ctx.state.wsServerInfo = await startWsServer({ onMessage: ctx.state.handleIncomingMessage })
  writePeerDebugLog('main.wsServer.ready', { wsPort: ctx.state.wsServerInfo.port })

  // 유휴 자동 자리비움 감시 시작 — 로그인 전에는 내부적으로 아무 것도 하지 않는다(#41).
  startPresenceMonitor(ctx)
}

// 부팅 / 재실행 시 중복 호출 방지 플래그.
let bootInitDone = false

async function bootInitOnce() {
  if (bootInitDone) return
  // lanchat:// 프로토콜 핸들러 등록 — 앱 BrowserWindow 안에서만 파일 접근.
  registerLanChatHandler(ctx)

  // ctx.state.safeStorage — register/login IPC 가 v0.9.x 마이그레이션 시 사용.
  ctx.state.safeStorage = safeStorage

  // 마스터키 / DB / peerId 는 register / login IPC 에서 처리한다 (비밀번호 입력 후).
  // 부팅 시점엔 IPC 핸들러 등록 + fileServer / wsServer 만 시작.
  try {
    await initApp()
  } catch (err) {
    console.error('[main] initApp 실패 — fileServer/wsServer 가 시작되지 않은 채로 창만 띄움:', err.message)
    try { writePeerDebugLog('main.initApp.error', { error: err.message }) } catch {}
  }

  // 모든 IPC 핸들러 등록
  registerAllIpcHandlers(ctx)
  bootInitDone = true
}

async function createWindow() {
  await bootInitOnce()

  // 기존 창이 destroyed 가 아니면 그대로 띄워서 사용 (single instance second-instance / activate 경로)
  if (ctx.state.mainWindow && !ctx.state.mainWindow.isDestroyed()) {
    if (!ctx.state.mainWindow.isVisible()) ctx.state.mainWindow.show()
    ctx.state.mainWindow.focus()
    return
  }

  ctx.state.mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 닫기 버튼 클릭 시 종료 대신 숨김 (트레이로 최소화)
  ctx.state.mainWindow.on('close', (event) => {
    if (!ctx.state.isQuitting) {
      event.preventDefault()
      ctx.state.mainWindow.hide()
    }
  })

  // 창 포커스 시 badge 초기화
  ctx.state.mainWindow.on('focus', () => {
    clearBadge(ctx)
  })

  // 시스템 트레이 설정
  const trayIconPath = isDev
    ? path.join(__dirname, '../logo.png')
    : path.join(process.resourcesPath, 'logo.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  ctx.state.tray = new Tray(trayIcon)
  ctx.state.tray.setToolTip('LAN Chat')

  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'LAN Chat 열기',
      click: () => {
        ctx.state.mainWindow.show()
        ctx.state.mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        ctx.state.isQuitting = true
        app.quit()
      },
    },
  ])
  ctx.state.tray.setContextMenu(trayMenu)

  // Windows/Linux: 트레이 아이콘 클릭으로 창 복원
  if (process.platform !== 'darwin') {
    ctx.state.tray.on('click', () => {
      if (ctx.state.mainWindow.isVisible()) {
        ctx.state.mainWindow.focus()
      } else {
        ctx.state.mainWindow.show()
        ctx.state.mainWindow.focus()
      }
    })
  }

  if (isDev) {
    ctx.state.mainWindow.loadURL('http://localhost:5173')
  } else {
    ctx.state.mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }

  // macOS 앱 메뉴 설정 — Cmd+W를 숨김으로 오버라이드 (기본 Close Window 방지)
  if (process.platform === 'darwin') {
    const appMenu = Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: '편집',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '창',
        submenu: [
          {
            label: '창 닫기',
            accelerator: 'CmdOrCtrl+W',
            click: () => {
              if (ctx.state.mainWindow && !ctx.state.isQuitting) {
                ctx.state.mainWindow.hide()
              }
            },
          },
          { role: 'minimize' },
        ],
      },
    ])
    Menu.setApplicationMenu(appMenu)
  }

  setupAutoUpdater()
}

// 업데이트 이벤트 리스너 등록 (프로덕션 전용)
function setupAutoUpdater() {
  if (isDev) return

  autoUpdater.autoDownload = true

  autoUpdater.on('update-available', () => {
    sendToRenderer(ctx, 'update-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer(ctx, 'update-download-progress', Math.floor(progress.percent))
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer(ctx, 'update-not-available')
  })

  autoUpdater.on('update-downloaded', (info) => {
    ctx.state.downloadedUpdateFile = info.downloadedFile
    sendToRenderer(ctx, 'update-downloaded')
  })

  autoUpdater.on('error', (error) => {
    sendToRenderer(ctx, 'update-error', error.message)
  })
}

app.whenReady().then(() => createWindow().catch(err => {
  console.error('[main] createWindow 실패:', err.message)
}))

// 사용자가 이미 실행 중인 앱을 또 실행하려고 시도 — 두 번째 프로세스는
// requestSingleInstanceLock 으로 즉시 종료되고, 그 신호로 첫 번째 인스턴스가
// 숨겨져 있던 창을 다시 띄운다.
app.on('second-instance', () => {
  createWindow().catch(err => {
    console.error('[main] second-instance createWindow 실패:', err.message)
  })
})

// cleanup 중복 실행 방지 플래그
let hasCleanedUp = false

async function performCleanup() {
  if (hasCleanedUp) return
  hasCleanedUp = true
  stopMemoryMonitor()
  stopPresenceMonitor()
  // mDNS goodbye 패킷 전파를 위해 await (500ms 대기 포함)
  try { await stopPeerDiscovery() } catch { /* 무시 */ }
  try { stopFileServer() } catch { /* 무시 */ }
  try { if (ctx.state.wsServerInfo) stopWsServer(ctx.state.wsServerInfo) } catch { /* 무시 */ }
  // closeDatabase 가 close 전에 wal_checkpoint(TRUNCATE) 를 시도해 WAL 파일이
  // 무한정 커지는 것을 방지한다(#27).
  try { if (ctx.state.database) closeDatabase(ctx.state.database) } catch { /* 무시 */ }
  // 버퍼링된(비동기) 디버그 로그가 종료 시점에 유실되지 않도록 마지막으로 강제 flush.
  try { await flushPeerDebugLogNow() } catch { /* 무시 */ }
}

// before-quit: app.quit()가 어디서 호출되든 cleanup 실행 (async 처리로 goodbye 전파 보장)
app.on('before-quit', (event) => {
  if (hasCleanedUp) {
    ctx.state.isQuitting = true
    return
  }
  event.preventDefault()
  performCleanup().then(() => app.quit())
})

app.on('window-all-closed', () => {
  // 트레이 모드에서는 종료하지 않음 — Cmd+Q 또는 트레이 메뉴에서만 종료
  if (!ctx.state.isQuitting) return
  app.quit()
})

// macOS: Dock 클릭, Spotlight 재실행 등 표준 재활성화 시 숨긴 창 다시 표시.
// mainWindow 가 없거나 destroyed 된 경우엔 새로 만들어 준다 (창 안 뜨던 버그 방지).
app.on('activate', () => {
  if (!ctx.state.mainWindow || ctx.state.mainWindow.isDestroyed()) {
    createWindow().catch(err => {
      console.error('[main] activate createWindow 실패:', err.message)
    })
    return
  }
  if (!ctx.state.mainWindow.isVisible()) ctx.state.mainWindow.show()
  ctx.state.mainWindow.focus()
})
