// tests/crypto/keyManager.test.js
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')
const {
  loadOrCreateKeyPair,
  exportPublicKey,
  loadOrCreateEncryptedKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  saveWrappedPrivateKey,
} = require('../../electron/crypto/keyManager')

const ENC_FILE = 'private_key.enc'
const PEM_FILE = 'private_key.pem'
const PUB_FILE = 'public_key.pem'

// pkcs8 DER 로 두 개인키의 비트 동일성 비교.
function derOf(privateKey) {
  return privateKey.export({ type: 'pkcs8', format: 'der' })
}

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

describe('마스터키로 wrap 된 개인키 저장(#61)', () => {
  let tempDir
  let masterKey

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enckey-test-'))
    masterKey = crypto.randomBytes(32)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('wrap → unwrap 왕복 시 개인키가 비트 동일하게 복원됨', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const envelope = wrapPrivateKey(privateKey, masterKey)
    // envelope 헤더 매직 확인 ("LCPK")
    expect(envelope.slice(0, 4).toString('ascii')).toBe('LCPK')
    const restored = unwrapPrivateKey(envelope, masterKey)
    expect(derOf(restored).equals(derOf(privateKey))).toBe(true)
  })

  it('틀린 마스터키로는 unwrap 이 실패함(GCM 인증)', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const envelope = wrapPrivateKey(privateKey, masterKey)
    const wrongKey = crypto.randomBytes(32)
    expect(() => unwrapPrivateKey(envelope, wrongKey)).toThrow()
  })

  it('신규 사용자: enc 만 생성하고 평문 pem 은 만들지 않음', () => {
    const { privateKey, publicKey } = loadOrCreateEncryptedKeyPair(tempDir, masterKey)
    expect(fs.existsSync(path.join(tempDir, ENC_FILE))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, PEM_FILE))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, PUB_FILE))).toBe(false)
    // 저장본을 다시 언랩하면 방금 생성한 개인키와 동일해야 함
    const envelope = fs.readFileSync(path.join(tempDir, ENC_FILE))
    expect(derOf(unwrapPrivateKey(envelope, masterKey)).equals(derOf(privateKey))).toBe(true)
    expect(exportPublicKey(publicKey).length).toBeGreaterThan(0)
  })

  it('두 번째 호출 시 기존 enc 를 로드함(재생성 안 함)', () => {
    const first = loadOrCreateEncryptedKeyPair(tempDir, masterKey)
    const firstMtime = fs.statSync(path.join(tempDir, ENC_FILE)).mtimeMs
    const second = loadOrCreateEncryptedKeyPair(tempDir, masterKey)
    const secondMtime = fs.statSync(path.join(tempDir, ENC_FILE)).mtimeMs
    expect(firstMtime).toBe(secondMtime)
    expect(derOf(second.privateKey).equals(derOf(first.privateKey))).toBe(true)
    expect(exportPublicKey(second.publicKey)).toBe(exportPublicKey(first.publicKey))
  })

  it('평문 pem 마이그레이션: 같은 키로 enc 생성 + 평문 삭제', () => {
    // 기존 평문 키쌍을 만들어 놓는다.
    const { privateKey: original } = loadOrCreateKeyPair(tempDir)
    expect(fs.existsSync(path.join(tempDir, PEM_FILE))).toBe(true)

    const { privateKey } = loadOrCreateEncryptedKeyPair(tempDir, masterKey)

    // enc 가 생기고 평문 pem/pub 이 안전 삭제되어야 함
    expect(fs.existsSync(path.join(tempDir, ENC_FILE))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, PEM_FILE))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, PUB_FILE))).toBe(false)
    // 신원 보존 — 마이그레이션 후에도 동일한 개인키여야 함(과거 DM 복호화 가능)
    expect(derOf(privateKey).equals(derOf(original))).toBe(true)
  })

  it('enc 와 평문 pem 이 함께 남아있으면 enc 를 쓰고 평문을 정리함', () => {
    // 정상 enc 저장
    const { privateKey: original } = loadOrCreateEncryptedKeyPair(tempDir, masterKey)
    // 마이그레이션 중단 흔적처럼 평문 pem 을 인위로 남긴다(다른 키여도 enc 가 우선).
    loadOrCreateKeyPair(tempDir) // private_key.pem/public_key.pem 생성
    expect(fs.existsSync(path.join(tempDir, PEM_FILE))).toBe(true)

    const { privateKey } = loadOrCreateEncryptedKeyPair(tempDir, masterKey)
    // enc 가 우선 — 원래 enc 의 개인키가 유지되고 평문은 삭제됨
    expect(derOf(privateKey).equals(derOf(original))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, PEM_FILE))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, PUB_FILE))).toBe(false)
  })

  it('32바이트가 아닌 마스터키는 거부함', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    expect(() => saveWrappedPrivateKey(tempDir, privateKey, Buffer.alloc(16))).toThrow()
    expect(() => loadOrCreateEncryptedKeyPair(tempDir, Buffer.alloc(31))).toThrow()
  })
})
