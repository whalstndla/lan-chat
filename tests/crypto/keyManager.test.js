// tests/crypto/keyManager.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const { 키쌍생성또는로드, 공개키내보내기 } = require('../../electron/crypto/keyManager')

describe('키 관리', () => {
  let 임시폴더

  beforeEach(() => {
    임시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'key-test-'))
  })

  afterEach(() => {
    fs.rmSync(임시폴더, { recursive: true, force: true })
  })

  it('최초 실행 시 키 쌍을 생성하고 파일로 저장함', () => {
    const { 공개키객체 } = 키쌍생성또는로드(임시폴더)
    expect(fs.existsSync(path.join(임시폴더, 'private_key.pem'))).toBe(true)
    expect(fs.existsSync(path.join(임시폴더, 'public_key.pem'))).toBe(true)
    expect(공개키객체).toBeDefined()
  })

  it('두 번째 실행 시 기존 키를 로드함 (새로 생성 안 함)', () => {
    키쌍생성또는로드(임시폴더)
    const 첫번째수정시간 = fs.statSync(path.join(임시폴더, 'private_key.pem')).mtimeMs

    // 1ms 대기 후 다시 로드
    const 두번째결과 = 키쌍생성또는로드(임시폴더)
    const 두번째수정시간 = fs.statSync(path.join(임시폴더, 'private_key.pem')).mtimeMs

    expect(첫번째수정시간).toBe(두번째수정시간)
  })

  it('공개키를 base64 문자열로 내보낼 수 있음', () => {
    const { 공개키객체 } = 키쌍생성또는로드(임시폴더)
    const base64공개키 = 공개키내보내기(공개키객체)
    expect(typeof base64공개키).toBe('string')
    expect(base64공개키.length).toBeGreaterThan(0)
  })
})
