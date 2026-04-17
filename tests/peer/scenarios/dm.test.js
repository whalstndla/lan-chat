const { createNode, emitDiscovery } = require('../harness')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario 7: DM 암호화 round-trip', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('A가 B에게 DM 송신 → B가 복호화 후 DB 저장 + renderer message-received 발행', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    // 양쪽 key-exchange 완료 대기
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    nodeB.clearRendererEvents()

    // A → B DM 송신
    const sent = await nodeA.callIpc('send-dm', {
      recipientPeerId: 'peer-b',
      content: '안녕 밥!',
      contentType: 'text',
    })
    expect(sent.content).toBe('안녕 밥!')
    expect(sent.fromId).toBe('peer-a')
    expect(sent.to).toBe('peer-b')

    // B에서 message-received 렌더러 이벤트 발행 대기
    await waitFor(() => {
      const events = nodeB.getRendererEvents('message-received')
      return events.some(e => e.data.content === '안녕 밥!' && e.data.fromId === 'peer-a')
    })

    // B DB에도 저장되었는지 확인 (암호문으로 저장)
    const rows = nodeB.db.prepare('SELECT * FROM messages WHERE type=? AND from_id=?').all('dm', 'peer-a')
    expect(rows.length).toBe(1)
    expect(rows[0].encrypted_payload).toBeTruthy()
    // content 컬럼은 null (암호문은 encrypted_payload에만 저장)
    expect(rows[0].content).toBeNull()
  })
})
