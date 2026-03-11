// tests/peer/wsServer.test.js
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')
const WebSocket = require('ws')

describe('WebSocket 서버', () => {
  let serverInfo

  afterEach((done) => {
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('서버 시작 후 포트를 반환함', () => {
    serverInfo = startWsServer({ onMessage: () => {} })
    expect(serverInfo.port).toBeGreaterThan(0)
  })

  it('클라이언트가 연결하면 메시지를 수신할 수 있음', (done) => {
    const testMessage = { type: 'message', content: '테스트', from: '홍길동', fromId: 'id1', id: 'msg1', contentType: 'text', timestamp: Date.now() }

    serverInfo = startWsServer({
      onMessage: (received) => {
        expect(received.content).toBe('테스트')
        done()
      },
    })

    const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
    client.on('open', () => {
      client.send(JSON.stringify(testMessage))
    })
  })
})
