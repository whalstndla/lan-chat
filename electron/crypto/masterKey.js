// 디스크 저장 파일/DB 암호화에 쓰는 32바이트 마스터키 관리.
// 마스터키 자체는 OS 키체인 (safeStorage) 으로 감싸서 디스크에 저장한다.
// - macOS: Keychain
// - Windows: DPAPI
// - Linux: kwallet / libsecret / gnome-keyring
// safeStorage 가 사용 불가능한 환경에서는 의도적으로 throw — 평문 폴백을 두면 보안 약속이 깨진다.
//
// safeStorage 는 testability 를 위해 인자로 주입 (Electron 외부 테스트에서 mock 사용).

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const MASTER_KEY_FILENAME = 'master.key.enc'
const MASTER_KEY_BYTES = 32 // AES-256

// safeStorage 인터페이스: { isEncryptionAvailable(), encryptString(s), decryptString(buf) }
function loadOrCreateMasterKey(appDataPath, safeStorage) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain 사용 불가 — 마스터키를 보호할 수 없으므로 진행 거부')
  }

  const keyFilePath = path.join(appDataPath, MASTER_KEY_FILENAME)

  if (fs.existsSync(keyFilePath)) {
    const encrypted = fs.readFileSync(keyFilePath)
    const base64 = safeStorage.decryptString(encrypted)
    const key = Buffer.from(base64, 'base64')
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(`마스터키 길이가 잘못됨 (${key.length}). 파일 손상 가능성.`)
    }
    return key
  }

  // 신규 생성 — 32바이트 CSPRNG, base64 로 변환해 safeStorage 로 감싼다
  const newKey = crypto.randomBytes(MASTER_KEY_BYTES)
  const encrypted = safeStorage.encryptString(newKey.toString('base64'))
  fs.writeFileSync(keyFilePath, encrypted, { mode: 0o600 })
  return newKey
}

module.exports = { loadOrCreateMasterKey, MASTER_KEY_BYTES, MASTER_KEY_FILENAME }
