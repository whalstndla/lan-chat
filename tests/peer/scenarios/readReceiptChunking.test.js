const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario: send-read-receipt 가 500개 초과 messageIds 를 청크로 분할 처리', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('900개 messageIds 전송 시 모두 DB read=1 로 갱신되고 상대에게 모두 전달됨', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // B가 A에게 보낸 것으로 가정한 안읽은 DM 메시지 900개를 A의 DB에 직접 삽입
    // (실제 IPC 왕복 없이 read-receipt 청크 분할 동작만 검증)
    const messageIds = []
    const insert = nodeA.db.prepare(`
      INSERT INTO messages (id, type, from_id, from_name, to_id, content, content_type, timestamp, read)
      VALUES (?, 'dm', 'peer-b', '밥', 'peer-a', '내용', 'text', ?, 0)
    `)
    for (let i = 0; i < 900; i++) {
      const id = `msg-${i}`
      messageIds.push(id)
      insert.run(id, Date.now())
    }

    // 기존에는 messageIds.length > 500 이면 아무 것도 하지 않고 조용히 실패했다.
    await nodeA.callIpc('send-read-receipt', { targetPeerId: 'peer-b', messageIds })

    // A의 DB — 900개 전부 read=1 로 갱신되어야 함
    const unreadRemaining = nodeA.db.prepare("SELECT COUNT(*) AS cnt FROM messages WHERE type='dm' AND read=0").get()
    expect(unreadRemaining.cnt).toBe(0)

    // B가 read-receipt 이벤트로 900개 messageId 를 모두 수신했는지 확인 (여러 청크로 나뉘어 도착 가능)
    await waitFor(() => {
      const events = nodeB.getRendererEvents('read-receipt')
      const total = events.reduce((sum, e) => sum + e.data.messageIds.length, 0)
      return total === 900
    })

    const events = nodeB.getRendererEvents('read-receipt')
    // 단일 청크 최대 크기(400)를 넘지 않아야 함 — SQLite 변수 한도 방지 목적
    events.forEach(e => expect(e.data.messageIds.length).toBeLessThanOrEqual(400))
    // 여러 청크로 나뉘었는지 확인 (900 / 400 → 최소 3개 청크)
    expect(events.length).toBeGreaterThanOrEqual(3)
  })
})
