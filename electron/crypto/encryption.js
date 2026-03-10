// electron/crypto/encryption.js
const crypto = require('crypto')

function SharedSecret도출(내개인키객체, 상대방공개키객체) {
  return crypto.diffieHellman({
    privateKey: 내개인키객체,
    publicKey: 상대방공개키객체,
  })
}

function AES키파생(sharedSecretBuffer) {
  return crypto.hkdfSync(
    'sha256',
    sharedSecretBuffer,
    Buffer.alloc(0),
    Buffer.from('lan-chat-dm'),
    32
  )
}

function DM암호화(페이로드, sharedSecretBuffer) {
  const aes키 = Buffer.from(AES키파생(sharedSecretBuffer))
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', aes키, iv)
  const 평문 = Buffer.from(JSON.stringify(페이로드), 'utf-8')

  const 암호문 = Buffer.concat([cipher.update(평문), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, 암호문, authTag]).toString('base64')
}

function DM복호화(base64암호문, sharedSecretBuffer) {
  const aes키 = Buffer.from(AES키파생(sharedSecretBuffer))
  const 전체버퍼 = Buffer.from(base64암호문, 'base64')

  const iv = 전체버퍼.subarray(0, 12)
  const authTag = 전체버퍼.subarray(전체버퍼.length - 16)
  const 암호문 = 전체버퍼.subarray(12, 전체버퍼.length - 16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', aes키, iv)
  decipher.setAuthTag(authTag)

  const 복호화된버퍼 = Buffer.concat([decipher.update(암호문), decipher.final()])
  return JSON.parse(복호화된버퍼.toString('utf-8'))
}

module.exports = { SharedSecret도출, DM암호화, DM복호화 }
