// tests/peer/discovery.test.js
const { startPeerDiscovery, stopPeerDiscovery } = require('../../electron/peer/discovery')

describe('피어 발견', () => {
  it('발견 모듈이 정상 임포트됨', () => {
    expect(typeof startPeerDiscovery).toBe('function')
    expect(typeof stopPeerDiscovery).toBe('function')
  })
})
