// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

function 웹소켓서버시작({ 메시지수신콜백 }) {
  const 서버 = new WebSocketServer({ port: 0 })

  서버.on('connection', (소켓) => {
    소켓.on('message', (데이터) => {
      try {
        const 메시지 = JSON.parse(데이터.toString())
        메시지수신콜백(메시지)
      } catch {
        // 잘못된 JSON 무시
      }
    })
  })

  const 포트 = 서버.address().port
  return { 서버, 포트 }
}

function 웹소켓서버중지({ 서버 }) {
  서버.close()
}

module.exports = { 웹소켓서버시작, 웹소켓서버중지 }
