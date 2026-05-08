// 피어 간 파일 전송 콘텐츠 암호화 — ECDH 공유키 + AES-256-GCM (보안 4단계).
// DM 텍스트 키와 분리하기 위해 'lan-chat-file:' info string 으로 별도 도출.
// 양방향 동일 키 보장: senderId / recipientId 를 알파벳 정렬해 사용.

const crypto = require('crypto')

const IV_BYTES = 12
const TAG_BYTES = 16

function deriveFileTransferKey(sharedSecret, senderPeerId, recipientPeerId) {
  if (!senderPeerId || !recipientPeerId) {
    throw new Error('파일 전송 키 도출에는 sender/recipient peerId 가 필요')
  }
  const sortedIds = [senderPeerId, recipientPeerId].sort()
  const salt = Buffer.from(sortedIds.join(':'))
  const info = Buffer.from('lan-chat-file:' + sortedIds[0] + ':' + sortedIds[1])
  return Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, info, 32))
}

// 평문 Buffer → base64 ciphertext (iv | tag | ct)
function encryptFileForPeer(plaintext, sharedSecret, senderPeerId, recipientPeerId) {
  const key = deriveFileTransferKey(sharedSecret, senderPeerId, recipientPeerId)
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

// base64 ciphertext → 평문 Buffer
function decryptFileFromPeer(base64Envelope, sharedSecret, senderPeerId, recipientPeerId) {
  const key = deriveFileTransferKey(sharedSecret, senderPeerId, recipientPeerId)
  const buf = Buffer.from(base64Envelope, 'base64')
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('envelope 너무 짧음')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

module.exports = { deriveFileTransferKey, encryptFileForPeer, decryptFileFromPeer }
