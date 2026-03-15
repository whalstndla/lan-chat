// tests/peer/wsClient.test.js
const { connectToPeer, sendMessage, disconnectFromPeer, getConnections } = require('../../electron/peer/wsClient')
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')

describe('WebSocket 클라이언트', () => {
  let serverInfo

  afterEach((done) => {
    getConnections().forEach(peerId => disconnectFromPeer(peerId))
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('피어에 연결하고 메시지를 전송함', (done) => {
    const testMessage = {
      type: 'message', id: 'msg1', from: '홍길동', fromId: 'peer1',
      content: '안녕', contentType: 'text', timestamp: Date.now()
    }

    serverInfo = startWsServer({
      onMessage: (received) => {
        expect(received.content).toBe('안녕')
        done()
      }
    })

    connectToPeer({ peerId: 'peer-remote', host: 'localhost', wsPort: serverInfo.port })
      .then(() => sendMessage('peer-remote', testMessage))
  })

  it('연결 후 연결목록에 포함됨', (done) => {
    serverInfo = startWsServer({ onMessage: () => {} })

    connectToPeer({ peerId: 'peer-x', host: 'localhost', wsPort: serverInfo.port })
      .then(() => {
        expect(getConnections()).toContain('peer-x')
        done()
      })
  })
})
