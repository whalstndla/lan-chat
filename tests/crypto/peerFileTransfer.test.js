// 피어 간 파일 전송 암호화 (ECDH + AES-256-GCM) 단위 테스트

const crypto = require('crypto')
const {
  deriveFileTransferKey,
  encryptFileForPeer,
  decryptFileFromPeer,
  encryptChunkWithKey,
  decryptChunkWithKey,
} = require('../../electron/crypto/peerFileTransfer')

function makeKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

function shared(privA, pubB) {
  return crypto.diffieHellman({ privateKey: privA, publicKey: pubB })
}

describe('deriveFileTransferKey', () => {
  it('양방향(sender↔recipient) 동일 키 — peerId 정렬 기반', () => {
    const A = makeKeyPair(); const B = makeKeyPair()
    const sAB = shared(A.privateKey, B.publicKey)
    const sBA = shared(B.privateKey, A.publicKey)
    const kAB = deriveFileTransferKey(sAB, 'alice', 'bob')
    const kBA = deriveFileTransferKey(sBA, 'bob', 'alice')
    expect(kAB.equals(kBA)).toBe(true)
    expect(kAB.length).toBe(32)
  })

  it('peerId 가 다르면 키도 다름', () => {
    const A = makeKeyPair(); const B = makeKeyPair()
    const sec = shared(A.privateKey, B.publicKey)
    const k1 = deriveFileTransferKey(sec, 'alice', 'bob')
    const k2 = deriveFileTransferKey(sec, 'alice', 'carol')
    expect(k1.equals(k2)).toBe(false)
  })

  it('peerId 누락 시 throw', () => {
    const A = makeKeyPair(); const B = makeKeyPair()
    const sec = shared(A.privateKey, B.publicKey)
    expect(() => deriveFileTransferKey(sec, null, 'bob')).toThrow()
    expect(() => deriveFileTransferKey(sec, 'a', '')).toThrow()
  })
})

describe('encryptFileForPeer / decryptFileFromPeer', () => {
  let A, B, sAB, sBA
  beforeEach(() => {
    A = makeKeyPair(); B = makeKeyPair()
    sAB = shared(A.privateKey, B.publicKey)
    sBA = shared(B.privateKey, A.publicKey)
  })

  it('round-trip — A → B 암호화 후 B 가 복호화 가능', () => {
    const plaintext = Buffer.from('파일 콘텐츠 ABC 한국어')
    const envelope = encryptFileForPeer(plaintext, sAB, 'alice', 'bob')
    expect(typeof envelope).toBe('string') // base64
    const decrypted = decryptFileFromPeer(envelope, sBA, 'alice', 'bob')
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('큰 버퍼 (512KB) 도 round-trip', () => {
    const plaintext = crypto.randomBytes(512 * 1024)
    const envelope = encryptFileForPeer(plaintext, sAB, 'a', 'b')
    const decrypted = decryptFileFromPeer(envelope, sBA, 'a', 'b')
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('잘못된 peerId 조합으로 복호화 시 throw', () => {
    const envelope = encryptFileForPeer(Buffer.from('x'), sAB, 'alice', 'bob')
    expect(() => decryptFileFromPeer(envelope, sBA, 'alice', 'eve')).toThrow()
  })

  it('전혀 다른 sharedSecret 으로 복호화 시 throw', () => {
    const C = makeKeyPair()
    const sAC = shared(A.privateKey, C.publicKey)
    const envelope = encryptFileForPeer(Buffer.from('x'), sAB, 'alice', 'bob')
    expect(() => decryptFileFromPeer(envelope, sAC, 'alice', 'bob')).toThrow()
  })

  it('변조된 ciphertext 는 인증 태그가 막아 throw', () => {
    const envelope = encryptFileForPeer(Buffer.from('hello'), sAB, 'a', 'b')
    const buf = Buffer.from(envelope, 'base64')
    buf[buf.length - 1] ^= 0x01
    expect(() => decryptFileFromPeer(buf.toString('base64'), sBA, 'a', 'b')).toThrow()
  })

  it('너무 짧은 envelope 은 거부', () => {
    expect(() => decryptFileFromPeer(Buffer.alloc(10).toString('base64'), sAB, 'a', 'b')).toThrow()
  })

  it('같은 평문/키도 IV 가 매번 다르므로 envelope 매번 다름', () => {
    const e1 = encryptFileForPeer(Buffer.from('x'), sAB, 'a', 'b')
    const e2 = encryptFileForPeer(Buffer.from('x'), sAB, 'a', 'b')
    expect(e1).not.toBe(e2)
  })
})

describe('encryptChunkWithKey / decryptChunkWithKey (청크 단위)', () => {
  let A, B, key
  beforeEach(() => {
    A = makeKeyPair(); B = makeKeyPair()
    // 전송당 1회 도출한 키를 청크마다 재사용하는 실제 흐름을 모사.
    key = deriveFileTransferKey(shared(A.privateKey, B.publicKey), 'alice', 'bob')
  })

  it('청크 round-trip — 각 청크가 자체 IV/tag 로 암복호화', () => {
    const chunk = crypto.randomBytes(1024 * 1024) // 1MB
    const envelope = encryptChunkWithKey(chunk, key)
    expect(typeof envelope).toBe('string')
    const decrypted = decryptChunkWithKey(envelope, key)
    expect(decrypted.equals(chunk)).toBe(true)
  })

  it('여러 청크를 순서대로 이어붙이면 원본 복원', () => {
    const original = crypto.randomBytes(2_500_000)
    const CHUNK = 1024 * 1024
    const parts = []
    for (let offset = 0; offset < original.length; offset += CHUNK) {
      const env = encryptChunkWithKey(original.subarray(offset, offset + CHUNK), key)
      parts.push(decryptChunkWithKey(env, key))
    }
    expect(Buffer.concat(parts).equals(original)).toBe(true)
  })

  it('같은 청크/키라도 IV 가 매번 달라 envelope 매번 다름', () => {
    const chunk = Buffer.from('동일 청크')
    expect(encryptChunkWithKey(chunk, key)).not.toBe(encryptChunkWithKey(chunk, key))
  })

  it('변조된 청크는 인증 태그가 막아 throw', () => {
    const env = encryptChunkWithKey(Buffer.from('hello chunk'), key)
    const buf = Buffer.from(env, 'base64')
    buf[buf.length - 1] ^= 0x01
    expect(() => decryptChunkWithKey(buf.toString('base64'), key)).toThrow()
  })

  it('다른 키로 복호화 시 throw', () => {
    const C = makeKeyPair()
    const otherKey = deriveFileTransferKey(shared(A.privateKey, C.publicKey), 'alice', 'carol')
    const env = encryptChunkWithKey(Buffer.from('x'), key)
    expect(() => decryptChunkWithKey(env, otherKey)).toThrow()
  })

  it('키 길이가 32바이트가 아니면 throw', () => {
    expect(() => encryptChunkWithKey(Buffer.from('x'), Buffer.alloc(16))).toThrow()
    expect(() => decryptChunkWithKey('AAAA', Buffer.alloc(16))).toThrow()
  })

  it('너무 짧은 청크 envelope 은 거부', () => {
    expect(() => decryptChunkWithKey(Buffer.alloc(10).toString('base64'), key)).toThrow()
  })

  it('빈 청크(0바이트)도 round-trip', () => {
    const env = encryptChunkWithKey(Buffer.alloc(0), key)
    expect(decryptChunkWithKey(env, key).length).toBe(0)
  })
})
