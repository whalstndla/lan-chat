// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()

// 피어 ID → 재연결 타이머 매핑
const reconnectTimerMap = new Map()

// 피어 ID → 재연결 옵션 매핑 (autoReconnect 시 원본 옵션 보존)
const reconnectOptionsMap = new Map()

// 현재 연결 시도 중인 피어 ID 집합 (동시 connectToPeer race condition 방지)
const connectingSet = new Set()

// 클라이언트 측 heartbeat 주기 (ms) — 서버 사망 감지용
const CLIENT_HEARTBEAT_INTERVAL = 15000

// 지수 백오프 기반 재연결 지연 시간 계산
// 시도 횟수에 따라 delay = base * 2^attempt 로 증가, max 이하로 제한
function calculateReconnectDelay(attempt, baseDelay, maxDelay) {
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
}

function connectToPeer({
  peerId,
  host,
  wsPort,
  onMessage,
  onClose,
  force,
  autoReconnect = false,
  reconnectBaseDelay = 1000,
  reconnectMaxDelay = 30000,
  reconnectMaxAttempts = 10,
  connectTimeoutMs = 5000,
  onReconnect,
}) {
  return new Promise((resolve, reject) => {
    // 이미 OPEN 연결이 있으면 재연결 불필요
    const existingSocket = connectionMap.get(peerId)
    if (existingSocket && existingSocket.readyState === WebSocket.OPEN && !force) {
      resolve()
      return
    }
    // 동일 피어에 대한 동시 연결 시도 방지 (force가 아닌 경우)
    if (connectingSet.has(peerId) && !force) {
      resolve()
      return
    }
    connectingSet.add(peerId)

    if (existingSocket) {
      // 기존 소켓 정리 — connectionMap에서 먼저 제거하여 비동기 close가 새 매핑을 건드리지 않도록 함
      connectionMap.delete(peerId)
      existingSocket.close()
    }

    const socket = new WebSocket(`ws://${host}:${wsPort}`)
    // 연결 성공 여부 플래그 — 연결 실패 시 onClose가 오발되지 않도록 방지
    let connected = false
    // Promise settle 중복 방지
    let settled = false
    // CONNECTING 상태가 오래 유지되면 강제 종료
    let connectTimeoutHandle = setTimeout(() => {
      if (connected) return
      connectingSet.delete(peerId)
      // CONNECTING 소켓 즉시 종료 — 다음 재시도를 막지 않도록 보장
      socket.terminate()
      rejectOnce(new Error(`WebSocket 연결 타임아웃: ${peerId}`))
    }, connectTimeoutMs)
    if (connectTimeoutHandle.unref) connectTimeoutHandle.unref()

    function resolveOnce() {
      if (settled) return
      settled = true
      if (connectTimeoutHandle) {
        clearTimeout(connectTimeoutHandle)
        connectTimeoutHandle = null
      }
      resolve()
    }

    function rejectOnce(error) {
      if (settled) return
      settled = true
      if (connectTimeoutHandle) {
        clearTimeout(connectTimeoutHandle)
        connectTimeoutHandle = null
      }
      reject(error)
    }

    socket.on('open', () => {
      // 타임아웃/에러로 이미 실패 처리된 소켓은 즉시 정리
      if (settled) {
        socket.close()
        return
      }
      connectingSet.delete(peerId)
      connected = true
      connectionMap.set(peerId, socket)

      // 연결 성공 시 재연결 옵션 저장 (이후 close 이벤트에서 참조)
      if (autoReconnect) {
        reconnectOptionsMap.set(peerId, {
          peerId, host, wsPort, onMessage, onClose, autoReconnect,
          reconnectBaseDelay, reconnectMaxDelay, reconnectMaxAttempts, connectTimeoutMs, onReconnect,
        })
      }

      // 클라이언트 측 heartbeat — 서버 사망 감지 (pong 미응답 시 terminate → 재연결)
      socket._isAlive = true
      socket.on('pong', () => { socket._isAlive = true })
      socket._heartbeat = setInterval(() => {
        if (!socket._isAlive) {
          clearInterval(socket._heartbeat)
          socket.terminate()
          return
        }
        socket._isAlive = false
        socket.ping()
      }, CLIENT_HEARTBEAT_INTERVAL)
      if (socket._heartbeat.unref) socket._heartbeat.unref()

      resolveOnce()
    })

    // 서버가 클라이언트 소켓으로 reply 보낼 때 처리 (key-exchange reply 등)
    socket.on('message', (data) => {
      if (onMessage) {
        try {
          const message = JSON.parse(data.toString())
          onMessage(message, () => {}) // 클라이언트는 reply 불필요
        } catch { /* 잘못된 JSON 무시 */ }
      }
    })

    // onClose: 연결 성공 후 소켓 종료 시에만 호출 (강제 종료 감지용)
    // identity 체크: force 교체된 old 소켓의 close가 새 매핑 삭제 및 false peer-left 방지
    socket.on('close', () => {
      if (socket._heartbeat) clearInterval(socket._heartbeat)
      connectingSet.delete(peerId)
      const isCurrent = connectionMap.get(peerId) === socket
      if (isCurrent) {
        connectionMap.delete(peerId)
      }

      // open 전에 닫힌 경우 연결 실패로 간주
      if (!connected) {
        rejectOnce(new Error(`WebSocket 연결 실패: ${peerId}`))
        return
      }

      // autoReconnect가 활성화된 경우 지수 백오프 재연결 시도
      // 재연결 중에는 onClose를 호출하지 않음 — 영구 실패 시 scheduleReconnect에서 호출
      const savedOptions = reconnectOptionsMap.get(peerId)
      if (isCurrent && connected && savedOptions && savedOptions.autoReconnect) {
        scheduleReconnect(savedOptions, 0)
      } else if (isCurrent && connected && onClose) {
        // autoReconnect 없거나 교체된(replaced) 소켓 → 즉시 onClose
        onClose()
      }
    })

    socket.on('error', (error) => {
      connectingSet.delete(peerId)
      rejectOnce(error)
    })
  })
}

