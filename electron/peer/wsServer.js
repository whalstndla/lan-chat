// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

function startWsServer({ onMessage }) {
  // 최대 페이로드 10MB 제한 — 대용량 메시지로 인한 메모리 소진 방지
  const server = new WebSocketServer({ port: 0, maxPayload: 10 * 1024 * 1024 })

  server.on('connection', (socket) => {
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

module.exports = { startWsServer, stopWsServer }
