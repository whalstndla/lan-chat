// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

// 허용되는 메시지 타입 화이트리스트
const ALLOWED_MESSAGE_TYPES = [
  'key-exchange', 'typing', 'delete-message', 'nickname-changed',
  'read-receipt', 'message', 'dm', 'reaction', 'edit-message', 'status-changed',
]

// IP별 연결 수 추적 (DoS 방지)
const connectionCountByIP = new Map()
const MAX_CONNECTIONS_PER_IP = 20
const MAX_MESSAGES_PER_SECOND = 50

// 기본 heartbeat 주기 (ms)
const DEFAULT_HEARTBEAT_INTERVAL = 10000

// 중복 메시지 ID 허용 최대 크기
const MAX_RECENT_MESSAGE_IDS = 1000

function startWsServer({ onMessage, heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL }) {
  // 최대 페이로드 10MB 제한 — 대용량 메시지로 인한 메모리 소진 방지
  const server = new WebSocketServer({ port: 0, maxPayload: 10 * 1024 * 1024 })

  // Replay Attack 방어: 최근 수신된 메시지 ID 집합 (서버 인스턴스당 유지)
  const recentMessageIds = new Set()

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

    // heartbeat 생존 여부 플래그 — pong 수신 시 true로 갱신
    socket.isAlive = true
    socket.on('pong', () => {
      socket.isAlive = true
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

        // Replay Attack 방어: 동일 ID 메시지 재수신 시 무시
        if (message.id) {
          if (recentMessageIds.has(message.id)) return
          // Set 크기 초과 시 가장 오래된 항목(첫 번째 값) 삭제
          if (recentMessageIds.size >= MAX_RECENT_MESSAGE_IDS) {
            const oldestId = recentMessageIds.values().next().value
            recentMessageIds.delete(oldestId)
          }
          recentMessageIds.add(message.id)
        }

        const reply = (response) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(response))
            return true
          }
          return false
        }
        onMessage(message, reply)
      } catch {
        // 잘못된 JSON 무시
      }
    })
  })

  // heartbeat 인터벌 — 응답 없는 클라이언트 감지 후 종료
  const heartbeatTimer = setInterval(() => {
    server.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        // 이전 ping에 pong 응답 없음 → 좀비 연결 강제 종료
        socket.terminate()
        return
      }
      // 다음 interval까지 응답 대기 상태로 설정 후 ping 전송
      socket.isAlive = false
      socket.ping()
    })
  }, heartbeatInterval)

  // Jest가 타이머를 잡아두지 않도록 unref 처리
  if (heartbeatTimer.unref) heartbeatTimer.unref()

  // 서버 종료 시 heartbeat 인터벌 정리
  server.on('close', () => {
    clearInterval(heartbeatTimer)
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