// 지수 백오프로 재연결을 스케줄링
function scheduleReconnect(options, attempt) {
  const { peerId, reconnectBaseDelay, reconnectMaxDelay, reconnectMaxAttempts, onReconnect } = options

  // 최대 시도 횟수 초과 시 재연결 중단 — 호출자에게 영구 실패 알림
  if (attempt >= reconnectMaxAttempts) {
    if (options.onClose) options.onClose()
    connectionMap.delete(peerId)
    reconnectOptionsMap.delete(peerId)
    return
  }

  const delay = calculateReconnectDelay(attempt, reconnectBaseDelay, reconnectMaxDelay)

  const timer = setTimeout(() => {
    reconnectTimerMap.delete(peerId)

    // 재연결 옵션이 삭제됐으면 (disconnectFromPeer/disconnectAll 호출) 중단
    if (!reconnectOptionsMap.has(peerId)) return

    // 실제 재연결 시도 — 성공 시 onReconnect 콜백, 실패 시 다음 시도 스케줄링
    connectToPeer({ ...options, force: false }).then(() => {
      // 재연결 성공 후 콜백 호출 (key-exchange 재전송 등)
      if (onReconnect) onReconnect(attempt + 1)
    }).catch(() => {
      // 재연결 실패 시 다음 시도 스케줄링
      if (reconnectOptionsMap.has(peerId)) {
        scheduleReconnect(options, attempt + 1)
      }
    })
  }, delay)

  // Jest가 타이머를 잡아두지 않도록 unref 처리
  if (timer.unref) timer.unref()

  reconnectTimerMap.set(peerId, timer)
}

function sendMessage(peerId, messageObj) {
  const socket = connectionMap.get(peerId)
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(messageObj))
  return true
}

function broadcastMessage(messageObj) {
  connectionMap.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(messageObj))
    }
  })
}

function disconnectFromPeer(peerId) {
  // CONNECTING 상태 시도도 함께 취소
  connectingSet.delete(peerId)

  // 재연결 타이머 및 옵션 취소 (자동 재연결 방지)
  const timer = reconnectTimerMap.get(peerId)
  if (timer) {
    clearTimeout(timer)
    reconnectTimerMap.delete(peerId)
  }
  reconnectOptionsMap.delete(peerId)

  const socket = connectionMap.get(peerId)
  if (socket) {
    if (socket._heartbeat) clearInterval(socket._heartbeat)
    socket.close()
    connectionMap.delete(peerId)
  }
}

// OPEN 상태인 연결만 반환 — CLOSING/CLOSED 좀비 소켓은 제외
function getConnections() {
  const activeConnections = []
  connectionMap.forEach((socket, peerId) => {
    if (socket.readyState === WebSocket.OPEN) {
      activeConnections.push(peerId)
    }
  })
  return activeConnections
}

function disconnectAll() {
  // CONNECTING 상태 시도도 전체 취소
  connectingSet.clear()

  // 모든 재연결 타이머 및 옵션 취소
  reconnectTimerMap.forEach((timer) => clearTimeout(timer))
  reconnectTimerMap.clear()
  reconnectOptionsMap.clear()

  connectionMap.forEach((socket) => {
    if (socket._heartbeat) clearInterval(socket._heartbeat)
    socket.close()
  })
  connectionMap.clear()
}

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, disconnectAll, getConnections }
