// electron/main.js
const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { initDatabase } = require('./storage/database')
const { saveMessage, getGlobalHistory, getDMHistory } = require('./storage/queries')
const { saveProfile, getProfile, verifyPassword } = require('./storage/profile')
const { startPeerDiscovery, stopPeerDiscovery } = require('./peer/discovery')
const { startWsServer, stopWsServer } = require('./peer/wsServer')
const { connectToPeer, sendMessage, broadcastMessage, getConnections } = require('./peer/wsClient')
const { startFileServer, stopFileServer, getFilePort } = require('./peer/fileServer')
const { loadOrCreateKeyPair, exportPublicKey, importPublicKey } = require('./crypto/keyManager')
const { deriveSharedSecret, encryptDM, decryptDM } = require('./crypto/encryption')
const fs = require('fs')
const { exec } = require('child_process')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// 앱 데이터 경로
const appDataPath = app.getPath('userData')
const tempFilePath = path.join(appDataPath, 'files')
const dbPath = path.join(appDataPath, 'chat.db')

let mainWindow = null
let database = null
let wsServerInfo = null
let peerId = null                       // 내 피어 ID (createWindow에서 초기화)
let downloadedUpdateFile = null         // 다운로드된 업데이트 파일 경로
let myPrivateKey = null                 // 내 ECDH 개인키
let myPublicKeyBase64 = null            // 네트워크 전송용 공개키
let localIP = 'localhost'              // 내 LAN IP (key-exchange 및 파일 서버용)
let handleIncomingMessage = null       // wsServer/wsClient 공용 메시지 핸들러
const peerPublicKeyMap = new Map()      // peerId → 공개키 객체

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return
  new Notification({ title, body: body?.slice(0, 100) || '' }).show()
}

