// TOFU 키 고정(#59) 통합 시나리오 — hello 수신 시 3분기(최초 pin / 동일키 무경고 /
// 키변경 경고+미자동교체) + 사용자 승인(trust-peer-key) 후 갱신을 실제 WebSocket 으로 검증.

const WebSocket = require('ws')
const crypto = require('crypto')
const { randomUUID } = require('crypto')
const { createNode } = require('../harness')
const { buildHello } = require('../../../electron/peer/wire')
const { exportPublicKey } = require('../../../electron/crypto/keyManager')
const { getPinnedKey } = require('../../../electron/storage/queries')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 30 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

function makeKeyBase64() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

async function openClient(port) {
  const client = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve, reject) => {
    client.on('open', resolve)
    client.on('error', reject)
  })
  return client
}

function sendHello(client, { peerId, publicKey, nickname }) {
  client.send(JSON.stringify(buildHello({
    peerId,
    sessionId: randomUUID(),
    publicKey,
    nickname,
    wsPort: 12345,
    filePort: 0,
    addresses: ['127.0.0.1'],
    profileImageUrl: null,
  })))
}

// 세션 맵의 KeyObject 를 base64(SPKI DER) 로 되돌려 고정 키와 비교한다.
function mapKeyBase64(node, peerId) {
  const keyObj = node.ctx.state.peerPublicKeyMap.get(peerId)
  return keyObj ? exportPublicKey(keyObj) : null
}

describe('Scenario: TOFU 키 고정 + 변경 경고', () => {
  let node
  const REMOTE = 'peer-remote-tofu'

  afterEach(async () => {
    if (node) await node.shutdown()
    node = null
  })

  it('최초 hello 는 키를 고정(pin)하고 경고 없이 세션 맵에 반영한다', async () => {
    node = await createNode({ peerId: 'host-tofu-1', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')

    const keyA = makeKeyBase64()
    const client = await openClient(node.port)
    sendHello(client, { peerId: REMOTE, publicKey: keyA, nickname: '원격' })

    await waitFor(() => node.ctx.state.peerPublicKeyMap.has(REMOTE))

    // DB 에 최초 고정 + 세션 맵 반영 + 경고 이벤트 없음
    expect(getPinnedKey(node.db, REMOTE)?.publicKey).toBe(keyA)
    expect(mapKeyBase64(node, REMOTE)).toBe(keyA)
    expect(node.getRendererEvents('peer-key-changed')).toHaveLength(0)

    client.close()
  })

  it('같은 키로 재연결하면 경고가 뜨지 않는다(정상 재시작)', async () => {
    node = await createNode({ peerId: 'host-tofu-2', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')

    const keyA = makeKeyBase64()
    const c1 = await openClient(node.port)
    sendHello(c1, { peerId: REMOTE, publicKey: keyA, nickname: '원격' })
    await waitFor(() => node.ctx.state.peerPublicKeyMap.has(REMOTE))
    node.clearRendererEvents()

    // 재연결 — 동일 키로 다시 hello
    const c2 = await openClient(node.port)
    sendHello(c2, { peerId: REMOTE, publicKey: keyA, nickname: '원격' })
    // 처리될 시간을 준 뒤 경고가 없음을 확인
    await new Promise(r => setTimeout(r, 250))
    expect(node.getRendererEvents('peer-key-changed')).toHaveLength(0)
    expect(node.ctx.state.pendingKeyChangeMap.has(REMOTE)).toBe(false)

    c1.close(); c2.close()
  })

  it('키가 바뀌면 경고를 보내되 자동 교체하지 않는다(이전 키 유지)', async () => {
    node = await createNode({ peerId: 'host-tofu-3', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')

    const keyA = makeKeyBase64()
    const keyB = makeKeyBase64()

    const c1 = await openClient(node.port)
    sendHello(c1, { peerId: REMOTE, publicKey: keyA, nickname: '원격' })
    await waitFor(() => node.ctx.state.peerPublicKeyMap.has(REMOTE))
    node.clearRendererEvents()

    // 공격자(또는 재설치) — 다른 키로 hello
    const c2 = await openClient(node.port)
    sendHello(c2, { peerId: REMOTE, publicKey: keyB, nickname: '원격' })

    await waitFor(() => node.getRendererEvents('peer-key-changed').length > 0)
    const evt = node.getRendererEvents('peer-key-changed')[0]
    expect(evt.data.peerId).toBe(REMOTE)
    expect(typeof evt.data.fingerprint).toBe('string')
    expect(evt.data.fingerprint.length).toBeGreaterThan(0)

    // 자동 교체 금지 — 세션 맵/DB 는 여전히 이전 키, 새 키는 보류에만.
    expect(mapKeyBase64(node, REMOTE)).toBe(keyA)
    expect(getPinnedKey(node.db, REMOTE)?.publicKey).toBe(keyA)
    expect(node.ctx.state.pendingKeyChangeMap.get(REMOTE)).toBe(keyB)

    c1.close(); c2.close()
  })

  it('사용자가 trust-peer-key 로 승인하면 고정 키/세션 맵을 새 키로 교체한다', async () => {
    node = await createNode({ peerId: 'host-tofu-4', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')

    const keyA = makeKeyBase64()
    const keyB = makeKeyBase64()

    const c1 = await openClient(node.port)
    sendHello(c1, { peerId: REMOTE, publicKey: keyA, nickname: '원격' })
    await waitFor(() => node.ctx.state.peerPublicKeyMap.has(REMOTE))

    const c2 = await openClient(node.port)
    sendHello(c2, { peerId: REMOTE, publicKey: keyB, nickname: '원격' })
    await waitFor(() => node.ctx.state.pendingKeyChangeMap.has(REMOTE))

    // 승인
    const result = await node.callIpc('trust-peer-key', { peerId: REMOTE })
    expect(result).toEqual({ success: true })

    // 새 키로 갱신 + 보류 해제
    expect(getPinnedKey(node.db, REMOTE)?.publicKey).toBe(keyB)
    expect(mapKeyBase64(node, REMOTE)).toBe(keyB)
    expect(node.ctx.state.pendingKeyChangeMap.has(REMOTE)).toBe(false)

    // 승인 후 새 키로 재연결하면 더 이상 경고가 없어야 한다.
    node.clearRendererEvents()
    const c3 = await openClient(node.port)
    sendHello(c3, { peerId: REMOTE, publicKey: keyB, nickname: '원격' })
    await new Promise(r => setTimeout(r, 250))
    expect(node.getRendererEvents('peer-key-changed')).toHaveLength(0)

    c1.close(); c2.close(); c3.close()
  })

  it('보류 중인 변경이 없으면 trust-peer-key 는 실패를 반환한다', async () => {
    node = await createNode({ peerId: 'host-tofu-5', nickname: '호스트' })
    await node.callIpc('start-peer-discovery')
    const result = await node.callIpc('trust-peer-key', { peerId: 'nobody' })
    expect(result.success).toBe(false)
  })
})
