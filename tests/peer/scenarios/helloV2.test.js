// Phase 1c: v2 hello 메시지 수신 테스트.
// v0.8.x 는 수신만 지원 — 상대가 v2 hello 를 보냈을 때 처리되는지 검증.

const WebSocket = require('ws')
const { createNode } = require('../harness')
const { buildHello } = require('../../../electron/peer/wire')
const { randomUUID } = require('crypto')
const crypto = require('crypto')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario: v2 hello 수신', () => {
  let node

  afterEach(async () => {
    if (node) await node.shutdown()
    node = null
  })

  it('유효한 v2 hello 수신 시 peerPublicKeyMap 에 저장 + PeerManager READY', async () => {
    node = await createNode({ peerId: 'peer-host', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')

    // 가짜 원격 피어 — 실제 WebSocket 클라이언트로 hello 전송
    const { privateKey: remotePrivateKey, publicKey: remotePublicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const remotePublicKeyBase64 = remotePublicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const remoteSessionId = randomUUID()

    const client = new WebSocket(`ws://127.0.0.1:${node.port}`)
    await new Promise((resolve, reject) => {
      client.on('open', resolve)
      client.on('error', reject)
    })

    const hello = buildHello({
      peerId: 'peer-remote-v2',
      sessionId: remoteSessionId,
      publicKey: remotePublicKeyBase64,
      nickname: '원격v2',
      wsPort: 12345,
      filePort: 0,
      addresses: ['127.0.0.1'],
      profileImageUrl: null,
    })
    client.send(JSON.stringify(hello))

    // host 가 공개키를 저장할 때까지 대기
    await waitFor(() => node.ctx.state.peerPublicKeyMap.has('peer-remote-v2'))

    // PeerManager 에도 세션이 READY 로 등록됨 (v2 sessionId 포함)
    const session = node.ctx.state.peerManager.getSession('peer-remote-v2')
    expect(session).toBeDefined()
    expect(session.state).toBe('READY')
    expect(session.handshake.remoteSessionId).toBe(remoteSessionId)
    expect(session.crypto.publicKey).toBe(remotePublicKeyBase64)

    client.close()
  })

  it('v3(미래) hello 는 거부', async () => {
    node = await createNode({ peerId: 'peer-host2', nickname: '호스트2' })
    await node.callIpc('start-peer-discovery')

    const client = new WebSocket(`ws://127.0.0.1:${node.port}`)
    await new Promise((resolve, reject) => {
      client.on('open', resolve)
      client.on('error', reject)
    })

    const badHello = {
      type: 'hello',
      v: 3,
      fromId: 'peer-future',
      sessionId: 'sx',
      publicKey: 'AAAA',
      nickname: 'future',
      wsPort: 12345,
      filePort: 0,
      addresses: [],
    }
    client.send(JSON.stringify(badHello))

    // 처리 안 되어야 함 — 200ms 대기 후 publicKeyMap 에 없음을 확인
    await new Promise(r => setTimeout(r, 200))
    expect(node.ctx.state.peerPublicKeyMap.has('peer-future')).toBe(false)

    client.close()
  })
})
