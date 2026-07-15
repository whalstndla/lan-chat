// electron/crypto/keyManager.js
// 장기 ECDH(P-256) 신원 키 관리.
//
// v0.11.0(#61)부터 개인키는 평문 PEM 이 아니라 masterKey 로 wrap 한 private_key.enc 로 저장하고
// 부팅이 아닌 "로그인(비밀번호) 이후"(masterKey 확보 시점)에 로드한다. 디스크만 탈취당해도
// masterKey 없이는 신원키를 풀 수 없어 피어 사칭/DM 복호화가 불가능해진다.
//
// wrap 패턴은 masterKey.js 의 AES-256-GCM envelope 를 그대로 따른다. 단 master.key 와 달리
// 비밀번호 KDF/salt 가 없다 — 이미 확보된 32B masterKey 를 대칭키로 직접 사용하기 때문.
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
// 평문 개인키 삭제 시 0 덮어쓰기 후 unlink — DB 평문 백업 삭제와 동일한 안전 삭제 루틴을 재사용한다.
const { secureWipeAndDelete } = require('../storage/dbMigration')

// 신원 키 파일명.
const ENCRYPTED_PRIVATE_KEY_FILENAME = 'private_key.enc' // masterKey 로 wrap 한 개인키(현행)
const LEGACY_PRIVATE_KEY_FILENAME = 'private_key.pem'    // v0.10.x 이전 평문 개인키
const LEGACY_PUBLIC_KEY_FILENAME = 'public_key.pem'      // v0.10.x 이전 평문 공개키

// private_key.enc envelope 포맷:
//   [magic(4) | version(1) | iv(12) | tag(16) | wrapped(pkcs8 DER)]
//   magic   = "LCPK" (LAN Chat Private Key)
//   version = 1
//   iv/tag  = AES-256-GCM IV / 인증 태그
//   wrapped = masterKey 로 암호화한 개인키(pkcs8 DER)
const KEY_MAGIC = Buffer.from('LCPK', 'ascii')
const KEY_VERSION = 1
const KEY_IV_BYTES = 12
const KEY_TAG_BYTES = 16
const MASTER_KEY_BYTES = 32
const KEY_HEADER_BYTES = KEY_MAGIC.length + 1 + KEY_IV_BYTES + KEY_TAG_BYTES // 33

function encryptedPrivateKeyPath(storagePath) {
  return path.join(storagePath, ENCRYPTED_PRIVATE_KEY_FILENAME)
}

function legacyPrivateKeyPath(storagePath) {
  return path.join(storagePath, LEGACY_PRIVATE_KEY_FILENAME)
}

function legacyPublicKeyPath(storagePath) {
  return path.join(storagePath, LEGACY_PUBLIC_KEY_FILENAME)
}

function assertMasterKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('개인키 wrap/unwrap 에는 32바이트 마스터키가 필요하다')
  }
}

