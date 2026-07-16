const { buildHello, parseHello, WIRE_VERSION } = require('../../electron/peer/wire')

describe('wire protocol v2', () => {
  const validHello = {
    peerId: 'peer-abc',
    sessionId: 'sess-123',
    publicKey: 'AAAA',
    nickname: '앨리스',
    wsPort: 49152,
    filePort: 49153,
    addresses: ['192.168.0.10'],
    profileImageUrl: null,
    capabilities: ['dm', 'reactions'],
  }

  it('buildHello는 v2 hello 메시지를 생성한다', () => {
    const msg = buildHello(validHello)
    expect(msg.type).toBe('hello')
    expect(msg.v).toBe(2)
    expect(msg.fromId).toBe('peer-abc')
    expect(msg.sessionId).toBe('sess-123')
    expect(msg.publicKey).toBe('AAAA')
    expect(msg.nickname).toBe('앨리스')
    expect(msg.capabilities).toEqual(['dm', 'reactions'])
  })

  it('parseHello 는 유효한 v2 메시지를 파싱한다', () => {
    const built = buildHello(validHello)
    const parsed = parseHello(built)
    expect(parsed.ok).toBe(true)
    expect(parsed.hello.peerId).toBe('peer-abc')
    expect(parsed.hello.sessionId).toBe('sess-123')
    expect(parsed.hello.capabilities).toEqual(['dm', 'reactions'])
  })

  it('parseHello 는 v1 메시지를 거부한다', () => {
    const v1Message = { type: 'key-exchange', fromId: 'peer-abc', publicKey: 'AAAA' }
    const parsed = parseHello(v1Message)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toMatch(/version|v1|type/i)
  })

  it('parseHello 는 v3(미래 버전) 메시지를 거부한다', () => {
    const v3 = { ...buildHello(validHello), v: 3 }
    const parsed = parseHello(v3)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toMatch(/version/i)
  })

  it('parseHello 는 필수 필드 누락을 거부한다', () => {
    const built = buildHello(validHello)
    delete built.sessionId
    const parsed = parseHello(built)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toMatch(/sessionId/i)
  })

  it('parseHello 는 wsPort 타입 검증한다', () => {
    const built = buildHello(validHello)
    built.wsPort = 'not-a-number'
    const parsed = parseHello(built)
    expect(parsed.ok).toBe(false)
  })

  it('WIRE_VERSION 은 2이다', () => {
    expect(WIRE_VERSION).toBe(2)
  })
})
