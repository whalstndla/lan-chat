const crypto = require('crypto')
const { DOMAIN, fingerprint, encryptPetEnvelope, decryptPetEnvelope } = require('../../electron/lanpet/petCrypto')
const { encryptDM } = require('../../electron/crypto/encryption')

function identities() {
  const first = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const second = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return [
    { privateKey: first.privateKey, peerPublicKey: second.publicKey, localFingerprint: fingerprint(first.publicKey), peerFingerprint: fingerprint(second.publicKey) },
    { privateKey: second.privateKey, peerPublicKey: first.publicKey, localFingerprint: fingerprint(second.publicKey), peerFingerprint: fingerprint(first.publicKey) },
  ]
}

describe('Lanpet domain encryption', () => {
  test('round trips only to the intended identity and detects tampering', () => {
    const [first, second] = identities()
    const value = { protocol: DOMAIN, petName: 'Spark' }
    const ciphertext = encryptPetEnvelope(value, first)
    expect(decryptPetEnvelope(ciphertext, second)).toEqual(value)
    expect(ciphertext).not.toContain('Spark')
    expect(() => decryptPetEnvelope(ciphertext, first)).toThrow()
    expect(() => decryptPetEnvelope(ciphertext, { ...second, localFingerprint: 'another-key' })).toThrow()
    const tampered = Buffer.from(ciphertext, 'base64')
    tampered[15] ^= 1
    expect(() => decryptPetEnvelope(tampered.toString('base64'), second)).toThrow()
  })

  test('rejects DM ciphertext under the same ECDH shared secret', () => {
    const [first, second] = identities()
    const secret = crypto.diffieHellman({ privateKey: first.privateKey, publicKey: first.peerPublicKey })
    const dm = encryptDM({ protocol: DOMAIN }, secret, 'first', 'second')
    expect(() => decryptPetEnvelope(dm, second)).toThrow()
  })

  test('limits plaintext and encoded ciphertext before decryption', () => {
    const [first, second] = identities()
    expect(() => encryptPetEnvelope({ value: 'x'.repeat(16384) }, first)).toThrow('PAYLOAD_TOO_LARGE')
    expect(() => decryptPetEnvelope('a'.repeat(24000), second)).toThrow('INVALID_CIPHERTEXT')
    expect(() => decryptPetEnvelope('???', second)).toThrow('INVALID_CIPHERTEXT')
  })
})
