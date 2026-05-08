// 사용자 비밀번호 기반 마스터키 관리 — OS 키체인 의존 0.
// 마스터키(32B random)를 비밀번호 KDF(KEK)로 AES-256-GCM wrap 하여 디스크에 저장한다.
// 비밀번호 없이는 디스크 파일만 빼가도 마스터키를 풀 수 없다.
//
// 파일 포맷: master.key
//   [magic(4) | version(1) | salt(16) | iv(12) | tag(16) | wrapped(32)]
//   magic   = "LCMK" (LAN Chat Master Key)
//   version = 1
//   salt    = PBKDF2 솔트
//   iv      = AES-GCM IV
//   tag     = AES-GCM 인증 태그
//   wrapped = 비밀번호 KEK 로 암호화한 32B 마스터키
//
// KDF: PBKDF2-HMAC-SHA256, 310000 iterations (NIST 권장)

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MASTER_KEY_FILENAME = 'master.key'
const LEGACY_KEY_FILENAME = 'master.key.enc' // v0.9.0 ~ 0.9.1 키체인 wrap 본
const MAGIC = Buffer.from('LCMK', 'ascii')
const VERSION = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const MASTER_KEY_BYTES = 32
const KDF_ITERATIONS = 310000

const HEADER_BYTES = MAGIC.length + 1 + SALT_BYTES + IV_BYTES + TAG_BYTES // 49

function deriveKek(password, salt) {
  if (!password) throw new Error('비밀번호가 비어 있다')
  return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, 32, 'sha256')
}

function masterKeyPath(appDataPath) {
  return path.join(appDataPath, MASTER_KEY_FILENAME)
}

function legacyKeyPath(appDataPath) {
  return path.join(appDataPath, LEGACY_KEY_FILENAME)
}

function masterKeyFileExists(appDataPath) {
  return fs.existsSync(masterKeyPath(appDataPath))
}

function legacyKeyFileExists(appDataPath) {
  return fs.existsSync(legacyKeyPath(appDataPath))
}

// 새 마스터키 생성 — register 시점에 호출.
function createMasterKey() {
  return crypto.randomBytes(MASTER_KEY_BYTES)
}

// 마스터키를 비밀번호 KEK 로 wrap 하여 디스크에 저장.
function saveWrappedMasterKey(appDataPath, masterKey, password) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('마스터키는 32바이트 Buffer 여야 한다')
  }
  const salt = crypto.randomBytes(SALT_BYTES)
  const iv = crypto.randomBytes(IV_BYTES)
  const kek = deriveKek(password, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv)
  const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    salt,
    iv,
    tag,
    wrapped,
  ])
  // 원자적 교체 — 임시파일에 쓴 후 rename
  const filePath = masterKeyPath(appDataPath)
  const tmpPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmpPath, envelope, { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

// 비밀번호로 마스터키 unwrap. 파일 부재 / 손상 / 비밀번호 오류 시 null 반환 (throw 안 함 — 호출부가 분기).
function loadWrappedMasterKey(appDataPath, password) {
  const filePath = masterKeyPath(appDataPath)
  if (!fs.existsSync(filePath)) return null
  let envelope
  try { envelope = fs.readFileSync(filePath) } catch { return null }
  if (envelope.length < HEADER_BYTES + MASTER_KEY_BYTES) return null
  if (!envelope.slice(0, MAGIC.length).equals(MAGIC)) return null
  const version = envelope[MAGIC.length]
  if (version !== VERSION) return null

  let offset = MAGIC.length + 1
  const salt = envelope.slice(offset, offset += SALT_BYTES)
  const iv = envelope.slice(offset, offset += IV_BYTES)
  const tag = envelope.slice(offset, offset += TAG_BYTES)
  const wrapped = envelope.slice(offset)

  try {
    const kek = deriveKek(password, salt)
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv)
    decipher.setAuthTag(tag)
    const masterKey = Buffer.concat([decipher.update(wrapped), decipher.final()])
    if (masterKey.length !== MASTER_KEY_BYTES) return null
    return masterKey
  } catch {
    return null // 비밀번호 오류 / 변조
  }
}

// 비밀번호 변경 — 같은 마스터키를 새 비밀번호로 다시 wrap.
function rewrapMasterKey(appDataPath, currentPassword, newPassword) {
  const masterKey = loadWrappedMasterKey(appDataPath, currentPassword)
  if (!masterKey) return false
  saveWrappedMasterKey(appDataPath, masterKey, newPassword)
  return true
}

// v0.9.x 키체인 wrap 파일 (master.key.enc) 을 비밀번호 wrap 으로 마이그레이션.
// safeStorage 가 있을 때만 호출. 성공 시 구 파일 삭제.
function migrateLegacyMasterKey(appDataPath, safeStorage, password) {
  const legacyPath = legacyKeyPath(appDataPath)
  if (!fs.existsSync(legacyPath)) return false
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('legacy 마스터키 파일이 있는데 OS 키체인 사용 불가 — 마이그레이션 불가')
  }
  const encrypted = fs.readFileSync(legacyPath)
  const base64 = safeStorage.decryptString(encrypted)
  const masterKey = Buffer.from(base64, 'base64')
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('legacy 마스터키 길이가 잘못됨')
  }
  saveWrappedMasterKey(appDataPath, masterKey, password)
  try { fs.unlinkSync(legacyPath) } catch {}
  return true
}

module.exports = {
  createMasterKey,
  saveWrappedMasterKey,
  loadWrappedMasterKey,
  rewrapMasterKey,
  migrateLegacyMasterKey,
  masterKeyFileExists,
  legacyKeyFileExists,
  masterKeyPath,
  legacyKeyPath,
  MASTER_KEY_BYTES,
  MASTER_KEY_FILENAME,
  LEGACY_KEY_FILENAME,
  KDF_ITERATIONS,
}
