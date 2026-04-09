// tests/peer/wsClient.test.js
const net = require('net')
const { connectToPeer, sendMessage, disconnectFromPeer, getConnections } = require('../../electron/peer/wsClient')
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')

describe('WebSocket 클라이언트', () => {
  let serverInfo
  let rawTcpServer
  let rawTcpSockets = new Set()

  afterEach((done) => {
    getConnections().forEach(peerId => disconnectFromPeer(peerId))
    if (rawTcpServer) {
      rawTcpSockets.forEach(socket => socket.destroy())
      rawTcpSockets.clear()
      rawTcpServer.close(() => {
        rawTcpServer = null
        if (serverInfo) {
          stopWsServer(serverInfo)
          serverInfo = null
          setTimeout(done, 100)
        } else {
          done()
        }
      })
      return
    }
    if (serverInfo) {
      stopWsServer(serverInfo)
      serverInfo = null
      setTimeout(done, 100)
      return
    }
    done()
  })

  it('피어에 연결하고 메시지를 전송함', async () => {
    const testMessage = {
      type: 'message', id: 'msg1', from: '홍길동', fromId: 'peer1',
      content: '안녕', contentType: 'text', timestamp: Date.now()
    }

    await new Promise(async (resolve, reject) => {
      serverInfo = await startWsServer({
        onMessage: (received) => {
          expect(received.content).toBe('안녕')
          resolve()
        }
      })

      connectToPeer({ peerId: 'peer-remote', host: 'localhost', wsPort: serverInfo.port })
        .then(() => sendMessage('peer-remote', testMessage))
        .catch(reject)
    })
  })

  it('연결 후 연결목록에 포함됨', async () => {
    serverInfo = await startWsServer({ onMessage: () => {} })

    await connectToPeer({ peerId: 'peer-x', host: 'localhost', wsPort: serverInfo.port })

    expect(getConnections()).toContain('peer-x')
  })

  it('연결 타임아웃 이후 동일 peerId로 재연결 가능함', async () => {
    rawTcpSockets = new Set()
    // TCP는 열어두되 WebSocket 핸드셰이크를 응답하지 않아 CONNECTING 상태를 유지
    rawTcpServer = net.createServer((socket) => {
      rawTcpSockets.add(socket)
      socket.on('close', () => rawTcpSockets.delete(socket))
      socket.on('error', () => {})
    })
    await new Promise(resolve => rawTcpServer.listen(0, '127.0.0.1', resolve))
    const hangingPort = rawTcpServer.address().port

    await expect(
      connectToPeer({
        peerId: 'peer-timeout',
        host: '127.0.0.1',
        wsPort: hangingPort,
        connectTimeoutMs: 100,
      })
    ).rejects.toThrow()

    serverInfo = await startWsServer({ onMessage: () => {} })
    await connectToPeer({
      peerId: 'peer-timeout',
      host: 'localhost',
      wsPort: serverInfo.port,
      connectTimeoutMs: 1000,
    })

    expect(getConnections()).toContain('peer-timeout')
  })
})
