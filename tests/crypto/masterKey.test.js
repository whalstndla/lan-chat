// 비밀번호 기반 마스터키 모듈 단위 테스트 (v0.10.0).
// v0.10.4: pbkdf2Sync → pbkdf2(비동기) 전환에 맞춰 전체 async/await 로 갱신.

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

  it('비밀번호로 wrap → unwrap round-trip', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'correct horse battery staple')
    const loaded = await loadWrappedMasterKey(tmp, 'correct horse battery staple')
    expect(loaded.equals(key)).toBe(true)
  })

  it('잘못된 비밀번호는 null', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'right')
    const loaded = await loadWrappedMasterKey(tmp, 'wrong')
    expect(loaded).toBeNull()
  })

  it('파일 부재면 null', async () => {
    expect(await loadWrappedMasterKey(tmp, 'any')).toBeNull()
  })

  it('손상된 파일은 null', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'pw')
    const filePath = masterKeyPath(tmp)
    const buf = fs.readFileSync(filePath)
    buf[buf.length - 1] ^= 0x01
    fs.writeFileSync(filePath, buf)
    expect(await loadWrappedMasterKey(tmp, 'pw')).toBeNull()
  })

  it('매직 불일치 파일은 null', async () => {
    fs.writeFileSync(masterKeyPath(tmp), Buffer.from('XXXX' + 'a'.repeat(100)))
    expect(await loadWrappedMasterKey(tmp, 'pw')).toBeNull()
  })

  it('빈 비밀번호는 throw', async () => {
    await expect(saveWrappedMasterKey(tmp, createMasterKey(), '')).rejects.toThrow()
    await expect(saveWrappedMasterKey(tmp, createMasterKey(), null)).rejects.toThrow()
  })

  it('잘못된 마스터키 길이는 throw', async () => {
    await expect(saveWrappedMasterKey(tmp, Buffer.alloc(16), 'pw')).rejects.toThrow()
  })

  it('파일 권한 0600 (POSIX)', async () => {
    if (process.platform === 'win32') return
    await saveWrappedMasterKey(tmp, createMasterKey(), 'pw')
    const stat = fs.statSync(masterKeyPath(tmp))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('같은 키/비밀번호도 매번 다른 envelope (random salt+IV)', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'pw')
    const a = fs.readFileSync(masterKeyPath(tmp))
    await saveWrappedMasterKey(tmp, key, 'pw')
    const b = fs.readFileSync(masterKeyPath(tmp))
    expect(a.equals(b)).toBe(false)
  })

  it('파일 내용에 마스터키 raw 가 그대로 노출되지 않는다', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'pw')
    const fileBytes = fs.readFileSync(masterKeyPath(tmp))
    expect(fileBytes.includes(key)).toBe(false)
  })
})

describe('rewrapMasterKey', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('비밀번호 변경 — 같은 마스터키를 새 비밀번호로 다시 wrap', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'old')
    const ok = await rewrapMasterKey(tmp, 'old', 'new')
    expect(ok).toBe(true)
    expect((await loadWrappedMasterKey(tmp, 'new')).equals(key)).toBe(true)
    expect(await loadWrappedMasterKey(tmp, 'old')).toBeNull()
  })

  it('이전 비밀번호가 틀리면 false 반환 + 원본 보존', async () => {
    const key = createMasterKey()
    await saveWrappedMasterKey(tmp, key, 'old')
    const ok = await rewrapMasterKey(tmp, 'wrong', 'new')
    expect(ok).toBe(false)
    expect((await loadWrappedMasterKey(tmp, 'old')).equals(key)).toBe(true)
  })
})

describe('파일 존재 체크', () => {
  it('masterKeyFileExists / legacyKeyFileExists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-'))
    try {
      expect(masterKeyFileExists(tmp)).toBe(false)
      expect(legacyKeyFileExists(tmp)).toBe(false)
      await saveWrappedMasterKey(tmp, createMasterKey(), 'pw')
      expect(masterKeyFileExists(tmp)).toBe(true)
      fs.writeFileSync(legacyKeyPath(tmp), Buffer.from('legacy'))
      expect(legacyKeyFileExists(tmp)).toBe(true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// pbkdf2Sync → pbkdf2(async) 전환 후에도 파생 키가 비트 단위로 동일해야 기존에 저장된
// master.key 파일(구버전이 pbkdf2Sync 로 wrap)을 새 버전이 계속 unwrap 할 수 있다.
// crypto.pbkdf2Sync 로 직접 envelope 를 만든 뒤 (비동기 전환된) loadWrappedMasterKey 로
// unwrap 해서, 두 KDF 경로가 동일한 KEK 를 도출함을 검증한다.
describe('KDF 동기→비동기 전환 호환성', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-mk-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('pbkdf2Sync 로 직접 wrap 한 envelope 를 비동기 loadWrappedMasterKey 가 동일하게 unwrap 한다', async () => {
    const crypto = require('crypto')
    const masterKey = createMasterKey()
    const password = 'legacy-sync-derivation-check'
    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(12)

    // masterKey.js 의 saveWrappedMasterKey 가 (전환 전) pbkdf2Sync 로 했던 것과 동일한
    // 절차를 여기서 직접 재현 — KDF 파라미터(310000/32/sha256)는 절대 바꾸지 않았으므로
    // 여기서 만든 envelope 를 새(비동기) loadWrappedMasterKey 가 그대로 읽을 수 있어야 한다.
    const kek = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256')
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv)
    const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()])
    const tag = cipher.getAuthTag()
    const envelope = Buffer.concat([Buffer.from('LCMK', 'ascii'), Buffer.from([1]), salt, iv, tag, wrapped])
    fs.writeFileSync(masterKeyPath(tmp), envelope, { mode: 0o600 })

    const loaded = await loadWrappedMasterKey(tmp, password)
    expect(loaded).not.toBeNull()
    expect(loaded.equals(masterKey)).toBe(true)
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

  it('legacy 파일을 읽어 비밀번호 wrap 으로 마이그레이션 + 원본 삭제', async () => {
    const safeStorage = makeFakeSafeStorage()
    const originalKey = require('crypto').randomBytes(32)
    fs.writeFileSync(legacyKeyPath(tmp), safeStorage.encryptString(originalKey.toString('base64')))

    await migrateLegacyMasterKey(tmp, safeStorage, 'mypassword')

    expect(legacyKeyFileExists(tmp)).toBe(false)
    expect(masterKeyFileExists(tmp)).toBe(true)
    const loaded = await loadWrappedMasterKey(tmp, 'mypassword')
    expect(loaded.equals(originalKey)).toBe(true)
  })

  it('legacy 파일 없으면 false', async () => {
    const safeStorage = makeFakeSafeStorage()
    expect(await migrateLegacyMasterKey(tmp, safeStorage, 'pw')).toBe(false)
  })

  it('safeStorage 사용 불가면 throw', async () => {
    fs.writeFileSync(legacyKeyPath(tmp), Buffer.from('FAKE:abc'))
    const safeStorage = { isEncryptionAvailable: () => false }
    await expect(migrateLegacyMasterKey(tmp, safeStorage, 'pw')).rejects.toThrow()
  })
})
