const crypto = require('crypto')

const DOMAIN = 'lan-chat.lanpet.v1'
const MAX_PLAINTEXT_BYTES = 16 * 1024
const MAX_CIPHERTEXT_CHARACTERS = Math.ceil((MAX_PLAINTEXT_BYTES + 28) / 3) * 4

function fingerprint(publicKey) {
  const bytes = typeof publicKey === 'string'
    ? Buffer.from(publicKey, 'base64')
    : publicKey.export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function deriveKey(identity) {
  const secret = crypto.diffieHellman({ privateKey: identity.privateKey, publicKey: identity.peerPublicKey })
  const participants = [identity.localFingerprint, identity.peerFingerprint].sort().join(':')
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from(participants), Buffer.from(DOMAIN), 32))
}

function associatedData(sender, recipient) {
  return Buffer.from(JSON.stringify([DOMAIN, sender, recipient]))
}

function encryptPetEnvelope(envelope, identity) {
  const plaintext = Buffer.from(JSON.stringify(envelope))
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('PAYLOAD_TOO_LARGE')
  const initializationVector = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(identity), initializationVector)
  cipher.setAAD(associatedData(identity.localFingerprint, identity.peerFingerprint))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([initializationVector, ciphertext, cipher.getAuthTag()]).toString('base64')
}

function decryptPetEnvelope(encoded, identity) {
  if (typeof encoded !== 'string' || encoded.length > MAX_CIPHERTEXT_CHARACTERS ||
      encoded.length < 40 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('INVALID_CIPHERTEXT')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 29 || bytes.length > MAX_PLAINTEXT_BYTES + 28) throw new Error('INVALID_CIPHERTEXT')
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(identity), bytes.subarray(0, 12))
  decipher.setAAD(associatedData(identity.peerFingerprint, identity.localFingerprint))
  decipher.setAuthTag(bytes.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()])
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('PAYLOAD_TOO_LARGE')
  return JSON.parse(plaintext.toString('utf8'))
}

module.exports = { DOMAIN, MAX_PLAINTEXT_BYTES, MAX_CIPHERTEXT_CHARACTERS, fingerprint, encryptPetEnvelope, decryptPetEnvelope }
