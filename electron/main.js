// electron/main.js
const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { initDatabase, migrateDatabase } = require('./storage/database')
const { saveMessage, getGlobalHistory, getDMHistory, deleteMessage, getDMPeers, clearAllMessages, clearAllDMs } = require('./storage/queries')
const {
  saveProfile, getProfile, verifyPassword,
  updatePeerId, updateLastLogin, clearLastLogin, updateNickname, updateProfileImage,
  getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound,
  updatePassword,
} = require('./storage/profile')
const { savePendingMessage, getPendingMessages, deletePendingMessage } = require('./storage/pendingMessages')
const { startPeerDiscovery, stopPeerDiscovery, republishService } = require('./peer/discovery')
const { startWsServer, stopWsServer, closeAllServerClients } = require('./peer/wsServer')
const { connectToPeer, sendMessage, broadcastMessage, getConnections, disconnectAll, disconnectFromPeer } = require('./peer/wsClient')
const { startFileServer, stopFileServer, getFilePort } = require('./peer/fileServer')
const { loadOrCreateKeyPair, exportPublicKey, importPublicKey } = require('./crypto/keyManager')
const { deriveSharedSecret, encryptDM, decryptDM } = require('./crypto/encryption')
const fs = require('fs')
const { spawn } = require('child_process')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// 앱 데이터 경로
const appDataPath = app.getPath('userData')
const tempFilePath = path.join(appDataPath, 'files')
const profileFolderPath = path.join(appDataPath, 'profile')
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
let discoveryEpoch = 0                  // 글로벌 세대 번호 — start-peer-discovery마다 증가

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return
  new Notification({ title, body: body?.slice(0, 100) || '' }).show()
}

// 창이 비활성화 상태일 때 렌더러에 소리 재생 요청
function playNotificationSound() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    sendToRenderer('play-notification-sound')
  }
}

// 업데이트 후 첫 실행 감지 — 이전 버전과 현재 버전 비교
let updatedFromVersion = null  // 업데이트 전 버전 (첫 실행 시 패치노트 표시용)
function checkAndNotifyUpdated() {
  if (isDev) return
  const versionFilePath = path.join(appDataPath, 'last-version.json')
  const currentVersion = app.getVersion()
  try {
    const stored = fs.existsSync(versionFilePath)
      ? JSON.parse(fs.readFileSync(versionFilePath, 'utf8'))
      : null
    if (stored && stored.version !== currentVersion) {
      updatedFromVersion = stored.version
      showNotification('LAN Chat 업데이트 완료', `v${stored.version} → v${currentVersion}`)
    }
    fs.writeFileSync(versionFilePath, JSON.stringify({ version: currentVersion }))
  } catch { /* 무시 */ }
}

// CHANGELOG.json 로드
function loadChangelog() {
  try {
    const changelogPath = isDev
      ? path.join(__dirname, '../CHANGELOG.json')
      : path.join(process.resourcesPath, 'CHANGELOG.json')
    return JSON.parse(fs.readFileSync(changelogPath, 'utf8'))
  } catch { return [] }
}

// 오프라인 메시지를 대상 피어에게 전송
async function flushPendingMessages(targetPeerId) {
  const pendingList = getPendingMessages(database, targetPeerId)
  if (pendingList.length === 0) return

  const recipientPublicKey = peerPublicKeyMap.get(targetPeerId)
  if (!recipientPublicKey) return

  const currentNickname = getProfile(database)?.nickname || ''
  const sharedSecret = deriveSharedSecret(myPrivateKey, recipientPublicKey)
  const flushedMessageIds = []

  for (const pending of pendingList) {
    const { messagePayload } = pending
    try {
      const encryptedPayload = encryptDM(
        {
          content: messagePayload.content,
          contentType: messagePayload.contentType,
          fileUrl: messagePayload.fileUrl,
          fileName: messagePayload.fileName,
        },
        sharedSecret
      )
      const message = {
        id: pending.id,
        type: 'dm',
        from: currentNickname,
        fromId: peerId,
        to: targetPeerId,
        content: null,
        contentType: messagePayload.contentType,
        encryptedPayload,
        fileUrl: null,
        fileName: null,
        timestamp: pending.created_at,
      }
      const sent = sendMessage(targetPeerId, message)
      if (sent) {
        deletePendingMessage(database, pending.id)
        flushedMessageIds.push(pending.id)
      }
    } catch { /* 암호화 또는 전송 실패 시 무시 */ }
  }

  if (flushedMessageIds.length > 0) {
    sendToRenderer('pending-messages-flushed', { targetPeerId, messageIds: flushedMessageIds })
  }
}

