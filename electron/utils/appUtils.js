// electron/utils/appUtils.js
// main.js에서 분리된 유틸리티 함수 모음
// 모든 함수는 ctx(AppContext) 파라미터를 받아 전역 변수 의존성을 해소

const { app, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { getProfile } = require('../storage/profile')
const { saveFileCache } = require('../storage/queries')
const { getPendingMessages, deletePendingMessage } = require('../storage/pendingMessages')
const { deriveSharedSecret, encryptDM } = require('../crypto/encryption')
const { getFilePort } = require('../peer/fileServer')
const { sendMessage, getConnections, disconnectFromPeer } = require('../peer/wsClient')
const { getServerClientPeerIds, sendMessageToServerPeer } = require('../peer/wsServer')
const { writePeerDebugLog } = require('./peerDebugLogger')

const systemDefaultNickname = os.userInfo().username

// 렌더러 프로세스로 메시지 전송
function sendToRenderer(ctx, channel, data) {
  const { mainWindow } = ctx.state
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// 현재 닉네임 안전하게 조회 — DB 초기화 전이거나 프로필 없으면 OS 사용자명으로 폴백
function getCurrentNicknameSafely(ctx) {
  if (!ctx.state.database) return systemDefaultNickname
  return getProfile(ctx.state.database)?.nickname || systemDefaultNickname
}

// 내가 광고할 주소 목록 반환
function getMyAdvertisedAddresses(ctx) {
  if (ctx.state.localAddressCandidates.length > 0) return ctx.state.localAddressCandidates
  return ctx.state.localIP !== 'localhost' ? [ctx.state.localIP] : []
}

// key-exchange 페이로드 생성
function buildMyKeyExchangePayload(ctx, currentPeerId, nickname) {
  return {
    type: 'key-exchange',
    fromId: currentPeerId,
    publicKey: ctx.state.myPublicKeyBase64,
    nickname,
    host: ctx.state.localIP,
    addresses: getMyAdvertisedAddresses(ctx),
    wsPort: ctx.state.wsServerInfo?.port ?? 0,
    filePort: getFilePort(),
    profileImageUrl: buildMyProfileImageUrl(ctx),
  }
}

// 지정된 밀리초만큼 대기
function waitForMilliseconds(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

// 특정 피어의 재연결 타이머를 취소
function clearPeerConnectRetry(ctx, peerIdToClear) {
  const retryTimer = ctx.state.peerConnectRetryTimerMap.get(peerIdToClear)
  if (retryTimer) {
    clearTimeout(retryTimer)
    ctx.state.peerConnectRetryTimerMap.delete(peerIdToClear)
  }
}

// 모든 피어의 재연결 상태를 초기화 (로그아웃/재시작 시 사용)
function clearAllPeerConnectRetryState(ctx) {
  ctx.state.peerConnectRetryTimerMap.forEach(retryTimer => clearTimeout(retryTimer))
  ctx.state.peerConnectRetryTimerMap.clear()
  ctx.state.peerConnectInFlightSet.clear()
  ctx.state.latestDiscoveredPeerInfoMap.clear()
}

// 서버에 연결된 인바운드 피어 ID 목록 반환
function getInboundConnections(ctx) {
  if (!ctx.state.wsServerInfo) return []
  return getServerClientPeerIds(ctx.state.wsServerInfo)
}

// 연결된 모든 피어 ID 목록 반환 (아웃바운드 + 인바운드, 중복 제거)
function getConnectedPeerIds(ctx) {
  return [...new Set([...getConnections(), ...getInboundConnections(ctx)])]
}

// 특정 피어와 연결 중인지 확인
function hasPeerConnection(ctx, targetPeerId) {
  return getConnectedPeerIds(ctx).includes(targetPeerId)
}

// 특정 피어에게 메시지 전송 (아웃바운드 우선, 실패 시 인바운드 소켓 사용)
function sendPeerMessage(ctx, targetPeerId, messageObj) {
  if (sendMessage(targetPeerId, messageObj)) {
    writePeerDebugLog('main.sendPeerMessage.outbound', {
      targetPeerId,
      messageType: messageObj?.type,
      messageId: messageObj?.id || null,
    })
    return true
  }
  if (!ctx.state.wsServerInfo) {
    writePeerDebugLog('main.sendPeerMessage.failedNoServer', {
      targetPeerId,
      messageType: messageObj?.type,
      messageId: messageObj?.id || null,
    })
    return false
  }
  const sentViaInboundSocket = sendMessageToServerPeer(ctx.state.wsServerInfo, targetPeerId, messageObj)
  writePeerDebugLog(sentViaInboundSocket ? 'main.sendPeerMessage.inbound' : 'main.sendPeerMessage.failed', {
    targetPeerId,
    messageType: messageObj?.type,
    messageId: messageObj?.id || null,
  })
  return sentViaInboundSocket
}

// 연결된 모든 피어에게 메시지 브로드캐스트
function broadcastPeerMessage(ctx, messageObj) {
  getConnectedPeerIds(ctx).forEach((targetPeerId) => {
    sendPeerMessage(ctx, targetPeerId, messageObj)
  })
}

// 안읽은 메시지 badge 증가 — Dock + 트레이
function incrementBadge(ctx) {
  ctx.state.unreadBadgeCount++
  if (process.platform === 'darwin') {
    app.dock?.setBadge(String(ctx.state.unreadBadgeCount))
  }
  if (ctx.state.tray) {
    ctx.state.tray.setToolTip(`LAN Chat (${ctx.state.unreadBadgeCount}개 안읽음)`)
  }
}

// badge 초기화 — 창 포커스 시 호출
function clearBadge(ctx) {
  ctx.state.unreadBadgeCount = 0
  if (process.platform === 'darwin') {
    app.dock?.setBadge('')
  }
  if (ctx.state.tray) {
    ctx.state.tray.setToolTip('LAN Chat')
  }
}

// 알림 표시 — 클릭 시 창 복원 + 해당 채팅방으로 이동
// navigateTo: { type: 'global' } 또는 { type: 'dm', peerId, nickname }
function showNotification(ctx, title, body, navigateTo) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body: body?.slice(0, 100) || '' })
  notification.on('click', () => {
    clearBadge(ctx)
    if (ctx.state.mainWindow) {
      ctx.state.mainWindow.show()
      ctx.state.mainWindow.focus()
    }
    if (navigateTo) {
      sendToRenderer(ctx, 'navigate-to-room', navigateTo)
    }
  })
  notification.show()
}

