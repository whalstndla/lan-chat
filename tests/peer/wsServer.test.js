// tests/peer/wsServer.test.js
const { 웹소켓서버시작, 웹소켓서버중지 } = require('../../electron/peer/wsServer')
const WebSocket = require('ws')

describe('WebSocket 서버', () => {
  let 서버정보

  afterEach((done) => {
    if (서버정보) {
      웹소켓서버중지(서버정보)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('서버 시작 후 포트를 반환함', () => {
    서버정보 = 웹소켓서버시작({
      메시지수신콜백: () => {},
    })
    expect(서버정보.포트).toBeGreaterThan(0)
  })

  it('클라이언트가 연결하면 메시지를 수신할 수 있음', (done) => {
    const 테스트메시지 = { type: 'message', content: '테스트', from: '홍길동', fromId: 'id1', id: 'msg1', contentType: 'text', timestamp: Date.now() }

    서버정보 = 웹소켓서버시작({
      메시지수신콜백: (수신메시지) => {
        expect(수신메시지.content).toBe('테스트')
        done()
      },
    })

    const 클라이언트 = new WebSocket(`ws://localhost:${서버정보.포트}`)
    클라이언트.on('open', () => {
      클라이언트.send(JSON.stringify(테스트메시지))
    })
  })
})
