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
