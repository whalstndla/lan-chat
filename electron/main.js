// electron/main.js
const { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { initDatabase, migrateDatabase } = require('./storage/database')
const { saveMessage, getGlobalHistory, getDMHistory, deleteMessage, editMessage, getDMPeers, clearAllMessages, clearAllDMs, markMessagesAsRead: markMessagesAsReadDB, getUnreadDMMessageIds, addReaction, removeReaction, getReactions, getReactionsByMessageIds, searchMessages, saveFileCache, getFileCache } = require('./storage/queries')
const {
  saveProfile, getProfile, verifyPassword,
  updatePeerId, updateLastLogin, clearLastLogin, updateNickname, updateProfileImage,
  getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound,
  updatePassword, updateStatus,
} = require('./storage/profile')
const { savePendingMessage, getPendingMessages, deletePendingMessage, deleteExpiredPendingMessages } = require('./storage/pendingMessages')
const { startPeerDiscovery, stopPeerDiscovery, republishService, removePeerFromDiscovered } = require('./peer/discovery')
const { buildPeerConnectHostCandidates, collectLocalIpv4Addresses, normalizeAdvertisedAddresses, selectPrimaryLocalIpv4 } = require('./peer/networkUtils')
const { startWsServer, stopWsServer, closeAllServerClients, getServerClientPeerIds, sendMessageToServerPeer } = require('./peer/wsServer')
const { connectToPeer, sendMessage, getConnections, disconnectAll, disconnectFromPeer } = require('./peer/wsClient')
const { startFileServer, stopFileServer, getFilePort } = require('./peer/fileServer')
const { loadOrCreateKeyPair, exportPublicKey, importPublicKey } = require('./crypto/keyManager')
const { deriveSharedSecret, encryptDM, decryptDM } = require('./crypto/encryption')
const { writePeerDebugLog, resetPeerDebugLog, isPeerDebugEnabled, getPeerDebugLogPath } = require('./utils/peerDebugLogger')
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
let tray = null
let isQuitting = false          // Cmd+Q 등 실제 종료 여부 플래그
let unreadBadgeCount = 0        // Dock/트레이 badge용 안읽은 메시지 수
let database = null
let wsServerInfo = null
let peerId = null                       // 내 피어 ID (createWindow에서 초기화)
let downloadedUpdateFile = null         // 다운로드된 업데이트 파일 경로
let myPrivateKey = null                 // 내 ECDH 개인키
let myPublicKeyBase64 = null            // 네트워크 전송용 공개키
let localIP = 'localhost'              // 내 LAN IP (key-exchange 및 파일 서버용)
let localAddressCandidates = []         // 광고/역방향 연결에 사용할 로컬 IPv4 후보
let handleIncomingMessage = null       // wsServer/wsClient 공용 메시지 핸들러
const peerPublicKeyMap = new Map()      // peerId → 공개키 객체
let discoveryEpoch = 0                  // 글로벌 세대 번호 — start-peer-discovery마다 증가
let isDiscoveryStarting = false         // start-peer-discovery 동시 실행 방지 플래그
const flushingPeers = new Set()         // flushPendingMessages 동시 호출 방지용 락
const peerConnectInFlightSet = new Set()            // peerId별 초기 연결 중복 시도 방지
const peerConnectRetryTimerMap = new Map()          // peerId -> background 재시도 타이머
const latestDiscoveredPeerInfoMap = new Map()       // peerId -> 마지막 mDNS 정보
const systemDefaultNickname = os.userInfo().username

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// 현재 닉네임 조회 — 프로필이 없거나 DB 초기화 전이면 OS 사용자명으로 폴백
function getCurrentNicknameSafely() {
  if (!database) return systemDefaultNickname
  return getProfile(database)?.nickname || systemDefaultNickname
}

function getMyAdvertisedAddresses() {
  if (localAddressCandidates.length > 0) return localAddressCandidates
  return localIP !== 'localhost' ? [localIP] : []
}

function buildMyKeyExchangePayload(currentPeerId, nickname) {
  return {
    type: 'key-exchange',
    fromId: currentPeerId,
    publicKey: myPublicKeyBase64,
    nickname,
    host: localIP,
    addresses: getMyAdvertisedAddresses(),
    wsPort: wsServerInfo?.port ?? 0,
    filePort: getFilePort(),
    profileImageUrl: buildMyProfileImageUrl(),
  }
}

function waitForMilliseconds(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

function clearPeerConnectRetry(peerIdToClear) {
  const retryTimer = peerConnectRetryTimerMap.get(peerIdToClear)
  if (retryTimer) {
    clearTimeout(retryTimer)
    peerConnectRetryTimerMap.delete(peerIdToClear)
  }
}

function clearAllPeerConnectRetryState() {
  peerConnectRetryTimerMap.forEach(retryTimer => clearTimeout(retryTimer))
  peerConnectRetryTimerMap.clear()
  peerConnectInFlightSet.clear()
  latestDiscoveredPeerInfoMap.clear()
}

function getInboundConnections() {
  if (!wsServerInfo) return []
  return getServerClientPeerIds(wsServerInfo)
}

function getConnectedPeerIds() {
  return [...new Set([...getConnections(), ...getInboundConnections()])]
}

function hasPeerConnection(targetPeerId) {
  return getConnectedPeerIds().includes(targetPeerId)
}

function sendPeerMessage(targetPeerId, message) {
  if (sendMessage(targetPeerId, message)) {
    writePeerDebugLog('main.sendPeerMessage.outbound', {
      targetPeerId,
      messageType: message?.type,
      messageId: message?.id || null,
    })
    return true
  }
  if (!wsServerInfo) {
    writePeerDebugLog('main.sendPeerMessage.failedNoServer', {
      targetPeerId,
      messageType: message?.type,
      messageId: message?.id || null,
    })
    return false
  }
  const sentViaInboundSocket = sendMessageToServerPeer(wsServerInfo, targetPeerId, message)
  writePeerDebugLog(sentViaInboundSocket ? 'main.sendPeerMessage.inbound' : 'main.sendPeerMessage.failed', {
    targetPeerId,
    messageType: message?.type,
    messageId: message?.id || null,
  })
  return sentViaInboundSocket
}

function broadcastPeerMessage(message) {
  getConnectedPeerIds().forEach((targetPeerId) => {
    sendPeerMessage(targetPeerId, message)
  })
}

// 안읽은 메시지 badge 증가 — Dock + 트레이
function incrementBadge() {
  unreadBadgeCount++
  // macOS Dock badge
  if (process.platform === 'darwin') {
    app.dock?.setBadge(String(unreadBadgeCount))
  }
  // 트레이 tooltip에 안읽은 수 표시
  if (tray) {
    tray.setToolTip(`LAN Chat (${unreadBadgeCount}개 안읽음)`)
  }
}

// badge 초기화 — 창 포커스 시 호출
function clearBadge() {
  unreadBadgeCount = 0
  if (process.platform === 'darwin') {
    app.dock?.setBadge('')
  }
  if (tray) {
    tray.setToolTip('LAN Chat')
  }
}

// 알림 표시 — 클릭 시 창 복원 + 해당 채팅방으로 이동
// navigateTo: { type: 'global' } 또는 { type: 'dm', peerId, nickname }
function showNotification(title, body, navigateTo) {
  if (!Notification.isSupported()) return
  // macOS: icon 생략 시 앱 아이콘만 오른쪽에 표시 (중복 방지)
  const notification = new Notification({ title, body: body?.slice(0, 100) || '' })
  notification.on('click', () => {
    clearBadge()
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
    if (navigateTo) {
      sendToRenderer('navigate-to-room', navigateTo)
    }
  })
  notification.show()
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

// 오프라인 메시지를 대상 피어에게 전송 (동시 호출 방지 락 적용)
// retryCount: 공개키 미도착 시 재시도 횟수 (최대 3회, 2초 간격)
async function flushPendingMessages(targetPeerId, retryCount = 0) {
  // 동일 피어에 대한 동시 flush 방지
  if (flushingPeers.has(targetPeerId)) return
  flushingPeers.add(targetPeerId)

  try {
    const pendingList = getPendingMessages(database, targetPeerId)
    if (pendingList.length === 0) return

    const recipientPublicKey = peerPublicKeyMap.get(targetPeerId)
    if (!recipientPublicKey) {
      // 공개키 미도착 — 일정 시간 후 재시도 (key-exchange 완료 대기)
      if (retryCount < 3) {
        setTimeout(() => {
          flushingPeers.delete(targetPeerId)
          flushPendingMessages(targetPeerId, retryCount + 1)
        }, 2000 * (retryCount + 1))
      }
      return
    }

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
          sharedSecret,
          peerId,
          targetPeerId
        )
        const message = {
          id: pending.id,
          type: 'dm',
          from: currentNickname,
          fromId: peerId,
          to: targetPeerId,
          content: null,
          contentType: messagePayload.contentType,
          format: messagePayload.format || null,
          encryptedPayload,
          fileUrl: null,
          fileName: null,
          timestamp: pending.created_at,
        }
        const sent = sendPeerMessage(targetPeerId, message)
        if (sent) {
          try { deletePendingMessage(database, pending.id) } catch { /* DB 삭제 실패 시 무시 */ }
          flushedMessageIds.push(pending.id)
        }
      } catch (err) {
        console.warn(`[flushPending] 메시지 전송 실패: ${pending.id}`, err.message)
      }
    }

    if (flushedMessageIds.length > 0) {
      sendToRenderer('pending-messages-flushed', { targetPeerId, messageIds: flushedMessageIds })
    }
  } finally {
    flushingPeers.delete(targetPeerId)
  }
}

