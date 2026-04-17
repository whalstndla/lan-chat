const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario 4: 동시 discovery race', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('같은 peer에 대한 2회 emit도 단일 연결만 유지한다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')

    // 연속 2회 발견 이벤트
    emitDiscovery(nodeA, nodeB)
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))

    // key-exchange 완료 후 약간 대기 — 만약 second emit 이 뒤늦게 별도 연결을 만들었다면 드러남
    await new Promise(r => setTimeout(r, 300))

    // peerPublicKeyMap 에는 "peer-b" 키 1개만
    expect(nodeA.ctx.state.peerPublicKeyMap.size).toBe(1)

    // 중복 소켓 없이 outbound 1개만
    expect(nodeA.getOutboundConnections().filter(p => p === 'peer-b').length).toBe(1)
  })
})
