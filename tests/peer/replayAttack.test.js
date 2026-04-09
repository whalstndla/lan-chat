// tests/peer/replayAttack.test.js
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')
const WebSocket = require('ws')

describe('Replay Attack 방어', () => {
  let serverInfo

  afterEach((done) => {
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('동일한 메시지 ID를 두 번 보내면 첫 번째만 onMessage에 도달함', async () => {
    let receiveCount = 0

    serverInfo = await startWsServer({
      onMessage: () => {
        receiveCount++
      },
    })

    const duplicateMessage = {
      type: 'message',
      id: 'replay-test-id-001',
      content: '중복 테스트',
      from: '테스터',
      fromId: 'peer-a',
      contentType: 'text',
      timestamp: Date.now(),
    }

    await new Promise((resolve) => {
      const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
      client.on('open', () => {
        // 동일한 메시지를 두 번 연속 전송
        client.send(JSON.stringify(duplicateMessage))
        client.send(JSON.stringify(duplicateMessage))

        // 두 메시지가 처리될 충분한 시간 대기 후 카운트 확인
        setTimeout(() => {
          expect(receiveCount).toBe(1)
          resolve()
        }, 200)
      })
    })
  })

  it('서로 다른 메시지 ID는 모두 onMessage에 도달함', async () => {
    let receiveCount = 0

    serverInfo = await startWsServer({
      onMessage: () => {
        receiveCount++
      },
    })

    const firstMessage = {
      type: 'message',
      id: 'unique-id-001',
      content: '첫 번째',
      from: '테스터',
      fromId: 'peer-a',
      contentType: 'text',
      timestamp: Date.now(),
    }

    const secondMessage = {
      type: 'message',
      id: 'unique-id-002',
      content: '두 번째',
      from: '테스터',
      fromId: 'peer-a',
      contentType: 'text',
      timestamp: Date.now(),
    }

    await new Promise((resolve) => {
      const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
      client.on('open', () => {
        client.send(JSON.stringify(firstMessage))
        client.send(JSON.stringify(secondMessage))

        setTimeout(() => {
          expect(receiveCount).toBe(2)
          resolve()
        }, 200)
      })
    })
  })

  it('id 필드가 없는 메시지는 중복 검사 없이 매번 onMessage에 도달함', async () => {
    let receiveCount = 0

    serverInfo = await startWsServer({
      onMessage: () => {
        receiveCount++
      },
    })

    // id 없는 메시지 (key-exchange 등 일부 타입은 id 생략 가능)
    const messageWithoutId = {
      type: 'message',
      content: 'id 없는 메시지',
      from: '테스터',
      fromId: 'peer-a',
      contentType: 'text',
      timestamp: Date.now(),
    }

    await new Promise((resolve) => {
      const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
      client.on('open', () => {
        client.send(JSON.stringify(messageWithoutId))
        client.send(JSON.stringify(messageWithoutId))

        setTimeout(() => {
          expect(receiveCount).toBe(2)
          resolve()
        }, 200)
      })
    })
  })
})
