// tests/utils/urlGuard.test.js
// SSRF 가드 순수 로직 단위 테스트 (#66)
// - isBlockedIp: 사설/링크로컬/메타데이터/루프백/CGN + IPv6/IPv4-mapped 차단, 공인 IP 허용
// - isBlockedUrl: 스킴 제한 + IP 리터럴/localhost 차단, 일반 공인 호스트 허용
// - isBlockedUrlAsync: DNS 조회 결과가 사설이면 차단(DNS rebinding 방어), 실패 시 차단
const { isBlockedIp, isBlockedUrl, isBlockedUrlAsync } = require('../../electron/utils/urlGuard')

describe('isBlockedIp — IPv4', () => {
  test.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '169.254.169.254', // AWS/GCP/Azure 메타데이터
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '100.64.0.1', // CGN 공유 대역
  ])('사설/링크로컬/메타데이터 IP 차단: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34', // example.com
    '172.15.0.1', // 172.16/12 바로 아래 → 공인
    '172.32.0.1', // 172.16/12 바로 위 → 공인
    '11.0.0.1',
    '126.0.0.1',
    '128.0.0.1',
  ])('공인 IP 허용: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('isBlockedIp — IPv6', () => {
  test.each([
    '::1', // 루프백
    '::', // 불특정
    'fc00::1', // ULA
    'fd12:3456::1', // ULA
    'fe80::1', // 링크로컬
    'febf::1', // 링크로컬 상한
    '::ffff:169.254.169.254', // IPv4-mapped 메타데이터(점표기)
    '::ffff:a9fe:a9fe', // IPv4-mapped 메타데이터(16진) = 169.254.169.254
    '::ffff:127.0.0.1', // IPv4-mapped 루프백
    '::ffff:10.0.0.1', // IPv4-mapped 사설
  ])('사설/링크로컬/루프백/매핑 IPv6 차단: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  test.each([
    '2606:2800:220:1:248:1893:25c8:1946', // example.com AAAA
    '2001:4860:4860::8888', // Google DNS
    '::ffff:8.8.8.8', // IPv4-mapped 공인
  ])('공인 IPv6 허용: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('isBlockedIp — 잘못된 입력', () => {
  test.each(['not-an-ip', '', '999.999.999.999', '10.0.0'])('IP 가 아니면 차단: %s', (v) => {
    expect(isBlockedIp(v)).toBe(true)
  })
})

describe('isBlockedUrl (동기)', () => {
  test.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.5/',
    'https://192.168.1.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://localhost:3000/',
    'https://api.localhost/',
  ])('사설 IP 리터럴/localhost 차단: %s', (url) => {
    expect(isBlockedUrl(url)).toBe(true)
  })

  test.each([
    'ftp://example.com/file',
    'file:///etc/passwd',
    'lanchat://file/abc',
    'javascript:alert(1)',
    'data:text/html,hi',
    'not a url',
  ])('http/https 외 스킴·파싱불가 차단: %s', (url) => {
    expect(isBlockedUrl(url)).toBe(true)
  })

  test.each([
    'https://example.com/',
    'http://naver.com/path?q=1',
    'https://8.8.8.8/',
  ])('공인 호스트/IP 는 통과(false): %s', (url) => {
    expect(isBlockedUrl(url)).toBe(false)
  })
})

describe('isBlockedUrlAsync (DNS rebinding 방어)', () => {
  test('호스트명이 사설 IP 로 resolve 되면 차단', async () => {
    const fakeLookup = async () => [{ address: '10.0.0.9', family: 4 }]
    expect(await isBlockedUrlAsync('http://rebind.evil.test/', { lookup: fakeLookup })).toBe(true)
  })

  test('호스트명이 메타데이터 IP 로 resolve 되면 차단', async () => {
    const fakeLookup = async () => [{ address: '169.254.169.254', family: 4 }]
    expect(await isBlockedUrlAsync('https://metadata.evil.test/', { lookup: fakeLookup })).toBe(true)
  })

  test('여러 IP 중 하나라도 사설이면 차단', async () => {
    const fakeLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    expect(await isBlockedUrlAsync('http://mixed.evil.test/', { lookup: fakeLookup })).toBe(true)
  })

  test('모든 IP 가 공인이면 통과', async () => {
    const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }]
    expect(await isBlockedUrlAsync('https://example.com/', { lookup: fakeLookup })).toBe(false)
  })

  test('DNS 조회 실패 시 차단', async () => {
    const failLookup = async () => { throw new Error('ENOTFOUND') }
    expect(await isBlockedUrlAsync('https://broken.evil.test/', { lookup: failLookup })).toBe(true)
  })

  test('resolve 결과가 비어 있으면 차단', async () => {
    const emptyLookup = async () => []
    expect(await isBlockedUrlAsync('https://empty.evil.test/', { lookup: emptyLookup })).toBe(true)
  })

  test('스킴이 http/https 가 아니면 DNS 조회 없이 차단', async () => {
    let called = false
    const spyLookup = async () => { called = true; return [{ address: '8.8.8.8', family: 4 }] }
    expect(await isBlockedUrlAsync('ftp://example.com/', { lookup: spyLookup })).toBe(true)
    expect(called).toBe(false)
  })

  test('공인 IP 리터럴은 DNS 조회 없이 통과', async () => {
    let called = false
    const spyLookup = async () => { called = true; return [] }
    expect(await isBlockedUrlAsync('https://8.8.8.8/', { lookup: spyLookup })).toBe(false)
    expect(called).toBe(false)
  })
})