async function initApp() {
  // 임시 파일 폴더 생성
  if (!fs.existsSync(tempFilePath)) fs.mkdirSync(tempFilePath, { recursive: true })

  // LAN IP 계산 (key-exchange 및 파일 서버용)
  localIP = Object.values(os.networkInterfaces())
    .flat()
    .find(iface => iface.family === 'IPv4' && !iface.internal)?.address || 'localhost'

  // ECDH 키 쌍 로드 (최초 실행 시 자동 생성)
  const { privateKey, publicKey } = loadOrCreateKeyPair(appDataPath)
  myPrivateKey = privateKey
  myPublicKeyBase64 = exportPublicKey(publicKey)

  // SQLite 초기화
  database = initDatabase(dbPath)

  // 파일 서버 시작
  await startFileServer(tempFilePath)

  // wsServer/wsClient 공용 메시지 핸들러
  // reply: wsServer에서 온 경우 상대 소켓으로 응답, wsClient에서 온 경우 no-op
  handleIncomingMessage = (message, reply) => {
    // 키 교환 처리 — 내 키 즉시 reply + 역방향 연결 (mDNS 단방향 문제 해결)
    if (message.type === 'key-exchange') {
      try {
        const publicKeyObj = importPublicKey(message.publicKey)
        peerPublicKeyMap.set(message.fromId, publicKeyObj)
        reply({ type: 'key-exchange', fromId: peerId, publicKey: myPublicKeyBase64 })

        // 상대방이 내 mDNS를 못 찾은 경우 — key-exchange의 host/wsPort로 역방향 연결
        if (message.host && message.wsPort && !getConnections().includes(message.fromId)) {
          connectToPeer({
            peerId: message.fromId,
            host: message.host,
            wsPort: message.wsPort,
            onMessage: handleIncomingMessage,
          }).then(() => {
            sendToRenderer('peer-discovered', {
              peerId: message.fromId,
              nickname: message.nickname || '알 수 없음',
              host: message.host,
              wsPort: message.wsPort,
              filePort: message.filePort || 0,
            })
          }).catch(() => { /* 역방향 연결 실패 시 무시 */ })
        }
      } catch {
        // 잘못된 공개키 무시
      }
      return
    }

    // DM: 암호문 복호화 후 렌더러 전달
    if (message.type === 'dm' && message.encryptedPayload) {
      const senderPublicKey = peerPublicKeyMap.get(message.fromId)
      if (!senderPublicKey) return

      try {
        const sharedSecret = deriveSharedSecret(myPrivateKey, senderPublicKey)
        const decryptedPayload = decryptDM(message.encryptedPayload, sharedSecret)

        saveMessage(database, {
          id: message.id,
          type: message.type,
          from_id: message.fromId,
          from_name: message.from,
          to_id: message.to,
          content: null,
          content_type: decryptedPayload.contentType,
          encrypted_payload: message.encryptedPayload,
          file_url: decryptedPayload.fileUrl || null,
          file_name: decryptedPayload.fileName || null,
          timestamp: message.timestamp,
        })

        showNotification(
          `${message.from || '알 수 없음'} (DM)`,
          decryptedPayload.content || '파일을 보냈습니다.'
        )

        sendToRenderer('message-received', {
          ...message,
          content: decryptedPayload.content,
          contentType: decryptedPayload.contentType,
          fileUrl: decryptedPayload.fileUrl,
          fileName: decryptedPayload.fileName,
        })
      } catch { /* 복호화 실패 무시 */ }
      return
    }

    // 전체채팅 메시지 (평문 저장)
    saveMessage(database, {
      id: message.id,
      type: message.type,
      from_id: message.fromId,
      from_name: message.from,
      to_id: null,
      content: message.content || null,
      content_type: message.contentType,
      encrypted_payload: null,
      file_url: message.fileUrl || null,
      file_name: message.fileName || null,
      timestamp: message.timestamp,
    })

    if (mainWindow && !mainWindow.isFocused()) {
      showNotification(
        message.from || '알 수 없음',
        message.content || '파일을 보냈습니다.'
      )
    }

    sendToRenderer('message-received', message)
  }

  // WebSocket 서버 시작 (공용 핸들러 사용)
  wsServerInfo = startWsServer({ onMessage: handleIncomingMessage })
}