// 창이 비활성화 상태일 때 렌더러에 소리 재생 요청
function playNotificationSound(ctx) {
  if (ctx.state.mainWindow && !ctx.state.mainWindow.isDestroyed() && !ctx.state.mainWindow.isFocused()) {
    sendToRenderer(ctx, 'play-notification-sound')
  }
}

// 업데이트 후 첫 실행 감지 — 이전 버전과 현재 버전 비교
function checkAndNotifyUpdated(ctx) {
  if (ctx.config.isDev) return
  const versionFilePath = path.join(ctx.config.appDataPath, 'last-version.json')
  const currentVersion = app.getVersion()
  try {
    const stored = fs.existsSync(versionFilePath)
      ? JSON.parse(fs.readFileSync(versionFilePath, 'utf8'))
      : null
    if (stored && stored.version !== currentVersion) {
      ctx.state.updatedFromVersion = stored.version
      showNotification(ctx, 'LAN Chat 업데이트 완료', `v${stored.version} → v${currentVersion}`)
    }
    fs.writeFileSync(versionFilePath, JSON.stringify({ version: currentVersion }))
  } catch { /* 무시 */ }
}

// CHANGELOG.json 로드
function loadChangelog(ctx) {
  try {
    const changelogPath = ctx.config.isDev
      ? path.join(ctx.config.appRootDir, 'CHANGELOG.json')
      : path.join(process.resourcesPath, 'CHANGELOG.json')
    return JSON.parse(fs.readFileSync(changelogPath, 'utf8'))
  } catch { return [] }
}

// 오프라인 메시지를 대상 피어에게 전송 (동시 호출 방지 락 적용)
// retryCount: 공개키 미도착 시 재시도 횟수 (최대 3회, 2초 간격)
async function flushPendingMessages(ctx, targetPeerId, retryCount = 0) {
  // 동일 피어에 대한 동시 flush 방지
  if (ctx.state.flushingPeers.has(targetPeerId)) return
  ctx.state.flushingPeers.add(targetPeerId)

  try {
    const pendingList = getPendingMessages(ctx.state.database, targetPeerId)
    if (pendingList.length === 0) return

    const recipientPublicKey = ctx.state.peerPublicKeyMap.get(targetPeerId)
    if (!recipientPublicKey) {
      // 공개키 미도착 — 일정 시간 후 재시도 (key-exchange 완료 대기)
      if (retryCount < 3) {
        setTimeout(() => {
          ctx.state.flushingPeers.delete(targetPeerId)
          flushPendingMessages(ctx, targetPeerId, retryCount + 1)
        }, 2000 * (retryCount + 1))
      }
      return
    }

    const currentNickname = getProfile(ctx.state.database)?.nickname || ''
    const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, recipientPublicKey)
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
          ctx.state.peerId,
          targetPeerId
        )
        const message = {
          id: pending.id,
          type: 'dm',
          from: currentNickname,
          fromId: ctx.state.peerId,
          to: targetPeerId,
          content: null,
          contentType: messagePayload.contentType,
          format: messagePayload.format || null,
          encryptedPayload,
          fileUrl: null,
          fileName: null,
          timestamp: pending.created_at,
        }
        const sent = sendPeerMessage(ctx, targetPeerId, message)
        if (sent) {
          try { deletePendingMessage(ctx.state.database, pending.id) } catch { /* DB 삭제 실패 시 무시 */ }
          flushedMessageIds.push(pending.id)
        }
      } catch (err) {
        console.warn(`[flushPending] 메시지 전송 실패: ${pending.id}`, err.message)
      }
    }

    if (flushedMessageIds.length > 0) {
      sendToRenderer(ctx, 'pending-messages-flushed', { targetPeerId, messageIds: flushedMessageIds })
    }
  } finally {
    ctx.state.flushingPeers.delete(targetPeerId)
  }
}

