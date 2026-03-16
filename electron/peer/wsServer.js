// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

function startWsServer({ onMessage }) {
  // 최대 페이로드 10MB 제한 — 대용량 메시지로 인한 메모리 소진 방지
  const server = new WebSocketServer({ port: 0, maxPayload: 10 * 1024 * 1024 })

  server.on('connection', (socket) => {
    // maxPayload 초과 등 소켓 에러를 개별 처리 — 없으면 uncaughtException으로 번짐
    socket.on('error', () => {})

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
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
