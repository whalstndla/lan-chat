// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

function startWsServer({ onMessage }) {
  const server = new WebSocketServer({ port: 0 })

  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        onMessage(message)
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
