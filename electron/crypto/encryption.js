// electron/crypto/encryption.js
const crypto = require('crypto')

function deriveSharedSecret(myPrivateKey, peerPublicKey) {
  return crypto.diffieHellman({
    privateKey: myPrivateKey,
    publicKey: peerPublicKey,
  })
}

function deriveAESKey(sharedSecretBuffer) {
  return crypto.hkdfSync(
    'sha256',
    sharedSecretBuffer,
    Buffer.alloc(0),
    Buffer.from('lan-chat-dm'),
    32
  )
}

function encryptDM(payload, sharedSecretBuffer) {
  const aesKey = Buffer.from(deriveAESKey(sharedSecretBuffer))
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

function decryptDM(base64Ciphertext, sharedSecretBuffer) {
  const aesKey = Buffer.from(deriveAESKey(sharedSecretBuffer))
  const fullBuffer = Buffer.from(base64Ciphertext, 'base64')

  const iv = fullBuffer.subarray(0, 12)
  const authTag = fullBuffer.subarray(fullBuffer.length - 16)
  const ciphertext = fullBuffer.subarray(12, fullBuffer.length - 16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)

  const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decryptedBuffer.toString('utf-8'))
}

module.exports = { deriveSharedSecret, encryptDM, decryptDM }
