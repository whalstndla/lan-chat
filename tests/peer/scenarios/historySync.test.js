// #31 전체채팅 히스토리 동기화 시나리오 테스트.
// hello 핸드셰이크 완료 직후 history-sync-request/response 로 서로 놓친 전체채팅을 교환한다.
//
// 검증:
//  - B(0개)가 A(3개)에 연결하면 A 의 3개를 동기화받는다 (핵심 use case)
//  - 뒤처진 B(prefix 1개)가 A(3개)로 수렴하고 공유 메시지는 중복되지 않는다
//  - 이미 최신인 피어끼리는 중복이 생기지 않는다 (3중 dedup)
//  - 양쪽이 서로 요청해도(양방향) 안전하며, 뒤처진 쪽이 catch-up 된다

const { createNode, emitDiscovery } = require('../harness')
const { saveMessage } = require('../../../electron/storage/queries')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

// 특정 노드 DB 에 전체채팅 메시지 하나를 미리 넣어 "이전 세션에서 보유하던 상태"를 재현한다.
function seedGlobalMessage(node, { id, timestamp, content = '메시지', fromId = 'seed-sender', fromName = '시드' }) {
  saveMessage(node.db, {
    id, type: 'message', from_id: fromId, from_name: fromName,
    to_id: null, content, content_type: 'text',
    encrypted_payload: null, file_url: null, file_name: null, timestamp,
  })
}

// 노드 DB 의 전체채팅 메시지 id 목록(timestamp ASC)
function globalIds(node) {
  return node.db
    .prepare("SELECT id FROM messages WHERE type = 'message' ORDER BY timestamp ASC")
    .all()
    .map(r => r.id)
}

describe('Scenario: #31 전체채팅 히스토리 동기화', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('B(0개)가 A(3개)에 연결하면 A 의 전체채팅 3개를 동기화받는다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // A 는 이전에 받은 전체채팅 3개를 보유, B 는 0개
    seedGlobalMessage(nodeA, { id: 'g1', timestamp: 1000, content: '첫째' })
    seedGlobalMessage(nodeA, { id: 'g2', timestamp: 2000, content: '둘째' })
    seedGlobalMessage(nodeA, { id: 'g3', timestamp: 3000, content: '셋째' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    // 키교환 완료
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // B 의 DB 가 A 의 3개로 수렴
    await waitFor(() => globalIds(nodeB).length === 3)
    expect(globalIds(nodeB)).toEqual(['g1', 'g2', 'g3'])

    // 렌더러에도 배치 반영 이벤트가 발행됨 (mergeGlobalMessages 로 화면 병합)
    const syncedEvents = nodeB.getRendererEvents('global-history-synced')
    const allSynced = syncedEvents.flatMap(e => e.data.map(m => m.id))
    expect(allSynced).toEqual(expect.arrayContaining(['g1', 'g2', 'g3']))

    // A 는 변화 없음 (B 는 보낼 게 없어 응답을 생략 → A 는 추가 메시지 없음)
    expect(globalIds(nodeA)).toEqual(['g1', 'g2', 'g3'])
  })

  it('뒤처진 B(prefix 1개)가 연결 시 A(3개)로 수렴하고 공유 메시지는 중복되지 않는다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // A 는 3개, B 는 가장 오래된 1개만 보유(=B 는 이후 메시지를 놓친 상태)
    seedGlobalMessage(nodeA, { id: 'g1', timestamp: 1000 })
    seedGlobalMessage(nodeA, { id: 'g2', timestamp: 2000 })
    seedGlobalMessage(nodeA, { id: 'g3', timestamp: 3000 })
    seedGlobalMessage(nodeB, { id: 'g1', timestamp: 1000 })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // B 는 since=1000 으로 요청 → A 가 g1,g2,g3(>=1000) 응답 → g1 은 이미 있어 INSERT OR IGNORE 로 무시
    await waitFor(() => globalIds(nodeB).length === 3)
    expect(globalIds(nodeB)).toEqual(['g1', 'g2', 'g3'])

    // g1 이 중복 저장되지 않았는지 (dedup): 정확히 1행
    const g1Count = nodeB.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = 'g1'").get().c
    expect(g1Count).toBe(1)
  })

  it('이미 최신인 피어끼리 연결해도 중복 메시지가 생기지 않는다 (3중 dedup)', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // 두 노드가 완전히 동일한 3개를 이미 보유
    for (const node of [nodeA, nodeB]) {
      seedGlobalMessage(node, { id: 'g1', timestamp: 1000 })
      seedGlobalMessage(node, { id: 'g2', timestamp: 2000 })
      seedGlobalMessage(node, { id: 'g3', timestamp: 3000 })
    }

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // 동기화가 오갈 시간을 준 뒤에도 양쪽 모두 정확히 3개
    await new Promise(r => setTimeout(r, 400))
    expect(globalIds(nodeA)).toEqual(['g1', 'g2', 'g3'])
    expect(globalIds(nodeB)).toEqual(['g1', 'g2', 'g3'])

    // 어느 쪽도 중복 행이 없다
    for (const node of [nodeA, nodeB]) {
      const dup = node.db.prepare(
        "SELECT id, COUNT(*) AS c FROM messages WHERE type='message' GROUP BY id HAVING c > 1"
      ).all()
      expect(dup).toEqual([])
    }
  })

  it('양방향: 각자 상대가 가진 최신 메시지를 요청해도 안전하며 뒤처진 쪽이 catch-up 된다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // 공유 메시지 g0 + A 만 가진 최신 aOnly. B 는 g0 + 자기만의 bMid(중간 시점).
    seedGlobalMessage(nodeA, { id: 'g0', timestamp: 1000 })
    seedGlobalMessage(nodeA, { id: 'aOnly', timestamp: 3000 })
    seedGlobalMessage(nodeB, { id: 'g0', timestamp: 1000 })
    seedGlobalMessage(nodeB, { id: 'bMid', timestamp: 2000 })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)

    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))

    // B 의 latest=2000 → A 에 since=2000 요청 → A 가 aOnly(3000) 응답 → B 가 catch-up
    await waitFor(() => globalIds(nodeB).includes('aOnly'))
    expect(globalIds(nodeB)).toEqual(['g0', 'bMid', 'aOnly'])

    // 공유 g0 은 B 에서 중복되지 않는다
    const g0Count = nodeB.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = 'g0'").get().c
    expect(g0Count).toBe(1)
  })
})
