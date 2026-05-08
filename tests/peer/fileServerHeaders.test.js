// fileServer 의 응답 헤더 분기 단위 테스트
// - 미디어 (image/video/audio) → inline (Content-Disposition 미설정)
// - 그 외 (html/svg/js/...) → attachment 강제

const path = require('path')
const { buildFileHeaders, INLINE_SAFE_EXT } = require('../../electron/peer/fileServer')

function makeFakeRes() {
  const headers = {}
  return {
    headers,
    set(name, value) { headers[name.toLowerCase()] = value },
  }
}

describe('buildFileHeaders', () => {
  it.each([
    'foo.png', 'foo.jpg', 'foo.jpeg', 'foo.gif', 'foo.webp', 'foo.bmp', 'foo.avif',
    'movie.mp4', 'movie.webm', 'movie.mov',
    'sound.mp3', 'sound.wav', 'sound.m4a',
  ])('%s → 인라인 표시 (Content-Disposition 없음)', (fileName) => {
    const res = makeFakeRes()
    buildFileHeaders(res, path.join('/tmp', fileName))
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  it.each([
    'foo.html', 'foo.htm', 'foo.svg', 'foo.js', 'foo.css', 'foo.zip', 'foo.exe',
    'foo.txt', 'foo.pdf', 'foo',
  ])('%s → attachment 강제 (XSS / 실행 위험 차단)', (fileName) => {
    const res = makeFakeRes()
    buildFileHeaders(res, path.join('/tmp', fileName))
    expect(res.headers['content-disposition']).toBe('attachment')
  })

  it('대소문자가 섞인 확장자도 정상 분기', () => {
    const res = makeFakeRes()
    buildFileHeaders(res, '/tmp/PHOTO.PNG')
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  it('INLINE_SAFE_EXT 에는 위험 확장자가 포함되지 않는다', () => {
    expect(INLINE_SAFE_EXT.has('.html')).toBe(false)
    expect(INLINE_SAFE_EXT.has('.svg')).toBe(false)
    expect(INLINE_SAFE_EXT.has('.js')).toBe(false)
  })
})
