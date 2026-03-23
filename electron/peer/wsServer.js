// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

// 허용되는 메시지 타입 화이트리스트
const ALLOWED_MESSAGE_TYPES = [
  'key-exchange', 'typing', 'delete-message', 'nickname-changed',
  'read-receipt', 'message', 'dm',
]

// IP별 연결 수 추적 (DoS 방지)
const connectionCountByIP = new Map()
const MAX_CONNECTIONS_PER_IP = 5
const MAX_MESSAGES_PER_SECOND = 20

function startWsServer({ onMessage }) {
  // 최대 페이로드 10MB 제한 — 대용량 메시지로 인한 메모리 소진 방지
  const server = new WebSocketServer({ port: 0, maxPayload: 10 * 1024 * 1024 })

  server.on('connection', (socket, req) => {
    // IP별 연결 수 제한
    const clientIP = req.socket.remoteAddress || 'unknown'
    const currentCount = connectionCountByIP.get(clientIP) || 0
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      socket.close(1008, 'Too many connections')
      return
    }
    connectionCountByIP.set(clientIP, currentCount + 1)
    socket.on('close', () => {
      const count = connectionCountByIP.get(clientIP) || 1
      if (count <= 1) connectionCountByIP.delete(clientIP)
      else connectionCountByIP.set(clientIP, count - 1)
    })

    // 메시지 빈도 제한 (초당 MAX_MESSAGES_PER_SECOND개)
    let messageCount = 0
    let lastResetTime = Date.now()

    // maxPayload 초과 등 소켓 에러를 개별 처리 — 없으면 uncaughtException으로 번짐
    socket.on('error', () => {})

    socket.on('message', (data) => {
      // 메시지 빈도 체크
      const now = Date.now()
      if (now - lastResetTime >= 1000) { messageCount = 0; lastResetTime = now }
      messageCount++
      if (messageCount > MAX_MESSAGES_PER_SECOND) return // 초과 시 무시

      try {
        const message = JSON.parse(data.toString())
        // 알 수 없는 메시지 타입은 무시 (fallthrough 방지)
        if (!ALLOWED_MESSAGE_TYPES.includes(message.type)) return
        const reply = (response) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(response))
          }
        }
        onMessage(message, reply)
      } catch {
        // 잘못된 JSON 무시
      }
    })
  })

  const port = server.address().port
  return { server, port }
}

function stopWsServer({ server }) {
  server.close()
}

// 서버에 연결된 모든 클라이언트 소켓 즉시 종료 (새로고침/재로그인 시 좀비 소켓 정리용)
// terminate()는 graceful close 없이 즉시 TCP 연결을 끊어 상대방 close 이벤트를 빠르게 발생시킴
function closeAllServerClients({ server }) {
  server.clients.forEach((socket) => socket.terminate())
}

module.exports = { startWsServer, stopWsServer, closeAllServerClients }