// 파일 URL의 포트를 현재 파일 서버 포트로 재작성 (앱 재시작 후 포트 변경 대응)
function rewriteFileUrl(ctx, url) {
  if (!url || typeof url !== 'string') return url
  const fileUrlPattern = /^http:\/\/[^/]+\/files\//
  if (!fileUrlPattern.test(url)) return url
  const fileName = url.split('/files/')[1]
  if (!fileName) return url
  return `http://${ctx.state.localIP}:${getFilePort()}/files/${fileName}`
}

// 내 프로필 이미지 URL 생성
function buildMyProfileImageUrl(ctx) {
  const profile = getProfile(ctx.state.database)
  if (!profile?.profile_image) return null
  return `http://${ctx.state.localIP}:${getFilePort()}/profile/${profile.profile_image}`
}

// 수신된 파일을 로컬 캐시에 저장 — HTTP 실패 시 WebSocket으로 fallback
function cacheReceivedFile(ctx, messageId, fileUrl, fileName, fromId) {
  if (!fileUrl || !fileName) return
  const cacheDir = path.join(ctx.config.appDataPath, 'file_cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const ext = path.extname(fileName)
  const cachedFileName = `${messageId}${ext}`
  const cachedPath = path.join(cacheDir, cachedFileName)

  // 이미 캐시됐으면 스킵
  if (fs.existsSync(cachedPath)) {
    try { saveFileCache(ctx.state.database, { messageId, cachedPath }) } catch {}
    return
  }

  const http = require('http')
  const file = fs.createWriteStream(cachedPath)
  http.get(fileUrl, (response) => {
    if (response.statusCode !== 200) {
      file.close()
      try { fs.unlinkSync(cachedPath) } catch {}
      // HTTP 실패 → WebSocket으로 파일 요청
      requestFileViaWebSocket(ctx, messageId, fileName, fromId)
      return
    }
    response.pipe(file)
    file.on('finish', () => {
      file.close()
      try { saveFileCache(ctx.state.database, { messageId, cachedPath }) } catch {}
      sendToRenderer(ctx, 'file-cached', { messageId, cachedPath })
    })
  }).on('error', () => {
    file.close()
    try { fs.unlinkSync(cachedPath) } catch {}
    // HTTP 오류 → WebSocket으로 파일 요청 (AP isolation 대응)
    requestFileViaWebSocket(ctx, messageId, fileName, fromId)
  })
}

// WebSocket을 통해 파일 전송 요청 — HTTP가 막힌 네트워크 환경용
function requestFileViaWebSocket(ctx, messageId, fileName, fromId) {
  if (!fromId) return
  writePeerDebugLog('main.fileTransfer.request', { messageId, fileName, fromId })
  sendPeerMessage(ctx, fromId, {
    type: 'file-request',
    fromId: ctx.state.peerId,
    messageId,
    fileName,
  })
}

module.exports = {
  sendToRenderer,
  getCurrentNicknameSafely,
  getMyAdvertisedAddresses,
  buildMyKeyExchangePayload,
  waitForMilliseconds,
  clearPeerConnectRetry,
  clearAllPeerConnectRetryState,
  getInboundConnections,
  getConnectedPeerIds,
  hasPeerConnection,
  sendPeerMessage,
  broadcastPeerMessage,
  incrementBadge,
  clearBadge,
  showNotification,
  playNotificationSound,
  checkAndNotifyUpdated,
  loadChangelog,
  flushPendingMessages,
  rewriteFileUrl,
  buildMyProfileImageUrl,
  cacheReceivedFile,
  requestFileViaWebSocket,
}
