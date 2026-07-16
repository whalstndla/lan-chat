const { createNode } = require('../harness')

describe('Scenario: 메시지 입력 검증 실패 시 null 대신 { ok:false, error } 반환', () => {
  let nodeA

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    nodeA = null
  })

  it('send-global-message — 10000자 초과 시 { ok:false, error:"contentTooLong" } 반환', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const tooLong = 'a'.repeat(10001)
    const result = await nodeA.callIpc('send-global-message', { content: tooLong, contentType: 'text' })
    expect(result).toEqual({ ok: false, error: 'contentTooLong' })
  })

  it('send-global-message — 허용되지 않은 contentType 이면 { ok:false, error:"invalidContentType" } 반환', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const result = await nodeA.callIpc('send-global-message', { content: '안녕', contentType: 'not-allowed' })
    expect(result).toEqual({ ok: false, error: 'invalidContentType' })
  })

  it('send-global-message — 정상 입력이면 메시지 객체를 그대로 반환(ok 필드 없음)', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const result = await nodeA.callIpc('send-global-message', { content: '안녕', contentType: 'text' })
    expect(result.ok).toBeUndefined()
    expect(result.content).toBe('안녕')
  })

  it('send-dm — 10000자 초과 시 { ok:false, error:"contentTooLong" } 반환', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const tooLong = 'a'.repeat(10001)
    const result = await nodeA.callIpc('send-dm', { recipientPeerId: 'peer-b', content: tooLong, contentType: 'text' })
    expect(result).toEqual({ ok: false, error: 'contentTooLong' })
  })

  it('send-dm — 허용되지 않은 contentType 이면 { ok:false, error:"invalidContentType" } 반환', async () => {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    const result = await nodeA.callIpc('send-dm', { recipientPeerId: 'peer-b', content: '안녕', contentType: 'not-allowed' })
    expect(result).toEqual({ ok: false, error: 'invalidContentType' })
  })
})
