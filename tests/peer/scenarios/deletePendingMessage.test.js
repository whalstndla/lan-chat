const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

describe('Scenario: 오프라인 대기 메시지를 삭제하면 재접속 후에도 배달되지 않음', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('A가 오프라인인 B에게 DM 후 삭제 → 이후 B가 온라인이 되어도 메시지를 받지 않음', async () => {
    // A만 존재 (B는 아직 없음)
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    await nodeA.callIpc('start-peer-discovery')

    // A → B DM (B 공개키 없음 → pending 큐)
    const sent = await nodeA.callIpc('send-dm', {
      recipientPeerId: 'peer-b',
      content: '이건 곧 지울 메시지',
      contentType: 'text',
    })
    expect(sent.pending).toBe(true)

    // pending 큐에 저장되었는지 확인
    let pending = nodeA.db.prepare('SELECT * FROM pending_messages WHERE target_peer_id=?').all('peer-b')
    expect(pending.length).toBe(1)

    // 삭제 — messages 뿐 아니라 pending_messages 도 함께 지워져야 함
    await nodeA.callIpc('delete-message', { messageId: sent.id, targetPeerId: 'peer-b' })

    pending = nodeA.db.prepare('SELECT * FROM pending_messages WHERE target_peer_id=?').all('peer-b')
    expect(pending.length).toBe(0)
    const messagesRow = nodeA.db.prepare('SELECT * FROM messages WHERE id=?').get(sent.id)
    expect(messagesRow).toBeUndefined()

    // B 등장 → A와 연결되어 flush 로직이 동작할 시간을 준다
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))

    // flush 가 동작할 시간을 충분히 준 뒤에도 B는 해당 메시지를 받지 않아야 한다
    await sleep(500)
    const receivedEvents = nodeB.getRendererEvents('message-received')
    expect(receivedEvents.some(e => e.data.content === '이건 곧 지울 메시지')).toBe(false)
  })
})