// 파일 URL의 포트를 현재 파일 서버 포트로 재작성 (앱 재시작 후 포트 변경 대응)
// 예: http://192.168.0.1:54321/files/abc.png → http://192.168.0.1:현재포트/files/abc.png
function rewriteFileUrl(url) {
  if (!url || typeof url !== 'string') return url
  const fileUrlPattern = /^http:\/\/[^/]+\/files\//
  if (!fileUrlPattern.test(url)) return url
  const fileName = url.split('/files/')[1]
  if (!fileName) return url
  return `http://${localIP}:${getFilePort()}/files/${fileName}`
}

// 내 프로필 이미지 URL 생성
function buildMyProfileImageUrl() {
  const profile = getProfile(database)
  if (!profile?.profile_image) return null
  return `http://${localIP}:${getFilePort()}/profile/${profile.profile_image}`
}

// 수신된 파일을 로컬 캐시 디렉토리에 저장하고 DB에 경로 기록
function cacheReceivedFile(messageId, fileUrl, fileName) {
  if (!fileUrl || !fileName) return
  const cacheDir = path.join(appDataPath, 'file_cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const ext = path.extname(fileName)
  const cachedFileName = `${messageId}${ext}`
  const cachedPath = path.join(cacheDir, cachedFileName)

  const http = require('http')
  const file = fs.createWriteStream(cachedPath)
  http.get(fileUrl, (response) => {
    response.pipe(file)
    file.on('finish', () => {
      file.close()
      try { saveFileCache(database, { messageId, cachedPath }) } catch { /* DB 저장 실패 시 무시 */ }
    })
  }).on('error', () => {
    try { fs.unlinkSync(cachedPath) } catch { /* 파일 삭제 실패 시 무시 */ }
  })
}

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

  // 만료된 pending 메시지 자동 정리 (7일 이상)
  try { deleteExpiredPendingMessages(database) } catch { /* 정리 실패 시 무시 */ }

  // 업데이트 후 첫 실행 감지
  checkAndNotifyUpdated()

  // LAN IP 계산 (key-exchange 및 파일 서버용)
  localAddressCandidates = collectLocalIpv4Addresses(os.networkInterfaces())
  localIP = selectPrimaryLocalIpv4(os.networkInterfaces())
  writePeerDebugLog('main.network.localIpSelected', {
    localIP,
    localAddressCandidates,
    interfaces: os.networkInterfaces(),
  })

  // ECDH 키 쌍 로드 (최초 실행 시 자동 생성)
  const { privateKey, publicKey } = loadOrCreateKeyPair(appDataPath)
  myPrivateKey = privateKey
  myPublicKeyBase64 = exportPublicKey(publicKey)

  // 파일 서버 시작 (파일 + 프로필 이미지 제공)
  await startFileServer(tempFilePath, profileFolderPath)
  writePeerDebugLog('main.fileServer.started', {
    filePort: getFilePort(),
    tempFilePath,
    profileFolderPath,
  })

  // wsServer/wsClient 공용 메시지 핸들러
  // reply: wsServer에서 온 경우 상대 소켓으로 응답, wsClient에서 온 경우 no-op
  handleIncomingMessage = (message, reply) => {
    // DB가 초기화되지 않은 경우 메시지 수신 불가
    if (!database) return

    // 타이핑 이벤트 — DB 저장 없이 렌더러로 전달만
    if (message.type === 'typing') {
      sendToRenderer('typing-event', { fromId: message.fromId, from: message.from, to: message.to || null })
      return
    }

    // 상태 변경 이벤트 — DB 저장 없이 렌더러로 전달
    if (message.type === 'status-changed') {
      sendToRenderer('peer-status-changed', {
        peerId: message.fromId,
        statusType: message.statusType,
        statusMessage: message.statusMessage,
      })
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

    // 메시지 수정 이벤트 — DB 업데이트 후 렌더러로 전달
    if (message.type === 'edit-message') {
      try {
        editMessage(database, { messageId: message.messageId, fromId: message.fromId, newContent: message.newContent })
        sendToRenderer('message-edited', {
          messageId: message.messageId, fromId: message.fromId,
          newContent: message.newContent, editedAt: message.editedAt, to: message.to || null,
        })
      } catch { /* 무시 */ }
      return
    }

    // 읽음 확인 이벤트 — DB 업데이트 후 렌더러로 전달
    if (message.type === 'read-receipt') {
      try { markMessagesAsReadDB(database, message.messageIds) } catch { /* 무시 */ }
      sendToRenderer('read-receipt', { fromId: message.fromId, messageIds: message.messageIds })
      return
    }

    // 닉네임 변경 이벤트
    if (message.type === 'nickname-changed') {
      sendToRenderer('peer-nickname-changed', { peerId: message.fromId, nickname: message.nickname })
      return
    }

    // 이모지 리액션 처리 — DB 저장 후 렌더러로 전달
    if (message.type === 'reaction') {
      try {
        if (message.action === 'add') {
          addReaction(database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
        } else if (message.action === 'remove') {
          removeReaction(database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
        }
        sendToRenderer('reaction-updated', {
          messageId: message.messageId, peerId: message.fromId,
          emoji: message.emoji, action: message.action,
        })
      } catch { /* 무시 */ }
      return
    }

    // 키 교환 처리 — 내 키 즉시 reply + 역방향 연결 (mDNS 단방향 문제 해결)
    if (message.type === 'key-exchange') {
      try {
        const messageAdvertisedAddresses = normalizeAdvertisedAddresses(message.addresses)
        writePeerDebugLog('main.keyExchange.received', {
          fromId: message.fromId,
          host: message.host || null,
          addresses: messageAdvertisedAddresses,
          wsPort: message.wsPort || null,
          filePort: message.filePort || null,
          nickname: message.nickname || null,
          hasProfileImageUrl: message.profileImageUrl !== undefined,
        })
        clearPeerConnectRetry(message.fromId)
        peerConnectInFlightSet.delete(message.fromId)
        const publicKeyObj = importPublicKey(message.publicKey)
        // 상대 공개키 저장 (reply 성공/실패와 무관하게 항상 저장)
        peerPublicKeyMap.set(message.fromId, publicKeyObj)

        const currentNicknameForReply = getProfile(database)?.nickname || ''
        // reply 시도 — 실패해도 역방향 연결에서 key-exchange를 다시 교환하므로 계속 진행
        reply(buildMyKeyExchangePayload(peerId, currentNicknameForReply))
        writePeerDebugLog('main.keyExchange.replied', {
          toPeerId: message.fromId,
          host: localIP,
          addresses: getMyAdvertisedAddresses(),
          wsPort: wsServerInfo?.port ?? 0,
          filePort: getFilePort(),
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
          addresses: messageAdvertisedAddresses,
          advertisedAddresses: messageAdvertisedAddresses,
          ...(message.wsPort && { wsPort: message.wsPort }),
          filePort: message.filePort || 0,
          profileImageUrl: message.profileImageUrl || null,
        }
        latestDiscoveredPeerInfoMap.set(message.fromId, peerDiscoveredData)
        sendToRenderer('peer-discovered', peerDiscoveredData)

        // 역방향 연결 — 기존 연결이 없는 경우에만 (mDNS 단방향 문제 해결)
        // 좀비 소켓은 start-peer-discovery의 closeAllServerClients가 사전 정리
        const reverseConnectHostCandidates = buildPeerConnectHostCandidates({
          host: message.host,
          addresses: messageAdvertisedAddresses,
          advertisedAddresses: messageAdvertisedAddresses,
          wsPort: message.wsPort,
        })

        if (reverseConnectHostCandidates.length > 0 && message.wsPort && !hasPeerConnection(message.fromId)) {
          const epochAtReverse = discoveryEpoch
          writePeerDebugLog('main.keyExchange.reverseConnect.start', {
            peerId: message.fromId,
            reverseConnectHostCandidates,
            wsPort: message.wsPort,
            epochAtReverse,
          })
          const reverseConnectPromise = (async () => {
            for (const connectHost of reverseConnectHostCandidates) {
              try {
                writePeerDebugLog('main.keyExchange.reverseConnect.attempt', {
                  peerId: message.fromId,
                  connectHost,
                  wsPort: message.wsPort,
                  epochAtReverse,
                })
                await connectToPeer({
                  peerId: message.fromId,
                  host: connectHost,
                  wsPort: message.wsPort,
                  onMessage: handleIncomingMessage,
                  autoReconnect: true,
                  onReconnect: () => {
                    // 역방향 재연결 성공 후 key-exchange 재전송
                    if (epochAtReverse !== discoveryEpoch) return
                    const latestNickname = getCurrentNicknameSafely()
                    sendPeerMessage(message.fromId, buildMyKeyExchangePayload(peerId, latestNickname))
                  },
                  onClose: () => {
                    if (epochAtReverse !== discoveryEpoch) return
                    removePeerFromDiscovered(message.fromId)
                    if (!hasPeerConnection(message.fromId)) {
                      writePeerDebugLog('main.keyExchange.reverseConnect.closed', {
                        peerId: message.fromId,
                        epochAtReverse,
                      })
                      sendToRenderer('peer-left', message.fromId)
                    }
                  },
                })
                return connectHost
              } catch (error) {
                writePeerDebugLog('main.keyExchange.reverseConnect.attemptFailed', {
                  peerId: message.fromId,
                  connectHost,
                  wsPort: message.wsPort,
                  epochAtReverse,
                  error,
                })
              }
            }
            throw new Error(`역방향 연결 실패: ${message.fromId}`)
          })()

          reverseConnectPromise.then((connectedHost) => {
            writePeerDebugLog('main.keyExchange.reverseConnect.connected', {
              peerId: message.fromId,
              connectedHost,
              epochAtReverse,
            })
            // 역방향 연결 성공 후 epoch 재확인 — stale이면 폐기
            if (epochAtReverse !== discoveryEpoch) {
              disconnectFromPeer(message.fromId)
              return
            }
            flushPendingMessages(message.fromId)
          }).catch((error) => {
            writePeerDebugLog('main.keyExchange.reverseConnect.failed', {
              peerId: message.fromId,
              epochAtReverse,
              error,
            })
          })
        } else {
          // 이미 연결 중이거나 host/wsPort 없으면 즉시 flush
          writePeerDebugLog('main.keyExchange.reverseConnect.skipped', {
            peerId: message.fromId,
            reverseConnectHostCandidates,
            hasWsPort: !!message.wsPort,
            hasPeerConnection: hasPeerConnection(message.fromId),
          })
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
      if (!senderPublicKey) {
        // 공개키 없으면 암호문이라도 DB에 저장 (나중에 복호화 가능)
        console.warn(`[DM 수신] 공개키 없음 — fromId=${message.fromId}, 암호문 DB 저장`)
        try {
          saveMessage(database, {
            id: message.id, type: message.type,
            from_id: message.fromId, from_name: message.from || '알 수 없음',
            to_id: message.to, content: null,
            content_type: 'text', format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: null, file_name: null,
            timestamp: message.timestamp,
          })
        } catch { /* DB 저장 실패 */ }
        return
      }

      try {
        const sharedSecret = deriveSharedSecret(myPrivateKey, senderPublicKey)
        // message.fromId = 송신자, peerId = 나(수신자)
        const decryptedPayload = decryptDM(message.encryptedPayload, sharedSecret, message.fromId, peerId)

        try {
          saveMessage(database, {
            id: message.id,
            type: message.type,
            from_id: message.fromId,
            from_name: message.from,
            to_id: message.to,
            content: null,
            content_type: decryptedPayload.contentType,
            format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: decryptedPayload.fileUrl || null,
            file_name: decryptedPayload.fileName || null,
            timestamp: message.timestamp,
          })
        } catch (err) {
          console.error(`[DM 수신] DB 저장 실패: ${message.id}`, err.message)
        }

        if (mainWindow && !mainWindow.isFocused()) {
          incrementBadge()
          showNotification(
            `${message.from || '알 수 없음'} (DM)`,
            decryptedPayload.content || '파일을 보냈습니다.',
            { type: 'dm', peerId: message.fromId, nickname: message.from || '알 수 없음' }
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
        // DM 파일 메시지면 로컬 캐시에 저장
        if (decryptedPayload.fileUrl) cacheReceivedFile(message.id, decryptedPayload.fileUrl, decryptedPayload.fileName)
      } catch (err) {
        console.error(`[DM 수신] 복호화 실패: msgId=${message.id}, fromId=${message.fromId}`, err.message)
        // 복호화 실패해도 암호문은 DB에 저장 (나중에 재복호화 가능)
        try {
          saveMessage(database, {
            id: message.id, type: message.type,
            from_id: message.fromId, from_name: message.from || '알 수 없음',
            to_id: message.to, content: null,
            content_type: 'text', format: message.format || null,
            encrypted_payload: message.encryptedPayload,
            file_url: null, file_name: null,
            timestamp: message.timestamp,
          })
        } catch { /* DB 저장도 실패 */ }
      }
      return
    }

    // 전체채팅 메시지 (평문 저장) — DB 저장 실패 시에도 렌더러 전달은 계속
    try {
      saveMessage(database, {
        id: message.id,
        type: message.type,
        from_id: message.fromId,
        from_name: message.from,
        to_id: null,
        content: message.content || null,
        content_type: message.contentType,
        format: message.format || null,
        encrypted_payload: null,
        file_url: message.fileUrl || null,
        file_name: message.fileName || null,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 — 렌더러 전달은 계속 */ }

    if (mainWindow && !mainWindow.isFocused()) {
      incrementBadge()
      showNotification(
        message.from || '알 수 없음',
        message.content || '파일을 보냈습니다.',
        { type: 'global' }
      )
      playNotificationSound()
    }

    sendToRenderer('message-received', message)
    // 파일 메시지면 로컬 캐시에 저장
    if (message.fileUrl) cacheReceivedFile(message.id, message.fileUrl, message.fileName)
  }

  // WebSocket 서버 시작 (공용 핸들러 사용) — 고정 포트 범위 49152~49161 우선 시도
  wsServerInfo = await startWsServer({ onMessage: handleIncomingMessage })
  writePeerDebugLog('main.wsServer.ready', { wsPort: wsServerInfo.port })
}

// IPC 핸들러 등록
function registerIpcHandlers(currentPeerId, defaultNickname) {
  // 프로필 존재 여부 확인 (앱 시작 시 첫 화면 결정용)
  ipcMain.handle('check-profile-exists', () => {
    if (!database) return false
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
    if (wsServerInfo) closeAllServerClients(wsServerInfo)
    peerPublicKeyMap.clear()
    clearAllPeerConnectRetryState()
    discoveryEpoch++
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
    // wsServerInfo가 null이면 서버 초기화 실패 — 피어 탐색 불가
    if (!wsServerInfo) return
    // 동시 실행 방지 — React StrictMode 이중 호출 등으로 인한 race condition 차단
    if (isDiscoveryStarting) return
    isDiscoveryStarting = true
    try {
    writePeerDebugLog('main.discovery.startRequested', {
      currentPeerId,
      previousEpoch: discoveryEpoch,
      wsPort: wsServerInfo.port,
      filePort: getFilePort(),
    })
    await stopPeerDiscovery()
    disconnectAll()
    // 서버에 연결된 상대방의 클라이언트 소켓도 강제 종료 — 좀비 소켓 방지
    if (wsServerInfo) closeAllServerClients(wsServerInfo)
    peerPublicKeyMap.clear()
    clearAllPeerConnectRetryState()
    // 글로벌 세대 증가 — 이전 세대의 연결에서 발생하는 stale close/peer-left를 무시하기 위함
    discoveryEpoch++
    const currentEpoch = discoveryEpoch
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const INITIAL_CONNECT_MAX_RETRIES = 3
    const INITIAL_CONNECT_RETRY_DELAY = 700
    const INITIAL_CONNECT_TIMEOUT = 1500
    const BACKGROUND_CONNECT_RETRY_DELAY = 2500
    const HANDSHAKE_SWEEP_DELAY = 2000

    const scheduleBackgroundConnectRetry = (targetPeerId) => {
      if (currentEpoch !== discoveryEpoch) return
      if (peerConnectRetryTimerMap.has(targetPeerId)) return

      writePeerDebugLog('main.discovery.backgroundRetry.scheduled', {
        targetPeerId,
        currentEpoch,
        delayMs: BACKGROUND_CONNECT_RETRY_DELAY,
      })
      const retryTimer = setTimeout(() => {
        peerConnectRetryTimerMap.delete(targetPeerId)
        if (currentEpoch !== discoveryEpoch) return
        if (hasPeerConnection(targetPeerId)) return

        const latestPeerInfo = latestDiscoveredPeerInfoMap.get(targetPeerId)
        if (!latestPeerInfo) return
        writePeerDebugLog('main.discovery.backgroundRetry.run', {
          targetPeerId,
          currentEpoch,
          latestPeerInfo,
        })
        connectDiscoveredPeer(latestPeerInfo)
      }, BACKGROUND_CONNECT_RETRY_DELAY)

      if (retryTimer.unref) retryTimer.unref()
      peerConnectRetryTimerMap.set(targetPeerId, retryTimer)
    }

    const connectDiscoveredPeer = async (peerInfo) => {
      if (currentEpoch !== discoveryEpoch) return
      if (!peerInfo?.peerId) return
      writePeerDebugLog('main.discovery.connectPeer.start', {
        peerInfo,
        currentEpoch,
      })
      const peerWsPort = Number(peerInfo.wsPort)
      if (!Number.isInteger(peerWsPort) || peerWsPort <= 0) {
        removePeerFromDiscovered(peerInfo.peerId)
        scheduleBackgroundConnectRetry(peerInfo.peerId)
        return
      }
      if (hasPeerConnection(peerInfo.peerId)) {
        clearPeerConnectRetry(peerInfo.peerId)
        return
      }
      if (peerConnectInFlightSet.has(peerInfo.peerId)) return

      peerConnectInFlightSet.add(peerInfo.peerId)
      sendToRenderer('peer-connecting', peerInfo.peerId)
      try {
        const latestPeerInfo = latestDiscoveredPeerInfoMap.get(peerInfo.peerId) || peerInfo
        const connectHostCandidates = buildPeerConnectHostCandidates(latestPeerInfo)
        writePeerDebugLog('main.discovery.connectPeer.candidates', {
          peerId: peerInfo.peerId,
          currentEpoch,
          connectHostCandidates,
          latestPeerInfo,
        })
        if (connectHostCandidates.length === 0) {
          removePeerFromDiscovered(peerInfo.peerId)
          scheduleBackgroundConnectRetry(peerInfo.peerId)
          return
        }

        // 기존 autoReconnect 루프(구 포트) 취소 — mDNS 재발견 시 포트가 바뀌었을 수 있으므로
        // disconnectFromPeer는 connectingSet, reconnectTimerMap, reconnectOptionsMap을 모두 정리함
        disconnectFromPeer(peerInfo.peerId)

        let connectedHost = null

        // 라운드 단위 재시도: 각 라운드마다 모든 후보 host를 순회 시도
        for (let attempt = 0; attempt <= INITIAL_CONNECT_MAX_RETRIES; attempt++) {
          if (currentEpoch !== discoveryEpoch) return
          for (const connectHost of connectHostCandidates) {
            if (currentEpoch !== discoveryEpoch) return
            try {
              writePeerDebugLog('main.discovery.connectPeer.attempt', {
                peerId: peerInfo.peerId,
                connectHost,
                peerWsPort,
                attempt,
                currentEpoch,
              })
              await connectToPeer({
                peerId: peerInfo.peerId,
                host: connectHost,
                wsPort: peerWsPort,
                connectTimeoutMs: INITIAL_CONNECT_TIMEOUT,
                onMessage: handleIncomingMessage,
                autoReconnect: true,
                onReconnect: () => {
                  // 재연결 성공 후 key-exchange 재전송 (암호화 세션 복구)
                  if (currentEpoch !== discoveryEpoch) return
                  const latestNickname = getProfile(database)?.nickname || defaultNickname
                  sendPeerMessage(peerInfo.peerId, buildMyKeyExchangePayload(currentPeerId, latestNickname))
                },
                onClose: () => {
                  // 영구 실패 시에만 호출됨 (autoReconnect 최대 시도 초과)
                  if (currentEpoch !== discoveryEpoch) return
                  removePeerFromDiscovered(peerInfo.peerId)
                  if (!hasPeerConnection(peerInfo.peerId)) {
                    sendToRenderer('peer-left', peerInfo.peerId)
                    scheduleBackgroundConnectRetry(peerInfo.peerId)
                  }
                },
              })
              connectedHost = connectHost
              writePeerDebugLog('main.discovery.connectPeer.connected', {
                peerId: peerInfo.peerId,
                connectedHost,
                peerWsPort,
                attempt,
                currentEpoch,
              })
              break
            } catch (error) {
              writePeerDebugLog('main.discovery.connectPeer.failed', {
                peerId: peerInfo.peerId,
                connectHost,
                peerWsPort,
                attempt,
                currentEpoch,
                error,
              })
              // 같은 라운드의 다음 host 후보를 계속 시도
            }
          }

          // 연결 성공 시 재시도 루프 종료
          if (connectedHost) break

          // 마지막 라운드가 아니면 대기 후 다음 라운드 진행
          if (attempt < INITIAL_CONNECT_MAX_RETRIES) {
            await waitForMilliseconds(INITIAL_CONNECT_RETRY_DELAY * (attempt + 1))
          }
        }

        if (!connectedHost) {
          // mDNS 재발견이 오지 않는 환경을 대비해 background 재시도 스케줄링
          writePeerDebugLog('main.discovery.connectPeer.exhausted', {
            peerId: peerInfo.peerId,
            currentEpoch,
          })
          removePeerFromDiscovered(peerInfo.peerId)
          scheduleBackgroundConnectRetry(peerInfo.peerId)
          return
        }

        // 연결 성공 후 epoch 재확인 — 연결 중에 refresh가 발생했으면 stale 소켓 폐기
        if (currentEpoch !== discoveryEpoch) {
          disconnectFromPeer(peerInfo.peerId)
          return
        }

        clearPeerConnectRetry(peerInfo.peerId)
        // key-exchange에 내 접속 정보 + 프로필 이미지 포함
        sendPeerMessage(peerInfo.peerId, buildMyKeyExchangePayload(currentPeerId, getCurrentNicknameSafely()))
        writePeerDebugLog('main.discovery.keyExchange.sent', {
          peerId: peerInfo.peerId,
          connectedHost,
          currentEpoch,
        })
        sendToRenderer('peer-discovered', { ...latestPeerInfo, host: connectedHost })
      } finally {
        peerConnectInFlightSet.delete(peerInfo.peerId)
      }
    }

    startPeerDiscovery({
      nickname: currentNickname,
      peerId: currentPeerId,
      wsPort: wsServerInfo.port,
      filePort: getFilePort(),
      advertisedAddresses: getMyAdvertisedAddresses(),
      onPeerFound: async (peerInfo) => {
        latestDiscoveredPeerInfoMap.set(peerInfo.peerId, peerInfo)
        writePeerDebugLog('main.discovery.peerFound', { peerInfo, currentEpoch })
        await connectDiscoveredPeer(peerInfo)
      },
      onPeerLeft: (leftPeerId) => {
        // 현재 세대가 아니면 stale mDNS 이벤트 → 무시
        if (currentEpoch !== discoveryEpoch) return
        clearPeerConnectRetry(leftPeerId)
        peerConnectInFlightSet.delete(leftPeerId)
        latestDiscoveredPeerInfoMap.delete(leftPeerId)
        // active outbound connection이 있으면 peer-left를 보내지 않음
        if (!hasPeerConnection(leftPeerId)) {
          writePeerDebugLog('main.discovery.peerLeft', { leftPeerId, currentEpoch })
          sendToRenderer('peer-left', leftPeerId)
        }
      },
    })

    // handshake 보완 스윕 — 공개키 미교환 피어에게 key-exchange 재전송
    // outbound(내가 연결) + inbound(상대가 서버에 연결) 양쪽 모두 대상
    // mDNS 발견 후 key-exchange reply 유실, 또는 한쪽만 발견된 경우를 커버
    const sweepTimer = setTimeout(() => {
      if (currentEpoch !== discoveryEpoch) return
      // outbound 연결 + inbound 서버 클라이언트 합산 (중복 제거)
      const allPeerIds = getConnectedPeerIds()
      writePeerDebugLog('main.discovery.sweep', {
        currentEpoch,
        allPeerIds,
        peerPublicKeyPeerIds: [...peerPublicKeyMap.keys()],
      })
      const latestNickname = getProfile(database)?.nickname || defaultNickname
      for (const targetPeerId of allPeerIds) {
        if (!peerPublicKeyMap.has(targetPeerId)) {
          sendPeerMessage(targetPeerId, buildMyKeyExchangePayload(currentPeerId, latestNickname))
        }
      }
      // 공개키가 있지만 pending 메시지가 남아있는 피어 flush 재시도
      for (const targetPeerId of allPeerIds) {
        if (peerPublicKeyMap.has(targetPeerId)) {
          flushPendingMessages(targetPeerId)
        }
      }
    }, HANDSHAKE_SWEEP_DELAY)
    if (sweepTimer.unref) sweepTimer.unref()
    } finally {
      isDiscoveryStarting = false
    }
  })

  // 닉네임 변경
  ipcMain.handle('update-nickname', async (_, newNickname) => {
    if (!newNickname?.trim()) return { success: false, error: '닉네임을 입력해주세요.' }
    if (newNickname.trim().length > 30) return { success: false, error: '닉네임은 30자 이하여야 합니다.' }
    try {
      updateNickname(database, newNickname.trim())
      await republishService({
        nickname: newNickname.trim(),
        peerId: currentPeerId,
        wsPort: wsServerInfo?.port ?? 0,
        filePort: getFilePort(),
        advertisedAddresses: getMyAdvertisedAddresses(),
      })
      broadcastPeerMessage({
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

  // 허용 contentType/format 화이트리스트
  const ALLOWED_CONTENT_TYPES = ['text', 'image', 'video', 'file']
  const ALLOWED_FORMATS = [null, undefined, 'markdown']
  const MAX_CONTENT_LENGTH = 10000

  // 전체채팅 메시지 전송
  ipcMain.handle('send-global-message', (_, { content, contentType, fileUrl, fileName, format }) => {
    // 입력 검증
    if (content && content.length > MAX_CONTENT_LENGTH) return null
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null
    if (!ALLOWED_FORMATS.includes(format)) format = null
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const message = {
      id: uuidv4(),
      type: 'message',
      from: currentNickname,
      fromId: currentPeerId,
      to: null,
      content: content || null,
      contentType,
      format: format || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
    }
    broadcastPeerMessage(message)
    // 내 메시지도 로컬 저장 — 저장 실패 시에도 메시지 반환은 계속
    try {
      saveMessage(database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: null, content: message.content,
        content_type: message.contentType, format: message.format,
        encrypted_payload: null,
        file_url: message.fileUrl, file_name: message.fileName,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 */ }
    return message
  })

  // DM 전송 (E2E 암호화, 오프라인이면 pending 큐에 저장)
  ipcMain.handle('send-dm', (_, { recipientPeerId, content, contentType, fileUrl, fileName, format }) => {
    // 입력 검증
    if (content && content.length > MAX_CONTENT_LENGTH) return null
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null
    if (!ALLOWED_FORMATS.includes(format)) format = null
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const messageId = uuidv4()
    const timestamp = Date.now()

    const recipientPublicKey = peerPublicKeyMap.get(recipientPeerId)
    if (!recipientPublicKey) {
      // 오프라인 — 평문으로 pending 큐에 저장
      savePendingMessage(database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
      // messages 테이블에 평문으로 저장 (히스토리 표시용)
      saveMessage(database, {
        id: messageId, type: 'dm',
        from_id: currentPeerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
      })
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: currentPeerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
      }
    }

    let encryptedPayload
    try {
      const sharedSecret = deriveSharedSecret(myPrivateKey, recipientPublicKey)
      // currentPeerId = 나(송신자), recipientPeerId = 수신자
      encryptedPayload = encryptDM(
        { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
        sharedSecret,
        currentPeerId,
        recipientPeerId
      )
    } catch {
      // 암호화 실패 시 pending 큐에 저장 후 반환
      savePendingMessage(database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
      saveMessage(database, {
        id: messageId, type: 'dm',
        from_id: currentPeerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
      })
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: currentPeerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
      }
    }

    const message = {
      id: messageId, type: 'dm', from: currentNickname, fromId: currentPeerId,
      to: recipientPeerId, content: null, contentType, format: format || null, encryptedPayload,
      fileUrl: null, fileName: null, timestamp,
    }

    const sent = sendPeerMessage(recipientPeerId, message)

    if (!sent) {
      // 소켓은 있지만 연결 끊긴 경우 → pending 저장
      savePendingMessage(database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null },
        originalTimestamp: timestamp,
      })
    }

    // 내 DB에는 암호문 저장
    try {
      saveMessage(database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: message.to, content: null,
        content_type: contentType, format: format || null, encrypted_payload: encryptedPayload,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp: message.timestamp,
      })
    } catch { /* DB 저장 실패 시 무시 */ }

    // 렌더러에는 복호화된 내용으로 반환
    return {
      ...message, content: content || null, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null,
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
      sendPeerMessage(targetPeerId, typingMessage)
    } else {
      broadcastPeerMessage(typingMessage)
    }
  })

  // 안읽은 DM 메시지 ID 조회 (제한 없음)
  ipcMain.handle('get-unread-dm-ids', (_, senderPeerId) => {
    return getUnreadDMMessageIds(database, currentPeerId, senderPeerId)
  })

  // 읽음 확인 전송 — 전송 성공 시에만 로컬 DB 업데이트 (실패 시 재진입 때 재전송 가능)
  ipcMain.handle('send-read-receipt', (_, { targetPeerId, messageIds }) => {
    if (!targetPeerId || !messageIds?.length) return
    // 배열 크기 제한 — SQL 쿼리 부하 방지
    if (messageIds.length > 500) return
    const sent = sendPeerMessage(targetPeerId, {
      type: 'read-receipt',
      fromId: currentPeerId,
      messageIds,
      timestamp: Date.now(),
    })
    // 전송 성공 시에만 로컬 DB 읽음 처리 — 실패 시 재진입 때 재전송 가능
    if (sent) {
      try { markMessagesAsReadDB(database, messageIds) } catch { /* 무시 */ }
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
      sendPeerMessage(targetPeerId, deletePayload)
    } else {
      broadcastPeerMessage(deletePayload)
    }
  })


  // 메시지 수정 — 본인 메시지만 수정 가능, 내용 길이 검증 후 브로드캐스트
  ipcMain.handle('edit-message', (_, { messageId, newContent, targetPeerId }) => {
    if (!newContent?.trim() || newContent.length > MAX_CONTENT_LENGTH) return null
    const editedAt = Date.now()
    editMessage(database, { messageId, fromId: currentPeerId, newContent })
    const currentNickname = getProfile(database)?.nickname || defaultNickname
    const editPayload = {
      type: 'edit-message', messageId, fromId: currentPeerId, from: currentNickname,
      newContent, editedAt, to: targetPeerId || null, timestamp: Date.now(),
    }
    if (targetPeerId) sendPeerMessage(targetPeerId, editPayload)
    else broadcastPeerMessage(editPayload)
    return { editedAt }
  })

  // 상태 변경 — 허용된 타입만 저장 후 브로드캐스트
  ipcMain.handle('update-status', (_, { statusType, statusMessage }) => {
    const allowedTypes = ['online', 'away', 'busy', 'dnd']
    if (!allowedTypes.includes(statusType)) return
    updateStatus(database, { statusType, statusMessage: (statusMessage || '').slice(0, 100) })
    broadcastPeerMessage({
      type: 'status-changed', fromId: currentPeerId,
      statusType, statusMessage: statusMessage || '', timestamp: Date.now(),
    })
  })

  // 채팅 기록 조회
  ipcMain.handle('get-global-history', (_, params) => {
    const limit = params?.limit || 100
    const offset = params?.offset || 0
    const history = getGlobalHistory(database, limit, offset)
    return history.map(msg => ({
      ...msg,
      file_url: rewriteFileUrl(msg.file_url),
    }))
  })
  ipcMain.handle('get-dm-history', (_, { peerId1, peerId2, limit, offset }) => {
    const history = getDMHistory(database, peerId1, peerId2, limit || 100, offset || 0)
    // peerId1 = 나, peerId2 = 상대방
    const otherPublicKey = peerPublicKeyMap.get(peerId2)

    return history.map(msg => {
      // DB의 read (0/1) → boolean 변환
      const readFlag = !!msg.read
      if (msg.encrypted_payload && otherPublicKey) {
        try {
          const sharedSecret = deriveSharedSecret(myPrivateKey, otherPublicKey)
          let decryptedPayload

          // 송신자/수신자 peerId를 정확하게 전달 (HKDF 키 도출에 사용)
          const senderIdForDecrypt = msg.from_id
          const recipientIdForDecrypt = msg.from_id === peerId1 ? peerId2 : peerId1
          try {
            decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret, senderIdForDecrypt, recipientIdForDecrypt)
          } catch {
            // 신규 방식 실패 → 레거시(peerId 없는) 방식으로 재시도 (업데이트 전 메시지 호환)
            try {
              decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret)
            } catch (err) {
              console.warn(`[히스토리] 복호화 실패: msgId=${msg.id}`, err.message)
              return { ...msg, read: readFlag, content: null, decryptionFailed: true }
            }
          }

          return {
            ...msg,
            read: readFlag,
            content: decryptedPayload.content,
            contentType: decryptedPayload.contentType || msg.content_type,
            fileUrl: rewriteFileUrl(decryptedPayload.fileUrl || msg.file_url),
            fileName: decryptedPayload.fileName || msg.file_name,
          }
        } catch (err) {
          console.warn(`[히스토리] sharedSecret 도출 실패: msgId=${msg.id}`, err.message)
        }
      }
      return { ...msg, read: readFlag, file_url: rewriteFileUrl(msg.file_url) }
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

  // 메시지 전문 검색 (FTS5)
  ipcMain.handle('search-messages', (_, { query, type }) => {
    const results = searchMessages(database, { query, type })
    return results.map(msg => ({ ...msg, file_url: rewriteFileUrl(msg.file_url) }))
  })

  // 캐시된 파일 URL 반환 — 캐시 파일이 존재하면 file:// URL, 없으면 null
  ipcMain.handle('get-cached-file-url', (_, messageId) => {
    const cachedPath = getFileCache(database, messageId)
    if (cachedPath && fs.existsSync(cachedPath)) return `file://${cachedPath}`
    return null
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
    const result = updatePassword(database, profile.username, currentPassword, newPassword)
    // 비밀번호 변경 성공 시 자동 로그인 세션 무효화
    if (result.success) clearLastLogin(database)
    return result
  })

  // 파일 임시 저장 후 URL 반환
  // 주의: Electron IPC에서 ArrayBuffer는 Uint8Array로 전달해야 안전하게 직렬화됨
  ipcMain.handle('save-file', (_, { fileBuffer, fileName }) => {
    try {
      const ext = path.extname(fileName)
      const savedFileName = `${uuidv4()}${ext}`
      const savePath = path.join(tempFilePath, savedFileName)
      fs.writeFileSync(savePath, Buffer.from(new Uint8Array(fileBuffer)))
      return `http://${localIP}:${getFilePort()}/files/${savedFileName}`
    } catch {
      return null
    }
  })

  // 이모지 리액션 토글 — 이미 존재하면 제거, 없으면 추가
  ipcMain.handle('toggle-reaction', (_, { messageId, emoji, targetPeerId }) => {
    const existing = getReactions(database, messageId)
      .find(r => r.peer_id === currentPeerId && r.emoji === emoji)
    const action = existing ? 'remove' : 'add'
    if (action === 'add') addReaction(database, { messageId, peerId: currentPeerId, emoji })
    else removeReaction(database, { messageId, peerId: currentPeerId, emoji })

    const reactionMessage = {
      type: 'reaction', messageId, fromId: currentPeerId, emoji, action, timestamp: Date.now(),
    }
    if (targetPeerId) sendPeerMessage(targetPeerId, reactionMessage)
    else broadcastPeerMessage(reactionMessage)
    return { action }
  })

  // 여러 메시지의 리액션 일괄 조회 — { messageId: [row, ...] } 형태 반환
  ipcMain.handle('get-reactions', (_, messageIds) => {
    return getReactionsByMessageIds(database, messageIds)
  })
}

async function createWindow() {
  // DB 먼저 초기화 (peerId 복원을 위해)
  database = initDatabase(dbPath)
  try { migrateDatabase(database) } catch { /* 마이그레이션 부분 실패는 무시 — DB 자체는 유효 */ }

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
      // preload에서 require('electron')을 사용하므로 sandbox를 명시적으로 비활성화
      // Electron 20+ 에서 기본값이 false이지만 명시적으로 선언해 패키징 환경에서의 불일치 방지
      sandbox: false,
    },
  })

  // 닫기 버튼 클릭 시 종료 대신 숨김 (트레이로 최소화)
  // Dock 아이콘은 유지 — Discord/Slack 방식 (background agent 문제 방지)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // 창 포커스 시 badge 초기화
  mainWindow.on('focus', () => {
    clearBadge()
  })

  // 시스템 트레이 설정
  const trayIconPath = isDev
    ? path.join(__dirname, '../logo.png')
    : path.join(process.resourcesPath, 'logo.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('LAN Chat')

  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'LAN Chat 열기',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(trayMenu)

  // Windows/Linux: 트레이 아이콘 클릭으로 창 복원 (macOS는 컨텍스트 메뉴만 지원)
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
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
              if (mainWindow && !isQuitting) {
                mainWindow.hide()
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

// 링크 프리뷰 OG 메타데이터 추출 — 메인 프로세스에서 fetch (CORS 제한 없음)
ipcMain.handle('fetch-link-preview', async (_, url) => {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(5000),
    })
    const html = await response.text()
    // og 태그에서 content 속성이 property 앞/뒤 어디에 있든 매칭
    const getOgContent = (property) => {
      const regex = new RegExp(
        `<meta[^>]*(?:property=["']og:${property}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*property=["']og:${property}["'])`,
        'i'
      )
      const match = html.match(regex)
      return match?.[1] || match?.[2] || null
    }
    const title = getOgContent('title')
      || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      || null
    const description = getOgContent('description')
    const image = getOgContent('image')
    // 제목조차 없으면 프리뷰 불가
    if (!title) return null
    return { title, description, image, url }
  } catch {
    return null
  }
})

// 외부 링크 IPC 핸들러 — http/https URL만 OS 기본 브라우저로 열기
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url)
  }
})

// 이미지 클립보드 복사 — URL 또는 로컬 파일 경로의 이미지를 클립보드에 복사
ipcMain.handle('copy-image-to-clipboard', async (_, imageUrl) => {
  const { clipboard } = require('electron')
  try {
    let image
    if (/^https?:\/\//i.test(imageUrl)) {
      const { net } = require('electron')
      const buffer = await new Promise((resolve, reject) => {
        const request = net.request(imageUrl)
        const chunks = []
        request.on('response', (response) => {
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => resolve(Buffer.concat(chunks)))
          response.on('error', reject)
        })
        request.on('error', reject)
        request.end()
      })
      image = nativeImage.createFromBuffer(buffer)
    } else {
      // 로컬 파일 경로
      const filePath = imageUrl.startsWith('file://') ? imageUrl.replace('file://', '') : imageUrl
      image = nativeImage.createFromPath(decodeURIComponent(filePath))
    }
    if (image.isEmpty()) return false
    clipboard.writeImage(image)
    return true
  } catch {
    return false
  }
})

// 패치노트 조회 — 전체 changelog 반환
ipcMain.handle('get-changelog', () => loadChangelog())

// 앱 버전 + 업데이트 여부 조회 — 일회성 소비 (재로그인 시 중복 표시 방지)
ipcMain.handle('get-app-version-info', () => {
  const result = {
    currentVersion: app.getVersion(),
    updatedFromVersion,
  }
  updatedFromVersion = null
  return result
})

// 업데이트 확인 IPC 핸들러 — dev에서는 즉시 not-available 반환
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    sendToRenderer('update-not-available')
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // app-update.yml 누락 등 업데이트 확인 실패 시 에러 이벤트 전달
    console.error('[autoUpdater] 업데이트 확인 실패:', error.message)
    sendToRenderer('update-error', error.message || '업데이트 확인 실패')
  }
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
      // UUID로 고유 경로 생성 — symlink 공격 방지
      const updateId = uuidv4()
      const tempDir = path.join(os.tmpdir(), `lan-chat-update-${updateId}`)
      const scriptPath = path.join(os.tmpdir(), `lan-chat-update-${updateId}.sh`)

      const script = [
        '#!/bin/bash',
        'sleep 2',
        `TEMP_DIR="${tempDir}"`,
        `mkdir -p "$TEMP_DIR"`,
        `unzip -o "${downloadedUpdateFile}" -d "$TEMP_DIR"`,
        `APP=$(find "$TEMP_DIR" -name "*.app" | head -1)`,
        `if [ -n "$APP" ]; then`,
        // 기존 앱 백업 — 실패 시 롤백용
        `  BACKUP="${appBundlePath}.backup"`,
        `  cp -R "${appBundlePath}" "$BACKUP" 2>/dev/null`,
        `  rm -rf "${appBundlePath}"`,
        `  if ditto "$APP" "${appBundlePath}"; then`,
        `    rm -rf "$BACKUP"`,
        `    rm -f "${downloadedUpdateFile}"`,
        `    open "${appBundlePath}"`,
        `  else`,
        // 업데이트 실패 시 백업 복원
        `    rm -rf "${appBundlePath}"`,
        `    mv "$BACKUP" "${appBundlePath}" 2>/dev/null`,
        `    open "${appBundlePath}"`,
        `  fi`,
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
  // cleanup 완료 후에만 isQuitting = true — 조기 설정 시 close 핸들러가 숨김 대신 종료를 허용하는 문제 방지
  if (hasCleanedUp) {
    isQuitting = true
    return
  }
  event.preventDefault()
  performCleanup().then(() => app.quit())
})

app.on('window-all-closed', () => {
  // 트레이 모드에서는 종료하지 않음 — Cmd+Q 또는 트레이 메뉴에서만 종료
  if (!isQuitting) return
  app.quit()
})

// macOS: Dock 클릭, Spotlight 재실행 등 표준 재활성화 시 숨긴 창 다시 표시
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})
