// electron/main.js
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { initDatabase, migrateDatabase } = require('./storage/database')
const { getProfile, updatePeerId } = require('./storage/profile')
const { startWsServer, stopWsServer } = require('./peer/wsServer')
const { disconnectAll } = require('./peer/wsClient')
const { startFileServer, stopFileServer, getFilePort } = require('./peer/fileServer')
const { collectLocalIpv4Addresses, selectPrimaryLocalIpv4 } = require('./peer/networkUtils')
const { loadOrCreateKeyPair, exportPublicKey } = require('./crypto/keyManager')
const { writePeerDebugLog, resetPeerDebugLog, isPeerDebugEnabled, getPeerDebugLogPath } = require('./utils/peerDebugLogger')
const { stopPeerDiscovery } = require('./peer/discovery')
const { deleteExpiredPendingMessages } = require('./storage/pendingMessages')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')

const { createAppContext } = require('./context')
const { createIncomingMessageHandler } = require('./messageHandler')
const { registerAllIpcHandlers } = require('./ipcHandlers/index')
const { sendToRenderer, clearBadge, checkAndNotifyUpdated } = require('./utils/appUtils')

const isDev = !app.isPackaged

// 앱 데이터 경로
const appDataPath = app.getPath('userData')
const tempFilePath = path.join(appDataPath, 'files')
const profileFolderPath = path.join(appDataPath, 'profile')
const dbPath = path.join(appDataPath, 'chat.db')
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

  // 만료된 pending 메시지 자동 정리 (7일 이상)
  try { deleteExpiredPendingMessages(ctx.state.database) } catch { /* 정리 실패 시 무시 */ }

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
  await startFileServer(tempFilePath, profileFolderPath)
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
}

async function createWindow() {
  // DB 먼저 초기화 (peerId 복원을 위해)
  ctx.state.database = initDatabase(dbPath)
  try { migrateDatabase(ctx.state.database) } catch { /* 마이그레이션 부분 실패는 무시 — DB 자체는 유효 */ }

  // peerId 복원 또는 신규 생성
  const existingProfile = getProfile(ctx.state.database)
  if (existingProfile?.peer_id) {
    ctx.state.peerId = existingProfile.peer_id
  } else {
    ctx.state.peerId = uuidv4()
    // 프로필이 있으면 즉시 저장, 없으면 register 시 저장
    if (existingProfile) {
      updatePeerId(ctx.state.database, ctx.state.peerId)
    }
  }

  await initApp()

  // 모든 IPC 핸들러 등록
  registerAllIpcHandlers(ctx)

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

app.whenReady().then(createWindow)

// cleanup 중복 실행 방지 플래그
let hasCleanedUp = false

async function performCleanup() {
  if (hasCleanedUp) return
  hasCleanedUp = true
  // mDNS goodbye 패킷 전파를 위해 await (500ms 대기 포함)
  try { await stopPeerDiscovery() } catch { /* 무시 */ }
  try { stopFileServer() } catch { /* 무시 */ }
  try { if (ctx.state.wsServerInfo) stopWsServer(ctx.state.wsServerInfo) } catch { /* 무시 */ }
  try { if (ctx.state.database) ctx.state.database.close() } catch { /* 무시 */ }
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

// macOS: Dock 클릭, Spotlight 재실행 등 표준 재활성화 시 숨긴 창 다시 표시
app.on('activate', () => {
  if (ctx.state.mainWindow) {
    ctx.state.mainWindow.show()
    ctx.state.mainWindow.focus()
  }
})