// 개인키(KeyObject)를 masterKey 로 AES-256-GCM wrap 하여 envelope Buffer 반환.
function wrapPrivateKey(privateKey, masterKey) {
  assertMasterKey(masterKey)
  const der = privateKey.export({ type: 'pkcs8', format: 'der' })
  const iv = crypto.randomBytes(KEY_IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  const wrapped = Buffer.concat([cipher.update(der), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([KEY_MAGIC, Buffer.from([KEY_VERSION]), iv, tag, wrapped])
}

// envelope 를 masterKey 로 unwrap 하여 개인키 KeyObject 복원. 손상/키불일치 시 throw
// (신규 생성으로 폴백하지 않는다 — 그러면 신원이 바뀌어 과거 DM 복호화가 영구 불가해진다).
function unwrapPrivateKey(envelope, masterKey) {
  assertMasterKey(masterKey)
  if (!Buffer.isBuffer(envelope) || envelope.length < KEY_HEADER_BYTES) {
    throw new Error('개인키 파일이 손상되었습니다 (헤더 길이 부족)')
  }
  if (!envelope.slice(0, KEY_MAGIC.length).equals(KEY_MAGIC)) {
    throw new Error('개인키 파일 매직이 올바르지 않습니다')
  }
  if (envelope[KEY_MAGIC.length] !== KEY_VERSION) {
    throw new Error('개인키 파일 버전이 지원되지 않습니다')
  }
  let offset = KEY_MAGIC.length + 1
  const iv = envelope.slice(offset, offset += KEY_IV_BYTES)
  const tag = envelope.slice(offset, offset += KEY_TAG_BYTES)
  const wrapped = envelope.slice(offset)
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
  decipher.setAuthTag(tag)
  const der = Buffer.concat([decipher.update(wrapped), decipher.final()])
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

// 개인키 envelope 를 원자적으로 저장 (임시파일 → rename, 소유자 전용 0o600).
function saveWrappedPrivateKey(storagePath, privateKey, masterKey) {
  const envelope = wrapPrivateKey(privateKey, masterKey)
  const filePath = encryptedPrivateKeyPath(storagePath)
  const tmpPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmpPath, envelope, { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

// 두 개인키가 동일한지 pkcs8 DER 비교로 확인 (평문 삭제 전 왕복 검증용).
function privateKeysEqual(a, b) {
  return a.export({ type: 'pkcs8', format: 'der' })
    .equals(b.export({ type: 'pkcs8', format: 'der' }))
}

// 평문 개인키는 안전 삭제(0 덮어쓰기 후 unlink), 공개키는 민감정보가 아니므로 일반 삭제.
function cleanupLegacyPlaintext(legacyPriv, legacyPub) {
  try { if (fs.existsSync(legacyPriv)) secureWipeAndDelete(legacyPriv) } catch { /* 삭제 실패 무시 */ }
  try { if (fs.existsSync(legacyPub)) fs.unlinkSync(legacyPub) } catch { /* 삭제 실패 무시 */ }
}

// 로그인/등록 이후(masterKey 확보 후) 호출한다. 반드시 discovery/연결 시작 전에 불려야
// hello/키교환/DM(개인키 필요)이 정상 동작한다.
//   1) private_key.enc 존재 → 언랩해서 사용 (남은 평문 pem 은 검증 후 정리).
//   2) 평문 private_key.pem 존재 → 1회 마이그레이션(wrap 저장 → 왕복 검증 → 평문 안전삭제).
//   3) 둘 다 없음(신규 사용자) → 키쌍 생성 후 즉시 wrap 저장(평문 pem 을 만들지 않는다).
function loadOrCreateEncryptedKeyPair(storagePath, masterKey) {
  assertMasterKey(masterKey)
  const encPath = encryptedPrivateKeyPath(storagePath)
  const legacyPriv = legacyPrivateKeyPath(storagePath)
  const legacyPub = legacyPublicKeyPath(storagePath)

  // 1) 이미 암호화 저장본이 있으면 그대로 사용.
  if (fs.existsSync(encPath)) {
    const privateKey = unwrapPrivateKey(fs.readFileSync(encPath), masterKey)
    const publicKey = crypto.createPublicKey(privateKey)
    // 마이그레이션 중 비정상 종료로 평문 pem 이 남아있을 수 있다 — enc 가 정상 언랩된 지금은
    // 평문이 불필요하므로 안전 삭제한다(부팅 간 잔존 평문 정리 가드).
    cleanupLegacyPlaintext(legacyPriv, legacyPub)
    return { privateKey, publicKey }
  }

  // 2) 평문 pem 만 있으면 마이그레이션.
  if (fs.existsSync(legacyPriv)) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(legacyPriv, 'utf-8'))
    const publicKey = crypto.createPublicKey(privateKey)
    saveWrappedPrivateKey(storagePath, privateKey, masterKey)
    // 저장본이 원본과 비트 동일하게 복원되는 것을 확인한 뒤에만 평문을 지운다
    // (검증 실패 시 평문을 남겨 데이터 손실을 막는다).
    const roundtrip = unwrapPrivateKey(fs.readFileSync(encPath), masterKey)
    if (privateKeysEqual(privateKey, roundtrip)) {
      cleanupLegacyPlaintext(legacyPriv, legacyPub)
    }
    return { privateKey, publicKey }
  }

  // 3) 신규 사용자: 생성 → 즉시 wrap 저장.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  saveWrappedPrivateKey(storagePath, privateKey, masterKey)
  return { privateKey, publicKey }
}

// 평문 개인키 저장 방식(구버전 호환). 프로덕션 부팅 경로에서는 더 이상 사용하지 않으며
// 테스트 하네스/유닛 테스트에서만 임시 키쌍 생성용으로 쓴다.
function loadOrCreateKeyPair(storagePath) {
  const privateKeyPath = path.join(storagePath, LEGACY_PRIVATE_KEY_FILENAME)
  const publicKeyPath = path.join(storagePath, LEGACY_PUBLIC_KEY_FILENAME)

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8')
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8')
    const privateKey = crypto.createPrivateKey(privateKeyPem)
    const publicKey = crypto.createPublicKey(publicKeyPem)
    return { privateKey, publicKey }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))

  return { privateKey, publicKey }
}

function exportPublicKey(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

function importPublicKey(base64String) {
  const derBuffer = Buffer.from(base64String, 'base64')
  return crypto.createPublicKey({ key: derBuffer, type: 'spki', format: 'der' })
}

module.exports = {
  loadOrCreateEncryptedKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  saveWrappedPrivateKey,
  encryptedPrivateKeyPath,
  legacyPrivateKeyPath,
  legacyPublicKeyPath,
  ENCRYPTED_PRIVATE_KEY_FILENAME,
  LEGACY_PRIVATE_KEY_FILENAME,
  LEGACY_PUBLIC_KEY_FILENAME,
  loadOrCreateKeyPair,
  exportPublicKey,
  importPublicKey,
}
