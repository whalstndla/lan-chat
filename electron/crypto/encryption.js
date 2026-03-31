// electron/crypto/encryption.js
const crypto = require('crypto')

function deriveSharedSecret(myPrivateKey, peerPublicKey) {
  return crypto.diffieHellman({
    privateKey: myPrivateKey,
    publicKey: peerPublicKey,
  })
}

// senderPeerId, recipientPeerId 제공 시 강화된 솔트/컨텍스트 사용
// 미제공 시 하위 호환을 위해 빈 솔트 + 기존 info 사용
function deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId) {
  let salt, info

  if (senderPeerId && recipientPeerId) {
    // 알파벳 순 정렬로 양방향 동일한 키 도출 보장
    const sortedIds = [senderPeerId, recipientPeerId].sort()
    salt = Buffer.from(sortedIds.join(':'))
    info = Buffer.from('lan-chat-dm:' + sortedIds[0] + ':' + sortedIds[1])
  } else {
    // 레거시 경로: 기존 동작 유지 (이전 메시지 호환)
    salt = Buffer.alloc(0)
    info = Buffer.from('lan-chat-dm')
  }

  return crypto.hkdfSync('sha256', sharedSecretBuffer, salt, info, 32)
}

function encryptDM(payload, sharedSecretBuffer, senderPeerId, recipientPeerId) {
  const aesKey = Buffer.from(deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId))
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

function decryptDM(base64Ciphertext, sharedSecretBuffer, senderPeerId, recipientPeerId) {
  const aesKey = Buffer.from(deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId))
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
