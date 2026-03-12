// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()

function connectToPeer({ peerId, host, wsPort, onMessage }) {
  return new Promise((resolve, reject) => {
    const existingSocket = connectionMap.get(peerId)
    if (existingSocket) {
      if (existingSocket.readyState === WebSocket.OPEN) {
        // 정상 연결 중이면 재연결 불필요
        resolve()
        return
      }
      // CLOSING/CLOSED 좀비 소켓 정리 후 재연결
      connectionMap.delete(peerId)
    }

    const socket = new WebSocket(`ws://${host}:${wsPort}`)

    socket.on('open', () => {
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

    socket.on('close', () => {
      connectionMap.delete(peerId)
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

function getConnections() {
  return Array.from(connectionMap.keys())
}

function disconnectAll() {
  connectionMap.forEach((socket) => {
    socket.close()
  })
  connectionMap.clear()
}

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, disconnectAll, getConnections }
