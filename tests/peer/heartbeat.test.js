// tests/peer/heartbeat.test.js
const WebSocket = require('ws')
const { startWsServer, stopWsServer, closeAllServerClients } = require('../../electron/peer/wsServer')
const { connectToPeer, disconnectFromPeer, disconnectAll, getConnections } = require('../../electron/peer/wsClient')

describe('Heartbeat 및 자동 재연결', () => {
  let serverInfo

  afterEach((done) => {
    // 모든 클라이언트 연결 정리
    getConnections().forEach(peerId => disconnectFromPeer(peerId))
    if (serverInfo) {
      // 서버측 클라이언트 소켓도 함께 종료
      try { closeAllServerClients(serverInfo) } catch { /* 이미 종료됐을 수 있음 */ }
      stopWsServer(serverInfo)
      serverInfo = null
      setTimeout(done, 150)
    } else {
      done()
    }
  })

  describe('서버 Heartbeat (Ping-Pong)', () => {
    it('서버가 ping을 보내면 클라이언트가 pong을 응답함', async () => {
      // heartbeatInterval을 짧게 설정하여 빠르게 테스트
      serverInfo = await startWsServer({ onMessage: () => {}, heartbeatInterval: 200 })

      await new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${serverInfo.port}`)

        client.on('ping', () => {
          // ping 수신 시 ws 라이브러리가 자동으로 pong을 보냄 — 이 이벤트 발생 자체가 성공
          resolve()
        })

        client.on('error', reject)
      })
    })

    it('pong을 응답하지 않는 클라이언트는 종료됨', async () => {
      // heartbeatInterval을 매우 짧게 설정
      serverInfo = await startWsServer({ onMessage: () => {}, heartbeatInterval: 200 })

      await new Promise((resolve) => {
        // autoPong: false 옵션으로 자동 pong 응답 비활성화 — 죽은 연결 시뮬레이션
        const client = new WebSocket(`ws://localhost:${serverInfo.port}`, { autoPong: false })

        client.on('close', () => {
          // 서버가 isAlive=false 상태에서 다음 heartbeat에 terminate() → close 이벤트 발생 → 성공
          resolve()
        })

        client.on('error', () => {
          // terminate 후 에러가 발생할 수 있음 — 무시
        })
      })
    }, 5000)

    it('서버 종료 시 heartbeat 인터벌이 정리됨', async () => {
      // heartbeat 인터벌이 있는 서버를 시작하고 종료해도 프로세스가 멈추지 않아야 함
      const tempServer = await startWsServer({ onMessage: () => {}, heartbeatInterval: 500 })

      // 즉시 서버 종료
      stopWsServer(tempServer)

      // 에러 없이 종료되면 성공
      await new Promise(resolve => setTimeout(resolve, 100))
    })
  })

  describe('클라이언트 자동 재연결', () => {
    it('autoReconnect: true 설정 시 서버 종료 후 재연결을 시도함', async () => {
      serverInfo = await startWsServer({ onMessage: () => {} })
      const originalPort = serverInfo.port
      let reconnectCalled = false
      let tempServer = null

      await connectToPeer({
        peerId: 'peer-reconnect',
        host: 'localhost',
        wsPort: originalPort,
        autoReconnect: true,
        reconnectBaseDelay: 100, // 빠른 테스트를 위해 짧게 설정
        onReconnect: () => {
          reconnectCalled = true
        },
      })

      // 연결 성공 후 서버측 소켓을 terminate하여 클라이언트 close 이벤트 유발
      closeAllServerClients(serverInfo)

      // 서버를 종료하고 같은 포트에 새 서버를 시작하여 재연결 성공을 허용
      // (onReconnect는 재연결 성공 후에만 호출됨)
      await new Promise(resolve => {
        serverInfo.server.close(() => {
          const { WebSocketServer } = require('ws')
          tempServer = new WebSocketServer({ port: originalPort })
          resolve()
        })
      })
      serverInfo = null

      // 재연결 성공 + onReconnect 콜백 호출까지 대기
      await new Promise(resolve => setTimeout(resolve, 800))

      expect(reconnectCalled).toBe(true)

      // 남은 타이머 정리
      disconnectFromPeer('peer-reconnect')
      if (tempServer) tempServer.close()
    }, 5000)

    it('autoReconnect: false(기본값)이면 재연결 타이머를 등록하지 않음', async () => {
      serverInfo = await startWsServer({ onMessage: () => {} })

      await connectToPeer({
        peerId: 'peer-no-reconnect',
        host: 'localhost',
        wsPort: serverInfo.port,
        // autoReconnect 옵션 없음 — 기본값 false
      })

      closeAllServerClients(serverInfo)
      stopWsServer(serverInfo)
      serverInfo = null

      // 재연결 없이 시간이 지나도 연결 목록에 없어야 함
      await new Promise(resolve => setTimeout(resolve, 400))

      // connectionMap에 있을 경우 OPEN 상태가 아니므로 getConnections()에 포함 안 됨
      expect(getConnections()).not.toContain('peer-no-reconnect')
    }, 5000)

    it('disconnectFromPeer() 호출 시 재연결 타이머가 취소됨', async () => {
      serverInfo = await startWsServer({ onMessage: () => {} })
      let reconnectCalled = false

      await connectToPeer({
        peerId: 'peer-cancel',
        host: 'localhost',
        wsPort: serverInfo.port,
        autoReconnect: true,
        reconnectBaseDelay: 200,
        onReconnect: () => {
          reconnectCalled = true
        },
      })

      // 수동으로 연결 끊기 → 재연결 타이머가 취소되어야 함
      disconnectFromPeer('peer-cancel')

      await new Promise(resolve => setTimeout(resolve, 600))

      expect(reconnectCalled).toBe(false)
    }, 5000)

    it('disconnectAll() 호출 시 모든 재연결 타이머가 취소됨', async () => {
      serverInfo = await startWsServer({ onMessage: () => {} })
      let reconnectCalled = false

      await connectToPeer({
        peerId: 'peer-all-cancel',
        host: 'localhost',
        wsPort: serverInfo.port,
        autoReconnect: true,
        reconnectBaseDelay: 200,
        onReconnect: () => {
          reconnectCalled = true
        },
      })

      disconnectAll()

      await new Promise(resolve => setTimeout(resolve, 600))

      expect(reconnectCalled).toBe(false)
    }, 5000)
  })
})
