// 디스크 저장 파일 암호화 — AES-256-GCM.
// 포맷: [magic(4) | version(1) | iv(12) | tag(16) | ciphertext]
//   magic   = "LCEF" (LAN Chat Encrypted File)
//   version = 1
//   iv      = 12 bytes (GCM 권장 길이)
//   tag     = 16 bytes (인증 태그)
//
// 인증 태그 검증으로 위변조/잘못된 키/손상을 감지한다.
// 32MB 이상 거대 파일은 한 번에 메모리에 올리는 방식이라 추후 streaming 으로 개선 여지 있음.

const crypto = require('crypto')

const MAGIC = Buffer.from('LCEF', 'ascii')
const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES + TAG_BYTES // 33

function encryptBuffer(plaintext, key) {
  if (!Buffer.isBuffer(plaintext)) plaintext = Buffer.from(plaintext)
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('마스터키는 32바이트 Buffer 여야 한다')
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext])
}

function decryptBuffer(envelope, key) {
  if (!Buffer.isBuffer(envelope)) throw new Error('envelope 은 Buffer 여야 한다')
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('마스터키는 32바이트 Buffer 여야 한다')
  if (envelope.length < HEADER_BYTES) throw new Error('파일이 너무 짧음 — 손상 가능성')
  if (!envelope.slice(0, MAGIC.length).equals(MAGIC)) throw new Error('magic 불일치 — 암호화된 파일이 아님')
  const version = envelope[MAGIC.length]
  if (version !== VERSION) throw new Error(`지원하지 않는 버전: ${version}`)

  const iv = envelope.slice(MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES)
  const tag = envelope.slice(MAGIC.length + 1 + IV_BYTES, HEADER_BYTES)
  const ciphertext = envelope.slice(HEADER_BYTES)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// 디스크 헬퍼 — fs sync 로 단순 read/write. 파일 권한은 호출부에서 관리.
function isEncryptedFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES) return false
  return buffer.slice(0, MAGIC.length).equals(MAGIC)
}

module.exports = {
  encryptBuffer,
  decryptBuffer,
  isEncryptedFile,
  MAGIC,
  HEADER_BYTES,
  IV_BYTES,
  TAG_BYTES,
}
