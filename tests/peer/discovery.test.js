// tests/peer/discovery.test.js
const { 피어발견시작, 피어발견중지 } = require('../../electron/peer/discovery')

describe('피어 발견', () => {
  it('발견 모듈이 정상 임포트됨', () => {
    expect(typeof 피어발견시작).toBe('function')
    expect(typeof 피어발견중지).toBe('function')
  })
})
