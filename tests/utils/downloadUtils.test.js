// tests/utils/downloadUtils.test.js
// resolveDownloadFileName 순수 로직 단위 테스트 — Electron 런타임 불필요.
const { resolveDownloadFileName } = require('../../electron/utils/downloadUtils')

describe('resolveDownloadFileName', () => {
  it('원본 file_name 이 있으면 그대로 사용', () => {
    expect(resolveDownloadFileName('사진.jpg', '/cache/abc-123.jpg')).toBe('사진.jpg')
  })

  it('file_name 이 없으면 캐시 경로의 basename 으로 폴백', () => {
    expect(resolveDownloadFileName(null, '/cache/abc-123.jpg')).toBe('abc-123.jpg')
    expect(resolveDownloadFileName(undefined, '/cache/abc-123.jpg')).toBe('abc-123.jpg')
    expect(resolveDownloadFileName('', '/cache/abc-123.jpg')).toBe('abc-123.jpg')
  })

  it('공백만 있는 file_name 도 폴백 처리', () => {
    expect(resolveDownloadFileName('   ', '/cache/abc-123.jpg')).toBe('abc-123.jpg')
  })

  it('file_name 과 캐시 경로 모두 없으면 기본값 반환', () => {
    expect(resolveDownloadFileName(null, null)).toBe('download')
    expect(resolveDownloadFileName(undefined, undefined)).toBe('download')
  })
})
