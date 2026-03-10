// tests/peer/wsClient.test.js
const { 피어연결, 메시지전송, 피어연결해제, 연결목록조회 } = require('../../electron/peer/wsClient')
const { 웹소켓서버시작, 웹소켓서버중지 } = require('../../electron/peer/wsServer')

describe('WebSocket 클라이언트', () => {
  let 서버정보

  afterEach((done) => {
    연결목록조회().forEach(피어아이디 => 피어연결해제(피어아이디))
    if (서버정보) {
      웹소켓서버중지(서버정보)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('피어에 연결하고 메시지를 전송함', (done) => {
    const 테스트메시지 = {
      type: 'message', id: 'msg1', from: '홍길동', fromId: 'peer1',
      content: '안녕', contentType: 'text', timestamp: Date.now()
    }

    서버정보 = 웹소켓서버시작({
      메시지수신콜백: (수신) => {
        expect(수신.content).toBe('안녕')
        done()
      }
    })

    피어연결({ 피어아이디: 'peer-remote', 호스트: 'localhost', 웹소켓포트: 서버정보.포트 })
      .then(() => 메시지전송('peer-remote', 테스트메시지))
  })

  it('연결 후 연결목록에 포함됨', (done) => {
    서버정보 = 웹소켓서버시작({ 메시지수신콜백: () => {} })

    피어연결({ 피어아이디: 'peer-x', 호스트: 'localhost', 웹소켓포트: 서버정보.포트 })
      .then(() => {
        expect(연결목록조회()).toContain('peer-x')
        done()
      })
  })
})