// IPC 핸들러 등록
function registerIpcHandlers(peerId, nickname) {
  // 프로필 존재 여부 확인 (앱 시작 시 첫 화면 결정용)
  ipcMain.handle('check-profile-exists', () => {
    return getProfile(database) !== null
  })

  // 최초 설정 — 닉네임·아이디·비밀번호 저장
  ipcMain.handle('register', (_, { username, nickname: nick, password }) => {
    if (getProfile(database)) {
      return { success: false, error: '이미 설정된 프로필이 있습니다.' }
    }
    if (!username?.trim() || !nick?.trim() || !password) {
      return { success: false, error: '모든 항목을 입력해주세요.' }
    }
    try {
      saveProfile(database, { username: username.trim(), nickname: nick.trim(), password })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 로그인 — 아이디·비밀번호 검증
  ipcMain.handle('login', (_, { username, password }) => {
    const isValid = verifyPassword(database, username, password)
    if (!isValid) return { success: false, error: '아이디 또는 비밀번호가 틀렸습니다.' }

    const profile = getProfile(database)
    return { success: true, nickname: profile.nickname }
  })

  // 내 정보 조회 (프로필 닉네임 우선)
  ipcMain.handle('get-my-info', () => {
    const profile = getProfile(database)
    return {
      peerId,
      nickname: profile?.nickname || nickname,
    }
  })

  // 피어 발견 시작 — 닉네임은 클로저의 값을 사용 (렌더러 파라미터 무시)
  ipcMain.handle('start-peer-discovery', (_event, _params) => {
    const currentNickname = getProfile(database)?.nickname || nickname
    startPeerDiscovery({
      nickname: currentNickname,
      peerId,
      wsPort: wsServerInfo.port,
      filePort: getFilePort(),
      onPeerFound: async (peerInfo) => {
        await connectToPeer({
          peerId: peerInfo.peerId,
          host: peerInfo.host,
          wsPort: peerInfo.wsPort,
          onMessage: handleIncomingMessage,
        })
        // key-exchange에 내 접속 정보 포함 → 상대방이 역방향 연결 가능
        sendMessage(peerInfo.peerId, {
          type: 'key-exchange',
          fromId: peerId,
          publicKey: myPublicKeyBase64,
          nickname: currentNickname,
          host: localIP,
          wsPort: wsServerInfo.port,
          filePort: getFilePort(),
        })
        sendToRenderer('peer-discovered', peerInfo)
      },
      onPeerLeft: (leftPeerId) => {
        sendToRenderer('peer-left', leftPeerId)
      },
    })
  })

  // 전체채팅 메시지 전송
  ipcMain.handle('send-global-message', (_, { content, contentType, fileUrl, fileName }) => {
    const currentNickname = getProfile(database)?.nickname || nickname
    const message = {
      id: uuidv4(),
      type: 'message',
      from: currentNickname,
      fromId: peerId,
      to: null,
      content: content || null,
      contentType,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
    }
    broadcastMessage(message)
    // 내 메시지도 로컬 저장
    saveMessage(database, {
      id: message.id, type: message.type,
      from_id: message.fromId, from_name: message.from,
      to_id: null, content: message.content,
      content_type: message.contentType,
      encrypted_payload: null,
      file_url: message.fileUrl, file_name: message.fileName,
      timestamp: message.timestamp,
    })
    return message
  })

  // DM 전송 (E2E 암호화)
  ipcMain.handle('send-dm', (_, { recipientPeerId, content, contentType, fileUrl, fileName }) => {
    const recipientPublicKey = peerPublicKeyMap.get(recipientPeerId)
    if (!recipientPublicKey) throw new Error('수신자 공개키 미수신 — 키 교환 완료 전')

    const sharedSecret = deriveSharedSecret(myPrivateKey, recipientPublicKey)
    const encryptedPayload = encryptDM(
      { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
      sharedSecret
    )

    const currentNickname = getProfile(database)?.nickname || nickname
    const message = {
      id: uuidv4(),
      type: 'dm',
      from: currentNickname,
      fromId: peerId,
      to: recipientPeerId,
      content: null,              // 평문은 네트워크로 전송하지 않음
      contentType,
      encryptedPayload,
      fileUrl: null,
      fileName: null,
      timestamp: Date.now(),
    }
    sendMessage(recipientPeerId, message)

    // 내 DB에는 암호문 저장
    saveMessage(database, {
      id: message.id, type: message.type,
      from_id: message.fromId, from_name: message.from,
      to_id: message.to, content: null,
      content_type: contentType,
      encrypted_payload: encryptedPayload,
      file_url: fileUrl || null, file_name: fileName || null,
      timestamp: message.timestamp,
    })

    // 렌더러에는 복호화된 내용으로 반환 (내가 방금 보낸 내용이므로 알고 있음)
    return { ...message, content: content || null, fileUrl: fileUrl || null, fileName: fileName || null }
  })

  // 채팅 기록 조회
  ipcMain.handle('get-global-history', () => getGlobalHistory(database))
  ipcMain.handle('get-dm-history', (_, { peerId1, peerId2 }) => {
    const history = getDMHistory(database, peerId1, peerId2)
    // peerId1 = 나, peerId2 = 상대방
    const otherPublicKey = peerPublicKeyMap.get(peerId2)

    return history.map(msg => {
      if (msg.encrypted_payload && otherPublicKey) {
        try {
          const sharedSecret = deriveSharedSecret(myPrivateKey, otherPublicKey)
          const decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret)
          return {
            ...msg,
            content: decryptedPayload.content,
            contentType: decryptedPayload.contentType || msg.content_type,
            fileUrl: decryptedPayload.fileUrl || msg.file_url,
            fileName: decryptedPayload.fileName || msg.file_name,
          }
        } catch {
          // 복호화 실패 시 원본 반환
        }
      }
      return msg
    })
  })

  // 파일 임시 저장 후 URL 반환
  // 주의: Electron IPC에서 ArrayBuffer는 Uint8Array로 전달해야 안전하게 직렬화됨
  ipcMain.handle('save-file', (_, { fileBuffer, fileName }) => {
    const ext = path.extname(fileName)
    const savedFileName = `${uuidv4()}${ext}`
    const savePath = path.join(tempFilePath, savedFileName)
    fs.writeFileSync(savePath, Buffer.from(new Uint8Array(fileBuffer)))
    return `http://${localIP}:${getFilePort()}/files/${savedFileName}`
  })
}

async function createWindow() {
  peerId = uuidv4()
  const nickname = os.userInfo().username // 기본값: OS 사용자명 (로그인 후 프로필 닉네임으로 대체)

  await initApp()

  registerIpcHandlers(peerId, nickname)

  mainWindow = new BrowserWindow({
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
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }

  setupAutoUpdater()
}

// 업데이트 이벤트 리스너 등록 (프로덕션 전용)
function setupAutoUpdater() {
  if (isDev) return

  autoUpdater.autoDownload = true

  autoUpdater.on('update-available', () => {
    sendToRenderer('update-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-download-progress', Math.floor(progress.percent))
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update-not-available')
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdateFile = info.downloadedFile
    sendToRenderer('update-downloaded')
  })

  autoUpdater.on('error', (error) => {
    sendToRenderer('update-error', error.message)
  })
}

// 업데이트 확인 IPC 핸들러 — dev에서는 즉시 not-available 반환
ipcMain.handle('check-for-updates', () => {
  if (isDev) {
    sendToRenderer('update-not-available')
    return
  }
  autoUpdater.checkForUpdates()
})

// 업데이트 설치 IPC 핸들러
// macOS: ad-hoc 서명 앱은 Squirrel.Mac이 파일 교체를 거부하므로 shell script로 직접 교체
ipcMain.handle('install-update', () => {
  if (process.platform === 'darwin' && downloadedUpdateFile && fs.existsSync(downloadedUpdateFile)) {
    const exePath = app.getPath('exe')
    const appBundlePath = exePath.includes('/Contents/MacOS/')
      ? exePath.split('/Contents/MacOS/')[0]
      : null

    if (appBundlePath) {
      const tempDir = path.join(os.tmpdir(), `lan-chat-update-${Date.now()}`)
      const scriptPath = path.join(os.tmpdir(), 'lan-chat-update.sh')

      const script = [
        '#!/bin/bash',
        'sleep 1',
        `TEMP_DIR="${tempDir}"`,
        `mkdir -p "$TEMP_DIR"`,
        `unzip -o "${downloadedUpdateFile}" -d "$TEMP_DIR"`,
        `APP=$(find "$TEMP_DIR" -name "*.app" -maxdepth 1 | head -1)`,
        `if [ -n "$APP" ]; then`,
        `  rm -rf "${appBundlePath}"`,
        `  ditto "$APP" "${appBundlePath}"`,
        `  open "${appBundlePath}"`,
        `fi`,
        `rm -rf "$TEMP_DIR"`,
        `rm -f "${scriptPath}"`,
      ].join('\n')

      fs.writeFileSync(scriptPath, script, { mode: 0o755 })
      exec(`bash "${scriptPath}"`, { detached: true })
      setTimeout(() => app.quit(), 300)
      return
    }
  }

  autoUpdater.quitAndInstall(false, true)
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  stopPeerDiscovery()
  stopFileServer()
  if (wsServerInfo) stopWsServer(wsServerInfo)
  if (database) database.close()
  app.quit()
})
