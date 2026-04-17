const { createNode, emitDiscovery } = require('../harness')

// 주어진 조건이 true가 될 때까지 폴링 (최대 timeoutMs)
async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario 1: 연결 + key-exchange', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('A가 B를 발견하면 연결 + 양방향 key-exchange 완료', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // 양쪽 discovery 시작
    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')

    // A가 B를 발견했다고 시뮬레이션
    emitDiscovery(nodeA, nodeB)

    // A가 B에게 연결 + key-exchange 송신 → B가 reply + 역방향 연결 → 양쪽 publicKey 저장
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // 양쪽 렌더러에 peer-discovered 이벤트 발행
    const aDiscovered = nodeA.getRendererEvents('peer-discovered')
    const bDiscovered = nodeB.getRendererEvents('peer-discovered')
    expect(aDiscovered.some(e => e.data.peerId === 'peer-b')).toBe(true)
    expect(bDiscovered.some(e => e.data.peerId === 'peer-a')).toBe(true)
  })
})
