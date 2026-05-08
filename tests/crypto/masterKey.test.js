// 비밀번호 기반 마스터키 모듈 단위 테스트 (v0.10.0).

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createMasterKey,
  saveWrappedMasterKey,
  loadWrappedMasterKey,
  rewrapMasterKey,
  migrateLegacyMasterKey,
  masterKeyFileExists,
  legacyKeyFileExists,
  masterKeyPath,
  legacyKeyPath,
  MASTER_KEY_BYTES,
  MASTER_KEY_FILENAME,
  LEGACY_KEY_FILENAME,
} = require('../../electron/crypto/masterKey')

describe('createMasterKey', () => {
  it('32바이트 random 키', () => {
    const k = createMasterKey()
    expect(Buffer.isBuffer(k)).toBe(true)
    expect(k.length).toBe(MASTER_KEY_BYTES)
    const k2 = createMasterKey()
    expect(k.equals(k2)).toBe(false)
  })
})

describe('saveWrappedMasterKey / loadWrappedMasterKey', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('비밀번호로 wrap → unwrap round-trip', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'correct horse battery staple')
    const loaded = loadWrappedMasterKey(tmp, 'correct horse battery staple')
    expect(loaded.equals(key)).toBe(true)
  })

  it('잘못된 비밀번호는 null', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'right')
    const loaded = loadWrappedMasterKey(tmp, 'wrong')
    expect(loaded).toBeNull()
  })

  it('파일 부재면 null', () => {
    expect(loadWrappedMasterKey(tmp, 'any')).toBeNull()
  })

  it('손상된 파일은 null', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'pw')
    const filePath = masterKeyPath(tmp)
    const buf = fs.readFileSync(filePath)
    buf[buf.length - 1] ^= 0x01
    fs.writeFileSync(filePath, buf)
    expect(loadWrappedMasterKey(tmp, 'pw')).toBeNull()
  })

  it('매직 불일치 파일은 null', () => {
    fs.writeFileSync(masterKeyPath(tmp), Buffer.from('XXXX' + 'a'.repeat(100)))
    expect(loadWrappedMasterKey(tmp, 'pw')).toBeNull()
  })

  it('빈 비밀번호는 throw', () => {
    expect(() => saveWrappedMasterKey(tmp, createMasterKey(), '')).toThrow()
    expect(() => saveWrappedMasterKey(tmp, createMasterKey(), null)).toThrow()
  })

  it('잘못된 마스터키 길이는 throw', () => {
    expect(() => saveWrappedMasterKey(tmp, Buffer.alloc(16), 'pw')).toThrow()
  })

  it('파일 권한 0600 (POSIX)', () => {
    if (process.platform === 'win32') return
    saveWrappedMasterKey(tmp, createMasterKey(), 'pw')
    const stat = fs.statSync(masterKeyPath(tmp))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('같은 키/비밀번호도 매번 다른 envelope (random salt+IV)', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'pw')
    const a = fs.readFileSync(masterKeyPath(tmp))
    saveWrappedMasterKey(tmp, key, 'pw')
    const b = fs.readFileSync(masterKeyPath(tmp))
    expect(a.equals(b)).toBe(false)
  })

  it('파일 내용에 마스터키 raw 가 그대로 노출되지 않는다', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'pw')
    const fileBytes = fs.readFileSync(masterKeyPath(tmp))
    expect(fileBytes.includes(key)).toBe(false)
  })
})

describe('rewrapMasterKey', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('비밀번호 변경 — 같은 마스터키를 새 비밀번호로 다시 wrap', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'old')
    const ok = rewrapMasterKey(tmp, 'old', 'new')
    expect(ok).toBe(true)
    expect(loadWrappedMasterKey(tmp, 'new').equals(key)).toBe(true)
    expect(loadWrappedMasterKey(tmp, 'old')).toBeNull()
  })

  it('이전 비밀번호가 틀리면 false 반환 + 원본 보존', () => {
    const key = createMasterKey()
    saveWrappedMasterKey(tmp, key, 'old')
    const ok = rewrapMasterKey(tmp, 'wrong', 'new')
    expect(ok).toBe(false)
    expect(loadWrappedMasterKey(tmp, 'old').equals(key)).toBe(true)
  })
})

describe('파일 존재 체크', () => {
  it('masterKeyFileExists / legacyKeyFileExists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-'))
    try {
      expect(masterKeyFileExists(tmp)).toBe(false)
      expect(legacyKeyFileExists(tmp)).toBe(false)
      saveWrappedMasterKey(tmp, createMasterKey(), 'pw')
      expect(masterKeyFileExists(tmp)).toBe(true)
      fs.writeFileSync(legacyKeyPath(tmp), Buffer.from('legacy'))
      expect(legacyKeyFileExists(tmp)).toBe(true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('migrateLegacyMasterKey', () => {
  // 모의 safeStorage — base64 wrap
  function makeFakeSafeStorage() {
    return {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('FAKE:' + s, 'utf8'),
      decryptString: (buf) => {
        const s = buf.toString('utf8')
        if (!s.startsWith('FAKE:')) throw new Error('bad')
        return s.slice('FAKE:'.length)
      },
    }
  }

  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('legacy 파일을 읽어 비밀번호 wrap 으로 마이그레이션 + 원본 삭제', () => {
    const safeStorage = makeFakeSafeStorage()
    const originalKey = require('crypto').randomBytes(32)
    fs.writeFileSync(legacyKeyPath(tmp), safeStorage.encryptString(originalKey.toString('base64')))

    migrateLegacyMasterKey(tmp, safeStorage, 'mypassword')

    expect(legacyKeyFileExists(tmp)).toBe(false)
    expect(masterKeyFileExists(tmp)).toBe(true)
    const loaded = loadWrappedMasterKey(tmp, 'mypassword')
    expect(loaded.equals(originalKey)).toBe(true)
  })

  it('legacy 파일 없으면 false', () => {
    const safeStorage = makeFakeSafeStorage()
    expect(migrateLegacyMasterKey(tmp, safeStorage, 'pw')).toBe(false)
  })

  it('safeStorage 사용 불가면 throw', () => {
    fs.writeFileSync(legacyKeyPath(tmp), Buffer.from('FAKE:abc'))
    const safeStorage = { isEncryptionAvailable: () => false }
    expect(() => migrateLegacyMasterKey(tmp, safeStorage, 'pw')).toThrow()
  })
})
