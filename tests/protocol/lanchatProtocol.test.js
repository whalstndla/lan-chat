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

const { buildLanChatUrl, guessMime, SCHEME } = require('../../electron/protocol/lanchatProtocol')

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
    ['unknown.bin', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (fileName, expected) => {
    expect(guessMime(fileName)).toBe(expected)
  })
})
