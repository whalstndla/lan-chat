// Smoke test — 하네스 인프라 자체를 검증
const { createNode } = require('../harness')

describe('harness smoke test', () => {
  it('노드 2개를 띄우고 각자 고유한 포트를 갖는다', async () => {
    const nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    try {
      expect(nodeA.port).toBeGreaterThan(0)
      expect(nodeB.port).toBeGreaterThan(0)
      expect(nodeA.port).not.toBe(nodeB.port)
      expect(nodeA.db).toBeDefined()
      expect(nodeB.db).toBeDefined()
    } finally {
      await nodeA.shutdown()
      await nodeB.shutdown()
    }
  })

  it('start-peer-discovery IPC가 등록되어 있다', async () => {
    const node = await createNode({ peerId: 'peer-c', nickname: '찰리' })
    try {
      expect(node.handlers.has('start-peer-discovery')).toBe(true)
      expect(node.handlers.has('send-global-message')).toBe(true)
      expect(node.handlers.has('send-dm')).toBe(true)
    } finally {
      await node.shutdown()
    }
  })

  it('start-peer-discovery 호출 시 fakeDiscovery가 시작된다', async () => {
    const node = await createNode({ peerId: 'peer-d', nickname: '대니' })
    try {
      expect(node.fakeDiscovery.isStarted()).toBe(false)
      await node.callIpc('start-peer-discovery')
      expect(node.fakeDiscovery.isStarted()).toBe(true)
    } finally {
      await node.shutdown()
    }
  })
})
