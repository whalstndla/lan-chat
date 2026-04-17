const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario 8: 오프라인 큐 flush', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('오프라인 DM 이후 피어 연결 시 자동 flush', async () => {
    // A는 discovery 시작, B는 아직 없음
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    await nodeA.callIpc('start-peer-discovery')

    // A → B DM 시도 (B 공개키 없음 → pending 큐)
    const sent = await nodeA.callIpc('send-dm', {
      recipientPeerId: 'peer-b',
      content: '너 없을 때 남긴 메시지',
      contentType: 'text',
    })
    expect(sent.pending).toBe(true)

    // pending 큐에 저장 확인
    const pending = nodeA.db.prepare('SELECT * FROM pending_messages WHERE target_peer_id=?').all('peer-b')
    expect(pending.length).toBe(1)

    // B 등장
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    await nodeB.callIpc('start-peer-discovery')

    // A가 B를 발견
    emitDiscovery(nodeA, nodeB)

    // key-exchange 완료 → flush 실행
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))

    // B가 pending 메시지를 수신할 때까지 대기
    await waitFor(() => {
      const events = nodeB.getRendererEvents('message-received')
      return events.some(e => e.data.content === '너 없을 때 남긴 메시지')
    })

    // A의 pending 큐 비워짐
    await waitFor(() => {
      const remaining = nodeA.db.prepare('SELECT * FROM pending_messages WHERE target_peer_id=?').all('peer-b')
      return remaining.length === 0
    })
  })
})
