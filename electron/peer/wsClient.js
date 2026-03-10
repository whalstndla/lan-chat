// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 아이디 -> WebSocket 소켓 매핑
const 연결맵 = new Map()

function 피어연결({ 피어아이디, 호스트, 웹소켓포트 }) {
  return new Promise((resolve, reject) => {
    // 이미 연결되어 있으면 재연결 없이 바로 반환
    if (연결맵.has(피어아이디)) {
      resolve()
      return
    }

    const 소켓 = new WebSocket(`ws://${호스트}:${웹소켓포트}`)

    소켓.on('open', () => {
      연결맵.set(피어아이디, 소켓)
      resolve()
    })

    소켓.on('close', () => {
      연결맵.delete(피어아이디)
    })

    소켓.on('error', reject)
  })
}

function 메시지전송(피어아이디, 메시지객체) {
  const 소켓 = 연결맵.get(피어아이디)
  if (!소켓 || 소켓.readyState !== WebSocket.OPEN) return false
  소켓.send(JSON.stringify(메시지객체))
  return true
}

function 전체전송(메시지객체) {
  연결맵.forEach((소켓) => {
    if (소켓.readyState === WebSocket.OPEN) {
      소켓.send(JSON.stringify(메시지객체))
    }
  })
}

function 피어연결해제(피어아이디) {
  const 소켓 = 연결맵.get(피어아이디)
  if (소켓) {
    소켓.close()
    연결맵.delete(피어아이디)
  }
}

function 연결목록조회() {
  return Array.from(연결맵.keys())
}

module.exports = { 피어연결, 메시지전송, 전체전송, 피어연결해제, 연결목록조회 }
