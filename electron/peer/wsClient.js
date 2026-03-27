// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()

// 피어 ID → 재연결 타이머 매핑
const reconnectTimerMap = new Map()

// 피어 ID → 재연결 옵션 매핑 (autoReconnect 시 원본 옵션 보존)
const reconnectOptionsMap = new Map()

// 지수 백오프 기반 재연결 지연 시간 계산
// 시도 횟수에 따라 delay = base * 2^attempt 로 증가, max 이하로 제한
function calculateReconnectDelay(attempt, baseDelay, maxDelay) {
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
}

function connectToPeer({ peerId, host, wsPort, onMessage, onClose, force, autoReconnect = false, reconnectBaseDelay = 1000, reconnectMaxDelay = 30000, reconnectMaxAttempts = 10, onReconnect }) {
  return new Promise((resolve, reject) => {
    const existingSocket = connectionMap.get(peerId)
    if (existingSocket) {
      if (existingSocket.readyState === WebSocket.OPEN && !force) {
        // 정상 연결 중이면 재연결 불필요 (force 시 강제 교체)
        resolve()
        return
      }
      // 기존 소켓 정리 — connectionMap에서 먼저 제거하여 비동기 close가 새 매핑을 건드리지 않도록 함
      connectionMap.delete(peerId)
      existingSocket.close()
    }

    const socket = new WebSocket(`ws://${host}:${wsPort}`)
    // 연결 성공 여부 플래그 — 연결 실패 시 onClose가 오발되지 않도록 방지
    let connected = false

    socket.on('open', () => {
      connected = true
      connectionMap.set(peerId, socket)

      // 연결 성공 시 재연결 옵션 저장 (이후 close 이벤트에서 참조)
      if (autoReconnect) {
        reconnectOptionsMap.set(peerId, {
          peerId, host, wsPort, onMessage, onClose, autoReconnect,
          reconnectBaseDelay, reconnectMaxDelay, reconnectMaxAttempts, onReconnect,
        })
      }

      resolve()
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
      const isCurrent = connectionMap.get(peerId) === socket
      if (isCurrent) {
        connectionMap.delete(peerId)
      }

      // autoReconnect가 활성화된 경우 지수 백오프 재연결 시도
      const savedOptions = reconnectOptionsMap.get(peerId)
      if (isCurrent && connected && savedOptions && savedOptions.autoReconnect) {
        scheduleReconnect(savedOptions, 0)
      }

      // 교체된(replaced) 소켓은 onClose를 호출하지 않음 — 의도된 교체이므로 peer-left 불필요
      if (isCurrent && connected && onClose) onClose()
    })

    socket.on('error', reject)
  })
}

// 지수 백오프로 재연결을 스케줄링
function scheduleReconnect(options, attempt) {
  const { peerId, reconnectBaseDelay, reconnectMaxDelay, reconnectMaxAttempts, onReconnect } = options

  // 최대 시도 횟수 초과 시 재연결 중단
  if (attempt >= reconnectMaxAttempts) {
    reconnectOptionsMap.delete(peerId)
    return
  }

  const delay = calculateReconnectDelay(attempt, reconnectBaseDelay, reconnectMaxDelay)

  const timer = setTimeout(() => {
    reconnectTimerMap.delete(peerId)

    // 재연결 옵션이 삭제됐으면 (disconnectFromPeer/disconnectAll 호출) 중단
    if (!reconnectOptionsMap.has(peerId)) return

    // onReconnect 콜백 호출 (재연결 시도 알림)
    if (onReconnect) onReconnect(attempt + 1)

    // 실제 재연결 시도 — 실패 시 다음 시도 스케줄링
    connectToPeer({ ...options, force: false }).catch(() => {
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
  // 재연결 타이머 및 옵션 취소 (자동 재연결 방지)
  const timer = reconnectTimerMap.get(peerId)
  if (timer) {
    clearTimeout(timer)
    reconnectTimerMap.delete(peerId)
  }
  reconnectOptionsMap.delete(peerId)

  const socket = connectionMap.get(peerId)
  if (socket) {
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
  // 모든 재연결 타이머 및 옵션 취소
  reconnectTimerMap.forEach((timer) => clearTimeout(timer))
  reconnectTimerMap.clear()
  reconnectOptionsMap.clear()

  connectionMap.forEach((socket) => {
    socket.close()
  })
  connectionMap.clear()
}

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, disconnectAll, getConnections }
