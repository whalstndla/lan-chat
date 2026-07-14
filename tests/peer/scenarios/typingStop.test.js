const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario: 메시지 전송 시 typing-stop 즉시 정지 신호', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('DM 전송(A→B) 시 B에게 typing-stop(to=B) 이 전달됨', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    nodeB.clearRendererEvents()

    await nodeA.callIpc('send-dm', {
      recipientPeerId: 'peer-b',
      content: '메시지 보냄',
      contentType: 'text',
    })

    await waitFor(() => nodeB.getRendererEvents('typing-stop').length > 0)

    const events = nodeB.getRendererEvents('typing-stop')
    expect(events[0].data).toEqual({ fromId: 'peer-a', to: 'peer-b' })
  })

  it('전체채팅 전송(A) 시 연결된 B에게 typing-stop(to=null) 이 브로드캐스트됨', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    nodeB.clearRendererEvents()

    await nodeA.callIpc('send-global-message', {
      content: '전체채팅 메시지',
      contentType: 'text',
    })

    await waitFor(() => nodeB.getRendererEvents('typing-stop').length > 0)

    const events = nodeB.getRendererEvents('typing-stop')
    expect(events[0].data).toEqual({ fromId: 'peer-a', to: null })
  })
})
