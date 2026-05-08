// 부팅 시 평문 파일 → ciphertext 마이그레이션 단위 테스트

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { migratePlaintextFiles, encryptDirectoryInPlace } = require('../../electron/storage/fileMigration')
const { encryptBuffer, isEncryptedFile, decryptBuffer } = require('../../electron/crypto/fileEncryption')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mig-'))
}

describe('encryptDirectoryInPlace', () => {
  let dir
  let key
  beforeEach(() => {
    dir = makeTempDir()
    key = crypto.randomBytes(32)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('평문 파일을 ciphertext 로 변환하고 원본 내용 복원 가능', () => {
    const original = Buffer.from('이것은 평문이다 ABC')
    fs.writeFileSync(path.join(dir, 'a.png'), original)
    const result = encryptDirectoryInPlace(dir, key)
    expect(result.converted).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)

    const onDisk = fs.readFileSync(path.join(dir, 'a.png'))
    expect(isEncryptedFile(onDisk)).toBe(true)
    expect(decryptBuffer(onDisk, key).equals(original)).toBe(true)
  })

  it('이미 암호화된 파일은 건너뛴다 (skipped 카운트)', () => {
    const original = Buffer.from('already encrypted source')
    const ciphertext = encryptBuffer(original, key)
    fs.writeFileSync(path.join(dir, 'b.png'), ciphertext)
    const result = encryptDirectoryInPlace(dir, key)
    expect(result.converted).toBe(0)
    expect(result.skipped).toBe(1)

    // 그대로 복호화 가능
    const onDisk = fs.readFileSync(path.join(dir, 'b.png'))
    expect(decryptBuffer(onDisk, key).equals(original)).toBe(true)
  })

  it('하위 디렉토리는 무시 (파일만 처리)', () => {
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'inside.png'), 'inner') // 무시됨
    fs.writeFileSync(path.join(dir, 'top.png'), Buffer.from('top'))
    const result = encryptDirectoryInPlace(dir, key)
    expect(result.converted).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('존재하지 않는 디렉토리는 무시 — 0/0/0', () => {
    const ghost = path.join(os.tmpdir(), 'lan-chat-ghost-' + Date.now())
    const result = encryptDirectoryInPlace(ghost, key)
    expect(result).toEqual({ converted: 0, skipped: 0, failed: 0 })
  })

  it('변환 중 다운/충돌이 있어도 원본은 손상되지 않는다 (rename 원자성)', () => {
    const original = Buffer.from('atomic test')
    fs.writeFileSync(path.join(dir, 'c.png'), original)
    encryptDirectoryInPlace(dir, key)
    // 임시파일 잔재가 없어야 함
    const entries = fs.readdirSync(dir)
    expect(entries.length).toBe(1)
    expect(entries[0]).toBe('c.png')
  })
})

describe('migratePlaintextFiles', () => {
  let appDataPath
  let key
  beforeEach(() => {
    appDataPath = makeTempDir()
    fs.mkdirSync(path.join(appDataPath, 'files'))
    fs.mkdirSync(path.join(appDataPath, 'file_cache'))
    key = crypto.randomBytes(32)
  })
  afterEach(() => fs.rmSync(appDataPath, { recursive: true, force: true }))

  it('files/ 와 file_cache/ 양쪽 모두 처리', () => {
    fs.writeFileSync(path.join(appDataPath, 'files', 'a.png'), 'p1')
    fs.writeFileSync(path.join(appDataPath, 'file_cache', 'msg-1.png'), 'p2')

    const summary = migratePlaintextFiles(appDataPath, key)
    expect(summary.converted).toBe(2)

    expect(isEncryptedFile(fs.readFileSync(path.join(appDataPath, 'files', 'a.png')))).toBe(true)
    expect(isEncryptedFile(fs.readFileSync(path.join(appDataPath, 'file_cache', 'msg-1.png')))).toBe(true)
  })

  it('masterKey 없으면 throw', () => {
    expect(() => migratePlaintextFiles(appDataPath, null)).toThrow()
  })
})
