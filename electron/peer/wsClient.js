// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()

function connectToPeer({ peerId, host, wsPort, onMessage, onClose, force }) {
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
      // 교체된(replaced) 소켓은 onClose를 호출하지 않음 — 의도된 교체이므로 peer-left 불필요
      if (isCurrent && connected && onClose) onClose()
    })

    socket.on('error', reject)
  })
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
  connectionMap.forEach((socket) => {
    socket.close()
  })
  connectionMap.clear()
}

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, disconnectAll, getConnections }
