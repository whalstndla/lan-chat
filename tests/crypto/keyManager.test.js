// tests/crypto/keyManager.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const { loadOrCreateKeyPair, exportPublicKey } = require('../../electron/crypto/keyManager')

describe('키 관리', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('최초 실행 시 키 쌍을 생성하고 파일로 저장함', () => {
    const { publicKey } = loadOrCreateKeyPair(tempDir)
    expect(fs.existsSync(path.join(tempDir, 'private_key.pem'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'public_key.pem'))).toBe(true)
    expect(publicKey).toBeDefined()
  })

  it('두 번째 실행 시 기존 키를 로드함 (새로 생성 안 함)', () => {
    loadOrCreateKeyPair(tempDir)
    const firstMtime = fs.statSync(path.join(tempDir, 'private_key.pem')).mtimeMs

    const secondResult = loadOrCreateKeyPair(tempDir)
    const secondMtime = fs.statSync(path.join(tempDir, 'private_key.pem')).mtimeMs

    expect(firstMtime).toBe(secondMtime)
  })

  it('공개키를 base64 문자열로 내보낼 수 있음', () => {
    const { publicKey } = loadOrCreateKeyPair(tempDir)
    const base64PublicKey = exportPublicKey(publicKey)
    expect(typeof base64PublicKey).toBe('string')
    expect(base64PublicKey.length).toBeGreaterThan(0)
  })
})
