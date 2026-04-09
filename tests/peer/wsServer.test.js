// tests/peer/wsServer.test.js
const { startWsServer, stopWsServer, getServerClientPeerIds, sendMessageToServerPeer } = require('../../electron/peer/wsServer')
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

  it('서버 시작 후 포트를 반환함', async () => {
    serverInfo = await startWsServer({ onMessage: () => {} })
    expect(serverInfo.port).toBeGreaterThan(0)
  })

  it('클라이언트가 연결하면 메시지를 수신할 수 있음', async () => {
    const testMessage = { type: 'message', content: '테스트', from: '홍길동', fromId: 'id1', id: 'msg1', contentType: 'text', timestamp: Date.now() }

    await new Promise(async (resolve) => {
      serverInfo = await startWsServer({
        onMessage: (received) => {
          expect(received.content).toBe('테스트')
          resolve()
        },
      })

      const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
      client.on('open', () => {
        client.send(JSON.stringify(testMessage))
      })
    })
  })

  it('inbound 소켓에 peerId가 태깅되면 서버에서도 해당 피어로 전송할 수 있음', async () => {
    const inboundKeyExchange = {
      type: 'key-exchange',
      fromId: 'peer-inbound',
      publicKey: 'dummy-key',
      timestamp: Date.now(),
    }

    await new Promise(async (resolve) => {
      serverInfo = await startWsServer({
        onMessage: (received) => {
          if (received.type !== 'key-exchange') return

          expect(getServerClientPeerIds(serverInfo)).toContain('peer-inbound')
          const sent = sendMessageToServerPeer(serverInfo, 'peer-inbound', {
            type: 'typing',
            fromId: 'server-peer',
            timestamp: Date.now(),
          })
          expect(sent).toBe(true)
        },
      })

      const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
      client.on('message', (data) => {
        const received = JSON.parse(data.toString())
        expect(received.type).toBe('typing')
        expect(received.fromId).toBe('server-peer')
        resolve()
      })
      client.on('open', () => {
        client.send(JSON.stringify(inboundKeyExchange))
      })
    })
  })
})
