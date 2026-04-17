// tests/crypto/encryption.test.js
const crypto = require('crypto')
const { encryptDM, decryptDM, deriveSharedSecret } = require('../../electron/crypto/encryption')

function generateTestKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('DM 암호화/복호화', () => {
  let aliceKeyPair, bobKeyPair

  beforeEach(() => {
    aliceKeyPair = generateTestKeyPair()
    bobKeyPair = generateTestKeyPair()
  })

  it('앨리스가 암호화한 메시지를 밥이 복호화할 수 있음', () => {
    const original = { content: '안녕 밥!', contentType: 'text', fileUrl: null, fileName: null }

    const aliceSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
    const ciphertext = encryptDM(original, aliceSecret)

    const bobSecret = deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey)
    const decrypted = decryptDM(ciphertext, bobSecret)

    expect(decrypted.content).toBe('안녕 밥!')
    expect(decrypted.contentType).toBe('text')
  })

  it('잘못된 키로 복호화 시 에러가 발생함', () => {
    const otherKeyPair = generateTestKeyPair()
    const original = { content: '비밀', contentType: 'text', fileUrl: null, fileName: null }

    const aliceSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
    const ciphertext = encryptDM(original, aliceSecret)

    const wrongSecret = deriveSharedSecret(otherKeyPair.privateKey, aliceKeyPair.publicKey)
    expect(() => decryptDM(ciphertext, wrongSecret)).toThrow()
  })

  it('같은 내용이라도 매번 다른 암호문 생성 (IV 랜덤화)', () => {
    const original = { content: '반복 메시지', contentType: 'text', fileUrl: null, fileName: null }
    const sharedSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)

    const ciphertext1 = encryptDM(original, sharedSecret)
    const ciphertext2 = encryptDM(original, sharedSecret)

    expect(ciphertext1).not.toBe(ciphertext2)
  })
})

describe('peerId 포함 HKDF 경로 (신규 프로덕션 방식)', () => {
  let aliceKeyPair, bobKeyPair, sharedSecret

  beforeEach(() => {
    aliceKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    bobKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    sharedSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
  })

  it('senderPeerId/recipientPeerId 포함 암호화/복호화 성공', () => {
    const original = { content: 'peerId 포함 메시지', contentType: 'text', fileUrl: null, fileName: null }

    const ciphertext = encryptDM(original, sharedSecret, 'peer-alice', 'peer-bob')
    const decrypted = decryptDM(ciphertext, sharedSecret, 'peer-alice', 'peer-bob')

    expect(decrypted.content).toBe('peerId 포함 메시지')
    expect(decrypted.contentType).toBe('text')
  })

  it('peerId 순서 무관 — 정렬 후 동일 키 사용으로 양방향 복호화 성공', () => {
    const original = { content: '양방향 테스트', contentType: 'text', fileUrl: null, fileName: null }

    // 앨리스가 암호화 (sender: alice, recipient: bob)
    const ciphertext = encryptDM(original, sharedSecret, 'peer-alice', 'peer-bob')

    // 밥이 복호화 — peerId 순서를 반대로 넣어도 내부 정렬 후 동일 키 사용
    const decrypted = decryptDM(ciphertext, sharedSecret, 'peer-bob', 'peer-alice')

    expect(decrypted.content).toBe('양방향 테스트')
  })

  it('peerId 없는 레거시 방식과 peerId 있는 방식은 호환 안 됨 (다른 키)', () => {
    const original = { content: '호환성 테스트', contentType: 'text', fileUrl: null, fileName: null }

    // 레거시 방식으로 암호화 (peerId 없음)
    const legacyCiphertext = encryptDM(original, sharedSecret)

    // 신규 방식으로 복호화 시도 → 다른 AES 키 → GCM authTag 불일치 에러
    expect(() => decryptDM(legacyCiphertext, sharedSecret, 'peer-alice', 'peer-bob')).toThrow()
  })
})
