// lanchat:// 프로토콜 헬퍼 단위 테스트
// (실제 protocol.handle 동작은 Electron 런타임 필요 — 통합 테스트로 별도)

// electron 모듈은 main process 전용이라 jest 환경에서 require 시 실패.
// guessMime / buildLanChatUrl 만 분리 테스트하기 위해 electron 을 mock.
jest.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: jest.fn(),
    handle: jest.fn(),
  },
}))

const { buildLanChatUrl, guessMime, SCHEME, createDecryptedCache, parseRange } = require('../../electron/protocol/lanchatProtocol')

// 테스트 헬퍼 — 지정 바이트 크기의 Buffer 생성
function buf(size, fill = 0) {
  return Buffer.alloc(size, fill)
}

describe('buildLanChatUrl', () => {
  it('messageId 가 lanchat://file/<id> 형태로 인코딩됨', () => {
    expect(buildLanChatUrl('abc-123')).toBe('lanchat://file/abc-123')
  })

  it('특수문자가 들어 있어도 안전하게 인코딩', () => {
    const url = buildLanChatUrl('a/b c?d')
    expect(url).toBe('lanchat://file/a%2Fb%20c%3Fd')
    expect(url.startsWith(`${SCHEME}://`)).toBe(true)
  })
})

describe('guessMime', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['movie.mp4', 'video/mp4'],
    ['movie.webm', 'video/webm'],
    ['sound.mp3', 'audio/mpeg'],
    ['sound.wav', 'audio/wav'],
    ['clip.mkv', 'video/x-matroska'],
    ['clip.avi', 'video/x-msvideo'],
    ['unknown.bin', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (fileName, expected) => {
    expect(guessMime(fileName)).toBe(expected)
  })
})

describe('parseRange', () => {
  const TOTAL = 1000

  it('bytes=0- → 0부터 끝까지', () => {
    expect(parseRange('bytes=0-', TOTAL)).toEqual({ start: 0, end: 999 })
  })

  it('bytes=100-199 → 구간 그대로(inclusive)', () => {
    expect(parseRange('bytes=100-199', TOTAL)).toEqual({ start: 100, end: 199 })
  })

  it('bytes=-500 → 마지막 500바이트(suffix)', () => {
    expect(parseRange('bytes=-500', TOTAL)).toEqual({ start: 500, end: 999 })
  })

  it('end 가 파일 끝을 넘으면 마지막 바이트로 클램프', () => {
    expect(parseRange('bytes=900-5000', TOTAL)).toEqual({ start: 900, end: 999 })
  })

  it('suffix 길이가 파일보다 크면 전체로 클램프', () => {
    expect(parseRange('bytes=-5000', TOTAL)).toEqual({ start: 0, end: 999 })
  })

  it.each([
    ['헤더 없음(null)', null],
    ['빈 문자열', ''],
    ['접두어 없음', '100-199'],
    ['잘못된 단위', 'items=0-10'],
    ['양쪽 공백', 'bytes=-'],
    ['다중 range 미지원', 'bytes=0-99,200-299'],
    ['start 가 파일 범위 밖', 'bytes=1000-1100'],
    ['start > end', 'bytes=500-100'],
    ['suffix 0바이트', 'bytes=-0'],
    ['숫자 아님', 'bytes=abc-def'],
  ])('%s → null', (_label, header) => {
    expect(parseRange(header, TOTAL)).toBeNull()
  })

  it('totalSize 가 0 이하이면 null', () => {
    expect(parseRange('bytes=0-', 0)).toBeNull()
  })
})

describe('createDecryptedCache', () => {
  it('put 한 버퍼를 get 으로 그대로 반환한다(캐시 히트)', () => {
    const cache = createDecryptedCache()
    const value = buf(10, 1)
    cache.put('a', value)
    expect(cache.get('a')).toBe(value)
  })

  it('미스면 undefined 를 반환한다', () => {
    const cache = createDecryptedCache()
    expect(cache.get('missing')).toBeUndefined()
  })

  it('개수 상한을 넘으면 가장 오래된 항목을 방출한다', () => {
    const cache = createDecryptedCache({ maxEntries: 2, maxBytes: 1024 })
    cache.put('a', buf(10))
    cache.put('b', buf(10))
    cache.put('c', buf(10)) // a 방출
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.size).toBe(2)
  })

  it('총 바이트 상한을 넘으면 LRU 순으로 방출한다', () => {
    const cache = createDecryptedCache({ maxEntries: 100, maxBytes: 100, maxEntryBytes: 100 })
    cache.put('a', buf(60))
    cache.put('b', buf(60)) // a(60)+b(60)=120 > 100 → a 방출
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.bytes).toBe(60)
  })

  it('get 은 항목을 최신으로 이동시켜 LRU 순서를 갱신한다', () => {
    const cache = createDecryptedCache({ maxEntries: 2, maxBytes: 1024 })
    cache.put('a', buf(10))
    cache.put('b', buf(10))
    cache.get('a') // a 를 최신으로 → 다음 방출 대상은 b
    cache.put('c', buf(10))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('단일 상한(maxEntryBytes)을 넘는 대용량 파일은 캐시에 넣지 않는다', () => {
    const cache = createDecryptedCache({ maxEntries: 10, maxBytes: 1000, maxEntryBytes: 100 })
    cache.put('big', buf(500))
    expect(cache.get('big')).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  it('같은 키를 다시 put 하면 바이트 회계가 갱신된다', () => {
    const cache = createDecryptedCache({ maxEntries: 10, maxBytes: 1000 })
    cache.put('a', buf(10))
    cache.put('a', buf(30))
    expect(cache.bytes).toBe(30)
    expect(cache.size).toBe(1)
  })

  it('clear 는 모든 항목과 바이트 회계를 비운다', () => {
    const cache = createDecryptedCache()
    cache.put('a', buf(10))
    cache.put('b', buf(20))
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})
