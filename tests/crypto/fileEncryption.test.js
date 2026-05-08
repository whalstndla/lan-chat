// 파일 암호화 유틸 단위 테스트 — AES-256-GCM round-trip, 위변조 / 잘못된 키 거부

const crypto = require('crypto')
const {
  encryptBuffer,
  decryptBuffer,
  isEncryptedFile,
  MAGIC,
  HEADER_BYTES,
} = require('../../electron/crypto/fileEncryption')

function randomKey() { return crypto.randomBytes(32) }

describe('encryptBuffer / decryptBuffer', () => {
  it('round-trip — 평문이 그대로 복원된다', () => {
    const key = randomKey()
    const plaintext = Buffer.from('Hello LAN Chat! 한국어도 OK 🎉')
    const envelope = encryptBuffer(plaintext, key)
    const decrypted = decryptBuffer(envelope, key)
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('빈 버퍼도 round-trip 된다', () => {
    const key = randomKey()
    const envelope = encryptBuffer(Buffer.alloc(0), key)
    const decrypted = decryptBuffer(envelope, key)
    expect(decrypted.length).toBe(0)
  })

  it('큰 버퍼 (1MB) round-trip', () => {
    const key = randomKey()
    const plaintext = crypto.randomBytes(1024 * 1024)
    const envelope = encryptBuffer(plaintext, key)
    const decrypted = decryptBuffer(envelope, key)
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('암호문은 평문과 다르고, magic 헤더가 앞에 붙는다', () => {
    const key = randomKey()
    const plaintext = Buffer.from('secret')
    const envelope = encryptBuffer(plaintext, key)
    expect(envelope.slice(0, MAGIC.length).equals(MAGIC)).toBe(true)
    expect(envelope.length).toBeGreaterThanOrEqual(HEADER_BYTES + plaintext.length)
    expect(envelope.includes(plaintext)).toBe(false)
  })

  it('같은 평문/키도 IV 가 매번 다르므로 암호문이 매번 다르다', () => {
    const key = randomKey()
    const plaintext = Buffer.from('same plaintext')
    const a = encryptBuffer(plaintext, key)
    const b = encryptBuffer(plaintext, key)
    expect(a.equals(b)).toBe(false)
  })

  it('잘못된 키로 복호화하면 throw', () => {
    const envelope = encryptBuffer(Buffer.from('x'), randomKey())
    expect(() => decryptBuffer(envelope, randomKey())).toThrow()
  })

  it('ciphertext 1바이트 변조해도 인증 태그가 막아 throw', () => {
    const key = randomKey()
    const envelope = encryptBuffer(Buffer.from('hello'), key)
    const tampered = Buffer.from(envelope)
    tampered[tampered.length - 1] ^= 0x01
    expect(() => decryptBuffer(tampered, key)).toThrow()
  })

  it('IV 변조해도 throw', () => {
    const key = randomKey()
    const envelope = encryptBuffer(Buffer.from('hello'), key)
    const tampered = Buffer.from(envelope)
    tampered[MAGIC.length + 1] ^= 0x01 // version 다음 첫 IV 바이트
    expect(() => decryptBuffer(tampered, key)).toThrow()
  })

  it('magic 이 없는 데이터는 거부', () => {
    const key = randomKey()
    // HEADER_BYTES 이상이지만 magic 이 다른 버퍼
    const fake = Buffer.alloc(HEADER_BYTES + 10, 0x00)
    fake.write('XXXX', 0, 'ascii')
    expect(() => decryptBuffer(fake, key)).toThrow(/magic/)
  })

  it('너무 짧은 버퍼는 거부', () => {
    const key = randomKey()
    expect(() => decryptBuffer(Buffer.alloc(10), key)).toThrow(/짧음/)
  })

  it('지원되지 않는 버전은 거부', () => {
    const key = randomKey()
    const envelope = encryptBuffer(Buffer.from('x'), key)
    const fake = Buffer.from(envelope)
    fake[MAGIC.length] = 99 // version 변조
    expect(() => decryptBuffer(fake, key)).toThrow(/버전/)
  })

  it('잘못된 키 길이는 거부', () => {
    expect(() => encryptBuffer(Buffer.from('x'), Buffer.alloc(16))).toThrow()
    expect(() => decryptBuffer(Buffer.alloc(50), Buffer.alloc(16))).toThrow()
  })
})

describe('isEncryptedFile', () => {
  it('암호화된 envelope 은 true', () => {
    const envelope = encryptBuffer(Buffer.from('x'), randomKey())
    expect(isEncryptedFile(envelope)).toBe(true)
  })

  it('평문 PNG 헤더는 false (magic 다름)', () => {
    expect(isEncryptedFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false)
  })

  it('짧은 버퍼는 false', () => {
    expect(isEncryptedFile(Buffer.alloc(5))).toBe(false)
  })

  it('Buffer 가 아니면 false', () => {
    expect(isEncryptedFile('LCEF stuff')).toBe(false)
    expect(isEncryptedFile(null)).toBe(false)
  })
})
