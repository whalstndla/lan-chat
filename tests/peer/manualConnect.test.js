// tests/peer/manualConnect.test.js
const {
  connectManualPeer,
  MANUAL_CONNECT_PORT_RANGE_START,
  MANUAL_CONNECT_PORT_RANGE_END,
} = require('../../electron/peer/manualConnect')
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')

describe('수동 피어 연결 — 입력 검증', () => {
  it('host가 빈 문자열이면 실패를 반환함', async () => {
    const result = await connectManualPeer({
      host: '',
      wsPort: 12345,
      buildHelloPayload: () => ({}),
      onReply: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/호스트/)
  })

  it('host가 공백뿐이면 실패를 반환함', async () => {
    const result = await connectManualPeer({
      host: '   ',
      wsPort: 12345,
      buildHelloPayload: () => ({}),
      onReply: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/호스트/)
  })

  it('wsPort가 정수가 아니면 실패를 반환함', async () => {
    const result = await connectManualPeer({
      host: '127.0.0.1',
      wsPort: 'abc',
      buildHelloPayload: () => ({}),
      onReply: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/포트/)
  })

  it('wsPort가 유효 범위(1~65535)를 벗어나면 실패를 반환함', async () => {
    const result = await connectManualPeer({
      host: '127.0.0.1',
      wsPort: 99999,
      buildHelloPayload: () => ({}),
      onReply: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/포트/)
  })
})

describe('수동 피어 연결 — 연결 실패', () => {
  it('응답하는 서비스가 없는 포트는 실패로 반환됨', async () => {
    // localhost:1 은 일반적으로 리스닝 중인 서비스가 없어 즉시 ECONNREFUSED 발생
    const result = await connectManualPeer({
      host: '127.0.0.1',
      wsPort: 1,
      buildHelloPayload: () => ({ type: 'hello', fromId: 'me' }),
      onReply: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  }, 10000)
})

describe('수동 피어 연결 — 핸드셰이크 성공', () => {
  let serverInfo

  afterEach((done) => {
    if (serverInfo) {
      stopWsServer(serverInfo)
      serverInfo = null
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('상대가 hello로 응답하면 성공하고, 그 메시지를 onReply로 전달함', async () => {
    // 상대(원격 피어) 역할 — 우리가 보낸 hello 를 받으면 자신의 hello 로 reply
    serverInfo = await startWsServer({
      onMessage: (message, reply) => {
        expect(message.type).toBe('hello')
        expect(message.fromId).toBe('me')
        reply({
          type: 'hello', v: 2, fromId: 'peer-remote', sessionId: 'sess-remote',
          publicKey: 'dummy-pubkey', nickname: '원격피어', wsPort: 12345, filePort: 0, addresses: [],
        })
      },
    })

    let receivedMessage = null
    const result = await connectManualPeer({
      host: '127.0.0.1',
      wsPort: serverInfo.port,
      buildHelloPayload: () => ({
        type: 'hello', v: 2, fromId: 'me', sessionId: 'sess-me',
        publicKey: 'my-pubkey', nickname: '나', wsPort: 1, filePort: 0, addresses: [],
      }),
      onReply: (message) => { receivedMessage = message },
    })

    expect(result).toEqual({ ok: true })
    expect(receivedMessage).not.toBeNull()
    expect(receivedMessage.type).toBe('hello')
    expect(receivedMessage.fromId).toBe('peer-remote')
  })

  it('wsPort 미지정 시 고정 포트 범위를 순차 탐색해 연결에 성공함', async () => {
    serverInfo = await startWsServer({
      onMessage: (message, reply) => {
        reply({
          type: 'hello', v: 2, fromId: 'peer-remote', sessionId: 'sess-remote',
          publicKey: 'dummy-pubkey', nickname: '원격피어', wsPort: 12345, filePort: 0, addresses: [],
        })
      },
    })
    // wsServer도 동일한 고정 범위를 우선 시도한다. 다만 전체 테스트 스위트를 병렬로 돌리면
    // 다른 워커의 wsServer/scenario 테스트들도 같은 10개 포트를 동시에 점유할 수 있어, 범위가
    // 모두 사용 중이면 wsServer가 랜덤 포트로 폴백한다(정상 동작). 그 경우 포트 스캔 대상
    // 범위 밖이라 이 테스트가 검증하려는 시나리오 자체가 성립하지 않으므로 조용히 스킵한다
    // (다른 test worker와의 포트 경합에 의한 flake 방지 — 기능 결함이 아님).
    if (serverInfo.port < MANUAL_CONNECT_PORT_RANGE_START || serverInfo.port > MANUAL_CONNECT_PORT_RANGE_END) {
      return
    }

    let receivedMessage = null
    const result = await connectManualPeer({
      host: '127.0.0.1',
      // wsPort 미지정 — 고정 범위 순차 시도
      buildHelloPayload: () => ({
        type: 'hello', v: 2, fromId: 'me', sessionId: 'sess-me',
        publicKey: 'my-pubkey', nickname: '나', wsPort: 1, filePort: 0, addresses: [],
      }),
      onReply: (message) => { receivedMessage = message },
    })

    expect(result).toEqual({ ok: true })
    expect(receivedMessage?.fromId).toBe('peer-remote')
  }, 20000)
})
