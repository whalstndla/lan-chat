// tests/crypto/hkdf.test.js
const crypto = require('crypto')
const { encryptDM, decryptDM, deriveSharedSecret } = require('../../electron/crypto/encryption')

function generateTestKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('HKDF 솔트/컨텍스트 강화 테스트', () => {
  let aliceKeyPair, bobKeyPair
  let aliceSharedSecret, bobSharedSecret

  beforeEach(() => {
    aliceKeyPair = generateTestKeyPair()
    bobKeyPair = generateTestKeyPair()
    aliceSharedSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
    bobSharedSecret = deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey)
  })

  it('peerId A,B로 암호화 후 동일한 peerId A,B로 복호화 성공', () => {
    const original = { content: '안녕하세요', contentType: 'text', fileUrl: null, fileName: null }
    const senderPeerId = 'peer-alice'
    const recipientPeerId = 'peer-bob'

    const ciphertext = encryptDM(original, aliceSharedSecret, senderPeerId, recipientPeerId)
    // 밥의 공유 비밀은 앨리스와 동일한 값 → 같은 peerId로 복호화
    const decrypted = decryptDM(ciphertext, bobSharedSecret, senderPeerId, recipientPeerId)

    expect(decrypted.content).toBe('안녕하세요')
    expect(decrypted.contentType).toBe('text')
  })

  it('peerId A,B로 암호화 후 다른 peerId C,D로 복호화 시 에러 발생', () => {
    const original = { content: '비밀 메시지', contentType: 'text', fileUrl: null, fileName: null }

    const ciphertext = encryptDM(original, aliceSharedSecret, 'peer-alice', 'peer-bob')

    // 잘못된 peerId로 복호화 시도 → HKDF 도출 키가 달라 인증 태그 검증 실패
    expect(() => decryptDM(ciphertext, bobSharedSecret, 'peer-charlie', 'peer-dave')).toThrow()
  })

  it('peerId 없이 암호화/복호화 (레거시 경로) 정상 동작', () => {
    const original = { content: '레거시 메시지', contentType: 'text', fileUrl: null, fileName: null }

    // peerId 인수 없이 호출 → 하위 호환 경로 사용
    const ciphertext = encryptDM(original, aliceSharedSecret)
    const decrypted = decryptDM(ciphertext, bobSharedSecret)

    expect(decrypted.content).toBe('레거시 메시지')
  })

  it('peerId 포함 암호화 vs 레거시 암호화는 서로 복호화 불가', () => {
    const original = { content: '크로스 테스트', contentType: 'text', fileUrl: null, fileName: null }

    // 신규 방식으로 암호화
    const ciphertextNew = encryptDM(original, aliceSharedSecret, 'peer-alice', 'peer-bob')

    // 레거시 방식으로 복호화 시도 → 키가 다르므로 실패
    expect(() => decryptDM(ciphertextNew, bobSharedSecret)).toThrow()
  })

  it('peerId 순서가 달라도(B,A vs A,B) 정렬로 인해 동일한 키 도출', () => {
    const original = { content: '순서 무관 테스트', contentType: 'text', fileUrl: null, fileName: null }

    // 앨리스가 (alice, bob) 순서로 암호화
    const ciphertext = encryptDM(original, aliceSharedSecret, 'peer-alice', 'peer-bob')

    // 밥이 (bob, alice) 역순으로 복호화 → 정렬로 인해 동일 키 사용 가능
    const decrypted = decryptDM(ciphertext, bobSharedSecret, 'peer-bob', 'peer-alice')

    expect(decrypted.content).toBe('순서 무관 테스트')
  })
})
