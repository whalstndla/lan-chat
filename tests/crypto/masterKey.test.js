// 마스터키 모듈 단위 테스트.
// safeStorage 는 Electron 외 환경에서 동작하지 않으므로 mock 으로 주입한다.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadOrCreateMasterKey, MASTER_KEY_BYTES, MASTER_KEY_FILENAME } = require('../../electron/crypto/masterKey')

// 단순 mock — 실제 OS 키체인 대신 XOR 같은 것이 아니라 그냥 Buffer wrap.
// "safeStorage 가 보호한다" 는 사실은 OS 단에서 검증되므로 단위 테스트 범위 밖.
function makeFakeSafeStorage(available = true, scrambled = false) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => {
      // 표시용으로 prefix 붙여서 Buffer 로 — base64 평문이 그대로 보이지 않도록 약간 wrap
      const wrapped = `FAKE:${s}`
      return Buffer.from(wrapped, 'utf8')
    },
    decryptString: (buf) => {
      const s = buf.toString('utf8')
      if (!s.startsWith('FAKE:')) {
        if (scrambled) throw new Error('decrypt failed (mock scrambled)')
        throw new Error('not encrypted by this mock')
      }
      return s.slice('FAKE:'.length)
    },
  }
}

describe('loadOrCreateMasterKey', () => {
  let tmp
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-master-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('첫 호출 시 32바이트 마스터키 생성 + 파일 저장', () => {
    const safeStorage = makeFakeSafeStorage()
    const key = loadOrCreateMasterKey(tmp, safeStorage)
    expect(Buffer.isBuffer(key)).toBe(true)
    expect(key.length).toBe(MASTER_KEY_BYTES)
    expect(fs.existsSync(path.join(tmp, MASTER_KEY_FILENAME))).toBe(true)
  })

  it('두 번째 호출은 같은 키를 반환 (생성 1회)', () => {
    const safeStorage = makeFakeSafeStorage()
    const a = loadOrCreateMasterKey(tmp, safeStorage)
    const b = loadOrCreateMasterKey(tmp, safeStorage)
    expect(a.equals(b)).toBe(true)
  })

  it('다른 appDataPath 는 다른 키', () => {
    const safeStorage = makeFakeSafeStorage()
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-master2-'))
    try {
      const a = loadOrCreateMasterKey(tmp, safeStorage)
      const b = loadOrCreateMasterKey(tmp2, safeStorage)
      expect(a.equals(b)).toBe(false)
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true })
    }
  })

  it('safeStorage 사용 불가 환경에서는 throw — 평문 폴백 없음', () => {
    const safeStorage = makeFakeSafeStorage(false)
    expect(() => loadOrCreateMasterKey(tmp, safeStorage)).toThrow()
    expect(fs.existsSync(path.join(tmp, MASTER_KEY_FILENAME))).toBe(false)
  })

  it('safeStorage 가 누락되어도 throw', () => {
    expect(() => loadOrCreateMasterKey(tmp, null)).toThrow()
    expect(() => loadOrCreateMasterKey(tmp, undefined)).toThrow()
  })

  it('파일이 손상되면 throw (decryptString 실패)', () => {
    const safeStorage = makeFakeSafeStorage()
    loadOrCreateMasterKey(tmp, safeStorage)
    // 손상시키기 — prefix 깨뜨림
    fs.writeFileSync(path.join(tmp, MASTER_KEY_FILENAME), Buffer.from('garbage'))
    expect(() => loadOrCreateMasterKey(tmp, safeStorage)).toThrow()
  })

  it('마스터키 파일 권한이 0600 으로 제한됨 (POSIX 환경에서만 의미)', () => {
    if (process.platform === 'win32') return // 스킵
    const safeStorage = makeFakeSafeStorage()
    loadOrCreateMasterKey(tmp, safeStorage)
    const stat = fs.statSync(path.join(tmp, MASTER_KEY_FILENAME))
    // permission bits 만 추출 (mode & 0o777)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('마스터키 파일 내용이 평문 base64 가 아니라 safeStorage 가 감싼 형태', () => {
    const safeStorage = makeFakeSafeStorage()
    const key = loadOrCreateMasterKey(tmp, safeStorage)
    const fileBytes = fs.readFileSync(path.join(tmp, MASTER_KEY_FILENAME))
    expect(fileBytes.includes(key)).toBe(false) // 마스터키 raw 가 그대로 노출되면 안 됨
    expect(fileBytes.toString('utf8').startsWith('FAKE:')).toBe(true)
  })
})
