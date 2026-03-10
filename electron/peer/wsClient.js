// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()

function connectToPeer({ peerId, host, wsPort }) {
  return new Promise((resolve, reject) => {
    // 이미 연결되어 있으면 재연결 없이 바로 반환
    if (connectionMap.has(peerId)) {
      resolve()
      return
    }

    const socket = new WebSocket(`ws://${host}:${wsPort}`)

    socket.on('open', () => {
      connectionMap.set(peerId, socket)
      resolve()
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

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, getConnections }
