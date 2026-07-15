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

// --- 청크 단위 암복호화 (#44/#45/#49 청크 전송용) ---------------------------------
// 전체 파일을 IV/tag 1개로 묶는 encryptFileForPeer 와 달리, 각 청크마다 자체 IV/tag 를 쓴다.
// 이렇게 하면 150MB+ 파일을 한 번에 메모리에 base64 로 올리지 않고 1MB 단위로 흘려보낼 수 있다.
// HKDF 도출은 청크마다 반복하면 낭비이므로, 파일 전송당 deriveFileTransferKey 로 키를 1회
// 도출한 뒤 아래 두 함수에 그 키(32바이트 Buffer)를 직접 넘겨 재사용한다.

// 평문 청크 Buffer → base64 ciphertext (iv | tag | ct). key = deriveFileTransferKey 결과.
function encryptChunkWithKey(plaintextChunk, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('청크 키는 32바이트 Buffer 여야 한다')
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintextChunk), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

// base64 ciphertext → 평문 청크 Buffer. 인증 태그가 위변조/손상을 막는다(실패 시 throw).
function decryptChunkWithKey(base64Envelope, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('청크 키는 32바이트 Buffer 여야 한다')
  const buf = Buffer.from(base64Envelope, 'base64')
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('청크 envelope 너무 짧음')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

module.exports = {
  deriveFileTransferKey,
  encryptFileForPeer,
  decryptFileFromPeer,
  encryptChunkWithKey,
  decryptChunkWithKey,
}
