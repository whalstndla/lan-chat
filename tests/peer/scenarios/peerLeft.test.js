const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario 2: peer-left 1회', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('B 종료 시 A의 렌더러에 peer-left가 정확히 1회 발행된다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))

    nodeA.clearRendererEvents()

    // B shutdown
    await nodeB.shutdown()
    nodeB = null

    // A측 소켓 close 감지까지 대기 — hasPeerConnection 이 false 가 되어야
    // ipcHandlers/peer.js의 onPeerLeft 콜백이 peer-left 를 발행함.
    await waitFor(() => !nodeA.hasAnyConnection('peer-b'))

    // fake discovery 를 통한 peer-left 명시 emit (실제 mDNS down 이벤트 시뮬)
    nodeA.fakeDiscovery.emitPeerLeft('peer-b')

    // peer-left 가 발행될 때까지 잠시 대기
    await new Promise(r => setTimeout(r, 100))

    const peerLeftEvents = nodeA.getRendererEvents('peer-left').filter(e => e.data === 'peer-b')
    expect(peerLeftEvents.length).toBe(1)
  })
})
