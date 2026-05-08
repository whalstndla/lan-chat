// 피어 간 파일 전송 암호화 (ECDH + AES-256-GCM) 단위 테스트

const crypto = require('crypto')
const {
  deriveFileTransferKey,
  encryptFileForPeer,
  decryptFileFromPeer,
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
