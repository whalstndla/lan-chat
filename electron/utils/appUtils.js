// electron/utils/appUtils.js
// main.js에서 분리된 유틸리티 함수 모음
// 모든 함수는 ctx(AppContext) 파라미터를 받아 전역 변수 의존성을 해소

const { app, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { getProfile } = require('../storage/profile')
const { saveFileCache, getFileCache, deleteMessage, getLatestGlobalMessageTimestamp } = require('../storage/queries')
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

// Phase 1c: v2 hello 페이로드 생성 (wire.buildHello 래핑).
// 기존 buildMyKeyExchangePayload 는 v0.8.0 부터 v2 hello 를 반환 —
// 호환성을 위해 이름은 유지하지만 내부적으로 v2 포맷으로 송신.
const { buildHello, negotiateCapabilities } = require('../peer/wire')

function buildMyHelloPayload(ctx, currentPeerId, nickname) {
  return buildHello({
    peerId: currentPeerId,
    sessionId: ctx.state.mySessionId,
    publicKey: ctx.state.myPublicKeyBase64,
    nickname,
    wsPort: ctx.state.wsServerInfo?.port ?? 0,
    filePort: getFilePort(),
    addresses: getMyAdvertisedAddresses(ctx),
    profileImageUrl: buildMyProfileImageUrl(ctx),
    lanpetSharingEnabled: require('../lanpet/protocol').isLanpetSharingEnabled(ctx),
  })
}

// 레거시 이름 — 기존 호출처 호환. 송신은 v2 hello 로 전환됨.
function buildMyKeyExchangePayload(ctx, currentPeerId, nickname) {
  return buildMyHelloPayload(ctx, currentPeerId, nickname)
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
  // PeerManager 도 함께 초기화 (Phase 1c 권한 이양)
  if (ctx.state.peerManager) ctx.state.peerManager.clear()
}

// Phase 1c: 권한 이양 조회기 — PeerManager 우선, 없으면 레거시 맵 폴백.
function getPeerPublicKey(ctx, peerId) {
  if (ctx.state.peerManager) {
    const session = ctx.state.peerManager.getSession(peerId)
    if (session?.crypto?.publicKey) {
      // Manager 는 publicKey 를 base64 문자열로 보관. 레거시 경로는 KeyObject 이므로 혼재.
      // 혼재 방지: Manager 가 있을 때도 레거시 맵(KeyObject) 우선 (DM 암/복호화가 KeyObject 필요).
      return ctx.state.peerPublicKeyMap.get(peerId)
    }
  }
  return ctx.state.peerPublicKeyMap.get(peerId)
}

function hasPeerPublicKey(ctx, peerId) {
  return ctx.state.peerPublicKeyMap.has(peerId)
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

// #31 전체채팅 히스토리 동기화 — 연결(hello 핸드셰이크) 완료 직후 1회 호출.
// 내 DB 의 가장 최근 전체채팅 timestamp 를 실어 상대에게 history-sync-request 를 보낸다.
// 상대는 그보다 최신(>=)인 전체채팅을 history-sync-response 로 돌려주고, 그 응답 수신은
// 새 요청을 만들지 않으므로 증폭/무한루프가 없다(요청은 오직 이 지점에서만 발생).
// 양쪽이 서로 요청해도(역방향 연결 포함) 수신측 dedup(INSERT OR IGNORE + 렌더러 id 검사)으로 안전.
function sendHistorySyncRequest(ctx, targetPeerId) {
  if (!ctx.state.database) return false
  let sinceTimestamp = 0
  try {
    sinceTimestamp = getLatestGlobalMessageTimestamp(ctx.state.database)
  } catch { /* DB 조회 실패 시 0(전체 요청)으로 폴백 */ }
  return sendPeerMessage(ctx, targetPeerId, {
    type: 'history-sync-request',
    fromId: ctx.state.peerId,
    sinceTimestamp,
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

// 채팅방이 뮤트되었는지 확인 — mutedRooms 는 renderer localStorage 에만 저장되므로,
// set-muted-rooms IPC 로 동기화받은 ctx.state.mutedRoomKeySet 을 기준으로 판정한다.
// 뮤트는 소리/OS알림만 억제하고 안읽음 배지는 그대로 유지해야 하므로(#4), 호출부에서
// incrementBadge 와 분리해서 사용한다.
function isRoomMuted(ctx, roomKey) {
  return !!ctx.state.mutedRoomKeySet && ctx.state.mutedRoomKeySet.has(roomKey)
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
            // 답장 메타(#28)도 pending 재전송 시 동일하게 암호화 페이로드에 실어 보낸다.
            replyToId: messagePayload.replyToId || null,
            replyPreview: messagePayload.replyPreview || null,
            // @멘션(#29)도 동일하게 재전송 시 암호화 페이로드에 실어 보낸다 — DB 행은 최초
            // 저장 시점에 이미 평문 컬럼으로 저장돼 있으므로 여기서는 와이어 페이로드만 채운다.
            mentions: messagePayload.mentions || [],
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
          // 오프라인 큐에서 지연 재전송되는 메시지 — 원래 전송 시점(최대 7일 전) timestamp 를
          // 그대로 유지하므로, 수신측 신선도(replay) 검증에서 예외 처리되도록 표시한다.
          // (수신측 messageHandler.isStaleInboundMessage 가 이 플래그를 보고 통과시킨다.)
          deferred: true,
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

// 파일 URL 의 host:port 를 현재 파일 서버 주소로 재작성 (앱 재시작 후 포트 변경 대응).
// 자기 메시지 (fromId === myPeerId) 에만 적용해야 한다.
// 수신자 메시지의 URL 은 원본 송신자 IP/포트가 그대로 유지되어야 직접 GET 이 가능하다.
function rewriteFileUrl(ctx, url, fromId) {
  if (!url || typeof url !== 'string') return url
  if (fromId && fromId !== ctx.state.peerId) return url
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

// 송신자 자기 메시지의 파일을 영구 캐시 (file_cache/) 로 복사하고 DB 매핑 저장.
// 임시폴더(7일 정리)나 fileServer 포트 변경에도 표시가 유지되도록 한다.
// tempFilePath 의 원본은 이미 암호화되어 있으므로 (save-file IPC 가 ciphertext 로 저장)
// 단순 복사로 충분.
function cacheOwnFile(ctx, messageId, fileName) {
  if (!fileName || !messageId) return
  try {
    const sourcePath = path.join(ctx.config.appDataPath, 'files', fileName)
    if (!fs.existsSync(sourcePath)) return
    const cacheDir = path.join(ctx.config.appDataPath, 'file_cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const ext = path.extname(fileName)
    const cachedPath = path.join(cacheDir, `${messageId}${ext}`)
    if (!fs.existsSync(cachedPath)) {
      fs.copyFileSync(sourcePath, cachedPath)
      try { fs.chmodSync(cachedPath, 0o600) } catch {}
    }
    saveFileCache(ctx.state.database, { messageId, cachedPath })
  } catch { /* 캐시 실패 시 무시 — 표시는 tempFilePath 원본으로 폴백 */ }
}

// 메시지 삭제 + 연결된 file_cache 파일 정리 (#24).
// cached_file_path 는 항상 `${messageId}${확장자}` 형태로 messageId 와 1:1 매핑된다
// (cacheOwnFile / cacheReceivedFile 참고) — 즉 다른 메시지가 같은 캐시 파일을 참조할
// 가능성이 없으므로 참조 카운트 없이 안전하게 삭제할 수 있다.
// deleteMessage 는 from_id 가 일치하는 경우에만 실제로 행을 지우므로(changes > 0),
// 권한이 없어 삭제가 실제로 일어나지 않았을 때는 캐시 파일도 지우지 않는다.
function deleteMessageAndCachedFile(ctx, messageId, fromId) {
  const cachedFilePath = getFileCache(ctx.state.database, messageId)
  const result = deleteMessage(ctx.state.database, messageId, fromId)
  if (result.changes > 0 && cachedFilePath) {
    try { fs.unlinkSync(cachedFilePath) } catch { /* 이미 없거나 삭제 실패 시 무시 */ }
  }
  return result
}

// 로그인 시점에 file_cache/ 안에서 어떤 메시지도 참조하지 않는 orphan 파일을 정리한다.
// 메시지 삭제 시 개별적으로 캐시 파일을 지우지만(deleteMessageAndCachedFile, 위),
// 과거 데이터(이 수정 이전에 삭제된 메시지)나 비정상 종료로 인해 orphan 이 남아있을 수
// 있어 로그인마다 한 번씩 스윕한다. DB 조회가 실패하면 잘못 지우는 것보다 안전하게
// 아무 것도 하지 않는다.
function sweepOrphanedFileCache(ctx) {
  const cacheDir = path.join(ctx.config.appDataPath, 'file_cache')
  if (!fs.existsSync(cacheDir)) return { removed: 0 }

  let referencedPaths
  try {
    referencedPaths = new Set(
      ctx.state.database
        .prepare('SELECT cached_file_path FROM messages WHERE cached_file_path IS NOT NULL')
        .all()
        .map(row => path.resolve(row.cached_file_path))
    )
  } catch {
    return { removed: 0 }
  }

  let removed = 0
  let entries
  try {
    entries = fs.readdirSync(cacheDir)
  } catch {
    return { removed: 0 }
  }
  for (const fileName of entries) {
    const fullPath = path.resolve(path.join(cacheDir, fileName))
    if (referencedPaths.has(fullPath)) continue
    try {
      fs.unlinkSync(fullPath)
      removed++
    } catch { /* 개별 파일 삭제 실패는 무시하고 계속 진행 */ }
  }
  return { removed }
}

// 레거시 단발 file-data 사이즈 한도 — wsServer.MAX_PAYLOAD_BYTES 와 base64 오버헤드(1.33x) 를
// 고려해 raw 150MB 까지 단발 전송 허용. 구버전(청크 미지원) 피어에게 보낼 때의 상한이다.
const MAX_RAW_FILE_BYTES = 150 * 1024 * 1024

// 청크 전송(#44/#45/#49) 사이즈 한도 — 청크화로 단일 프레임 제약이 사라지므로 상향한다.
// 단 무한대는 금지(송/수신 모두 전체 평문을 메모리에 1회 올리므로) — 1GB 로 제한.
// save-file IPC 업로드 가드와 청크 경로(fileRequest → sendFileAsChunks) 상한으로 쓰인다.
const MAX_CHUNKED_FILE_BYTES = 1024 * 1024 * 1024

// 협상된 capability 조회 — 상대가 해당 기능을 지원하고(원격 hello) 나도 지원하면(LOCAL) true.
// peerManager 세션의 remoteCapabilities 를 LOCAL_CAPABILITIES 와 교집합해 판정한다.
// peerManager/세션이 없으면(협상 정보 없음) 안전하게 false → 레거시 경로로 폴백.
function peerSupportsCapability(ctx, peerId, capability) {
  if (!ctx.state.peerManager) return false
  const session = ctx.state.peerManager.getSession(peerId)
  if (!session) return false
  const remoteCapabilities = session.handshake?.remoteCapabilities || []
  return negotiateCapabilities(remoteCapabilities).includes(capability)
}

// 파일 재요청 백오프 (ms). 메시지 손실·키 도착 지연·임시 연결 불안정에 대비.
// 한 번에 끝내지 않고 점진적으로 retry → 사용자가 오래 기다리지 않으면서도
// 짧은 race 에서 회복.
const FILE_REQUEST_RETRY_DELAYS_MS = [3000, 6000, 12000]

// 진행 중인 파일 요청 정리. file-data 수신 성공 / file-request-error 수신 / 영구 실패 시 호출.
function clearPendingFileRequest(ctx, messageId) {
  const pending = ctx.state.pendingFileRequestMap.get(messageId)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  ctx.state.pendingFileRequestMap.delete(messageId)
}

// 모든 진행 중인 파일 요청 일괄 정리 (로그아웃/세션 종료용)
function clearAllPendingFileRequests(ctx) {
  if (!ctx.state.pendingFileRequestMap) return
  ctx.state.pendingFileRequestMap.forEach((pending) => {
    if (pending?.timer) clearTimeout(pending.timer)
  })
  ctx.state.pendingFileRequestMap.clear()
}

// 다음 백오프 step 으로 재요청 스케줄. attempt 가 한도 초과면 영구 실패로 처리.
function scheduleFileRequestRetry(ctx, messageId, fileName, fromId) {
  const pending = ctx.state.pendingFileRequestMap.get(messageId)
  if (!pending) return
  const nextDelay = FILE_REQUEST_RETRY_DELAYS_MS[pending.attempt]
  if (nextDelay === undefined) {
    // 모든 재시도 소진 — 렌더러에 실패 통보 (사용자가 영원히 spinner 보지 않도록)
    writePeerDebugLog('main.fileTransfer.giveUp', { messageId, fileName, fromId, attempts: pending.attempt })
    sendToRenderer(ctx, 'file-request-error', { messageId, reason: 'timeout' })
    clearPendingFileRequest(ctx, messageId)
    return
  }
  pending.timer = setTimeout(() => {
    // 타이머 만료 시점에 이미 캐시됐을 수 있음 — DB 확인
    try {
      if (ctx.state.database) {
        const cachedPath = require('../storage/queries').getFileCache(ctx.state.database, messageId)
        if (cachedPath && fs.existsSync(cachedPath)) {
          clearPendingFileRequest(ctx, messageId)
          return
        }
      }
    } catch { /* DB 조회 실패 시 진행 */ }
    pending.attempt += 1
    writePeerDebugLog('main.fileTransfer.retry', { messageId, fileName, fromId, attempt: pending.attempt })
    sendPeerMessage(ctx, fromId, {
      type: 'file-request',
      fromId: ctx.state.peerId,
      messageId,
      fileName,
    })
    scheduleFileRequestRetry(ctx, messageId, fileName, fromId)
  }, nextDelay)
  if (pending.timer.unref) pending.timer.unref()
}

// 수신된 파일 메타정보를 받아 ECDH 암호화 ws 채널로 직접 요청한다.
// HTTP fileServer 경유는 LAN 도청 위험 + 다른 피어 마스터키 차이로 무용 → 4단계에서 제거.
// 디스크엔 자기 마스터키로 다시 암호화한 ciphertext 만 저장된다.
function cacheReceivedFile(ctx, messageId, fileUrl, fileName, fromId) {
  if (!fileName) {
    // fileName 누락 — 렌더러는 표시 시도조차 무의미하므로 즉시 실패 통보
    sendToRenderer(ctx, 'file-request-error', { messageId, reason: 'missingFileName' })
    return
  }
  if (!ctx.state.masterKey) {
    // 마스터키 미설정 시 캐시 디렉토리 권한이나 암호화 자체가 불가 — 즉시 실패 통보
    sendToRenderer(ctx, 'file-request-error', { messageId, reason: 'noMasterKey' })
    return
  }
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

  // 항상 ECDH 기반 ws fallback 사용 — fileUrl 은 무시 (구버전 호환용 식별자).
  requestFileViaWebSocket(ctx, messageId, fileName, fromId)
}

// WebSocket을 통해 파일 전송 요청 — HTTP가 막힌 네트워크 환경용.
// 동일 messageId 의 진행 중 요청이 있으면 중복 송신하지 않고 기존 타이머 유지.
function requestFileViaWebSocket(ctx, messageId, fileName, fromId) {
  if (!fromId) return
  // 이미 진행 중이면 중복 송신 방지
  if (ctx.state.pendingFileRequestMap.has(messageId)) {
    writePeerDebugLog('main.fileTransfer.requestSkippedInFlight', { messageId, fileName, fromId })
    return
  }
  writePeerDebugLog('main.fileTransfer.request', { messageId, fileName, fromId })
  sendPeerMessage(ctx, fromId, {
    type: 'file-request',
    fromId: ctx.state.peerId,
    messageId,
    fileName,
  })
  ctx.state.pendingFileRequestMap.set(messageId, {
    fromId,
    fileName,
    attempt: 0,
    timer: null,
  })
  scheduleFileRequestRetry(ctx, messageId, fileName, fromId)
}

module.exports = {
  sendToRenderer,
  getCurrentNicknameSafely,
  getMyAdvertisedAddresses,
  buildMyKeyExchangePayload,
  buildMyHelloPayload,
  waitForMilliseconds,
  clearPeerConnectRetry,
  clearAllPeerConnectRetryState,
  getPeerPublicKey,
  hasPeerPublicKey,
  getInboundConnections,
  getConnectedPeerIds,
  hasPeerConnection,
  sendPeerMessage,
  broadcastPeerMessage,
  sendHistorySyncRequest,
  incrementBadge,
  clearBadge,
  showNotification,
  isRoomMuted,
  playNotificationSound,
  checkAndNotifyUpdated,
  loadChangelog,
  flushPendingMessages,
  rewriteFileUrl,
  buildMyProfileImageUrl,
  cacheReceivedFile,
  cacheOwnFile,
  deleteMessageAndCachedFile,
  sweepOrphanedFileCache,
  requestFileViaWebSocket,
  clearPendingFileRequest,
  clearAllPendingFileRequests,
  peerSupportsCapability,
  MAX_RAW_FILE_BYTES,
  MAX_CHUNKED_FILE_BYTES,
  FILE_REQUEST_RETRY_DELAYS_MS,
}
