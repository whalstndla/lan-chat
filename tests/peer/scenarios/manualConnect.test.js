// tests/peer/scenarios/manualConnect.test.js
// #33 — 수동 IP 입력 피어 연결. mDNS/UDP 브로드캐스트 "발견" 이벤트를 전혀 emit 하지 않고
// host:port 만으로 connect-manual-peer IPC 를 호출해, 기존 hello 역방향 연결 로직을 통해
// 정식 세션(양방향 publicKey 교환 + READY 상태)이 확정되는지 검증한다.
const { createNode } = require('../harness')

// 주어진 조건이 true가 될 때까지 폴링 (최대 timeoutMs)
async function waitFor(condition, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario: 수동 피어 연결(#33)', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  it('mDNS/브로드캐스트 발견 없이 host:port 만으로 연결하면 hello로 양방향 세션이 확정된다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    // 실제 앱과 동일하게 로그인 후 discovery 는 시작되지만(mySessionId/PeerManager 준비),
    // emitDiscovery 는 호출하지 않는다 — mDNS/UDP 가 완전히 막힌 상황을 재현.
    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')

    // 발견 없이, 사용자가 IP를 직접 입력해 연결 (오직 host:port 만 안다)
    const result = await nodeA.callIpc('connect-manual-peer', { host: '127.0.0.1', wsPort: nodeB.port })
    expect(result).toEqual({ ok: true })

    // A의 probe → B의 hello 응답 → A의 hello 처리(역방향 연결) → B가 다시 역방향 연결
    // 이 과정을 거쳐 양쪽 모두 상대 publicKey 를 확보해야 한다
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))
    await waitFor(() => nodeA.hasAnyConnection('peer-b'))
    await waitFor(() => nodeB.hasAnyConnection('peer-a'))

    // PeerManager 세션도 READY 로 확정되어야 함 (자동 발견 경로와 동일한 결과)
    const aSession = nodeA.ctx.state.peerManager.getSession('peer-b')
    expect(aSession).toBeDefined()
    expect(aSession.state).toBe('READY')

    const bSession = nodeB.ctx.state.peerManager.getSession('peer-a')
    expect(bSession).toBeDefined()
    expect(bSession.state).toBe('READY')

    // probe 소켓은 1회성이므로 A의 outbound connectionMap 에는 실제 peerId('peer-b')만
    // 남아야 한다 — 임시 식별자로 오염된 채 남아있으면 안 됨
    expect(nodeA.getOutboundConnections()).toEqual(['peer-b'])

    // 양쪽 렌더러에도 peer-discovered 이벤트가 발행되어야 UI가 갱신된다
    expect(nodeA.getRendererEvents('peer-discovered').some(e => e.data.peerId === 'peer-b')).toBe(true)
    expect(nodeB.getRendererEvents('peer-discovered').some(e => e.data.peerId === 'peer-a')).toBe(true)
  }, 15000)

  it('상대가 없는 포트로 연결하면 ok:false 와 실패 사유를 반환한다', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    await nodeA.callIpc('start-peer-discovery')

    // 127.0.0.1:1 — 리스닝 중인 서비스가 없어 즉시 실패
    const result = await nodeA.callIpc('connect-manual-peer', { host: '127.0.0.1', wsPort: 1 })
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  }, 10000)

  it('기존 자동 발견 경로와 공존한다 — 수동 연결 이후에도 discovery IPC가 정상 동작', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')

    const result = await nodeA.callIpc('connect-manual-peer', { host: '127.0.0.1', wsPort: nodeB.port })
    expect(result.ok).toBe(true)
    await waitFor(() => nodeA.hasAnyConnection('peer-b'))

    // 수동 연결 이후에도 재검색(start-peer-discovery 재호출)이 예외 없이 동작해야 한다
    await expect(nodeA.callIpc('start-peer-discovery')).resolves.toBeUndefined()
  }, 15000)
})