// 내 프로필 이미지 URL 생성
function buildMyProfileImageUrl() {
  const profile = getProfile(database)
  if (!profile?.profile_image) return null
  return `http://${localIP}:${getFilePort()}/profile/${profile.profile_image}`
}

async function initApp() {
  // 임시 파일 폴더 생성
  if (!fs.existsSync(tempFilePath)) fs.mkdirSync(tempFilePath, { recursive: true })
  // 프로필 이미지 폴더 생성
  if (!fs.existsSync(profileFolderPath)) fs.mkdirSync(profileFolderPath, { recursive: true })

  // 임시 파일 7일 이상 된 것 자동 정리 (디스크 누적 방지)
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    fs.readdirSync(tempFilePath).forEach(file => {
      const filePath = path.join(tempFilePath, file)
      if (fs.statSync(filePath).mtimeMs < sevenDaysAgo) fs.unlinkSync(filePath)
    })
  } catch { /* 정리 실패 시 무시 */ }

  // 업데이트 후 첫 실행 감지
  checkAndNotifyUpdated()

  // LAN IP 계산 (key-exchange 및 파일 서버용)
  localIP = Object.values(os.networkInterfaces())
    .flat()
    .find(iface => iface.family === 'IPv4' && !iface.internal)?.address || 'localhost'

  // ECDH 키 쌍 로드 (최초 실행 시 자동 생성)
  const { privateKey, publicKey } = loadOrCreateKeyPair(appDataPath)
  myPrivateKey = privateKey
  myPublicKeyBase64 = exportPublicKey(publicKey)

  // 파일 서버 시작 (파일 + 프로필 이미지 제공)
  await startFileServer(tempFilePath, profileFolderPath)

  // wsServer/wsClient 공용 메시지 핸들러
  // reply: wsServer에서 온 경우 상대 소켓으로 응답, wsClient에서 온 경우 no-op
  handleIncomingMessage = (message, reply) => {
    // 타이핑 이벤트 — DB 저장 없이 렌더러로 전달만
    if (message.type === 'typing') {
      sendToRenderer('typing-event', { fromId: message.fromId, from: message.from, to: message.to || null })
      return
    }

    // 메시지 삭제 이벤트 — DB 삭제 후 렌더러로 전달
    if (message.type === 'delete-message') {
      try { deleteMessage(database, message.messageId, message.fromId) } catch { /* 무시 */ }
      sendToRenderer('message-received', {
        type: 'delete-message',
        messageId: message.messageId,
        fromId: message.fromId,
        to: message.to || null,
      })
      return
    }

    // 닉네임 변경 이벤트
    if (message.type === 'nickname-changed') {
      sendToRenderer('peer-nickname-changed', { peerId: message.fromId, nickname: message.nickname })
      return
    }

    // 키 교환 처리 — 내 키 즉시 reply + 역방향 연결 (mDNS 단방향 문제 해결)
    if (message.type === 'key-exchange') {
      try {
        const publicKeyObj = importPublicKey(message.publicKey)
        peerPublicKeyMap.set(message.fromId, publicKeyObj)
        const currentNicknameForReply = getProfile(database)?.nickname || ''
        reply({
          type: 'key-exchange',
          fromId: peerId,
          publicKey: myPublicKeyBase64,
          nickname: currentNicknameForReply,
          host: localIP,
          wsPort: wsServerInfo.port,
          filePort: getFilePort(),
          profileImageUrl: buildMyProfileImageUrl(),
        })

        // 상대방 프로필 이미지 URL 업데이트
        if (message.profileImageUrl !== undefined) {
          sendToRenderer('peer-profile-updated', { peerId: message.fromId, profileImageUrl: message.profileImageUrl })
        }

        // key-exchange 수신 = 상대방 온라인 확실 → 무조건 peer-discovered 전송
        // (mDNS 재발견 실패 시에도 UI 복구 보장)
        const peerDiscoveredData = {
          peerId: message.fromId,
          nickname: message.nickname || '알 수 없음',
          ...(message.host && { host: message.host }),
          ...(message.wsPort && { wsPort: message.wsPort }),
          filePort: message.filePort || 0,
          profileImageUrl: message.profileImageUrl || null,
        }
        sendToRenderer('peer-discovered', peerDiscoveredData)

        // 역방향 연결 — 기존 연결이 없는 경우에만 (mDNS 단방향 문제 해결)
        // 좀비 소켓은 start-peer-discovery의 closeAllServerClients가 사전 정리
        if (message.host && message.wsPort && !getConnections().includes(message.fromId)) {
          const epochAtReverse = discoveryEpoch
          connectToPeer({
            peerId: message.fromId,
            host: message.host,
            wsPort: message.wsPort,
            onMessage: handleIncomingMessage,
            onClose: () => {
              if (epochAtReverse !== discoveryEpoch) return
              if (!getConnections().includes(message.fromId)) {
                sendToRenderer('peer-left', message.fromId)
              }
            },
          }).then(() => {
            // 역방향 연결 성공 후 epoch 재확인 — stale이면 폐기
            if (epochAtReverse !== discoveryEpoch) {
              disconnectFromPeer(message.fromId)
              return
            }
            flushPendingMessages(message.fromId)
          }).catch(() => { /* 역방향 연결 실패 시 무시 */ })
        } else {
          // 이미 연결 중이거나 host/wsPort 없으면 즉시 flush
          flushPendingMessages(message.fromId)
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

        if (mainWindow && !mainWindow.isFocused()) {
          showNotification(
            `${message.from || '알 수 없음'} (DM)`,
            decryptedPayload.content || '파일을 보냈습니다.'
          )
          playNotificationSound()
        }

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
      playNotificationSound()
    }

    sendToRenderer('message-received', message)
  }

  // WebSocket 서버 시작 (공용 핸들러 사용)
  wsServerInfo = startWsServer({ onMessage: handleIncomingMessage })
}

// IPC 핸들러 등록
function registerIpcHandlers(currentPeerId, defaultNickname) {
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
      updatePeerId(database, currentPeerId)
      updateLastLogin(database)
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
    updateLastLogin(database)
    return { success: true, nickname: profile.nickname }
  })

  // 자동 로그인 확인 — last_login_at이 24시간 이내이면 자동 로그인
  ipcMain.handle('check-auto-login', () => {
    const profile = getProfile(database)
    if (!profile?.last_login_at) return { autoLogin: false }
    const elapsedMs = Date.now() - profile.last_login_at
    const twentyFourHoursMs = 24 * 60 * 60 * 1000
    if (elapsedMs < twentyFourHoursMs) {
      updateLastLogin(database)
      return { autoLogin: true, nickname: profile.nickname }
    }
    return { autoLogin: false }
  })

  // 로그아웃 — last_login_at 초기화 + 연결 종료
  ipcMain.handle('logout', async () => {
    clearLastLogin(database)
    await stopPeerDiscovery()
    disconnectAll()
    peerPublicKeyMap.clear()
  })

  // 내 정보 조회 (프로필 닉네임 우선)
  ipcMain.handle('get-my-info', () => {
    const profile = getProfile(database)
    return {
      peerId: currentPeerId,
      nickname: profile?.nickname || defaultNickname,
      profileImageUrl: buildMyProfileImageUrl(),
    }
  })

  // 피어 발견 시작 — 기존 인스턴스 정리 후 재시작 (Cmd+R 등 재호출 시 Bonjour 좀비 방지)
  ipcMain.handle('start-peer-discovery', async (_event, _params) => {
    await stopPeerDiscovery()
    disconnectAll()
    // 서버에 연결된 상대방의 클라이언트 소켓도 강제 종료 — 좀비 소켓 방지
    if (wsServerInfo) closeAllServerClients(wsServerInfo)
    peerPublicKeyMap.clear()
    // 글로벌 세대 증가 — 이전 세대의 연결에서 발생하는 stale close/peer-left를 무시하기 위함
    discoveryEpoch++
    const currentEpoch = discoveryEpoch
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    startPeerDiscovery({
      nickname: currentNickname,
      peerId: currentPeerId,
      wsPort: wsServerInfo.port,
      filePort: getFilePort(),
      onPeerFound: async (peerInfo) => {
        try {
          await connectToPeer({
            peerId: peerInfo.peerId,
            host: peerInfo.host,
            wsPort: peerInfo.wsPort,
            onMessage: handleIncomingMessage,
            onClose: () => {
              // 현재 세대의 연결이 아니면 stale → peer-left 무시
              if (currentEpoch !== discoveryEpoch) return
              if (!getConnections().includes(peerInfo.peerId)) {
                sendToRenderer('peer-left', peerInfo.peerId)
              }
            },
          })
        } catch {
          // 연결 실패 시 무시 (상대방이 아직 서버를 준비 중일 수 있음)
          return
        }
        // 연결 성공 후 epoch 재확인 — 연결 중에 refresh가 발생했으면 stale 소켓 폐기
        if (currentEpoch !== discoveryEpoch) {
          disconnectFromPeer(peerInfo.peerId)
          return
        }
        // key-exchange에 내 접속 정보 + 프로필 이미지 포함
        sendMessage(peerInfo.peerId, {
          type: 'key-exchange',
          fromId: currentPeerId,
          publicKey: myPublicKeyBase64,
          nickname: currentNickname,
          host: localIP,
          wsPort: wsServerInfo.port,
          filePort: getFilePort(),
          profileImageUrl: buildMyProfileImageUrl(),
        })
        sendToRenderer('peer-discovered', peerInfo)
      },
      onPeerLeft: (leftPeerId) => {
        // 현재 세대가 아니면 stale mDNS 이벤트 → 무시
        if (currentEpoch !== discoveryEpoch) return
        // active outbound connection이 있으면 peer-left를 보내지 않음
        if (!getConnections().includes(leftPeerId)) {
          sendToRenderer('peer-left', leftPeerId)
        }
      },
    })
  })

  // 닉네임 변경
  ipcMain.handle('update-nickname', (_, newNickname) => {
    if (!newNickname?.trim()) return { success: false, error: '닉네임을 입력해주세요.' }
    try {
      updateNickname(database, newNickname.trim())
      republishService({
        nickname: newNickname.trim(),
        peerId: currentPeerId,
        wsPort: wsServerInfo.port,
        filePort: getFilePort(),
      })
      broadcastMessage({
        type: 'nickname-changed',
        fromId: currentPeerId,
        nickname: newNickname.trim(),
        timestamp: Date.now(),
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 프로필 이미지 저장 — 항상 avatar.png로 저장
  ipcMain.handle('save-profile-image', (_, imageBuffer) => {
    try {
      const imageName = 'avatar.png'
      const savePath = path.join(profileFolderPath, imageName)
      fs.writeFileSync(savePath, Buffer.from(new Uint8Array(imageBuffer)))
      updateProfileImage(database, imageName)
      const url = `http://${localIP}:${getFilePort()}/profile/${imageName}`
      return { success: true, url }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 전체채팅 메시지 전송
  ipcMain.handle('send-global-message', (_, { content, contentType, fileUrl, fileName }) => {
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const message = {
      id: uuidv4(),
      type: 'message',
      from: currentNickname,
      fromId: currentPeerId,
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

  // DM 전송 (E2E 암호화, 오프라인이면 pending 큐에 저장)
  ipcMain.handle('send-dm', (_, { recipientPeerId, content, contentType, fileUrl, fileName }) => {
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const messageId = uuidv4()
    const timestamp = Date.now()

    const recipientPublicKey = peerPublicKeyMap.get(recipientPeerId)
    if (!recipientPublicKey) {
      // 오프라인 — 평문으로 pending 큐에 저장
      savePendingMessage(database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
      })
      // messages 테이블에 평문으로 저장 (히스토리 표시용)
      saveMessage(database, {
        id: messageId, type: 'dm',
        from_id: currentPeerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
      })
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: currentPeerId,
        to: recipientPeerId, content: content || null, contentType,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
      }
    }

    const sharedSecret = deriveSharedSecret(myPrivateKey, recipientPublicKey)
    const encryptedPayload = encryptDM(
      { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
      sharedSecret
    )

    const message = {
      id: messageId, type: 'dm', from: currentNickname, fromId: currentPeerId,
      to: recipientPeerId, content: null, contentType, encryptedPayload,
      fileUrl: null, fileName: null, timestamp,
    }

    const sent = sendMessage(recipientPeerId, message)

    if (!sent) {
      // 소켓은 있지만 연결 끊긴 경우 → pending 저장
      savePendingMessage(database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
      })
    }

    // 내 DB에는 암호문 저장
    saveMessage(database, {
      id: message.id, type: message.type,
      from_id: message.fromId, from_name: message.from,
      to_id: message.to, content: null,
      content_type: contentType, encrypted_payload: encryptedPayload,
      file_url: fileUrl || null, file_name: fileName || null,
      timestamp: message.timestamp,
    })

    // 렌더러에는 복호화된 내용으로 반환
    return {
      ...message, content: content || null, fileUrl: fileUrl || null, fileName: fileName || null,
      ...(sent ? {} : { pending: true }),
    }
  })

  // 타이핑 인디케이터 전송
  ipcMain.handle('send-typing', (_, targetPeerId) => {
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const typingMessage = {
      type: 'typing',
      fromId: currentPeerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendMessage(targetPeerId, typingMessage)
    } else {
      broadcastMessage(typingMessage)
    }
  })

  // 메시지 삭제 (본인 메시지만)
  ipcMain.handle('delete-message', (_, { messageId, targetPeerId }) => {
    deleteMessage(database, messageId, currentPeerId)
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const deletePayload = {
      type: 'delete-message',
      messageId,
      fromId: currentPeerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendMessage(targetPeerId, deletePayload)
    } else {
      broadcastMessage(deletePayload)
    }
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

  // 과거 DM 상대 목록 조회 (오프라인 포함)
  ipcMain.handle('get-dm-peers', () => getDMPeers(database, currentPeerId))

  // 전체 채팅 기록 삭제 (global + DM + pending 모두)
  ipcMain.handle('clear-all-messages', () => {
    clearAllMessages(database)
  })

  // DM 기록만 삭제
  ipcMain.handle('clear-all-dms', () => {
    clearAllDMs(database)
  })

  // 알림 설정 조회
  ipcMain.handle('get-notification-settings', () =>
    getNotificationSettings(database, appDataPath)
  )

  // 알림 설정 저장
  ipcMain.handle('save-notification-settings', (_, { sound, volume }) => {
    saveNotificationSettings(database, { sound, volume })
  })

  // 커스텀 사운드 파일 저장 — 허용 확장자 검증 (경로 탈출 방지)
  ipcMain.handle('save-custom-notification-sound', (_, { buffer, extension }) => {
    const allowedExtensions = ['mp3', 'ogg', 'wav']
    if (!allowedExtensions.includes(String(extension).toLowerCase())) {
      return { success: false, error: '허용되지 않는 파일 형식입니다.' }
    }
    saveCustomNotificationSound(database, appDataPath, buffer, extension)
  })

  // 비밀번호 변경 — 기존 비밀번호 검증 후 변경
  ipcMain.handle('update-password', (_, { currentPassword, newPassword }) => {
    const profile = getProfile(database)
    if (!profile) return { success: false, error: '프로필이 없습니다.' }
    return updatePassword(database, profile.username, currentPassword, newPassword)
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
  // DB 먼저 초기화 (peerId 복원을 위해)
  database = initDatabase(dbPath)
  migrateDatabase(database)

  // peerId 복원 또는 신규 생성
  const existingProfile = getProfile(database)
  if (existingProfile?.peer_id) {
    peerId = existingProfile.peer_id
  } else {
    peerId = uuidv4()
    // 프로필이 있으면 즉시 저장, 없으면 register 시 저장
    if (existingProfile) {
      updatePeerId(database, peerId)
    }
  }

  const defaultNickname = os.userInfo().username // 기본값: OS 사용자명

  await initApp()

  registerIpcHandlers(peerId, defaultNickname)

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

// 외부 링크 IPC 핸들러 — http/https URL만 OS 기본 브라우저로 열기
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url)
  }
})

// 패치노트 조회 — 전체 changelog 반환
ipcMain.handle('get-changelog', () => loadChangelog())

// 앱 버전 + 업데이트 여부 조회
ipcMain.handle('get-app-version-info', () => ({
  currentVersion: app.getVersion(),
  updatedFromVersion,
}))

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
        'sleep 2',
        `TEMP_DIR="${tempDir}"`,
        `mkdir -p "$TEMP_DIR"`,
        `unzip -o "${downloadedUpdateFile}" -d "$TEMP_DIR"`,
        `APP=$(find "$TEMP_DIR" -name "*.app" | head -1)`,
        `if [ -n "$APP" ]; then`,
        `  rm -rf "${appBundlePath}"`,
        `  ditto "$APP" "${appBundlePath}"`,
        `  rm -f "${downloadedUpdateFile}"`,
        `  open "${appBundlePath}"`,
        `fi`,
        `rm -rf "$TEMP_DIR"`,
        `rm -f "${scriptPath}"`,
      ].join('\n')

      try {
        fs.writeFileSync(scriptPath, script, { mode: 0o755 })
        const child = spawn('bash', [scriptPath], {
          detached: true,
          stdio: 'ignore',
        })
        // 오류 이벤트 핸들러 등록 — 없으면 unhandled error로 main process crash
        child.on('error', (err) => {
          console.error('[install-update] 스크립트 실행 오류:', err.message)
        })
        child.unref()
        setTimeout(() => app.quit(), 500)
        return
      } catch (err) {
        console.error('[install-update] 스크립트 쓰기/실행 실패, fallback으로 전환:', err.message)
      }
    }
  }

  // macOS shell script 방식이 불가한 경우 fallback
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (err) {
    console.error('[install-update] quitAndInstall 실패, 강제 종료:', err.message)
    setTimeout(() => app.quit(), 500)
  }
})

app.whenReady().then(createWindow)

// cleanup 중복 실행 방지 플래그
let hasCleanedUp = false

async function performCleanup() {
  if (hasCleanedUp) return
  hasCleanedUp = true
  // mDNS goodbye 패킷 전파를 위해 await (500ms 대기 포함)
  try { await stopPeerDiscovery() } catch { /* 무시 */ }
  try { stopFileServer() } catch { /* 무시 */ }
  try { if (wsServerInfo) stopWsServer(wsServerInfo) } catch { /* 무시 */ }
  try { if (database) database.close() } catch { /* 무시 */ }
}

// before-quit: app.quit()가 어디서 호출되든 cleanup 실행 (async 처리로 goodbye 전파 보장)
app.on('before-quit', (event) => {
  if (hasCleanedUp) return
  event.preventDefault()
  performCleanup().then(() => app.quit())
})

app.on('window-all-closed', () => {
  // macOS에서 창을 모두 닫아도 앱이 유지되는 기본 동작 방지
  app.quit()
})
